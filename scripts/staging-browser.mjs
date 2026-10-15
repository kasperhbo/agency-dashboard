import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stagingURL } from './staging-smoke.mjs';
import { runOwnedNode } from './staging-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function runStagingBrowser(url, { cwd = root } = {}) {
  const base = stagingURL(url);
  await runOwnedNode([path.join(cwd, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', 'tests/network-staging.spec.ts', '--reporter=line,html', '--output=test-results/staging-browser'], {
    cwd, env: { ...process.env, AGENCY_STAGING_URL: base, PLAYWRIGHT_HTML_OPEN: 'never', PLAYWRIGHT_HTML_OUTPUT_DIR: 'playwright-report/staging' }, label: 'Staging Playwright checks',
  });
}
