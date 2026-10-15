import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const module = await import('./claude-account-usage.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const time = Date.parse('2026-10-16T10:00:00.000Z');
const reset = '2026-10-16T14:00:00.000Z';
const credentials = extra => JSON.stringify({ claudeAiOauth: { accessToken: 'fixture-secret', expiresAt: time + 3600000, scopes: ['user:profile'], ...extra } });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function reader(options = {}) {
  assert.equal(typeof module.createClaudeAccountUsage, 'function', 'createClaudeAccountUsage must be implemented');
  return module.createClaudeAccountUsage({ configDirectory: 'C:/fixture-claude', now: () => time, readFileImpl: async () => credentials(), fetchImpl: async () => response({ five_hour: { utilization: 17, resets_at: reset } }), ...options });
}

test('native account GET uses a fixed destination, in-memory bearer and sanitized whitelisted usage', async () => {
  const calls = [], reads = [];
  const get = reader({
    readFileImpl: async (...args) => { reads.push(args); return credentials(); },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ five_hour: { utilization: 0, resets_at: reset, secret: 'private-extra' }, seven_day: { utilization: 33.5, resets_at: '2026-10-20T10:00:00Z' }, extra_usage: { utilization: 12 }, subscriptionType: 'fixture-plan', accessToken: 'fixture-secret' });
    },
  });
  const result = await get();
  assert.equal(result.status, 'available');
  assert.equal(result.fetchedAt, '2026-10-16T10:00:00.000Z');
  assert.deepEqual(result.limits, { reportedAt: result.fetchedAt, source: 'Claude account usage', plan: null, credits: null, windows: [
    { label: '5-hour window', usedPercent: 0, windowMinutes: 300, resetsAt: reset, status: null },
    { label: '7-day window', usedPercent: 33.5, windowMinutes: 10080, resetsAt: '2026-10-20T10:00:00.000Z', status: null },
  ] });
  assert.deepEqual(reads, [[path.join('C:/fixture-claude', '.credentials.json'), 'utf8']]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/api/oauth/usage');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-secret');
  assert.equal(calls[0].options.headers['anthropic-beta'], 'oauth-2025-04-20');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
  assert.equal(JSON.stringify(result).includes('private-extra'), false);
  assert.equal(JSON.stringify(result).includes('fixture-plan'), false);
});

test('missing, malformed, expired or insufficient credentials never trigger a request or login refresh', async () => {
  for (const read of [
    async () => { throw Object.assign(new Error('fixture-secret path'), { code: 'ENOENT' }); },
    async () => '{invalid', async () => 'null', async () => '{}',
    async () => credentials({ accessToken: {} }), async () => credentials({ accessToken: '' }),
    async () => credentials({ expiresAt: time }), async () => credentials({ expiresAt: 'tomorrow' }),
    async () => credentials({ scopes: ['user:inference'] }),
  ]) {
    let requests = 0;
    const result = await reader({ readFileImpl: read, fetchImpl: async () => { requests++; throw new Error('must not fetch'); } })();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.limits, null);
    assert.equal(result.fetchedAt, null);
    assert.match(result.reason, /sign in|\/usage/i);
    assert.equal(requests, 0);
    assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
  }
});

test('invalid percentages, unknown windows and invalid or expired resets never become live percentages', async () => {
  for (const window of [
    { utilization: -1, resets_at: reset }, { utilization: 101, resets_at: reset },
    { utilization: '17', resets_at: reset }, { utilization: null, resets_at: reset },
    { utilization: 17, resets_at: 'not-a-date' }, { utilization: 17, resets_at: '2027-02-30T10:00:00Z' }, { utilization: 17, resets_at: 123 },
    { utilization: 17, resets_at: '2026-10-16T09:00:00Z' }, { utilization: 17 },
  ]) {
    const result = await reader({ fetchImpl: async () => response({ five_hour: window, invented_window: { utilization: 10, resets_at: reset } }) })();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.limits, null);
  }
  const result = await reader({ fetchImpl: async () => response({ five_hour: { utilization: 100, resets_at: reset }, seven_day: { utilization: 'bad', resets_at: reset } }) })();
  assert.equal(result.status, 'available');
  assert.equal(result.limits.windows.length, 1);
  assert.equal(result.limits.windows[0].usedPercent, 100);
});

