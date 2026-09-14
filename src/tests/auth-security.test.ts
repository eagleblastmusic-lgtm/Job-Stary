import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createJobApp } from '../server/app.js';

const TEST_PASSWORD = 'Bezpieczne123';

async function withApp(run: (base: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'job-auth-security-'));
  const app = createJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}

async function jsonRequest(base: string, path: string, options: { method?: string; body?: Record<string, unknown>; cookie?: string } = {}): Promise<{ response: Response; payload: { error?: { code?: string; message?: string }; [key: string]: unknown } }> {
  const headers: Record<string, string> = {};
  if (options.body) headers['content-type'] = 'application/json';
  if (options.cookie) headers.cookie = options.cookie;
  const requestInit: RequestInit = { method: options.method ?? 'GET', headers };
  if (options.body) requestInit.body = JSON.stringify(options.body);
  const response = await fetch(`${base}${path}`, requestInit);
  const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string }; [key: string]: unknown };
  return { response, payload };
}

async function register(base: string, email = 'auth-user@example.pl'): Promise<string> {
  const { response } = await jsonRequest(base, '/api/auth/register', {
    method: 'POST',
    body: { name: 'Auth User', email, password: TEST_PASSWORD, acceptTerms: true, acceptPrivacy: true, analyticsConsent: false }
  });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

test('invalid registration credentials return controlled 400 responses', async () => {
  await withApp(async base => {
    const invalidEmail = await jsonRequest(base, '/api/auth/register', {
      method: 'POST',
      body: { name: 'Auth User', email: 'not-an-email', password: TEST_PASSWORD, acceptTerms: true, acceptPrivacy: true }
    });
    assert.equal(invalidEmail.response.status, 400);
    assert.equal(invalidEmail.payload.error?.code, 'INVALID_EMAIL');

    const weakPassword = await jsonRequest(base, '/api/auth/register', {
      method: 'POST',
      body: { name: 'Auth User', email: 'weak@example.pl', password: 'short', acceptTerms: true, acceptPrivacy: true }
    });
    assert.equal(weakPassword.response.status, 400);
    assert.equal(weakPassword.payload.error?.code, 'WEAK_PASSWORD');

    const hugePassword = await jsonRequest(base, '/api/auth/register', {
      method: 'POST',
      body: { name: 'Auth User', email: 'huge@example.pl', password: `A1${'x'.repeat(255)}`, acceptTerms: true, acceptPrivacy: true }
    });
    assert.equal(hugePassword.response.status, 400);
    assert.equal(hugePassword.payload.error?.code, 'PASSWORD_TOO_LONG');
  });
});

test('unknown account and wrong password expose the same login error contract', async () => {
  await withApp(async base => {
    await register(base, 'known@example.pl');
    const unknown = await jsonRequest(base, '/api/auth/login', {
      method: 'POST', body: { email: 'unknown@example.pl', password: 'Niepoprawne123' }
    });
    const wrong = await jsonRequest(base, '/api/auth/login', {
      method: 'POST', body: { email: 'known@example.pl', password: 'Niepoprawne123' }
    });
    assert.equal(unknown.response.status, 401);
    assert.equal(wrong.response.status, 401);
    assert.equal(unknown.payload.error?.code, 'INVALID_CREDENTIALS');
    assert.equal(wrong.payload.error?.code, 'INVALID_CREDENTIALS');
    assert.equal(unknown.payload.error?.message, wrong.payload.error?.message);
  });
});

test('account deletion requires current password and invalidates the session after success', async () => {
  await withApp(async base => {
    const cookie = await register(base, 'delete@example.pl');

    const rejected = await jsonRequest(base, '/api/account', {
      method: 'DELETE', cookie, body: { confirmation: 'USUŃ KONTO', password: 'Niepoprawne123' }
    });
    assert.equal(rejected.response.status, 401);
    assert.equal(rejected.payload.error?.code, 'REAUTH_FAILED');

    const stillAuthenticated = await jsonRequest(base, '/api/me', { cookie });
    assert.equal(stillAuthenticated.response.status, 200);

    const deleted = await jsonRequest(base, '/api/account', {
      method: 'DELETE', cookie, body: { confirmation: 'USUŃ KONTO', password: TEST_PASSWORD }
    });
    assert.equal(deleted.response.status, 200);

    const expiredSession = await jsonRequest(base, '/api/me', { cookie });
    assert.equal(expiredSession.response.status, 401);
  });
});
