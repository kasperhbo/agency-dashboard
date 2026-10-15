import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Activity, ArrowRight, Expand, GitBranch, HelpCircle, List, LoaderCircle, Maximize2, Minus, Network, Pause, Play, Plus, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { layoutTopology } from '../shared/topology-layout.mjs';
import { AgencyMark, EmptyState, ProviderMark, StatusBadge } from './components';
import { providerLabel, shortModel, statusLabel, timeAgo, type AgentTopology, type Mode, type Session, type TopologyNode } from './types';
import './network.css';

function validTopology(value: unknown): value is AgentTopology {
  if (!value || typeof value !== 'object') return false;
  const graph = value as AgentTopology;
  return graph.version === 1 && Array.isArray(graph.nodes) && Array.isArray(graph.edges) && !!graph.summary && Number.isFinite(Date.parse(graph.observedAt)) && graph.nodes.every(node => typeof node.id === 'string' && typeof node.label === 'string' && ['workspace', 'provider', 'session', 'subagent', 'missing-parent'].includes(node.kind)) && graph.edges.every(edge => typeof edge.source === 'string' && typeof edge.target === 'string');
}
function useTopology(mode: Mode) {
  const [graph, setGraph] = useState<AgentTopology | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setRefreshing(true);
    try {
      const response = await fetch(`/api/topology?mode=${mode}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The agent graph could not be loaded.');
      if (!validTopology(data)) throw new Error('The server returned an unsupported graph. Refresh or restart the server.');
      if (generation.current !== current) return;
      setGraph(data); setError('');
    } catch (error) {
      if (!abort.signal.aborted && generation.current === current) setError((error as Error).message);
    } finally {
      if (generation.current === current) { setLoading(false); setRefreshing(false); }
    }
  }, [mode]);
  useEffect(() => {
    setGraph(null); setLoading(true); setError('');
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 10000);
    return () => { clearInterval(timer); controller.current?.abort(); generation.current++; };
  }, [refresh]);
  return { graph, error, loading, refreshing, refresh };
}
const kindLabel = (node: TopologyNode) => ({ workspace: 'Workspace', provider: 'Provider source', session: 'Parent session', subagent: 'Subagent', 'missing-parent': 'Unresolved parent' })[node.kind];

export function NetworkPage({ mode, sessions, onOpen }: { mode: Mode; sessions: Session[]; onOpen: (session: Session) => void }) {
  const { graph, error, loading, refreshing, refresh } = useTopology(mode);
  const [query, setQuery] = useState(''), [provider, setProvider] = useState('all'), [project, setProject] = useState('all');
  const [activeOnly, setActiveOnly] = useState(false), [view, setView] = useState('graph');
  const [familyLimit, setFamilyLimit] = useState(2), [expanded, setExpanded] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null), [zoom, setZoom] = useState(.8);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const viewport = useRef<HTMLDivElement>(null), nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const dragging = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { setSelectedId(null); setExpanded([]); setFamilyLimit(2); setProvider('all'); setProject('all'); setQuery(''); }, [mode]);
  useEffect(() => { if (selectedId && graph && !graph.nodes.some(node => node.id === selectedId)) setSelectedId(null); }, [graph, selectedId]);
  const layout = useMemo(() => graph ? layoutTopology(graph, { query, provider, project, activeOnly, familyLimit, expanded }) : null, [graph, query, provider, project, activeOnly, familyLimit, expanded]);
  const selected = graph?.nodes.find(node => node.id === selectedId);
  const parentEdge = graph?.edges.find(edge => edge.kind === 'parent-child' && edge.target === selectedId);
  const parent = graph?.nodes.find(node => node.id === parentEdge?.source);
  const children = graph?.edges.filter(edge => edge.kind === 'parent-child' && edge.source === selectedId).map(edge => graph.nodes.find(node => node.id === edge.target)!).filter(Boolean) || [];
  const neighbors = new Set([selectedId, parent?.id, ...children.map(node => node.id)]);
  const stale = graph && graph.dataSource !== 'demo' && Date.now() - Date.parse(graph.observedAt) > 120000;
  const motionPaused = paused || reduced || !!error || !!stale;
  const projects = [...new Set(graph?.nodes.map(node => node.project).filter((project): project is string => !!project) || [])].sort();
  function fit() {
    if (layout && viewport.current) {
      setZoom(Math.max(.4, Math.min(1, (viewport.current.clientWidth - 28) / layout.width, (viewport.current.clientHeight - 28) / layout.height)));
      viewport.current.scrollTo({ left: 0, top: 0 });
    }
  }
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button') || event.button !== 0 || !viewport.current) return;
    dragging.current = { x: event.clientX, y: event.clientY, left: viewport.current.scrollLeft, top: viewport.current.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current && viewport.current) {
      viewport.current.scrollLeft = dragging.current.left - (event.clientX - dragging.current.x);
      viewport.current.scrollTop = dragging.current.top - (event.clientY - dragging.current.y);
    }
  }
  function focusRelative(id: string, key: string) {
    if (!graph || !layout) return;
    const index = layout.nodes.findIndex(node => node.id === id);
    const forward = graph.edges.filter(edge => edge.source === id);
    const backward = graph.edges.filter(edge => edge.target === id);
    const parentLinks = backward.some(edge => edge.kind === 'parent-child') ? backward.filter(edge => edge.kind === 'parent-child') : backward;
    const childLinks = forward.some(edge => edge.kind === 'parent-child') ? forward.filter(edge => edge.kind === 'parent-child') : forward;
    const target = key === 'ArrowRight' ? layout.nodes.find(node => childLinks.some(edge => edge.target === node.id))?.id : key === 'ArrowLeft' ? layout.nodes.find(node => parentLinks.some(edge => edge.source === node.id))?.id : key === 'ArrowDown' ? layout.nodes[index + 1]?.id : layout.nodes[index - 1]?.id;
    if (target) { nodeRefs.current.get(target)?.focus(); setSelectedId(target); }
  }
  function reset() { setQuery(''); setProvider('all'); setProject('all'); setActiveOnly(false); setFamilyLimit(2); setExpanded([]); setSelectedId(null); setZoom(.8); viewport.current?.scrollTo({ left: 0, top: 0 }); }
  function nodeIcon(node: TopologyNode) {
    if (node.kind === 'workspace') return <AgencyMark small />;
    if (node.kind === 'missing-parent') return <HelpCircle size={19} />;
    return node.provider ? <ProviderMark provider={node.provider} small /> : <GitBranch size={17} />;
  }
  if (loading && !graph) return <div className="loading-state" role="status"><LoaderCircle className="spin" size={28} /><h3>Connecting the dots…</h3><p>Reading provider sources and recorded parent relationships.</p></div>;
  return <div className="network-page">
    {error && <div className="error-banner" role="alert"><HelpCircle size={16} /><span>{error}{graph ? ' Showing the last snapshot with animation stopped.' : ''}</span><button className="text-button" onClick={() => void refresh()}>Retry <RefreshCw size={13} /></button></div>}
    {!graph || !layout ? <section className="panel"><EmptyState title="The network is unavailable" description="Check the local API connection, then refresh the graph." action={<button className="button secondary" onClick={() => void refresh()}>Try again</button>} /></section> : <>
      <div className="network-intro"><div className="network-observation"><span className={error || stale ? 'amber-dot' : 'purple-dot'} /><strong>{graph.dataSource === 'demo' ? 'Sample network' : graph.dataSource === 'fixture' ? 'Staging fixture network' : 'Local agent network'}</strong><span>{graph.dataSource === 'demo' ? 'Illustrative agent team' : `Observed ${timeAgo(graph.observedAt).toLowerCase()}`}</span></div><button className="text-button" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={13} className={refreshing ? 'spin' : ''} />{refreshing ? 'Refreshing…' : 'Refresh graph'}</button></div>
      <div className="network-summary"><div><span className="network-summary-icon"><ShieldCheck size={17} /></span><strong>{graph.sources.filter(source => source.status === 'connected').length}<small>sources available</small></strong></div><div><span className="network-summary-icon"><Network size={18} /></span><strong>{graph.summary.sessions}<small>parent sessions</small></strong></div><div><span className="network-summary-icon"><GitBranch size={17} /></span><strong>{graph.summary.subagents}<small>subagents</small></strong></div><div><span className="network-summary-icon attention"><HelpCircle size={17} /></span><strong>{graph.summary.unresolvedParents}<small>parents outside scan</small></strong></div></div>
      <div className="network-filters"><div className="filter-search"><Search size={15} /><input aria-label="Search agent network" placeholder="Find an agent, model, or project…" value={query} onChange={event => setQuery(event.target.value)} /></div><select aria-label="Network provider" value={provider} onChange={event => setProvider(event.target.value)}><option value="all">Both providers</option><option value="claude">Claude</option><option value="codex">Codex</option></select><select aria-label="Network project" value={project} onChange={event => setProject(event.target.value)}><option value="all">All projects</option>{projects.map(project => <option key={project} value={project}>{project}</option>)}</select><button className={`button secondary network-focus ${activeOnly ? 'selected' : ''}`} aria-pressed={activeOnly} onClick={() => setActiveOnly(!activeOnly)}><Activity size={14} />Working & attention</button></div>
      <div className="network-layout"><section className="panel network-canvas-panel"><div className="network-canvas-toolbar"><div className="view-switch" aria-label="Network view"><button aria-label="Graph view" aria-pressed={view === 'graph'} onClick={() => setView('graph')}><Network size={16} /></button><button aria-label="Hierarchy list view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={16} /></button></div><span className="network-visible-count">{layout.visibleRuns} of {layout.matchingRuns} matching nodes</span><button className="icon-button" aria-label={motionPaused ? 'Resume graph animation' : 'Pause graph animation'} aria-pressed={!motionPaused} disabled={reduced || !!error || !!stale} onClick={() => setPaused(!paused)}>{motionPaused ? <Play size={15} /> : <Pause size={15} />}</button><button className="icon-button" aria-label="Reset graph view" onClick={reset}><RefreshCw size={15} /></button></div>
      {view === 'graph' ? <div className={`network-viewport ${motionPaused ? 'motion-paused' : ''}`} role="region" aria-label="Agent relationship graph" tabIndex={0} ref={viewport} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}>
        <div className="network-zoom-space" style={{ width: layout.width * zoom, height: layout.height * zoom }}><div className="network-stage" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
          <svg className="network-connections" width={layout.width} height={layout.height} aria-hidden="true">{layout.edges.map(edge => <path key={edge.id} data-edge-kind={edge.kind} className={`network-edge ${edge.kind} ${edge.animated ? 'is-active' : ''} ${selectedId ? neighbors.has(edge.source) && neighbors.has(edge.target) ? 'is-highlighted' : 'is-muted' : ''}`} d={edge.path} />)}</svg>
          {layout.nodes.map(node => {
            const incoming = graph.edges.find(edge => edge.kind === 'parent-child' && edge.target === node.id);
            const nodeParent = graph.nodes.find(item => item.id === incoming?.source);
            return <button key={node.id} ref={element => { if (element) nodeRefs.current.set(node.id, element); else nodeRefs.current.delete(node.id); }} data-node-kind={node.kind} data-node-id={node.id} className={`network-node ${node.kind} ${node.provider || ''} ${node.status || ''} ${selectedId === node.id ? 'is-selected' : selectedId && neighbors.has(node.id) ? 'is-related' : ''}`} style={{ left: node.x, top: node.y, width: node.width, height: node.height }} onClick={() => setSelectedId(node.id)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); focusRelative(node.id, event.key); } }} aria-pressed={selectedId === node.id} aria-label={`Select ${kindLabel(node)} ${node.label}${node.status ? `, ${statusLabel[node.status]}` : ''}${nodeParent ? `, parent ${nodeParent.label}` : ''}`}>
              <span className="network-node-symbol">{nodeIcon(node)}</span><span className="network-node-copy"><span>{node.label}</span><small>{node.kind === 'provider' ? node.availability === 'connected' ? 'Source logs available' : 'Source unavailable' : node.kind === 'workspace' ? 'Your agents, together' : node.kind === 'missing-parent' ? 'Recorded parent not observed' : node.project || 'No project reported'}</small></span>{node.status && <i className={`network-status-dot ${node.status}`} />}{node.kind === 'subagent' && <span className="network-child-tag">Subagent</span>}
            </button>;
          })}
          {layout.moreGroups.map(group => <button key={group.parentId} className="network-expand" style={{ left: group.x, top: group.y, width: group.width, height: group.height }} onClick={() => setExpanded([...expanded, group.parentId])}><Plus size={13} />Show {group.count} more subagents</button>)}
        </div></div>
      </div> : <div className="network-list" role="list" aria-label="Agent hierarchy">{layout.nodes.filter(node => ['session', 'subagent', 'missing-parent'].includes(node.kind)).map(node => {
        const incoming = graph.edges.find(edge => edge.kind === 'parent-child' && edge.target === node.id);
        const label = graph.nodes.find(item => item.id === incoming?.source)?.label;
        return <div role="listitem" key={node.id}><button className="network-list-item" onClick={() => setSelectedId(node.id)} aria-pressed={selectedId === node.id}>{nodeIcon(node)}<span><strong>{node.label}</strong><small>{kindLabel(node)}{label ? ` · Parent: ${label}` : ' · No recorded parent'}</small></span>{node.status && <StatusBadge status={node.status} />}<ArrowRight size={14} /></button></div>;
      })}</div>}
      {layout.matchingRuns === 0 && <div className="network-empty"><HelpCircle size={19} /><strong>{graph.summary.sessions || graph.summary.subagents ? 'No agents match these filters' : 'No agent runs observed yet'}</strong><span>{graph.summary.sessions || graph.summary.subagents ? 'Clear a filter or search to see your team again.' : 'Start Claude Code or Codex locally, then refresh. Source availability is not a live agent connection.'}</span><button className="text-button" onClick={reset}>Reset filters</button></div>}
      <div className="network-canvas-footer"><span>{reduced ? 'Reduced motion enabled' : motionPaused ? 'Animation paused' : 'Animating reported working paths'}<i />Drag or scroll to pan</span><div><button className="icon-button" aria-label="Zoom out" disabled={zoom <= .4} onClick={() => setZoom(Math.max(.4, +(zoom - .1).toFixed(2)))}><Minus size={14} /></button><output aria-label="Graph zoom">{Math.round(zoom * 100)}%</output><button className="icon-button" aria-label="Zoom in" disabled={zoom >= 1.5} onClick={() => setZoom(Math.min(1.5, +(zoom + .1).toFixed(2)))}><Plus size={14} /></button><button className="icon-button" aria-label="Fit graph to viewport" onClick={fit}><Maximize2 size={14} /></button></div></div>
      {layout.hiddenCount > 0 && <div className="network-hidden"><span>{layout.hiddenCount} matching nodes are collapsed to keep the map readable.</span>{layout.hiddenFamilies > 0 && <button className="text-button" onClick={() => setFamilyLimit(familyLimit + 2)}><Expand size={13} />Show more families</button>}</div>}
      </section><aside className="network-inspector panel" aria-label="Agent inspector"><header><span>{selected ? kindLabel(selected) : 'The shape of your team'}</span>{selected && <button className="icon-button" aria-label="Clear selected agent" onClick={() => setSelectedId(null)}><X size={15} /></button>}</header>{selected ? <>
        <div className="network-inspector-symbol">{nodeIcon(selected)}</div><h2>{selected.label}</h2>{selected.status && <StatusBadge status={selected.status} />}
        <dl><div><dt>Provider</dt><dd>{selected.provider ? providerLabel(selected.provider) : 'Workspace'}</dd></div>{selected.kind === 'provider' && <div><dt>Source availability</dt><dd>{selected.availability === 'connected' ? 'Logs available' : 'Not available'}</dd></div>}{selected.project && <div><dt>Project</dt><dd>{selected.project}</dd></div>}{selected.model && <div><dt>Last observed model</dt><dd>{shortModel(selected.model)}</dd></div>}{selected.tokens !== undefined && <div><dt>Recorded tokens</dt><dd>{selected.tokens === null ? 'Not reported' : selected.tokens.toLocaleString()}</dd></div>}{selected.updatedAt && <div><dt>Last log timestamp</dt><dd>{timeAgo(selected.updatedAt)}</dd></div>}</dl>
        {parent && <div className="network-parent-info"><span>Reported parent</span><button onClick={() => setSelectedId(parent.id)}>{parent.label}<ArrowRight size={13} /></button><small>{parentEdge?.evidence === 'path-parent' ? 'Correlated from native log folder structure' : parent.kind === 'missing-parent' ? 'Native parent reference; parent is outside this scan' : 'Native parent reference in log metadata'}</small></div>}
        {children.length > 0 && <div className="network-children"><h3>{children.length} connected subagent{children.length === 1 ? '' : 's'}</h3>{children.map(child => <button key={child.id} onClick={() => setSelectedId(child.id)}><GitBranch size={13} /><span>{child.label}</span><ArrowRight size={12} /></button>)}</div>}
        {selected.kind === 'missing-parent' && <p className="warning-note">This is a reference, not an observed agent. The parent may be outside the scan limit or its log may no longer be available.</p>}
        {selected.sessionId && sessions.some(session => session.id === selected.sessionId) && <button className="button secondary network-open-session" onClick={() => onOpen(sessions.find(session => session.id === selected.sessionId)!)}>Open session details <ArrowRight size={14} /></button>}
        {selected.nativeId && <div className="network-native-id"><span>Native ID</span><code>{selected.nativeId}</code></div>}
      </> : <><span className="network-inspector-hero"><GitBranch size={32} /></span><h2>One workspace.<br />A connected team.</h2><p>Select an agent to inspect its parent, subagents, activity, and usage.</p><div className="network-guide"><span><i className="guide-line" />Provider membership</span><span><i className="guide-line lineage" />Recorded parent → child</span><span><i className="guide-line unresolved" />Parent outside scan</span><span><i className="green-dot" />Recent working activity</span></div><p className="info-note">Source logs being available does not mean an agent is currently connected or running. Activity is inferred from recent logs.</p></>}
      </aside></div>
      <div className="network-evidence"><ShieldCheck size={15} /><span>{graph.dataSource === 'demo' ? 'Sample relationships for exploration. No agents are started from this view.' : `${graph.summary.duplicatesMerged} duplicate logs merged. Links come from native metadata; project membership never implies an agent-to-agent connection.`}</span></div>
      {graph.coverage.notes.length > 0 && <details className="network-coverage"><summary>Data coverage & relationship notes ({graph.coverage.notes.length})</summary><ul>{graph.coverage.notes.map(note => <li key={note}>{note}</li>)}</ul></details>}
    </>}
  </div>;
}
