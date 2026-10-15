import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const endpoint = 'https://api.anthropic.com/api/oauth/usage';
const loginHelp = 'Use Claude /usage, or sign in normally with Claude Code.';
const unavailable = reason => ({ status: 'unavailable', limits: null, fetchedAt: null, reason });
const failed = reason => ({ status: 'error', limits: null, fetchedAt: null, reason });
function resetDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = Date.parse(value), day = Date.parse(value.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(date) || !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return new Date(date).toISOString();
}
function normalize(body, at) {
  const windows = [];
  for (const [key, label, windowMinutes] of [['five_hour', '5-hour window', 300], ['seven_day', '7-day window', 10080]]) {
    const value = body?.[key];
    const resetsAt = resetDate(value?.resets_at);
    if (typeof value?.utilization !== 'number' || !Number.isFinite(value.utilization) || value.utilization < 0 || value.utilization > 100 || !resetsAt || Date.parse(resetsAt) <= at) continue;
    windows.push({ label, usedPercent: value.utilization, windowMinutes, resetsAt, status: null });
  }
  if (!windows.length) return unavailable('No current account usage windows were returned. ' + loginHelp);
  const fetchedAt = new Date(at).toISOString();
  return { status: 'available', fetchedAt, limits: { reportedAt: fetchedAt, source: 'Claude account usage', windows, plan: null, credits: null } };
}

/** Read-only adapter for Claude Code's native internal usage API, which may change.
 * Only sanitized results are cached. Credentials are read afresh per attempt, never
 * stored in cache, returned, logged, refreshed or written. No transcript is sent.
 * Dependency options exist for tests; HTTP callers cannot choose paths or URLs.
 */
export function createClaudeAccountUsage({ configDirectory = process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude'), readFileImpl = readFile, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 5000 } = {}) {
  let cached, expires = 0, lastAttempt = -Infinity, pending;
  async function readUsage() {
    let account;
    try { account = JSON.parse(await readFileImpl(path.join(configDirectory, '.credentials.json'), 'utf8'))?.claudeAiOauth; }
    catch { return unavailable('Native Claude login is not available. ' + loginHelp); }
    if (typeof account?.accessToken !== 'string' || !account.accessToken.trim() || !Array.isArray(account.scopes) || !account.scopes.includes('user:profile') || typeof account.expiresAt !== 'number' || !Number.isFinite(account.expiresAt) || account.expiresAt <= now()) return unavailable('Native Claude login cannot read account usage. ' + loginHelp);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${account.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' },
      });
      if (response.status === 401 || response.status === 403) return unavailable('Claude account access was not accepted. ' + loginHelp);
      if (response.status === 429) return failed('Claude account usage is temporarily rate limited. Try again later or use Claude /usage.');
      if (!response.ok) return failed('Claude account usage is temporarily unavailable. ' + loginHelp);
      return normalize(await response.json(), now());
    } catch { return failed('Claude account usage could not be read. Try again or use Claude /usage.'); }
    finally { clearTimeout(timeout); }
  }
  function current(result) {
    const copy = structuredClone(result);
    if (copy.status === 'available') {
      copy.limits.windows = copy.limits.windows.filter(window => Date.parse(window.resetsAt) > now());
      if (!copy.limits.windows.length) return unavailable('Waiting for a fresh report after the account window reset. ' + loginHelp);
    }
    return copy;
  }
  return async function accountUsage({ refresh = false } = {}) {
    if (pending) return current(await pending);
    const at = now();
    if (cached && ((refresh && at - lastAttempt < 10000) || (!refresh && at < expires))) return current(cached);
    lastAttempt = at;
    pending = readUsage().then(result => {
      cached = result;
      expires = now() + 60000;
      return result;
    }).finally(() => { pending = null; });
    return current(await pending);
  };
}
