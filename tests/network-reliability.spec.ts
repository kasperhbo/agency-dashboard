import { test, expect } from '@playwright/test';

test('topology responses slower than the polling cadence still render', async ({ page, request }) => {
  const graph = await (await request.get('/api/topology?mode=demo')).json();
  let delayed = false, held = false;
  let release: () => void = () => {};
  await page.clock.install();
  await page.route('**/api/topology?mode=demo', async route => {
    if (delayed) {
      await new Promise<void>(resolve => { if (!held) { held = true; release = resolve; } });
      graph.nodes.find((node: { kind: string }) => node.kind === 'session').label = 'Delayed completed session';
    }
    await route.fulfill({ json: graph }).catch(() => {});
  });
  await page.goto('/#network');
  await expect(page.getByText('Sample network', { exact: true })).toBeVisible();
  delayed = true;
  await page.getByRole('button', { name: 'Refresh graph', exact: true }).click();
  await expect.poll(() => held).toBe(true);
  await page.clock.runFor(12000);
  release();
  await expect(page.getByRole('button', { name: /Select Agent session Delayed completed session/ })).toBeVisible();
});

test('retained network age advances into stale state and online resumes once', async ({ page, request }) => {
  const graph = await (await request.get('/api/topology?mode=demo')).json();
  graph.dataSource = 'fixture';
  graph.observedAt = new Date(Date.now() - 110000).toISOString();
  let requests = 0, fail = false;
  await page.clock.install();
  await page.route('**/api/topology?mode=demo', route => {
    requests++;
    return !fail ? route.fulfill({ json: graph }) : route.fulfill({ status: 503, json: { error: 'Network interrupted' } });
  });
  await page.goto('/#network');
  const freshness = page.getByRole('status', { name: 'Network freshness' });
  await expect(freshness).toContainText('Observed 1m ago');
  fail = true;
  await page.clock.runFor(20000);
  await expect(freshness).toContainText('Stale');
  await expect(freshness).toContainText('2m ago');
  await expect(page.locator('.network-node.subagent')).toHaveCount(3);
  const before = requests;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => requests).toBe(before + 1);
});

