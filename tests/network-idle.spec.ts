import { test, expect, type Page } from '@playwright/test';
import type { AgentTopology } from '../src/types';

async function fixture(page: Page, idleOnly = false) {
  const now = new Date().toISOString();
  const graph: AgentTopology = {
    version: 1, observedAt: now, dataSource: 'fixture',
    nodes: [
      { id: 'folder', kind: 'folder', label: 'Fixture folder', workingDirectory: '/fixture' },
      { id: 'idle-parent', kind: 'session', label: 'Idle parent', status: 'idle', provider: 'claude', folderId: 'folder', project: 'fixture', updatedAt: now },
      { id: 'active-child', kind: 'subagent', label: 'Active child', status: 'running', provider: 'claude', folderId: 'folder', project: 'fixture', updatedAt: now },
      { id: 'idle-alone', kind: 'session', label: 'Idle standalone', status: 'idle', provider: 'claude', folderId: 'folder', project: 'fixture', updatedAt: now },
      { id: 'recent-completed', kind: 'session', label: 'Recent completed', status: 'completed', provider: 'claude', folderId: 'folder', project: 'fixture', updatedAt: now },
    ],
    edges: [
      { id: 'folder-parent', source: 'folder', target: 'idle-parent', kind: 'membership', evidence: 'folder', animated: false },
      { id: 'real-parent-child', source: 'idle-parent', target: 'active-child', kind: 'parent-child', evidence: 'log-parent', animated: true },
      { id: 'folder-alone', source: 'folder', target: 'idle-alone', kind: 'membership', evidence: 'folder', animated: false },
      { id: 'folder-completed', source: 'folder', target: 'recent-completed', kind: 'membership', evidence: 'folder', animated: false },
    ],
    summary: { sessions: 3, subagents: 1, unresolvedParents: 0, activeRuns: 1, duplicatesMerged: 0 },
    sources: [{ provider: 'claude', path: '/fixture/logs', status: 'connected', count: 4, limited: false, warnings: [] }], coverage: { limited: false, notes: [] },
  };
  if (idleOnly) {
    graph.nodes = graph.nodes.filter(node => node.kind === 'folder' || node.status === 'idle');
    graph.edges = graph.edges.filter(edge => graph.nodes.some(node => node.id === edge.source) && graph.nodes.some(node => node.id === edge.target));
    graph.summary = { sessions: 2, subagents: 0, unresolvedParents: 0, activeRuns: 0, duplicatesMerged: 0 };
  }
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], sources: graph.sources, scannedAt: now } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.route('**/api/topology?mode=local', route => route.fulfill({ json: graph }));
  await page.goto('/#network');
  await expect(page.locator('.network-visible-count')).toBeVisible();
}
async function filters(page: Page) {
  const disclosure = page.locator('.network-filter-disclosure');
  if (!await disclosure.evaluate(element => element.hasAttribute('open'))) await disclosure.locator('summary').click();
}

