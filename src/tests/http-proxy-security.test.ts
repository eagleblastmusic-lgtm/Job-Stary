import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createJobApp } from '../server/app.js';
import type { AppConfig } from '../server/config.js';

async function withApp(overrides: Partial<AppConfig>, run: (base: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'job-http-proxy-'));
  const app = createJobApp({
    nodeEnv: 'test',
    port: 0,
    appOrigin: 'http://127.0.0.1',
    dataDir: dir,
    databasePath: join(dir, 'test.sqlite'),
    adminEmails: new Set(),
    ...overrides
  });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}

async function invalidRegistration(base: string, forwardedFor?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
  return fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Test User', email: 'invalid-email', password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true })
  });
}

test('API responses are non-cacheable and production responses include transport/resource isolation headers', async () => {
  await withApp({ nodeEnv: 'production', appOrigin: 'https://jobs.example.pl' }, async base => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('pragma'), 'no-cache');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
  });
});

test('Fetch Metadata rejects cross-site and same-site browser mutations even without Origin', async () => {
  await withApp({}, async base => {
    for (const site of ['cross-site', 'same-site']) {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': site },
        body: JSON.stringify({ email: 'nobody@example.pl', password: 'Niepoprawne123' })
      });
      assert.equal(response.status, 403);
      const payload = await response.json() as { error?: { code?: string } };
      assert.equal(payload.error?.code, 'ORIGIN_REJECTED');
    }

    const sameOrigin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ email: 'nobody@example.pl', password: 'Niepoprawne123' })
    });
    assert.equal(sameOrigin.status, 401);
  });
});

test('forwarded client IP is ignored unless the deployment explicitly trusts its proxy', async () => {
  await withApp({ trustProxy: false }, async base => {
    let lastStatus = 0;
    for (let index = 0; index < 16; index += 1) {
      const response = await invalidRegistration(base, index % 2 === 0 ? '203.0.113.10' : '198.51.100.20');
      lastStatus = response.status;
    }
    assert.equal(lastStatus, 429);
  });

  await withApp({ trustProxy: true }, async base => {
    const statuses: number[] = [];
    for (let index = 0; index < 16; index += 1) {
      const response = await invalidRegistration(base, index % 2 === 0 ? '203.0.113.10' : '198.51.100.20');
      statuses.push(response.status);
    }
    assert.equal(statuses.includes(429), false);
    assert.equal(statuses.every(status => status === 400), true);
  });
});

test('invalid forwarded IP falls back to the socket address and rate-limit state is instance-local', async () => {
  await withApp({ trustProxy: true }, async base => {
    let lastStatus = 0;
    for (let index = 0; index < 16; index += 1) {
      lastStatus = (await invalidRegistration(base, `not-an-ip-${index}`)).status;
    }
    assert.equal(lastStatus, 429);
  });

  await withApp({ trustProxy: true }, async base => {
    const freshInstance = await invalidRegistration(base, 'not-an-ip-again');
    assert.equal(freshInstance.status, 400);
  });
});
