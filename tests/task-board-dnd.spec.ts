import { test, expect, type Page } from '@playwright/test';

const stamp = '2026-10-16T12:00:00.000Z';
const initial = [
  { id: 'move-me', title: 'Move me', description: '', project: 'Alpha', provider: 'claude', priority: 'medium', status: 'todo', revision: 1, createdAt: stamp, updatedAt: stamp },
  { id: 'stay-put', title: 'Stay put', description: '', project: 'Alpha', provider: 'codex', priority: 'low', status: 'todo', revision: 2, createdAt: stamp, updatedAt: stamp },
];

async function setup(page: Page) {
  let tasks = initial.map(task => ({ ...task }));
  let failure = 0;
  let pending: (() => void) | null = null;
  let hold = false;
  let mutations = 0;
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], sources: [], scannedAt: stamp } }));
  await page.route('**/api/tasks**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: tasks });
    mutations++;
    if (hold) await new Promise<void>(resolve => { pending = resolve; });
    if (failure) return route.fulfill({ status: failure, json: { error: failure === 409 ? 'Task changed in another window.' : 'Task update is unavailable.' } });
    const input = route.request().postDataJSON();
    const index = tasks.findIndex(task => route.request().url().endsWith(`/${task.id}`));
    tasks[index] = { ...tasks[index], ...input, revision: tasks[index].revision + 1 };
    return route.fulfill({ json: tasks[index] });
  });
  await page.goto('/#tasks');
  return {
    mutations: () => mutations,
    fail: (status = 409) => { failure = status; },
    hold: () => { hold = true; },
    release: () => { pending?.(); pending = null; },
  };
}

test('board cards move across columns and persist after reload; same-column drops do nothing', async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByText('Drag a task card to another column', { exact: false })).toBeVisible();
  const source = page.locator('.kanban-task').filter({ hasText: 'Move me' });
  await source.dragTo(page.locator('.kanban-column.todo'));
  expect(state.mutations()).toBe(0);
  await source.dragTo(page.locator('.kanban-column.in_progress'));
  await expect(page.locator('.kanban-column.in_progress .kanban-task')).toContainText('Move me');
  await expect(page.locator('.kanban-column.todo .kanban-task')).toContainText('Stay put');
  expect(state.mutations()).toBe(1);
  await page.reload();
  await expect(page.locator('.kanban-column.in_progress .kanban-task')).toContainText('Move me');
  await expect(page.locator('.kanban-column.todo .kanban-task')).toContainText('Stay put');
});

test('a busy mutation blocks dragging and dropping other cards until it finishes', async ({ page }) => {
  const state = await setup(page); state.hold();
  const source = page.locator('.kanban-task').filter({ hasText: 'Move me' });
  await source.dragTo(page.locator('.kanban-column.done'));
  await expect.poll(state.mutations).toBe(1);
  await expect(page.locator('.kanban-task').filter({ hasText: 'Stay put' })).toHaveAttribute('draggable', 'false');
  await page.locator('.kanban-task').filter({ hasText: 'Stay put' }).dragTo(page.locator('.kanban-column.done'));
  expect(state.mutations()).toBe(1);
  state.release();
  await expect(page.locator('.kanban-column.done .kanban-task')).toContainText('Move me');
});

for (const status of [409, 500]) test(`${status} update failure keeps the task in its prior column and reports the error`, async ({ page }) => {
  const state = await setup(page); state.fail(status);
  await page.locator('.kanban-task').filter({ hasText: 'Move me' }).dragTo(page.locator('.kanban-column.in_progress'));
  await expect(page.getByRole('status')).toContainText(status === 409 ? 'Task changed in another window.' : 'Task update is unavailable.');
  await expect(page.locator('.kanban-column.todo .kanban-task').filter({ hasText: 'Move me' })).toHaveCount(1);
  await expect(page.locator('.kanban-column.in_progress .kanban-task')).toHaveCount(0);
});

test('status selector remains available as a keyboard fallback on narrow screens', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const status = page.getByLabel('Status of Move me');
  await status.focus();
  await status.selectOption('done');
  await expect(page.locator('.kanban-column.done .kanban-task')).toContainText('Move me');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
