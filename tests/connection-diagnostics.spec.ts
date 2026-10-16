import { test, expect, type Page } from '@playwright/test';
import type { Source } from '../src/types';

const observed = '2026-01-01T12:00:00.000Z';
const source = (overrides: Partial<Source> = {}): Source => ({ provider: 'codex', path: 'C:\\Users\\OtherAccount\\.codex\\sessions', status: 'connected', count: 0, limited: false, warnings: [], ...overrides });
async function fixture(page: Page, sources: Source[]) {
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [], sources, scannedAt: observed } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.goto('/#settings');
  return page.getByRole('region', { name: 'Agent connections', exact: true });
}

test('connected empty and old observations explain recovery without diagnosing an account mismatch', async ({ page }) => {
  const panel = await fixture(page, [source()]);
  await expect(panel.getByText('0 observed logs', { exact: true })).toBeVisible();
  await expect(panel.locator('time')).toHaveAttribute('datetime', observed);
  await expect(panel).toContainText('This is when Agency checked the logs, not when an agent last worked.');
  await expect(panel).toContainText('Resolved source path not yet observed');
  const disclosure = panel.locator('summary').filter({ hasText: 'Missing expected Codex sessions?' });
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByText(/Connected means the configured directory can be read/).last()).toBeVisible();
  await expect(panel).toContainText('missing or old observations alone do not establish a mismatch');
  await expect(panel).toContainText('CODEX_HOME/sessions');
  await expect(panel).toContainText('restart Agency, then choose Check connections');
  await expect(panel).not.toContainText('Latest supported log activity');
  await page.keyboard.press('Enter');
  await expect(disclosure.locator('..')).not.toHaveAttribute('open', '');
});

test('missing, unreadable, and bounded sources retain honest diagnostics on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await fixture(page, [source({ provider: 'claude', status: 'not_found', path: '/missing/claude', warnings: [] }), source({ status: 'error', limited: true, warnings: ['Fixture permission denied; scan limit reached'] })]);
  await expect(panel).toContainText('Session directory not found. Compare this path');
  await expect(panel).toContainText('Session directory could not be read. Check permissions.');
  await expect(panel.getByText('Fixture permission denied; scan limit reached')).toBeVisible();
  await panel.locator('summary').filter({ hasText: 'Missing expected Claude sessions?' }).click();
  await expect(panel).toContainText('AGENCY_CLAUDE_ROOT');
  await expect(panel).not.toContainText('Run this agent once to create it');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('failed connection check retains the last observation instead of claiming fresh success', async ({ page }) => {
  const panel = await fixture(page, [source({ limited: true, warnings: ['Fixture scan cap reached'] })]);
  await expect(panel.locator('time')).toHaveAttribute('datetime', observed);
  await expect(panel.getByText('Fixture scan cap reached')).toBeVisible();
  await page.route('**/api/sessions', route => route.fulfill({ status: 503, json: { error: 'Fixture connection check failed' } }));
  await panel.getByRole('button', { name: 'Check connections' }).click();
  await expect(page.getByText('Fixture connection check failed', { exact: false }).first()).toBeVisible();
  await expect(panel.locator('time')).toHaveAttribute('datetime', observed);
  await expect(panel.getByText('Fixture scan cap reached')).toBeVisible();
});

test('demo mode hides retained local paths and observations and disables local checks', async ({ page }) => {
  const panel = await fixture(page, [source()]);
  await expect(panel.getByText(source().path)).toBeVisible();
  await page.getByRole('button', { name: /Demo workspace Explore sample agents/ }).click();
  await expect(panel).toContainText('Demo workspace uses sample sessions.');
  await expect(panel.getByRole('button', { name: 'Check connections' })).toBeDisabled();
  await expect(panel).not.toContainText(source().path);
  await expect(panel.locator('time')).toHaveCount(0);
  await expect(panel.locator('summary')).toHaveCount(0);
});
