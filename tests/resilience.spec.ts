import { test, expect } from '@playwright/test';

test('incomplete saved demo tasks cannot trap the overview in render recovery', async ({ page }) => {
  const saved = JSON.stringify(['First incomplete task', 'Second incomplete task'].map((title, index) => ({
    id: `incomplete-${index}`, title, description: '', project: 'Recovery',
    provider: 'claude', status: 'todo', priority: 'medium',
  })));
  await page.addInitScript(value => localStorage.setItem('agency.demoTasks', value), saved);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your agents, in sync.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agency couldn’t display this workspace.' })).toHaveCount(0);
  // Invalid persisted input is left untouched so it can still be recovered manually.
  expect(await page.evaluate(() => localStorage.getItem('agency.demoTasks'))).toBe(saved);
});

test('system appearance follows OS changes and explicit overrides survive reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/#settings');
  const appearance = page.getByRole('combobox', { name: 'Appearance' });
  await appearance.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(appearance).toHaveValue('system');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(appearance).toHaveValue('light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(appearance).toHaveValue('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await appearance.selectOption('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(appearance).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('render failures offer reload without deleting saved tasks', async ({ page }) => {
  // Fault injection stays in the browser test: no production crash switch.
  await page.addInitScript(() => {
    const original = Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString = function (...args) {
      if (sessionStorage.getItem('test.render-failure') === 'once') {
        throw new Error('Test render failure');
      }
      return original.apply(this, args);
    };
    if (!sessionStorage.getItem('test.render-failure')) sessionStorage.setItem('test.render-failure', 'once');
    if (!localStorage.getItem('agency.demoTasks')) localStorage.setItem('agency.demoTasks', JSON.stringify([{
      id: 'recovery-task', title: 'Preserved recovery task', description: '', project: 'Recovery',
      provider: 'claude', status: 'todo', priority: 'medium', revision: 1,
      createdAt: '2026-10-16T10:00:00Z', updatedAt: '2026-10-16T10:00:00Z',
    }]));
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Agency couldn’t display this workspace.' })).toBeVisible();
  const savedTasks = await page.evaluate(() => localStorage.getItem('agency.demoTasks'));
  expect(savedTasks).toContain('Preserved recovery task');
  await page.evaluate(() => sessionStorage.setItem('test.render-failure', 'recovered'));
  await page.getByRole('button', { name: 'Reload workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your agents, in sync.' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('agency.demoTasks'))).toBe(savedTasks);
  await page.getByRole('link', { name: 'Task board' }).click();
  await expect(page.getByRole('button', { name: 'Preserved recovery task', exact: true })).toBeVisible();
});
