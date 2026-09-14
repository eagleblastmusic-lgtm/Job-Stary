import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createJobApp } from '../server/app.js';

interface PublicError { code: string | undefined; message: string | undefined }

async function withApp(run: (base: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'job-career-corrections-'));
  const app = createJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}

async function register(base: string, email: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Career Truth Tester', email, password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false })
  });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function post(base: string, path: string, cookie: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
}

async function remove(base: string, path: string, cookie: string): Promise<Response> {
  return fetch(`${base}${path}`, { method: 'DELETE', headers: { cookie } });
}

async function publicError(response: Response): Promise<PublicError | undefined> {
  const payload = await response.json() as { error?: { code?: string; message?: string } };
  return payload.error ? { code: payload.error.code, message: payload.error.message } : undefined;
}

test('foreign and nonexistent Career Truth records expose the same 404 delete contracts', async () => {
  await withApp(async base => {
    const alice = await register(base, 'correction-alice@example.pl');
    const bob = await register(base, 'correction-bob@example.pl');

    const factResponse = await post(base, '/api/career-truth/facts', alice, { type: 'SKILL', value: 'Excel' });
    const experienceResponse = await post(base, '/api/experiences', alice, { employer: 'Firma A', title: 'Specjalista', current: true, achievements: [] });
    const educationResponse = await post(base, '/api/education', alice, { institution: 'Politechnika Gdańska', field: 'Logistyka' });
    assert.equal(factResponse.status, 201); assert.equal(experienceResponse.status, 201); assert.equal(educationResponse.status, 201);

    const factId = ((await factResponse.json()) as { fact: { id: string } }).fact.id;
    const experienceId = ((await experienceResponse.json()) as { experience: { id: string } }).experience.id;
    const educationId = ((await educationResponse.json()) as { education: { id: string } }).education.id;

    const cases = [
      { path: '/api/career-truth/facts/', ownedId: factId },
      { path: '/api/experiences/', ownedId: experienceId },
      { path: '/api/education/', ownedId: educationId }
    ];

    for (const item of cases) {
      const foreign = await remove(base, `${item.path}${item.ownedId}`, bob);
      const missing = await remove(base, `${item.path}${randomUUID()}`, bob);
      assert.equal(foreign.status, 404);
      assert.equal(missing.status, 404);
      const foreignError = await publicError(foreign);
      const missingError = await publicError(missing);
      assert.deepEqual(foreignError, missingError);
      assert.equal(foreignError?.code, 'NOT_FOUND');
    }

    const aliceTruth = await fetch(`${base}/api/career-truth`, { headers: { cookie: alice } });
    const truth = await aliceTruth.json() as { facts: unknown[]; experiences: unknown[]; education: unknown[] };
    assert.equal(truth.facts.length, 1);
    assert.equal(truth.experiences.length, 1);
    assert.equal(truth.education.length, 1);
  });
});

test('owner can remove Career Truth records and removed data no longer enters the Application Package CV', async () => {
  await withApp(async base => {
    const cookie = await register(base, 'correction-owner@example.pl');
    const factResponse = await post(base, '/api/career-truth/facts', cookie, { type: 'CREDENTIAL', value: 'UDT' });
    const experienceResponse = await post(base, '/api/experiences', cookie, { employer: 'Magazyn A', title: 'Magazynier', startDate: '2024-01', endDate: '2025-01', current: true, description: 'Obsługa magazynu', achievements: [] });
    const educationResponse = await post(base, '/api/education', cookie, { institution: 'Szkoła Logistyczna', field: 'Logistyka', degree: 'technik' });
    const factId = ((await factResponse.json()) as { fact: { id: string } }).fact.id;
    const experience = (await experienceResponse.json()) as { experience: { id: string; current: boolean; endDate: string | null } };
    const educationId = ((await educationResponse.json()) as { education: { id: string } }).education.id;

    assert.equal(experience.experience.current, true);
    assert.equal(experience.experience.endDate, null, 'current employment must clear endDate at the API boundary');

    assert.equal((await remove(base, `/api/career-truth/facts/${factId}`, cookie)).status, 200);
    assert.equal((await remove(base, `/api/experiences/${experience.experience.id}`, cookie)).status, 200);
    assert.equal((await remove(base, `/api/education/${educationId}`, cookie)).status, 200);

    const truthResponse = await fetch(`${base}/api/career-truth`, { headers: { cookie } });
    const truth = await truthResponse.json() as { facts: unknown[]; experiences: unknown[]; education: unknown[] };
    assert.deepEqual(truth, { facts: [], experiences: [], education: [] });

    const job = await post(base, '/api/jobs/parse', cookie, { text: 'Magazynier\nFirma: ABC\nMiejsce pracy: Gdynia\nWymagania: UDT i doświadczenie magazynowe.' });
    assert.equal(job.status, 201);
    const jobId = ((await job.json()) as { jobId: string }).jobId;
    const packResponse = await post(base, `/api/jobs/${jobId}/application-package`, cookie, {});
    assert.equal(packResponse.status, 200);
    const pack = await packResponse.json() as { package: { cv: { facts: unknown[]; experiences: unknown[]; education: unknown[] } } };
    assert.equal(pack.package.cv.facts.length, 0);
    assert.equal(pack.package.cv.experiences.length, 0);
    assert.equal(pack.package.cv.education.length, 0);
  });
});
