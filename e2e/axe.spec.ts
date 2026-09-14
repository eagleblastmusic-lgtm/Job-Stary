import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const uniqueEmail = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.pl`;

async function expectNoWcagViolations(page: Page, surface: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
  const details = results.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary }))
  }));
  expect(results.violations, `${surface}: ${JSON.stringify(details, null, 2)}`).toEqual([]);
}

async function register(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Załóż konto', exact: true }).click();
  await page.locator('#registerForm input[name="name"]').fill('Axe Test');
  await page.locator('#registerForm input[name="email"]').fill(uniqueEmail('axe'));
  await page.locator('#registerForm input[name="password"]').fill('Bezpieczne123');
  await page.locator('#registerForm input[name="acceptTerms"]').check();
  await page.locator('#registerForm input[name="acceptPrivacy"]').check();
  await page.locator('#registerForm').getByRole('button', { name: /Załóż konto i rozpocznij/ }).click();
  await expect(page.locator('#appView')).not.toHaveClass(/hidden/);
}

async function openView(page: Page, view: string): Promise<void> {
  await page.locator(`[data-view="${view}"]:visible`).first().click();
  await expect(page.locator(`[data-screen="${view}"]`)).not.toHaveClass(/hidden/);
}

test('public surfaces have no automatically detectable WCAG 2.2 A/AA violations', async ({ page }) => {
  await page.goto('/');
  await expectNoWcagViolations(page, 'landing/login');

  await page.getByRole('button', { name: 'Załóż konto', exact: true }).click();
  await expectNoWcagViolations(page, 'registration');

  await page.goto('/privacy.html');
  await expectNoWcagViolations(page, 'privacy');

  await page.goto('/terms.html');
  await expectNoWcagViolations(page, 'terms');
});

test('authenticated MVP surfaces have no automatically detectable WCAG 2.2 A/AA violations', async ({ page }) => {
  await register(page);
  await expectNoWcagViolations(page, 'start');

  await openView(page, 'profile');
  await expectNoWcagViolations(page, 'profile/Career Truth');

  await openView(page, 'job');
  await expectNoWcagViolations(page, 'job input');
  await page.locator('#jobForm textarea[name="text"]').fill('Magazynier\nFirma: Axe Logistics\nMiejsce pracy: Gdynia\nUmowa o pracę\nWynagrodzenie 6000 PLN brutto\nWymagania: UDT.\nPraca stacjonarna.');
  await page.getByRole('button', { name: 'Sprawdź, czy warto aplikować' }).click();
  await expect(page.locator('#decisionArea .decision-card')).toBeVisible();
  await expectNoWcagViolations(page, 'Decision Card');

  await openView(page, 'applications');
  await expectNoWcagViolations(page, 'applications');

  await openView(page, 'privacy');
  await expectNoWcagViolations(page, 'privacy and plan');
});
