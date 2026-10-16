import { test, expect, type Page } from '@playwright/test';

const now = '2026-10-16T12:00:00Z';
const tasks = Array.from({ length: 7 }, (_, index) => ({ id: `search-task-${index}`, title: `Local task ${index}`, description: index === 6 ? 'Unique description only needle' : 'Broadmatch task detail', project: 'fixture', provider: 'claude', status: 'todo', priority: 'medium', revision: 1, createdAt: now, updatedAt: now }));
const sessions = Array.from({ length: 8 }, (_, index) => ({ id: `search-session-${index}`, nativeId: `search-native-${index}`, title: `Broadmatch session ${index}`, name: `Agent ${index}`, provider: 'claude', model: 'claude-fixture', project: 'fixture', status: 'completed', startedAt: now, updatedAt: now, tokens: null, events: [] }));
async function fixture(page: Page) {
  let mutations = 0;
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions, sources: [], scannedAt: new Date().toISOString() } }));
  await page.route('**/api/tasks**', route => {
    if (route.request().method() !== 'GET') mutations++;
    return route.fulfill({ json: tasks });
  });
  await page.goto('/#tasks');
  await expect(page.locator('.kanban-task')).toHaveCount(7);
  return () => mutations;
}
async function search(page: Page, query: string) {
  await page.getByRole('button', { name: /Quick search/ }).click();
  await page.getByRole('textbox', { name: 'Search workspace', exact: true }).fill(query);
  return page.getByRole('dialog', { name: 'Find your way', exact: true });
}

test('global search discloses full match counts while retaining caps and source order', async ({ page }) => {
  const mutations = await fixture(page);
  const dialog = await search(page, '  BROADMATCH  ');
  const sessionGroup = dialog.locator('.command-group').filter({ has: page.getByRole('heading', { name: 'Sessions · Showing 5 of 8 matches · Currently loaded Local data', exact: true }) });
  const taskGroup = dialog.locator('.command-group').filter({ has: page.getByRole('heading', { name: 'Tasks · Showing 4 of 6 matches · Currently loaded Local data', exact: true }) });
  await expect(sessionGroup.getByRole('button')).toHaveCount(5);
  await expect(sessionGroup.getByRole('button')).toHaveText(sessions.slice(0, 5).map(session => session.title + session.project));
  await expect(taskGroup.getByRole('button')).toHaveText(tasks.slice(0, 4).map(task => task.title));
  await sessionGroup.getByRole('button').first().click();
  await expect(page.getByRole('dialog', { name: /Claude Code/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Recent session events', exact: true })).toBeVisible();
  expect(mutations()).toBe(0);
});

test('description-only result opens its task editor; zero search hints at description and keyboard restores focus', async ({ page }) => {
  const mutations = await fixture(page);
  const trigger = page.getByRole('button', { name: /Quick search/ });
  const dialog = await search(page, 'unique description only needle');
  await expect(dialog.getByRole('heading', { name: 'Tasks · Showing 1 of 1 matches · Currently loaded Local data', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Local task 6', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue('Local task 6');
  await expect(page.getByRole('textbox', { name: 'Description optional', exact: true })).toHaveValue(tasks[6].description);
  await page.keyboard.press('Escape');
  await trigger.focus();
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Search workspace', exact: true }).fill('not-in-this-workspace');
  await expect(page.getByRole('heading', { name: 'Nothing found just yet', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('task title or description');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(mutations()).toBe(0);
});

test('search scopes local and demo matches separately and stays within a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  // Quick search lives in the mobile navigation; Ctrl+K opens the same dialog.
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Search workspace', exact: true }).fill('broadmatch');
  await expect(page.getByRole('heading', { name: 'Sessions · Showing 5 of 8 matches · Currently loaded Local data', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: /My workspace/ }).click();
  await page.locator('#workspace-menu').getByRole('button', { name: /Demo workspace/ }).click();
  await page.getByRole('button', { name: 'Close navigation' }).click();
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Search workspace', exact: true }).fill('broadmatch');
  await expect(page.getByRole('heading', { name: 'Nothing found just yet', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search workspace', exact: true }).fill('claude');
  await expect(page.getByRole('heading', { name: /Sessions · Showing \d+ of \d+ matches · Demo sample/ })).toBeVisible();
  await expect(page.getByRole('note', { name: 'Search data scope', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('textbox', { name: 'Search workspace', exact: true }).fill('settings');
  await page.getByRole('dialog').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForURL('**/#settings');
});

test('local search explains retained failures, stale observations and partial source coverage', async ({ page }) => {
  await fixture(page);
  const old = new Date(Date.now() - 300000).toISOString();
  let failed = false;
  await page.route('**/api/sessions', route => failed ? route.fulfill({ status: 503, json: { error: 'Fixture session refresh failed' } }) : route.fulfill({ json: { sessions, sources: [{ provider: 'claude', path: '/fixture', status: 'connected', count: 8, limited: true, warnings: ['Fixture partial scan'] }], scannedAt: old } }));
  await page.getByRole('button', { name: 'Refresh workspace', exact: true }).click();
  await expect(page.locator('.workspace-freshness')).toHaveAttribute('data-state', 'stale');
  failed = true;
  await page.route('**/api/tasks**', route => route.fulfill({ status: 503, json: { error: 'Fixture task refresh failed' } }));
  await page.getByRole('button', { name: 'Refresh workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Fixture session refresh failed');
  const dialog = await search(page, 'broadmatch');
  const note = dialog.getByRole('note', { name: 'Search data scope', exact: true });
  await expect(note).toContainText('not complete history or live process state');
  await expect(note).toContainText('Session refresh failed');
  await expect(note).toContainText('Task refresh failed');
  await expect(note).toContainText('session observation is stale');
  await expect(note).toContainText('Session discovery is partial or a source is unavailable');
  await expect(dialog.getByRole('heading', { name: 'Sessions · Showing 5 of 8 matches · Currently loaded Local data', exact: true })).toBeVisible();
});

test('local search does not imply successful observation when the initial session read fails', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ status: 503, json: { error: 'Fixture initial failure' } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: tasks }));
  await page.goto('/#tasks');
  await expect(page.locator('.kanban-task')).toHaveCount(7);
  const dialog = await search(page, 'unique description only needle');
  await expect(dialog.getByRole('note', { name: 'Search data scope', exact: true })).toContainText('No successful session observation is available');
  await expect(dialog.getByRole('note', { name: 'Search data scope', exact: true })).toContainText('Session refresh failed');
  await expect(dialog.getByRole('heading', { name: 'Tasks · Showing 1 of 1 matches · Currently loaded Local data', exact: true })).toBeVisible();
});
