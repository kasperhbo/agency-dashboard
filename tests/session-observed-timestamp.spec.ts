import { test, expect, type Page } from '@playwright/test';
import type { Session } from '../src/types';

const now = '2026-10-16T12:00:00Z';
async function fixture(page: Page, overrides: Partial<Session>) {
  const session = { id: 'observed-fixture', nativeId: 'native-observed-fixture', title: 'Timestamp source fixture', project: 'fixture', provider: 'claude', model: 'claude-fixture', status: 'idle', startedAt: '2026-10-16T10:00:00Z', updatedAt: '2026-10-16T11:30:00Z', lastActivityAt: '2026-10-16T11:30:00Z', timestampSource: 'log', tokens: null, events: [], ...overrides };
  await page.clock.install({ time: new Date(now) });
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [session], sources: [], scannedAt: now } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.goto('/#agents');
  await page.locator('.session-card').filter({ hasText: session.title }).click();
  return page.getByRole('dialog', { name: 'Session details', exact: true });
}

test('log timestamp shows absolute UTC, relative time and log provenance without changing idle status', async ({ page }) => {
  const dialog = await fixture(page, { lastActivityAt: '2026-10-16T13:30:00+02:00', updatedAt: now });
  const observed = dialog.getByRole('group', { name: 'Observed timestamp', exact: true });
  await expect(observed.locator('time')).toHaveAttribute('datetime', '2026-10-16T11:30:00.000Z');
  await expect(observed).toContainText('2026-10-16 11:30:00 UTC');
  await expect(observed).toContainText('30m ago · From session log');
  await expect(dialog.locator('.status-badge')).toHaveText('Idle');
  await expect(dialog).not.toContainText('Last activity');
});

test('file fallback stays visibly file-derived on mobile, with accessible UTC time and unchanged completed status', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await fixture(page, { lastActivityAt: undefined, updatedAt: '2026-10-16T11:15:00Z', timestampSource: 'file', status: 'completed' });
  const observed = dialog.getByRole('group', { name: 'Observed timestamp', exact: true });
  await expect(observed).toContainText('2026-10-16 11:15:00 UTC');
  await expect(observed).toContainText('45m ago · From file modification time');
  await expect(observed.locator('time')).toHaveAttribute('datetime', '2026-10-16T11:15:00.000Z');
  await expect(dialog.locator('.status-badge')).toHaveText('Completed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.session-card')).toBeFocused();
});

for (const kind of ['missing', 'invalid'] as const) {
  test(`${kind} timestamp safely shows Not reported`, async ({ page }) => {
    const dialog = await fixture(page, kind === 'missing' ? { lastActivityAt: undefined, updatedAt: '' } : { lastActivityAt: 'invalid-timestamp', updatedAt: now });
    const observed = dialog.getByRole('group', { name: 'Observed timestamp', exact: true });
    await expect(observed).toContainText('Not reported');
    await expect(observed.locator('time')).toHaveCount(0);
    await expect(observed).not.toContainText('NaN');
    await expect(observed).not.toContainText('Invalid Date');
    await expect(dialog.locator('.status-badge')).toHaveText('Idle');
  });
}

test('known timestamp without provenance does not invent a log or file source', async ({ page }) => {
  const dialog = await fixture(page, { timestampSource: undefined });
  const observed = dialog.getByRole('group', { name: 'Observed timestamp', exact: true });
  await expect(observed).toContainText('Timestamp source not reported');
  await expect(observed).not.toContainText('From session log');
  await expect(observed).not.toContainText('From file modification time');
});
