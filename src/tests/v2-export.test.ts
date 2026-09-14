import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createExtendedJobApp } from '../server/extendedApp.js';

test('V2 export contains later-phase user-owned records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'v2-export-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try {
    const registration = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Export Tester', email: 'export-v2@example.pl', password: ['Bezpieczne', '123'].join(''), acceptTerms: true, acceptPrivacy: true, analyticsConsent: false }) });
    const registered = await registration.json() as { user: { id: string } };
    const cookie = registration.headers.get('set-cookie')?.split(';')[0] ?? '';
    app.db.db.prepare(`INSERT INTO skill_roi_assumptions(user_id,normalized_skill,display_name,estimated_cost,estimated_hours,certification_required,certification_note,updated_at) VALUES(?,?,?,?,?,?,?,?)`).run(registered.user.id, 'excel', 'Excel', 200, 10, 0, null, new Date().toISOString());
    app.db.db.prepare(`INSERT INTO career_transition_explorations(id,user_id,source_role,target_role,confidence,created_at) VALUES(?,?,?,?,?,?)`).run('tr-1', registered.user.id, 'sprzedawca', 'obsługa klienta', 'WCZESNY_SYGNAL', new Date().toISOString());
    const response = await fetch(`${base}/api/export`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown[]>;
    for (const key of ['daily_actions','notification_preferences','notifications','job_source_observations','job_feed_states','effective_wage_preferences','skill_roi_assumptions','learning_sessions','career_transition_explorations','outcome_inbox_suggestions','strategy_decisions','interventions']) assert.ok(Array.isArray(body[key]), `${key} should be exported`);
    assert.equal((body.skill_roi_assumptions ?? []).length, 1);
    assert.equal((body.career_transition_explorations ?? []).length, 1);
    assert.equal('outcome_inbox_items' in body, false);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
