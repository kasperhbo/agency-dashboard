import { test, expect, type Page } from '@playwright/test';
import { parseSession } from '../server/sessions.mjs';

async function openSession(page: Page, events: object[]) {
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  const session = {
    id: 'event-times', nativeId: 'event-times-native', provider: 'codex', title: 'Event time fixture',
    project: 'fixture', model: 'gpt-5', status: 'idle', tokens: null, partial: false,
    startedAt: '2026-10-15T23:58:00Z', updatedAt: '2026-10-16T00:02:00Z', events,
  };
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [session], sources: [], scannedAt: new Date().toISOString() } }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.goto('/#agents');
  await page.getByRole('button', { name: /Event time fixture/ }).click();
  return page.getByRole('dialog', { name: 'Session details' });
}

test('session events expose complete UTC times across midnight and preserve API order', async ({ page }) => {
  const dialog = await openSession(page, [
    { id: 'newer', label: 'First in source', kind: 'tool', timestamp: '2026-10-16T02:01:02+02:00' },
    { id: 'older', label: 'Second in source', kind: 'info', timestamp: '2026-10-15T23:59:58Z' },
    { id: 'tie', label: 'Third in source', kind: 'success', timestamp: '2026-10-15T23:59:58Z' },
  ]);
  const rows = dialog.locator('.detail-event');
  await expect(rows.locator('> span:nth-child(2)')).toHaveText(['First in source', 'Second in source', 'Third in source']);
  await expect(rows.locator('time')).toHaveText(['2026-10-16 00:01:02 UTC', '2026-10-15 23:59:58 UTC', '2026-10-15 23:59:58 UTC']);
  await expect(rows.first().locator('time')).toHaveAttribute('datetime', '2026-10-16T00:01:02.000Z');
  await expect(dialog).toContainText('last 35 supported events, in reverse source log order; not a complete lifecycle or timestamp-sorted history');
  await expect(dialog).toContainText('preceding log timestamp or file modification time');
});

test('native parser retention and reverse source order reach session details unchanged', async ({ page }) => {
  const modified = Date.parse('2026-10-16T12:00:00Z');
  const records = [
    { type: 'session_meta', timestamp: new Date(modified).toISOString(), payload: { id: 'retained-events', cwd: '/fixture' } },
    ...Array.from({ length: 37 }, (_, index) => ({ type: 'event_msg', timestamp: new Date(modified + index * 1000).toISOString(), payload: { type: 'task_started' } })),
  ];
  const parsed = parseSession(records.map(record => JSON.stringify(record)).join('\n'), 'codex', '/fixture/events.jsonl', modified, modified);
  expect(parsed.events.map((event: { id: string }) => event.id)).toEqual(Array.from({ length: 35 }, (_, index) => String(36 - index)));
  const dialog = await openSession(page, parsed.events);
  await expect(dialog.locator('.detail-event')).toHaveCount(35);
  await expect(dialog.locator('.detail-event').first().locator('time')).toHaveAttribute('datetime', '2026-10-16T12:00:36.000Z');
  await expect(dialog.locator('.detail-event').last().locator('time')).toHaveAttribute('datetime', '2026-10-16T12:00:02.000Z');
});

test('session event missing and invalid times stay unavailable without breaking mobile detail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openSession(page, [
    { id: 'missing', label: 'Missing time', kind: 'info' },
    { id: 'null', label: 'Null time', kind: 'info', timestamp: null },
    { id: 'invalid', label: 'Invalid time', kind: 'info', timestamp: 'invalid' },
  ]);
  await expect(dialog.locator('.detail-event')).toHaveCount(3);
  await expect(dialog.locator('.detail-event > span:last-child')).toHaveText(['Not reported', 'Not reported', 'Not reported']);
  await expect(dialog.locator('.detail-event time')).toHaveCount(0);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('empty retained event history keeps its unavailable explanation', async ({ page }) => {
  const dialog = await openSession(page, []);
  await expect(dialog).toContainText('No supported events were found in this session.');
  await expect(dialog.locator('.detail-event')).toHaveCount(0);
});
