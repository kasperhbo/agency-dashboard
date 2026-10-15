import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createApp } from './index.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverSessions } from './sessions.mjs';

const scannedAt = '2026-10-15T16:00:00.000Z';
async function app(t, discover) {
  const server = createApp({ discover });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
test('topology and sessions share the same cached snapshot, including concurrent requests', async t => {
  let scans = 0;
  const original = { sessions: [{ id: 'detail-id', nativeId: 'native', kind: 'session', provider: 'codex', status: 'running', tokens: 7, updatedAt: scannedAt }], sources: [], scannedAt };
  const base = await app(t, async () => { scans++; await new Promise(resolve => setTimeout(resolve, 20)); return original; });
  const [topResponse, sessionsResponse] = await Promise.all([fetch(base + '/api/topology'), fetch(base + '/api/sessions')]);
  assert.equal(topResponse.status, 200);
  assert.equal(sessionsResponse.status, 200);
  const topology = await topResponse.json(), snapshot = await sessionsResponse.json();
  assert.deepEqual(snapshot.topology, topology);
  assert.equal(topology.observedAt, scannedAt);
  assert.equal(topology.dataSource, 'local');
  assert.equal(topology.nodes.find(n => n.nativeId === 'native').sessionId, 'detail-id');
  assert.equal(scans, 1);
  assert.equal(original.topology, undefined, 'do not mutate discovery data');
  assert.deepEqual(await (await fetch(base + '/api/topology?mode=local')).json(), topology);
  assert.equal(scans, 1);
});

test('demo bypasses local scanning and cannot contaminate the local cache', async t => {
  let scans = 0;
  const base = await app(t, async () => { scans++; return { sessions: [], sources: [], scannedAt }; });
  const response = await fetch(base + '/api/topology?mode=demo');
  assert.equal(response.status, 200);
  const demo = await response.json();
  assert.equal(demo.dataSource, 'demo');
  assert.equal(demo.summary.subagents, 3);
  assert.equal(scans, 0);
  const local = await (await fetch(base + '/api/sessions')).json();
  assert.equal(local.topology.dataSource, 'local');
  assert.equal(local.topology.summary.sessions, 0);
  assert.equal(scans, 1);
});

test('expiry refreshes the sessions and topology together', async t => {
  let scans = 0, clock = Date.parse(scannedAt);
  t.mock.method(Date, 'now', () => clock);
  const base = await app(t, async () => { scans++; return { sessions: [], sources: [], scannedAt: new Date(clock).toISOString() }; });
  assert.equal((await (await fetch(base + '/api/sessions')).json()).topology.observedAt, scannedAt);
  clock += 9001;
  const graph = await (await fetch(base + '/api/topology')).json();
  assert.equal(graph.observedAt, '2026-10-15T16:00:09.001Z');
  assert.deepEqual((await (await fetch(base + '/api/sessions')).json()).topology, graph);
  assert.equal(scans, 2);
});

test('native log discovery exposes Claude and Codex lineage through the sessions API', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'agency-topology-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const claude = path.join(root, 'claude'), codex = path.join(root, 'codex');
  await mkdir(path.join(claude, 'parent', 'subagents'), { recursive: true });
  await mkdir(codex);
  const write = (file, record) => writeFile(file, JSON.stringify(record) + '\n');
  await write(path.join(claude, 'parent.jsonl'), { type: 'user', sessionId: 'parent', cwd: '/fixture/project', message: { content: 'Fixture parent' } });
  await write(path.join(claude, 'parent', 'subagents', 'agent-child.jsonl'), { type: 'user', sessionId: 'parent', message: { content: 'Fixture child' } });
  await write(path.join(codex, 'parent.jsonl'), { type: 'session_meta', payload: { id: 'parent', cwd: '/fixture/project', source: 'cli' } });
  await write(path.join(codex, 'child.jsonl'), { type: 'session_meta', payload: { id: 'child', agent_nickname: 'Curie', source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } } });
  const base = await app(t, () => discoverSessions({ claude, codex }));
  const snapshot = await (await fetch(base + '/api/sessions')).json();
  assert.deepEqual(snapshot.topology.summary, { sessions: 2, subagents: 2, unresolvedParents: 0, activeRuns: 2, duplicatesMerged: 0 });
  for (const node of snapshot.topology.nodes.filter(n => n.sessionId)) assert.ok(snapshot.sessions.some(s => s.id === node.sessionId));
  const child = snapshot.topology.nodes.find(n => n.label === 'Curie');
  assert.equal(child.kind, 'subagent');
  const edge = snapshot.topology.edges.find(e => e.kind === 'parent-child' && e.target === child.id);
  assert.equal(edge.evidence, 'log-parent');
  assert.equal(snapshot.topology.nodes.find(n => n.id === edge.source).provider, 'codex');
  const folders = snapshot.topology.nodes.filter(n => n.kind === 'folder');
  assert.equal(folders.length, 1);
  assert.equal(folders[0].workingDirectory, '/fixture/project');
  assert.equal(child.folderId, folders[0].id);
});

test('topology rejects invalid, repeated, and filesystem query parameters before discovery', async t => {
  let scans = 0;
  const base = await app(t, async () => { scans++; return { sessions: [], sources: [], scannedAt }; });
  for (const query of ['mode=invalid', 'mode=', 'mode=local&mode=demo', 'root=C:/private', 'path=/private', 'mode=demo&codexRoot=/private', 'file=/private']) {
    const response = await fetch(base + '/api/topology?' + query);
    assert.equal(response.status, 400, query);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal(scans, 0);
});

test('topology retains origin, loopback Host, and cross-site protections in both modes', async t => {
  const base = await app(t, async () => ({ sessions: [], sources: [], scannedAt }));
  for (const mode of ['local', 'demo']) {
    for (const headers of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await fetch(base + '/api/topology?mode=' + mode, { headers })).status, 403);
    }
    const status = await new Promise((resolve, reject) => {
      const req = request(base + '/api/topology?mode=' + mode, { headers: { Host: 'rebind.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(status, 403);
  }
});
