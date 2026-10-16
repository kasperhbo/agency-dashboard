import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSession } from './sessions.mjs';

const now = '2026-10-15T16:00:00.000Z';
const older = '2026-10-15T15:00:00.000Z';
const topologyModule = await import('./topology.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
function build(snapshot) {
  assert.equal(typeof topologyModule.buildTopology, 'function', 'buildTopology must be implemented');
  return topologyModule.buildTopology(snapshot);
}
const source = (provider, extra = {}) => ({ provider, path: '/logs/' + provider, status: 'connected', count: 0, limited: false, warnings: [], ...extra });
const session = (nativeId, extra = {}) => ({ id: 'log-' + nativeId, nativeId, provider: 'claude', kind: 'session', title: 'Work ' + nativeId, model: 'test-model', project: 'same-project', tokens: 10, status: 'completed', startedAt: older, updatedAt: now, lastActivityAt: now, ...extra });
const snapshot = sessions => ({ sessions, sources: [source('claude'), source('codex')], scannedAt: now });
const runs = graph => graph.nodes.filter(n => n.kind === 'session' || n.kind === 'subagent');
const causal = graph => graph.edges.filter(e => e.kind === 'parent-child');
function assertResolved(graph) {
  const ids = new Set(graph.nodes.map(n => n.id));
  assert.equal(ids.size, graph.nodes.length);
  assert.equal(new Set(graph.edges.map(e => e.id)).size, graph.edges.length);
  for (const edge of graph.edges) {
    assert.ok(ids.has(edge.source), 'edge source exists');
    assert.ok(ids.has(edge.target), 'edge target exists');
    assert.notEqual(edge.source, edge.target);
    assert.equal(typeof edge.animated, 'boolean');
    if (edge.kind === 'membership') assert.equal(edge.animated, false);
  }
}

test('empty topology preserves source failures, scan limits, and observation time', () => {
  const graph = build({ sessions: [], scannedAt: now, sources: [source('claude', { status: 'error', warnings: ['Permission denied'] }), source('codex', { status: 'not_found', limited: true })] });
  assert.equal(graph.version, 1);
  assert.equal(graph.observedAt, now);
  assert.equal(graph.dataSource, 'local');
  assert.deepEqual(graph.summary, { sessions: 0, subagents: 0, unresolvedParents: 0, activeRuns: 0, duplicatesMerged: 0 });
  assert.equal(graph.nodes.filter(n => n.kind === 'workspace').length, 1);
  assert.deepEqual(graph.nodes.filter(n => n.kind === 'provider').map(n => [n.provider, n.availability]).sort(), [['claude', 'error'], ['codex', 'not_found']]);
  assert.equal(graph.sources.length, 2);
  assert.equal(graph.coverage.limited, true);
  assert.ok(graph.coverage.notes.some(n => n.includes('Permission denied')));
  assertResolved(graph);
});

test('deduplicates native logs using newest file, retaining its detail ID and exact tokens', () => {
  const input = snapshot([
    session('parent', { id: 'old-log', fileModifiedAt: older, tokens: 999, updatedAt: now }),
    session('parent', { id: 'new-log', fileModifiedAt: now, tokens: 12, updatedAt: older, status: 'running' }),
    session('child', { kind: 'subagent', parentNativeId: 'parent', name: 'Reviewer', status: 'waiting', tokens: null }),
  ]);
  const original = structuredClone(input);
  const graph = build(input);
  assert.deepEqual(graph.summary, { sessions: 1, subagents: 1, unresolvedParents: 0, activeRuns: 2, duplicatesMerged: 1 });
  assert.equal(runs(graph).find(n => n.nativeId === 'parent').sessionId, 'new-log');
  assert.equal(runs(graph).find(n => n.nativeId === 'parent').tokens, 12);
  assert.equal(runs(graph).find(n => n.nativeId === 'child').tokens, null);
  assert.equal(runs(graph).find(n => n.nativeId === 'child').label, 'Reviewer');
  assert.equal(causal(graph).length, 1);
  assert.equal(causal(graph)[0].evidence, 'log-parent');
  assert.equal(causal(graph)[0].animated, true);
  assert.deepEqual(input, original, 'builder must not mutate discovery snapshot');
  assertResolved(graph);
});

test('provider, kind, and parent scope identity; shared projects never imply lineage', () => {
  const graph = build(snapshot([
    session('same'), session('same', { provider: 'codex', id: 'codex-same' }),
    session('kid', { kind: 'subagent', parentNativeId: 'same', id: 'kid-a' }),
    session('kid', { kind: 'subagent', parentNativeId: 'other', id: 'kid-b' }),
    session('kid'), session('unrelated'),
  ]));
  assert.equal(runs(graph).length, 6);
  assert.equal(graph.summary.duplicatesMerged, 0);
  assert.equal(causal(graph).length, 2);
  const child = runs(graph).find(n => n.sessionId === 'kid-a');
  const parent = graph.nodes.find(n => n.id === causal(graph).find(e => e.target === child.id).source);
  assert.equal(parent.provider, 'claude');
  assert.equal(parent.kind, 'session');
  assert.equal(causal(graph).some(e => e.target === runs(graph).find(n => n.nativeId === 'unrelated').id), false);
  assertResolved(graph);
});

test('opaque IDs, output ordering, and duplicate ties are stable under input permutation', () => {
  const input = snapshot([session('sensitive-native', { id: 'z-log', tokens: 30 }), session('sensitive-native', { id: 'a-log', tokens: 20 }), session('kid', { kind: 'subagent', parentNativeId: 'sensitive-native' })]);
  const graph = build(input);
  assert.deepEqual(graph, build({ ...input, sessions: [...input.sessions].reverse(), sources: [...input.sources].reverse() }));
  assert.equal(runs(graph).find(n => n.nativeId === 'sensitive-native').sessionId, 'a-log');
  for (const value of [...graph.nodes, ...graph.edges]) assert.equal(value.id.includes('sensitive-native'), false);
  const withoutDuplicate = build({ ...input, sessions: [input.sessions[1], input.sessions[2]] });
  assert.deepEqual(graph.nodes.map(n => n.id), withoutDuplicate.nodes.map(n => n.id));
  assert.deepEqual(graph.edges.map(e => e.id), withoutDuplicate.edges.map(e => e.id));
});

test('missing parents become provider-scoped ghosts, with evidence and no detail link', () => {
  const graph = build(snapshot([
    session('a', { kind: 'subagent', parentNativeId: 'absent', parentEvidence: 'path-parent' }),
    session('b', { kind: 'subagent', provider: 'codex', parentNativeId: 'absent' }),
  ]));
  const ghosts = graph.nodes.filter(n => n.kind === 'missing-parent');
  assert.equal(ghosts.length, 2);
  assert.equal(graph.summary.unresolvedParents, 2);
  assert.equal(graph.coverage.limited, true);
  for (const ghost of ghosts) {
    assert.match(ghost.label, /outside scan/i);
    assert.equal(ghost.sessionId, undefined);
    assert.equal(ghost.availability, 'not_found');
  }
  assert.ok(causal(graph).every(e => e.evidence === 'missing-parent'));
  assertResolved(graph);
});

test('nested children resolve actual parent references; path evidence survives resolution', () => {
  const graph = build(snapshot([session('p'), session('c', { kind: 'subagent', parentNativeId: 'p', parentEvidence: 'path-parent' }), session('g', { kind: 'subagent', parentNativeId: 'c' })]));
  const nodes = Object.fromEntries(runs(graph).map(n => [n.nativeId, n.id]));
  assert.deepEqual(causal(graph).map(e => [e.source, e.target, e.evidence]).sort(), [[nodes.p, nodes.c, 'path-parent'], [nodes.c, nodes.g, 'log-parent']].sort());
  assert.equal(graph.summary.unresolvedParents, 0);
});

test('cycles, self references, ambiguous IDs and parentless children do not invent ancestry', () => {
  const graph = build(snapshot([
    session('a', { kind: 'subagent', parentNativeId: 'b' }), session('b', { kind: 'subagent', parentNativeId: 'a' }),
    session('self', { parentNativeId: 'self' }), session('orphan', { kind: 'subagent' }),
    session('dup', { kind: 'subagent', parentNativeId: 'x' }), session('dup', { kind: 'subagent', parentNativeId: 'y' }),
    session('ambiguous', { kind: 'subagent', parentNativeId: 'dup' }),
  ]));
  assertResolved(graph);
  const adjacency = new Map(graph.nodes.map(n => [n.id, graph.edges.filter(e => e.kind === 'parent-child' && e.source === n.id).map(e => e.target)]));
  function visit(id, ancestors = new Set()) {
    assert.equal(ancestors.has(id), false, 'causal graph is acyclic');
    for (const child of adjacency.get(id)) visit(child, new Set([...ancestors, id]));
  }
  for (const node of graph.nodes) visit(node.id);
  const orphan = runs(graph).find(n => n.nativeId === 'orphan');
  assert.equal(causal(graph).some(e => e.target === orphan.id), false);
  const ambiguous = runs(graph).find(n => n.nativeId === 'ambiguous');
  assert.equal(graph.nodes.find(n => n.id === causal(graph).find(e => e.target === ambiguous.id).source).kind, 'missing-parent');
  assert.equal(graph.coverage.limited, true);
  assert.ok(graph.coverage.notes.some(n => /cycle|cyclic/i.test(n)));
  assert.ok(graph.coverage.notes.some(n => /self/i.test(n)));
});

test('missing native IDs remain separate by log ID and partial logs limit coverage', () => {
  const graph = build(snapshot([session('', { id: 'a', partial: true }), session('', { id: 'b' })]));
  assert.equal(runs(graph).length, 2);
  assert.equal(graph.coverage.limited, true);
});

test('a shared missing parent is one unresolved parent, and fixture provenance is preserved', () => {
  const graph = build({ ...snapshot([
    session('a', { kind: 'subagent', parentNativeId: 'missing' }),
    session('b', { kind: 'subagent', parentNativeId: 'missing' }),
  ]), dataSource: 'fixture' });
  assert.equal(graph.dataSource, 'fixture');
  assert.equal(graph.summary.unresolvedParents, 1);
  assert.equal(causal(graph).length, 2);
  assert.equal(new Set(causal(graph).map(e => e.source)).size, 1);
  assertResolved(graph);
});

const parse = (provider, file, payloads) => parseSession(payloads.map(p => JSON.stringify(p)).join('\n'), provider, file, Date.parse(now), Date.parse(now));
test('native parsers preserve full working directories without fabricating missing paths', () => {
  for (const [provider, record] of [
    ['claude', { type: 'user', sessionId: 'p', cwd: 'G:\\repos\\app', message: { content: 'fixture' } }],
    ['codex', { type: 'session_meta', payload: { id: 'p', cwd: '/work/app' } }],
  ]) {
    const parsed = parse(provider, '/logs/p.jsonl', [record]);
    assert.equal(parsed.workingDirectory, provider === 'claude' ? 'G:\\repos\\app' : '/work/app');
  }
  assert.equal(parse('codex', '/logs/p.jsonl', [{ type: 'session_meta', payload: { id: 'p', cwd: { invalid: true } } }]).workingDirectory, undefined);
});

test('folder roots group provider families by full directory and retain nested lineage', () => {
  const graph = build(snapshot([
    session('p', { workingDirectory: 'G:\\repos\\app' }),
    session('other-provider', { provider: 'codex', workingDirectory: 'g:/REPOS/app/' }),
    session('other-folder', { workingDirectory: 'G:/archive/app' }),
    session('c', { kind: 'subagent', parentNativeId: 'p', workingDirectory: '/worker/elsewhere' }),
    session('g', { kind: 'subagent', parentNativeId: 'c' }),
  ]));
  const folders = graph.nodes.filter(n => n.kind === 'folder');
  assert.equal(folders.length, 2, 'child directories do not detach actual families');
  assert.ok(folders.every(n => n.label === 'app'));
  const byNative = Object.fromEntries(runs(graph).map(n => [n.nativeId, n]));
  assert.equal(byNative.p.folderId, byNative['other-provider'].folderId);
  assert.notEqual(byNative.p.folderId, byNative['other-folder'].folderId);
  assert.equal(byNative.c.folderId, byNative.p.folderId);
  assert.equal(byNative.g.folderId, byNative.p.folderId);
  assert.equal(byNative.c.workingDirectory, '/worker/elsewhere');
  for (const run of runs(graph)) {
    const incoming = graph.edges.filter(e => e.target === run.id);
    assert.equal(incoming.length, 1, 'each run has one structural parent');
    assert.equal(incoming[0].kind, ['c', 'g'].includes(run.nativeId) ? 'parent-child' : 'membership');
    if (incoming[0].kind === 'membership') assert.equal(incoming[0].evidence, 'folder');
  }
  assertResolved(graph);
});

test('POSIX case, unknown directories and missing parents remain distinct and truthful', () => {
  const graph = build(snapshot([
    session('upper', { workingDirectory: '/work/App' }), session('lower', { workingDirectory: '/work/app' }),
    session('unknown'), session('relative', { workingDirectory: 'relative/app' }),
    session('orphan', { kind: 'subagent', parentNativeId: 'absent', workingDirectory: '/known/child' }),
  ]));
  assert.equal(graph.nodes.filter(n => n.kind === 'folder').length, 3);
  const byNative = Object.fromEntries(runs(graph).map(n => [n.nativeId, n]));
  assert.notEqual(byNative.upper.folderId, byNative.lower.folderId);
  assert.equal(byNative.unknown.folderId, byNative.relative.folderId);
  assert.equal(byNative.orphan.folderId, byNative.unknown.folderId, 'missing parent cwd cannot be inferred from a child');
  const unknown = graph.nodes.find(n => n.id === byNative.unknown.folderId);
  assert.equal(unknown.label, 'Folder not recorded');
  assert.equal(unknown.workingDirectory, undefined);
  assert.ok(graph.coverage.notes.some(n => /directory/i.test(n)));
  assertResolved(graph);
});

test('folder identity normalizes foreign OS paths without resolving on the server', () => {
  const graph = build(snapshot([
    session('a', { workingDirectory: '\\\\server\\share\\app\\.' }),
    session('b', { workingDirectory: '//SERVER/share/app/' }),
    session('c', { workingDirectory: '/work/a/../app/' }), session('d', { workingDirectory: '/work/app' }),
  ]));
  assert.equal(graph.nodes.filter(n => n.kind === 'folder').length, 2);
  assert.deepEqual(graph, build({ ...snapshot([]), sessions: [...snapshot([
    session('a', { workingDirectory: '\\\\server\\share\\app\\.' }), session('b', { workingDirectory: '//SERVER/share/app/' }),
    session('c', { workingDirectory: '/work/a/../app/' }), session('d', { workingDirectory: '/work/app' }),
  ]).sessions].reverse() }));
});
test('Claude path-only children have distinct native IDs and metadata parent evidence', () => {
  const records = [{ type: 'user', sessionId: 'parent', message: { content: 'fixture' } }];
  const a = parse('claude', '/logs/parent/subagents/agent-first.jsonl', records);
  const b = parse('claude', '/logs/parent/subagents/agent-second.jsonl', records);
  assert.notEqual(a.nativeId, 'parent');
  assert.notEqual(a.nativeId, b.nativeId);
  assert.equal(a.parentNativeId, 'parent');
  assert.equal(a.parentEvidence, 'log-parent');
  const explicit = parse('claude', '/logs/parent/subagents/agent-first.jsonl', [{ ...records[0], agentId: 'native-child' }]);
  assert.equal(explicit.nativeId, 'native-child');
});

test('Claude parent directory is evidence only when log sessionId is absent', () => {
  const a = parse('claude', 'C:\\logs\\parent\\subagents\\agent-a.jsonl', [{ type: 'assistant', message: { stop_reason: 'end_turn' } }]);
  assert.equal(a.parentNativeId, 'parent');
  assert.equal(a.parentEvidence, 'path-parent');
  assert.notEqual(a.nativeId, 'parent');
});

test('Claude path fallback cannot reuse a parent native ID matching the agent filename', () => {
  const child = parse('claude', '/logs/parent/subagents/agent-parent.jsonl', [{ type: 'user', sessionId: 'parent', message: { content: 'fixture' } }]);
  assert.notEqual(child.nativeId, child.parentNativeId);
});

test('Codex native spawn metadata supplies lineage and the actual agent label', () => {
  const child = parse('codex', '/logs/child.jsonl', [{ type: 'session_meta', payload: { id: 'child', source: { subagent: { thread_spawn: { parent_thread_id: 'parent', depth: 1, agent_nickname: 'Curie', agent_role: 'worker' } } } } }]);
  assert.equal(child.kind, 'subagent');
  assert.equal(child.parentNativeId, 'parent');
  assert.equal(child.parentEvidence, 'log-parent');
  assert.equal(child.nativeId, 'child');
  assert.equal(child.name, 'Curie');
  const role = parse('codex', '/logs/role.jsonl', [{ type: 'session_meta', payload: { id: 'role', agent_role: 'explorer', source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } } }]);
  assert.equal(role.name, 'explorer');
});

