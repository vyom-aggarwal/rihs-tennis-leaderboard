/**
 * The ladder page itself, traced to the QA test cases. Uses the demo season on the
 * link-sharing server so no state is shared with the publishing tests.
 */

import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4312' });

test.beforeEach(async ({ page }) => {
  await page.goto('/?sheet=__demo__');
  await expect(page.locator('.ds-row').first()).toBeVisible();
});

test('TC-1.1.1: Boys and Girls tabs switch in under 500ms without a reload', async ({ page }) => {
  const boys = page.getByRole('tab', { name: 'Boys Ladder' });
  const girls = page.getByRole('tab', { name: 'Girls Ladder' });
  await expect(boys).toHaveAttribute('aria-selected', 'true');

  await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
  const started = Date.now();
  await girls.click();
  await expect(page.locator('.ds-row .ds-player-name').first()).toHaveText('Maya Lindqvist');
  expect(Date.now() - started).toBeLessThan(500);

  await expect(girls).toHaveAttribute('aria-selected', 'true');
  await expect(boys).toHaveAttribute('aria-selected', 'false');
  // Same document: nothing reloaded.
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);
});

test('TC-1.2.1: rows show rank, movement, avatar, name, grade, division and a status badge', async ({ page }) => {
  const marcus = page.locator('[data-row-key="marcus webb"]');
  await expect(marcus.locator('.ds-avatar')).toHaveText('MW');
  await expect(marcus.locator('.ds-player-meta')).toHaveText('Junior · Varsity');
  await expect(marcus.locator('.ds-col-status')).toHaveText('Injury Hold');
  await expect(marcus.locator('.ds-movement.up')).toContainText('2');
  await expect(page.locator('[data-row-key="ethan cole"] .ds-col-status')).toHaveText('Challenge Pending');
  await expect(page.locator('[data-row-key="jake whitmore"] .ds-col-status')).toHaveText('Available');
});

test('TC-2.1.1: an injured or already-challenged player cannot be challenged', async ({ page }) => {
  await page.locator('[data-row-key="adrian foster"]').click();
  const list = page.locator('.ds-challenge-list');
  await expect(list.locator('li')).toHaveCount(3);
  await expect(list).toContainText('Marcus Webb is on Injury Hold');
  await expect(list).toContainText('Johnny Park already has an open challenge');
  await expect(list.locator('.is-eligible')).toHaveCount(0);
  await expect(page.getByText('Ranks 1–3 are more than 3 spots ahead', { exact: false })).toBeVisible();
});

test('has no top-three spotlight, and opens a player from a leaderboard with their rank over time', async ({ page }) => {
  await expect(page.getByText('Leaders spotlight')).toHaveCount(0);
  await page.locator('.ds-board-name').first().click();
  const detail = page.locator('.ds-detail-row');
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('img', { name: /Rank over time/ })).toBeVisible();
});

test('shows doubles pairs and the upcoming doubles challenge', async ({ page }) => {
  await page.getByRole('button', { name: 'Doubles' }).click();
  await expect(page.getByRole('columnheader', { name: 'Pair' })).toBeVisible();
  await expect(page.locator('.ds-upcoming')).toContainText('Pedro Alvarez / Ravi Menon');
});

test('downloads the visible ladder as a CSV', async ({ page }) => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^rihs-boys-ladder-\d{4}-\d{2}-\d{2}\.csv$/);
  const content = await readFile((await download.path())!, 'utf8');
  expect(content.replace(/^﻿/, '').split('\r\n')[0]).toBe(
    'Rank,Movement,Player,Grade,Division,Status,Wins,Losses,Win %,Games won,Games lost,Rating,Provisional',
  );
  expect(content).toContain('Jake Whitmore');
});