test('mobile filters preserve view and selection, with readable freshness and initial fit', async ({ page, request }) => {
  const graph = await (await request.get('/api/topology?mode=demo')).json();
  graph.dataSource = 'fixture';
  graph.observedAt = new Date().toISOString();
  await page.route('**/api/topology?mode=demo', route => route.fulfill({ json: graph }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#network');
  await expect(page.getByRole('status', { name: 'Network freshness' })).toContainText('10s refresh');
  await expect(page.getByRole('combobox', { name: 'Network provider' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Network project' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Graph view', exact: true }).click();
  await expect(page.locator('.network-viewport')).toHaveJSProperty('scrollWidth', await page.locator('.network-viewport').evaluate(el => el.clientWidth));
  await page.getByText('More filters', { exact: false }).click();
  await page.getByRole('combobox', { name: 'Network project' }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByRole('region', { name: 'Agent relationship graph' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Clear network filters' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear network filters' }).click();
  await page.getByRole('button', { name: 'Hierarchy list view' }).click();
  await page.getByRole('button', { name: /Interface builder/ }).click();
  await page.getByRole('button', { name: 'Refresh graph', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Agent hierarchy' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Agent inspector' }).getByRole('heading', { name: 'Interface builder', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('touch graph panning is opt-in', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:5173', localStorage: [{ name: 'agency.mode', value: 'demo' }] }] } });
  const page = await context.newPage();
  await page.goto('/#network');
  await page.getByRole('button', { name: 'Graph view', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Agent relationship graph' });
  await expect(graph).toBeVisible();
  await expect(graph).toHaveCSS('touch-action', 'pan-y');
  const inspect = page.getByRole('button', { name: 'Inspect graph with touch' });
  await inspect.click();
  await expect(inspect).toHaveAttribute('aria-pressed', 'true');
  await expect(graph).toHaveCSS('touch-action', 'none');
  await inspect.click();
  await expect(graph).toHaveCSS('touch-action', 'pan-y');
  await context.close();
});

test('hidden polling pauses and visible plus online hints share one refresh', async ({ page, request }) => {
  const graph = await (await request.get('/api/topology?mode=demo')).json();
  let count = 0, holdRefresh = false;
  let release: () => void = () => {};
  await page.clock.install();
  await page.route('**/api/topology?mode=demo', async route => {
    count++;
    if (holdRefresh) {
      await new Promise<void>(resolve => { release = resolve; });
      graph.nodes.find((node: { kind: string }) => node.kind === 'session').label = 'Resumed session';
    }
    await route.fulfill({ json: graph }).catch(() => {});
  });
  await page.goto('/#network');
  await expect(page.getByText('Sample network', { exact: true })).toBeVisible();
  const initialCount = count;
  holdRefresh = true;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(30000);
  expect(count).toBe(initialCount);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => count).toBe(initialCount + 1);
  release();
  await expect(page.getByRole('button', { name: /Select Agent session Resumed session/ })).toBeVisible();
  expect(count).toBe(initialCount + 1);
});

test('touch swipes scroll the page until graph inspection is enabled', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:5173', localStorage: [{ name: 'agency.mode', value: 'demo' }] }] } });
  const page = await context.newPage();
  await page.goto('/#network');
  await page.getByRole('button', { name: 'Graph view', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Agent relationship graph' });
  await graph.scrollIntoViewIfNeeded();
  const cdp = await context.newCDPSession(page);
  async function swipe() {
    const box = (await graph.boundingBox())!;
    const x = box.x + box.width - 10, y = Math.min(700, box.y + box.height - 30);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let offset = 20; offset <= 160; offset += 20) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - offset }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const before = await page.evaluate(() => scrollY);
  await swipe();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 40);
  await page.getByRole('button', { name: 'Inspect graph with touch' }).click();
  for (let step = 0; step < 8; step++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await graph.scrollIntoViewIfNeeded();
  const pageBeforeInspect = await page.evaluate(() => scrollY);
  await swipe();
  await expect.poll(() => graph.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(pageBeforeInspect);
  await context.close();
});

test('changing workspace discards an obsolete topology response', async ({ page, request }) => {
  const original = await (await request.get('/api/topology?mode=demo')).json();
  const local = structuredClone(original);
  local.dataSource = 'local';
  local.nodes.find((node: { kind: string }) => node.kind === 'session').label = 'Current local session';
  let hold = false, waiting = false;
  let release: () => void = () => {};
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], sources: [], scannedAt: new Date().toISOString() } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.route('**/api/topology?mode=local', route => route.fulfill({ json: local }));
  await page.route('**/api/topology?mode=demo', async route => {
    if (hold) await new Promise<void>(resolve => { waiting = true; release = resolve; });
    await route.fulfill({ json: original }).catch(() => {});
  });
  await page.goto('/#network');
  await expect(page.getByText('Sample network', { exact: true })).toBeVisible();
  hold = true;
  await page.getByRole('button', { name: 'Refresh graph', exact: true }).click();
  await expect.poll(() => waiting).toBe(true);
  await page.getByRole('button', { name: 'M My workspace Demo workspace' }).click();
  await page.locator('#workspace-menu').getByRole('button', { name: /Local workspace/ }).click();
  await expect(page.getByRole('button', { name: /Select Agent session Current local session/ })).toBeVisible();
  release();
  await expect(page.getByText('Sample network', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Select Agent session Current local session/ })).toBeVisible();
});

test('graph inspection remains available with mouse and hybrid desktop input', async ({ page, browser }) => {
  await page.goto('/#network');
  const desktopToggle = page.getByRole('button', { name: 'Inspect graph with touch' });
  await expect(desktopToggle).toBeVisible();
  const context = await browser.newContext({ hasTouch: true, isMobile: false, viewport: { width: 1440, height: 1000 }, storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:5173', localStorage: [{ name: 'agency.mode', value: 'demo' }] }] } });
  const hybrid = await context.newPage();
  await hybrid.goto('/#network');
  const toggle = hybrid.getByRole('button', { name: 'Inspect graph with touch' });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(hybrid.getByRole('region', { name: 'Agent relationship graph' })).toHaveCSS('touch-action', 'none');
  await context.close();
});

test('reset refits the post-filter graph in portrait without changing view choice', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#network');
  await page.getByRole('button', { name: 'Graph view', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Agent relationship graph' });
  await expect(graph).toBeVisible();
  const zoom = page.getByRole('status', { name: 'Graph zoom' });
  await expect(zoom).not.toHaveText('80%');
  const fitted = await zoom.innerText();
  await page.getByRole('combobox', { name: 'Network provider' }).selectOption('codex');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Reset network view' }).click();
  await expect(page.getByRole('combobox', { name: 'Network provider' })).toHaveValue('all');
  await expect(zoom).toHaveText(fitted);
  await expect(graph).toHaveJSProperty('scrollWidth', await graph.evaluate(el => el.clientWidth));
  await page.getByRole('button', { name: 'Hierarchy list view' }).click();
  await page.getByRole('button', { name: 'Reset network view' }).click();
  await expect(page.getByRole('list', { name: 'Agent hierarchy' })).toBeVisible();
});

test('portrait initially shows readable hierarchy and preserves view choice across rotation, filters and reset', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#network');
  const list = page.getByRole('list', { name: 'Agent hierarchy' });
  const listChoice = page.getByRole('button', { name: 'Hierarchy list view' });
  await expect(list).toBeVisible();
  await expect(listChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Pause graph animation' })).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Graph zoom' })).toHaveCount(0);
  await expect(page.locator('.network-canvas-footer')).toHaveCount(0);
  expect((await list.boundingBox())!.height).toBeLessThan(440);
  await list.getByRole('button', { name: /Interface builder/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Agent inspector' });
  await expect(inspector.getByRole('heading', { name: 'Interface builder', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(list).toBeVisible();
  await page.getByRole('button', { name: 'Refresh graph', exact: true }).click();
  await expect(inspector.getByRole('heading', { name: 'Interface builder', exact: true })).toBeVisible();
  await expect(listChoice).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('combobox', { name: 'Network provider' }).selectOption('claude');
  await expect(list).toBeVisible();
  await page.getByRole('button', { name: 'Reset network view' }).click();
  await expect(listChoice).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Graph view', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('region', { name: 'Agent relationship graph' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh graph', exact: true }).click();
  await page.getByRole('button', { name: 'Reset network view' }).click();
  await expect(page.getByRole('button', { name: 'Graph view', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('desktop starts in graph and keeps an explicit list choice when resized to portrait', async ({ page }) => {
  await page.goto('/#network');
  await expect(page.getByRole('region', { name: 'Agent relationship graph' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Graph view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Hierarchy list view' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('list', { name: 'Agent hierarchy' })).toBeVisible();
});
