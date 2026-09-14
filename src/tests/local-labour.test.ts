import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildLocalLabourReport, confidenceForLabourArea, type LabourAreaInput } from '../domain/localLabour.js';
import { createExtendedJobApp } from '../server/extendedApp.js';
import { FeatureFlagService } from '../server/featureFlagService.js';
import { LocalLabourService } from '../server/localLabourService.js';

function area(overrides: Partial<LabourAreaInput> = {}): LabourAreaInput {
  return {
    areaName: 'powiat pucki', normalizedArea: 'powiat pucki', distanceKm: 0, shortageStatus: 'BALANCE', registeredUnemployed: 100,
    offersPup: 20, offersCbop: 30, offersOnline: 40, salaryMin: null, salaryMax: null, requiredCredentials: [], observedJobs: 2,
    sources: [{ sourceName: 'BAROMETR_ZAWODOW', sourceUrl: 'https://barometrzawodow.pl/', sourceLicense: null, year: 2026, updatedAt: null }],
    ...overrides
  };
}

test('Local Labour confidence is evidence-aware and never upgrades empty data', () => {
  assert.equal(confidenceForLabourArea(area({ sources: [] }), 2026), 'ZA_MALO_DANYCH');
  assert.equal(confidenceForLabourArea(area({ sources: [{ sourceName: 'GUS_BDL', sourceUrl: 'https://bdl.stat.gov.pl/', sourceLicense: 'CC BY 4.0', year: 2022, updatedAt: null }] }), 2026), 'WCZESNY_SYGNAL');
  assert.equal(confidenceForLabourArea(area(), 2026), 'PRAWDOPODOBNY_WNIOSEK');
  assert.equal(confidenceForLabourArea(area({ sources: [
    { sourceName: 'BAROMETR_ZAWODOW', sourceUrl: 'https://barometrzawodow.pl/', sourceLicense: null, year: 2026, updatedAt: null },
    { sourceName: 'GUS_BDL', sourceUrl: 'https://bdl.stat.gov.pl/', sourceLicense: 'CC BY 4.0', year: 2025, updatedAt: null }
  ] }), 2026), 'SILNY_WNIOSEK');
});

test('Local Labour uses comparable evidence and only recommends +10 km when public evidence exists', () => {
  const report = buildLocalLabourReport({
    role: 'magazynier', baseArea: 'powiat pucki', commuteKm: 20, confirmedCredentials: [], currentYear: 2026,
    areas: [
      area(),
      area({ areaName: 'powiat wejherowski', normalizedArea: 'powiat wejherowski', distanceKm: 25, shortageStatus: 'DEFICIT', offersOnline: 90, requiredCredentials: ['UDT'], sources: [
        { sourceName: 'BAROMETR_ZAWODOW', sourceUrl: 'https://barometrzawodow.pl/', sourceLicense: null, year: 2026, updatedAt: null },
        { sourceName: 'GUS_BDL', sourceUrl: 'https://bdl.stat.gov.pl/', sourceLicense: 'CC BY 4.0', year: 2025, updatedAt: null }
      ] })
    ]
  });
  assert.equal(report.bestArea?.areaName, 'powiat pucki');
  assert.equal(report.plusTenKm.status, 'MAY_HELP');
  assert.equal(report.plusTenKm.areaName, 'powiat wejherowski');
  assert.deepEqual(report.accessibleAreas.map(item => item.areaName), ['powiat pucki']);
  const candidate = report.currentArea;
  assert.equal(candidate?.referenceOfferFlow, 40);
  assert.equal(candidate?.referenceOfferFlowKind, 'ONLINE');

  const noPublic = buildLocalLabourReport({ role: 'magazynier', baseArea: 'powiat pucki', commuteKm: 20, confirmedCredentials: [], currentYear: 2026, areas: [
    area({ sources: [] }), area({ areaName: 'powiat wejherowski', normalizedArea: 'powiat wejherowski', distanceKm: 25, shortageStatus: 'UNKNOWN', offersPup: null, offersCbop: null, offersOnline: null, observedJobs: 100, sources: [] })
  ] });
  assert.equal(noPublic.plusTenKm.status, 'NO_STRONG_SIGNAL');
});

