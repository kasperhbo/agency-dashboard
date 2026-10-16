import { test, expect, type Page } from '@playwright/test';

const metrics = { inputTokens: 90, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 100 };
const titles = ['Repair payment retry handling', 'Review payment retry tests', '', '   ', 'Very long run title ' + 'internationalization 確認 🐈 '.repeat(35)];
async function fixture(page: Page) {
  const now = new Date().toISOString(), day = now.slice(0, 10);
  const sessions = titles.map((title, index) => ({ id: `identity-${index}`, nativeId: `identity-${index}`, title, provider: 'claude', kind: index === 3 ? 'subagent' : 'session', parentNativeId: index === 3 ? 'identity-0' : undefined, project: 'same-project', model: 'claude-same-model', status: 'completed', startedAt: now, updatedAt: now, tokens: 100, events: [{ id: 'proof', label: `Identity proof ${index}`, kind: 'tool', timestamp: now }], usage: { ...metrics, daily: [{ day, ...metrics }], coverage: 'complete', records: 1, undatedTokens: 0, skippedLines: 0, issues: [], limits: null, context: null, costEstimate: null } }));
  const provider = { provider: 'claude', ...metrics, daily: [{ day, ...metrics }], undatedTokens: 0, runCount: 5, sessionCount: 4, subagentCount: 1, withUsage: 5, unavailableCount: 0, partialCount: 0, duplicateRecordsRemoved: 0, duplicateThreadsRemoved: 0, limits: null, context: null };
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions, sources: [], scannedAt: now, usage: { ...metrics, daily: [{ day, ...metrics }], undatedTokens: 0, providers: [provider] } } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.route('**/api/claude-usage*', route => route.fulfill({ json: { status: 'unavailable', limits: null, fetchedAt: null, reason: 'Fixture' } }));
  await page.goto('/#insights');
}

test('same model/project runs expose different primary titles and open the exact corresponding session', async ({ page }) => {
  await fixture(page);
  const table = page.locator('.usage-table');
  await expect(table.locator('.table-session strong')).toHaveText([titles[0], titles[1], 'Session', 'Subagent', titles[4]]);
  for (const index of [0, 1]) {
    const row = table.getByRole('row').filter({ has: page.getByText(titles[index], { exact: true }) });
    await expect(row).toContainText('Claude · Session · same-model');
    await expect(row).toContainText('same-project');
    const button = row.getByRole('button', { name: new RegExp(titles[index]) });
    await button.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Session details', exact: true });
    await expect(dialog.locator('.detail-title')).toHaveText(titles[index]);
    await expect(dialog).toContainText(`Identity proof ${index}`);
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
  }
  await expect(page.locator('.usage-summary article').first().locator('strong')).toHaveText('100');
  await expect(table.locator('tbody tr')).toHaveCount(5);
});

test('blank titles fall back to run kind while long mobile titles retain full accessible identity without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  const buttons = page.locator('.usage-table .table-session');
  await expect(buttons.nth(2).locator('strong')).toHaveText('Session');
  await expect(buttons.nth(3).locator('strong')).toHaveText('Subagent');
  await expect(buttons.nth(3)).toContainText('Claude · Subagent · same-model');
  await buttons.nth(3).click();
  await expect(page.getByRole('dialog')).toContainText('Identity proof 3');
  await page.keyboard.press('Escape');
  const long = buttons.nth(4);
  await expect(long).toHaveAccessibleName(new RegExp(titles[4].trim()));
  await expect(long.locator('strong')).toHaveAttribute('title', titles[4].trim());
  const width = await long.locator('strong').evaluate(element => element.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(230);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('combobox', { name: 'Run coverage', exact: true }).selectOption('unavailable');
  await expect(page.locator('.usage-table tbody tr')).toHaveCount(0);
  await expect(page.locator('.usage-summary article').first().locator('strong')).toHaveText('100');
});
