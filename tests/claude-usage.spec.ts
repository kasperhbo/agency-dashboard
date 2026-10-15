import { test, expect, type Page } from '@playwright/test';

const unavailable = { status: 'unavailable', limits: null, fetchedAt: null, reason: 'Account usage is unavailable. Use Claude /usage or sign in normally.' };
test.beforeEach(async ({ page }) => {
  // Every fixture owns this private route, including demo tests that must not call it.
  await page.route('**/api/claude-usage*', route => route.fulfill({ json: unavailable }));
});

async function workspace(page: Page) {
  const now = new Date().toISOString();
  const metrics = { inputTokens: 8, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: null, totalTokens: 10 };
  const limits = { reportedAt: new Date(Date.now() - 7200000).toISOString(), source: 'Claude log quotaLimits', plan: null, credits: null, windows: [{ label: 'five_hour', usedPercent: null, windowMinutes: null, resetsAt: new Date(Date.now() - 3600000).toISOString(), status: 'rejected' }] };
  const provider = { provider: 'claude', ...metrics, daily: [], undatedTokens: 10, runCount: 1, sessionCount: 1, subagentCount: 0, withUsage: 1, unavailableCount: 0, partialCount: 0, duplicateRecordsRemoved: 0, duplicateThreadsRemoved: 0, limits, context: null };
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], sources: [], scannedAt: now, usage: { ...metrics, daily: [], undatedTokens: 10, providers: [provider] } } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
}

function account() {
  const now = new Date().toISOString();
  return { status: 'available', fetchedAt: now, limits: { reportedAt: now, source: 'Claude account usage', plan: null, credits: null, windows: [
    { label: '5-hour window', usedPercent: 17, windowMinutes: 300, resetsAt: new Date(Date.now() + 3600000).toISOString(), status: null },
    { label: '7-day window', usedPercent: 33, windowMinutes: 10080, resetsAt: new Date(Date.now() + 86400000).toISOString(), status: null },
  ] } };
}

test('local account percentages replace stale rejection while token metrics remain visible', async ({ page }) => {
  await workspace(page);
  await page.route('**/api/claude-usage*', route => route.fulfill({ json: account() }));
  await page.goto('/#insights');
  const card = page.getByRole('region', { name: 'Claude account usage' });
  await expect(card.getByText('Account usage', { exact: true })).toBeVisible();
  await expect(card.getByRole('meter', { name: 'Claude 5-hour window account usage' })).toHaveAttribute('aria-valuenow', '17');
  await expect(card.getByRole('meter', { name: 'Claude 7-day window account usage' })).toHaveAttribute('aria-valuenow', '33');
  await expect(card.getByText('rejected', { exact: true })).not.toBeVisible();
  await expect(page.locator('.usage-summary article').first().locator('strong')).toHaveText('10');
  await card.getByText('Historical log report', { exact: true }).click();
  await expect(card.getByText('Historical status: rejected', { exact: true })).toBeVisible();
  await expect(card.getByText('Historical log observation. This is not current account usage.')).toBeVisible();
});

test('unavailable account usage hides expired rejection and guides native sign-in', async ({ page }) => {
  await workspace(page);
  await page.goto('/#insights');
  const card = page.getByRole('region', { name: 'Claude account usage' });
  await expect(card.getByText('Waiting for a fresh report', { exact: true })).toBeVisible();
  await expect(card.getByText(/Use Claude \/usage or sign in normally/, { exact: false }).first()).toBeVisible();
  await expect(card.getByRole('meter')).toHaveCount(0);
  await expect(card.getByText('Historical status: rejected', { exact: true })).not.toBeVisible();
  await card.getByText('Historical log report', { exact: true }).click();
  await expect(card.getByText('Historical status: rejected', { exact: true })).toBeVisible();
  await expect(card.getByText('Reset time passed. Current usage is unknown.')).toBeVisible();
});

test('manual refresh uses the explicit query, enforces cooldown, and clears live data on failure', async ({ page }) => {
  await page.clock.install();
  await workspace(page);
  let forceReads = 0;
  await page.route('**/api/claude-usage*', route => {
    if (new URL(route.request().url()).searchParams.get('refresh') === '1') { forceReads++; return route.fulfill({ json: unavailable }); }
    return route.fulfill({ json: account() });
  });
  await page.goto('/#insights');
  const card = page.getByRole('region', { name: 'Claude account usage' });
  await expect(card.getByRole('meter')).toHaveCount(2);
  const refresh = card.getByRole('button', { name: 'Refresh account usage', exact: true });
  await expect(refresh).toBeDisabled();
  await page.clock.fastForward(10001);
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(card.getByRole('meter')).toHaveCount(0);
  await expect(refresh).toBeDisabled();
  expect(forceReads).toBe(1);
});

test('network failures never promote historical status or invent zero usage', async ({ page }) => {
  await workspace(page);
  await page.route('**/api/claude-usage*', route => route.abort());
  await page.goto('/#insights');
  const card = page.getByRole('region', { name: 'Claude account usage' });
  await expect(card.getByText('Waiting for a fresh report', { exact: true })).toBeVisible();
  await expect(card.getByText(/Use Claude \/usage or sign in normally/).first()).toBeVisible();
  await expect(card.getByRole('meter')).toHaveCount(0);
  await expect(card.getByText('0% used', { exact: true })).toHaveCount(0);
});

test('demo keeps sample quotas and makes no private account request', async ({ page }) => {
  let privateRequests = 0;
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'demo'));
  await page.route('**/api/claude-usage*', route => { privateRequests++; return route.fulfill({ json: unavailable }); });
  await page.goto('/#insights');
  await expect(page.getByText('42% used', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh account usage' })).toHaveCount(0);
  expect(privateRequests).toBe(0);
});

test('fixture staging keeps the real account endpoint disabled', async ({ request }) => {
  const staging = process.env.AGENCY_STAGING_URL;
  test.skip(!staging, 'Requires the isolated staging runner.');
  const response = await request.get(staging + '/api/claude-usage?refresh=1');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ status: 'unavailable', limits: null, fetchedAt: null, reason: expect.stringMatching(/disabled/i) });
});