test('Codex inherited session metadata cannot replace spawned child identity or collapse siblings', () => {
  const root = parse('codex', '/logs/parent.jsonl', [
    { type: 'session_meta', payload: { id: 'parent', cwd: '/work/project' } },
  ]);
  const child = (id, name) => parse('codex', `/logs/${id}.jsonl`, [
    { type: 'session_meta', payload: { id, cwd: '/work/project', agent_nickname: name, source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } } },
    // Current Codex logs may append inherited editor/session metadata after the
    // child's own spawn record. It describes ancestry, not a new child identity.
    { type: 'session_meta', payload: { id: 'parent', cwd: '/work/project', source: 'vscode' } },
  ]);
  const first = child('child-one', 'Review worker');
  const second = child('child-two', 'Test worker');
  assert.equal(first.nativeId, 'child-one');
  assert.equal(second.nativeId, 'child-two');
  assert.equal(first.parentNativeId, 'parent');
  assert.equal(second.parentNativeId, 'parent');

  const graph = build(snapshot([root, first, second]));
  const childNodes = graph.nodes.filter(node => node.kind === 'subagent');
  const parent = graph.nodes.find(node => node.nativeId === 'parent' && node.kind === 'session');
  assert.equal(childNodes.length, 2);
  assert.equal(graph.summary.duplicatesMerged, 0);
  assert.deepEqual(graph.edges.filter(edge => edge.kind === 'parent-child').map(edge => [edge.source, edge.target]).sort(), childNodes.map(node => [parent.id, node.id]).sort());
});

