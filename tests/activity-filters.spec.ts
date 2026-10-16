import { test, expect, type Page } from '@playwright/test';

const now = Date.parse('2026-10-16T12:00:00.000Z');
function session(id: string, provider: 'claude' | 'codex', events: object[]) {
  return { id, nativeId: id, title: `${id} session`, name: `${id} agent`, provider, project: 'filter-fixture', model: 'fixture', status: 'completed', startedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), tokens: null, events };
}
async function openActivity(page: Page, sessions: object[], installClock = true) {
  if (installClock) await page.clock.install({ time: now });
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions, sources: [], scannedAt: new Date(now).toISOString() } }));
  await page.route('**/api/tasks**', route => route.fulfill({ json: [] }));
  await page.goto('/#activity');
  await expect(page.getByRole('heading', { name: 'The story so far', exact: true })).toBeVisible();
}
const counts = (page: Page) => page.getByRole('status', { name: 'Activity result counts', exact: true });

test('event type, provider, search and inclusive rolling boundary compose while unknown times are counted', async ({ page }) => {
  await openActivity(page, [
    session('claude', 'claude', [
      { id: 'now', label: 'Deploy current', kind: 'tool', timestamp: new Date(now).toISOString() },
      { id: 'boundary', label: 'Deploy boundary', kind: 'tool', timestamp: new Date(now - 60 * 60_000).toISOString() },
      { id: 'outside', label: 'Deploy too old', kind: 'tool', timestamp: new Date(now - 60 * 60_000 - 1).toISOString() },
      { id: 'future', label: 'Deploy future', kind: 'tool', timestamp: new Date(now + 1).toISOString() },
      { id: 'missing', label: 'Deploy no clock', kind: 'tool' },
      { id: 'invalid', label: 'Deploy invalid clock', kind: 'tool', timestamp: 'invalid-date' },
      { id: 'other-kind', label: 'Deploy completed', kind: 'success', timestamp: new Date(now).toISOString() },
    ]),
    session('codex', 'codex', [{ id: 'other-provider', label: 'Deploy other provider', kind: 'tool', timestamp: new Date(now).toISOString() }]),
  ]);

  await page.getByRole('textbox', { name: 'Search activity…' }).fill('deploy');
  await page.getByRole('combobox', { name: 'Filter by provider' }).selectOption('claude');
  await page.getByRole('combobox', { name: 'Filter by event type' }).selectOption('tool');
  page.clock.setFixedTime(now);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('combobox', { name: 'Activity time range' }).selectOption('1h');
  await expect(counts(page)).toHaveText('Showing 2 of 2 matching events · 8 retained supported events in the current workspace · 2 matching events with unknown timestamps (excluded)');
  await expect(page.locator('.activity-feed.full .activity-item')).toHaveCount(2);
  await expect(page.locator('.activity-feed.full')).toContainText('deploy current');
  await expect(page.locator('.activity-feed.full')).toContainText('deploy boundary');
  await expect(page.locator('.activity-feed.full')).not.toContainText('deploy too old');
  await expect(page.locator('.activity-feed.full')).not.toContainText('deploy future');
  await expect(page.locator('.activity-feed.full')).not.toContainText('deploy no clock');

  await page.getByRole('combobox', { name: 'Activity time range' }).selectOption('all');
  await expect(counts(page)).toHaveText('Showing 6 of 6 matching events · 8 retained supported events in the current workspace');
  await expect(page.locator('.activity-feed.full .activity-item')).toHaveCount(6);
});

test('rolling window follows current clock and preserves the 100-row cap with accurate retained counts', async ({ page }) => {
  const events = Array.from({ length: 105 }, (_, index) => ({ id: `event-${index}`, label: `Recent operation ${index}`, kind: 'tool', timestamp: new Date(now - index * 1000).toISOString() }));
  await openActivity(page, [session('many', 'claude', events)]);
  await expect(page.locator('.activity-feed.full .activity-item')).toHaveCount(100);
  await expect(counts(page)).toHaveText('Showing 100 of 105 matching events · 105 retained supported events in the current workspace');
  await expect(page.locator('.activity-feed.full .activity-item').first()).toContainText('recent operation 0');

  await page.getByRole('combobox', { name: 'Activity time range' }).selectOption('1h');
  await expect(counts(page)).toContainText('Showing 100 of 105 matching events · 105 retained');
  await page.clock.fastForward(60 * 60_000);
  await expect(counts(page)).toContainText('Showing 0 of 0 matching events · 105 retained');
  await expect(page.getByRole('heading', { name: 'No activity matches', exact: true })).toBeVisible();
});

test('filtered empty state resets all controls by keyboard on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const events = [{ id: 'one', label: 'A tool call', kind: 'tool', timestamp: new Date(now).toISOString() }];
  await openActivity(page, [session('mobile', 'claude', events)], false);
  await page.getByRole('combobox', { name: 'Filter by event type' }).selectOption('tool');
  await page.getByRole('textbox', { name: 'Search activity…' }).fill('no match');
  await expect(page.getByRole('heading', { name: 'No activity matches', exact: true })).toBeVisible();
  const reset = page.getByRole('button', { name: 'Reset activity filters', exact: true });
  await reset.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Search activity…' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Filter by event type' })).toHaveValue('all');
  await expect(page.getByRole('combobox', { name: 'Activity time range' })).toHaveValue('all');
  await expect(page.locator('.activity-feed.full .activity-item')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
