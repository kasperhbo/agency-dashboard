import { test, expect, type Page } from '@playwright/test';

const key = 'agency.agents.demo';
const provider = (page: Page) => page.getByRole('combobox', { name: 'Filter by provider' });
const summary = (page: Page) => page.getByRole('region', { name: 'Active agent filters' });

test('provider, status and view survive navigation/reload while search stays private', async ({ page }) => {
  await page.goto('/#agents');
  await provider(page).selectOption('claude');
  await page.getByRole('group', { name: 'Session status' }).getByRole('button', { name: /^Completed/ }).click();
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search agents, sessions, projects…' }).fill('private query');
  await expect(summary(page)).toContainText('Provider: Claude · Status: Completed · View: List · Search active');
  const saved = await page.evaluate(key => localStorage.getItem(key), key);
  expect(JSON.parse(saved!)).toEqual({ provider: 'claude', status: 'completed', layout: 'list' });
  expect(saved).not.toContain('private query');
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.locator('nav a[href="#agents"]').click();
  await expect(provider(page)).toHaveValue('claude');
  await expect(page.getByRole('textbox', { name: 'Search agents, sessions, projects…' })).toHaveValue('');
  await page.reload();
  await expect(summary(page)).toContainText('Provider: Claude · Status: Completed · View: List');
  await expect(page.getByRole('button', { name: 'List view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await summary(page).getByRole('button', { name: 'Reset filters' }).click();
  await expect(provider(page)).toHaveValue('all');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)).toEqual({ provider: 'all', status: 'all', layout: 'grid' });
});

test('workspace choices stay separate through local/demo switches including empty local results', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agency.agents.local', JSON.stringify({ provider: 'codex', status: 'idle', layout: 'list' }));
    localStorage.setItem('agency.agents.demo', JSON.stringify({ provider: 'claude', status: 'completed', layout: 'grid' }));
  });
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], sources: [], scannedAt: new Date().toISOString() } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.goto('/#agents');
  await expect(summary(page)).toContainText('Provider: Claude · Status: Completed · View: Grid');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.waitForURL('**/#settings');
  await page.getByRole('button', { name: /Local workspace Discover your Claude/ }).click();
  await expect(page.getByRole('button', { name: /Local workspace Discover your Claude/ })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('nav a[href="#agents"]').click();
  await page.waitForURL('**/#agents');
  await expect(summary(page)).toContainText('Provider: Codex · Status: Idle · View: List');
  await expect(summary(page).getByRole('button', { name: 'Reset filters' })).toBeVisible();
  await provider(page).selectOption('all');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.waitForURL('**/#settings');
  await page.getByRole('button', { name: /Demo workspace Explore sample agents/ }).click();
  await expect(page.getByRole('button', { name: /Demo workspace Explore sample agents/ })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('nav a[href="#agents"]').click();
  await page.waitForURL('**/#agents');
  await expect(summary(page)).toContainText('Provider: Claude · Status: Completed · View: Grid');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agency.agents.local')!))).toEqual({ provider: 'all', status: 'idle', layout: 'list' });
});

test('malformed and non-string saved choices fall back without breaking browsing', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('agency.agents.demo') === null) localStorage.setItem('agency.agents.demo', JSON.stringify({ provider: { toString: null }, status: ['idle'], layout: {} }));
  });
  await page.goto('/#agents');
  await expect(summary(page)).toContainText('Provider: All providers · Status: All sessions · View: Grid');
  await page.evaluate(key => localStorage.setItem(key, '{broken'), key);
  await page.reload();
  await expect(provider(page)).toHaveValue('all');
  await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('unavailable storage allows browsing and reports failed writes', async ({ page }) => {
  await page.addInitScript(() => {
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) { if (key.startsWith('agency.agents.')) throw new Error('Fixture blocked read'); return originalGet.call(this, key); };
    Storage.prototype.setItem = function (key, value) { if (key.startsWith('agency.agents.')) throw new Error('Fixture blocked write'); originalSet.call(this, key, value); };
  });
  await page.goto('/#agents');
  await provider(page).selectOption('codex');
  await expect(provider(page)).toHaveValue('codex');
  await expect(page.getByRole('status').filter({ hasText: 'Browser storage is unavailable' })).toBeVisible();
  await summary(page).getByRole('button', { name: 'Reset filters' }).click();
  await expect(provider(page)).toHaveValue('all');
  await expect(summary(page)).toContainText('View: Grid');
});
