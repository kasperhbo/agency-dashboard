import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutTopology } from '../shared/topology-layout.mjs';

const now = Date.parse('2026-10-16T12:00:00Z');
const edge = (source, target, kind = 'membership') => ({ id: `${source}:${target}`, source, target, kind, evidence: kind === 'membership' ? 'folder' : 'log-parent', animated: false });
function fixture(folder = true) {
  const container = folder ? { id: 'folder', kind: 'folder', label: 'Folder' } : { id: 'claude', kind: 'provider', label: 'Claude', provider: 'claude' };
  const run = (id, status, kind = 'session') => ({ id, label: id, kind, provider: 'claude', status, ...(folder ? { folderId: 'folder' } : {}), updatedAt: new Date(now).toISOString() });
  return { nodes: [container, run('root', 'running'), run('idle-parent', 'idle', 'subagent'), run('active-child', 'running', 'subagent'), run('idle-alone', 'idle'), run('completed', 'completed')], edges: [edge(container.id, 'root'), edge('root', 'idle-parent', 'parent-child'), edge('idle-parent', 'active-child', 'parent-child'), edge(container.id, 'idle-alone'), edge(container.id, 'completed')] };
}

for (const folder of [true, false]) {
  test(`idle exclusion preserves active descendants with ${folder ? 'folder' : 'provider'} membership and never invents parentage`, () => {
    const graph = fixture(folder), before = structuredClone(graph);
    const result = layoutTopology(graph, { now, familyLimit: 20, focusId: 'idle-parent', expanded: ['root', 'idle-parent'] });
    assert.deepEqual(result.nodes.filter(node => ['session', 'subagent'].includes(node.kind)).map(node => node.id).sort(), ['active-child', 'completed', 'root']);
    assert.equal(result.matchingRuns, 3);
    const membership = result.edges.find(edge => edge.target === 'active-child');
    assert.equal(membership.kind, 'membership');
    assert.equal(membership.source, folder ? 'folder' : 'claude');
    assert.equal(membership.evidence, folder ? 'folder' : 'provider');
    assert.equal(result.edges.some(edge => edge.kind === 'parent-child'), false);
    assert.deepEqual(graph, before);
    const restored = layoutTopology(graph, { now, includeIdle: true, familyLimit: 20 });
    assert.equal(restored.matchingRuns, 5);
    assert.equal(restored.edges.some(edge => edge.source === 'idle-parent' && edge.target === 'active-child' && edge.kind === 'parent-child'), true);
    assert.equal(restored.edges.some(edge => edge.id.startsWith('filtered-membership:')), false);
  });
}

test('search family traversal crosses hidden idle ancestors without exposing them; focus and expansion cannot restore idle', () => {
  const graph = fixture();
  const family = layoutTopology(graph, { now, query: 'root', expanded: ['root', 'idle-parent'], focusId: 'idle-parent', familyLimit: 20 });
  assert.deepEqual(family.nodes.map(node => node.id).sort(), ['active-child', 'folder', 'root']);
  const child = layoutTopology(graph, { now, query: 'active-child', focusId: 'active-child' });
  assert.deepEqual(child.nodes.map(node => node.id).sort(), ['active-child', 'folder']);
  assert.equal(layoutTopology(graph, { now, query: 'idle', focusId: 'idle-alone' }).matchingRuns, 0);
});

test('recent completed remains eligible by default while Working & attention keeps its existing filter', () => {
  const graph = fixture();
  assert.equal(layoutTopology(graph, { now, familyLimit: 20 }).nodes.some(node => node.id === 'completed'), true);
  const working = layoutTopology(graph, { now, activeOnly: true, familyLimit: 20 });
  assert.deepEqual(working.nodes.filter(node => ['session', 'subagent'].includes(node.kind)).map(node => node.id).sort(), ['active-child', 'root']);
});