test('401/403, rate limiting, server errors and malformed responses are sanitized', async () => {
  for (const [status, expected] of [[401, 'unavailable'], [403, 'unavailable'], [429, 'error'], [500, 'error']]) {
    const result = await reader({ fetchImpl: async () => response({ error: 'fixture-secret' }, status) })();
    assert.equal(result.status, expected);
    assert.equal(result.limits, null);
    assert.equal(result.fetchedAt, null);
    assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
  }
  for (const body of [null, [], {}, 'unexpected']) {
    assert.equal((await reader({ fetchImpl: async () => response(body) })()).status, 'unavailable');
  }
  const invalidJSON = await reader({ fetchImpl: async () => new Response('{fixture-secret') })();
  assert.equal(invalidJSON.status, 'error');
  assert.equal(JSON.stringify(invalidJSON).includes('fixture-secret'), false);
});

test('timeouts and network exceptions are graceful and cannot expose request credentials', async () => {
  const result = await reader({ timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('fixture-secret')), { once: true });
  }) })();
  assert.equal(result.status, 'error');
  assert.equal(result.limits, null);
  assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
  const network = await reader({ fetchImpl: async () => { throw new Error('Authorization: Bearer fixture-secret'); } })();
  assert.equal(network.status, 'error');
  assert.equal(JSON.stringify(network).includes('fixture-secret'), false);
});

test('normal cache lasts 60 seconds; forced refresh respects 10 seconds, rereads auth and shares in-flight work', async () => {
  let clock = time, reads = 0, requests = 0;
  const get = reader({ now: () => clock, readFileImpl: async () => { reads++; return credentials({ accessToken: 'fixture-' + reads }); }, fetchImpl: async () => { requests++; return response({ five_hour: { utilization: requests, resets_at: reset } }); } });
  const first = await get();
  first.limits.windows[0].usedPercent = 99;
  assert.equal((await get()).limits.windows[0].usedPercent, 1, 'external callers cannot poison the cache');
  clock += 9999;
  assert.equal((await get({ refresh: true })).limits.windows[0].usedPercent, 1);
  clock++;
  const forced = await Promise.all([get({ refresh: true }), get({ refresh: true }), get()]);
  assert.ok(forced.every(r => r.limits.windows[0].usedPercent === 2));
  assert.equal(requests, 2);
  assert.equal(reads, 2, 'no bearer or credentials are retained across cache refreshes');
  clock += 59999;
  await get();
  assert.equal(requests, 2);
  clock++;
  assert.equal((await get()).limits.windows[0].usedPercent, 3);
  assert.equal(reads, 3);
});

test('failed refresh clears previously available utilization and failure results respect cooldown', async () => {
  let clock = time, requests = 0;
  const get = reader({ now: () => clock, fetchImpl: async () => ++requests === 1 ? response({ five_hour: { utilization: 17, resets_at: reset } }) : response({}, 401) });
  assert.equal((await get()).status, 'available');
  clock += 10000;
  const failed = await get({ refresh: true });
  assert.equal(failed.status, 'unavailable');
  assert.equal(failed.limits, null);
  assert.equal((await get({ refresh: true })).status, 'unavailable');
  assert.equal(requests, 2);
});

test('cached windows stop being current as each reset passes, without inventing zero utilization', async () => {
  let clock = time, requests = 0;
  const get = reader({ now: () => clock, fetchImpl: async () => {
    requests++;
    return response({ five_hour: { utilization: 17, resets_at: '2026-10-16T10:00:01Z' }, seven_day: { utilization: 33, resets_at: '2026-10-16T10:00:02Z' } });
  } });
  assert.equal((await get()).limits.windows.length, 2);
  clock += 1000;
  const partial = await get();
  assert.equal(partial.status, 'available');
  assert.deepEqual(partial.limits.windows.map(w => [w.label, w.usedPercent]), [['7-day window', 33]]);
  clock += 1000;
  const expired = await get();
  assert.equal(expired.status, 'unavailable');
  assert.equal(expired.limits, null);
  assert.equal(requests, 1);
});
