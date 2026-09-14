import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

async function mockAuthenticatedUser(page: Page): Promise<void> {
  await page.route('**/api/me', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      user: { id: 'ui-interview-user', email: 'interview-ui@example.pl', name: 'Tester Rozmowy', role: 'USER', locale: 'pl-PL', timezone: 'Europe/Warsaw' },
      profile: { desiredRoles: ['magazynier'], location: 'Gdynia', commuteKm: 25, remotePreferences: ['ONSITE'], salaryMin: 5500, contractPreferences: ['UOP'], shiftPreferences: { nights: null, weekends: null }, availability: 'od zaraz' },
      subscription: { plan: 'TRIAL', status: 'TRIALING' }
    })
  }));
  await page.route('**/api/career-truth', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ facts: [], experiences: [], education: [] }) }));
}

test('Interview Pack is truthful, complete and accessible', async ({ page }) => {
  await mockAuthenticatedUser(page);
  await page.route('**/api/features', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: { today: false, notifications: false, interview_pack: true } }) }));
  await page.route('**/api/applications', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ applications: [{ id: 'app-1', title: 'Magazynier', company: 'Logistyka ABC', status: 'INTERVIEW' }] }) }));
  await page.route('**/api/applications/app-1/interview-pack', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ pack: {
      companySummary: 'W ofercie podano firmę: Logistyka ABC. Nie mamy dodatkowych zweryfikowanych informacji o firmie poza treścią zapisanej oferty.',
      roleSummary: 'Stanowisko: Magazynier. Lokalizacja: Gdynia.',
      keyRequirements: ['UDT — wymagane', 'WMS — mile widziane'],
      strongestArguments: ['Potwierdzone w Career Truth: UDT — odpowiada wymaganiu „UDT”.'],
      potentialGaps: ['Nie mamy potwierdzenia w Career Truth: WMS. To nie znaczy, że tego nie umiesz — wyjaśnij to przed rozmową.'],
      likelyQuestions: ['Jakie masz prawdziwe doświadczenie związane z UDT?'],
      answerFrameworks: [{ question: 'Jakie masz prawdziwe doświadczenie związane z UDT?', framework: ['Sytuacja: wybierz prawdziwy przykład.', 'Działanie: bez dopisywania.', 'Rezultat: nie wymyślaj liczby.'] }],
      questionsToEmployer: ['Jakie rezultaty są najważniejsze w pierwszych 90 dniach?'],
      salaryPreparation: ['W ofercie podano wynagrodzenie: 6000–7000 PLN / mies. brutto.'],
      miniTest: ['Mini-test: wyjaśnij UDT i podaj prawdziwy przykład, jeśli go masz.'],
      checklist: ['Wybierz prawdziwe przykłady i nie twórz nowych historii.'],
      truthBoundary: 'Pakiet używa wyłącznie zapisanej oferty, profilu oraz Career Truth. Nie tworzy doświadczeń ani osiągnięć, których użytkownik nie podał lub nie potwierdził.'
    } })
  }));

  await page.goto('/');
  await expect(page.locator('#appView')).not.toHaveClass(/hidden/);

  await expect(page.locator('[data-view="interview"]:visible').first()).toBeVisible();
  await page.locator('[data-view="interview"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Przygotuj się do rozmowy' })).toBeVisible();
  await page.getByRole('button', { name: 'Przygotuj pakiet' }).click();
  const result = page.locator('#interviewPackResult');
  await expect(result).toContainText('Logistyka ABC');
  await expect(result).toContainText('Kluczowe wymagania');
  await expect(result).toContainText('Twoje najmocniejsze potwierdzone argumenty');
  await expect(result).toContainText('Nie mamy potwierdzenia w Career Truth: WMS');
  await expect(result).toContainText('Prawdopodobne pytania');
  await expect(result).toContainText('Przygotowanie wynagrodzenia');
  await expect(result).toContainText('Mini-test');
  await expect(result).toContainText('Granica prawdy');
  await expect(result).not.toContainText(/wymyślone doświadczenie|udawaj, że/i);

  const results = await new AxeBuilder({ page }).include('[data-screen="interview"]').analyze();
  expect(results.violations).toEqual([]);
});
