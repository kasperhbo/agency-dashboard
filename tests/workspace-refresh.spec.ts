import { test, expect, type Page } from '@playwright/test';

const stamp = '2026-10-16T08:00:00.000Z';
const original = { id: 'task-1', title: 'Original task', description: '', project: 'fixture', provider: 'codex', status: 'todo', priority: 'medium', revision: 1, createdAt: stamp, updatedAt: stamp };
const snapshot = { sessions: [], sources: [], scannedAt: stamp };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

// Mount the real hook through Vite, with no production component or test-only API.
async function mount(page: Page) {
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/src/main.tsx*', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace(/^import App from .*;$/m, '');
    const entry = source.indexOf('ReactDOM.createRoot');
    if (entry < 0) throw new Error('Vite entry was not found');
    await route.fulfill({ response, body: source.slice(0, entry) + `
import { useWorkspace } from "/src/useWorkspace.ts";
function Harness() {
  const workspace = useWorkspace();
  window.workspace = workspace;
  return React.createElement('pre', { id: 'workspace' }, JSON.stringify({
    mode: workspace.mode, tasks: workspace.tasks, error: workspace.error,
    sessionError: workspace.sessionError, taskError: workspace.taskError,
    scannedAt: workspace.scannedAt, tasksUpdatedAt: workspace.tasksUpdatedAt,
    loading: workspace.loading, refreshing: workspace.refreshing
  }));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
` });
  });
  await page.goto('/');
  await expect(page.locator('#workspace')).toBeVisible();
}
async function state(page: Page) { return JSON.parse(await page.locator('#workspace').innerText()); }
async function refresh(page: Page) { await page.evaluate(() => { void (window as any).workspace.refresh(); }); }

for (const operation of ['create', 'update', 'delete'] as const) {
  test(`an older task GET cannot undo a successful ${operation}`, async ({ page }) => {
    const release = deferred();
    let gets = 0;
    await page.route('**/api/sessions', route => route.fulfill({ json: snapshot }));
    await page.route('**/api/tasks**', async route => {
      if (route.request().method() === 'GET') {
        gets++;
        if (gets === 2) await release.promise;
        await route.fulfill({ json: [original] });
      } else await route.fulfill({ json: { ...original, title: 'Saved task', revision: 2, id: operation === 'create' ? 'task-2' : original.id } });
    });
    await mount(page);
    await expect.poll(async () => (await state(page)).tasks.length).toBe(1);
    await refresh(page);
    await expect.poll(() => gets).toBe(2);
    await page.evaluate(async operation => {
      const workspace = (window as any).workspace;
      const task = workspace.tasks[0];
      if (operation === 'delete') await workspace.deleteTask(task);
      else await workspace.saveTask({ ...task, title: 'Saved task' }, operation === 'update' ? task : undefined);
    }, operation);
    const titles = operation === 'delete' ? [] : operation === 'create' ? ['Saved task', 'Original task'] : ['Saved task'];
    await expect.poll(async () => (await state(page)).tasks.map((task: any) => task.title)).toEqual(titles);
    release.resolve();
    await expect.poll(async () => (await state(page)).refreshing).toBe(false);
    expect((await state(page)).tasks.map((task: any) => task.title)).toEqual(titles);
  });
}

test('session success is visible while tasks are delayed and failure stays resource-specific', async ({ page }) => {
  const release = deferred();
  await page.route('**/api/sessions', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/tasks', async route => { await release.promise; await route.fulfill({ status: 503, json: { error: 'Task storage unavailable' } }); });
  await mount(page);
  await expect.poll(async () => (await state(page)).scannedAt).toBe(stamp);
  release.resolve();
  await expect.poll(async () => (await state(page)).taskError).toBe('Task storage unavailable');
  expect((await state(page)).sessionError).toBe('');
  expect((await state(page)).scannedAt).toBe(stamp);
});

test('session failure retains the last snapshot and successful tasks refresh independently', async ({ page }) => {
  let sessions = 0;
  await page.route('**/api/sessions', route => ++sessions === 1 ? route.fulfill({ json: snapshot }) : route.fulfill({ status: 503, json: { error: 'Session source unavailable' } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [original] }));
  await mount(page);
  await expect.poll(async () => (await state(page)).scannedAt).toBe(stamp);
  await refresh(page);
  await expect.poll(async () => (await state(page)).sessionError).toBe('Session source unavailable');
  expect((await state(page)).taskError).toBe('');
  expect((await state(page)).tasksUpdatedAt).toBeTruthy();
  expect((await state(page)).scannedAt).toBe(stamp);
});

test('visibility and online hints immediately recover with one in-flight refresh', async ({ page }) => {
  let sessions = 0;
  const release = deferred();
  await page.route('**/api/sessions', async route => { sessions++; if (sessions === 2) await release.promise; await route.fulfill({ json: { ...snapshot, scannedAt: sessions === 1 ? stamp : '2026-10-16T08:01:00.000Z' } }); });
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await mount(page);
  await expect.poll(async () => (await state(page)).scannedAt).toBe(stamp);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => sessions).toBe(2);
  release.resolve();
  await expect.poll(async () => (await state(page)).scannedAt).toBe('2026-10-16T08:01:00.000Z');
  expect(sessions).toBe(2);
});

