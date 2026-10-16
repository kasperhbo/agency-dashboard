import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('project tabs switch by keyboard and preserve task filters and actions', async ({ page }) => {
  await page.goto('/#projects');
  await page.getByRole('button', { name: 'Open project agency-dashboard', exact: true }).click();
  const sessionsTab = page.getByRole('tab', { name: /^Sessions/ });
  const tasksTab = page.getByRole('tab', { name: /^Tasks/ });
  await expect(sessionsTab).toHaveAttribute('aria-selected', 'true');
  await sessionsTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tasksTab).toBeFocused();
  await expect(tasksTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Tasks' })).toBeVisible();
  await page.getByLabel('Project task status').selectOption('done');
  await expect(page.locator('#project-tasks-panel .task-row')).toHaveCount(1);

  await page.keyboard.press('ArrowLeft');
  await expect(sessionsTab).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Sessions' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#project-tasks-panel .task-row')).toHaveCount(1);
  await page.locator('#project-tasks-panel .task-main').click();
  await expect(page.getByRole('heading', { name: 'Edit task' })).toBeVisible();
});

test('project tasks tab keeps its empty state and offers project-scoped creation', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('agency.demoTasks', '[]'));
  await page.goto('/#projects');
  await page.getByRole('button', { name: 'Open project agency-dashboard', exact: true }).click();
  await page.getByRole('tab', { name: 'Tasks 0' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Give this project a next step' })).toBeVisible();
  await page.getByRole('tabpanel', { name: 'Tasks' }).getByRole('button', { name: 'Add project task' }).click();
  await expect(page.getByRole('textbox', { name: 'Project optional' })).toHaveValue('agency-dashboard');
});

test('project tabs remain accessible and fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/#projects');
  await page.getByRole('button', { name: 'Open project api-service', exact: true }).click();
  const tablist = page.getByRole('tablist', { name: 'api-service project details' });
  await expect(tablist.getByRole('tab')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).include('.project-detail-layout').analyze();
  expect(results.violations).toEqual([]);
});
