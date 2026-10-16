import { test, expect, type Page } from '@playwright/test';

async function localFixture(page: Page, status: 'connected' | 'not_found', sessions: object[] = []) {
  let writes = 0;
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) writes++; });
  await page.addInitScript(() => {
    localStorage.setItem('agency.mode', 'local');
    localStorage.setItem('agency.agents.local', JSON.stringify({ provider: 'codex', status: 'idle', layout: 'list' }));
  });
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions, sources: [{ provider: 'codex', status, path: 'C:\\FixtureAccount\\.codex\\sessions', count: sessions.length, limited: false, warnings: [] }], scannedAt: new Date().toISOString() } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.goto('/#agents');
  return () => writes;
}

for (const status of ['connected', 'not_found'] as const) {
  test(`${status} empty local workspace navigates directly to existing source diagnostics`, async ({ page }) => {
    if (status === 'not_found') await page.setViewportSize({ width: 390, height: 844 });
    const writes = await localFixture(page, status);
    const cta = page.getByRole('button', { name: 'Check source settings', exact: true });
    await expect(cta).toBeVisible();
    const before = await page.evaluate(() => localStorage.getItem('agency.agents.local'));
    await cta.focus();
    await expect(cta).toBeFocused();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/#settings');
    await expect(page.locator('h1')).toHaveText('Settings.');
    await expect(page.getByRole('region', { name: 'Agent connections', exact: true })).toContainText('C:\\FixtureAccount\\.codex\\sessions');
    await expect(page.locator('#main-content')).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem('agency.agents.local'))).toBe(before);
    expect(writes()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('filtering observed local sessions to zero offers reset without source CTA', async ({ page }) => {
  const now = new Date().toISOString();
  await localFixture(page, 'connected', [{ id: 'observed', nativeId: 'observed', provider: 'claude', project: 'fixture', title: 'Observed session', model: 'claude-fixture', status: 'completed', startedAt: now, updatedAt: now, tokens: null, events: [] }]);
  await expect(page.getByRole('heading', { name: 'No sessions match', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check source settings', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.locator('.session-card')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Search agents, sessions, projects…' }).fill('nothing-matches');
  await expect(page.getByRole('heading', { name: 'No sessions match', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check source settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset filters', exact: true })).toBeVisible();
});

test('demo filtering never offers local source diagnostics', async ({ page }) => {
  await page.goto('/#agents');
  await expect(page.getByRole('button', { name: 'Check source settings', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search agents, sessions, projects…' }).fill('nothing-matches');
  await expect(page.getByRole('heading', { name: 'No sessions match', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check source settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset filters', exact: true })).toBeVisible();
});

test('failed initial session observation keeps recovery visible without suggesting source settings', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ status: 503, json: { error: 'Fixture session read failed' } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.goto('/#agents');
  await expect(page.getByRole('alert')).toContainText('Fixture session read failed');
  await expect(page.getByRole('button', { name: 'Check source settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Retry/ })).toBeVisible();
});
