import { test, expect, type Page } from '@playwright/test';

const start = Date.parse('2026-10-16T12:00:00Z');
const sessions = Array.from({ length: 4 }, (_, sessionIndex) => ({
  id: `activity-${sessionIndex}`, nativeId: `activity-native-${sessionIndex}`, title: `Session fixture ${sessionIndex}`, name: `Fixture agent ${sessionIndex}`, provider: sessionIndex < 2 ? 'claude' : 'codex', project: `project-${sessionIndex}`, model: 'fixture-model', status: 'completed', startedAt: new Date(start).toISOString(), updatedAt: new Date(start + 140000).toISOString(), tokens: null,
  events: Array.from({ length: 35 }, (_, eventIndex) => ({ id: `event-${eventIndex}`, label: `${sessionIndex === 0 ? 'Unique' : 'Shared'} operation ${sessionIndex}-${eventIndex}`, kind: 'tool', timestamp: new Date(start + (sessionIndex * 35 + eventIndex) * 1000).toISOString() })),
}));
async function fixture(page: Page, values: object[] = sessions) {
  let writes = 0;
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: values, sources: [], scannedAt: new Date().toISOString() } }));
  await page.route('**/api/tasks**', route => { if (route.request().method() !== 'GET') writes++; return route.fulfill({ json: [] }); });
  await page.goto('/#activity');
  await expect(page.getByRole('heading', { name: 'The story so far', exact: true })).toBeVisible();
  return () => writes;
}
const counts = (page: Page) => page.getByRole('status', { name: 'Activity result counts', exact: true });

test('activity counts retained matches before the cap, preserves order and opens source session', async ({ page }) => {
  const writes = await fixture(page);
  await expect(page.locator('.activity-feed.full .activity-item')).toHaveCount(100);
  await expect(counts(page)).toHaveText('Showing 100 of 140 matching events · 140 retained supported events in the current workspace');
  await expect(page.locator('.activity-feed.full .activity-item').first()).toContainText('shared operation 3-34');
  await page.getByRole('textbox', { name: 'Search activity…' }).fill('Unique');
  await expect(counts(page)).toContainText('Showing 35 of 35 matching events · 140 retained');
  await expect(page.locator('.activity-feed.full .activity-item')).toHaveCount(35);
  await page.locator('.activity-feed.full .activity-item').first().click();
  await expect(page.getByRole('heading', { name: 'Recent session events', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Session fixture 0');
  await page.keyboard.press('Escape');
  await expect(page.locator('.activity-feed.full .activity-item').first()).toBeFocused();
  expect(writes()).toBe(0);
});

test('query and provider no-match state resets only activity filters with keyboard on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await fixture(page);
  await page.getByRole('textbox', { name: 'Search activity…' }).fill('Unique');
  await page.getByRole('combobox', { name: 'Filter by provider' }).selectOption('codex');
  await expect(page.getByRole('heading', { name: 'No activity matches', exact: true })).toBeVisible();
  await expect(counts(page)).toContainText('Showing 0 of 0 matching events · 140 retained');
  const reset = page.getByRole('button', { name: 'Reset activity filters', exact: true });
  await reset.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Search activity…' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Filter by provider' })).toHaveValue('all');
  await expect(page.locator('.activity-feed.full .activity-item')).toHaveCount(100);
  await expect(reset).toHaveCount(0);
  await expect(page).toHaveURL(/#activity$/);
  expect(await page.evaluate(() => localStorage.getItem('agency.mode'))).toBe('local');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(writes()).toBe(0);
});

test('true empty activity explains retained scope rather than asserting no activity', async ({ page }) => {
  await fixture(page, []);
  await expect(page.getByRole('heading', { name: 'No retained activity', exact: true })).toBeVisible();
  await expect(counts(page)).toContainText('Showing 0 of 0 matching events · 0 retained');
  await expect(page.locator('.activity-page-panel')).toContainText('does not establish that no agent activity occurred');
  await expect(page.getByRole('button', { name: 'Reset activity filters', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search activity…' }).fill('Anything');
  await expect(page.getByRole('heading', { name: 'No retained activity', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset activity filters', exact: true })).toBeVisible();
});

test('overview compact six rows and demo/local data isolation remain unchanged', async ({ page }) => {
  await fixture(page);
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.recent-activity .activity-item')).toHaveCount(6);
  await expect(page.locator('.recent-activity .activity-item').first()).toContainText('shared operation 3-34');
  await expect(counts(page)).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Demo workspace Explore sample agents/ }).click();
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page.locator('.connection-indicator')).toHaveText('Demo workspace');
  await expect(page.locator('.activity-page-panel')).not.toContainText('operation 3-34');
  await expect(counts(page)).toContainText('retained supported events in the current workspace');
  await expect(page.locator('.activity-page-panel')).toContainText('not complete history or live process activity');
});
