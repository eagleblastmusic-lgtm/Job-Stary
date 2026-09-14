import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

async function mockAuthenticatedUser(page: Page): Promise<void> {
  await page.route('**/api/me', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      user: { id: 'ui-feed-user', email: 'feed-ui@example.pl', name: 'Tester Feedu', role: 'USER', locale: 'pl-PL', timezone: 'Europe/Warsaw' },
      profile: { desiredRoles: ['magazynier'], location: 'Gdynia', commuteKm: 25, remotePreferences: ['ONSITE'], salaryMin: 5500, contractPreferences: ['UOP'], shiftPreferences: { nights: null, weekends: null }, availability: 'od zaraz' },
      subscription: { plan: 'TRIAL', status: 'TRIALING' }
    })
  }));
  await page.route('**/api/career-truth', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ facts: [], experiences: [], education: [] }) }));
}

test('Job Feed imports user-provided offers, exposes decision/source state and remains accessible', async ({ page }) => {
  await mockAuthenticatedUser(page);
  let state = 'RECOMMENDED';
  let jobs = [{
    jobId: 'job-1', title: 'Magazynier', company: 'Logistyka ABC', location: 'Gdynia', sourceKeys: ['user_provided'], sourceUrl: 'https://jobs.example.pl/offer/123',
    freshness: '2026-09-12T12:00:00.000Z', deadline: null, state, decisionState: { recommendation: 'APPLY', override: null }, duplicateCount: 1, repostCount: 1
  }];
  await page.route('**/api/features', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: { job_feed: true, today: false, notifications: false, interview_pack: false } }) }));
  await page.route('**/api/job-feed**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/job-feed/import-user' && method === 'POST') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ results: [{ jobId: 'job-1', relation: 'DUPLICATE', dedupeStage: 'EXACT_URL', createdCanonicalJob: false }], jobs }) }); return;
    }
    if (url.pathname.endsWith('/state') && method === 'PATCH') {
      const body = JSON.parse(route.request().postData() ?? '{}') as { state: string };
      state = body.state;
      jobs = jobs.map(job => ({ ...job, state }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs }) }); return;
    }
    if (url.pathname === '/api/job-feed/sources') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sources: [{ key: 'user_provided', label: 'Treść dostarczona przez użytkownika', enabled: 1 }] }) }); return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs, limit: 25, offset: 0 }) });
  });

  await page.goto('/');
  await expect(page.locator('#appView')).not.toHaveClass(/hidden/);
  await expect(page.locator('[data-view="job-feed"]:visible').first()).toBeVisible();
  await page.locator('[data-view="job-feed"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Feed ofert' })).toBeVisible();
  await expect(page.locator('#feedList')).toContainText('Logistyka ABC');
  await expect(page.locator('#feedList')).toContainText('Decyzja: APPLY');
  await expect(page.locator('#feedList')).toContainText('1 duplikatów');
  await expect(page.locator('#feedList')).toContainText('1 repostów');

  await page.locator('#feedImportForm textarea[name="rawText"]').fill('Magazynier\nFirma: Logistyka ABC\nMiejsce pracy: Gdynia\nUmowa o pracę\nWymagania: UDT, WMS');
  await page.locator('#feedImportForm input[name="sourceUrl"]').fill('https://jobs.example.pl/offer/123');
  await page.getByRole('button', { name: 'Dodaj do feedu' }).click();
  await expect(page.locator('#feedMessage')).toContainText('Rozpoznano duplikat');

  await page.getByRole('button', { name: 'Zapisz' }).first().click();
  await expect(page.locator('#feedList')).toContainText('zapisana');
  await page.getByRole('button', { name: 'Zapisane' }).click();
  await expect(page.locator('#feedList')).toContainText('Logistyka ABC');

  await expect(page.locator('[data-screen="job-feed"]')).toContainText('nie skanuje zewnętrznych serwisów');
  const results = await new AxeBuilder({ page }).include('[data-screen="job-feed"]').analyze();
  expect(results.violations).toEqual([]);
});
