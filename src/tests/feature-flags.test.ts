import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { featureEnabledForContext, rolloutBucket } from '../domain/featureFlags.js';
import { JobDatabase } from '../server/db.js';
import { FeatureFlagService } from '../server/featureFlagService.js';

const execFileAsync = promisify(execFile);

test('feature rollout is deterministic, admin-internal at 0%, and fail-closed when disabled', () => {
  const first = rolloutBucket('user-123', 'today');
  const second = rolloutBucket('user-123', 'today');
  assert.equal(first, second);
  assert.ok(first >= 0 && first < 100);

  assert.equal(featureEnabledForContext({ key: 'today', enabled: false, rolloutPercent: 100 }, { userId: 'admin', role: 'ADMIN' }), false);
  assert.equal(featureEnabledForContext({ key: 'today', enabled: true, rolloutPercent: 0 }, { userId: 'admin', role: 'ADMIN' }), true);
  assert.equal(featureEnabledForContext({ key: 'today', enabled: true, rolloutPercent: 0 }, { userId: 'user', role: 'USER' }), false);
  assert.equal(featureEnabledForContext({ key: 'today', enabled: true, rolloutPercent: 100 }, { userId: 'user', role: 'USER' }), true);
});

test('feature flag service persists controlled rollout levels and supports immediate rollback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-feature-flags-'));
  const databasePath = join(dir, 'test.sqlite');
  const db = new JobDatabase(databasePath);
  try {
    const flags = new FeatureFlagService(db);
    const initial = flags.get('today');
    assert.equal(initial.enabled, false);
    assert.equal(initial.rolloutPercent, 0);
    assert.equal(flags.isEnabled('today', { userId: 'user-a', role: 'USER' }), false);

    flags.set('today', true, 0);
    assert.equal(flags.isEnabled('today', { userId: 'admin-a', role: 'ADMIN' }), true);
    assert.equal(flags.isEnabled('today', { userId: 'user-a', role: 'USER' }), false);

    flags.set('today', true, 100);
    assert.equal(flags.isEnabled('today', { userId: 'user-a', role: 'USER' }), true);

    flags.set('today', false, 100);
    assert.equal(flags.isEnabled('today', { userId: 'admin-a', role: 'ADMIN' }), false);
    assert.equal(flags.isEnabled('today', { userId: 'user-a', role: 'USER' }), false);
    assert.throws(() => flags.set('today', true, 25 as never), /0, 10, 50 albo 100/);
  } finally {
    db.close();
  }

  const cli = await execFileAsync(process.execPath, ['scripts/set-feature-flag.mjs', 'today', 'on', '10'], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: dir, DATABASE_PATH: databasePath }
  });
  assert.match(cli.stdout, /FEATURE_FLAG_UPDATED today enabled=true rollout=10/);

  const verification = new JobDatabase(databasePath);
  try {
    const flags = new FeatureFlagService(verification);
    const today = flags.get('today');
    assert.equal(today.enabled, true);
    assert.equal(today.rolloutPercent, 10);
    const audit = verification.db.prepare("SELECT action,entity_id,metadata FROM audit_logs WHERE action='FEATURE_FLAG_UPDATED_OUT_OF_BAND' ORDER BY created_at DESC LIMIT 1").get() as { action: string; entity_id: string; metadata: string } | undefined;
    assert.equal(audit?.entity_id, 'today');
    assert.match(audit?.metadata ?? '', /\"rolloutPercent\":10/);
  } finally {
    verification.close();
    await rm(dir, { recursive: true, force: true });
  }
});
