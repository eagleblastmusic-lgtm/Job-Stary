import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

async function mockAuthenticatedUser(page: Page): Promise<void> {
  await page.route('**/api/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      user: { id: 'search-ui-user', email: 'search-ui@example.pl', name: 'Tester Search', role: 'USER', locale: 'pl-PL', timezone: 'Europe/Warsaw' },
      profile: { desiredRoles: ['magazynier'], location: 'Puck', commuteKm: 30, remotePreferences: ['ONSITE'], salaryMin: 5500, contractPreferences: ['UOP'], shiftPreferences: { nights: null, weekends: null }, availability: 'od zaraz' },
      subscription: { plan: 'TRIAL', status: 'TRIALING' }
    })
  }));
  await page.route('**/api/career-truth', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ facts: [], experiences: [], education: [] }) }));
  await page.route('**/api/features', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ features: { job_feed: true, today: false, notifications: false, interview_pack: false, bottleneck: false, local_labour: false, effective_wage: false, skill_roi: false, just_in_time_learning: false, career_transition: false, outcome_inbox: false, strategy_engine: false } })
  }));
}

test('job search prefers official API results and shows direct-source health independently', async ({ page }) => {
  await mockAuthenticatedUser(page);
  await page.route('**/api/job-feed**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: [], limit: 25, offset: 0 }) }));
  const autoProvider = (key: string, label: string, searchUrl: string) => ({
    key, label, homepageUrl: searchUrl, searchMode: 'AUTO_IMPORT', ingestionStatus: 'PUBLIC_WEB_ACTIVE', searchUrl,
    canIngestAutomatically: true, notes: 'Automatyczny odczyt publicznych stron.', checkedAt: '2026-09-13'
  });
  const providers = [
    { key: 'jooble_pl', label: 'Jooble Polska API', homepageUrl: 'https://pl.jooble.org/', searchMode: 'AUTO_IMPORT', ingestionStatus: 'OFFICIAL_API_ACTIVE', searchUrl: 'https://pl.jooble.org/', canIngestAutomatically: true, notes: 'Oficjalny agregator API.', checkedAt: '2026-09-13' },
    autoProvider('pracuj', 'Pracuj.pl', 'https://www.pracuj.pl/praca/magazynier;kw/Puck;wp'),
    autoProvider('linkedin', 'LinkedIn Jobs', 'https://www.linkedin.com/jobs/search/?keywords=magazynier&location=Puck&distance=30'),
    autoProvider('olx', 'OLX Praca', 'https://www.olx.pl/praca/puck/q-magazynier/'),
    autoProvider('indeed', 'Indeed', 'https://pl.indeed.com/jobs?q=magazynier&l=Puck&radius=30'),
    autoProvider('rocketjobs', 'RocketJobs', 'https://rocketjobs.pl/oferty-pracy/wszystkie-lokalizacje?keyword=magazynier&location=Puck'),
    autoProvider('justjoinit', 'Just Join IT', 'https://justjoin.it/job-offers/all-locations?q=magazynier%40keyword'),
    { key: 'employer_careers', label: 'Strony karier pracodawców', homepageUrl: 'about:blank', searchMode: 'DIRECT_CAREER_PAGES', ingestionStatus: 'PERMITTED_SOURCE_REQUIRED', searchUrl: null, canIngestAutomatically: false, notes: 'Tylko jawnie dozwolone źródła.', checkedAt: '2026-09-13' }
  ];
  const sourceRefresh = [
    { sourceKey: 'jooble_pl', status: 'IMPORTED', fetchedCount: 10, canonicalCount: 6, message: 'Jooble: 10 ofert, 6 nowych po deduplikacji.' },
    { sourceKey: 'pracuj', status: 'IMPORTED', fetchedCount: 8, canonicalCount: 5, message: 'Pobrano 8 ofert; 5 nowych po deduplikacji.' },
    { sourceKey: 'linkedin', status: 'BLOCKED', fetchedCount: 0, canonicalCount: 0, message: 'Źródło LinkedIn Jobs zablokowało automatyczny odczyt (HTTP 403).' },
    { sourceKey: 'olx', status: 'NO_RESULTS', fetchedCount: 0, canonicalCount: 0, message: 'Brak ofert do importu z bieżącej odpowiedzi źródła.' },
    { sourceKey: 'indeed', status: 'FAILED', fetchedCount: 0, canonicalCount: 0, message: 'Źródło Indeed zwróciło HTTP 503.' },
    { sourceKey: 'rocketjobs', status: 'IMPORTED', fetchedCount: 7, canonicalCount: 4, message: 'Pobrano 7 ofert; 4 nowych po deduplikacji.' },
    { sourceKey: 'justjoinit', status: 'IMPORTED', fetchedCount: 6, canonicalCount: 3, message: 'Pobrano 6 ofert; 3 nowe po deduplikacji.' }
  ];
  await page.route('**/api/job-search**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      criteria: { query: 'magazynier', location: 'Puck', radiusKm: 30 },
      providers,
      localJobs: [{ jobId: 'job-1', title: 'Magazynier', company: 'Port Logistics', location: 'Puck', sourceKeys: ['jooble_pl', 'pracuj', 'rocketjobs'], sourceUrl: 'https://jobs.example.pl/puck', freshness: '2026-09-13T08:00:00.000Z', decisionState: { recommendation: 'APPLY', override: null } }],
      sourceRefresh,
      externalSearchCount: 7,
      automaticIngestionCount: 7,
      importedCount: 31,
      newCanonicalCount: 18,
      boundary: 'Job preferuje oficjalne API i dozwolone feedy; blokowane bezpośrednie źródła nie zatrzymują wyników z oficjalnych kanałów.'
    })
  }));

  await page.goto('/');
  await expect(page.locator('#appView')).not.toHaveClass(/hidden/);
  await page.locator('[data-view="job-search"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Wyszukiwarka ofert' })).toBeVisible();
  await expect(page.locator('#federatedSearchForm input[name="q"]')).toHaveValue('magazynier');
  await expect(page.locator('#federatedSearchForm input[name="location"]')).toHaveValue('Puck');
  await expect(page.locator('#federatedSearchForm input[name="radiusKm"]')).toHaveValue('30');
  await page.getByRole('button', { name: 'Pobierz oferty ze wszystkich źródeł' }).click();

  await expect(page.locator('#jobSearchSummary')).toContainText('pobrano 31 rekordów');
  await expect(page.locator('#jobSearchSummary')).toContainText('18 nowych po deduplikacji');
  await expect(page.locator('#jobSearchProviders')).toContainText('Jooble Polska API');
  await expect(page.locator('#jobSearchProviders')).toContainText('pobrano 10');
  await expect(page.locator('#jobSearchProviders')).toContainText('Pracuj.pl');
  await expect(page.locator('#jobSearchProviders')).toContainText('LinkedIn Jobs');
  await expect(page.locator('#jobSearchProviders')).toContainText('źródło blokuje odczyt');
  await expect(page.locator('#jobSearchProviders')).toContainText('RocketJobs');
  await expect(page.locator('#jobSearchProviders')).toContainText('Just Join IT');
  await expect(page.locator('#jobSearchProviders')).toContainText('Strony karier pracodawców');
  await expect(page.locator('#jobSearchLocalJobs')).toContainText('Port Logistics');
  await expect(page.locator('#jobSearchLocalJobs')).toContainText('jooble_pl, pracuj, rocketjobs');

  const results = await new AxeBuilder({ page }).include('[data-screen="job-search"]').analyze();
  expect(results.violations).toEqual([]);
});