test('Codex forks, arbitrary payload fields, prompts and malformed metadata cannot create spawn edges', () => {
  for (const extra of [
    { forked_from_id: 'parent', parent_thread_id: 'parent', source: 'cli' },
    { source: { subagent: { thread_spawn: { parent_thread_id: { bad: true } } } } },
    { source: { subagent: 'review' } },
  ]) {
    const child = parse('codex', '/logs/fork.jsonl', [{ type: 'session_meta', payload: { id: 'fork', ...extra } }, { type: 'response_item', payload: { type: 'message', source: { subagent: { thread_spawn: { parent_thread_id: 'prompt-parent' } } } } }]);
    assert.equal(child.parentNativeId, undefined);
    if (extra.source === 'cli') assert.equal(child.kind, 'session');
  }
});

test('sample scenario is explicit demo data with both provider families and active/waiting work', async () => {
  const demo = await import('./topology-demo.mjs').catch(error => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return {};
  });
  assert.equal(typeof demo.sampleTopology, 'function', 'sampleTopology must be implemented');
  const graph = demo.sampleTopology();
  assert.equal(graph.dataSource, 'demo');
  assert.equal(graph.summary.sessions, 2);
  assert.equal(graph.summary.subagents, 3);
  assert.equal(graph.summary.unresolvedParents, 0);
  assert.equal(causal(graph).length, 3);
  assert.equal(runs(graph).filter(n => n.provider === 'claude' && n.kind === 'subagent').length, 2);
  assert.equal(runs(graph).filter(n => n.provider === 'codex' && n.kind === 'subagent').length, 1);
  assert.ok(runs(graph).some(n => n.status === 'waiting'));
  assert.ok(runs(graph).some(n => n.status === 'running'));
  assertResolved(graph);
});
