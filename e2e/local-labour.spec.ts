import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

async function mockAuthenticatedUser(page: Page): Promise<void> {
  await page.route('**/api/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    user: { id: 'ui-local-labour-user', email: 'rynek-ui@example.pl', name: 'Tester Rynku', role: 'USER', locale: 'pl-PL', timezone: 'Europe/Warsaw' },
    profile: { desiredRoles: ['magazynier'], location: 'powiat pucki', commuteKm: 20, remotePreferences: ['ONSITE'], salaryMin: 5500, contractPreferences: ['UOP'], shiftPreferences: { nights: null, weekends: null }, availability: 'od zaraz' },
    subscription: { plan: 'TRIAL', status: 'TRIALING' }
  }) }));
  await page.route('**/api/career-truth', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ facts: [], experiences: [], education: [] }) }));
}

test('Local Labour UI exposes provenance, uncertainty and a bounded +10 km recommendation', async ({ page }) => {
  await mockAuthenticatedUser(page);
  await page.route('**/api/features', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: { local_labour: true, bottleneck: false, job_feed: false, today: false, notifications: false, interview_pack: false } }) }));
  await page.route('**/api/local-labour**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ report: {
    role: 'magazynier', baseArea: 'powiat pucki', commuteKm: 20, confidence: 'PRAWDOPODOBNY_WNIOSEK',
    currentArea: null,
    accessibleAreas: [{
      areaName: 'powiat pucki', normalizedArea: 'powiat pucki', distanceKm: 0, shortageStatus: 'BALANCE', registeredUnemployed: 120,
      offersPup: 20, offersCbop: 30, offersOnline: 40, salaryMin: 5200, salaryMax: 6500, requiredCredentials: [], observedJobs: 3,
      sources: [{ sourceName: 'BAROMETR_ZAWODOW', sourceUrl: 'https://barometrzawodow.pl/', sourceLicense: null, year: 2026, updatedAt: null }],
      confidence: 'PRAWDOPODOBNY_WNIOSEK', referenceOfferFlow: 40, referenceOfferFlowKind: 'ONLINE', unconfirmedCredentials: [],
      evidence: ['Status popytu/podaży: BALANCE.', 'Referencyjny napływ ofert (ONLINE): 40.', 'Oferty widoczne w Twojej zapisanej bazie dla tego obszaru i roli: 3.']
    }],
    bestArea: { areaName: 'powiat pucki' },
    plusTenKm: { status: 'MAY_HELP', areaName: 'powiat wejherowski', distanceKm: 25, message: 'Poszerzenie promienia o 10 km może mieć sens: powiat wejherowski ma obecnie korzystniejszy sygnał z dostępnych danych.' },
    caveats: ['Dane publiczne opisują rynek w danym obszarze i zawodzie, a nie Twoje indywidualne prawdopodobieństwo zatrudnienia.', 'Brak potwierdzenia kwalifikacji w profilu oznacza tylko „nie wiemy”, a nie „nie posiadasz”.']
  } }) }));

  await page.goto('/');
  await expect(page.locator('#appView')).not.toHaveClass(/hidden/);
  const nav = page.locator('[data-view="local-labour"]:visible').first();
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(page.getByRole('heading', { name: 'Gdzie masz więcej możliwości?' })).toBeVisible();
  const result = page.locator('#localLabourResult');
  await expect(result).toContainText('PRAWDOPODOBNY WNIOSEK');
  await expect(result).toContainText('Czy +10 km ma sens?');
  await expect(result).toContainText('powiat wejherowski');
  await expect(result).toContainText('BAROMETR_ZAWODOW');
  await expect(result).toContainText('nie wiemy');
  await expect(result).not.toContainText(/gwarant|na pewno dostaniesz|100%/i);

  const axe = await new AxeBuilder({ page }).include('[data-screen="local-labour"]').analyze();
  expect(axe.violations).toEqual([]);
});
