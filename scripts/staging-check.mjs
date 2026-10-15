import { runStagingBrowser } from './staging-browser.mjs';
import { deployStaging } from './deploy-staging.mjs';

try {
  if (process.env.AGENCY_STAGING_URL) await runStagingBrowser(process.env.AGENCY_STAGING_URL);
  else await deployStaging({ verifyOnly: true });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
