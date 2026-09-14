import { test, expect } from '@playwright/test';

const TECHNICAL_FIRST_DECISION_LIMIT_MS = 180_000;
const uniqueEmail = (): string => `time-to-decision-${Date.now()}-${Math.random().toString(16).slice(2)}@example.pl`;

test('technical happy path reaches the first Decision Card within 3 minutes', async ({ page }) => {
  const startedAt = Date.now();

  await page.goto('/');
  await page.getByRole('button', { name: 'Załóż konto', exact: true }).click();
  await page.locator('#registerForm input[name="name"]').fill('Tester Czasu');
  await page.locator('#registerForm input[name="email"]').fill(uniqueEmail());
  await page.locator('#registerForm input[name="password"]').fill('Bezpieczne123');
  await page.locator('#registerForm input[name="acceptTerms"]').check();
  await page.locator('#registerForm input[name="acceptPrivacy"]').check();
  await page.locator('#registerForm').getByRole('button', { name: /Załóż konto i rozpocznij/ }).click();
  await expect(page.locator('#appView')).not.toHaveClass(/hidden/);

  await page.locator('[data-view="profile"]:visible').first().click();
  await page.locator('#profileForm input[name="desiredRoles"]').fill('magazynier');
  await page.locator('#profileForm input[name="location"]').fill('Gdynia');
  await page.locator('#profileForm input[name="commuteKm"]').fill('25');
  await page.locator('#profileForm input[name="salaryMin"]').fill('5500');
  await page.locator('#profileForm input[name="contract"][value="UOP"]').check();
  await page.locator('#profileForm input[name="remote"][value="ONSITE"]').check();
  await page.getByRole('button', { name: 'Zapisz profil' }).click();
  await expect(page.locator('#toast')).toContainText('Profil zapisany');

  await page.locator('#factForm select[name="type"]').selectOption('CREDENTIAL');
  await page.locator('#factForm input[name="value"]').fill('UDT');
  await page.locator('#factForm').getByRole('button', { name: 'Dodaj jako potwierdzone' }).click();
  await expect(page.locator('#factsList')).toContainText('UDT');

  await page.locator('[data-view="job"]:visible').first().click();
  await page.locator('#jobForm textarea[name="text"]').fill('Magazynier\nFirma: Logistyka ABC\nMiejsce pracy: Gdynia\nUmowa o pracę\nWynagrodzenie 6000 - 7000 PLN brutto\nWymagania: UDT. Mile widziane WMS.\nPraca stacjonarna.');
  await page.getByRole('button', { name: 'Sprawdź, czy warto aplikować' }).click();
  await expect(page.locator('#decisionArea')).toContainText(/WARTO APLIKOWAĆ|APLIKUJ TERAZ|ROZWAŻ/);

  const elapsedMs = Date.now() - startedAt;
  console.log(`FIRST_DECISION_TECHNICAL_MS=${elapsedMs}`);
  expect(elapsedMs, `technical happy path took ${elapsedMs} ms`).toBeLessThanOrEqual(TECHNICAL_FIRST_DECISION_LIMIT_MS);
});
