import { test, expect, type Page } from '@playwright/test';
import type { Task } from '../src/types';

const original: Task = { id: 'shared-task', title: 'Original shared task', description: 'Original description', project: 'Shared', provider: 'claude', status: 'todo', priority: 'medium', sessionId: null, revision: 1, createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z' };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(page: Page, harness = false) {
  let latest: Task | null = { ...original };
  let readMode: 'ok' | 'fail' | 'network' = 'ok';
  let mutationStatus = 0;
  let delay: ReturnType<typeof deferred> | null = null;
  let reads = 0;
  const revisions: number[] = [];
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], sources: [], scannedAt: new Date().toISOString() } }));
  await page.route('**/api/tasks**', async route => {
    if (route.request().method() === 'GET') {
      reads++;
      const snapshot = latest ? [{ ...latest }] : [];
      if (delay) await delay.promise;
      if (readMode === 'network') return route.abort('failed');
      if (readMode === 'fail') return route.fulfill({ status: 503, json: { error: 'Latest list is unavailable' } });
      return route.fulfill({ json: snapshot });
    }
    const input = route.request().postDataJSON(); revisions.push(input.revision);
    if (mutationStatus) return route.fulfill({ status: mutationStatus, json: { error: 'Generic mutation failure mentions 409 but is not a conflict' } });
    if (input.revision !== latest?.revision) return route.fulfill({ status: 409, json: { error: 'Task changed in another window.' } });
    if (route.request().method() === 'DELETE') { latest = null; return route.fulfill({ json: { ok: true } }); }
    latest = { ...latest!, ...input, revision: latest!.revision + 1 };
    return route.fulfill({ json: latest });
  });
  if (harness) await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { useWorkspace } from '/src/useWorkspace.ts';
    import { TaskEditor } from '/src/TaskEditor.tsx';
    import '/src/styles.css';
    function Harness() {
      const w = useWorkspace(), [open, setOpen] = React.useState(true);
      window.conflictHarness = { close: () => setOpen(false), switchMode: () => w.setMode('demo'), tasks: w.tasks };
      return open ? React.createElement(TaskEditor, { task: ${JSON.stringify(original)}, sessions: [], mode: w.mode, onClose: () => setOpen(false), onSave: w.saveTask, onDelete: w.deleteTask, onReload: (task, signal) => w.reloadTask(task.id, signal) }) : React.createElement('p', null, 'Closed harness');
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
  ` }));
  await page.goto(harness ? '/' : '/#tasks');
  if (!harness) await page.getByRole('button', { name: original.title, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  return {
    external: () => { latest = { ...original, title: 'Other client title', description: 'Other client description', priority: 'high', revision: 2 }; },
    readFailure: (mode: typeof readMode) => { readMode = mode; },
    missing: () => { latest = null; },
    status: (status: number) => { mutationStatus = status; },
    delay: () => { delay = deferred(); return delay; },
    reads: () => reads,
    revisions,
  };
}
async function conflict(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  await page.getByLabel('Task title', { exact: true }).fill('My unchanged draft');
  state.external();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reload latest', exact: true })).toBeVisible();
}
async function confirmReload(page: Page) {
  await page.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Discard draft and reload', exact: true }).click();
}

test('two-client update conflict keeps revision until confirmed reload then saves using latest revision', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  await conflict(page, state);
  const reads = state.reads();
  await page.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('My unchanged draft');
  expect(state.reads()).toBe(reads);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect(state.revisions).toEqual([1, 1]);
  await confirmReload(page);
  await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('Other client title');
  await expect(page.getByLabel('Description optional', { exact: true })).toHaveValue('Other client description');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reload latest', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Task title', { exact: true })).toBeFocused();
  await page.getByLabel('Task title', { exact: true }).fill('Saved after reload');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.revisions).toEqual([1, 1, 2]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('delete conflict reloads the latest revision before explicit deletion', async ({ page }) => {
  const state = await fixture(page); state.external();
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await page.locator('.delete-confirm').getByRole('button', { name: 'Delete task', exact: true }).click();
  await confirmReload(page);
  await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('Other client title');
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await page.locator('.delete-confirm').getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.revisions).toEqual([1, 2]);
});

for (const failure of ['fail', 'network', 'missing'] as const) {
  test(`${failure} reload retains the exact draft and its revision baseline`, async ({ page }) => {
    const state = await fixture(page); await conflict(page, state);
    if (failure === 'missing') state.missing(); else state.readFailure(failure);
    await confirmReload(page);
    await expect(page.getByRole('alert')).toContainText(failure === 'missing' ? 'no longer exists' : 'Could not reload latest');
    await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('My unchanged draft');
    await expect(page.getByLabel('Description optional', { exact: true })).toHaveValue(original.description);
    await expect(page.getByRole('button', { name: 'Reload latest', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect(state.revisions).toEqual([1, 1]);
  });
}

for (const status of [400, 500]) {
  test(`${status} stays a generic error even when message contains 409`, async ({ page }) => {
    const state = await fixture(page); state.status(status);
    await page.getByLabel('Task title', { exact: true }).fill('My draft');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Generic mutation failure');
    await expect(page.getByRole('button', { name: 'Reload latest', exact: true })).toHaveCount(0);
  });
}

for (const ending of ['unmount', 'source switch'] as const) {
  test(`busy reload blocks dismiss and stale response after ${ending} cannot replace draft`, async ({ page }) => {
    const state = await fixture(page, true); await conflict(page, state);
    const delayed = state.delay(); const reads = state.reads();
    await confirmReload(page);
    await expect.poll(state.reads).toBe(reads + 1);
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Reload latest', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.evaluate(ending => ending === 'unmount' ? (window as any).conflictHarness.close() : (window as any).conflictHarness.switchMode(), ending);
    delayed.resolve();
    if (ending === 'unmount') await expect(page.getByText('Closed harness')).toBeVisible();
    else {
      await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('My unchanged draft');
      await expect(page.getByRole('button', { name: 'Reload latest', exact: true })).toHaveCount(0);
    }
  });
}