test('default excludes idle but keeps active descendants and recent completed; toggle restores real edges and reset hides idle', async ({ page }) => {
  await fixture(page);
  await expect(page.locator('.network-node.idle')).toHaveCount(0);
  await expect(page.locator('[data-node-id="active-child"]')).toHaveCount(1);
  await expect(page.locator('[data-node-id="recent-completed"]')).toHaveCount(1);
  await expect(page.locator('.network-visible-count')).toHaveText('2 of 2 matching nodes');
  await expect(page.locator('[data-edge-source="folder"][data-edge-target="active-child"][data-edge-kind="membership"]')).toHaveCount(1);
  await expect(page.locator('[data-edge-kind="parent-child"]')).toHaveCount(0);
  const summary = await page.locator('.network-summary').innerText();
  await filters(page);
  const toggle = page.getByRole('button', { name: 'Include idle', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.focus(); await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Show more families', exact: true }).click();
  await expect(page.locator('.network-node.idle')).toHaveCount(2);
  await expect(page.locator('[data-edge-source="idle-parent"][data-edge-target="active-child"][data-edge-kind="parent-child"]')).toHaveCount(1);
  await expect(page.locator('[data-edge-source="folder"][data-edge-target="active-child"]')).toHaveCount(0);
  await expect(page.locator('.network-visible-count')).toHaveText('4 of 4 matching nodes');
  await expect(page.locator('.network-summary')).toHaveText(summary, { useInnerText: true });
  await page.locator('[data-node-id="idle-parent"]').click();
  await toggle.click();
  await expect(page.locator('.network-node.idle')).toHaveCount(0);
  const inspector = page.getByRole('complementary', { name: 'Agent inspector' });
  await expect(inspector.getByRole('heading', { name: 'Idle parent', exact: true })).toBeVisible();
  await inspector.getByRole('button', { name: 'Locate in graph', exact: true }).click();
  await expect(inspector).toContainText('Selected agent is outside the current filters');
  await expect(page.locator('.network-node.idle')).toHaveCount(0);
  await filters(page); await toggle.click();
  await page.getByRole('button', { name: 'Clear network filters', exact: true }).click();
  await expect(page.locator('.network-node.idle')).toHaveCount(0);
  await expect(page.locator('.network-visible-count')).toHaveText('2 of 2 matching nodes');
});

test('search and Working & attention respect idle exclusion while list and graph share eligibility', async ({ page }) => {
  await fixture(page);
  const query = page.getByRole('textbox', { name: 'Search agent network' });
  await query.fill('Active child');
  await expect(page.locator('[data-node-id="active-child"]')).toHaveCount(1);
  await expect(page.locator('.network-node.idle')).toHaveCount(0);
  await page.getByRole('button', { name: 'Hierarchy list view', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Agent hierarchy' }).getByRole('listitem')).toHaveCount(1);
  await query.fill('Idle');
  await expect(page.getByText('Idle agents are hidden in this view', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Include idle agents', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Agent hierarchy' }).getByRole('listitem')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear network filters', exact: true }).click();
  await filters(page);
  await page.getByRole('button', { name: 'Working & attention', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Agent hierarchy' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Agent hierarchy' })).toContainText('Active child');
  await expect(page.getByRole('list', { name: 'Agent hierarchy' })).not.toContainText('Recent completed');
});

test('mobile idle inclusion uses accessible native filter controls without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  const list = page.getByRole('list', { name: 'Agent hierarchy' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await filters(page);
  const toggle = page.getByRole('button', { name: 'Include idle', exact: true });
  await toggle.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await page.getByRole('button', { name: 'Show more families', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(list).toContainText('Idle parent');
  await page.getByRole('button', { name: 'Reset network view', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.locator('strong').filter({ hasText: /^Idle parent$/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const view of ['graph', 'list'] as const) {
  test(`all-idle ${view} has a direct keyboard reveal action without opening More filters`, async ({ page }) => {
    if (view === 'list') await page.setViewportSize({ width: 390, height: 844 });
    await fixture(page, true);
    await expect(page.locator('.network-visible-count')).toHaveText('0 of 0 matching nodes');
    await expect(page.getByText('Idle agents are hidden in this view', { exact: true })).toBeVisible();
    const reveal = page.getByRole('button', { name: 'Include idle agents', exact: true });
    await reveal.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('.network-visible-count')).toHaveText('2 of 2 matching nodes');
    if (view === 'graph') await expect(page.locator('.network-node.idle')).toHaveCount(2);
    else await expect(page.getByRole('list', { name: 'Agent hierarchy' }).getByRole('listitem')).toHaveCount(2);
    await page.getByRole('button', { name: 'Reset network view', exact: true }).click();
    await expect(reveal).toBeVisible();
    await page.getByRole('textbox', { name: 'Search agent network' }).fill('does-not-match');
    await expect(reveal).toHaveCount(0);
    await expect(page.getByText('No agents match these filters', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
