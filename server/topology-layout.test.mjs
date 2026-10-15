import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutTopology } from '../shared/topology-layout.mjs';

const node = (id, kind, rest = {}) => ({ id, kind, label: id, ...rest });
const edge = (source, target, kind = 'membership') => ({ id: `${source}-${target}`, source, target, kind, evidence: kind === 'membership' ? 'provider' : 'log-parent', animated: false });
const graph = {
  nodes: [node('workspace', 'workspace'), node('claude', 'provider', { provider: 'claude' }), node('codex', 'provider', { provider: 'codex' }), node('parent', 'session', { provider: 'claude', project: 'website', status: 'idle' }), node('child', 'subagent', { provider: 'claude', project: 'website', status: 'running', label: 'Build tests' }), node('other', 'session', { provider: 'codex', project: 'api', status: 'completed' })],
  edges: [edge('workspace', 'claude'), edge('workspace', 'codex'), edge('claude', 'parent'), edge('parent', 'child', 'parent-child'), edge('codex', 'other')],
};

test('layout positions children after their parent and retains both provider branches', () => {
  const result = layoutTopology(graph);
  const byId = new Map(result.nodes.map(item => [item.id, item]));
  assert.equal(result.nodes.length, 6);
  assert.ok(byId.get('child').x > byId.get('parent').x);
  assert.ok(byId.get('parent').x > byId.get('claude').x);
  assert.ok(result.width > byId.get('child').x);
  assert.equal(result.edges.length, 5);
  assert.equal(result.hiddenCount, 0);
});

test('folder-first layout starts at folders and keeps nested descendants under their real parent', () => {
  const folderGraph = {
    nodes: [...graph.nodes.map(n => ['parent', 'child', 'other'].includes(n.id) ? { ...n, folderId: 'folder' } : n), node('folder', 'folder', { workingDirectory: '/work/app' }), node('grandchild', 'subagent', { provider: 'claude', folderId: 'folder', label: 'Nested worker' })],
    edges: [...graph.edges, edge('folder', 'parent'), edge('folder', 'other'), edge('child', 'grandchild', 'parent-child')],
  };
  const result = layoutTopology(folderGraph);
  assert.equal(result.nodes.some(n => ['workspace', 'provider'].includes(n.kind)), false);
  const byId = Object.fromEntries(result.nodes.map(n => [n.id, n]));
  assert.ok(byId.folder.x < byId.parent.x);
  assert.ok(byId.parent.x < byId.child.x);
  assert.ok(byId.child.x < byId.grandchild.x);
  assert.equal(result.edges.length, 4);
  const filtered = layoutTopology(folderGraph, { provider: 'claude', folder: 'folder', query: 'Nested worker' });
  assert.deepEqual(filtered.nodes.map(n => n.id).sort(), ['child', 'folder', 'grandchild', 'parent']);
  assert.equal(layoutTopology(folderGraph, { folder: 'absent' }).visibleRuns, 0);
  for (let i = 0; i < result.nodes.length; i++) for (const b of result.nodes.slice(i + 1)) {
    const a = result.nodes[i];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'node boxes do not overlap');
  }
});

test('search and activity filtering retain the matching child’s ancestors, not unrelated runs', () => {
  const result = layoutTopology(graph, { query: 'build tests', activeOnly: true });
  assert.deepEqual(result.nodes.filter(item => ['session', 'subagent'].includes(item.kind)).map(item => item.id).sort(), ['child', 'parent']);
  assert.equal(result.edges.some(item => item.target === 'child' && item.source === 'parent'), true);
  assert.equal(result.nodes.some(item => item.id === 'other'), false);
});

test('provider membership does not override a recorded parent when both edges exist', () => {
  const result = layoutTopology({ nodes: graph.nodes, edges: [...graph.edges, edge('claude', 'child')] });
  assert.ok(result.nodes.find(node => node.id === 'child').x > result.nodes.find(node => node.id === 'parent').x);
  const filtered = layoutTopology({ nodes: graph.nodes, edges: [...graph.edges, edge('claude', 'child')] }, { query: 'Build tests' });
  assert.equal(filtered.nodes.some(node => node.id === 'parent'), true);
});

test('provider and project filters never leak another provider’s run', () => {
  const result = layoutTopology(graph, { provider: 'claude', project: 'website' });
  assert.equal(result.nodes.some(item => item.provider === 'codex'), false);
  assert.equal(result.nodes.some(item => item.id === 'child'), true);
  assert.equal(result.edges.every(item => result.nodes.some(node => node.id === item.source) && result.nodes.some(node => node.id === item.target)), true);
});

test('family and child limits expose hidden counts and expand deterministically', () => {
  const nodes = [...graph.nodes, ...Array.from({ length: 5 }, (_, i) => node(`worker-${i}`, 'subagent', { provider: 'claude', project: 'website' }))];
  const edges = [...graph.edges, ...Array.from({ length: 5 }, (_, i) => edge('parent', `worker-${i}`, 'parent-child'))];
  const collapsed = layoutTopology({ nodes, edges }, { childLimit: 2 });
  assert.equal(collapsed.hiddenCount, 4);
  assert.equal(collapsed.moreGroups[0].count, 4);
  const expanded = layoutTopology({ nodes, edges }, { childLimit: 2, expanded: ['parent'] });
  assert.equal(expanded.hiddenCount, 0);
  assert.equal(expanded.nodes.length, 11);
  const reversed = layoutTopology({ nodes: [...nodes].reverse(), edges: [...edges].reverse() }, { childLimit: 2, expanded: ['parent'] });
  assert.deepEqual(expanded.nodes.map(({ id, x, y }) => ({ id, x, y })), reversed.nodes.map(({ id, x, y }) => ({ id, x, y })));
});

test('empty matches, missing endpoints, and accidental cycles do not crash or produce dangling edges', () => {
  const empty = layoutTopology(graph, { query: 'does-not-exist' });
  assert.equal(empty.visibleRuns, 0);
  const broken = layoutTopology({ nodes: graph.nodes, edges: [...graph.edges, edge('missing', 'parent'), edge('child', 'parent', 'parent-child')] });
  assert.ok(Number.isFinite(broken.height));
  assert.equal(broken.edges.some(item => item.source === 'missing'), false);
  assert.equal(broken.nodes.filter(item => item.id === 'child').length, 1);
});
