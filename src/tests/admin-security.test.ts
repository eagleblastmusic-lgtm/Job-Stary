import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { createJobApp } from '../server/app.js';

const execFileAsync = promisify(execFile);

test('public registration cannot self-assign ADMIN and local provisioning is required', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-admin-security-'));
  const databasePath = join(dir, 'test.sqlite');
  const app = createJobApp({
    nodeEnv: 'test',
    port: 0,
    appOrigin: 'http://127.0.0.1',
    dataDir: dir,
    databasePath,
    adminEmails: new Set(['admin@example.pl'])
  });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const registered = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Admin Candidate',
        email: 'admin@example.pl',
        password: 'Bezpieczne123',
        acceptTerms: true,
        acceptPrivacy: true,
        analyticsConsent: false
      })
    });
    assert.equal(registered.status, 201);
    const registeredBody = await registered.json() as { user: { role: string } };
    assert.equal(registeredBody.user.role, 'USER');
    const cookie = registered.headers.get('set-cookie')?.split(';')[0] ?? '';
    assert.ok(cookie);

    const denied = await fetch(`${base}/api/admin/diagnostics`, { headers: { cookie } });
    assert.equal(denied.status, 403);

    const provisioned = await execFileAsync(process.execPath, ['scripts/provision-admin.mjs', 'admin@example.pl'], {
      cwd: process.cwd(),
      env: { ...process.env, DATA_DIR: dir, DATABASE_PATH: databasePath }
    });
    assert.match(provisioned.stdout, /ADMIN_PROVISIONED admin@example\.pl/);

    const me = await fetch(`${base}/api/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    const meBody = await me.json() as { user: { role: string } };
    assert.equal(meBody.user.role, 'ADMIN');

    const allowed = await fetch(`${base}/api/admin/diagnostics`, { headers: { cookie } });
    assert.equal(allowed.status, 200);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
