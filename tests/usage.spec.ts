import { test, expect } from '@playwright/test';

const metrics = (inputTokens: number | null, outputTokens: number | null, cacheReadTokens: number | null, cacheWriteTokens: number | null, reasoningTokens: number | null, totalTokens: number | null) => ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, totalTokens });
const unknown = metrics(null, null, null, null, null, null);

test.describe('real-data defaults and usage display', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('new workspace uses local data and distinguishes UTC daily usage, cached tokens, unknowns, and stale quotas', async ({ page }) => {
    const now = new Date().toISOString(), today = now.slice(0, 10), yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const claude = metrics(900, 100, 600, 200, 20, 1000), codex = metrics(1800, 200, 1400, 0, 30, 2000);
    const claudeDaily = [{ day: yesterday, ...metrics(720, 80, 480, 160, 16, 800) }, { day: today, ...metrics(180, 20, 120, 40, 4, 200) }];
    const codexDaily = [{ day: yesterday, ...metrics(1080, 120, 840, 0, 20, 1200) }, { day: today, ...metrics(270, 30, 210, 0, 5, 300) }];
    const context = { reportedAt: now, windowTokens: 100000, lastRequestTokens: 300, source: 'Codex token_count' };
    const limits = { reportedAt: now, source: 'Codex token_count rate_limits', plan: null, credits: { hasCredits: false, unlimited: false, balance: '0' }, windows: [{ label: 'Primary window', usedPercent: 55, windowMinutes: 300, resetsAt: new Date(Date.now() - 60000).toISOString(), status: null }] };
    const usage = (values: typeof claude, daily: typeof claudeDaily) => ({ ...values, daily, coverage: 'complete', records: 2, undatedTokens: 0, skippedLines: 0, issues: [], limits: null, context: null, costEstimate: null });
    const session = { nativeId: 'fixture-native', title: 'Usage verification', project: 'fixture-project', model: 'claude-sonnet-5-5', status: 'completed', kind: 'session', startedAt: now, updatedAt: now, tokens: 1000, events: [], partial: false };
    const sessions = [
      { ...session, id: 'claude-fixture', provider: 'claude', usage: { ...usage(claude, claudeDaily), costEstimate: { amountUsd: 12.34, reportedAt: now, source: 'Claude CLI cost-state estimate', incomplete: false } } },
      { ...session, id: 'codex-fixture', provider: 'codex', model: 'gpt-fixture', tokens: 2000, usage: { ...usage(codex, codexDaily), undatedTokens: 500, limits, context } },
      { ...session, id: 'unknown-fixture', provider: 'claude', tokens: null, usage: { ...usage(unknown, []), coverage: 'unavailable', records: 0 } },
    ];
    const totals = metrics(2700, 300, 2000, 200, 50, 3000);
    const report = { ...totals, daily: [{ day: yesterday, ...metrics(1800, 200, 1320, 160, 36, 2000) }, { day: today, ...metrics(450, 50, 330, 40, 9, 500) }], undatedTokens: 500, providers: [
      { provider: 'claude', ...claude, daily: claudeDaily, undatedTokens: 0, runCount: 2, sessionCount: 2, subagentCount: 0, withUsage: 1, unavailableCount: 1, partialCount: 0, duplicateRecordsRemoved: 1, duplicateThreadsRemoved: 0, limits: null, context: null },
      { provider: 'codex', ...codex, daily: codexDaily, undatedTokens: 500, runCount: 1, sessionCount: 1, subagentCount: 0, withUsage: 1, unavailableCount: 0, partialCount: 0, duplicateRecordsRemoved: 0, duplicateThreadsRemoved: 0, limits, context },
    ] };
    await page.route('**/api/sessions', route => route.fulfill({ json: { sessions, sources: [], scannedAt: now, usage: report } }));
    await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
    await page.goto('/');
    await expect(page.locator('.connection-indicator')).toHaveText('Local workspace');
    await expect(page.locator('.usage-summary-button .summary-value')).toContainText('500');
    await page.locator('.usage-summary-button').click();
    await expect(page.locator('.usage-summary article').first().locator('strong')).toHaveText('3K');
    await expect(page.getByText(/1 without usage/)).toBeVisible();
    await expect(page.getByText(/1 replayed responses removed/)).toBeVisible();
    await expect(page.getByText('55% used')).toBeVisible();
    await expect(page.getByText('Reset time passed. Current usage is unknown.')).toBeVisible();
    await expect(page.getByText('100,000 tokens', { exact: true })).toBeVisible();
    await expect(page.getByText('Reported credit balance:')).toContainText('0');
    await page.getByRole('combobox', { name: 'Usage period' }).selectOption('today');
    await expect(page.locator('.usage-summary article').first().locator('strong')).toHaveText('500');
    await page.getByRole('combobox', { name: 'Usage provider' }).selectOption('claude');
    await expect(page.locator('.usage-summary article').first().locator('strong')).toHaveText('200');
    await expect(page.locator('.usage-provider-card').getByText('180', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Usage period' }).selectOption('all');
    await expect(page.locator('.usage-table tbody tr')).toHaveCount(2);
    const unknownRow = page.locator('.usage-table tbody tr').filter({ hasText: 'unavailable' });
    await expect(unknownRow.getByRole('cell', { name: 'Not reported', exact: true })).toHaveCount(5);
    await page.locator('.usage-table tbody tr').first().getByRole('button').click();
    await expect(page.getByRole('dialog').getByText('Claude CLI cost estimate')).toBeVisible();
    await expect(page.getByRole('dialog').getByText(/Recorded estimate, not an invoice/)).toBeVisible();
  });
});

test('explicit demo usage is labeled and remains usable on mobile', async ({ page }) => {
  await page.goto('/#insights');
  await expect(page.getByText('Sample usage for exploring the dashboard.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Claude breakdown' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Codex breakdown' })).toBeVisible();
  await expect(page.getByText('42% used')).toBeVisible();
  await page.locator('h1').click();
  await page.screenshot({ path: 'test-results/agency-usage.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/agency-usage-mobile.png', fullPage: true });
});
