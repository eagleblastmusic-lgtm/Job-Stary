import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createJobApp } from '../server/app.js';
import type { CareerProfile } from '../domain/types.js';

async function jsonRequest<T>(base: string, path: string, options: { method?: string; body?: unknown; cookie?: string } = {}): Promise<{ data: T; cookie?: string }> {
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.cookie ? { cookie: options.cookie } : {}) }
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const response = await fetch(`${base}${path}`, init);
  const data = await response.json() as T;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
  const setCookie = response.headers.get('set-cookie')?.split(';')[0];
  return setCookie ? { data, cookie: setCookie } : { data };
}

test('critical API flow: signup → profile → Career Truth → education → job → Decision → package → application → outcome → export', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-e2e-'));
  const app = createJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const registered = await jsonRequest<{ user: { id: string } }>(base, '/api/auth/register', { method: 'POST', body: { name: 'Jan Kowalski', email: 'jan@example.pl', password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false } });
    assert.ok(registered.cookie);
    const cookie = registered.cookie ?? '';

    const profileRes = await jsonRequest<{ profile: CareerProfile }>(base, '/api/profile', { method: 'PUT', cookie, body: { desiredRoles: ['magazynier'], location: 'Gdynia', commuteKm: 25, remotePreferences: ['ONSITE'], salaryMin: 5500, salaryMode: 'DISCLOSED_ONLY', contractPreferences: ['UOP'], shiftPreferences: { nights: false, weekends: true }, availability: 'od zaraz' } });
    assert.equal(profileRes.data.profile.salaryMode, 'DISCLOSED_ONLY');
    await jsonRequest(base, '/api/career-truth/facts', { method: 'POST', cookie, body: { type: 'CREDENTIAL', value: 'UDT' } });
    await jsonRequest(base, '/api/experiences', { method: 'POST', cookie, body: { employer: 'Magazyn Sp. z o.o.', title: 'Magazynier', startDate: '2024-01', current: true, description: 'Przyjęcie i wydanie towaru', achievements: [] } });
    const education = await jsonRequest<{ education: { id: string; institution: string; field: string | null; degree: string | null; startDate: string | null; endDate: string | null; description: string | null } }>(base, '/api/education', {
      method: 'POST', cookie, body: { institution: 'Zespół Szkół Logistycznych', field: 'Logistyka', degree: 'technik logistyk', startDate: '2019-09', endDate: '2023-06', description: 'Profil magazynowo-logistyczny' }
    });
    assert.equal(education.data.education.institution, 'Zespół Szkół Logistycznych');

    const careerTruth = await jsonRequest<{ education: Array<{ id: string; institution: string; field: string | null; degree: string | null; description: string | null }> }>(base, '/api/career-truth', { cookie });
    assert.equal(careerTruth.data.education.length, 1);
    assert.equal(careerTruth.data.education[0]?.field, 'Logistyka');
    assert.equal(careerTruth.data.education[0]?.degree, 'technik logistyk');

    const parsed = await jsonRequest<{ jobId: string }>(base, '/api/jobs/parse', { method: 'POST', cookie, body: { text: 'Magazynier\nFirma: Logistyka ABC\nMiejsce pracy: Gdynia\nUmowa o pracę\nWynagrodzenie 6000 - 7000 PLN brutto\nWymagania: UDT. Mile widziane WMS.\nPraca stacjonarna.' } });
    const decision = await jsonRequest<{ decisionId: string; decision: { recommendation: string; explanation: { why: string[] } } }>(base, `/api/jobs/${parsed.data.jobId}/decide`, { method: 'POST', cookie, body: {} });
    assert.ok(decision.data.decisionId);
    assert.ok(decision.data.decision.explanation.why.some(x => x.includes('UDT')));

    const pack = await jsonRequest<{ package: { message: string; fitSummary: string; cv: { education: Array<{ institution: string; field: string | null; degree: string | null; description: string | null }> } } }>(base, `/api/jobs/${parsed.data.jobId}/application-package`, { method: 'POST', cookie, body: {} });
    assert.ok(pack.data.package.message.includes('Logistyka ABC'));
    assert.ok(!pack.data.package.message.includes('WMS'));
    assert.equal(pack.data.package.cv.education[0]?.institution, 'Zespół Szkół Logistycznych');
    assert.equal(pack.data.package.cv.education[0]?.description, 'Profil magazynowo-logistyczny');

    const pdfResponse = await fetch(`${base}/api/cv/base.pdf`, { headers: { cookie } });
    assert.equal(pdfResponse.status, 200);
    assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf');
    const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
    assert.equal(new TextDecoder().decode(pdfBytes.slice(0, 4)), '%PDF');

    const created = await jsonRequest<{ applicationId: string }>(base, '/api/applications', { method: 'POST', cookie, body: { jobId: parsed.data.jobId, status: 'APPLIED' } });
    await jsonRequest(base, `/api/applications/${created.data.applicationId}/outcomes`, { method: 'POST', cookie, body: { outcomeType: 'INTERVIEW' } });

    const exported = await jsonRequest<Record<string, unknown>>(base, '/api/export', { cookie });
    assert.ok(Array.isArray(exported.data.applications));
    assert.ok(Array.isArray(exported.data.outcomes));
    assert.ok(Array.isArray(exported.data.consents));
    assert.ok(Array.isArray(exported.data.education));
    const exportedEducation = exported.data.education as Array<{ institution: string; field: string | null; degree: string | null }>;
    assert.equal(exportedEducation[0]?.institution, 'Zespół Szkół Logistycznych');
    assert.equal(exportedEducation[0]?.degree, 'technik logistyk');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});