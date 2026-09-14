/** Deployments that cannot publish: storage not connected yet, and a static host. */

import { expect, test } from '@playwright/test';

test.describe('publishing not configured yet', () => {
  test.use({ baseURL: 'http://127.0.0.1:4311' });

  test('explains the missing setup step and still offers the demo', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'This ladder site is not set up yet' })).toBeVisible();
    await expect(page.getByText('connect an Upstash Redis database', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Coach sign-in' })).toHaveCount(0);

    await page.getByRole('button', { name: 'See a demo' }).click();
    await expect(page.getByText('Demo data')).toBeVisible();
    await expect(page.locator('.ds-row').first()).toContainText('Jake Whitmore');
  });
});

test.describe('static host without the publishing API', () => {
  test.use({ baseURL: 'http://127.0.0.1:4312' });

  test('falls back to link-based sharing', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Connect your scores sheet' })).toBeVisible();
    await page.getByRole('button', { name: 'See a demo first' }).click();
    await expect(page).toHaveURL(/sheet=__demo__/);
    await expect(page.getByRole('button', { name: 'Coach console' })).toBeVisible();
  });
});
