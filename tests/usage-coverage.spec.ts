import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const metrics = (tokens: number | null) => ({ inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: tokens });

async function fixture(page: Page) {
  const now = new Date().toISOString(), day = now.slice(0, 10);
  const session = (id: string, coverage: string | null, provider = 'claude', dated = true) => ({ id, nativeId: id, provider, title: id, project: id, model: 'fixture-model', status: 'completed', startedAt: now, updatedAt: now, tokens: coverage === 'unavailable' || !coverage ? null : 10, events: [], partial: coverage === 'partial', ...(coverage ? { usage: { ...metrics(coverage === 'unavailable' ? null : 10), coverage, daily: dated ? [{ day, ...metrics(coverage === 'unavailable' ? null : 10) }] : [], undatedTokens: dated ? 0 : 10, records: 1, skippedLines: 0, issues: [], limits: null, context: null, costEstimate: null } } : {}) });
  const sessions = [session('partial-claude', 'partial'), session('unavailable-claude', 'unavailable'), session('missing-usage', null), session('complete-codex', 'complete', 'codex'), session('undated-complete', 'complete', 'claude', false), ...Array.from({ length: 22 }, (_, index) => session(`complete-claude-${index}`, 'complete'))];
  const provider = (name: string) => ({ provider: name, ...metrics(500), daily: [{ day, ...metrics(100) }], undatedTokens: 0, runCount: 1, sessionCount: 1, subagentCount: 0, withUsage: 1, unavailableCount: 0, partialCount: 0, duplicateRecordsRemoved: 0, duplicateThreadsRemoved: 0, limits: null, context: null });
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions, sources: [], scannedAt: now, usage: { ...metrics(1000), providers: [provider('claude'), provider('codex')], daily: [], undatedTokens: 0 } } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.route('**/api/claude-usage*', route => route.fulfill({ json: { status: 'unavailable', limits: null, fetchedAt: null, reason: 'Fixture' } }));
  await page.goto('/#insights');
  await expect(page.getByRole('combobox', { name: 'Run coverage', exact: true })).toBeVisible();
}

async function csv(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  return (await readFile((await (await pending).path())!)).toString('utf8');
}

test('run coverage filters logs independently of aggregates, chart and CSV', async ({ page }) => {
  await fixture(page);
  const coverage = page.getByRole('combobox', { name: 'Run coverage', exact: true });
  const rows = page.locator('.usage-table tbody tr');
  const summary = await page.locator('.usage-summary').innerText();
  const chart = await page.locator('.usage-days').innerText();
  const before = await csv(page);
  await page.getByRole('button', { name: /Show more runs/ }).click();
  await expect(rows).toHaveCount(27);
  await coverage.selectOption('partial');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('partial-claude');
  await coverage.selectOption('unavailable');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'missing-usage' })).toHaveCount(1);
  await coverage.selectOption('complete');
  await expect(rows).toHaveCount(20);
  await expect(page.getByRole('button', { name: /Show more runs/ })).toBeVisible();
  await expect(page.locator('.usage-summary')).toHaveText(summary, { useInnerText: true });
  await expect(page.locator('.usage-days')).toHaveText(chart, { useInnerText: true });
  const after = await csv(page);
  // Download timestamps may differ; the exported records and scope must not.
  const withoutExportTime = (value: string) => value.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, '<timestamp>');
  expect(withoutExportTime(after)).toBe(withoutExportTime(before));
  await coverage.selectOption('all');
  await expect(rows).toHaveCount(20);
});

test('dated filters exclude undated/unavailable runs and coverage reset preserves aggregate scope', async ({ page }) => {
  await fixture(page);
  await page.getByRole('combobox', { name: 'Usage provider' }).selectOption('claude');
  await page.getByRole('combobox', { name: 'Usage period' }).selectOption('today');
  const coverage = page.getByRole('combobox', { name: 'Run coverage', exact: true });
  await coverage.selectOption('unavailable');
  await expect(page.locator('.usage-table tbody tr')).toHaveCount(0);
  await expect(page.locator('.usage-run-panel')).toContainText('No runs with recorded dated usage');
  await page.getByRole('button', { name: 'Reset run coverage', exact: true }).click();
  await expect(coverage).toHaveValue('all');
  await expect(page.getByRole('combobox', { name: 'Usage provider' })).toHaveValue('claude');
  await expect(page.getByRole('combobox', { name: 'Usage period' })).toHaveValue('today');
  await expect(page.locator('.usage-summary article').first().locator('strong')).toHaveText('100');
  await expect(page.locator('.usage-table')).not.toContainText('undated-complete');
  await expect(page.locator('.usage-table')).not.toContainText('complete-codex');
  await page.getByRole('combobox', { name: 'Usage period' }).selectOption('all');
  await coverage.selectOption('unavailable');
  await expect(page.locator('.usage-table tbody tr')).toHaveCount(2);
});

test('native run coverage control remains keyboard usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  const coverage = page.getByRole('combobox', { name: 'Run coverage', exact: true });
  await coverage.focus();
  await expect(coverage).toBeFocused();
  await coverage.selectOption('partial');
  await expect(page.locator('.usage-table tbody tr')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