test('job search displays loading animation and skeleton placeholders while fetching', async ({ page }) => {
  await mockAuthenticatedUser(page);
  await page.route('**/api/job-feed**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: [], limit: 25, offset: 0 }) }));

  let resolveRoute: () => void = () => {};
  const routePromise = new Promise<void>(res => { resolveRoute = res; });

  await page.route('**/api/job-search**', async route => {
    await routePromise;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        criteria: { query: 'magazynier', location: 'Puck', radiusKm: 30 },
        providers: [],
        localJobs: [],
        sourceRefresh: [],
        externalSearchCount: 0,
        automaticIngestionCount: 0,
        importedCount: 0,
        newCanonicalCount: 0,
        boundary: ''
      })
    });
  });

  await page.goto('/');
  await page.locator('[data-view="job-search"]:visible').first().click();
  await page.getByRole('button', { name: 'Pobierz oferty ze wszystkich źródeł' }).click();

  // Verify animated loader card is visible
  await expect(page.locator('.job-search-loader')).toBeVisible();
  await expect(page.locator('.job-search-loader .loader-spinner')).toBeVisible();
  await expect(page.locator('.job-search-loader strong')).toContainText('Przeszukuję portale z ofertami');

  // Verify skeleton placeholders in job list area
  const skeletons = page.locator('#jobSearchLocalJobs .skeleton-card');
  await expect(skeletons).toHaveCount(3);

  // Verify button loading state
  await expect(page.locator('#jobSearchSubmit')).toHaveClass(/button-loading/);
  await expect(page.locator('#jobSearchSubmit .btn-inline-spinner')).toBeVisible();

  // Accessibility during loading state
  const loadingAxe = await new AxeBuilder({ page }).include('[data-screen="job-search"]').analyze();
  expect(loadingAxe.violations).toEqual([]);

  // Resolve search and check normal completion
  resolveRoute();
  await expect(page.locator('.job-search-loader')).not.toBeVisible();
  await expect(page.locator('#jobSearchSubmit')).not.toHaveClass(/button-loading/);
});

