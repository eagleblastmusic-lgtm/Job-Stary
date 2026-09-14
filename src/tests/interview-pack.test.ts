import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildInterviewPack } from '../domain/interviewPack.js';
import type { CareerFact, ParsedJob } from '../domain/types.js';
import { createExtendedJobApp } from '../server/extendedApp.js';
import { FeatureFlagService } from '../server/featureFlagService.js';

const baseJob: ParsedJob = {
  title: 'Magazynier', normalizedTitle: 'magazynier', company: 'Logistyka ABC', location: 'Gdynia', remoteType: 'ONSITE', contractType: 'UOP',
  salaryMin: 6000, salaryMax: 7000, salaryPeriod: 'MONTH', grossNet: 'GROSS', workingHours: null, shiftPattern: null, nightWork: null, weekendWork: null,
  travelRequired: null, applicationMethod: null, deadline: null, publishedAt: null, fingerprint: 'job-fingerprint',
  requirements: [
    { type: 'CREDENTIAL', canonicalRequirement: 'UDT', importance: 'MUST_HAVE', confidence: 0.95, provenance: 'test' },
    { type: 'TOOL', canonicalRequirement: 'WMS', importance: 'NICE_TO_HAVE', confidence: 0.9, provenance: 'test' }
  ]
};

function fact(id: string, value: string, status: CareerFact['status']): CareerFact {
  return { id, type: 'SKILL', value, normalizedValue: value.toLowerCase(), level: null, source: status === 'INFERRED' ? 'CV' : 'USER', status, confidence: status === 'CONFIRMED' ? 1 : 0.7, evidence: null, allowedForCv: status === 'CONFIRMED' };
}

test('Interview Pack uses confirmed Career Truth, keeps unknowns explicit and never promotes inferred facts', () => {
  const pack = buildInterviewPack({
    job: baseJob,
    facts: [fact('confirmed', 'UDT', 'CONFIRMED'), fact('inferred', 'WMS', 'INFERRED'), fact('other-inferred', 'Sekretna umiejętność', 'INFERRED')],
    experiences: [{ id: 'exp', employer: 'Magazyn A', title: 'Magazynier', normalizedTitle: 'magazynier', startDate: '2024-01', endDate: null, current: true, description: null, achievements: [] }],
    education: [],
    profile: { desiredRoles: ['magazynier'], location: 'Gdynia', commuteKm: 25, remotePreferences: ['ONSITE'], salaryMin: 5500, contractPreferences: ['UOP'], shiftPreferences: { nights: null, weekends: null }, availability: 'od zaraz' }
  });

  assert.match(pack.strongestArguments.join(' '), /Potwierdzone w Career Truth: UDT/);
  assert.match(pack.strongestArguments.join(' '), /Magazynier w Magazyn A/);
  assert.match(pack.potentialGaps.join(' '), /Nie mamy potwierdzenia w Career Truth: WMS/);
  assert.doesNotMatch(JSON.stringify(pack), /Sekretna umiejętność/);
  assert.match(pack.truthBoundary, /Nie tworzy doświadczeń ani osiągnięć/);
  assert.ok(pack.answerFrameworks.every(item => item.framework.some(line => /nie wymyślaj|bez dopisywania/i.test(line))));
});

async function register(base: string, email: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Interview Tester', email, password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false })
  });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function postJson(base: string, path: string, cookie: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
}

test('Interview Pack API is feature-gated and exposes the same 404 for foreign and nonexistent applications', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-interview-pack-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const alice = await register(base, 'interview-alice@example.pl');
    const bob = await register(base, 'interview-bob@example.pl');
    const jobResponse = await postJson(base, '/api/jobs/parse', alice, { text: 'Magazynier\nFirma: Logistyka ABC\nMiejsce pracy: Gdynia\nUmowa o pracę\n6000 - 7000 PLN brutto\nWymagania: UDT. Mile widziane WMS.' });
    assert.equal(jobResponse.status, 201);
    const jobId = ((await jobResponse.json()) as { jobId: string }).jobId;
    const applicationResponse = await postJson(base, '/api/applications', alice, { jobId, status: 'INTERVIEW' });
    assert.equal(applicationResponse.status, 201);
    const applicationId = ((await applicationResponse.json()) as { applicationId: string }).applicationId;

    const disabled = await fetch(`${base}/api/applications/${applicationId}/interview-pack`, { headers: { cookie: alice } });
    assert.equal(disabled.status, 404);
    assert.equal(((await disabled.json()) as { error: { code: string } }).error.code, 'FEATURE_DISABLED');

    new FeatureFlagService(app.db).set('interview_pack', true, 100);
    const own = await fetch(`${base}/api/applications/${applicationId}/interview-pack`, { headers: { cookie: alice } });
    assert.equal(own.status, 200);
    const ownPack = ((await own.json()) as { pack: { truthBoundary: string; companySummary: string } }).pack;
    assert.match(ownPack.truthBoundary, /wyłącznie zapisanej oferty/);
    assert.match(ownPack.companySummary, /Logistyka ABC/);

    const errors: Array<{ code: string; message: string }> = [];
    for (const id of [applicationId, randomUUID()]) {
      const response = await fetch(`${base}/api/applications/${id}/interview-pack`, { headers: { cookie: bob } });
      assert.equal(response.status, 404);
      errors.push(((await response.json()) as { error: { code: string; message: string } }).error);
    }
    assert.deepEqual({ code: errors[0]?.code, message: errors[0]?.message }, { code: errors[1]?.code, message: errors[1]?.message });
    assert.equal(errors[0]?.code, 'NOT_FOUND');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
