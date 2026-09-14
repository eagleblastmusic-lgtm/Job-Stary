import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createJobApp } from '../server/app.js';

interface HealthPayload {
  ok: boolean;
  service: string;
  version: string;
  database: string;
  now: string;
}

test('health reports database readiness and degrades to 503 when application schema is unavailable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-health-'));
  const app = createJobApp({
    nodeEnv: 'test',
    port: 0,
    appOrigin: 'http://127.0.0.1',
    dataDir: dir,
    databasePath: join(dir, 'test.sqlite'),
    adminEmails: new Set()
  });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const healthy = await fetch(`${base}/api/health`);
    assert.equal(healthy.status, 200);
    const healthyPayload = await healthy.json() as HealthPayload;
    assert.equal(healthyPayload.ok, true);
    assert.equal(healthyPayload.service, 'job');
    assert.equal(healthyPayload.version, '0.1.0');
    assert.equal(healthyPayload.database, 'ok');
    assert.match(healthyPayload.now, /^\d{4}-\d{2}-\d{2}T/);

    app.db.db.exec('DROP TABLE feature_flags;');

    const degraded = await fetch(`${base}/api/health`);
    assert.equal(degraded.status, 503);
    const degradedPayload = await degraded.json() as HealthPayload;
    assert.equal(degradedPayload.ok, false);
    assert.equal(degradedPayload.service, 'job');
    assert.equal(degradedPayload.version, '0.1.0');
    assert.equal(degradedPayload.database, 'unavailable');
    assert.match(degradedPayload.now, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
