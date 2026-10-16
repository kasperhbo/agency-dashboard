import { test, expect } from '@playwright/test';

test('task board and list keep the same tasks, filters, ordering, and actions', async ({ page }) => {
  const stamp = '2026-10-16T12:00:00.000Z';
  const tasks = [
    { id: 'one', title: 'First linked task', description: 'Keep review open', project: 'Alpha', provider: 'claude', priority: 'high', status: 'todo', sessionId: 'session-one', revision: 3, createdAt: stamp, updatedAt: stamp },
    { id: 'two', title: 'Second task', description: '', project: 'Beta', provider: 'codex', priority: 'low', status: 'in_progress', revision: 5, createdAt: stamp, updatedAt: stamp },
    { id: 'three', title: 'Third task', description: '', project: 'Alpha', provider: 'claude', priority: 'medium', status: 'done', revision: 7, createdAt: stamp, updatedAt: stamp },
  ];
  const session = { id: 'session-one', nativeId: 'native-one', provider: 'claude', title: 'Correct session', project: 'Alpha', model: 'Claude', status: 'completed', startedAt: stamp, updatedAt: stamp, tokens: 10, events: [], partial: false };
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [session], sources: [], scannedAt: stamp } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: tasks }));
  await page.goto('/#tasks');

  const boardTitles = page.locator('.kanban-task .kanban-title');
  await expect(boardTitles).toHaveText(['First linked task', 'Second task', 'Third task']);
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  const rows = page.locator('.task-list-wrap tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('td:first-child strong')).toHaveText(['First linked task', 'Second task', 'Third task']);
  await expect(rows.nth(0).locator('td')).toHaveCount(6);
  await expect(rows.nth(0).locator('td').nth(1)).toHaveText('Alpha');
  await expect(rows.nth(0).locator('td').nth(2)).toContainText('Claude');
  await expect(rows.nth(0).locator('td').nth(3)).toContainText('high');
  await expect(rows.nth(0).locator('td').nth(4)).toContainText('To do');
  await expect(page.getByRole('button', { name: 'Board view' })).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('combobox', { name: 'Filter by provider' }).selectOption('claude');
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('td:first-child strong')).toHaveText(['First linked task', 'Third task']);
  await page.getByRole('button', { name: 'Board view' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.kanban-task .kanban-title')).toHaveText(['First linked task', 'Third task']);
  await expect(page.locator('.kanban-column.done .kanban-task')).toHaveCount(1);
  await page.getByRole('button', { name: 'List view' }).click();
  await page.locator('.task-list-wrap tbody tr').first().getByRole('combobox').selectOption('done');
  await expect(page.locator('.task-list-wrap tbody tr').first()).toContainText('Done');
  await page.locator('.task-list-wrap tbody tr').first().getByRole('button', { name: 'Open linked session for First linked task' }).click();
  await expect(page.getByRole('dialog')).toContainText('Correct session');
  await page.keyboard.press('Escape');

  await page.getByRole('textbox', { name: 'Find a task…' }).fill('no match');
  await expect(page.getByRole('heading', { name: 'No tasks match' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('empty workspace and stale or provider-mismatched links remain safe in list view', async ({ page }) => {
  const stamp = '2026-10-16T12:00:00.000Z';
  const wrongSession = { id: 'linked-id', nativeId: 'native-other', provider: 'codex', title: 'Wrong provider session', project: 'Alpha', model: 'Codex', status: 'completed', startedAt: stamp, updatedAt: stamp, tokens: 10, events: [], partial: false };
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [wrongSession], sources: [], scannedAt: stamp } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.goto('/#tasks');
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();

  const staleTask = { id: 'stale', title: 'Stale session task', description: '', project: 'Alpha', provider: 'claude', priority: 'medium', status: 'todo', sessionId: 'missing-id', revision: 1, createdAt: stamp, updatedAt: stamp };
  const mismatchTask = { ...staleTask, id: 'mismatch', title: 'Mismatched provider task', sessionId: 'linked-id' };
  await page.route('**/api/tasks', route => route.fulfill({ json: [staleTask, mismatchTask] }));
  await page.reload();
  await page.getByRole('button', { name: 'List view' }).click();
  const rows = page.locator('.task-list-wrap tbody tr');
  await expect(rows).toHaveCount(2);
  for (const title of ['Stale session task', 'Mismatched provider task']) {
    const row = rows.filter({ hasText: title });
    await expect(row.getByText('Unavailable')).toBeVisible();
    await expect(row.getByRole('button', { name: /Open linked session/ })).toHaveCount(0);
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
