import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Activity, ArrowRight, Expand, GitBranch, HelpCircle, List, LoaderCircle, Maximize2, Minus, Network, Pause, Play, Plus, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { layoutTopology } from '../shared/topology-layout.mjs';
import { AgencyMark, EmptyState, ProviderMark, SectionHeading, StatusBadge } from './components';
import { providerLabel, shortModel, statusLabel, timeAgo, type AgentTopology, type Mode, type Session, type TopologyNode } from './types';
import { useObservationClock } from './useObservationClock';
import './network.css';

function validTopology(value: unknown): value is AgentTopology {
  if (!value || typeof value !== 'object') return false;
  const graph = value as AgentTopology;
  return graph.version === 1 && Array.isArray(graph.nodes) && Array.isArray(graph.edges) && !!graph.summary && Number.isFinite(Date.parse(graph.observedAt)) && graph.nodes.every(node => typeof node.id === 'string' && typeof node.label === 'string' && ['workspace', 'provider', 'folder', 'session', 'subagent', 'missing-parent'].includes(node.kind)) && graph.edges.every(edge => typeof edge.source === 'string' && typeof edge.target === 'string');
}
function useTopology(mode: Mode, enabled = true) {
  const [graph, setGraph] = useState<AgentTopology | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (controller.current) return;
    const current = ++generation.current;
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
      if (generation.current === current) { controller.current = null; setLoading(false); setRefreshing(false); }
    }
  }, [mode]);
  useEffect(() => {
    if (!enabled) return;
    setGraph(null); setLoading(true); setError('');
    void refresh();
    const resume = () => { if (!document.hidden) void refresh(); };
    const timer = setInterval(resume, 10000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      controller.current?.abort(); controller.current = null; generation.current++;
    };
  }, [refresh, enabled]);
  return { graph, error, loading, refreshing, refresh };
}
const kindLabel = (node: TopologyNode) => ({ workspace: 'Workspace', provider: 'Provider source', folder: 'Folder', session: 'Agent session', subagent: 'Subagent', 'missing-parent': 'Unresolved parent' })[node.kind];

export function NetworkOverview({ mode, topology, onOpen }: { mode: Mode; topology: AgentTopology | undefined; onOpen: () => void }) {
  const sample = useTopology(mode, mode === 'demo');
  const graph = mode === 'demo' ? sample.graph : topology;
  const layout = useMemo(() => graph ? layoutTopology(graph, { familyLimit: 1, childLimit: 2 }) : null, [graph]);
  return <section className="panel network-overview"><SectionHeading title="Agent network" description={graph ? `${graph.summary.sessions} top-level sessions · ${graph.summary.subagents} subagents · ${graph.summary.unresolvedParents} unresolved parents` : 'Your provider connections and recorded agent teams'} action={<button className="text-button" onClick={onOpen}>Open full map <ArrowRight size={14} /></button>} />
    {graph && layout ? <button className="network-overview-map" onClick={onOpen} aria-label="Open agent network graph"><svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={`${graph.summary.sessions} sessions and ${graph.summary.subagents} subagents. Preview of representative families.`}>
      {layout.edges.map(edge => <path key={edge.id} d={edge.path} fill="none" stroke={edge.kind === 'parent-child' ? '#ab98dd' : '#6d697b'} strokeWidth="1.5" strokeDasharray={edge.kind === 'membership' ? '3 6' : undefined} />)}
      {layout.nodes.map(node => <g key={node.id}><rect x={node.x} y={node.y} width={node.width} height={node.height} rx="10" className={`network-preview-node ${node.kind} ${node.provider || ''}`} /><circle cx={node.x + 17} cy={node.y + 26} r="3" fill={node.status === 'running' ? '#8bc8ae' : node.status === 'waiting' ? '#e6bf7c' : '#ac9be6'} /><text x={node.x + 29} y={node.y + 31} className="network-preview-label">{node.kind === 'provider' || node.kind === 'workspace' ? node.label : node.kind === 'missing-parent' ? 'Parent outside scan' : node.kind === 'subagent' ? 'Subagent' : `${node.provider === 'claude' ? 'Claude' : 'Codex'} session`}</text><text x={node.x + 16} y={node.y + 53} className="network-preview-detail">{node.kind === 'provider' ? node.availability === 'connected' ? 'Source logs available' : 'Source unavailable' : node.kind === 'workspace' ? mode === 'demo' ? 'Sample team' : 'Local observation' : node.model ? shortModel(node.model) : 'Parent reference'}</text></g>)}
    </svg></button> : <button className="network-preview-empty" onClick={onOpen}><Network size={26} /><span>{sample.error ? 'Open the map to retry the connection.' : 'Open your agent network'}</span><ArrowRight size={16} /></button>}
    <div className="network-overview-note"><span>{mode === 'demo' ? 'Sample relationships' : 'Native log relationships'} · Representative families{layout?.hiddenCount ? ` · ${layout.hiddenCount} more nodes in the full map` : ''}</span><button className="text-button" onClick={onOpen}>Explore connections <Expand size={12} /></button></div>
  </section>;
}

