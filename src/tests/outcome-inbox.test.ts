import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { classifyOutcomeMessage } from '../domain/outcomeInbox.js';
import { createExtendedJobApp } from '../server/extendedApp.js';
import { FeatureFlagService } from '../server/featureFlagService.js';
import { parseJobText } from '../domain/jobParser.js';

test('Outcome Inbox classifier returns cautious structured signals without raw message text', () => {
  const interview = classifyOutcomeMessage('Dzień dobry, zapraszamy na rozmowę rekrutacyjną w środę o 10:00.');
  assert.equal(interview?.type, 'INTERVIEW');
  assert.equal(interview?.suggestedStatus, 'INTERVIEW');
  assert.ok((interview?.confidence ?? 0) < 1);
  assert.deepEqual(interview?.evidenceCodes, ['INTERVIEW_INVITATION']);
  assert.equal(classifyOutcomeMessage('Dziękujemy za wiadomość i pozdrawiamy.'), null);
  assert.equal(JSON.stringify(interview).includes('środę'), false);
});

test('Outcome Inbox is feature-gated, does not mutate on analysis, and writes only after user confirmation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'outcome-inbox-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try {
    const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Inbox Tester', email: 'inbox@example.pl', password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false }) });
    const body = await reg.json() as { user: { id: string } };
    const cookie = reg.headers.get('set-cookie')?.split(';')[0] ?? '';
    const raw = 'Specjalista obsługi klienta\nFirma: ABC\nMiejsce pracy: Gdynia\n6000 PLN brutto';
    const jobId = app.store.createJob(body.user.id, raw, parseJobText(raw));
    const applicationId = app.store.createApplication(body.user.id, jobId, 'APPLIED');
    assert.equal((await fetch(`${base}/api/outcome-inbox`, { headers: { cookie } })).status, 404);
    new FeatureFlagService(app.db).set('outcome_inbox', true, 100);
    const messageText = 'Dzień dobry, zapraszamy na rozmowę rekrutacyjną w czwartek. Prosimy o potwierdzenie terminu.';
    const analyzed = await fetch(`${base}/api/outcome-inbox/analyze`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ applicationId, messageText, sourceLabel: 'wiadomość testowa' }) });
    assert.equal(analyzed.status, 201);
    const suggestion = (await analyzed.json()) as { suggestion: { id: string; suggestedStatus: string } };
    assert.equal(suggestion.suggestion.suggestedStatus, 'INTERVIEW');
    assert.equal(app.store.getApplication(body.user.id, applicationId)?.status, 'APPLIED');
    const stored = app.db.db.prepare('SELECT * FROM outcome_inbox_suggestions WHERE id=?').get(suggestion.suggestion.id) as Record<string, unknown>;
    assert.equal(Object.prototype.hasOwnProperty.call(stored, 'raw_text'), false);
    assert.equal(Object.values(stored).includes(messageText), false);
    const confirmed = await fetch(`${base}/api/outcome-inbox/${suggestion.suggestion.id}/confirm`, { method: 'PATCH', headers: { cookie } });
    assert.equal(confirmed.status, 200);
    assert.equal(app.store.getApplication(body.user.id, applicationId)?.status, 'INTERVIEW');
    const outcome = app.db.db.prepare('SELECT source,confirmed_by_user,outcome_type FROM outcomes WHERE application_id=? ORDER BY created_at DESC LIMIT 1').get(applicationId) as unknown as { source: string; confirmed_by_user: number; outcome_type: string };
    assert.equal(outcome.source, 'OUTCOME_INBOX');
    assert.equal(outcome.confirmed_by_user, 1);
    assert.equal(outcome.outcome_type, 'INTERVIEW');
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
