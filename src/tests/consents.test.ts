import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createJobApp } from '../server/app.js';

async function withApp(run: (base: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'job-consents-'));
  const app = createJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}

test('registration requires legal consent and server-generated analytics follow the latest optional consent', async () => {
  await withApp(async base => {
    const missing = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Jan Test', email: 'consent@example.pl', password: 'Bezpieczne123' })
    });
    assert.equal(missing.status, 400);
    const missingBody = await missing.json() as { error: { code: string } };
    assert.equal(missingBody.error.code, 'REQUIRED_CONSENT_MISSING');

    const registered = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Jan Test', email: 'consent@example.pl', password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false })
    });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get('set-cookie')?.split(';')[0] ?? '';
    assert.ok(cookie);

    const listed = await fetch(`${base}/api/consents`, { headers: { cookie } });
    assert.equal(listed.status, 200);
    const initial = await listed.json() as { legalVersion: string; consents: Array<{ type: string; granted: boolean; version: string }> };
    assert.match(initial.legalVersion, /^\d{4}-\d{2}-\d{2}-/);
    assert.equal(initial.consents.find(c => c.type === 'TERMS')?.granted, true);
    assert.equal(initial.consents.find(c => c.type === 'PRIVACY')?.granted, true);
    assert.equal(initial.consents.find(c => c.type === 'ANALYTICS')?.granted, false);
    assert.ok(initial.consents.every(c => c.version === initial.legalVersion));

    const removedEndpoint = await fetch(`${base}/api/events`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ eventName: 'client_event' })
    });
    assert.equal(removedEndpoint.status, 404);

    const beforeExport = await fetch(`${base}/api/export`, { headers: { cookie } });
    const before = await beforeExport.json() as { analytics_events: unknown[] };
    assert.equal(before.analytics_events.length, 0);

    const changed = await fetch(`${base}/api/consents/analytics`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ granted: true })
    });
    assert.equal(changed.status, 200);

    const relisted = await fetch(`${base}/api/consents`, { headers: { cookie } });
    const after = await relisted.json() as { consents: Array<{ type: string; granted: boolean }> };
    assert.equal(after.consents.find(c => c.type === 'ANALYTICS')?.granted, true);

    const profile = await fetch(`${base}/api/profile`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ desiredRoles: ['Magazynier'], location: 'Puck', remotePreferences: [], contractPreferences: [], shiftPreferences: { nights: false, weekends: false } })
    });
    assert.equal(profile.status, 200);

    const afterExport = await fetch(`${base}/api/export`, { headers: { cookie } });
    const exported = await afterExport.json() as { analytics_events: Array<{ event_name: string }> };
    assert.ok(exported.analytics_events.some(event => event.event_name === 'onboarding_completed'));
  });
});