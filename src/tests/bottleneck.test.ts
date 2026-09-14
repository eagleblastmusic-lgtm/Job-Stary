import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildBottleneckReport, confidenceForSample } from '../domain/bottleneckEngine.js';
import { createExtendedJobApp } from '../server/extendedApp.js';
import { FeatureFlagService } from '../server/featureFlagService.js';

test('confidence levels scale with sample size and tiny samples never become a diagnosis', () => {
  assert.equal(confidenceForSample(0), 'ZA_MALO_DANYCH');
  assert.equal(confidenceForSample(4), 'ZA_MALO_DANYCH');
  assert.equal(confidenceForSample(5), 'WCZESNY_SYGNAL');
  assert.equal(confidenceForSample(10), 'PRAWDOPODOBNY_WNIOSEK');
  assert.equal(confidenceForSample(30), 'SILNY_WNIOSEK');

  const report = buildBottleneckReport({
    canonicalJobs: 3, decisionsTotal: 3, favorableDecisions: 1, applicationsToFavorableJobs: 1,
    applicationsTotal: 1, appliedOrBeyond: 1, responses: 0, interviews: 0, offers: 0
  });
  assert.equal(report.primary, null);
  assert.equal(report.overallConfidence, 'ZA_MALO_DANYCH');
  assert.match(report.message, /Za mało danych/);
  assert.ok(report.diagnostics.every(item => item.confidence === 'ZA_MALO_DANYCH'));
  assert.doesNotMatch(JSON.stringify(report), /Twoje CV jest złe/i);
});

test('Bottleneck chooses a low-response signal only when its sample is large enough and preserves alternatives', () => {
  const report = buildBottleneckReport({
    canonicalJobs: 20, decisionsTotal: 20, favorableDecisions: 16, applicationsToFavorableJobs: 12,
    applicationsTotal: 12, appliedOrBeyond: 12, responses: 1, interviews: 0, offers: 0
  });
  assert.equal(report.primary?.stage, 'RESPONSE');
  assert.equal(report.primary?.sampleSize, 12);
  assert.equal(report.primary?.confidence, 'PRAWDOPODOBNY_WNIOSEK');
  assert.ok((report.primary?.rate ?? 1) < 0.1);
  assert.ok((report.primary?.alternativeExplanations.length ?? 0) >= 3);
  assert.match(report.primary?.recommendedAction ?? '', /uzupełnij brakujące wyniki/i);
  assert.doesNotMatch(report.primary?.headline ?? '', /CV jest złe/i);
});

test('Bottleneck API is disabled by default and returns an evidence-limited report after controlled rollout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bottleneck-api-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const register = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bottleneck Tester', email: 'bottleneck@example.pl', password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false })
    });
    assert.equal(register.status, 201);
    const cookie = register.headers.get('set-cookie')?.split(';')[0] ?? '';

    const disabled = await fetch(`${base}/api/bottleneck`, { headers: { cookie } });
    assert.equal(disabled.status, 404);
    assert.equal(((await disabled.json()) as { error: { code: string } }).error.code, 'FEATURE_DISABLED');

    new FeatureFlagService(app.db).set('bottleneck', true, 100);
    const response = await fetch(`${base}/api/bottleneck`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const body = await response.json() as { report: { primary: unknown; overallConfidence: string; minimumSample: number; message: string } };
    assert.equal(body.report.primary, null);
    assert.equal(body.report.overallConfidence, 'ZA_MALO_DANYCH');
    assert.equal(body.report.minimumSample, 5);
    assert.match(body.report.message, /Za mało danych/);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
