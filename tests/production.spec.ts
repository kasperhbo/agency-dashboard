import { test, expect } from '@playwright/test';

test('production app loads under CSP with only local assets', async ({ page }) => {
  const origin = 'http://127.0.0.1:4319';
  const requests: string[] = [], errors: string[] = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const response = await page.goto(origin);
  expect(response?.headers()['content-security-policy']).toContain("default-src 'self'");
  await expect(page.getByRole('heading', { name: 'Your agents, in sync.' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('link', { name: 'Usage & insights' }).click();
  await expect(page.getByRole('heading', { name: 'Claude breakdown' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Activity chart period' }).selectOption('24h');
  await expect(page.locator('.chart-column')).toHaveCount(12);
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Task title' })).toBeFocused();
  await page.keyboard.press('Escape');
  expect(requests.every(url => url.startsWith(origin))).toBe(true);
  expect(requests.some(url => url.endsWith('.woff2'))).toBe(true);
  expect(errors).toEqual([]);
});
