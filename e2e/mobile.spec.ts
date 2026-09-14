/** PRD 7: the ladder on a phone held courtside. */

import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4312' });

test('fits a phone screen, keeps status badges visible, and expands a row on tap', async ({ page }) => {
  await page.goto('/?sheet=__demo__');
  const first = page.locator('.ds-row').first();
  await expect(first).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await expect(page.locator('.ds-col-status').first()).toBeHidden();
  await expect(first.locator('.ds-status-inline .ds-badge')).toBeVisible();

  await first.tap();
  await expect(page.locator('.ds-detail-row')).toBeVisible();

  await page.getByRole('button', { name: 'Doubles' }).tap();
  await expect(page.locator('.ds-row').first()).toContainText(' / ');
  const doublesOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(doublesOverflow).toBeLessThanOrEqual(0);
});
