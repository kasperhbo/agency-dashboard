import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const stamp = '2026-10-16T12:00:00.000Z';
const session = (id: string, project: string, title: string, events: object[]) => ({ id, nativeId: `${id}-native`, provider: 'claude', title, name: title, project, model: 'fixture', status: 'completed', startedAt: stamp, updatedAt: stamp, tokens: null, events, partial: false });
const task = { id: 'empty-project-task', title: 'Plan empty project', description: '', project: 'Empty project', provider: 'claude', priority: 'medium', status: 'todo', revision: 1, createdAt: stamp, updatedAt: stamp };

async function openProjects(page: Page, sessions: object[], tasks: object[] = [task]) {
  await page.addInitScript(() => localStorage.setItem('agency.mode', 'local'));
  await page.route('**/api/sessions', route => route.fulfill({ json: { sessions, sources: [], scannedAt: stamp } }));
  await page.route('**/api/tasks**', route => route.fulfill({ json: tasks }));
  await page.goto('/#projects');
}

test('project Activity is isolated, counted, ordered, labels unknown time, and opens the exact session', async ({ page }) => {
  const sessions = [
    session('alpha-old', 'Alpha', 'Alpha old session', [{ id: 'old', label: 'Older Alpha event', kind: 'tool', timestamp: '2026-10-16T11:00:00.000Z' }]),
    session('alpha-new', 'Alpha', 'Alpha new session', [
      { id: 'new', label: 'Newest Alpha event', kind: 'success', timestamp: '2026-10-16T12:00:00.000Z' },
      { id: 'missing', label: 'Missing time event', kind: 'info' },
      { id: 'invalid', label: 'Invalid time event', kind: 'tool', timestamp: 'not-a-time' },
    ]),
    session('beta-run', 'Beta', 'Beta only session', [{ id: 'beta', label: 'Beta private event', kind: 'tool', timestamp: '2026-10-16T13:00:00.000Z' }]),
  ];
  await openProjects(page, sessions);
  await page.getByRole('button', { name: 'Open project Alpha', exact: true }).click();
  const activityTab = page.getByRole('tab', { name: 'Activity 4' });
  await activityTab.click();
  await expect(page.getByRole('tabpanel', { name: 'Activity 4' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project activity' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Activity result counts' })).toHaveText('Showing 4 of 4 matching events · 4 retained supported events in project Alpha from currently loaded sessions');
  await expect(page.locator('.activity-feed.full .activity-item')).toHaveCount(4);
  await expect(page.locator('.activity-feed.full')).not.toContainText('Beta private event');
  await expect(page.locator('.activity-feed.full')).toContainText('Timestamp not reported');
  const labels = await page.locator('.activity-feed.full .activity-item').allTextContents();
  expect(labels.map(label => label.trim().split('\n')[0])).toEqual([
    expect.stringContaining('newest alpha event'),
    expect.stringContaining('older alpha event'),
    expect.stringContaining('missing time event'),
    expect.stringContaining('invalid time event'),
  ]);
  await page.locator('.activity-feed.full .activity-item').filter({ hasText: 'newest alpha event' }).click();
  await expect(page.getByRole('dialog')).toContainText('Alpha new session');
  await expect(page.getByRole('dialog')).not.toContainText('Beta only session');
});

test('project event count and 100-event cap include only the selected project’s retained events', async ({ page }) => {
  const alphaEvents = Array.from({ length: 105 }, (_, index) => ({ id: `alpha-${index}`, label: `Alpha event ${index}`, kind: 'tool', timestamp: new Date(Date.parse(stamp) - index * 1000).toISOString() }));
  const sessions = [session('many-alpha', 'Alpha', 'Alpha bulk session', alphaEvents), session('few-beta', 'Beta', 'Beta short session', Array.from({ length: 7 }, (_, index) => ({ id: `beta-${index}`, label: `Beta event ${index}`, kind: 'info', timestamp: stamp })))];
  await openProjects(page, sessions);
  await page.getByRole('button', { name: 'Open project Alpha', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Activity 105' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity 105' }).click();
  await expect(page.getByRole('status', { name: 'Activity result counts' })).toHaveText('Showing 100 of 105 matching events · 105 retained supported events in project Alpha from currently loaded sessions');
  await expect(page.locator('.activity-feed.full .activity-item')).toHaveCount(100);
  await expect(page.locator('.activity-feed.full')).not.toContainText('Beta event');
});

test('empty project Activity makes no all-clear claim and tabs remain keyboard accessible on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openProjects(page, [session('beta-run', 'Beta', 'Beta session', [{ id: 'beta-event', label: 'Beta work', kind: 'tool', timestamp: stamp }])]);
  await page.getByRole('button', { name: 'Open project Empty project', exact: true }).click();
  const sessionsTab = page.getByRole('tab', { name: 'Sessions 0' });
  const tasksTab = page.getByRole('tab', { name: 'Tasks 1' });
  const activityTab = page.getByRole('tab', { name: 'Activity 0' });
  await sessionsTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tasksTab).toBeFocused();
  await page.keyboard.press('End');
  await expect(activityTab).toBeFocused();
  await expect(activityTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'No retained activity' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Activity 0' })).toContainText('does not establish that no agent activity occurred');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).include('.project-detail-tabs').analyze();
  expect(results.violations).toEqual([]);
});
