import { test, expect } from '@playwright/test';

test('visible form controls have accessible names and keyboard focus is visible', async ({ page }) => {
  await page.goto('/');
  const controls = page.locator('input:visible, textarea:visible, select:visible, button:visible, a:visible');
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    const name = await control.getAttribute('aria-label') ?? await control.innerText().catch(() => '') ?? await control.getAttribute('name') ?? '';
    const labelled = await control.evaluate(element => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        return element.labels?.length ? true : Boolean(element.getAttribute('aria-label') || element.getAttribute('aria-labelledby'));
      }
      return true;
    });
    expect(labelled, `Control ${i} (${name}) should have an accessible label`).toBeTruthy();
  }

  await page.keyboard.press('Tab');
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
  expect(focusedTag).not.toBe('BODY');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle);
  expect(outline).not.toBe('none');
});

test('interactive targets meet WCAG 2.2 minimum target size on visible landing controls', async ({ page }) => {
  await page.goto('/');
  const targets = page.locator('button:visible, a:visible');
  const count = await targets.count();
  for (let i = 0; i < count; i += 1) {
    const box = await targets.nth(i).boundingBox();
    if (!box) continue;
    expect(box.width, `target ${i} width`).toBeGreaterThanOrEqual(24);
    expect(box.height, `target ${i} height`).toBeGreaterThanOrEqual(24);
  }
});

test('reduced-motion preference disables screen animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Załóż konto', exact: true }).click();
  const animation = await page.locator('#registerForm').evaluate(element => getComputedStyle(element).animationName);
  expect(animation).toBe('none');
});

test('test-version legal information is publicly reachable and explicit about release blockers', async ({ page }) => {
  const privacy = await page.goto('/privacy.html');
  expect(privacy?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Informacja o prywatności' })).toBeVisible();
  await expect(page.getByText(/Publiczna beta jest zablokowana/)).toBeVisible();

  const terms = await page.goto('/terms.html');
  expect(terms?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Warunki korzystania z wersji testowej' })).toBeVisible();
});
