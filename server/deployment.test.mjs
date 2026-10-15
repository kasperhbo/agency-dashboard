import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { startStaging } from '../scripts/staging-server.mjs';
import { smokeStaging, stagingURL } from '../scripts/staging-smoke.mjs';
import { deployStaging, prepareRelease } from '../scripts/deploy-staging.mjs';
import { runOwnedNode } from '../scripts/staging-process.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function source(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'agency-deployment-'));
  t.after(async () => {
    await stopMarker(path.join(root, '.agency/staging'));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await cp(path.join(project, 'server'), path.join(root, 'server'), { recursive: true });
  try { await cp(path.join(project, 'shared'), path.join(root, 'shared'), { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(path.join(root, 'scripts'));
  for (const script of ['staging-server.mjs', 'staging-fixtures.mjs']) await cp(path.join(project, 'scripts', script), path.join(root, 'scripts', script));
  await mkdir(path.join(root, 'dist/assets'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  await writeFile(path.join(root, 'dist/index.html'), '<div id="root"></div><script type="module" src="/assets/app.js"></script>');
  await writeFile(path.join(root, 'dist/assets/app.js'), 'console.log("artifact test")');
  await mkdir(path.join(root, '.agency'));
  await writeFile(path.join(root, '.agency/tasks.json'), 'PRIVATE-SENTINEL');
  return root;
}
async function stopMarker(stagingRoot) {
  try {
    const marker = JSON.parse(await readFile(path.join(stagingRoot, 'active.json'), 'utf8'));
    const stopped = await fetch(`${marker.url}/__staging/stop`, { method: 'POST', headers: { Authorization: `Bearer ${marker.token}`, Connection: 'close' } });
    assert.equal(stopped.status, 200, 'Managed test server accepted its stop token');
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await fetch(`${marker.url}/api/health`); }
      catch { return; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Test staging process did not stop.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

test('staging parses isolated fixtures and preserves host/origin guards', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'agency-fixtures-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stage = await startStaging({ directory: root, port: 0, release: { id: 'fixture-test', sha: 'test-sha' } });
  t.after(stage.stop);
  const health = await fetch(`${stage.url}/api/health`).then(response => response.json());
  assert.equal(health.environment, 'staging');
  assert.equal(health.buildSha, 'test-sha');
  const snapshot = await fetch(`${stage.url}/api/sessions`).then(response => response.json());
  assert.equal(snapshot.dataSource, 'fixture');
  assert.equal(snapshot.topology.dataSource, 'fixture');
  assert.equal(snapshot.sessions.length, 3);
  assert.ok(snapshot.sessions.some(session => session.nativeId === 'staging-child' && session.parentNativeId === 'staging-claude-parent'));
  assert.ok(snapshot.sources.every(source => source.path.startsWith(root)));
  const topology = await fetch(`${stage.url}/api/topology`).then(response => response.json());
  assert.equal(topology.dataSource, 'fixture');
  assert.equal(topology.summary.subagents, 1);
  assert.equal(topology.summary.unresolvedParents, 0);
  for (const headers of [{ host: 'attacker.invalid' }, { origin: 'https://attacker.invalid' }, { 'sec-fetch-site': 'cross-site' }]) {
    const status = await new Promise((resolve, reject) => {
      const req = request(`${stage.url}/api/health`, { headers }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(status, 403);
  }
  assert.equal((await fetch(`${stage.url}/__staging/stop`, { method: 'POST', headers: { Authorization: 'Bearer wrong-token' } })).status, 405);
  assert.equal((await fetch(`${stage.url}/api/health`)).status, 200);
  assert.deepEqual(await fetch(`${stage.url}/api/tasks`).then(response => response.json()), []);
});

test('staging URL and bind policy reject external addresses', async () => {
  for (const url of ['https://example.com', 'http://example.com', 'http://127.0.0.1/private', 'http://secret@127.0.0.1:4320']) assert.throws(() => stagingURL(url));
  await assert.rejects(startStaging({ directory: tmpdir(), host: '0.0.0.0' }), /loopback/);
});

test('release allowlist excludes user data and unit tests', async t => {
  const root = await source(t);
  const release = await prepareRelease({ sourceRoot: root, buildApp: false });
  assert.deepEqual((await readdir(release.releaseRoot)).sort(), ['dist', 'release.json', 'scripts', 'server', ...((await readdir(root)).includes('shared') ? ['shared'] : [])].sort());
  assert.ok(!(await readdir(path.join(release.releaseRoot, 'server'))).some(file => file.endsWith('.test.mjs')));
  assert.equal(await readFile(path.join(root, '.agency/tasks.json'), 'utf8'), 'PRIVATE-SENTINEL');
});

test('verification stops its real release process without creating an active marker', async t => {
  const root = await source(t);
  const result = await deployStaging({ sourceRoot: root, buildApp: false, verifyOnly: true, browser: async url => { assert.equal((await fetch(`${url}/api/health`)).status, 200); } });
  assert.equal(result.promoted, false);
  await assert.rejects(fetch(`${result.url}/api/health`));
  await assert.rejects(readFile(path.join(root, '.agency/staging/active.json')), { code: 'ENOENT' });
  const report = JSON.parse(await readFile(path.join(root, 'test-results/staging/smoke.json'), 'utf8'));
  assert.equal(report.browser, 'passed');
});

test('failed browser checks preserve the active release and stop the candidate', async t => {
  const root = await source(t);
  const stagingRoot = path.join(root, '.agency/staging');
  const active = await deployStaging({ sourceRoot: root, buildApp: false, port: 0, browser: async () => {} });
  let candidateURL;
  await assert.rejects(deployStaging({ sourceRoot: root, buildApp: false, port: 0, browser: async url => { candidateURL = url; throw new Error('Intentional browser failure'); } }), /Intentional browser failure/);
  assert.equal(JSON.parse(await readFile(path.join(stagingRoot, 'active.json'), 'utf8')).id, active.id);
  assert.equal((await fetch(`${active.url}/api/health`)).status, 200);
  await assert.rejects(fetch(`${candidateURL}/api/health`));
  assert.equal(await readFile(path.join(root, '.agency/tasks.json'), 'utf8'), 'PRIVATE-SENTINEL');
});

test('failed final port binding restores the previous verified process', async t => {
  const root = await source(t);
  const stagingRoot = path.join(root, '.agency/staging');
  const active = await deployStaging({ sourceRoot: root, buildApp: false, port: 0, browser: async () => {} });
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  await assert.rejects(deployStaging({ sourceRoot: root, buildApp: false, port: occupied.address().port, browser: async () => {} }), /Candidate exited before readiness/);
  const marker = JSON.parse(await readFile(path.join(stagingRoot, 'active.json'), 'utf8'));
  assert.equal(marker.id, active.id);
  assert.equal(marker.url, active.url);
  assert.equal((await fetch(`${marker.url}/api/health`).then(response => response.json())).releaseId, active.id);
  await smokeStaging(marker.url);
});

test('successful replacement stays on the chosen loopback port', async t => {
  const root = await source(t);
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const active = await deployStaging({ sourceRoot: root, buildApp: false, port, browser: async () => {} });
  const replacement = await deployStaging({ sourceRoot: root, buildApp: false, port, browser: async () => {
    assert.equal((await fetch(`${active.url}/api/health`).then(response => response.json())).releaseId, active.id);
  } });
  assert.equal(replacement.url, active.url);
  assert.notEqual(replacement.id, active.id);
  assert.equal((await fetch(`${active.url}/api/health`).then(response => response.json())).releaseId, replacement.id);
  const stagingRoot = path.join(root, '.agency/staging');
  assert.equal(JSON.parse(await readFile(path.join(stagingRoot, 'previous.json'), 'utf8')).id, active.id);
});

test('owned command runner propagates failures and bounds process lifetime', async () => {
  await runOwnedNode(['-e', 'process.exit(0)']);
  await assert.rejects(runOwnedNode(['-e', 'process.exit(9)']), /failed \(9\)/);
  await assert.rejects(runOwnedNode(['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 200 }), /timed out/);
});
