import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createJobApp } from '../server/app.js';

async function withApp(run: (base: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'job-security-'));
  const app = createJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}

async function register(base: string, email: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test User', email, password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false })
  });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

test('security headers and same-origin guard are enforced', async () => {
  await withApp(async base => {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.headers.get('x-frame-options'), 'DENY');
    assert.match(health.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(health.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');

    const blocked = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ name: 'Evil User', email: 'evil@example.pl', password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true })
    });
    assert.equal(blocked.status, 403);
  });
});

test('auth rate limiting rejects repeated login attempts', async () => {
  await withApp(async base => {
    let last = 0;
    for (let i = 0; i < 21; i += 1) {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.pl', password: 'Niepoprawne123' })
      });
      last = response.status;
    }
    assert.equal(last, 429);
  });
});

test('one user cannot access another user job record', async () => {
  await withApp(async base => {
    const alice = await register(base, 'alice@example.pl');
    const bob = await register(base, 'bob@example.pl');
    const created = await fetch(`${base}/api/jobs/parse`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: alice }, body: JSON.stringify({ text: 'Magazynier\nFirma: ABC\nMiejsce pracy: Gdynia\nWymagania: UDT.' })
    });
    assert.equal(created.status, 201);
    const payload = await created.json() as { jobId: string };
    const foreign = await fetch(`${base}/api/jobs/${payload.jobId}/decide`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: bob }, body: '{}' });
    assert.equal(foreign.status, 404);
  });
});