test('mode changes discard obsolete requests and returning local starts a fresh scope', async ({ page }) => {
  const release = deferred();
  let sessions = 0;
  await page.route('**/api/sessions', async route => { sessions++; if (sessions === 1) await release.promise; await route.fulfill({ json: { ...snapshot, scannedAt: sessions === 1 ? stamp : '2026-10-16T08:02:00.000Z' } }); });
  await page.route('**/api/tasks', route => route.fulfill({ json: [original] }));
  await mount(page);
  await expect.poll(() => sessions).toBe(1);
  await page.evaluate(() => (window as any).workspace.setMode('demo'));
  await expect.poll(async () => (await state(page)).mode).toBe('demo');
  await page.evaluate(() => (window as any).workspace.setMode('local'));
  await expect.poll(() => sessions).toBe(2);
  await expect.poll(async () => (await state(page)).scannedAt).toBe('2026-10-16T08:02:00.000Z');
  release.resolve();
  expect((await state(page)).scannedAt).toBe('2026-10-16T08:02:00.000Z');
});

test('a task GET started during a mutation cannot undo its successful result', async ({ page }) => {
  const write = deferred(), list = deferred();
  let gets = 0, writing = false;
  await page.route('**/api/sessions', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/tasks**', async route => {
    if (route.request().method() === 'GET') {
      gets++;
      if (gets === 2) await list.promise;
      await route.fulfill({ json: [original] });
    } else {
      writing = true;
      await write.promise;
      await route.fulfill({ json: { ...original, title: 'Saved during refresh', revision: 2 } });
    }
  });
  await mount(page);
  await expect.poll(async () => (await state(page)).tasks.length).toBe(1);
  await page.evaluate(() => {
    const workspace = (window as any).workspace, task = workspace.tasks[0];
    (window as any).pendingSave = workspace.saveTask({ ...task, title: 'Saved during refresh' }, task);
  });
  await expect.poll(() => writing).toBe(true);
  await refresh(page);
  await expect.poll(() => gets).toBe(2);
  write.resolve();
  await page.evaluate(() => (window as any).pendingSave);
  await expect.poll(async () => (await state(page)).tasks[0].title).toBe('Saved during refresh');
  list.resolve();
  await expect.poll(async () => (await state(page)).refreshing).toBe(false);
  expect((await state(page)).tasks[0].title).toBe('Saved during refresh');
});

test('a failed task mutation does not block the next successful task list refresh', async ({ page }) => {
  let gets = 0;
  await page.route('**/api/sessions', route => route.fulfill({ json: snapshot }));
  await page.route('**/api/tasks**', route => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 503, json: { error: 'Write unavailable' } });
    gets++;
    return route.fulfill({ json: [{ ...original, title: gets === 1 ? original.title : 'External update' }] });
  });
  await mount(page);
  await expect.poll(async () => (await state(page)).tasks.length).toBe(1);
  const message = await page.evaluate(async () => {
    const workspace = (window as any).workspace, task = workspace.tasks[0];
    try { await workspace.saveTask({ ...task, title: 'Failed edit' }, task); }
    catch (error) { return (error as Error).message; }
  });
  expect(message).toBe('Write unavailable');
  expect((await state(page)).tasks[0].title).toBe('Original task');
  await refresh(page);
  await expect.poll(async () => (await state(page)).tasks[0].title).toBe('External update');
  expect((await state(page)).taskError).toBe('');
});
