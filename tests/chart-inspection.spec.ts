import { test, expect, type Page } from '@playwright/test';

const metrics = (totalTokens: number | null) => ({ inputTokens: totalTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens });
const dayAt = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
async function fixture(page: Page) {
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  let total = 1200;
  const snapshot = () => {
    const today = dayAt(0), yesterday = dayAt(1), unknownDay = dayAt(2);
    const provider = (name: string, daily: object[]) => ({ provider: name, ...metrics(total), daily, undatedTokens: 0, runCount: 1, sessionCount: 1, subagentCount: 0, withUsage: 1, unavailableCount: 0, partialCount: 1, duplicateRecordsRemoved: 0, duplicateThreadsRemoved: 0, limits: null, context: null });
    return { sessions: [], sources: [], scannedAt: new Date().toISOString(), usage: { ...metrics(total), daily: [], undatedTokens: 0, providers: [
      provider('claude', [{ day: today, ...metrics(total) }, { day: yesterday, ...metrics(0) }, { day: unknownDay, ...metrics(null) }]),
      provider('codex', [{ day: today, ...metrics(null) }, { day: yesterday, ...metrics(0) }]),
    ] } };
  };
  await page.route('**/api/sessions', route => route.fulfill({ json: snapshot() }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.route('**/api/claude-usage*', route => route.fulfill({ json: { status: 'unavailable', limits: null, fetchedAt: null, reason: 'Fixture' } }));
  await page.goto('/#insights');
  return { update: (value: number) => { total = value; } };
}

test('usage chart exposes exact UTC dates, missing/null/zero and partial totals to keyboard and table', async ({ page }) => {
  await fixture(page);
  const chart = page.locator('.usage-days');
  const today = chart.getByRole('button', { name: new RegExp(dayAt(0) + ' UTC:') });
  await chart.getByRole('button', { name: new RegExp(dayAt(2) + ' UTC:') }).hover();
  await today.focus();
  const details = page.getByRole('region', { name: 'Daily usage details' });
  await expect(details).toContainText('Claude: 1,200 recorded tokens');
  await expect(details).toContainText('Codex: Not reported');
  await expect(details).toContainText('1,200 recorded tokens · partial observations');
  await expect(today).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(today).toHaveAttribute('aria-pressed', 'false');
  await chart.getByRole('button', { name: new RegExp(dayAt(1) + ' UTC:') }).click();
  await expect(details).toContainText('Claude: 0 recorded tokens');
  await expect(details).toContainText('Codex: 0 recorded tokens');
  await chart.getByRole('button', { name: new RegExp(dayAt(2) + ' UTC:') }).click();
  await expect(details).toContainText('Claude: Not reported');
  await expect(details).toContainText('Codex: No recorded usage');
  await chart.getByText('View daily usage data', { exact: true }).click();
  const table = chart.getByRole('table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: dayAt(0) })).toContainText('1,200 recorded tokens');
  await expect(table.getByRole('row').filter({ hasText: dayAt(2) })).toContainText('No recorded usage');
  await chart.getByRole('button', { name: 'Reset daily usage selection' }).click();
  await expect(chart.locator('[aria-pressed="true"]')).toHaveCount(0);
});

test('usage date selection survives refresh/provider filters and fixed trend ignores summary period', async ({ page }) => {
  const source = await fixture(page);
  const chart = page.locator('.usage-days');
  const day = dayAt(0);
  const bucket = chart.getByRole('button', { name: new RegExp(day + ' UTC:') });
  await bucket.click();
  source.update(3456);
  await page.getByRole('button', { name: 'Refresh workspace', exact: true }).click();
  await expect(bucket).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Daily usage details' })).toContainText('Claude: 3,456 recorded tokens');
  await page.getByRole('combobox', { name: 'Usage provider' }).selectOption('claude');
  await expect(bucket).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Daily usage details' })).not.toContainText('Codex:');
  await page.getByRole('combobox', { name: 'Usage period' }).selectOption('today');
  await expect(chart.getByRole('button', { name: / UTC:/ })).toHaveCount(7);
  await expect(chart).toContainText('Fixed last 7 calendar days · UTC');
  expect(await chart.evaluate(el => el.compareDocumentPosition(document.querySelector('.usage-provider-grid')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
});

test('daily usage buckets are tappable on a touch device', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await fixture(page);
  const chart = page.locator('.usage-days');
  await chart.getByRole('button', { name: new RegExp(dayAt(1) + ' UTC:') }).tap();
  await expect(page.getByRole('region', { name: 'Daily usage details' })).toContainText('0 recorded tokens');
  await expect(chart.locator('[aria-pressed="true"]')).toHaveCount(1);
  await context.close();
});


test('a selected date that leaves the UTC window is cleared explicitly', async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await fixture(page);
  const chart = page.locator('.usage-days');
  await chart.getByRole('button', { name: new RegExp(dayAt(0) + ' UTC:') }).click();
  await page.clock.setSystemTime(new Date(Date.now() + 8 * 86400000));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('button', { name: 'Refresh workspace', exact: true }).click();
  await expect(chart.locator('[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Daily usage details' })).toContainText('The selected date is outside the current chart window. Selection cleared.');
});

test('daily usage UTC window advances at midnight without a workspace refresh', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T23:59:00.000Z') });
  await fixture(page);
  const chart = page.locator('.usage-days');
  await expect(chart.getByRole('button', { name: /2026-10-16 UTC:/ })).toHaveCount(1);
  await page.clock.fastForward(120000);
  await expect(chart.getByRole('button', { name: /2026-10-17 UTC:/ })).toHaveCount(1);
  await expect(chart.getByRole('button', { name: /2026-10-10 UTC:/ })).toHaveCount(0);
});