test('Local Labour API is gated and produces a sourced comparison without claiming missing credentials are absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'local-labour-api-'));
  const app = createExtendedJobApp({ nodeEnv: 'test', port: 0, appOrigin: 'http://127.0.0.1', dataDir: dir, databasePath: join(dir, 'test.sqlite'), adminEmails: new Set() });
  await new Promise<void>((resolve, reject) => app.server.listen(0, '127.0.0.1', () => resolve()).once('error', reject));
  const address = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const register = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Rynek Tester', email: 'rynek@example.pl', password: 'Bezpieczne123', acceptTerms: true, acceptPrivacy: true, analyticsConsent: false }) });
    assert.equal(register.status, 201);
    const cookie = register.headers.get('set-cookie')?.split(';')[0] ?? '';
    const me = await fetch(`${base}/api/me`, { headers: { cookie } });
    const meBody = await me.json() as { user: { id: string } };
    const userId = meBody.user.id;
    app.db.db.prepare("UPDATE career_profiles SET desired_roles=?, location=?, commute_km=?, updated_at=? WHERE user_id=?").run(JSON.stringify(['magazynier']), 'powiat pucki', 20, new Date().toISOString(), userId);

    const disabled = await fetch(`${base}/api/local-labour`, { headers: { cookie } });
    assert.equal(disabled.status, 404);
    new FeatureFlagService(app.db).set('local_labour', true, 100);

    const service = new LocalLabourService(app.db);
    service.upsertSnapshot({ areaName: 'powiat pucki', areaType: 'POWIAT', roleName: 'Magazynierzy', roleAliases: ['magazynier'], year: 2026, shortageStatus: 'BALANCE', offersOnline: 40, requiredCredentials: [], sourceName: 'BAROMETR_ZAWODOW', sourceUrl: 'https://barometrzawodow.pl/modul/prognozy-na-plakatach?publication=county&year=2026' });
    service.upsertAreaLink({ fromArea: 'powiat pucki', toArea: 'powiat wejherowski', distanceKm: 25, sourceName: 'GUS/TERYT', sourceUrl: 'https://api.stat.gov.pl/' });
    service.upsertSnapshot({ areaName: 'powiat wejherowski', areaType: 'POWIAT', roleName: 'Magazynierzy', roleAliases: ['magazynier'], year: 2026, shortageStatus: 'DEFICIT', offersOnline: 80, requiredCredentials: ['UDT'], sourceName: 'BAROMETR_ZAWODOW', sourceUrl: 'https://barometrzawodow.pl/modul/prognozy-na-plakatach?publication=county&year=2026' });
    service.upsertSnapshot({ areaName: 'powiat wejherowski', areaType: 'POWIAT', roleName: 'Magazynierzy', roleAliases: ['magazynier'], year: 2026, shortageStatus: 'UNKNOWN', offersCbop: 50, sourceName: 'GUS_BDL', sourceUrl: 'https://bdl.stat.gov.pl/', sourceLicense: 'CC BY 4.0' });

    const response = await fetch(`${base}/api/local-labour`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const body = await response.json() as { report: { role: string; plusTenKm: { status: string; areaName: string | null }; accessibleAreas: Array<{ areaName: string }>; caveats: string[] } };
    assert.equal(body.report.role, 'magazynier');
    assert.equal(body.report.plusTenKm.status, 'MAY_HELP');
    assert.equal(body.report.plusTenKm.areaName, 'powiat wejherowski');
    assert.deepEqual(body.report.accessibleAreas.map(item => item.areaName), ['powiat pucki']);
    assert.ok(body.report.caveats.some(item => /nie wiemy/i.test(item)));

    assert.throws(() => service.upsertSnapshot({ areaName: 'X', areaType: 'POWIAT', roleName: 'Y', year: 2026, sourceName: 'GUS_BDL', sourceUrl: 'https://example.com/fake' }), /dozwolonego urzędowego źródła/);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
