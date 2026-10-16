import { test, expect, type Page } from '@playwright/test';
import type { Task } from '../src/types';

const stamp = '2026-10-16T12:00:00Z';
const makeTask = (index: number, project = 'Alpha'): Task => ({ id: `${project}-${index}`, title: `${project} task ${index}`, project, description: '', provider: 'claude', status: index % 3 === 0 ? 'done' : index % 3 === 1 ? 'todo' : 'in_progress', priority: index % 2 === 0 ? 'high' : 'low', revision: 1, createdAt: stamp, updatedAt: stamp });
async function fixture(page: Page) {
  let tasks = [...Array.from({ length: 72 }, (_, index) => makeTask(index)), ...Array.from({ length: 5 }, (_, index) => makeTask(index, 'Beta'))];
  let writes = 0;
  const original = structuredClone(tasks);
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [{ id: 'empty-project-session', nativeId: 'empty-project-session', provider: 'claude', project: 'Empty', title: 'No tasks here', model: 'claude-fixture', status: 'completed', startedAt: stamp, updatedAt: stamp, tokens: null, events: [] }], sources: [], scannedAt: new Date().toISOString() } }));
  await page.route('**/api/tasks**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: tasks });
    writes++;
    const input = route.request().postDataJSON();
    const id = route.request().url().split('/').at(-1);
    const found = tasks.find(task => task.id === id)!;
    const result = { ...found, ...input, revision: found.revision + 1 };
    tasks = tasks.map(task => task.id === id ? result : task);
    return route.fulfill({ json: result });
  });
  await page.goto('/#projects');
  await page.getByRole('button', { name: 'Open project Alpha', exact: true }).click();
  return { original, writes: () => writes, tasks: () => tasks };
}

test('combined project filters precede pagination and preserve project totals, scope and storage order', async ({ page }) => {
  const state = await fixture(page);
  const panel = page.locator('.project-task-panel');
  const rows = panel.locator('.task-main > span');
  await expect(rows).toHaveCount(20);
  await expect(panel).toContainText('72 matching of 72 project tasks');
  await expect(panel).toContainText('48 open · 24 done');
  await panel.getByRole('combobox', { name: 'Project task status' }).selectOption('open');
  await panel.getByRole('combobox', { name: 'Project task priority' }).selectOption('high');
  const expected = state.original.filter(task => task.project === 'Alpha' && task.status !== 'done' && task.priority === 'high').map(task => task.title);
  await expect(panel).toContainText('24 matching of 72 project tasks');
  await expect(panel).toContainText('48 open · 24 done');
  await expect(rows).toHaveText(expected.slice(0, 20));
  await panel.getByRole('button', { name: 'Show more tasks (4 remaining)', exact: true }).click();
  await expect(rows).toHaveText(expected);
  await expect(panel).not.toContainText('Beta task');
  await panel.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(rows).toHaveText(state.original.filter(task => task.project === 'Alpha').slice(0, 20).map(task => task.title));
  await panel.getByRole('combobox', { name: 'Project task status' }).selectOption('done');
  await expect(rows).toHaveCount(20);
  await expect(panel).toContainText('24 matching of 72 project tasks');
  expect(state.writes()).toBe(0);
  expect(state.tasks()).toEqual(state.original);
});

test('project navigation resets filters and pagination; unmatched filters offer reset but empty projects keep creation', async ({ page }) => {
  const state = await fixture(page);
  const panel = page.locator('.project-task-panel');
  await panel.getByRole('button', { name: /Show more tasks/ }).click();
  await expect(panel.locator('.task-row')).toHaveCount(40);
  await panel.getByRole('combobox', { name: 'Project task priority' }).selectOption('medium');
  await expect(panel.getByRole('heading', { name: 'No tasks match', exact: true })).toBeVisible();
  await expect(panel).toContainText('0 matching of 72 project tasks');
  await panel.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(panel.locator('.task-row')).toHaveCount(20);
  await panel.getByRole('combobox', { name: 'Project task status' }).selectOption('open');
  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project Beta', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Project task status' })).toHaveValue('all');
  await expect(panel.getByRole('combobox', { name: 'Project task priority' })).toHaveValue('all');
  await expect(panel.locator('.task-row')).toHaveCount(5);
  await expect(panel).not.toContainText('Alpha task');
  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project Alpha', exact: true }).click();
  await expect(panel.locator('.task-row')).toHaveCount(20);
  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project Empty', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Give this project a next step', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Reset filters', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Add project task', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Project optional' })).toHaveValue('Empty');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(state.writes()).toBe(0);
});

test('Open reacts to task completion; native filters and edit/create remain usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  const panel = page.locator('.project-task-panel');
  const status = panel.getByRole('combobox', { name: 'Project task status' });
  await status.focus();
  await expect(status).toBeFocused();
  await status.selectOption('open');
  await panel.getByRole('button', { name: 'Complete Alpha task 1', exact: true }).click();
  await expect(panel.locator('.task-main > span').filter({ hasText: /^Alpha task 1$/ })).toHaveCount(0);
  await expect(panel).toContainText('47 matching of 72 project tasks');
  await expect(panel).toContainText('47 open · 25 done');
  await panel.locator('.task-main').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue('Alpha task 2');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Add project task', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Project optional' })).toHaveValue('Alpha');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(state.writes()).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
