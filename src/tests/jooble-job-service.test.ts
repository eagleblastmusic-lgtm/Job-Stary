import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExtendedJobApp } from '../server/extendedApp.js';
import { JoobleJobIngestionService } from '../server/joobleJobService.js';

async function makeFixture(email: string) {
  const dir = await mkdtemp(join(tmpdir(), 'job-jooble-'));
  const app = createExtendedJobApp({
    nodeEnv: 'test',
    port: 0,
    appOrigin: 'http://127.0.0.1',
    dataDir: dir,
    databasePath: join(dir, 'test.sqlite'),
    adminEmails: new Set()
  });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const user = app.store.createUser({
    email,
    name: 'Jooble Tester',
    passwordHash: 'test-hash',
    role: 'USER'
  });
  return { dir, app, userId: user.id };
}

test('Jooble official API maps a Polish search into the existing feed and rounds radius to a supported value', async () => {
  const { dir, app, userId } = await makeFixture('jooble-success@example.pl');
  let requestedUrl = '';
  let requestedBody: Record<string, unknown> = {};
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requestedUrl = String(input);
    requestedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(JSON.stringify({
      totalCount: 1,
      jobs: [{
        id: 123,
        title: 'Magazynier',
        location: 'Puck',
        snippet: 'Obsługa magazynu i uprawnienia UDT.',
        salary: '6200 - 7000 PLN',
        source: 'Pracuj.pl',
        type: 'Pełny etat',
        link: 'https://pl.jooble.org/jdp/123',
        company: 'Port Logistics',
        updated: '2026-09-13T10:00:00Z'
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const service = new JoobleJobIngestionService(app.db, app.store, 'test-polish-key', 1000, fakeFetch);
    const result = await service.refresh(userId, { query: 'magazynier-jooble-success', location: 'Puck', radiusKm: 30 });
    assert.equal(result.status, 'IMPORTED');
    assert.equal(result.fetchedCount, 1);
    assert.equal(result.canonicalCount, 1);
    assert.match(requestedUrl, /^https:\/\/pl\.jooble\.org\/api\/test-polish-key$/);
    assert.equal(requestedBody.keywords, 'magazynier-jooble-success');
    assert.equal(requestedBody.location, 'Puck');
    assert.equal(requestedBody.radius, '40');
    assert.equal(requestedBody.ResultOnPage, 50);

    const jobs = app.db.db.prepare('SELECT title,company,location,source,source_url FROM jobs WHERE user_id=?').all(userId) as unknown as Array<Record<string, unknown>>;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.company, 'Port Logistics');
    assert.equal(jobs[0]?.location, 'Puck');
    assert.equal(jobs[0]?.source, 'JOOBLE_PL');
    assert.equal(jobs[0]?.source_url, 'https://pl.jooble.org/jdp/123');

    const observation = app.db.db.prepare("SELECT provenance FROM job_source_observations WHERE user_id=? AND source_key='jooble_pl'").get(userId) as { provenance: string } | undefined;
    assert.ok(observation);
    assert.doesNotMatch(observation.provenance, /test-polish-key/);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Jooble integration stays disabled without a configured API key and makes no network request', async () => {
  const { dir, app, userId } = await makeFixture('jooble-disabled@example.pl');
  let calls = 0;
  const fakeFetch = async (): Promise<Response> => {
    calls += 1;
    throw new Error('network must not be called');
  };
  try {
    const service = new JoobleJobIngestionService(app.db, app.store, null, 1000, fakeFetch);
    const result = await service.refresh(userId, { query: 'magazynier-jooble-disabled', location: 'Puck', radiusKm: 16 });
    assert.equal(result.status, 'DISABLED');
    assert.equal(calls, 0);
    assert.match(result.message, /JOOBLE_API_KEY_PL/);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Jooble API failure is isolated and does not fabricate results', async () => {
  const { dir, app, userId } = await makeFixture('jooble-failure@example.pl');
  const fakeFetch = async (): Promise<Response> => new Response('forbidden', { status: 403 });
  try {
    const service = new JoobleJobIngestionService(app.db, app.store, 'rejected-key', 1000, fakeFetch);
    const result = await service.refresh(userId, { query: 'magazynier-jooble-failure', location: 'Puck', radiusKm: 8 });
    assert.equal(result.status, 'FAILED');
    assert.equal(result.fetchedCount, 0);
    assert.equal(result.canonicalCount, 0);
    assert.match(result.message, /odrzucił klucz API/i);
    const count = app.db.db.prepare('SELECT COUNT(*) count FROM jobs WHERE user_id=?').get(userId) as { count: number };
    assert.equal(count.count, 0);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
