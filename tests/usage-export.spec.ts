import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { usageCsv } from '../src/usage-export';

const metrics = (total: number | null) => ({ inputTokens: total, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: null, reasoningTokens: null, totalTokens: total });
function parseCsv(text: string) {
  return text.replace(/^\uFEFF/, '').trimEnd().split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"')));
}
async function downloadRows(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^agency-usage-(local|demo)-/);
  const bytes = await readFile((await download.path())!);
  expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
  const [header, ...rows] = parseCsv(bytes.toString('utf8'));
  return rows.map(row => Object.fromEntries(header.map((key, index) => [key, row[index]])));
}

test('CSV follows provider/period filters, preserves unknown and zero, and separates undated summary', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const observedAt = new Date().toISOString();
  const outsideWindow = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const provider = (name: string, total: number, daily: object[], undatedTokens: number) => ({ provider: name, ...metrics(total), daily, undatedTokens, runCount: 1, sessionCount: 1, subagentCount: 0, withUsage: 1, unavailableCount: 0, partialCount: 1, duplicateRecordsRemoved: 0, duplicateThreadsRemoved: 0, limits: null, context: null });
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], sources: [], scannedAt: observedAt, usage: { ...metrics(1800), daily: [], undatedTokens: 500, providers: [provider('claude', 1000, [{ day: today, ...metrics(200) }, { day: yesterday, ...metrics(0) }, { day: outsideWindow, ...metrics(300) }], 500), provider('codex', 800, [{ day: today, ...metrics(null) }], 0)] } } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.route('**/api/claude-usage*', route => route.fulfill({ json: { status: 'unavailable', limits: null, fetchedAt: null, reason: 'Fixture' } }));
  await page.goto('/#insights');
  const all = await downloadRows(page);
  expect(all[0]).toMatchObject({ row_type: 'summary', totalTokens: '1800', undated_tokens_all_history: '500', observed_at_utc: observedAt, source: 'Local native logs' });
  expect(all.every(row => row.caveats.includes('not billing'))).toBe(true);
  expect(all.some(row => row.row_type === 'daily' && row.totalTokens === '0')).toBe(true);
  expect(all.some(row => row.row_type === 'daily' && row.provider === 'Codex' && row.observation === 'Not reported' && row.totalTokens === 'Not reported')).toBe(true);
  expect(Object.keys(all[0]).join(',')).not.toMatch(/project|model|prompt|path|cost/);
  await page.getByRole('combobox', { name: 'Usage provider' }).selectOption('claude');
  await page.getByRole('combobox', { name: 'Usage period' }).selectOption('today');
  await expect(page.locator('.usage-summary article').first().locator('strong')).toHaveText('200');
  const filtered = await downloadRows(page);
  expect(filtered).toHaveLength(3);
  expect(filtered[0].totalTokens).toBe('200');
  expect(filtered[1].totalTokens).toBe('200');
  expect(filtered[2]).toMatchObject({ row_type: 'daily', date_utc: today, totalTokens: '200', cacheWriteTokens: 'Not reported' });
  expect(filtered.every(row => row.provider !== 'Codex' && row.period === 'today')).toBe(true);
  await page.getByRole('combobox', { name: 'Usage period' }).selectOption('7d');
  const weekly = await downloadRows(page);
  const dailyRows = weekly.filter(row => row.row_type === 'daily');
  expect(dailyRows).toHaveLength(7);
  expect(dailyRows[0].date_utc).toBe(new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  expect(dailyRows.at(-1)!.date_utc).toBe(today);
  expect(dailyRows.some(row => row.date_utc === outsideWindow)).toBe(false);
  expect(weekly[0].totalTokens).toBe('200');
  expect(weekly.some(row => row.observation === 'No recorded usage' && row.totalTokens === 'Not reported')).toBe(true);
});

test('demo CSV is explicitly labeled and does not claim a native observation time', async ({ page }) => {
  await page.goto('/#insights');
  const rows = await downloadRows(page);
  expect(rows.every(row => row.source === 'Demo sample data' && row.observed_at_utc === 'Not reported')).toBe(true);
  expect(Number.isFinite(Date.parse(rows[0].exported_at_utc))).toBe(true);
});

test('CSV download is disabled when the selected provider has no report', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], sources: [], scannedAt: new Date().toISOString(), usage: { ...metrics(null), providers: [], daily: [], undatedTokens: 0 } } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.goto('/#insights');
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeDisabled();
});

test('CSV serializer quotes cells and neutralizes spreadsheet formulas', () => {
  const csv = usageCsv([], ' \t=HYPERLINK("test", "value")\nnext', 'local', '', Date.parse('2026-10-16T00:00:00Z'));
  expect(csv).toContain('"\' \t=HYPERLINK(""test"", ""value"")\nnext"');
});
