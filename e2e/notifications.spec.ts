import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

async function mockAuthenticatedUser(page: Page): Promise<void> {
  await page.route('**/api/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      user: { id: 'ui-notify-user', email: 'notify-ui@example.pl', name: 'Tester Alertów', role: 'USER', locale: 'pl-PL', timezone: 'Europe/Warsaw' },
      profile: { desiredRoles: [], location: null, commuteKm: null, remotePreferences: [], salaryMin: null, contractPreferences: [], shiftPreferences: { nights: null, weekends: null }, availability: null },
      subscription: { plan: 'TRIAL', status: 'TRIALING' }
    })
  }));
  await page.route('**/api/career-truth', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ facts: [], experiences: [], education: [] })
  }));
}

test('notification settings and useful reminder UI work without pressure', async ({ page }) => {
  let settings = { followUp: true, deadlines: true, interviews: false, matchedJobs: false };
  let read = false;
  let dismissed = false;
  await mockAuthenticatedUser(page);
  await page.route('**/api/features', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: { today: false, notifications: true } }) }));
  await page.route('**/api/notifications**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/notifications/preferences') {
      if (method === 'PUT') settings = JSON.parse(route.request().postData() ?? '{}') as typeof settings;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preferences: settings }) }); return;
    }
    if (url.pathname.endsWith('/read')) { read = true; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notification: { id: 'n1', readAt: new Date().toISOString() } }) }); return; }
    if (url.pathname.endsWith('/dismiss')) { dismissed = true; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notification: { id: 'n1', dismissedAt: new Date().toISOString() } }) }); return; }
    const notifications = dismissed ? [] : [{ id: 'n1', type: 'FOLLOW_UP', message: 'Minęło co najmniej 7 dni od aplikacji „Analityk — Firma”. Sprawdzić status?', readAt: read ? new Date().toISOString() : null, createdAt: new Date().toISOString() }];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notifications, unreadCount: read || dismissed ? 0 : 1 }) });
  });

  await page.goto('/');
  await expect(page.locator('#appView')).not.toHaveClass(/hidden/);

  await expect(page.locator('[data-view="notifications"]:visible').first()).toBeVisible();
  await page.locator('[data-view="notifications"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Powiadomienia' })).toBeVisible();
  await expect(page.locator('#notificationList')).toContainText('Minęło co najmniej 7 dni');
  await expect(page.locator('[data-screen="notifications"]')).not.toContainText(/streak|przegapiłeś|musisz\b/i);

  await page.locator('#notificationPreferences input[name="deadlines"]').uncheck();
  await page.getByRole('button', { name: 'Zapisz ustawienia' }).click();
  await expect(page.locator('#notificationMessage')).toContainText('Ustawienia powiadomień zapisane');
  expect(settings.deadlines).toBe(false);

  await page.getByRole('button', { name: 'Oznacz jako przeczytane' }).click();
  await expect(page.locator('#notificationList')).toContainText('przeczytane');
  await page.getByRole('button', { name: 'Ukryj' }).click();
  await expect(page.locator('#notificationList')).toContainText('Brak nowych rzeczy do sprawdzenia');

  const results = await new AxeBuilder({ page }).include('[data-screen="notifications"]').analyze();
  expect(results.violations).toEqual([]);
});
