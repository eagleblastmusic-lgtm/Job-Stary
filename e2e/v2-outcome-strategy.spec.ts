import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

async function mockAuthenticatedUser(page: Page): Promise<void> {
  await page.route('**/api/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'inbox-ui', email: 'inbox-ui@example.pl', name: 'Tester Inbox', role: 'USER', locale: 'pl-PL', timezone: 'Europe/Warsaw' }, profile: { desiredRoles: ['obsługa klienta'], location: 'Gdynia', commuteKm: 25, remotePreferences: [], salaryMin: null, contractPreferences: [], shiftPreferences: { nights: null, weekends: null }, availability: null }, subscription: { plan: 'TRIAL', status: 'TRIALING' } }) }));
  await page.route('**/api/career-truth', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ facts: [], experiences: [], education: [] }) }));
}

test('Outcome Inbox requires explicit confirmation and explains that raw message text is not stored', async ({ page }) => {
  await mockAuthenticatedUser(page);
  await page.route('**/api/features', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: { outcome_inbox: true, career_transition: false, skill_roi: false, just_in_time_learning: false, strategy_engine: false, effective_wage: false, local_labour: false, bottleneck: false, job_feed: false, today: false, notifications: false, interview_pack: false } }) }));
  await page.route('**/api/applications', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ applications: [{ id: 'app-1', job_id: 'job-1', status: 'APPLIED', title: 'Specjalista obsługi klienta', company: 'Firma ABC' }] }) }));
  let items: Array<Record<string, unknown>> = [];
  await page.route('**/api/outcome-inbox', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: items }) }));
  await page.route('**/api/outcome-inbox/analyze', route => {
    const suggestion = { id: 's-1', applicationId: 'app-1', suggestionType: 'INTERVIEW', suggestedStatus: 'INTERVIEW', confidence: 0.79, evidenceCodes: ['INTERVIEW_INVITATION'], sourceKind: 'MANUAL_PASTE', sourceLabel: 'e-mail', confirmedAt: null, dismissedAt: null, createdAt: new Date().toISOString(), jobTitle: 'Specjalista obsługi klienta', company: 'Firma ABC', currentStatus: 'APPLIED' };
    items = [suggestion];
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ suggestion, message: 'To tylko sugestia. Status nie zmieni się bez Twojego potwierdzenia.' }) });
  });
  await page.route('**/api/outcome-inbox/s-1/confirm', route => { items = [{ ...items[0], confirmedAt: new Date().toISOString(), currentStatus: 'INTERVIEW' }]; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestion: items[0] }) }); });
  await page.goto('/');
  await expect(page.locator('#appView')).not.toHaveClass(/hidden/);
  await page.locator('[data-view="outcome-inbox"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Co oznacza wiadomość od firmy?' })).toBeVisible();
  await expect(page.locator('[data-screen="outcome-inbox"]')).toContainText('status nigdy nie zmienia się bez Twojego potwierdzenia');
  await expect(page.locator('[data-screen="outcome-inbox"]')).toContainText('Surowa treść wiadomości nie jest zapisywana');
  await page.locator('#outcomeInboxForm select[name="applicationId"]').selectOption('app-1');
  await page.locator('#outcomeInboxForm input[name="sourceLabel"]').fill('e-mail');
  await page.locator('#outcomeInboxForm textarea[name="messageText"]').fill('Dzień dobry, zapraszamy na rozmowę rekrutacyjną w czwartek.');
  await page.getByRole('button', { name: 'Przeanalizuj wiadomość' }).click();
  await expect(page.locator('#outcomeInboxMessage')).toContainText('To tylko sugestia');
  await expect(page.locator('#outcomeInboxSuggestions')).toContainText('Prawdopodobne zaproszenie na rozmowę');
  await page.getByRole('button', { name: 'Potwierdź i zaktualizuj status' }).click();
  await expect(page.locator('#outcomeInboxMessage')).toContainText('dopiero po Twoim potwierdzeniu');
  await expect(page.locator('#outcomeInboxSuggestions')).toContainText('Potwierdzono przez użytkownika');
  const axe = await new AxeBuilder({ page }).include('[data-screen="outcome-inbox"]').analyze();
  expect(axe.violations).toEqual([]);
});
