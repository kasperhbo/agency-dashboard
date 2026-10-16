import { test, expect, type Page } from '@playwright/test';

const now = '2026-10-16T12:00:00.000Z';
const task = (id: string, status = 'todo', priority = 'high') => ({ id, title: `Local ${id}`, description: 'Attention fixture', project: 'fixture', provider: 'claude', status, priority, revision: 1, createdAt: now, updatedAt: now });
const session = (id: string, nativeId: string, status: string, updatedAt = now) => ({ id, nativeId, title: `Local ${id}`, project: 'fixture', provider: 'claude', model: 'claude-fixture', status, startedAt: now, updatedAt, tokens: null, events: [] });
const sessions = [session('waiting-old-copy', 'same-run', 'waiting', '2026-10-16T11:59:00Z'), session('waiting-current', 'same-run', 'waiting'), session('error-current', 'error-run', 'error'), session('running-excluded', 'running-run', 'running')];
const tasks = [task('high-todo'), task('high-progress', 'in_progress'), task('done-excluded', 'done'), task('medium-excluded', 'todo', 'medium')];
async function fixture(page: Page, empty = false, initialFailure = false, partial = false) {
  let failed = initialFailure;
  await page.clock.install({ time: new Date(now) });
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => failed ? route.fulfill({ status: 503, json: { error: 'Fixture session failure' } }) : route.fulfill({ json: { sessions: empty ? [] : sessions, scannedAt: now, sources: partial ? [{ provider: 'claude', path: '/fixture', status: 'connected', count: 4, limited: true, warnings: ['Fixture partial scan'] }] : [] } }));
  await page.route('**/api/tasks', route => failed ? route.fulfill({ status: 503, json: { error: 'Fixture task failure' } }) : route.fulfill({ json: empty ? [] : tasks }));
  await page.goto('/#attention');
  await expect(page.getByRole('group', { name: 'Attention views', exact: true })).toBeVisible();
  return { fail: () => { failed = true; } };
}
const sessionTab = (page: Page) => page.getByRole('group', { name: 'Attention views', exact: true }).getByRole('button', { name: /^Sessions/ });
const taskTab = (page: Page) => page.getByRole('group', { name: 'Attention views', exact: true }).getByRole('button', { name: /^High-priority tasks/ });

