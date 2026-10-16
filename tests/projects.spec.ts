import { test, expect } from '@playwright/test';

test('projects group sessions and tasks, support search, and prefill project tasks', async ({ page }) => {
  await page.goto('/#projects');
  await expect(page.locator('.project-workspace')).toHaveCount(4);
  await page.screenshot({ path: 'test-results/agency-projects.png', fullPage: true });
  await page.getByRole('textbox', { name: 'Search projects' }).fill('agency');
  await expect(page.locator('.project-workspace')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open project agency-dashboard', exact: true }).click();
  await expect(page.locator('.project-page-heading h2')).toHaveText('agency-dashboard');
  await expect(page.locator('.project-session-grid .session-card')).not.toHaveCount(0);
  await expect(page.locator('#project-sessions-panel')).toBeVisible();
  await expect(page.locator('#project-tasks-panel')).toBeHidden();
  await page.getByRole('tab', { name: /^Tasks/ }).click();
  await expect(page.locator('.project-task-panel .task-row')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/agency-project-detail.png', fullPage: true });
  await page.getByRole('button', { name: 'Add project task', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Project optional' })).toHaveValue('agency-dashboard');
  await page.getByRole('textbox', { name: 'Task title' }).fill('Project-scoped follow-up');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.locator('.project-task-panel .task-row')).toHaveCount(3);
  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search projects' }).fill('missing-project');
  await expect(page.getByRole('heading', { name: 'No projects match' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
});

test('session follow-up stays linked through reload and can be revisited or unlinked', async ({ page }) => {
  await page.goto('/');
  await page.locator('.agent-grid .session-card').first().click();
  await page.getByRole('button', { name: 'Create follow-up task' }).click();
  await expect(page.getByRole('combobox', { name: 'Linked session optional' })).toHaveValue('frontend');
  await page.getByRole('textbox', { name: 'Task title' }).fill('Keep this session connected');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.goto('/#tasks');
  await page.reload();
  const card = page.locator('.kanban-task').filter({ hasText: 'Keep this session connected' });
  await card.getByRole('button', { name: 'Open linked session for Keep this session connected' }).click();
  await expect(page.getByRole('heading', { name: 'Linked tasks' })).toBeVisible();
  await page.locator('.linked-task-row').filter({ hasText: 'Keep this session connected' }).click();
  await expect(page.getByRole('combobox', { name: 'Linked session optional' })).toHaveValue('frontend');
  await page.getByRole('group', { name: 'Assign to' }).getByRole('button', { name: 'Codex', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Linked session optional' })).toHaveValue('');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(card.getByRole('button', { name: /Open linked session/ })).toHaveCount(0);
});

test('missing session references survive edits and can be explicitly removed', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('agency.demoTasks', JSON.stringify([{ id: 'archived-task', title: 'Archived session follow-up', description: '', project: 'old-project', provider: 'claude', status: 'todo', priority: 'medium', sessionId: 'outside-scan', revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }])));
  await page.goto('/#tasks');
  await expect(page.locator('.kanban-task').getByText('Unavailable in loaded sessions')).toBeVisible();
  await page.getByRole('button', { name: 'Archived session follow-up', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Linked session optional' })).toHaveValue('outside-scan');
  await expect(page.getByText(/unavailable in currently loaded sessions.*absence does not prove deletion/i)).toBeVisible();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agency.demoTasks')!)[0].sessionId)).toBe('outside-scan');
  await page.getByRole('button', { name: 'Archived session follow-up', exact: true }).click();
  await page.getByRole('combobox', { name: 'Linked session optional' }).selectOption('');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agency.demoTasks')!)[0].sessionId)).toBe(null);
});

test('mobile project details stay in the viewport and projects reset on source change', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], sources: [], scannedAt: new Date().toISOString() } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.goto('/#projects');
  await page.getByRole('button', { name: 'Open project api-service', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/agency-project-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: /My workspace/ }).click();
  await page.locator('#workspace-menu').getByRole('button', { name: /Local workspace/ }).click();
  await page.getByRole('button', { name: 'Close navigation' }).click();
  await expect(page.getByRole('heading', { name: 'Your next project starts here' })).toBeVisible();
  await expect(page.locator('.project-workspace')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.locator('h1')).toHaveText('Settings.');
});
