import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

async function mockAuthenticatedUser(page: Page): Promise<void> {
  await page.route('**/api/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    user: { id: 'ui-wage-user', email: 'wage-ui@example.pl', name: 'Tester Wartości', role: 'USER', locale: 'pl-PL', timezone: 'Europe/Warsaw' },
    profile: { desiredRoles: ['magazynier'], location: 'Gdynia', commuteKm: 25, remotePreferences: ['ONSITE'], salaryMin: 5500, contractPreferences: ['UOP'], shiftPreferences: { nights: null, weekends: null }, availability: 'od zaraz' }, subscription: { plan: 'TRIAL', status: 'TRIALING' }
  }) }));
  await page.route('**/api/career-truth', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ facts: [], experiences: [], education: [] }) }));
}

test('Effective Wage keeps subjective time value separate and exposes assumptions', async ({ page }) => {
  await mockAuthenticatedUser(page);
  let preferences = { commuteRoundTripKm: 40, commuteMinutesPerDay: 60, commuteDaysPerMonth: 20, vehicleCostPerKm: 0.5, estimatedNetRatio: 0.75, monthlyWorkHours: 160, subjectiveTimeValuePerHour: 30 };
  await page.route('**/api/features', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: { effective_wage: true, bottleneck: false, job_feed: false, today: false, notifications: false, interview_pack: false } }) }));
  await page.route('**/api/effective-wage/**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/effective-wage/preferences') {
      if (method === 'PUT') preferences = JSON.parse(route.request().postData() ?? '{}') as typeof preferences;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preferences }) }); return;
    }
    if (url.pathname === '/api/effective-wage/jobs') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: [{ id: 'job-1', title: 'Magazynier', company: 'Logistyka ABC', location: 'Gdynia', salaryMin: 6000, salaryMax: 7000, salaryPeriod: 'MONTH', grossNet: 'GROSS' }] }) }); return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ calculation: {
      job: { id: 'job-1', title: 'Magazynier', company: 'Logistyka ABC', location: 'Gdynia', salaryMin: 6000, salaryMax: 7000, salaryPeriod: 'MONTH', grossNet: 'GROSS' }, preferences,
      result: { monthlySalaryInput: { min: 6000, max: 7000 }, estimatedMonthlyNet: { min: 4500, max: 5250 }, monthlyCommuteCost: 400, monthlyCommuteHours: 20, cashAfterCommute: { min: 4100, max: 4850 }, cashPerWorkHourAfterCommute: { min: 25.625, max: 30.3125 }, subjectiveTimeCost: 600, cashAfterCommuteAndSubjectiveTime: { min: 3500, max: 4250 }, assumptions: ['Szacunek netto używa ustawionego przez użytkownika współczynnika 75.0% kwoty brutto.', 'Opcjonalna wartość czasu (30.00 zł/h) została ustawiona przez użytkownika i nie jest obiektywną wartością ekonomiczną.'], warnings: ['Współczynnik brutto→netto jest uproszczeniem użytkownika, a nie kalkulatorem podatkowym ani poradą finansową.'], shiftContext: ['Oferta obejmuje pracę nocną. Kalkulator nie zakłada automatycznie dodatku ani kosztu za pracę nocną.'] }
    } }) });
  });

  await page.goto('/');
  await expect(page.locator('#appView')).not.toHaveClass(/hidden/);
  await page.locator('[data-view="effective-wage"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Efektywne wynagrodzenie' })).toBeVisible();
  await expect(page.locator('[data-screen="effective-wage"]')).toContainText('subiektywne ustawienie');
  await page.getByRole('button', { name: 'Policz' }).click();
  const result = page.locator('#effectiveWageResult');
  await expect(result).toContainText(/4\s?100 zł/);
  await expect(result).toContainText('Subiektywna wartość czasu — osobno');
  await expect(result).toContainText('nie jest obiektywną wartością ekonomiczną');
  await expect(result).toContainText('nie kalkulatorem podatkowym');
  await expect(result).toContainText(/prac.*nocn/i);

  await page.locator('#effectiveWagePreferences input[name="subjectiveTimeValuePerHour"]').fill('45');
  await page.getByRole('button', { name: 'Zapisz założenia' }).click();
  await expect(page.locator('#effectiveWageMessage')).toContainText('Założenia zapisane');
  expect(preferences.subjectiveTimeValuePerHour).toBe(45);

  const axe = await new AxeBuilder({ page }).include('[data-screen="effective-wage"]').analyze();
  expect(axe.violations).toEqual([]);
});
