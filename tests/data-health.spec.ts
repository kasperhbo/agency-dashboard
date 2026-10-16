import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Source } from '../src/types';

const stamp = '2026-10-16T12:00:00.000Z';
const source = (provider: Source['provider'], overrides: Partial<Source> = {}): Source => ({ provider, path: `/fixture/${provider}`, status: 'connected', count: provider === 'claude' ? 4 : 0, sessionCount: provider === 'claude' ? 4 : 0, subagentCount: 0, limited: false, warnings: [], ...overrides });
const metrics = { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, totalTokens: null };
const sessions = ['complete', 'partial', 'unavailable', 'unknown'].map((coverage, index) => ({ id: `health-${index}`, nativeId: `health-${index}`, title: `Health fixture ${index}`, provider: 'claude', project: 'fixture', model: 'claude-fixture', status: 'completed', startedAt: stamp, updatedAt: stamp, tokens: null, events: [], ...(coverage === 'unknown' ? {} : { usage: { ...metrics, coverage, daily: [], undatedTokens: 0, records: 0, skippedLines: 0, issues: [], limits: null, context: null, costEstimate: null } }) }));
const tasks = [{ id: 'health-task', title: 'Local health task', description: '', project: 'fixture', provider: 'claude', status: 'todo', priority: 'medium', revision: 1, createdAt: stamp, updatedAt: stamp }];
async function fixture(page: Page, options: { sources?: Source[]; empty?: boolean; sessionFailure?: boolean; taskFailure?: boolean; observedAt?: string } = {}) {
  let sessionFailure = !!options.sessionFailure, taskFailure = !!options.taskFailure;
  let sessionReads = 0, taskReads = 0;
  await page.clock.install({ time: new Date(stamp) });
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => {
    sessionReads++;
    return sessionFailure ? route.fulfill({ status: 503, json: { error: 'PRIVATE_LOCAL_SESSION_ERROR' } }) : route.fulfill({ json: { sessions: options.empty ? [] : sessions, sources: options.sources ?? [source('claude'), source('codex')], scannedAt: options.observedAt ?? stamp } });
  });
  await page.route('**/api/tasks', route => {
    taskReads++;
    return taskFailure ? route.fulfill({ status: 503, json: { error: 'PRIVATE_LOCAL_TASK_ERROR' } }) : route.fulfill({ json: options.empty ? [] : tasks });
  });
  await page.goto('/#data-health');
  await expect(page.getByRole('region', { name: 'Provider observations', exact: true })).toBeVisible();
  return { fail: () => { sessionFailure = true; taskFailure = true; }, counts: () => [sessionReads, taskReads] };
}
const provider = (page: Page, name: string) => page.getByRole('article', { name: `${name} source observation`, exact: true });
const taskPanel = (page: Page) => page.getByRole('region', { name: 'Task data observation', exact: true });
const coveragePanel = (page: Page) => page.getByRole('region', { name: 'Loaded session usage coverage', exact: true });
const value = (panel: Locator, name: string) => panel.getByText(name, { exact: true }).locator('..').locator('dd');

test('connected-empty and missing-directory observations preserve reported counts and offer refresh/settings actions', async ({ page }) => {
  const state = await fixture(page, { empty: true, sources: [source('claude', { count: 0, sessionCount: 0 }), source('codex', { status: 'not_found', sessionCount: undefined, subagentCount: undefined })] });
  await expect(provider(page, 'Claude')).toHaveAttribute('data-state', 'empty');
  await expect(provider(page, 'Claude')).toContainText('Connected (directory readable)');
  await expect(provider(page, 'Claude')).toContainText('does not establish that no sessions exist');
  await expect(value(provider(page, 'Claude'), 'Parsed session records')).toHaveText('0');
  await expect(provider(page, 'Codex')).toHaveAttribute('data-state', 'not_found');
  await expect(value(provider(page, 'Codex'), 'Parsed session records')).toHaveText('Not reported');
  await expect(value(provider(page, 'Codex'), 'Unique sessions reported')).toHaveText('Not reported');
  await expect(taskPanel(page)).toHaveAttribute('data-state', 'empty');
  await expect(value(taskPanel(page), 'Tasks in retained browser state')).toHaveText('0');
  await expect(provider(page, 'Claude').locator('time')).toHaveAttribute('datetime', stamp);
  const before = state.counts();
  await page.getByRole('button', { name: 'Refresh observations', exact: true }).click();
  await expect.poll(state.counts).toEqual(before.map(count => count + 1));
  await page.getByRole('button', { name: 'Open source settings', exact: true }).click();
  await page.waitForURL('**/#settings');
  await expect(page.getByRole('region', { name: 'Agent connections', exact: true })).toBeVisible();
});

test('provider limits/warnings and loaded usage unknown/partial/unavailable stay distinct', async ({ page }) => {
  await fixture(page, { sources: [source('claude', { limited: true, warnings: ['One supported log could not be fully read'] }), source('codex', { status: 'error' })] });
  await expect(provider(page, 'Claude')).toHaveAttribute('data-state', 'partial');
  await expect(provider(page, 'Claude')).toContainText('Scan limits were reached');
  await expect(provider(page, 'Claude').getByRole('list', { name: 'Claude source warnings', exact: true })).toContainText('One supported log');
  await expect(provider(page, 'Codex')).toHaveAttribute('data-state', 'error');
  const coverage = coveragePanel(page);
  await expect(coverage).toHaveAttribute('data-state', 'partial');
  await expect(value(coverage, 'Loaded session records')).toHaveText('4');
  for (const label of ['Complete usage coverage reported', 'Partial usage coverage reported', 'Usage unavailable reported', 'Coverage not reported (unknown)']) await expect(value(coverage, label)).toHaveText('1');
  await expect(coverage).toContainText('currently loaded session records, not all history');
  await expect(coverage).toContainText('not deduplicated workspace token totals');
});

