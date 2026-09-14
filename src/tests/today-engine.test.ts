import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { rankActions, type ActionCandidate } from '../domain/actionPriority.js';
import { createExtendedJobApp } from '../server/extendedApp.js';

const candidates: ActionCandidate[] = [
  { key: 'a', type: 'APPLY', title: 'A', reason: 'A', estimatedMinutes: 10, opportunityValue: 1, urgency: 1, confidence: 1, expectedProgress: 1, payload: {} },
  { key: 'b', type: 'FOLLOW_UP', title: 'B', reason: 'B', estimatedMinutes: 10, opportunityValue: 0.8, urgency: 1.2, confidence: 1, expectedProgress: 0.8, payload: {} },
  { key: 'c', type: 'PREPARE_CV', title: 'C', reason: 'C', estimatedMinutes: 10, opportunityValue: 0.6, urgency: 1, confidence: 1, expectedProgress: 0.7, payload: {} },
  { key: 'd', type: 'LEARN', title: 'D', reason: 'D', estimatedMinutes: 10, opportunityValue: 0.5, urgency: 1, confidence: 1, expectedProgress: 0.5, payload: {} }
];

test('Action Priority respects time budget and maximum three primary actions', () => {
  const ranked = rankActions(candidates, 30);
  assert.equal(ranked.length, 3);
  assert.ok(ranked.reduce((sum, item) => sum + item.estimatedMinutes, 0) <= 30);
  assert.equal(ranked[0]?.key, 'a');
  assert.deepEqual(rankActions(candidates, 10).map(item => item.key), ['a']);
});

async function register(base: string, email: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Today Tester', email, password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false })
  });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

test('Today is fail-closed behind feature flag and isolates actions between users', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-today-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const alice = await register(base, 'today-alice@example.pl');
    const bob = await register(base, 'today-bob@example.pl');

    const featuresBefore = await fetch(`${base}/api/features`, { headers: { cookie: alice } });
    assert.equal(featuresBefore.status, 200);
    assert.equal(((await featuresBefore.json()) as { features: { today: boolean } }).features.today, false);

    const disabled = await fetch(`${base}/api/today`, { headers: { cookie: alice } });
    assert.equal(disabled.status, 404);
    assert.equal(((await disabled.json()) as { error: { code: string } }).error.code, 'FEATURE_DISABLED');

    app.db.db.prepare("UPDATE feature_flags SET enabled=1, rollout_percent=100, updated_at=? WHERE key='today'").run(new Date().toISOString());

    const invalid = await fetch(`${base}/api/today/recommendations`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: alice }, body: JSON.stringify({ timeBudgetMinutes: 25 })
    });
    assert.equal(invalid.status, 400);

    const recommended = await fetch(`${base}/api/today/recommendations`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: alice }, body: JSON.stringify({ timeBudgetMinutes: 30 })
    });
    assert.equal(recommended.status, 200);
    const payload = (await recommended.json()) as { actions: Array<{ id: string; type: string; accepted: boolean; completed: boolean }> };
    assert.ok(payload.actions.length >= 1 && payload.actions.length <= 3);
    assert.equal(payload.actions[0]?.type, 'PREPARE_CV');
    const actionId = payload.actions[0]?.id ?? '';

    const foreign = await fetch(`${base}/api/today/actions/${actionId}/accept`, { method: 'PATCH', headers: { cookie: bob } });
    assert.equal(foreign.status, 404);

    const accepted = await fetch(`${base}/api/today/actions/${actionId}/accept`, { method: 'PATCH', headers: { cookie: alice } });
    assert.equal(accepted.status, 200);
    assert.equal(((await accepted.json()) as { action: { accepted: boolean } }).action.accepted, true);

    const completed = await fetch(`${base}/api/today/actions/${actionId}/complete`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie: alice }, body: JSON.stringify({ outcome: 'CV sprawdzone' })
    });
    assert.equal(completed.status, 200);
    const completedAction = ((await completed.json()) as { action: { completed: boolean; outcome: string | null } }).action;
    assert.equal(completedAction.completed, true);
    assert.equal(completedAction.outcome, 'CV sprawdzone');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
