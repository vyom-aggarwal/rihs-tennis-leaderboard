/**
 * The publishing workflow on a deployment with the coach password configured: nothing
 * published -> coach signs in -> previews the sheet -> publishes -> the team sees it.
 * These tests share one server's store, so they run in order.
 */

import { expect, test, type Page } from '@playwright/test';

const BASE = 'http://127.0.0.1:4310';
const PASSWORD = 'rihs-e2e-password';
const SHEET = 'https://docs.google.com/spreadsheets/d/E2EFixtureSheet00000000000000000000000000/edit#gid=';

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: BASE });

async function signIn(page: Page, password = PASSWORD, name = 'Lokesh') {
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Coach password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('a visitor sees that nothing is published yet, and a wrong password is refused', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The ladder has not been published yet' })).toBeVisible();

  await page.getByRole('button', { name: 'Coach sign-in' }).click();
  await expect(page.getByLabel('Your name')).toBeFocused();
  await page.getByLabel('Your name').fill('Lokesh');
  await page.getByLabel('Coach password').fill('x');
  await page.getByLabel('Your name').fill('');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled(); // a name is required
  await signIn(page, 'not-the-password');
  await expect(page.getByRole('alert')).toHaveText('That password is not right.');
});

test('the coach previews the sheet, adds the Roster and Doubles tabs, and publishes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Coach sign-in' }).click();
  await signIn(page);

  await expect(page.getByRole('heading', { name: 'Connect your scores sheet' })).toBeVisible();
  await page.getByLabel('Google Sheets link').fill(SHEET + '0');
  await page.getByRole('button', { name: 'Preview the ladder' }).click();

  await expect(page.getByText('Not published yet')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Boys Ladder' })).toHaveAttribute('aria-selected', 'true');

  // The match tab cannot double as the roster.
  await page.getByLabel('Roster tab link').fill(SHEET + '0');
  await page.getByLabel('Roster tab link').press('Enter');
  await expect(page.getByText('That is your match results tab.', { exact: false })).toBeVisible();

  await page.getByLabel('Roster tab link').fill(SHEET + '111');
  await page.getByLabel('Roster tab link').press('Enter');
  await expect(page.getByText('Roster tab connected')).toBeVisible();
  await expect(page.locator('.ds-row').first().locator('.ds-player-meta')).toHaveText('Senior · Varsity');

  await page.getByLabel('Doubles tab link').fill(SHEET + '222');
  await page.getByLabel('Doubles tab link').press('Enter');
  await expect(page.getByRole('group', { name: 'Singles or doubles' })).toBeVisible();

  await page.getByLabel('Note for the publish history (optional)').fill('Season start');
  await page.getByRole('button', { name: 'Publish to team' }).click();
  await expect(page.locator('.ds-publish')).toHaveCount(0);

  const status = await page.request.get('/api/ladder').then((r) => r.json());
  expect(status.published.note).toBe('Season start');
  expect(status.published.coach).toBe('Lokesh');
  expect(status.published.query).toContain('roster=111');
  expect(status.published.query).toContain('doubles=222');
  expect(status.lastUpdate).toMatchObject({ coach: 'Lokesh', kind: 'publish' });
});

test('the team sees which coach last changed the leaderboard, and when', async ({ browser }) => {
  const team = await browser.newPage();
  await team.goto(BASE + '/');
  await expect(team.locator('.ds-last-change')).toHaveText('Coach Lokesh updated the leaderboard just now');
  await team.close();
});

test('a coach refreshes the leaderboard under their own name, and the team sees it', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await signIn(page, PASSWORD, 'Ana Rivera');
  await page.getByRole('button', { name: 'Refresh as Coach Ana Rivera' }).click();
  await expect(page.locator('.ds-last-change')).toHaveText('Coach Ana Rivera updated the leaderboard just now');
  await expect(page.getByText('Coach Ana Rivera refreshed just now')).toBeVisible();

  const team = await browser.newPage();
  await team.goto(BASE + '/');
  await expect(team.locator('.ds-last-change')).toContainText('Coach Ana Rivera updated the leaderboard');
  await expect(team.getByRole('button', { name: /Refresh as/ })).toHaveCount(0);
  await team.close();
});

test('the team sees the published ladder at the plain address, with no coach tools', async ({ browser }) => {
  const team = await browser.newPage();
  await team.goto(BASE + '/');
  await expect(team.locator('.ds-row').first()).toContainText('Jake Whitmore');
  await expect(team.getByRole('button', { name: 'Coach console' })).toHaveCount(0);
  await expect(team.getByRole('button', { name: 'Coach', exact: true })).toBeVisible();

  await team.getByRole('button', { name: 'Doubles' }).click();
  await expect(team.getByRole('columnheader', { name: 'Pair' })).toBeVisible();
  await expect(team).toHaveURL(/ladder=Boys%3Adoubles/);
  await team.close();
});

test('a link naming another sheet or the coach flag cannot change what the team sees', async ({ browser }) => {
  const team = await browser.newPage();
  await team.goto(BASE + '/?sheet=AnotherSpreadsheetId000000000000000000&coach=1&range=1');
  await expect(team.locator('.ds-row').first()).toContainText('Jake Whitmore');
  await expect(team.getByRole('button', { name: 'Coach console' })).toHaveCount(0);
  await expect(team).toHaveURL(BASE + '/');
  await team.close();
});

test('the coach changes a rule, and the publish history can restore the earlier version', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await signIn(page);

  await page.getByLabel('Challenge range (spots)').fill('4');
  await expect(page.getByText('Unpublished changes')).toBeVisible();
  await page.getByLabel('Note for the publish history (optional)').fill('Range 4');
  await page.getByRole('button', { name: 'Publish to team' }).click();
  await expect(page.locator('.ds-publish')).toHaveCount(0);

  await page.getByRole('button', { name: 'Show publish history' }).click();
  await expect(page.getByText('Range 4', { exact: true })).toBeVisible();
  await expect(page.getByText('Season start', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Unpublished changes')).toBeVisible();
  await expect(page.getByLabel('Challenge range (spots)')).toHaveValue('3');

  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('.ds-publish')).toHaveCount(0);
  await expect(page.getByLabel('Challenge range (spots)')).toHaveValue('4');
});

test('a returning visitor still sees the saved ladder when the site cannot be reached', async ({ browser }) => {
  const context = await browser.newContext();
  const team = await context.newPage();
  await team.goto(BASE + '/');
  await expect(team.locator('.ds-row').first()).toContainText('Jake Whitmore');

  await team.route('**/api/ladder', (route) => route.abort());
  await team.reload();
  await expect(team.locator('.ds-row').first()).toContainText('Jake Whitmore');
  await expect(team.getByText('Showing the last ladder saved on this device')).toBeVisible();
  await context.close();
});

test('a coach session survives a reload, and signing out removes the coach tools', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await signIn(page);
  await expect(page.getByRole('button', { name: 'Close console' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Coach console' })).toBeVisible();
  await page.getByRole('button', { name: 'Coach console' }).click();
  await page.getByRole('button', { name: 'Sign out of coach mode' }).click();
  await expect(page.getByRole('button', { name: 'Coach', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Coach console' })).toHaveCount(0);
});
