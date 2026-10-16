import { test, expect, type Page } from '@playwright/test';

const initial = { title: 'Prefilled task', description: 'Original description', project: 'Original project', provider: 'claude', status: 'in_progress', priority: 'high', sessionId: 'claude-one' };
async function mount(page: Page, editing = false) {
  // Exercise the actual editor with controlled asynchronous callbacks, without
  // adding a production test route or changing task storage.
  await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { TaskEditor } from '/src/TaskEditor.tsx';
    import '/src/styles.css';
    const initial = ${JSON.stringify(initial)};
    const task = ${editing} ? { ...initial, id: 'task-one', revision: 1, createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z' } : undefined;
    const sessions = ['claude-one', 'claude-two', 'codex-one'].map(id => ({ id, provider: id.startsWith('claude') ? 'claude' : 'codex', title: id, project: 'fixture' }));
    window.editorActions = { saves: 0, deletes: 0, behavior: 'success' };
    async function operation(kind) {
      window.editorActions[kind]++;
      if (window.editorActions.behavior === 'fail') throw new Error('Fixture save failed');
      if (window.editorActions.behavior === 'pending') await new Promise(resolve => { window.editorActions.release = resolve; });
    }
    function Harness() {
      const [closed, setClosed] = React.useState(false);
      return closed ? React.createElement('p', null, 'Editor closed') : React.createElement(TaskEditor, { task, initial, sessions, mode: 'demo', onClose: () => setClosed(true), onSave: () => operation('saves'), onDelete: () => operation('deletes') });
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
  ` }));
  await page.goto('/');
  await expect(page.getByRole('dialog')).toBeVisible();
}

for (const path of ['Cancel', 'X', 'Escape', 'backdrop']) {
  test(`dirty ${path} dismissal offers focused inline confirmation and keeps the draft`, async ({ page }) => {
    await mount(page);
    await page.getByLabel('Task title', { exact: true }).fill('Unsaved draft');
    if (path === 'Cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (path === 'X') await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    if (path === 'Escape') await page.keyboard.press('Escape');
    if (path === 'backdrop') await page.mouse.click(2, 2);
    const confirm = page.getByRole('group', { name: 'Unsaved changes', exact: true });
    await expect(confirm).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
    await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('Unsaved draft');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('Unsaved draft');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(page.getByText('Editor closed', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).editorActions.saves)).toBe(0);
  });
}

test('all editable fields including initial prefills detect changes and reverted values become pristine', async ({ page }) => {
  for (const field of ['title', 'description', 'project', 'provider', 'status', 'priority', 'sessionId']) {
    await mount(page);
    await expect(page.getByLabel('Description optional', { exact: true })).toHaveValue(initial.description);
    await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toHaveValue(initial.priority);
    const control = field === 'title' ? page.locator('#task-title') : field === 'description' ? page.locator('#task-description') : field === 'project' ? page.locator('#task-project') : field === 'status' ? page.getByRole('combobox', { name: 'Status', exact: true }) : field === 'priority' ? page.getByRole('combobox', { name: 'Priority', exact: true }) : page.locator('#task-session');
    if (['title', 'description', 'project'].includes(field)) await control.fill('Changed');
    else if (field === 'provider') await page.getByRole('button', { name: 'Codex', exact: true }).click();
    else await control.selectOption(field === 'status' ? 'done' : field === 'priority' ? 'low' : 'claude-two');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Unsaved changes', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    if (['title', 'description', 'project'].includes(field)) await control.fill(initial[field as 'title' | 'description' | 'project']);
    else if (field === 'provider') {
      await page.getByRole('button', { name: 'Claude', exact: true }).click();
      await page.locator('#task-session').selectOption(initial.sessionId);
    } else await control.selectOption(initial[field as 'status' | 'priority' | 'sessionId']);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Editor closed', { exact: true })).toBeVisible();
  }
});

test('untouched prefilled editor dismisses directly through every close route', async ({ page }) => {
  for (const path of ['Cancel', 'X', 'Escape', 'backdrop']) {
    await mount(page);
    if (path === 'Cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (path === 'X') await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    if (path === 'Escape') await page.keyboard.press('Escape');
    if (path === 'backdrop') await page.mouse.click(2, 2);
    await expect(page.getByText('Editor closed', { exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Unsaved changes', exact: true })).toHaveCount(0);
  }
});

test('failed save retains draft; busy dismissal is blocked; successful save bypasses guard', async ({ page }) => {
  await mount(page);
  await page.getByLabel('Task title', { exact: true }).fill('Retained draft');
  await page.evaluate(() => { (window as any).editorActions.behavior = 'fail'; });
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Fixture save failed');
  await expect(page.getByLabel('Task title', { exact: true })).toHaveValue('Retained draft');
  await page.evaluate(() => { (window as any).editorActions.behavior = 'pending'; });
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.mouse.click(2, 2);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Unsaved changes', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).editorActions.release());
  await expect(page.getByText('Editor closed', { exact: true })).toBeVisible();
});

test('successful delete of a dirty edit bypasses discard confirmation', async ({ page }) => {
  await mount(page, true);
  await page.getByLabel('Task title', { exact: true }).fill('Changed before deletion');
  await page.getByRole('button', { name: 'Delete task', exact: true }).click();
  await page.locator('.delete-confirm').getByRole('button', { name: 'Delete task', exact: true }).click();
  await expect(page.getByText('Editor closed', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).editorActions.deletes)).toBe(1);
});