test('Attention reuses deduplicated session signals and independent unfinished high-priority task counts with clickthrough', async ({ page }) => {
  await fixture(page);
  await expect(page.locator('h1')).toHaveText('Attention.');
  await expect(page.getByRole('link', { name: 'Attention', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(sessionTab(page)).toHaveText('Sessions 2');
  await expect(taskTab(page)).toHaveText('High-priority tasks 2');
  const panel = page.getByRole('region', { name: 'Session attention', exact: true });
  await expect(panel.getByRole('button', { name: /^Open attention session/ })).toHaveCount(2);
  await expect(panel).not.toContainText('Local waiting-old-copy');
  await expect(panel).not.toContainText('Local running-excluded');
  await panel.getByRole('button', { name: 'Open attention session Local waiting-current', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Session details', exact: true })).toContainText('Local waiting-current');
  await page.keyboard.press('Escape');
  await taskTab(page).focus(); await page.keyboard.press('Space');
  await expect(taskTab(page)).toHaveAttribute('aria-pressed', 'true');
  const taskPanel = page.getByRole('region', { name: 'High-priority task attention', exact: true });
  await expect(taskPanel.getByRole('button', { name: /^Edit high-priority task/ })).toHaveCount(2);
  await expect(taskPanel).not.toContainText('done-excluded');
  await expect(taskPanel).not.toContainText('medium-excluded');
  await taskPanel.getByRole('button', { name: 'Edit high-priority task Local high-progress', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue('Local high-progress');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Notifications, 2 need attention/ }).click();
  await expect(page.locator('.notification-list button')).toHaveCount(2);
});

test('successful empty reads have scoped empty messages', async ({ page }) => {
  await fixture(page, true);
  await expect(page.getByRole('heading', { name: 'No waiting or error sessions observed', exact: true })).toBeVisible();
  await taskTab(page).click();
  await expect(page.getByRole('heading', { name: 'No open high-priority tasks observed', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.attention-summary')).toContainText('All clear');
  await expect(page.locator('.attention-summary .summary-value')).toContainText('0');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'You’re all caught up', exact: true })).toBeVisible();
});

test('failed initial reads stay unknown independently', async ({ page }) => {
  await fixture(page, true, true);
  await expect(sessionTab(page)).toHaveText('Sessions —');
  await expect(taskTab(page)).toHaveText('High-priority tasks —');
  await expect(page.getByRole('heading', { name: 'Attention status unconfirmed', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Session attention', exact: true })).toContainText('not been successfully observed');
  await taskTab(page).click();
  await expect(page.getByRole('heading', { name: 'Attention status unconfirmed', exact: true })).toBeVisible();
});

test('retained stale failures keep items and never present an all-clear', async ({ page }) => {
  const state = await fixture(page);
  state.fail();
  await page.clock.fastForward(130000);
  const panel = page.getByRole('region', { name: 'Session attention', exact: true });
  await expect(panel).toHaveAttribute('data-state', 'uncertain');
  await expect(panel).toContainText('latest read failed');
  await expect(panel).toContainText('observation is stale');
  await expect(panel.getByRole('button', { name: /^Open attention session/ })).toHaveCount(2);
  await expect(sessionTab(page)).toHaveText('Sessions 2');
  await taskTab(page).click();
  const taskPanel = page.getByRole('region', { name: 'High-priority task attention', exact: true });
  await expect(taskPanel).toHaveAttribute('data-state', 'uncertain');
  await expect(taskPanel).toContainText('observation is stale');
  await expect(taskPanel.getByRole('button', { name: /^Edit high-priority task/ })).toHaveCount(2);
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.attention-summary .summary-value')).toContainText('2');
  await expect(page.locator('.attention-summary')).toContainText('Unconfirmed');
  await expect(page.locator('.attention-preview')).toContainText('Retained attention items · freshness or source coverage is uncertain');
  await page.getByRole('button', { name: /Notifications, 2 need attention/ }).click();
  await expect(page.locator('.notification-list button')).toHaveCount(2);
  await expect(page.getByRole('dialog')).toContainText('Session attention is unconfirmed');
});

test('partial empty session discovery is unconfirmed while independently loaded empty tasks are observed', async ({ page }) => {
  await fixture(page, true, false, true);
  await expect(page.getByRole('heading', { name: 'Attention status unconfirmed', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Session attention', exact: true })).toContainText('discovery is partial');
  await taskTab(page).click();
  await expect(page.getByRole('heading', { name: 'No open high-priority tasks observed', exact: true })).toBeVisible();
});

test('partial retained Overview preview carries the same uncertainty caveat without hiding its items', async ({ page }) => {
  await fixture(page, false, false, true);
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.attention-preview')).toContainText('Retained attention items · freshness or source coverage is uncertain');
  await expect(page.locator('.attention-preview')).toContainText('Review source context in Attention');
  await expect(page.locator('.attention-preview-list button')).toHaveCount(2);
});

test('mobile source changes keep demo attention separate and reset the selected view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, false, false, true);
  await taskTab(page).click();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: /My workspace/ }).click();
  await page.locator('#workspace-menu').getByRole('button', { name: /Demo workspace/ }).click();
  await page.getByRole('button', { name: 'Close navigation' }).click();
  await expect(sessionTab(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Session attention', exact: true })).toContainText('Demo sample data only');
  await expect(page.getByRole('region', { name: 'Session attention', exact: true })).toHaveAttribute('data-state', 'observed');
  await expect(page.getByRole('region', { name: 'Session attention', exact: true })).not.toContainText('Local waiting-current');
  await taskTab(page).click();
  await expect(page.getByRole('region', { name: 'High-priority task attention', exact: true })).not.toContainText('Local high-todo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.getByRole('dialog')).not.toContainText('Session attention is unconfirmed');
});

for (const reason of ['failed', 'stale', 'partial', 'unavailable'] as const) {
  test(`empty ${reason} observation remains unconfirmed across Overview, bell and Attention`, async ({ page }) => {
    const state = await fixture(page, true);
    if (reason === 'failed') state.fail();
    if (reason === 'partial' || reason === 'unavailable') await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], scannedAt: now, sources: [{ provider: 'claude', path: '/fixture', status: reason === 'unavailable' ? 'not_found' : 'connected', count: 0, limited: reason === 'partial', warnings: [] }] } }));
    if (reason === 'stale') {
      await page.getByRole('link', { name: 'Overview', exact: true }).click();
      await expect(page.locator('.attention-summary')).toContainText('All clear');
      await page.clock.fastForward(130000);
      await expect(page.locator('.attention-summary')).toContainText('Unconfirmed');
      await page.getByRole('link', { name: 'Attention', exact: true }).click();
    } else await page.getByRole('button', { name: 'Refresh workspace', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Session attention', exact: true })).toHaveAttribute('data-state', 'uncertain');
    await expect(sessionTab(page)).toHaveText('Sessions —');
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page.locator('.attention-summary')).toContainText('Unconfirmed');
    await expect(page.locator('.attention-summary .summary-value')).toContainText('—');
    await expect(page.locator('.attention-summary')).not.toContainText('All clear');
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Session data unavailable', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Session attention is unconfirmed');
    await expect(page.getByRole('heading', { name: 'You’re all caught up', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Attention', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Attention status unconfirmed', exact: true })).toBeVisible();
  });
}
