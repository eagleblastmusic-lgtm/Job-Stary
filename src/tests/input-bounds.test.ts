import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createJobApp } from '../server/app.js';

async function withApp(run: (base: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'job-input-bounds-'));
  const app = createJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}

async function register(base: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Limit Tester', email: `limits-${crypto.randomUUID()}@example.pl`, password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false })
  });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function errorCode(response: Response): Promise<string | undefined> {
  const payload = await response.json() as { error?: { code?: string } };
  return payload.error?.code;
}

test('ordinary JSON endpoints reject bodies above the 64 KiB default before credential work', async () => {
  await withApp(async base => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'oversized@example.pl', password: 'Bezpieczne123', padding: 'x'.repeat(70_000) })
    });
    assert.equal(response.status, 413);
    assert.equal(await errorCode(response), 'PAYLOAD_TOO_LARGE');
  });
});

test('job paste has an explicit larger body budget but bounded text length and minimum useful length', async () => {
  await withApp(async base => {
    const cookie = await register(base);
    const tooLong = await fetch(`${base}/api/jobs/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: 'A'.repeat(100_001) })
    });
    assert.equal(tooLong.status, 400);
    assert.equal(await errorCode(tooLong), 'FIELD_TOO_LONG');

    const tooShort = await fetch(`${base}/api/jobs/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: 'Za krótka oferta' })
    });
    assert.equal(tooShort.status, 400);
    assert.equal(await errorCode(tooShort), 'VALIDATION_ERROR');
  });
});

test('profile, Career Truth, experience and education fields are bounded before SQLite writes', async () => {
  await withApp(async base => {
    const cookie = await register(base);

    const profile = await fetch(`${base}/api/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ desiredRoles: Array.from({ length: 21 }, (_, index) => `Rola ${index}`) })
    });
    assert.equal(profile.status, 400);
    assert.equal(await errorCode(profile), 'TOO_MANY_ITEMS');

    const fact = await fetch(`${base}/api/career-truth/facts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'SKILL', value: 'x'.repeat(501) })
    });
    assert.equal(fact.status, 400);
    assert.equal(await errorCode(fact), 'FIELD_TOO_LONG');

    const experience = await fetch(`${base}/api/experiences`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ employer: 'Firma', title: 'Specjalista', current: false, description: 'x'.repeat(10_001), achievements: [] })
    });
    assert.equal(experience.status, 400);
    assert.equal(await errorCode(experience), 'FIELD_TOO_LONG');

    const education = await fetch(`${base}/api/education`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ institution: 'x'.repeat(201), field: 'Logistyka', degree: 'technik logistyk' })
    });
    assert.equal(education.status, 400);
    assert.equal(await errorCode(education), 'FIELD_TOO_LONG');
  });
});