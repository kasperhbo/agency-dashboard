import { test, expect } from '@playwright/test';

const staging = process.env.AGENCY_STAGING_URL;
test.use({ storageState: { cookies: [], origins: [] } });
test.skip(!staging, 'Run through npm run test:staging against an isolated built release.');

test('staging serves the built API with isolated native-log fixtures and matching lineage', async ({ request, page }) => {
  const healthResponse = await request.get(staging + '/api/health');
  expect(healthResponse.ok()).toBe(true);
  const health = await healthResponse.json();
  expect(health).toMatchObject({ ok: true, environment: 'staging', dataSource: 'fixture' });
  const privateUsage = await request.get(staging + '/api/claude-usage?refresh=1');
  expect(privateUsage.ok()).toBe(true);
  expect(await privateUsage.json()).toMatchObject({ status: 'unavailable', limits: null, reason: expect.stringMatching(/disabled/i) });
  if (process.env.GITHUB_SHA) expect(health.buildSha).toBe(process.env.GITHUB_SHA);
  const response = await request.get(staging + '/api/topology?mode=local');
  expect(response.ok()).toBe(true);
  const graph = await response.json();
  expect(graph.dataSource).toBe('fixture');
  expect(graph.summary).toMatchObject({ sessions: 2, subagents: 1, unresolvedParents: 0 });
  expect(graph.nodes.filter((node: { kind: string }) => node.kind === 'folder')).toHaveLength(1);
  const child = graph.nodes.find((node: { kind: string }) => node.kind === 'subagent');
  const parentLink = graph.edges.find((edge: { kind: string; target: string }) => edge.kind === 'parent-child' && edge.target === child.id);
  expect(parentLink.evidence).toBe('log-parent');
  expect(graph.nodes.find((node: { id: string }) => node.id === parentLink.source).nativeId).toBe('staging-claude-parent');
  await page.goto(staging + '/#network');
  await expect(page.getByText('Staging fixture network', { exact: true })).toBeVisible();
  await expect(page.locator('.network-node.subagent')).toHaveCount(1);
  await expect(page.locator('.network-node.folder')).toHaveCount(1);
  await expect(page.locator('.network-node.workspace, .network-node.provider')).toHaveCount(0);
  await page.locator('.network-node.subagent').click();
  const inspector = page.getByRole('complementary', { name: 'Agent inspector' });
  await expect(inspector.getByText('Reported parent', { exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: 'Open session details' }).click();
  await expect(page.getByRole('dialog').getByText('Recorded usage', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/staging-network.png', fullPage: true });
});

test('staging task writes traverse the real API and persist after a reload', async ({ page, request }) => {
  const title = `Staging functional task ${Date.now()}`;
  try {
    await page.goto(staging + '/#tasks');
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await page.getByRole('textbox', { name: 'Task title' }).fill(title);
    await page.getByRole('textbox', { name: 'Project optional' }).fill('staging-check');
    await page.getByRole('button', { name: 'Create task', exact: true }).click();
    await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('done');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.kanban-column.done').getByRole('button', { name: title, exact: true })).toBeVisible();
    const rows = await (await request.get(staging + '/api/tasks')).json();
    expect(rows.find((task: { title: string }) => task.title === title)).toMatchObject({ title, status: 'done', revision: 2 });
  } finally {
    const response = await request.get(staging + '/api/tasks');
    if (response.ok()) for (const task of await response.json()) if (task.title === title) await request.delete(`${staging}/api/tasks/${task.id}`, { data: { revision: task.revision } });
  }
});

test('staging stays functional on mobile and respects reduced motion', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(staging + '/#network');
  await expect(page.getByText('Staging fixture network', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Graph view', exact: true }).click();
  await expect(page.locator('.network-viewport')).toHaveClass(/motion-paused/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Hierarchy list view' }).click();
  await expect(page.getByRole('list', { name: 'Agent hierarchy' }).getByRole('listitem')).toHaveCount(3);
  const blocked = await request.post(staging + '/api/tasks', { headers: { Origin: 'https://untrusted.example' }, data: { title: 'must not write' } });
  expect(blocked.status()).toBe(403);
  await page.screenshot({ path: 'test-results/staging-network-mobile.png', fullPage: true });
});
