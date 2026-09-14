import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createExtendedJobApp } from '../server/extendedApp.js';
import { FeatureFlagService } from '../server/featureFlagService.js';

async function register(base: string, email: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Feed Tester', email, password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false })
  });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function requestJson(base: string, path: string, cookie: string, method: string, body?: Record<string, unknown>): Promise<Response> {
  const init: RequestInit = { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), cookie } };
  if (body) init.body = JSON.stringify(body);
  return fetch(`${base}${path}`, init);
}

const offer = `Magazynier
Firma: Logistyka ABC
Miejsce pracy: Gdynia
Umowa o pracę
Wynagrodzenie: 6000 - 7200 PLN brutto
Wymagania: UDT, WMS
Praca stacjonarna.`;

test('Job Feed is feature-gated, deduplicates URL/identity, tracks reposts and isolates user state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-feed-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const alice = await register(base, 'feed-alice@example.pl');
    const bob = await register(base, 'feed-bob@example.pl');

    const disabled = await requestJson(base, '/api/job-feed', alice, 'GET');
    assert.equal(disabled.status, 404);
    assert.equal(((await disabled.json()) as { error: { code: string } }).error.code, 'FEATURE_DISABLED');

    new FeatureFlagService(app.db).set('job_feed', true, 100);

    const first = await requestJson(base, '/api/job-feed/import-user', alice, 'POST', {
      rawText: offer, sourceUrl: 'https://jobs.example.pl/offer/123?utm_source=test', publishedAt: '2026-09-01T12:00:00.000Z'
    });
    assert.equal(first.status, 201);
    const firstBody = (await first.json()) as { results: Array<{ jobId: string; relation: string; dedupeStage: string; createdCanonicalJob: boolean }>; jobs: Array<{ jobId: string }> };
    assert.equal(firstBody.results[0]?.relation, 'CANONICAL');
    assert.equal(firstBody.results[0]?.dedupeStage, 'UNIQUE');
    assert.equal(firstBody.results[0]?.createdCanonicalJob, true);
    const jobId = firstBody.results[0]?.jobId ?? '';
    assert.equal(firstBody.jobs.length, 1);

    const exactDuplicate = await requestJson(base, '/api/job-feed/import-user', alice, 'POST', {
      rawText: offer, sourceUrl: 'https://jobs.example.pl/offer/123?utm_campaign=again', publishedAt: '2026-09-01T12:00:00.000Z'
    });
    assert.equal(exactDuplicate.status, 201);
    const exactResult = ((await exactDuplicate.json()) as { results: Array<{ jobId: string; relation: string; dedupeStage: string }> }).results[0];
    assert.equal(exactResult?.jobId, jobId);
    assert.equal(exactResult?.relation, 'DUPLICATE');
    assert.equal(exactResult?.dedupeStage, 'EXACT_URL');

    const repost = await requestJson(base, '/api/job-feed/import-user', alice, 'POST', {
      rawText: offer, sourceUrl: 'https://jobs.example.pl/offer/456', publishedAt: '2026-09-10T12:00:00.000Z'
    });
    assert.equal(repost.status, 201);
    const repostResult = ((await repost.json()) as { results: Array<{ jobId: string; relation: string; dedupeStage: string }> }).results[0];
    assert.equal(repostResult?.jobId, jobId);
    assert.equal(repostResult?.relation, 'REPOST');
    assert.equal(repostResult?.dedupeStage, 'NORMALIZED_IDENTITY');

    const feed = await requestJson(base, '/api/job-feed?limit=25&offset=0', alice, 'GET');
    assert.equal(feed.status, 200);
    const card = ((await feed.json()) as { jobs: Array<{ jobId: string; duplicateCount: number; repostCount: number; decisionState: { recommendation: string | null } }> }).jobs[0];
    assert.equal(card?.jobId, jobId);
    assert.equal(card?.duplicateCount, 0, 'Ponowny import tego samego kanonicznego URL aktualizuje last_seen_at zamiast tworzyć kolejną obserwację.');
    assert.equal(card?.repostCount, 1);
    assert.ok(card?.decisionState.recommendation);

    const saved = await requestJson(base, `/api/job-feed/${jobId}/state`, alice, 'PATCH', { state: 'SAVED' });
    assert.equal(saved.status, 200);
    assert.equal(((await saved.json()) as { jobs: Array<{ state: string }> }).jobs[0]?.state, 'SAVED');

    const errors: Array<{ code: string; message: string }> = [];
    for (const id of [jobId, randomUUID()]) {
      const response = await requestJson(base, `/api/job-feed/${id}/state`, bob, 'PATCH', { state: 'HIDDEN' });
      assert.equal(response.status, 404);
      errors.push(((await response.json()) as { error: { code: string; message: string } }).error);
    }
    assert.deepEqual({ code: errors[0]?.code, message: errors[0]?.message }, { code: errors[1]?.code, message: errors[1]?.message });

    const exported = await requestJson(base, '/api/export', alice, 'GET');
    assert.equal(exported.status, 200);
    const exportBody = await exported.json() as { job_source_observations: unknown[]; job_feed_states: unknown[] };
    assert.equal(exportBody.job_source_observations.length, 2, 'Dokładnie ten sam URL jest idempotentną obserwacją; nowy rekord powstaje dopiero dla odrębnego źródłowego URL/repostu.');
    assert.equal(exportBody.job_feed_states.length, 1);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('job sources are admin-controlled and disabling a connector fails closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'job-source-admin-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const cookie = await register(base, 'feed-admin@example.pl');
    new FeatureFlagService(app.db).set('job_feed', true, 100);

    const forbidden = await requestJson(base, '/api/admin/job-sources', cookie, 'GET');
    assert.equal(forbidden.status, 403);

    app.db.db.prepare("UPDATE users SET role='ADMIN' WHERE email=?").run('feed-admin@example.pl');
    const sources = await requestJson(base, '/api/admin/job-sources', cookie, 'GET');
    assert.equal(sources.status, 200);
    const sourceList = (await sources.json()) as { sources: Array<{ key: string; kind: string; enabled: number }> };
    assert.ok(sourceList.sources.some(source => source.key === 'user_provided' && source.kind === 'USER_PROVIDED' && source.enabled === 1));

    const disabled = await requestJson(base, '/api/admin/job-sources/user_provided', cookie, 'PATCH', { enabled: false });
    assert.equal(disabled.status, 200);
    const importResponse = await requestJson(base, '/api/job-feed/import-user', cookie, 'POST', { rawText: offer });
    assert.equal(importResponse.status, 503);
    assert.equal(((await importResponse.json()) as { error: { code: string } }).error.code, 'JOB_SOURCE_DISABLED');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
