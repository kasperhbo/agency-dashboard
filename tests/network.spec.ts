import { test, expect } from '@playwright/test';

test('network reads the real topology API and exposes recorded parent-child connections', async ({ page, request }) => {
  const response = await request.get('/api/topology?mode=demo');
  expect(response.ok()).toBe(true);
  const topology = await response.json();
  expect(topology.summary).toMatchObject({ sessions: 2, subagents: 3, unresolvedParents: 0 });
  await page.goto('/#network');
  await expect(page.getByText('Sample network', { exact: true })).toBeVisible();
  await expect(page.locator('.network-node.subagent')).toHaveCount(3);
  await expect(page.locator('.network-connections [data-edge-kind="parent-child"]')).toHaveCount(3);
  await page.getByRole('button', { name: /Select Subagent Interface builder/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Agent inspector' });
  await expect(inspector.getByRole('heading', { name: 'Interface builder', exact: true })).toBeVisible();
  await expect(inspector.getByText('Reported parent', { exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: 'Design coordinator', exact: true }).click();
  await expect(inspector.getByText('2 connected subagents')).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Graph zoom' })).toHaveText('90%');
  await page.getByRole('button', { name: 'Pause graph animation' }).click();
  await expect(page.locator('.network-viewport')).toHaveClass(/motion-paused/);
  await page.getByRole('button', { name: 'Resume graph animation' }).click();
  await expect(page.locator('.network-viewport')).not.toHaveClass(/motion-paused/);
  await page.getByRole('button', { name: 'Reset graph view' }).click();
  await page.locator('h1').click();
  await page.screenshot({ path: 'test-results/agency-network.png', fullPage: true });
});

test('network filters preserve ancestors and provide keyboard/list inspection', async ({ page }) => {
  await page.goto('/#network');
  await page.getByRole('textbox', { name: 'Search agent network' }).fill('Interface builder');
  await expect(page.locator('.network-node.subagent')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Select Parent session Design coordinator/ })).toBeVisible();
  await page.getByRole('button', { name: /Select Parent session Design coordinator/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /Select Subagent Interface builder/ })).toBeFocused();
  await page.getByRole('textbox', { name: 'Search agent network' }).fill('');
  await page.getByRole('combobox', { name: 'Network provider' }).selectOption('codex');
  await expect(page.locator('.network-node.provider')).toHaveCount(1);
  await expect(page.locator('.network-node.claude')).toHaveCount(0);
  await page.getByRole('button', { name: 'Hierarchy list view' }).click();
  await expect(page.getByRole('list', { name: 'Agent hierarchy' }).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: /Curie/ }).click();
  await expect(page.getByRole('complementary', { name: 'Agent inspector' }).getByRole('heading', { name: 'Curie', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search agent network' }).fill('not-an-agent');
  await expect(page.getByText('No agents match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Agent hierarchy' }).getByRole('listitem')).toHaveCount(5);
});

test('network honors reduced motion and keeps its canvas inside mobile layout', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#network');
  await expect(page.getByText('Reduced motion enabled')).toBeVisible();
  await expect(page.locator('.network-viewport')).toHaveClass(/motion-paused/);
  await expect(page.getByRole('button', { name: 'Resume graph animation' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Hierarchy list view' }).click();
  await page.getByRole('button', { name: /Review needs your input/ }).click();
  await expect(page.getByRole('complementary', { name: 'Agent inspector' }).getByText('Needs you', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/agency-network-mobile.png', fullPage: true });
});

test('failed network refresh keeps the last snapshot but stops activity animation', async ({ page }) => {
  await page.goto('/#network');
  await expect(page.getByText('Sample network', { exact: true })).toBeVisible();
  await page.route('**/api/topology?mode=demo', route => route.fulfill({ status: 503, json: { error: 'Topology source unavailable.' } }));
  await page.getByRole('button', { name: 'Refresh graph', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Showing the last snapshot');
  await expect(page.locator('.network-node.subagent')).toHaveCount(3);
  await expect(page.locator('.network-viewport')).toHaveClass(/motion-paused/);
});
