const runs = new Set(['session', 'subagent', 'missing-parent']);
const rank = node => ({ running: 0, waiting: 1, error: 2, idle: 3, completed: 4 })[node.status] ?? 5;
const order = (a, b) => rank(a) - rank(b) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.id.localeCompare(b.id);

/** Deterministic, bounded tree layout. Membership and lineage remain separate. */
export function layoutTopology(graph, options = {}) {
  const { provider = 'all', project = 'all', folder = 'all', query = '', activeOnly = false, includeIdle = false, familyLimit = 2, childLimit = 3, expanded = [], focusId, now = Date.now() } = options;
  const expandedIds = new Set(expanded);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const folderMode = graph.nodes.some(node => node.kind === 'folder');
  const allowed = node => ['workspace', 'folder'].includes(node.kind) || provider === 'all' || node.provider === provider;
  const edges = graph.edges.filter(edge => nodes.has(edge.source) && nodes.has(edge.target) && edge.source !== edge.target);
  const incoming = new Map(), children = new Map();
  const priority = edge => edge.kind === 'parent-child' ? 2 : nodes.get(edge.source).kind === 'folder' ? 1 : 0;
  for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!incoming.has(edge.target) || priority(edge) > priority(incoming.get(edge.target))) incoming.set(edge.target, edge);
    if (edge.kind !== 'parent-child' || !runs.has(nodes.get(edge.source).kind) || !runs.has(nodes.get(edge.target).kind)) continue;
    if (!children.has(edge.source)) children.set(edge.source, []);
    children.get(edge.source).push(nodes.get(edge.target));
  }
  for (const [id, list] of children) children.set(id, [...new Map(list.map(node => [node.id, node])).values()].sort(order));
  const search = query.toLowerCase().trim();
  const inScope = node => allowed(node) && (project === 'all' || node.project === project) && (folder === 'all' || node.folderId === folder);
  const historyVisible = node => {
    if (!['error', 'completed'].includes(node.status)) return true;
    const updatedAt = Date.parse(node.updatedAt || '');
    return !Number.isFinite(updatedAt) || now - updatedAt < 24 * 60 * 60 * 1000;
  };
  const runVisible = node => historyVisible(node) && (includeIdle || node.status !== 'idle');
  const matches = [...nodes.values()].filter(node => runs.has(node.kind) && inScope(node) && runVisible(node) && (!activeOnly || ['running', 'waiting', 'error'].includes(node.status)) && `${node.label} ${node.model || ''} ${node.project || ''} ${node.workingDirectory || ''} ${nodes.get(node.folderId)?.workingDirectory || ''} ${node.nativeId || ''}`.toLowerCase().includes(search));
  const included = new Set(matches.map(node => node.id));
  if (search && !activeOnly) {
    const queue = [...included];
    const visited = new Set(queue);
    while (queue.length) for (const child of children.get(queue.shift()) || []) {
      if (!visited.has(child.id) && inScope(child) && historyVisible(child)) {
        visited.add(child.id); queue.push(child.id);
        if (runVisible(child)) included.add(child.id);
      }
    }
  }
  for (const match of [...included]) {
    let id = match;
    const seen = new Set([id]);
    while (incoming.has(id)) {
      const ancestor = nodes.get(incoming.get(id).source);
      if (seen.has(ancestor.id) || !allowed(ancestor)) break;
      if (runs.has(ancestor.kind) && !runVisible(ancestor)) break;
      included.add(ancestor.id); seen.add(ancestor.id); id = ancestor.id;
    }
  }
  // If a filtered historical parent separates a visible descendant from its folder,
  // connect that first visible descendant to the same folder in this filtered view.
  // Idle parents follow the same rule, using provider membership in legacy graphs.
  for (const id of included) {
    const parentLink = incoming.get(id);
    const run = nodes.get(id);
    if (!runs.has(run.kind) || !parentLink || parentLink.kind !== 'parent-child' || included.has(parentLink.source)) continue;
    const container = folderMode ? nodes.get(run.folderId) : [...nodes.values()].find(node => node.kind === 'provider' && node.provider === run.provider);
    if (container && !edges.some(edge => edge.source === container.id && edge.target === id)) edges.push({ id: `filtered-membership:${container.id}:${id}`, source: container.id, target: id, kind: 'membership', evidence: folderMode ? 'folder' : 'provider', animated: false });
  }
  const visibleRuns = [...included].filter(id => runs.has(nodes.get(id).kind));
  // Reveal only the requested ancestor path; filters and normal collapse limits still apply.
  const focusPath = new Set();
  let focus = included.has(focusId) ? focusId : undefined;
  while (focus && !focusPath.has(focus)) { focusPath.add(focus); focus = incoming.get(focus)?.source; }
  const positioned = [], moreGroups = [], placed = new Set();
  let cursor = 48, maxX = 720, hiddenFamilies = 0;
  const ROW = 106;
  const visibleChildren = id => (children.get(id) || []).filter(child => included.has(child.id));
  const shownChildren = id => {
    const all = visibleChildren(id);
    return expandedIds.has(id) ? all : all.filter((child, index) => index < Math.max(1, childLimit) || focusPath.has(child.id));
  };
  function measure(id, seen = new Set()) {
    if (seen.has(id) || seen.size > 32) return 0;
    const next = new Set([...seen, id]);
    return Math.max(1, shownChildren(id).reduce((sum, child) => sum + measure(child.id, next), 0) + (shownChildren(id).length < visibleChildren(id).length ? 1 : 0));
  }
  function place(id, depth, top, ancestors = new Set()) {
    if (placed.has(id) || ancestors.has(id) || depth > 32) return;
    placed.add(id);
    const node = nodes.get(id), height = measure(id, ancestors) * ROW;
    const x = (folderMode ? 280 : 458) + depth * 242, y = top + Math.max(ROW, height) / 2 - 39;
    positioned.push({ ...node, x, y, width: 214, height: 78 });
    maxX = Math.max(maxX, x + 254);
    let childTop = top;
    const next = new Set([...ancestors, id]);
    for (const child of shownChildren(id)) { place(child.id, depth + 1, childTop, next); childTop += measure(child.id, next) * ROW; }
    const remaining = visibleChildren(id).length - shownChildren(id).length;
    if (remaining > 0) moreGroups.push({ parentId: id, count: remaining, x: x + 242, y: childTop + 23, width: 214, height: 42 });
  }
  const containers = [...nodes.values()].filter(node => node.kind === (folderMode ? 'folder' : 'provider') && allowed(node)).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  for (const source of containers) {
    const candidates = visibleRuns.map(id => nodes.get(id)).filter(node => folderMode ? node.folderId === source.id : node.provider === source.provider);
    if (folderMode && !candidates.length) continue;
    const roots = candidates.filter(node => {
      const parent = incoming.get(node.id);
      return !parent || parent.kind !== 'parent-child' || !included.has(parent.source);
    }).sort(order);
    // Malformed cyclic input still gets a finite, inspectable layout.
    if (!roots.length && candidates.length) roots.push([...candidates].sort(order)[0]);
    const shown = roots.filter((root, index) => index < Math.max(1, familyLimit) || focusPath.has(root.id));
    hiddenFamilies += Math.max(0, roots.length - shown.length);
    const clusterStart = cursor;
    for (const root of shown) { place(root.id, 0, cursor); cursor += Math.max(1, measure(root.id)) * ROW + 30; }
    cursor = Math.max(cursor, clusterStart + 142);
    positioned.push({ ...source, x: folderMode ? 24 : 220, y: clusterStart + (cursor - clusterStart) / 2 - 39, width: folderMode ? 214 : 184, height: 78 });
    placed.add(source.id);
    cursor += 64;
  }
  const height = Math.max(340, cursor + 20);
  for (const node of [...nodes.values()].filter(node => !folderMode && node.kind === 'workspace').sort((a, b) => a.id.localeCompare(b.id))) {
    positioned.push({ ...node, x: 16, y: height / 2 - 42, width: 168, height: 84 }); placed.add(node.id);
  }
  positioned.sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
  const outputEdges = edges.filter(edge => placed.has(edge.source) && placed.has(edge.target)).map(edge => {
    const a = positioned.find(node => node.id === edge.source), b = positioned.find(node => node.id === edge.target);
    const x1 = a.x + a.width, y1 = a.y + a.height / 2, x2 = b.x, y2 = b.y + b.height / 2;
    const bend = Math.max(30, Math.abs(x2 - x1) / 2);
    return { ...edge, path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}` };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { width: maxX, height, nodes: positioned, edges: outputEdges, moreGroups, hiddenCount: visibleRuns.filter(id => !placed.has(id)).length, hiddenFamilies, visibleRuns: visibleRuns.filter(id => placed.has(id)).length, matchingRuns: visibleRuns.length };
}
