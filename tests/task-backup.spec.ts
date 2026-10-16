import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { taskBackup } from '../src/task-backup';

const stamp = '2026-10-16T08:00:00.000Z';
const task = { id: 'backup-task', title: '計畫 🐈 "quoted"', description: 'line one\nline two, =SUM(A1)', project: '專案', provider: 'codex', status: 'in_progress', priority: 'high', sessionId: 'session-private-reference', revision: 7, createdAt: stamp, updatedAt: stamp };
async function fixture(page: Page, tasks: object[] = [task], initialFailure = false) {
  let failed = initialFailure;
  let writes = 0;
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions: [{ id: 'private-session', title: 'DO NOT EXPORT SESSION PROMPT', events: [{ label: 'secret event' }] }], sources: [], scannedAt: stamp } }));
  await page.route('**/api/tasks', route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill(failed ? { status: 503, json: { error: 'Fixture task read failed' } } : { json: tasks });
  });
  await page.goto('/#settings');
  return { fail: () => { failed = true; }, writes: () => writes };
}
async function download(page: Page, source = 'local') {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download task JSON', exact: true }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(new RegExp(`^agency-tasks-${source}-\\d{4}-\\d{2}-\\d{2}\\.json$`));
  return JSON.parse(await readFile((await file.path())!, 'utf8'));
}

test('local backup preserves every task field and never exports session content or writes tasks', async ({ page }) => {
  const state = await fixture(page);
  const button = page.getByRole('button', { name: 'Download task JSON', exact: true });
  await expect(button).toBeEnabled();
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  const backup = await download(page);
  expect(backup.tasks).toEqual([task]);
  expect(backup).toMatchObject({ schemaVersion: 1, source: 'local', snapshot: { status: 'last_confirmed', basis: 'Last confirmed local task state in this browser' } });
  expect(Number.isFinite(Date.parse(backup.snapshot.lastSuccessfulReadAt))).toBe(true);
  expect(backup.snapshot.lastConfirmedUpdateAt).toBe(backup.snapshot.lastSuccessfulReadAt);
  expect(Number.isFinite(Date.parse(backup.exportedAt))).toBe(true);
  expect(JSON.stringify(backup)).not.toContain('DO NOT EXPORT SESSION PROMPT');
  expect(JSON.stringify(backup)).not.toContain('secret event');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storage);
  expect(state.writes()).toBe(0);
  await expect(page.getByRole('region', { name: 'Task backup', exact: true })).toContainText('no import or restore is provided');
});

test('failed initial task read disables backup even after a successful task creation', async ({ page }) => {
  await fixture(page, [], true);
  await expect(page.getByRole('button', { name: 'Download task JSON', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Task backup', exact: true })).toContainText('Tasks have not been successfully read');
  await page.route('**/api/tasks', route => route.request().method() === 'POST' ? route.fulfill({ json: { ...task, title: 'Confirmed new task' } }) : route.fallback());
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Confirmed new task');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download task JSON', exact: true })).toBeDisabled();
});

test('retained empty local snapshot is explicitly stale after failed refresh', async ({ page }) => {
  const state = await fixture(page, []);
  await expect(page.getByRole('button', { name: 'Download task JSON', exact: true })).toBeEnabled();
  const before = await download(page);
  state.fail();
  await page.getByRole('button', { name: 'Check connections', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Task backup', exact: true })).toContainText('retained snapshot is stale');
  const backup = await download(page);
  expect(backup.tasks).toEqual([]);
  expect(backup.snapshot.status).toBe('stale');
  expect(backup.snapshot.lastSuccessfulReadAt).toBe(before.snapshot.lastSuccessfulReadAt);
});

test('successful mutation does not clear a failed list read or claim a fresh complete backup', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.getByRole('button', { name: 'Download task JSON', exact: true })).toBeEnabled();
  const before = await download(page);
  state.fail();
  await page.getByRole('button', { name: 'Check connections', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Task backup', exact: true });
  await expect(panel).toContainText('retained snapshot is stale');
  await page.route('**/api/tasks', route => route.request().method() === 'POST' ? route.fulfill({ json: { ...task, id: 'new-task', title: 'New confirmed task' } }) : route.fallback());
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('New confirmed task');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(panel).toContainText('retained snapshot is stale');
  const after = await download(page);
  expect(after.snapshot.status).toBe('stale');
  expect(after.snapshot.lastSuccessfulReadAt).toBe(before.snapshot.lastSuccessfulReadAt);
  expect(after.tasks.map((value: { id: string }) => value.id)).toEqual(['new-task', task.id]);
});

test('demo backup remains separate from retained local tasks and is usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await expect(page.getByRole('button', { name: 'Download task JSON', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /Demo workspace Explore sample agents/ }).click();
  const backup = await download(page, 'demo');
  expect(backup.source).toBe('demo');
  expect(backup.snapshot).toMatchObject({ status: 'demo', lastSuccessfulReadAt: null, lastConfirmedUpdateAt: null });
  expect(backup.tasks.some((value: { id: string }) => value.id === task.id)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('old confirmed snapshot is stale and download caveat excludes unconfirmed writes', () => {
  const backup = JSON.parse(taskBackup([], 'local', stamp, stamp, false, Date.parse(stamp) + 120001));
  expect(backup.snapshot.status).toBe('stale');
  expect(backup.snapshot.note).toContain('Unconfirmed writes are excluded');
});

test('recent mutation timestamp cannot renew an aged list snapshot', () => {
  const now = Date.parse(stamp) + 130000;
  const backup = JSON.parse(taskBackup([], 'local', stamp, new Date(now).toISOString(), false, now));
  expect(backup.snapshot.status).toBe('stale');
  expect(backup.snapshot.lastSuccessfulReadAt).toBe(stamp);
  expect(backup.snapshot.lastConfirmedUpdateAt).toBe(new Date(now).toISOString());
});
