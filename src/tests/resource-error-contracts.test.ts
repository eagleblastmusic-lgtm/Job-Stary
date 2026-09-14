import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createJobApp } from '../server/app.js';

interface ApiError { error?: { code?: string; message?: string; requestId?: string } }
interface PublicError { code: string | undefined; message: string | undefined }

async function withApp(run: (base: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'job-resource-errors-'));
  const app = createJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}

async function register(base: string, email: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Resource Tester', email, password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false })
  });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function readError(response: Response): Promise<PublicError | undefined> {
  const error = ((await response.json()) as ApiError).error;
  return error ? { code: error.code, message: error.message } : undefined;
}

async function postJson(base: string, path: string, cookie: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
}

test('foreign and nonexistent Career Truth facts expose the same 404 contract', async () => {
  await withApp(async base => {
    const alice = await register(base, 'resource-alice@example.pl');
    const bob = await register(base, 'resource-bob@example.pl');
    const created = await postJson(base, '/api/career-truth/facts', alice, { type: 'SKILL', value: 'Excel' });
    assert.equal(created.status, 201);
    const factId = ((await created.json()) as { fact: { id: string } }).fact.id;

    const responses: Response[] = [];
    for (const id of [factId, randomUUID()]) {
      responses.push(await fetch(`${base}/api/career-truth/facts/${id}/status`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', cookie: bob }, body: JSON.stringify({ status: 'CONFIRMED' })
      }));
    }

    const errors = [];
    for (const response of responses) {
      assert.equal(response.status, 404);
      errors.push(await readError(response));
    }
    assert.deepEqual(errors[0], errors[1]);
    assert.equal(errors[0]?.code, 'NOT_FOUND');
  });
});

test('foreign and nonexistent decisions expose the same 404 override contract', async () => {
  await withApp(async base => {
    const alice = await register(base, 'decision-alice@example.pl');
    const bob = await register(base, 'decision-bob@example.pl');
    const job = await postJson(base, '/api/jobs/parse', alice, { text: 'Magazynier\nFirma: ABC\nMiejsce pracy: Gdynia\nWymagania: UDT i praca zmianowa.' });
    assert.equal(job.status, 201);
    const jobId = ((await job.json()) as { jobId: string }).jobId;
    const decision = await fetch(`${base}/api/jobs/${jobId}/decide`, { method: 'POST', headers: { cookie: alice } });
    assert.equal(decision.status, 200);
    const decisionId = ((await decision.json()) as { decisionId: string }).decisionId;

    const errors = [];
    for (const id of [decisionId, randomUUID()]) {
      const response = await postJson(base, `/api/decisions/${id}/override`, bob, { override: 'APPLY', reason: 'Test' });
      assert.equal(response.status, 404);
      errors.push(await readError(response));
    }
    assert.deepEqual(errors[0], errors[1]);
    assert.equal(errors[0]?.code, 'NOT_FOUND');
  });
});

test('invalid application transition is a controlled 400 and does not mutate status', async () => {
  await withApp(async base => {
    const cookie = await register(base, 'transition@example.pl');
    const job = await postJson(base, '/api/jobs/parse', cookie, { text: 'Specjalista IT\nFirma: ABC\nMiejsce pracy: Gdańsk\nWymagania: JavaScript i Git.' });
    assert.equal(job.status, 201);
    const jobId = ((await job.json()) as { jobId: string }).jobId;
    const application = await postJson(base, '/api/applications', cookie, { jobId, status: 'SAVED' });
    assert.equal(application.status, 201);
    const applicationId = ((await application.json()) as { applicationId: string }).applicationId;

    const invalid = await fetch(`${base}/api/applications/${applicationId}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ status: 'OFFER' })
    });
    assert.equal(invalid.status, 400);
    const error = await readError(invalid);
    assert.equal(error?.code, 'INVALID_STATUS_TRANSITION');

    const list = await fetch(`${base}/api/applications`, { headers: { cookie } });
    assert.equal(list.status, 200);
    const applications = ((await list.json()) as { applications: Array<{ id: string; status: string }> }).applications;
    assert.equal(applications.find(item => item.id === applicationId)?.status, 'SAVED');
  });
});

test('foreign and nonexistent applications expose the same 404 outcome contract', async () => {
  await withApp(async base => {
    const alice = await register(base, 'outcome-alice@example.pl');
    const bob = await register(base, 'outcome-bob@example.pl');
    const job = await postJson(base, '/api/jobs/parse', alice, { text: 'Operator produkcji\nFirma: ABC\nMiejsce pracy: Gdynia\nWymagania: praca zmianowa.' });
    assert.equal(job.status, 201);
    const jobId = ((await job.json()) as { jobId: string }).jobId;
    const application = await postJson(base, '/api/applications', alice, { jobId, status: 'APPLIED' });
    assert.equal(application.status, 201);
    const applicationId = ((await application.json()) as { applicationId: string }).applicationId;

    const errors = [];
    for (const id of [applicationId, randomUUID()]) {
      const response = await postJson(base, `/api/applications/${id}/outcomes`, bob, { outcomeType: 'INTERVIEW' });
      assert.equal(response.status, 404);
      errors.push(await readError(response));
    }
    assert.deepEqual(errors[0], errors[1]);
    assert.equal(errors[0]?.code, 'NOT_FOUND');
  });
});