export function NetworkPage({ mode, sessions, onOpen }: { mode: Mode; sessions: Session[]; onOpen: (session: Session) => void }) {
  const { graph, error, loading, refreshing, refresh } = useTopology(mode);
  const [query, setQuery] = useState(''), [provider, setProvider] = useState('all'), [project, setProject] = useState('all'), [folder, setFolder] = useState('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [includeIdle, setIncludeIdle] = useState(false);
  const [view, setView] = useState<'graph' | 'list'>(() => window.matchMedia('(max-width: 620px) and (orientation: portrait)').matches ? 'list' : 'graph');
  const [familyLimit, setFamilyLimit] = useState(2), [expanded, setExpanded] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null), [zoom, setZoom] = useState(.8);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [locateRequest, setLocateRequest] = useState<string | null>(null);
  const [paused, setPaused] = useState(false), [touchInspect, setTouchInspect] = useState(false);
  const now = useObservationClock();
  const initialFit = useRef(false);
  const filterDisclosure = useRef<HTMLDetailsElement>(null);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const viewport = useRef<HTMLDivElement>(null), nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const dragging = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { setSelectedId(null); setExpanded([]); setFamilyLimit(2); setIncludeIdle(false); setProvider('all'); setProject('all'); setFolder('all'); setQuery(''); setTouchInspect(false); setFocusId(null); setLocateRequest(null); initialFit.current = false; }, [mode]);
  useEffect(() => { if (selectedId && graph && !graph.nodes.some(node => node.id === selectedId)) setSelectedId(null); }, [graph, selectedId]);
  const layout = useMemo(() => graph ? layoutTopology(graph, { query, provider, project, folder, activeOnly, includeIdle, familyLimit, expanded, focusId }) : null, [graph, query, provider, project, folder, activeOnly, includeIdle, familyLimit, expanded, focusId]);
  const canRevealIdle = useMemo(() => !!graph && layout?.matchingRuns === 0 && !includeIdle && !activeOnly && layoutTopology(graph, { query, provider, project, folder, includeIdle: true }).matchingRuns > 0, [graph, layout, includeIdle, activeOnly, query, provider, project, folder]);
  const selected = graph?.nodes.find(node => node.id === selectedId);
  const parentEdge = graph?.edges.find(edge => edge.kind === 'parent-child' && edge.target === selectedId);
  const parent = graph?.nodes.find(node => node.id === parentEdge?.source);
  const children = graph?.edges.filter(edge => edge.kind === 'parent-child' && edge.source === selectedId).map(edge => graph.nodes.find(node => node.id === edge.target)!).filter(Boolean) || [];
  const neighbors = new Set([selectedId, parent?.id, ...children.map(node => node.id)]);
  const stale = graph && graph.dataSource !== 'demo' && now - Date.parse(graph.observedAt) > 120000;
  const motionPaused = paused || reduced || !!error || !!stale;
  const projects = [...new Set(graph?.nodes.map(node => node.project).filter((project): project is string => !!project) || [])].sort();
  const folders = graph?.nodes.filter(node => node.kind === 'folder') || [];
  function locate(id: string) {
    setSelectedId(id); setFocusId(id); setLocateRequest(id); setView('graph');
    initialFit.current = true;
    setZoom(1);
  }
  useEffect(() => {
    if (!locateRequest || view !== 'graph' || !layout || !viewport.current) return;
    const target = layout.nodes.find(node => node.id === locateRequest);
    if (target) {
      const canvas = viewport.current;
      canvas.scrollTo({ left: Math.max(0, (target.x + target.width / 2) * zoom - canvas.clientWidth / 2), top: Math.max(0, (target.y + target.height / 2) * zoom - canvas.clientHeight / 2) });
      nodeRefs.current.get(target.id)?.focus({ preventScroll: true });
      canvas.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
    setLocateRequest(null);
  }, [layout, locateRequest, view, zoom]);
  function changeZoom(next: number) {
    const canvas = viewport.current;
    if (!canvas) return;
    const centerX = (canvas.scrollLeft + canvas.clientWidth / 2) / zoom;
    const centerY = (canvas.scrollTop + canvas.clientHeight / 2) / zoom;
    setZoom(next);
    requestAnimationFrame(() => canvas.scrollTo({ left: centerX * next - canvas.clientWidth / 2, top: centerY * next - canvas.clientHeight / 2 }));
  }
  function fit() {
    if (layout && viewport.current) {
      setZoom(Math.max(.1, Math.min(1, (viewport.current.clientWidth - 28) / layout.width, (viewport.current.clientHeight - 28) / layout.height)));
      viewport.current.scrollTo({ left: 0, top: 0 });
    }
  }
  useEffect(() => {
    if (initialFit.current || !layout || !viewport.current || view !== 'graph') return;
    const { clientWidth, clientHeight } = viewport.current;
    if (!clientWidth || !clientHeight) return;
    setZoom(Math.max(.1, Math.min(.8, (clientWidth - 28) / layout.width, (clientHeight - 28) / layout.height)));
    initialFit.current = true;
  }, [layout, view]);
  const activeFilterCount = Number(!!query.trim()) + Number(provider !== 'all') + Number(folder !== 'all') + Number(project !== 'all') + Number(activeOnly) + Number(includeIdle);
  function returnToEvidence() {
    if (filterDisclosure.current) filterDisclosure.current.open = false;
    document.getElementById('network-evidence-view')?.focus();
  }
  function clearFilters() { setQuery(''); setProvider('all'); setProject('all'); setFolder('all'); setActiveOnly(false); setIncludeIdle(false); setFamilyLimit(2); setExpanded([]); }
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button') || event.button !== 0 || !viewport.current || (event.pointerType !== 'mouse' && !touchInspect)) return;
    event.preventDefault();
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
  function reset() {
    clearFilters(); setSelectedId(null); setFocusId(null); setLocateRequest(null);
    // Refit after the cleared filters produce the next layout, or when graph view returns.
    initialFit.current = false;
    viewport.current?.scrollTo({ left: 0, top: 0 });
  }
  function nodeIcon(node: TopologyNode) {
    if (node.kind === 'workspace') return <AgencyMark small />;
    if (node.kind === 'folder') return <GitBranch size={17} />;
    if (node.kind === 'missing-parent') return <HelpCircle size={19} />;
    return node.provider ? <ProviderMark provider={node.provider} small /> : <GitBranch size={17} />;
  }
  if (loading && !graph) return <div className="loading-state" role="status"><LoaderCircle className="spin" size={28} /><h3>Connecting the dots…</h3><p>Reading provider sources and recorded parent relationships.</p></div>;
  return <div className="network-page">
    {error && <div className="error-banner" role="alert"><HelpCircle size={16} /><span>{error}{graph ? ' Showing the last snapshot with animation stopped.' : ''}</span><button className="text-button" onClick={() => void refresh()}>Retry <RefreshCw size={13} /></button></div>}
    {!graph || !layout ? <section className="panel"><EmptyState title="The network is unavailable" description="Check the local API connection, then refresh the graph." action={<button className="button secondary" onClick={() => void refresh()}>Try again</button>} /></section> : <>
      <div className="network-intro"><div className="network-observation"><span className={error || stale ? 'amber-dot' : 'purple-dot'} /><strong>{graph.dataSource === 'demo' ? 'Sample network' : graph.dataSource === 'fixture' ? 'Staging fixture network' : 'Local agent network'}</strong><span role="status" aria-label="Network freshness">{graph.dataSource === 'demo' ? 'Illustrative agent team' : `${stale ? 'Stale · ' : ''}Observed ${timeAgo(graph.observedAt).toLowerCase()}`} · 10s refresh{graph.coverage.limited ? ' · Partial scan' : ''}{error ? ' · Refresh failed' : ''}</span></div><button className="text-button" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={13} className={refreshing ? 'spin' : ''} />{refreshing ? 'Refreshing…' : 'Refresh graph'}</button></div>
      <div className="network-summary"><div><span className="network-summary-icon"><ShieldCheck size={17} /></span><strong>{graph.sources.filter(source => source.status === 'connected').length}<small>sources available</small></strong></div><div><span className="network-summary-icon"><Network size={18} /></span><strong>{graph.summary.sessions}<small>parent sessions</small></strong></div><div><span className="network-summary-icon"><GitBranch size={17} /></span><strong>{graph.summary.subagents}<small>subagents</small></strong></div><div><span className="network-summary-icon attention"><HelpCircle size={17} /></span><strong>{graph.summary.unresolvedParents}<small>parents outside scan</small></strong></div></div>
      <div className="network-filters">
        <div className="filter-search"><Search size={15} /><input aria-label="Search agent network" placeholder="Find an agent, model, or folder…" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <select aria-label="Network provider" value={provider} onChange={event => setProvider(event.target.value)}><option value="all">Both providers</option><option value="claude">Claude</option><option value="codex">Codex</option></select>
        <details className="network-filter-disclosure" ref={filterDisclosure}><summary>More filters{activeFilterCount > 0 ? ` · ${activeFilterCount} active` : ''}</summary><div className="network-secondary-filters">
          <label>Folder<select aria-label="Network folder" value={folder} onChange={event => setFolder(event.target.value)}><option value="all">All folders</option>{folders.map(item => <option key={item.id} value={item.id}>{item.workingDirectory || item.label}</option>)}</select></label>
          <label>Project<select aria-label="Network project" value={project} onChange={event => setProject(event.target.value)}><option value="all">All projects</option>{projects.map(project => <option key={project} value={project}>{project}</option>)}</select></label>
          <button className={`button secondary network-focus ${activeOnly ? 'selected' : ''}`} aria-pressed={activeOnly} onClick={() => setActiveOnly(!activeOnly)}><Activity size={14} />Working & attention</button>
          <button className={`button secondary network-focus ${includeIdle ? 'selected' : ''}`} aria-pressed={includeIdle} onClick={() => setIncludeIdle(!includeIdle)}>Include idle</button>
          <button className="button secondary" onClick={returnToEvidence}>Apply filters</button>
        </div></details>
        {activeFilterCount > 0 && <button className="text-button" aria-label="Clear network filters" onClick={() => { clearFilters(); returnToEvidence(); }}>Reset filters ({activeFilterCount})</button>}
      </div>
      <div className="network-layout"><section className="panel network-canvas-panel" data-view={view}><div className="network-canvas-toolbar"><div className="view-switch" aria-label="Network view"><button aria-label="Graph view" aria-pressed={view === 'graph'} onClick={() => setView('graph')}><Network size={16} /></button><button aria-label="Hierarchy list view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={16} /></button></div><span className="network-visible-count">{layout.visibleRuns} of {layout.matchingRuns} matching nodes</span><button className="icon-button" aria-label={motionPaused ? 'Resume graph animation' : 'Pause graph animation'} aria-pressed={!motionPaused} disabled={reduced || !!error || !!stale} onClick={() => setPaused(!paused)}>{motionPaused ? <Play size={15} /> : <Pause size={15} />}</button><button className="icon-button" aria-label="Reset network view" onClick={reset}><RefreshCw size={15} /></button></div>
      {view === 'graph' ? <div id="network-evidence-view" className={`network-viewport ${motionPaused ? 'motion-paused' : ''} ${touchInspect ? 'touch-inspection' : ''}`} role="region" aria-label="Agent relationship graph" tabIndex={0} ref={viewport} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}>
        <div className="network-zoom-space" style={{ width: layout.width * zoom, height: layout.height * zoom }}><div className="network-stage" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
          <svg className="network-connections" width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id="network-child-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="context-stroke" strokeWidth="1.7" /></marker></defs>{layout.edges.map(edge => <path key={edge.id} data-edge-kind={edge.kind} data-edge-source={edge.source} data-edge-target={edge.target} markerEnd={edge.kind === 'parent-child' ? 'url(#network-child-arrow)' : undefined} className={`network-edge ${edge.kind} ${edge.evidence === 'missing-parent' ? 'unresolved' : ''} ${edge.animated ? 'is-active' : ''} ${selectedId ? neighbors.has(edge.source) && neighbors.has(edge.target) ? 'is-highlighted' : 'is-muted' : ''}`} d={edge.path} />)}</svg>
          {layout.nodes.map(node => {
            const incoming = graph.edges.find(edge => edge.kind === 'parent-child' && edge.target === node.id);
            const nodeParent = graph.nodes.find(item => item.id === incoming?.source);
            return <button key={node.id} ref={element => { if (element) nodeRefs.current.set(node.id, element); else nodeRefs.current.delete(node.id); }} data-node-kind={node.kind} data-node-id={node.id} className={`network-node ${node.kind} ${node.provider || ''} ${node.status || ''} ${selectedId === node.id ? 'is-selected' : selectedId && neighbors.has(node.id) ? 'is-related' : ''}`} style={{ left: node.x, top: node.y, width: node.width, height: node.height }} onClick={() => setSelectedId(node.id)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); focusRelative(node.id, event.key); } }} aria-pressed={selectedId === node.id} aria-label={`Select ${kindLabel(node)} ${node.label}${node.status ? `, ${statusLabel[node.status]}` : ''}${nodeParent ? `, parent ${nodeParent.label}` : ''}`}>
              <span className="network-node-symbol">{nodeIcon(node)}</span><span className="network-node-copy"><span>{node.label}</span><small>{node.kind === 'provider' ? node.availability === 'connected' ? 'Source logs available' : 'Source unavailable' : node.kind === 'folder' ? node.workingDirectory || 'Working directory not reported' : node.kind === 'workspace' ? 'Your agents, together' : node.kind === 'missing-parent' ? 'Recorded parent not observed' : node.project || node.workingDirectory || 'No folder reported'}</small></span>{node.status && <i className={`network-status-dot ${node.status}`} />}{node.kind === 'subagent' && <span className="network-child-tag">Subagent</span>}
            </button>;
          })}
          {layout.moreGroups.map(group => <button key={group.parentId} className="network-expand" style={{ left: group.x, top: group.y, width: group.width, height: group.height }} onClick={() => setExpanded([...expanded, group.parentId])}><Plus size={13} />Show {group.count} more subagents</button>)}
        </div></div>
      </div> : <div id="network-evidence-view" className="network-list" role="list" tabIndex={-1} aria-label="Agent hierarchy">{layout.nodes.filter(node => ['session', 'subagent', 'missing-parent'].includes(node.kind)).map(node => {
        const incoming = graph.edges.find(edge => edge.kind === 'parent-child' && edge.target === node.id);
        const label = graph.nodes.find(item => item.id === incoming?.source)?.label;
        return <div role="listitem" key={node.id}><button className="network-list-item" onClick={() => setSelectedId(node.id)} aria-pressed={selectedId === node.id}>{nodeIcon(node)}<span><strong>{node.label}</strong><small>{kindLabel(node)}{label ? ` · Parent: ${label}` : ' · No recorded parent'}</small></span>{node.status && <StatusBadge status={node.status} />}<ArrowRight size={14} /></button></div>;
      })}</div>}
      <div className="network-edge-key" aria-label="Relationship key"><span><i className="guide-line" />{folders.length ? 'Folder membership · not parentage' : 'Provider membership · not parentage'}</span><span><i className="guide-line lineage" />Recorded parent → child</span><span><i className="guide-line unresolved" />Parent outside scan</span></div>
      {layout.matchingRuns === 0 && <div className="network-empty"><HelpCircle size={19} /><strong>{canRevealIdle ? 'Idle agents are hidden in this view' : graph.summary.sessions || graph.summary.subagents ? 'No agents match these filters' : 'No agent runs observed yet'}</strong><span>{canRevealIdle ? 'Include idle to show matching retained idle agents. Other filters stay unchanged.' : graph.summary.sessions || graph.summary.subagents ? 'Clear a filter or search to see your team again.' : 'Start Claude Code or Codex locally, then refresh. Source availability is not a live agent connection.'}</span>{canRevealIdle && <button className="button secondary" onClick={() => setIncludeIdle(true)}>Include idle agents</button>}<button className="text-button" onClick={reset}>Reset filters</button></div>}
      {view === "graph" && <div className="network-canvas-footer">{view === 'graph' && <button className="text-button network-touch-inspect" aria-label="Inspect graph with touch" aria-pressed={touchInspect} onClick={() => setTouchInspect(!touchInspect)}>{touchInspect ? 'Finish touch inspection' : 'Inspect graph'}</button>}<span>{reduced ? 'Reduced motion enabled' : motionPaused ? 'Animation paused' : 'Animating reported working paths'}<i /><span className="network-mouse-hint">Drag or scroll to pan</span><span className="network-touch-hint">{touchInspect ? 'Drag to inspect · turn off to scroll page' : 'Scroll page · enable touch inspection to pan'}</span></span><div><button className="icon-button" aria-label="Zoom out" disabled={zoom <= .1} onClick={() => changeZoom(Math.max(.1, +(zoom - .1).toFixed(2)))}><Minus size={14} /></button><output aria-label="Graph zoom">{Math.round(zoom * 100)}%</output><button className="icon-button" aria-label="Zoom in" disabled={zoom >= 1.5} onClick={() => changeZoom(Math.min(1.5, +(zoom + .1).toFixed(2)))}><Plus size={14} /></button><button className="icon-button" aria-label="Fit graph to viewport" onClick={fit}><Maximize2 size={14} /></button></div></div>}
      {layout.hiddenCount > 0 && <div className="network-hidden"><span>{layout.hiddenCount} matching nodes are collapsed to keep the map readable.</span>{layout.hiddenFamilies > 0 && <button className="text-button" onClick={() => setFamilyLimit(familyLimit + 2)}><Expand size={13} />Show more families</button>}</div>}
      </section><aside className="network-inspector panel" aria-label="Agent inspector"><header><span>{selected ? kindLabel(selected) : 'The shape of your team'}</span>{selected && <button className="icon-button" aria-label="Clear selected agent" onClick={() => setSelectedId(null)}><X size={15} /></button>}</header>{selected ? <>
        <div className="network-inspector-symbol">{nodeIcon(selected)}</div><h2>{selected.label}</h2>{selected.status && <StatusBadge status={selected.status} />}<button className="button secondary network-locate" onClick={() => locate(selected.id)}><Maximize2 size={14} />Locate in graph</button>{!layout.nodes.some(node => node.id === selected.id) && focusId === selected.id && <p className="info-note">Selected agent is outside the current filters. Adjust filters to reveal it; idle agents require Include idle.</p>}
        <dl><div><dt>Provider</dt><dd>{selected.provider ? providerLabel(selected.provider) : selected.kind === 'folder' ? 'Folder' : 'Workspace'}</dd></div>{selected.kind === 'provider' && <div><dt>Source availability</dt><dd>{selected.availability === 'connected' ? 'Logs available' : 'Not available'}</dd></div>}{selected.workingDirectory && <div><dt>Working folder</dt><dd>{selected.workingDirectory}</dd></div>}{selected.project && <div><dt>Project</dt><dd>{selected.project}</dd></div>}{selected.model && <div><dt>Last observed model</dt><dd>{shortModel(selected.model)}</dd></div>}{selected.tokens !== undefined && <div><dt>Recorded tokens</dt><dd>{selected.tokens === null ? 'Not reported' : selected.tokens.toLocaleString()}</dd></div>}{selected.updatedAt && <div><dt>Last log timestamp</dt><dd>{timeAgo(selected.updatedAt)}</dd></div>}</dl>
        {parent && <div className="network-parent-info"><span>Reported parent</span><button onClick={() => locate(parent.id)}>{parent.label}<ArrowRight size={13} /></button><small>{parentEdge?.evidence === 'path-parent' ? 'Correlated from native log folder structure' : parent.kind === 'missing-parent' ? 'Native parent reference; parent is outside this scan' : 'Native parent reference in log metadata'}</small></div>}
        {children.length > 0 && <div className="network-children"><h3>{children.length} connected subagent{children.length === 1 ? '' : 's'}</h3>{children.map(child => <button key={child.id} onClick={() => locate(child.id)}><GitBranch size={13} /><span>{child.label}</span><ArrowRight size={12} /></button>)}</div>}
        {selected.kind === 'missing-parent' && <p className="warning-note">This is a reference, not an observed agent. The parent may be outside the scan limit or its log may no longer be available.</p>}
        {selected.sessionId && sessions.some(session => session.id === selected.sessionId) && <button className="button secondary network-open-session" onClick={() => onOpen(sessions.find(session => session.id === selected.sessionId)!)}>Open session details <ArrowRight size={14} /></button>}
        {selected.nativeId && <div className="network-native-id"><span>Native ID</span><code>{selected.nativeId}</code></div>}
      </> : <><span className="network-inspector-hero"><GitBranch size={32} /></span><h2>One workspace.<br />A connected team.</h2><p>Select an agent to inspect its parent, subagents, activity, and usage.</p><div className="network-guide"><span><i className="guide-line" />{folders.length ? 'Folder membership · not parentage' : 'Provider membership · not parentage'}</span><span><i className="guide-line lineage" />Recorded parent → child</span><span><i className="guide-line unresolved" />Parent outside scan</span><span><i className="green-dot" />Recent working activity</span></div><p className="info-note">Source logs being available does not mean an agent is currently connected or running. Activity is inferred from recent logs.</p></>}
      </aside></div>
      <div className="network-evidence"><ShieldCheck size={15} /><span>{graph.dataSource === 'demo' ? 'Sample relationships for exploration. No agents are started from this view.' : `${graph.summary.duplicatesMerged} duplicate logs merged. Links come from native metadata; project membership never implies an agent-to-agent connection.`}</span></div>
      {graph.coverage.notes.length > 0 && <details className="network-coverage"><summary>Data coverage & relationship notes ({graph.coverage.notes.length})</summary><ul>{graph.coverage.notes.map(note => <li key={note}>{note}</li>)}</ul></details>}
    </>}
  </div>;
}
