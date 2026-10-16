import { test, expect, type Page } from '@playwright/test';

async function localEvidence(page: Page, sessions: unknown[], scannedAt = new Date().toISOString()) {
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions, sources: [], scannedAt } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
}

test('attention summary opens the complete queue and returns focus', async ({ page }) => {
  await page.goto('/');
  const summary = page.locator('.attention-summary');
  await summary.click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'A little heads-up' })).toBeVisible();
  await expect(page.locator('.notification-list button')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(summary).toBeFocused();
});

test('priority work precedes the network and storage order remains unchanged', async ({ page }) => {
  const titles = ['Recent low', 'Older high', 'In progress', 'Medium', 'Another low', 'Finished'];
  await page.addInitScript(({ titles }) => {
    localStorage.setItem('agency.demoTasks', JSON.stringify(titles.map((title, i) => ({
      id: `priority-${i}`, title, description: '', project: 'fixture', provider: 'claude',
      status: i === 2 ? 'in_progress' : i === 5 ? 'done' : 'todo',
      priority: i === 1 ? 'high' : i === 3 ? 'medium' : 'low', revision: 1,
      createdAt: `2026-10-${String(16 - i).padStart(2, '0')}T12:00:00Z`, updatedAt: '2026-10-16T12:00:00Z',
    }))));
  }, { titles });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const positions = await page.evaluate(() => ['.agents-section', '.tasks-preview', '.network-overview'].map(selector => document.querySelector(selector)!.getBoundingClientRect().top));
  expect(positions[0]).toBeLessThan(positions[2]);
  expect(positions[1]).toBeLessThan(positions[2]);
  await expect(page.locator('.tasks-preview .task-main > span')).toHaveText(['In progress', 'Older high', 'Medium', 'Another low']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agency.demoTasks')!).map((t: {title: string}) => t.title))).toEqual(titles);
});

test('activity dates support keyboard and touch inspection with exact table values', async ({ page }) => {
  await page.goto('/');
  const chart = page.locator('.chart-panel');
  const bucket = chart.getByRole('button', { name: /Claude.*Codex/ }).last();
  await bucket.focus();
  await page.keyboard.press('Enter');
  await expect(bucket).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.getByRole('region', { name: 'Activity date details' })).toContainText('Claude');
  await page.keyboard.press('Escape');
  await expect(bucket).toHaveAttribute('aria-pressed', 'false');
  await chart.getByText('View activity data', { exact: true }).click();
  await expect(chart.getByRole('table')).toBeVisible();
  await expect(chart.getByRole('table').locator('tbody tr')).toHaveCount(7);
  await page.getByRole('combobox', { name: 'Activity chart period' }).selectOption('24h');
  await expect(chart.getByRole('table').locator('tbody tr')).toHaveCount(12);
});

test('observation freshness advances and distinguishes independent task failures', async ({ page }) => {
  const now = new Date('2026-10-16T12:00:00Z');
  await page.clock.install({ time: now });
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], sources: [], scannedAt: now.toISOString() } }));
  await page.route('**/api/tasks', route => route.fulfill({ status: 500, json: { error: 'Task fixture unavailable' } }));
  await page.goto('/');
  const freshness = page.locator('.workspace-freshness');
  await expect(freshness).toHaveAttribute('data-state', 'current');
  await expect(freshness).toHaveAttribute('data-tasks-state', 'error');
  await expect(freshness).toContainText('10s');
  await page.clock.fastForward(130000);
  await expect(freshness).toHaveAttribute('data-state', 'stale');
  await expect(freshness).toContainText('2m ago');
});

test('failed initial session read shows unavailable evidence while loaded tasks remain usable', async ({ page }) => {
  const now = new Date().toISOString();
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ status: 500, json: { error: 'Session fixture unavailable' } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [{ id: 'loaded-task', title: 'Independently loaded task', description: '', project: 'fixture', provider: 'claude', status: 'todo', priority: 'high', revision: 1, createdAt: now, updatedAt: now }] }));
  await page.goto('/');
  await expect(page.locator('.workspace-freshness')).toHaveAttribute('data-state', 'unavailable');
  await expect(page.locator('.attention-summary .summary-value')).toContainText('—');
  await expect(page.locator('.attention-summary')).not.toContainText('All clear');
  await expect(page.locator('.tasks-preview').getByRole('button', { name: /Independently loaded task/ }).first()).toBeVisible();
  await expect(page.locator('.chart-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const notifications = page.getByRole('dialog', { name: 'A little heads-up' });
  await expect(notifications.getByRole('heading', { name: 'Session data unavailable' })).toBeVisible();
  await expect(notifications).not.toContainText('No attention items were found in your sessions.');
});

test('24h activity stays within a 390px page with horizontally scrollable dates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Activity chart period' }).selectOption('24h');
  const chart = page.getByRole('group', { name: 'Observed log starts by date' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await chart.getByRole('button').last().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Activity date details' })).toContainText('log starts');
});

test('relative activity windows advance while demo data remains unchanged', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T12:00:00Z') });
  await page.goto('/');
  const last = page.getByRole('group', { name: 'Observed log starts by date' }).getByRole('button').last();
  const before = await last.getAttribute('aria-label');
  await page.clock.fastForward(86400000);
  await expect.poll(() => last.getAttribute('aria-label')).not.toBe(before);
});

test('running counts use the same deduplicated identity as runs in focus', async ({ page }) => {
  const now = new Date().toISOString();
  const run = { nativeId: 'same-native-thread', provider: 'codex', title: 'Copied log', project: 'fixture', model: 'gpt-fixture', status: 'running', kind: 'session', startedAt: now, updatedAt: now, tokens: 100, events: [], partial: false };
  await localEvidence(page, [{ ...run, id: 'first-log' }, { ...run, id: 'copied-log' }]);
  await page.goto('/');
  await expect(page.locator('.summary-item').first().locator('.stat-context')).toHaveText('1 working');
});

test('calendar activity includes the first hour of a daylight-saving fallback date', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'America/New_York' });
  const page = await context.newPage();
  try {
    await page.clock.install({ time: new Date('2026-11-02T17:00:00Z') });
    const stamp = '2026-11-01T04:30:00Z';
    await localEvidence(page, [{ id: 'dst-log', nativeId: 'dst-native', provider: 'claude', title: 'Fallback date', project: 'fixture', model: 'claude-fixture', status: 'completed', startedAt: stamp, updatedAt: stamp, tokens: null, events: [], partial: false }]);
    await page.goto('http://127.0.0.1:5173/');
    await expect(page.getByRole('button', { name: /Nov 1, 2026.*Claude 1, Codex 0 log starts/ })).toBeVisible();
  } finally { await context.close(); }
});
