import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { calculateEffectiveWage } from '../domain/effectiveWage.js';
import { parseJobText } from '../domain/jobParser.js';
import { createExtendedJobApp } from '../server/extendedApp.js';
import { FeatureFlagService } from '../server/featureFlagService.js';

const prefs = {
  commuteRoundTripKm: 40,
  commuteMinutesPerDay: 60,
  commuteDaysPerMonth: 20,
  vehicleCostPerKm: 0.5,
  estimatedNetRatio: 0.75,
  monthlyWorkHours: 160,
  subjectiveTimeValuePerHour: 30
};

test('Effective Wage separates objective cash costs from optional subjective time value', () => {
  const result = calculateEffectiveWage({
    salaryMin: 6000, salaryMax: 7000, salaryPeriod: 'MONTH', grossNet: 'GROSS', workingHours: null, shiftPattern: '2 zmiany', nightWork: true, weekendWork: false
  }, prefs);
  assert.deepEqual(result.estimatedMonthlyNet, { min: 4500, max: 5250 });
  assert.equal(result.monthlyCommuteCost, 400);
  assert.equal(result.monthlyCommuteHours, 20);
  assert.deepEqual(result.cashAfterCommute, { min: 4100, max: 4850 });
  assert.equal(result.subjectiveTimeCost, 600);
  assert.deepEqual(result.cashAfterCommuteAndSubjectiveTime, { min: 3500, max: 4250 });
  assert.ok(result.assumptions.some(value => /subiektywna|Opcjonalna wartość czasu/i.test(value)));
  assert.ok(result.warnings.some(value => /nie kalkulatorem podatkowym/i.test(value)));
  assert.ok(result.shiftContext.some(value => /prac[ęa] nocn[ąa]/i.test(value)));
});

test('Effective Wage refuses to invent net salary when gross/net context or net ratio is missing', () => {
  const unknown = calculateEffectiveWage({ salaryMin: 6500, salaryMax: 6500, salaryPeriod: 'MONTH', grossNet: 'UNKNOWN', workingHours: null, shiftPattern: null, nightWork: null, weekendWork: null }, { ...prefs, estimatedNetRatio: null });
  assert.deepEqual(unknown.estimatedMonthlyNet, { min: null, max: null });
  assert.match(unknown.warnings.join(' '), /Nie wiadomo, czy wynagrodzenie jest brutto czy netto/);

  const gross = calculateEffectiveWage({ salaryMin: 6500, salaryMax: 6500, salaryPeriod: 'MONTH', grossNet: 'GROSS', workingHours: null, shiftPattern: null, nightWork: null, weekendWork: null }, { ...prefs, estimatedNetRatio: null });
  assert.deepEqual(gross.estimatedMonthlyNet, { min: null, max: null });
  assert.match(gross.warnings.join(' '), /nie ustawiono współczynnika brutto→netto/);
});

test('Effective Wage API is feature-gated, user-scoped and persists explicit assumptions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'effective-wage-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try {
    const register = async (email: string) => {
      const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Tester', email, password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false }) });
      assert.equal(response.status, 201);
      return { cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '', userId: ((await response.json()) as { user: { id: string } }).user.id };
    };
    const alice = await register('wage-alice@example.pl');
    const bob = await register('wage-bob@example.pl');
    const raw = 'Magazynier\nFirma: ABC\nMiejsce pracy: Gdynia\n6000 - 7000 PLN brutto\nPraca stacjonarna.';
    const jobId = app.store.createJob(alice.userId, raw, parseJobText(raw));

    const disabled = await fetch(`${base}/api/effective-wage/jobs`, { headers: { cookie: alice.cookie } });
    assert.equal(disabled.status, 404);
    new FeatureFlagService(app.db).set('effective_wage', true, 100);

    const put = await fetch(`${base}/api/effective-wage/preferences`, { method: 'PUT', headers: { cookie: alice.cookie, 'content-type': 'application/json' }, body: JSON.stringify(prefs) });
    assert.equal(put.status, 200);
    assert.deepEqual(((await put.json()) as { preferences: typeof prefs }).preferences, prefs);

    const calculated = await fetch(`${base}/api/effective-wage/jobs/${jobId}`, { headers: { cookie: alice.cookie } });
    assert.equal(calculated.status, 200);
    const calculation = (await calculated.json()) as { calculation: { result: { monthlyCommuteCost: number; estimatedMonthlyNet: { min: number; max: number } } } };
    assert.equal(calculation.calculation.result.monthlyCommuteCost, 400);
    assert.deepEqual(calculation.calculation.result.estimatedMonthlyNet, { min: 4500, max: 5250 });

    const foreign = await fetch(`${base}/api/effective-wage/jobs/${jobId}`, { headers: { cookie: bob.cookie } });
    const missing = await fetch(`${base}/api/effective-wage/jobs/00000000-0000-4000-8000-000000000000`, { headers: { cookie: bob.cookie } });
    assert.equal(foreign.status, 404); assert.equal(missing.status, 404);
    const foreignError = (await foreign.json()) as { error: { code: string; message: string } };
    const missingError = (await missing.json()) as { error: { code: string; message: string } };
    assert.deepEqual({ code: foreignError.error.code, message: foreignError.error.message }, { code: missingError.error.code, message: missingError.error.message });
  } finally {
    await app.close(); await rm(dir, { recursive: true, force: true });
  }
});
