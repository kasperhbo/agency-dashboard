import { test, expect } from '@playwright/test';

test('recorded links have direction while membership remains explicitly non-causal', async ({ page, request }) => {
  const graph = await (await request.get('/api/topology?mode=demo')).json();
  await page.goto('/#network');
  const causal = page.locator('.network-connections [data-edge-kind="parent-child"]');
  await expect(causal).toHaveCount(3);
  for (const edge of graph.edges.filter((item: { kind: string }) => item.kind === 'parent-child')) {
    const rendered = page.locator(`[data-edge-source="${edge.source}"][data-edge-target="${edge.target}"]`);
    await expect(rendered).toHaveAttribute('marker-end', 'url(#network-child-arrow)');
  }
  await expect(page.locator('.network-edge-key')).toContainText('Folder membership · not parentage');
  await expect(page.locator('.network-connections [data-edge-kind="membership"]').first()).not.toHaveAttribute('marker-end');
  await page.screenshot({ path: '.agency/graph-after-desktop.png', fullPage: true });
});

test('inspector navigation reveals a collapsed child and centers its actual node', async ({ page, request }) => {
  const graph = await (await request.get('/api/topology?mode=demo')).json();
  const parent = graph.nodes.find((item: { label: string }) => item.label === 'Design coordinator');
  const template = graph.nodes.find((item: { label: string }) => item.label === 'Interface builder');
  for (let index = 0; index < 6; index++) {
    const id = `extra-worker-${index}`;
    graph.nodes.push({ ...template, id, label: `Extra worker ${index}`, status: 'idle' });
    graph.edges.push({ id: `extra-link-${index}`, source: parent.id, target: id, kind: 'parent-child', evidence: 'log-parent', animated: false });
  }
  await page.route('**/api/topology?mode=demo', route => route.fulfill({ json: graph }));
  await page.goto('/#network');
  await page.getByRole('button', { name: /Select Agent session Design coordinator/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Agent inspector' });
  await expect(page.locator('[data-node-id="extra-worker-5"]')).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Extra worker 5', exact: true }).click();
  const target = page.locator('[data-node-id="extra-worker-5"]');
  await expect(target).toBeFocused();
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status', { name: 'Graph zoom' })).toHaveText('100%');
  expect(await target.evaluate(element => {
    const node = element.getBoundingClientRect();
    const viewport = document.querySelector('.network-viewport')!.getBoundingClientRect();
    return node.left >= viewport.left && node.right <= viewport.right && node.top >= viewport.top && node.bottom <= viewport.bottom;
  })).toBe(true);
  await expect(page.locator('.network-node.subagent')).toHaveCount(5);
});

test('mobile hierarchy selection can locate the same agent without changing filters', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#network');
  await page.getByRole('combobox', { name: 'Network provider' }).selectOption('codex');
  await page.screenshot({ path: '.agency/graph-after-mobile.png', fullPage: true });
  await page.getByRole('list', { name: 'Agent hierarchy' }).getByRole('button', { name: /Curie/ }).click();
  await page.getByRole('button', { name: 'Locate in graph', exact: true }).click();
  await expect(page.getByRole('button', { name: /Select Subagent Curie/ })).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Network provider' })).toHaveValue('codex');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.agency/graph-after-mobile-locate.png', fullPage: true });
});
