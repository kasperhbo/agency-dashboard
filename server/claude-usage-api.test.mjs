import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './index.mjs';
import { startStaging } from '../scripts/staging-server.mjs';

async function app(t, options) {
  const server = createApp(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
const unavailable = { status: 'unavailable', limits: null, fetchedAt: null, reason: 'Use Claude /usage.' };

test('account usage defaults enabled, accepts only the refresh switch and never accepts filesystem parameters', async t => {
  const calls = [];
  const base = await app(t, { accountUsageFetcher: async options => { calls.push(options); return unavailable; } });
  const response = await fetch(base + '/api/claude-usage');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), unavailable);
  assert.deepEqual(await (await fetch(base + '/api/claude-usage?refresh=1')).json(), unavailable);
  assert.deepEqual(calls, [{ refresh: false }, { refresh: true }]);
  for (const query of ['refresh=0', 'refresh=', 'refresh=1&refresh=1', 'path=C:/private', 'configDir=C:/private', 'root=C:/private', 'mode=demo']) {
    assert.equal((await fetch(base + '/api/claude-usage?' + query)).status, 400);
  }
  assert.equal(calls.length, 2);
  assert.equal((await fetch(base + '/api/claude-usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 405);
});

test('disabled live usage cannot call the account reader, including forced refreshes', async t => {
  let reads = 0;
  const base = await app(t, { enableLiveClaudeUsage: false, accountUsageFetcher: async () => { reads++; throw new Error('must not read credentials'); } });
  for (const suffix of ['', '?refresh=1']) {
    const response = await fetch(base + '/api/claude-usage' + suffix);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, 'unavailable');
    assert.equal(data.limits, null);
    assert.equal(data.fetchedAt, null);
    assert.match(data.reason, /disabled/i);
  }
  assert.equal(reads, 0);
});

test('account usage preserves loopback, Origin and cross-site guards before reading credentials', async t => {
  let reads = 0;
  const base = await app(t, { accountUsageFetcher: async () => { reads++; return unavailable; } });
  for (const headers of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { Host: 'rebind.example' }]) {
    const status = await new Promise((resolve, reject) => {
      const req = request(base + '/api/claude-usage?refresh=1', { headers }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(status, 403);
  }
  assert.equal(reads, 0);
});

test('unexpected reader errors do not reach responses or console output', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const base = await app(t, { accountUsageFetcher: async () => { throw new Error('Bearer fixture-secret'); } });
  const response = await fetch(base + '/api/claude-usage');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'error');
  assert.equal(result.limits, null);
  assert.equal(result.fetchedAt, null);
  assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
  assert.deepEqual(logs, []);
});

test('actual staging route always disables account usage without mocks', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agency-private-usage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stage = await startStaging({ directory, port: 0 });
  t.after(stage.stop);
  const response = await fetch(stage.url + '/api/claude-usage?refresh=1');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.limits, null);
  assert.equal(result.fetchedAt, null);
  assert.match(result.reason, /disabled/i);
});
