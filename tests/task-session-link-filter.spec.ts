import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const stamp = '2026-10-16T12:00:00.000Z';
const sessions = [
  { id: 'available-claude', nativeId: 'native-available', provider: 'claude', title: 'Exact Claude session', project: 'Alpha', model: 'Claude', status: 'completed', startedAt: stamp, updatedAt: stamp, tokens: 10, events: [], partial: false },
  { id: 'shared-id', nativeId: 'native-codex', provider: 'codex', title: 'Codex session with shared ID', project: 'Beta', model: 'Codex', status: 'completed', startedAt: stamp, updatedAt: stamp, tokens: 10, events: [], partial: false },
];
const tasks = [
  { id: 'available', title: 'Available Claude task', description: 'Exact link', project: 'Alpha', provider: 'claude', priority: 'high', status: 'todo', sessionId: 'available-claude', revision: 1, createdAt: stamp, updatedAt: stamp },
  { id: 'provider-mismatch', title: 'Provider mismatch task', description: 'Same id, different provider', project: 'Alpha', provider: 'claude', priority: 'medium', status: 'in_progress', sessionId: 'shared-id', revision: 1, createdAt: stamp, updatedAt: stamp },
  { id: 'outside', title: 'Outside scan task', description: 'Session not loaded', project: 'Beta', provider: 'codex', priority: 'high', status: 'todo', sessionId: 'missing-session', revision: 1, createdAt: stamp, updatedAt: stamp },
  { id: 'unlinked', title: 'Unlinked task', description: 'No session reference', project: 'Alpha', provider: 'claude', priority: 'low', status: 'done', sessionId: null, revision: 1, createdAt: stamp, updatedAt: stamp },
];

async function openTasks(page: Page) {
  let writes = 0;
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions, sources: [], scannedAt: stamp } }));
  await page.route('**/api/tasks**', route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill({ json: tasks });
  });
  await page.goto('/#tasks');
  await expect(page.locator('.kanban-task')).toHaveCount(4);
  return () => writes;
}

test('link availability is exact by session ID and provider in both layouts, and only exact links open', async ({ page }) => {
  const writes = await openTasks(page);
  const filter = page.getByRole('combobox', { name: 'Filter by linked session' });
  await expect(filter.locator('option')).toHaveText(['Any session link', 'Available in loaded sessions', 'Unavailable in loaded sessions', 'No linked session']);

  await filter.selectOption('available');
  await expect(page.getByText('1 task', { exact: true })).toBeVisible();
  await expect(page.locator('.kanban-task .kanban-title')).toHaveText(['Available Claude task']);
  await page.getByRole('button', { name: 'List view' }).click();
  let rows = page.locator('.task-list-wrap tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Open session');
  await rows.first().getByRole('button', { name: 'Open linked session for Available Claude task' }).click();
  await expect(page.getByRole('dialog')).toContainText('Exact Claude session');
  await page.keyboard.press('Escape');

  await filter.selectOption('outside');
  await page.getByRole('button', { name: 'Board view' }).click();
  await expect(page.locator('.kanban-task')).toHaveCount(2);
  await expect(page.locator('.kanban-task')).toContainText(['Unavailable in loaded sessions', 'Unavailable in loaded sessions']);
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows).toContainText(['Provider mismatch task', 'Outside scan task']);
  await expect(rows.filter({ hasText: 'Provider mismatch task' }).locator('.task-session-unavailable')).toHaveAttribute('title', 'Unavailable in currently loaded sessions; this does not prove deletion.');
  await expect(page.getByText(/Available means an exact session ID and provider match/)).toBeVisible();
  await expect(rows.getByRole('button', { name: /Open linked session/ })).toHaveCount(0);

  await filter.selectOption('unlinked');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Unlinked task');
  await expect(rows.getByRole('button', { name: /Open linked session/ })).toHaveCount(0);
  expect(writes()).toBe(0);
});

test('link filter composes with search, provider and priority, resets by keyboard, and fits mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTasks(page);
  const filter = page.getByRole('combobox', { name: 'Filter by linked session' });
  await filter.selectOption('available');
  await page.getByRole('combobox', { name: 'Filter by provider' }).selectOption('claude');
  await page.getByRole('combobox', { name: 'Task priority' }).selectOption('high');
  await page.getByRole('textbox', { name: 'Find a task…' }).fill('available');
  await expect(page.locator('.kanban-task .kanban-title')).toHaveText(['Available Claude task']);

  await page.getByRole('textbox', { name: 'Find a task…' }).fill('no match');
  await expect(page.locator('.column-empty').filter({ hasText: /^No matching tasks$/ })).toHaveCount(3);
  const reset = page.getByRole('button', { name: 'Reset task filters', exact: true });
  await reset.focus();
  await page.keyboard.press('Enter');
  await expect(filter).toHaveValue('all');
  await expect(page.getByRole('combobox', { name: 'Filter by provider' })).toHaveValue('all');
  await expect(page.getByRole('combobox', { name: 'Task priority' })).toHaveValue('all');
  await expect(page.getByRole('textbox', { name: 'Find a task…' })).toHaveValue('');
  await expect(page.locator('.kanban-task')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).include('.filter-bar').analyze();
  expect(results.violations).toEqual([]);
});
