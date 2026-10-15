import { test, expect } from '@playwright/test';

test('overview is labeled, searchable, and opens inspectable sessions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your agents, in sync.' })).toBeVisible();
  await expect(page.locator('.connection-indicator')).toHaveText('Demo workspace');
  await expect(page.locator('.agent-grid .session-card')).toHaveCount(4);
  await page.locator('.agent-grid .session-card').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent session events' })).toBeVisible();
  await expect(page.getByText('This is a sample session. No agent is running from this dashboard.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.agent-grid .session-card').first()).toBeFocused();
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Search workspace' }).fill('authentication');
  await expect(page.getByRole('dialog').getByRole('button', { name: /Implement authentication/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('h1').click();
  await page.screenshot({ path: 'test-results/agency-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('tasks create, edit, move, persist, and delete in demo without touching local tasks', async ({ page }) => {
  let writes = 0;
  page.on('request', request => { if (request.url().includes('/api/tasks') && request.method() !== 'GET') writes++; });
  await page.goto('/#tasks');
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByRole('textbox', { name: 'Task title' }).fill('Verify Agency workflow');
  await page.getByRole('textbox', { name: 'Description optional' }).fill('Make sure the task board survives reload.');
  await page.getByRole('group', { name: 'Assign to' }).getByRole('button', { name: 'Codex', exact: true }).click();
  await page.getByRole('textbox', { name: 'Project optional' }).fill('agency-dashboard');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const card = page.locator('.kanban-task').filter({ hasText: 'Verify Agency workflow' });
  await expect(card).toBeVisible();
  await card.getByRole('combobox').selectOption('in_progress');
  await expect(page.locator('.kanban-column.in_progress').getByRole('button', { name: 'Verify Agency workflow', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.kanban-column.in_progress').getByRole('button', { name: 'Verify Agency workflow', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Verify Agency workflow', exact: true }).click();
  await page.getByRole('textbox', { name: 'Task title' }).fill('Verified Agency workflow');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Verified Agency workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await page.locator('.delete-confirm').getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.kanban-task').filter({ hasText: 'Verified Agency workflow' })).toHaveCount(0);
  expect(writes).toBe(0);
});

test('agent filtering, status tabs, list view, and empty results work', async ({ page }) => {
  await page.goto('/#agents');
  await page.getByRole('combobox', { name: 'Filter by provider' }).selectOption('codex');
  await expect(page.locator('.all-agents-grid .session-card')).toHaveCount(14);
  await page.getByRole('button', { name: /^Active/ }).click();
  await expect(page.locator('.all-agents-grid .session-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search agents, sessions, projects…' }).fill('not-a-session');
  await expect(page.getByRole('heading', { name: 'No sessions match' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(27);
});

test('local source discovery and tasks work with independent fixture data', async ({ page }) => {
  const stamp = new Date().toISOString();
  const tasks: unknown[] = [];
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], sources: [{ provider: 'claude', path: '/fixture/claude', status: 'not_found', count: 0, limited: false, warnings: [] }, { provider: 'codex', path: '/fixture/codex', status: 'connected', count: 0, limited: false, warnings: [] }], scannedAt: stamp } }));
  await page.route('**/api/tasks', async route => {
    if (route.request().method() === 'POST') { const task = { ...route.request().postDataJSON(), id: 'fixture-1', revision: 1, createdAt: stamp, updatedAt: stamp }; tasks.push(task); await route.fulfill({ status: 201, json: task }); }
    else await route.fulfill({ json: tasks });
  });
  await page.goto('/#settings');
  await page.getByRole('button', { name: /Local workspace Discover/ }).click();
  await expect(page.locator('.connection-indicator')).toHaveText('Local workspace');
  await expect(page.getByText('/fixture/claude')).toBeVisible();
  await page.getByRole('link', { name: 'Task board' }).click();
  await expect(page.locator('.kanban-task')).toHaveCount(0);
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByRole('textbox', { name: 'Task title' }).fill('My real local task');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('button', { name: 'My real local task', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'My real local task', exact: true })).toBeVisible();
});

test('mobile navigation, dialog focus, themes, and all pages stay within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your agents, in sync.' })).toBeVisible();
  for (const route of ['overview', 'network', 'agents', 'projects', 'tasks', 'activity', 'insights', 'settings']) {
    await page.goto('/#' + route);
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.locator('.sidebar')).toHaveClass(/open/);
  await page.getByRole('link', { name: 'Task board' }).click();
  await expect(page.locator('h1')).toHaveText('Task board.');
  await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Task title' })).toBeFocused();
  for (let i = 0; i < 15; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.goto('/#overview');
  await page.locator('h1').click();
  await page.screenshot({ path: 'test-results/agency-mobile.png', fullPage: true });
});

test('local discovery failure shows a recoverable error', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ status: 500, json: { error: 'Session discovery unavailable. Try refreshing.' } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Session discovery unavailable');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});
