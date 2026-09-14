import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createExtendedJobApp } from '../server/extendedApp.js';

async function register(base: string, email: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Notification Tester', email, password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false })
  });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function postJson<T>(base: string, path: string, cookie: string, body: unknown): Promise<{ response: Response; data: T }> {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  return { response, data: await response.json() as T };
}

test('notifications are useful, configurable, deduplicated, exportable and user-scoped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-notifications-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try {
    const alice = await register(base, 'notify-alice@example.pl');
    const bob = await register(base, 'notify-bob@example.pl');

    const disabled = await fetch(`${base}/api/notifications`, { headers: { cookie: alice } });
    assert.equal(disabled.status, 404);
    assert.equal(((await disabled.json()) as { error: { code: string } }).error.code, 'FEATURE_DISABLED');
    app.db.db.prepare("UPDATE feature_flags SET enabled=1,rollout_percent=100,updated_at=? WHERE key='notifications'").run(new Date().toISOString());

    const preferencesResponse = await fetch(`${base}/api/notifications/preferences`, { headers: { cookie: alice } });
    assert.equal(preferencesResponse.status, 200);
    assert.deepEqual(((await preferencesResponse.json()) as { preferences: unknown }).preferences, { followUp: true, deadlines: true, interviews: true, matchedJobs: true });

    const job = await postJson<{ jobId: string }>(base, '/api/jobs/parse', alice, { text: 'Analityk danych\nFirma: Test Data SA\nMiejsce pracy: Warszawa\nUmowa o pracę\nWymagania: Excel, SQL.\nTermin składania aplikacji: 2099-01-01.' });
    assert.equal(job.response.status, 201);
    const application = await postJson<{ applicationId: string }>(base, '/api/applications', alice, { jobId: job.data.jobId, status: 'APPLIED' });
    assert.equal(application.response.status, 201);
    const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
    app.db.db.prepare('UPDATE applications SET applied_at=?,updated_at=? WHERE id=?').run(old, old, application.data.applicationId);

    const first = await fetch(`${base}/api/notifications`, { headers: { cookie: alice } });
    assert.equal(first.status, 200);
    const firstData = (await first.json()) as { notifications: Array<{ id: string; type: string; message: string }> };
    const followUp = firstData.notifications.find(item => item.type === 'FOLLOW_UP');
    assert.ok(followUp);
    assert.match(followUp.message, /7 dni/);
    assert.equal(firstData.notifications.some(item => item.type === 'INTERVIEW'), false, 'stage without an interview date must not fabricate a reminder');

    const second = await fetch(`${base}/api/notifications`, { headers: { cookie: alice } });
    assert.equal(((await second.json()) as { notifications: unknown[] }).notifications.length, firstData.notifications.length, 'refresh must deduplicate the same reminder');

    const exported = await fetch(`${base}/api/export`, { headers: { cookie: alice } });
    assert.equal(exported.status, 200);
    const exportedData = await exported.json() as Record<string, unknown>;
    assert.ok(Array.isArray(exportedData.daily_actions));
    assert.ok(Array.isArray(exportedData.notification_preferences));
    assert.equal((exportedData.notifications as unknown[]).length, 1);

    const foreign = await fetch(`${base}/api/notifications/${followUp.id}/read`, { method: 'PATCH', headers: { cookie: bob } });
    assert.equal(foreign.status, 404);
    const ownRead = await fetch(`${base}/api/notifications/${followUp.id}/read`, { method: 'PATCH', headers: { cookie: alice } });
    assert.equal(ownRead.status, 200);

    const settings = await fetch(`${base}/api/notifications/preferences`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ followUp: false, deadlines: false, interviews: false, matchedJobs: false })
    });
    assert.equal(settings.status, 200);
    const settingsBody = (await settings.json()) as { preferences: { followUp: boolean; deadlines: boolean } };
    assert.equal(settingsBody.preferences.followUp, false);
    assert.equal(settingsBody.preferences.deadlines, false);

    const dismissed = await fetch(`${base}/api/notifications/${followUp.id}/dismiss`, { method: 'PATCH', headers: { cookie: alice } });
    assert.equal(dismissed.status, 200);
    const afterDismiss = await fetch(`${base}/api/notifications`, { headers: { cookie: alice } });
    assert.equal(((await afterDismiss.json()) as { notifications: unknown[] }).notifications.length, 0);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