test('initial session failure cannot look empty or healthy and does not hide a successful task read', async ({ page }) => {
  await fixture(page, { sessionFailure: true });
  await expect(provider(page, 'Claude')).toHaveAttribute('data-state', 'error');
  await expect(value(provider(page, 'Claude'), 'Parsed session records')).toHaveText('Not reported');
  await expect(coveragePanel(page)).toHaveAttribute('data-state', 'unknown');
  await expect(value(coveragePanel(page), 'Loaded session records')).toHaveText('Not reported');
  await expect(taskPanel(page)).toHaveAttribute('data-state', 'observed');
  await expect(value(taskPanel(page), 'Tasks in retained browser state')).toHaveText('1');
});

test('missing provider observation and failed task list remain unknown without zero substitution', async ({ page }) => {
  await fixture(page, { sources: [], taskFailure: true });
  await expect(provider(page, 'Claude')).toHaveAttribute('data-state', 'unknown');
  await expect(value(provider(page, 'Claude'), 'Parsed session records')).toHaveText('Not reported');
  await expect(provider(page, 'Claude')).toContainText('No source observation was returned');
  await expect(taskPanel(page)).toHaveAttribute('data-state', 'error');
  await expect(value(taskPanel(page), 'Tasks in retained browser state')).toHaveText('Not reported');
  await expect(taskPanel(page)).toContainText('Task availability is unknown');
});

test('stale and failed refreshes retain counts and keep task read age separate from mutations', async ({ page }) => {
  const state = await fixture(page);
  state.fail();
  await page.clock.fastForward(130000);
  await expect(provider(page, 'Claude')).toHaveAttribute('data-state', 'error');
  await expect(value(provider(page, 'Claude'), 'Parsed session records')).toHaveText('4');
  await expect(provider(page, 'Claude')).toContainText('source observation is stale');
  await expect(taskPanel(page)).toHaveAttribute('data-state', 'error');
  await expect(value(taskPanel(page), 'Tasks in retained browser state')).toHaveText('1');
  await expect(taskPanel(page)).toContainText('last successful task list read is stale');
  await expect(taskPanel(page)).toContainText('recent task update does not renew list-read freshness');
  await expect(coveragePanel(page)).toContainText('stale loaded snapshot');
});

test('stale observations are labeled even when current endpoint requests succeed', async ({ page }) => {
  await fixture(page, { observedAt: '2026-10-16T11:55:00.000Z' });
  await expect(provider(page, 'Claude')).toHaveAttribute('data-state', 'stale');
  await expect(provider(page, 'Claude').locator('time')).toContainText('5m ago');
  await expect(taskPanel(page)).toHaveAttribute('data-state', 'observed');
  await expect(coveragePanel(page)).toHaveAttribute('data-state', 'stale');
});

test('future-skewed snapshot timestamps clamp observation age to zero', async ({ page }) => {
  await fixture(page, { observedAt: '2026-10-16T12:05:00.000Z' });
  await expect(provider(page, 'Claude').locator('time')).toContainText('0s ago');
  await expect(provider(page, 'Claude').locator('time')).not.toContainText('· -');
});

test('Demo does not disclose retained Local diagnostics or imply Local source observations', async ({ page }) => {
  const state = await fixture(page, { sources: [source('claude', { path: 'C:/SECRET_LOCAL_ROOT', limited: true, warnings: ['PRIVATE_SOURCE_WARNING'] })] });
  state.fail();
  await page.getByRole('button', { name: 'Refresh observations', exact: true }).click();
  await expect(provider(page, 'Claude')).toContainText('PRIVATE_LOCAL_SESSION_ERROR');
  await page.getByRole('button', { name: 'Open source settings', exact: true }).click();
  await page.getByRole('button', { name: /Demo workspace Explore sample agents/ }).click();
  await page.getByRole('link', { name: 'Data health', exact: true }).click();
  const health = page.locator('.data-health');
  await expect(health).toContainText('Demo sample data only');
  await expect(provider(page, 'Claude')).toHaveAttribute('data-state', 'sample');
  await expect(taskPanel(page)).toHaveAttribute('data-state', 'sample');
  await expect(coveragePanel(page)).toHaveAttribute('data-state', 'sample');
  for (const secret of ['SECRET_LOCAL_ROOT', 'PRIVATE_SOURCE_WARNING', 'PRIVATE_LOCAL_SESSION_ERROR', 'PRIVATE_LOCAL_TASK_ERROR', stamp]) await expect(health).not.toContainText(secret);
  await expect(health.locator('time')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh observations', exact: true })).toBeDisabled();
});

test('Data health works by keyboard on mobile with accessible labels and no overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, { sources: [source('claude', { path: 'C:/' + 'VeryLongDirectory'.repeat(25), limited: true, warnings: ['Long warning ' + 'details'.repeat(35)] })] });
  const refresh = page.getByRole('button', { name: 'Refresh observations', exact: true });
  await refresh.focus(); await page.keyboard.press('Enter');
  await expect(refresh).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
