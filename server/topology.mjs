import { createHash } from 'node:crypto';

const providers = ['claude', 'codex'];
const labels = { claude: 'Claude', codex: 'Codex' };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const opaque = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const text = value => typeof value === 'string' && value.trim() ? value : '';
const timestamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;
const newest = session => [session.fileModifiedAt, session.updatedAt, session.lastActivityAt, session.startedAt].map(timestamp).find(Number.isFinite) ?? -Infinity;
function stableJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJSON(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const identity = session => [session.provider, session.kind === 'subagent' ? 'subagent' : 'session', text(session.parentNativeId), text(session.nativeId) ? ['native', session.nativeId] : ['log', session.id]];
const active = node => node.status === 'running' || node.status === 'waiting';

/** Pure projection of a discovery snapshot. No file reads, clock reads, or token aggregation.
 * Identity includes provider, kind, parent and native ID (falling back to the log ID).
 * fileModifiedAt chooses the canonical log; log timestamps and lexical ties are fallbacks.
 * unresolvedParents counts distinct provider-scoped ghost parents, not child edges.
 */
export function buildTopology(snapshot = {}) {
  const nodes = new Map(), edges = [], notes = new Set(snapshot.coverage?.notes || []);
  const sources = structuredClone(snapshot.sources || []).sort((a, b) => compare(stableJSON(a), stableJSON(b)));
  const canonical = new Map();
  let duplicatesMerged = 0;
  for (const session of snapshot.sessions || []) {
    if (!session || !providers.includes(session.provider) || !text(session.id)) {
      notes.add('An unsupported session without a provider or log ID was omitted.');
      continue;
    }
    const key = JSON.stringify(identity(session));
    const previous = canonical.get(key);
    if (previous) duplicatesMerged++;
    if (!previous || newest(session) > newest(previous) ||
        (newest(session) === newest(previous) && (compare(session.id, previous.id) || compare(stableJSON(session), stableJSON(previous))) < 0)) canonical.set(key, session);
  }
  const sessions = [...canonical.values()].sort((a, b) => compare(JSON.stringify(identity(a)), JSON.stringify(identity(b))));
  function node(value) { nodes.set(value.id, value); return value; }
  function edge(source, target, kind, evidence, animated = false) {
    edges.push({ id: opaque('edge', kind, source, target), source, target, kind, evidence, animated });
  }
  const workspace = node({ id: opaque('workspace'), kind: 'workspace', label: 'Local workspace' });
  const providerNodes = new Map();
  for (const provider of providers) {
    const reports = sources.filter(source => source.provider === provider);
    const availability = reports.some(source => source.status === 'error') ? 'error' : reports.some(source => source.status === 'connected') || sessions.some(session => session.provider === provider) ? 'connected' : 'not_found';
    const parent = node({ id: opaque('provider', provider), kind: 'provider', label: labels[provider], provider, availability });
    providerNodes.set(provider, parent);
    edge(workspace.id, parent.id, 'membership', 'workspace');
    for (const report of reports) {
      if (report.status !== 'connected') notes.add(`${labels[provider]} source is ${report.status === 'not_found' ? 'not found' : 'unavailable'}.`);
      if (report.limited) notes.add(`${labels[provider]} discovery was limited; some logs are outside the scan.`);
      for (const warning of report.warnings || []) notes.add(`${labels[provider]}: ${warning}`);
    }
  }
  const byNative = new Map(), runNodes = new Map();
  for (const session of sessions) {
    const value = {
      id: opaque('run', ...identity(session)), kind: session.kind === 'subagent' ? 'subagent' : 'session',
      label: text(session.name) || text(session.title) || `${labels[session.provider]} ${session.kind === 'subagent' ? 'subagent' : 'session'}`,
      provider: session.provider, sessionId: session.id, tokens: Number.isFinite(session.tokens) && session.tokens >= 0 ? session.tokens : null,
    };
    for (const field of ['nativeId', 'parentNativeId', 'status', 'model', 'project', 'updatedAt']) if (text(session[field])) value[field] = session[field];
    node(value);
    runNodes.set(session, value);
    edge(providerNodes.get(session.provider).id, value.id, 'membership', 'provider');
    if (text(session.nativeId)) {
      const key = JSON.stringify([session.provider, session.nativeId]);
      const matches = byNative.get(key) || [];
      matches.push(value);
      byNative.set(key, matches);
    }
    if (session.partial || session.usage?.coverage === 'partial') notes.add('Some session logs are partial; lineage and usage may be incomplete.');
  }
  // child -> parent map permits bounded iterative cycle detection, including nested agents.
  const parentOf = new Map();
  for (const session of sessions) {
    const child = runNodes.get(session);
    if (!text(session.parentNativeId)) {
      if (child.kind === 'subagent') notes.add('A subagent has no recorded parent; no causal relationship was inferred.');
      continue;
    }
    const matches = byNative.get(JSON.stringify([session.provider, session.parentNativeId])) || [];
    if (matches.length === 1 && matches[0].id === child.id) {
      notes.add('A self parent reference was omitted.');
      continue;
    }
    let parent = matches.length === 1 ? matches[0] : null;
    if (!parent) {
      const id = opaque('missing-parent', session.provider, session.parentNativeId);
      parent = nodes.get(id) || node({ id, kind: 'missing-parent', label: 'Parent outside scan', provider: session.provider, nativeId: session.parentNativeId, availability: 'not_found' });
      if (!edges.some(e => e.kind === 'membership' && e.target === parent.id)) edge(providerNodes.get(session.provider).id, parent.id, 'membership', 'provider');
      notes.add(matches.length ? 'A parent ID is ambiguous within its provider; its parent is shown outside the resolved scan.' : 'Referenced parents outside the scan are shown as missing parents.');
    }
    let ancestor = parent.id;
    while (ancestor !== child.id && parentOf.has(ancestor)) ancestor = parentOf.get(ancestor);
    if (ancestor === child.id) {
      notes.add('A cyclic parent reference was omitted.');
      continue;
    }
    parentOf.set(child.id, parent.id);
    edge(parent.id, child.id, 'parent-child', parent.kind === 'missing-parent' ? 'missing-parent' : session.parentEvidence === 'path-parent' ? 'path-parent' : 'log-parent', active(child));
  }
  const orderedNodes = [...nodes.values()].sort((a, b) => compare(a.id, b.id));
  return {
    version: 1,
    observedAt: text(snapshot.observedAt) || text(snapshot.scannedAt) || '1970-01-01T00:00:00.000Z',
    dataSource: ['demo', 'fixture'].includes(snapshot.dataSource) ? snapshot.dataSource : 'local',
    nodes: orderedNodes, edges: edges.sort((a, b) => compare(a.id, b.id)),
    summary: {
      sessions: sessions.filter(session => session.kind !== 'subagent').length,
      subagents: sessions.filter(session => session.kind === 'subagent').length,
      unresolvedParents: orderedNodes.filter(node => node.kind === 'missing-parent').length,
      activeRuns: sessions.filter(active).length, duplicatesMerged,
    },
    sources,
    coverage: { limited: Boolean(snapshot.coverage?.limited || notes.size), notes: [...notes].sort(compare) },
  };
}
