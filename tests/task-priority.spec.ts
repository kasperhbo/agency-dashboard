import { test, expect } from '@playwright/test';
import { compareTaskPriority, compareTaskRecent } from '../src/task-view';
import type { Task } from '../src/types';

const task = (id: string, priority: Task['priority'], overrides: Partial<Task> = {}): Task => ({ id, title: `Review ${id}`, description: '', project: 'Shared', provider: 'claude', priority, status: 'todo', revision: 2, createdAt: '2026-01-01T12:00:00Z', updatedAt: '2026-01-01T12:00:00Z', ...overrides });
const tasks = [task('low', 'low'), task('high-b', 'high'), task('high-a', 'high'), task('medium', 'medium', { provider: 'codex', updatedAt: '2026-01-03T12:00:00Z' }), task('done', 'high', { status: 'done' })];

test('task comparators preserve input and deterministically resolve priority, recency, creation and id ties', () => {
  const original = structuredClone(tasks);
  const frozen = tasks.map(item => Object.freeze({ ...item }));
  expect([...frozen].sort(compareTaskPriority).map(item => item.id)).toEqual(['done', 'high-a', 'high-b', 'medium', 'low']);
  expect([...frozen].sort(compareTaskRecent).map(item => item.id)).toEqual(['medium', 'done', 'high-a', 'high-b', 'low']);
  const older = task('z', 'high', { createdAt: '2025-12-01T12:00:00Z' });
  expect(compareTaskPriority(older, tasks[1])).toBeLessThan(0);
  expect(compareTaskRecent(older, tasks[1])).toBeLessThan(0);
  expect(tasks).toEqual(original);
});

test('board preserves stored order, composes filters, sorts within columns and resets without writing', async ({ page }) => {
  let mutations = 0;
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], sources: [], scannedAt: new Date().toISOString() } }));
  await page.route('**/api/tasks**', route => {
    if (route.request().method() !== 'GET') mutations++;
    return route.fulfill({ json: tasks });
  });
  await page.goto('/#tasks');
  const todo = page.locator('.kanban-column.todo .kanban-title');
  await expect(todo).toHaveText(['Review low', 'Review high-b', 'Review high-a', 'Review medium']);
  await page.getByRole('combobox', { name: 'Task ordering' }).selectOption('priority');
  await expect(todo).toHaveText(['Review high-a', 'Review high-b', 'Review medium', 'Review low']);
  await expect(page.locator('.kanban-column.done .kanban-title')).toHaveText(['Review done']);
  await page.getByRole('combobox', { name: 'Task ordering' }).selectOption('recent');
  await expect(todo).toHaveText(['Review medium', 'Review high-a', 'Review high-b', 'Review low']);
  await page.getByRole('combobox', { name: 'Task priority', exact: true }).selectOption('high');
  await page.getByRole('combobox', { name: 'Filter by provider' }).selectOption('claude');
  await page.getByRole('textbox', { name: 'Find a task…' }).fill('high-b');
  await expect(todo).toHaveText(['Review high-b']);
  await page.getByRole('combobox', { name: 'Task priority', exact: true }).selectOption('low');
  await expect(todo).toHaveCount(0);
  await expect(page.locator('.kanban-column.todo')).toContainText('No matching tasks');
  await page.getByRole('button', { name: 'Reset task filters' }).click();
  await expect(todo).toHaveText(['Review low', 'Review high-b', 'Review high-a', 'Review medium']);
  await expect(page.getByRole('combobox', { name: 'Task ordering' })).toHaveValue('stored');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('combobox', { name: 'Task priority', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Task ordering' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(mutations).toBe(0);
});
