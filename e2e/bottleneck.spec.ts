import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

async function mockAuthenticatedUser(page: Page): Promise<void> {
  await page.route('**/api/me', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      user: { id: 'ui-bottleneck-user', email: 'bottleneck-ui@example.pl', name: 'Tester Analizy', role: 'USER', locale: 'pl-PL', timezone: 'Europe/Warsaw' },
      profile: { desiredRoles: ['magazynier'], location: 'Gdynia', commuteKm: 25, remotePreferences: ['ONSITE'], salaryMin: 5500, contractPreferences: ['UOP'], shiftPreferences: { nights: null, weekends: null }, availability: 'od zaraz' },
      subscription: { plan: 'TRIAL', status: 'TRIALING' }
    })
  }));
  await page.route('**/api/career-truth', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ facts: [], experiences: [], education: [] }) }));
}

test('Bottleneck UI shows sample, confidence, evidence, alternatives and cautious next action', async ({ page }) => {
  await mockAuthenticatedUser(page);
  await page.route('**/api/features', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: { bottleneck: true, job_feed: false, today: false, notifications: false, interview_pack: false } }) }));
  await page.route('**/api/bottleneck', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ report: {
      primary: {
        stage: 'RESPONSE', sampleSize: 12, confidence: 'PRAWDOPODOBNY_WNIOSEK', rate: 0.083,
        headline: 'Na wysłane aplikacje przychodzi mało zarejestrowanych odpowiedzi.',
        evidence: ['Aplikacje z odpowiedzią lub dalszym etapem: 1/12 (8%).'],
        alternativeExplanations: ['Część pracodawców może jeszcze nie zakończyć rekrutacji.', 'Wyniki mogły nie zostać zapisane.', 'Znaczenie może mieć źródło i świeżość oferty.'],
        recommendedAction: 'Najpierw uzupełnij brakujące wyniki i porównaj odpowiedzi według świeżości/source.'
      },
      diagnostics: [{
        stage: 'RESPONSE', sampleSize: 12, confidence: 'PRAWDOPODOBNY_WNIOSEK', rate: 0.083,
        headline: 'Na wysłane aplikacje przychodzi mało zarejestrowanych odpowiedzi.',
        evidence: ['Aplikacje z odpowiedzią lub dalszym etapem: 1/12 (8%).'],
        alternativeExplanations: ['Część pracodawców może jeszcze nie zakończyć rekrutacji.', 'Wyniki mogły nie zostać zapisane.', 'Znaczenie może mieć źródło i świeżość oferty.'],
        recommendedAction: 'Najpierw uzupełnij brakujące wyniki i porównaj odpowiedzi według świeżości/source.'
      }],
      overallConfidence: 'PRAWDOPODOBNY_WNIOSEK', minimumSample: 5,
      message: 'Najsilniejszy obecny sygnał dotyczy etapu RESPONSE. Wniosek ma poziom pewności: PRAWDOPODOBNY_WNIOSEK.'
    } })
  }));

  await page.goto('/');
  await expect(page.locator('#appView')).not.toHaveClass(/hidden/);
  await expect(page.locator('[data-view="bottleneck"]:visible').first()).toBeVisible();
  await page.locator('[data-view="bottleneck"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Gdzie naprawdę zatrzymuje się proces?' })).toBeVisible();
  const result = page.locator('#bottleneckResult');
  await expect(result).toContainText('PRAWDOPODOBNY WNIOSEK');
  await expect(result).toContainText('Próbka: 12');
  await expect(result).toContainText('Dowody');
  await expect(result).toContainText('Inne możliwe wyjaśnienia');
  await expect(result).toContainText('uzupełnij brakujące wyniki');
  await expect(result).not.toContainText(/Twoje CV jest złe|na pewno|zawsze musisz/i);

  await page.getByRole('button', { name: 'Przelicz' }).click();
  await expect(page.locator('#bottleneckMessage')).toContainText('Analiza gotowa');

  const axe = await new AxeBuilder({ page }).include('[data-screen="bottleneck"]').analyze();
  expect(axe.violations).toEqual([]);
});
