import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('core views and task dialog have no WCAG A/AA accessibility violations', async ({ page }) => {
  for (const route of ['overview', 'network', 'projects', 'insights', 'tasks', 'settings']) {
    await page.goto('/#' + route);
    await expect(page.locator('h1')).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations.map(v => ({ id: v.id, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
  }
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByRole('dialog').evaluate(dialog => Promise.all(dialog.getAnimations().map(animation => animation.finished)));
  const modal = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(modal.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.goto('/#overview');
  const light = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(light.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
});
