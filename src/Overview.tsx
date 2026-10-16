import { useEffect, useId, useMemo, useState } from 'react';
import { Activity, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronRight, Clock3, Code2, Folder, Layers3, Plus, Sparkles, Zap } from 'lucide-react';
import { EmptyState, ProviderMark, SectionHeading, SessionCard, TaskRow } from './components';
import { compact, providerLabel, timeAgo, uniqueRuns, type Mode, type Page, type Session, type Task, type UsageReport, type AgentTopology } from './types';
import { UsageDashboard } from './Usage';
import { NetworkOverview } from './NetworkPage';
import { useObservationClock } from './useObservationClock';
import { compareTaskPriority } from './task-view';

export function ActivityChart({ sessions, large = false }: { sessions: Session[]; large?: boolean }) {
  const [period, setPeriod] = useState('7d');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const summaryId = useId();
  const windowNow = useObservationClock();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const buckets = useMemo(() => {
    const now = new Date(windowNow);
    const count = period === '7d' ? 7 : 12;
    const rangeFormat = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    const result = Array.from({ length: count }, (_, index) => {
      let start: Date, end: Date;
      if (period === '7d') {
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (count - 1 - index));
        end = new Date(start);
        end.setDate(end.getDate() + 1);
      } else {
        end = new Date(now.getTime() - (count - 1 - index) * 7200000);
        start = new Date(end.getTime() - 7200000);
      }
      return {
        key: period === '7d' ? start.toISOString() : `${start.toISOString()}/${end.toISOString()}`,
        label: period === '7d' ? start.toLocaleDateString('en', { weekday: 'short' }) : end.toLocaleTimeString('en', { hour: 'numeric', hour12: false }),
        fullLabel: period === '7d' ? `${start.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })} · ${timeZone}` : `${rangeFormat.format(start)} – ${rangeFormat.format(end)} · ${timeZone}`,
        start, end, claude: 0, codex: 0,
      };
    });
    for (const session of sessions) {
      const started = Date.parse(session.startedAt);
      const index = result.findIndex(bucket => started <= now.getTime() && (period === '7d' ? started >= bucket.start.getTime() && started < bucket.end.getTime() : started > bucket.start.getTime() && started <= bucket.end.getTime()));
      if (index !== -1) result[index][session.provider]++;
    }
    return result;
  }, [sessions, period, timeZone, windowNow]);
  const keys = buckets.map(bucket => bucket.key).join(',');
  useEffect(() => {
    if (selectedKey && !keys.split(',').includes(selectedKey)) {
      setSelectedKey(null);
      setHoveredKey(null);
      setNotice('The selected date or time interval changed with the chart window. Selection cleared.');
    }
  }, [keys, selectedKey]);
  const selected = buckets.find(bucket => bucket.key === (hoveredKey || selectedKey));
  const max = Math.max(4, ...buckets.map(bucket => bucket.claude + bucket.codex));
  const ticks = [max, Math.round(max * 0.75), Math.round(max * 0.5), Math.round(max * 0.25), 0];
  const total = buckets.reduce((sum, bucket) => sum + bucket.claude + bucket.codex, 0);
  const summary = `${total} log files in the ${period === '7d' ? 'last 7 calendar days' : 'last 24 hours'}. ${buckets.map(bucket => `${bucket.fullLabel}: Claude ${bucket.claude}, Codex ${bucket.codex}`).join('; ')}`;
  function reset() { setSelectedKey(null); setHoveredKey(null); setNotice('Selection cleared.'); }
  function select(key: string) { setSelectedKey(key); setHoveredKey(null); setNotice(''); }
  return <section className={`panel chart-panel ${large ? 'large' : ''}`} onKeyDown={event => { if (event.key === 'Escape') reset(); }}>
    <SectionHeading title="Observed log starts" description={`Log files by their first recorded timestamp, including subagents and copies · ${timeZone}`} action={<select aria-label="Activity chart period" className="compact-select" value={period} onChange={event => { setPeriod(event.target.value); reset(); }}><option value="7d">Last 7 days</option><option value="24h">Last 24 hours</option></select>} />
    <div className="chart-topline"><strong>{total}<span> logs</span></strong><div className="chart-legend"><span><i className="claude-dot" />Claude</span><span><i className="codex-dot" />Codex</span></div></div>
    <p className="sr-only" id={summaryId}>{summary}</p>
    <div className="chart" role="group" aria-label="Observed log starts by date" aria-describedby={summaryId} data-period={period} tabIndex={period === '24h' ? 0 : undefined}>
      <div className="chart-axis" aria-hidden="true">{ticks.map((number, index) => <span key={index}>{number}</span>)}</div>
      <div className="chart-plot"><div className="chart-lines" aria-hidden="true">{ticks.map((_, index) => <i key={index} />)}</div><div className="chart-bars">{buckets.map(bucket => <button type="button" className={`chart-column ${selected?.key === bucket.key ? 'highlight' : ''}`} key={bucket.key} aria-pressed={selectedKey === bucket.key} aria-label={`${bucket.fullLabel}: Claude ${bucket.claude}, Codex ${bucket.codex} log starts`} onFocus={() => select(bucket.key)} onClick={() => select(bucket.key)} onMouseEnter={() => setHoveredKey(bucket.key)} onMouseLeave={() => setHoveredKey(null)}>
        <span className="stack" aria-hidden="true"><span className="bar-codex" style={{ height: `${bucket.codex / max * 100}%` }} /><span className="bar-claude" style={{ height: `${bucket.claude / max * 100}%` }} /></span><span className="chart-day">{bucket.label}</span>
      </button>)}</div></div>
    </div>
    <div className="chart-selection" role="region" aria-label="Activity date details" aria-live="polite">{selected ? <><strong>{selected.fullLabel}</strong><dl className="chart-selection-details"><div><dt>Claude: </dt><dd>{selected.claude} log starts</dd></div><div><dt>Codex: </dt><dd>{selected.codex} log starts</dd></div></dl></> : <p>{notice || 'Select a date for exact log starts.'}</p>}<button className="text-button chart-reset" aria-label="Reset activity selection" onClick={reset}>Reset selection</button></div>
    <details className="chart-data"><summary>View activity data</summary><div className="usage-table-scroll" role="region" aria-label="Activity data table" tabIndex={0}><table className="sessions-table"><caption>Observed log starts · {timeZone}</caption><thead><tr><th scope="col">Date or time range</th><th scope="col">Claude</th><th scope="col">Codex</th><th scope="col">Total log starts</th></tr></thead><tbody>{buckets.map(bucket => <tr key={bucket.key}><th scope="row">{bucket.fullLabel}</th><td>{bucket.claude}</td><td>{bucket.codex}</td><td>{bucket.claude + bucket.codex}</td></tr>)}</tbody></table></div></details>
  </section>;
}

type ActivityRange = 'all' | '1h' | '24h' | '7d' | '30d';
export function ActivityFeed({ sessions, onOpen, full = false, query = '', provider = 'all', kind = 'all', range = 'all', now = Date.now(), scopeLabel = 'the current workspace', scopeNote = 'Only currently loaded, retained events are searched, with at most 100 matches displayed. Agency retains a bounded recent event list per loaded session; this is not complete history or live process activity.' }: { sessions: Session[]; onOpen: (s: Session) => void; full?: boolean; query?: string; provider?: string; kind?: string; range?: ActivityRange; now?: number; scopeLabel?: string; scopeNote?: string }) {
  const retained = sessions.flatMap(s => s.events.map(e => ({ ...e, session: s })));
  const baseEvents = retained.filter(e => (provider === 'all' || e.session.provider === provider) && (kind === 'all' || e.kind === kind) && `${e.label} ${e.session.title} ${e.session.project} ${e.session.name || ''}`.toLowerCase().includes(query.toLowerCase()))
    .map((event, index) => ({ event, index, timestamp: Date.parse(event.timestamp) }))
    .sort((a, b) => {
      const aKnown = Number.isFinite(a.timestamp), bKnown = Number.isFinite(b.timestamp);
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (aKnown && bKnown && a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
      return a.index - b.index;
    })
    .map(({ event }) => event);
  const durations: Record<Exclude<ActivityRange, 'all'>, number> = { '1h': 60 * 60_000, '24h': 24 * 60 * 60_000, '7d': 7 * 24 * 60 * 60_000, '30d': 30 * 24 * 60 * 60_000 };
  const unknownTimestamps = range === 'all' ? 0 : baseEvents.filter(e => !Number.isFinite(Date.parse(e.timestamp))).length;
  const events = range === 'all' ? baseEvents : baseEvents.filter(e => {
    const timestamp = Date.parse(e.timestamp);
    return Number.isFinite(timestamp) && timestamp >= now - durations[range] && timestamp <= now;
  });
  const displayed = events.slice(0, full ? 100 : 6);
  if (!full && !displayed.length) return <EmptyState title="A quiet moment" description="Session activity will appear here as your agents work." />;
  return <>
    {full && <><p className="field-help" role="status" aria-label="Activity result counts">Showing {displayed.length} of {events.length} matching events · {retained.length} retained supported events in {scopeLabel}{range !== 'all' ? ` · ${unknownTimestamps} matching events with unknown timestamps (excluded)` : ''}</p><p className="field-help">{scopeNote}</p></>}
    {!displayed.length ? <EmptyState title={retained.length ? 'No activity matches' : 'No retained activity'} description={retained.length ? (kind !== 'all' || range !== 'all' ? 'Reset activity filters or try another search, provider, event type, or time range.' : 'Reset activity filters or try another search or provider.') : `No supported events are retained in ${scopeLabel}. This does not establish that no agent activity occurred.`} /> : <div className={`activity-feed ${full ? 'full' : ''}`}>{displayed.map((event, index) => {
    const eventTimestamp = Date.parse(event.timestamp);
    const eventTimeLabel = Number.isFinite(eventTimestamp) ? timeAgo(event.timestamp) : 'Timestamp not reported';
    return <button className="activity-item" key={`${event.session.id}-${event.id}`} onClick={() => onOpen(event.session)}>
    <span className={`feed-icon ${event.kind}`}>{event.kind === 'success' ? <Check size={14} /> : event.kind === 'tool' ? <Code2 size={14} /> : event.kind === 'waiting' ? <Clock3 size={14} /> : <Zap size={14} />}</span>
    <span className="feed-copy"><span><strong>{event.session.name || providerLabel(event.session.provider)}</strong> {event.label.toLowerCase()}</span><small><span className={`provider-text ${event.session.provider}`}>{providerLabel(event.session.provider)}</span><i />{event.session.project}</small><time>{eventTimeLabel}</time></span>
    {full && <ArrowUpRight size={15} className="muted" />}{index < displayed.length - 1 && <i className="feed-line" />}
  </button>;
  })}</div>}
  </>;
}

export function Overview({ sessions, tasks, usage, topology, mode, observed, attentionKnown, attention, onAttention, onOpen, navigate, newTask, toggleTask, editTask, busyTask, connect }: {
  sessions: Session[]; tasks: Task[]; usage: UsageReport | undefined; topology: AgentTopology | undefined; mode: Mode; onOpen: (s: Session) => void; navigate: (p: Page) => void;
  observed: boolean; attentionKnown: boolean; attention: Session[]; onAttention: () => void;
  newTask: () => void; toggleTask: (task: Task) => void; editTask: (task: Task) => void; busyTask: string; connect: () => void;
}) {
  const runs = uniqueRuns(sessions);
  const active = runs.filter(s => s.status === 'running' || s.status === 'waiting' || s.status === 'error');
  const today = new Date().toISOString().slice(0, 10);
  const todaySessions = runs.filter(s => s.updatedAt.slice(0, 10) === today);
  const completed = todaySessions.filter(s => s.status === 'completed').length;
  const tokens = usage?.daily.find(day => day.day === today)?.totalTokens ?? null;
  const projects = new Set(sessions.map(s => s.project));
  const topTasks = tasks.filter(t => t.status !== 'done').sort((a, b) => Number(b.status === 'in_progress') - Number(a.status === 'in_progress') || compareTaskPriority(a, b)).slice(0, 4);
  const done = tasks.filter(t => t.status === 'done').length;
  return <>
    <div className="summary-grid">
      <div className="summary-item"><span className="summary-label">Runs in focus <span className="stat-icon purple"><Layers3 size={16} /></span></span><div className="summary-value">{observed ? active.length : '—'}<span className="stat-context">{observed ? <><i className="green-dot" />{runs.filter(s => s.status === 'running').length} working</> : 'Unavailable'}</span></div><span className="summary-note">{observed ? `Across ${projects.size} project${projects.size !== 1 ? 's' : ''}` : 'No session observation'}</span></div>
      <div className="summary-item"><span className="summary-label">Completed runs today <span className="stat-icon green"><CheckCheck size={17} /></span></span><div className="summary-value">{observed ? completed : '—'}<span className={`stat-context ${observed ? 'positive' : ''}`}>{observed ? 'Latest turn finished' : 'Unavailable'}</span></div><span className="summary-note">UTC · within observed logs</span></div>
      <button className="summary-item usage-summary-button" onClick={() => navigate('insights')}><span className="summary-label">Recorded tokens today <span className="stat-icon blue"><Zap size={16} /></span></span><div className="summary-value">{compact(tokens)}<span className="stat-context">recorded</span></div><span className="summary-note">UTC · deduplicated · see usage <ArrowUpRight size={12} /></span></button>
      <button className="summary-item attention-summary" disabled={!observed} onClick={onAttention}><span className="summary-label">Needs your attention <span className="stat-icon amber"><Clock3 size={17} /></span></span><div className="summary-value">{attention.length || attentionKnown ? attention.length : '—'}<span className="stat-context amber-text">{!attentionKnown ? observed ? 'Unconfirmed' : 'Unavailable' : attention.length ? 'A quick look' : 'All clear'}</span></div><span className="summary-note">{!attentionKnown ? observed ? 'Observation may be stale, failed, or partial' : 'No session observation' : attention.length ? 'View all attention items' : 'Nothing waiting for you'}<ArrowUpRight size={13} /></span></button>
    </div>
    {attention.length > 0 && <section className="panel attention-preview">
      <SectionHeading title="Needs attention" count={attention.length} description={mode === 'demo' ? 'Sample review items' : !attentionKnown ? 'Retained attention items · freshness or source coverage is uncertain. Review source context in Attention.' : 'Detected log errors · native approvals stay in Claude and Codex'} action={<button className="text-button" onClick={onAttention}>View all <ArrowRight size={14} /></button>} />
      <div className="attention-preview-list">{attention.slice(0, 3).map(session => <button key={session.id} onClick={() => onOpen(session)}><ProviderMark provider={session.provider} small /><span><strong>{session.title}</strong><small>{session.project} · {session.status === 'error' ? 'Error detected' : 'Needs review'}</small></span><ArrowUpRight size={14} /></button>)}</div>
    </section>}
    <div className="overview-columns"><div className="overview-main">
      <section className="agents-section"><SectionHeading title="In the loop" count={observed ? active.length : undefined} description="A little teamwork. A lot of forward motion." action={<button className="text-button" onClick={() => navigate('agents')}>All agents <ArrowRight size={14} /></button>} />
        {!observed ? <div className="panel"><EmptyState title="Session data unavailable" description="No session observation has loaded. Retry the session update to inspect activity." /></div> : active.length ? <div className="agent-grid">{active.slice(0, 4).map(session => <SessionCard key={session.id} session={session} mode={mode} onOpen={() => onOpen(session)} />)}</div> : <div className="panel"><EmptyState title={sessions.length ? 'Your agents are taking a breather' : 'Your workspace starts here'} description={sessions.length ? 'Recent sessions are in the Agents view. Start work in Claude or Codex and it will appear here.' : 'Run Claude Code or Codex on this computer. Agency reads their local session logs automatically.'} action={<button className="button secondary" onClick={() => navigate('agents')}>Explore sessions <ArrowRight size={15} /></button>} /></div>}
      </section>
      <section className="panel tasks-preview"><SectionHeading title="On your radar" count={tasks.filter(t => t.status !== 'done').length} description="In progress first, then priority and oldest created" action={<button className="text-button" onClick={() => navigate('tasks')}>View board <ArrowRight size={14} /></button>} />
        {topTasks.length ? <div className="task-rows">{topTasks.map(task => <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task)} onEdit={() => editTask(task)} busy={busyTask === task.id} />)}</div> : <div className="small-empty">{tasks.length ? 'Everything is checked off. Nice work.' : 'Make room for your next idea.'}</div>}
        <button className="add-task-row" onClick={newTask}><Plus size={15} />Add a task <span>N</span></button>
      </section>
      {observed && <><NetworkOverview mode={mode} topology={topology} onOpen={() => navigate('network')} /><ActivityChart sessions={sessions} /></>}
    </div><aside className="overview-rail">
      <section className="panel workspace-pulse"><div className="pulse-heading"><span className="pulse-icon"><Sparkles size={16} /></span>Workspace pulse<span className="tiny-dot" /></div><div className="orbit-scene" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-center"><span className="orbit-asterisk">✳</span></div><span className="orbit-agent orbit-claude"><ProviderMark provider="claude" small /></span><span className="orbit-agent orbit-codex"><ProviderMark provider="codex" small /></span><span className="orbit-pip pip-one" /><span className="orbit-pip pip-two" /><span className="orbit-pip pip-three" /></div>
        <h3>{!observed ? 'Waiting for an observation.' : active.length ? 'Good things are in motion.' : 'Ready when you are.'}</h3><p>{active.length ? `${active.length} sessions in focus. One place to keep a clear head.` : 'Your agents and ideas, together in one workspace.'}</p><div className="pulse-footer"><span><i className={mode === 'demo' ? 'purple-dot' : observed ? 'green-dot' : 'quiet-dot'} />{mode === 'demo' ? 'Sample workspace' : observed ? 'Local observation' : 'No session observation'}</span><span>{mode === 'demo' ? 'Demo' : '10s refresh'}</span></div>
      </section>
      <section className="panel recent-activity"><SectionHeading title="Recent activity" action={<span className="activity-ping"><Activity size={14} /></span>} />{observed ? <ActivityFeed sessions={sessions} onOpen={onOpen} /> : <p className="usage-unavailable">Session activity is unavailable.</p>}<button className="rail-link" onClick={() => navigate('activity')}>View all activity <ChevronRight size={14} /></button></section>
      <section className="task-progress-panel"><div className="progress-icon"><CheckCheck size={19} /></div><div><strong>Small steps add up.</strong><p>{done} of {tasks.length} tasks completed</p></div><div className="task-progress-track"><span style={{ width: `${tasks.length ? done / tasks.length * 100 : 0}%` }} /></div><span className="progress-note">A little closer to done.</span></section>
    </aside></div>
    {mode === 'demo' && <div className="demo-bottom"><span><span className="demo-pill">Demo</span>You’re exploring a sample workspace. Your real agents are a click away.</span><button className="text-button" onClick={connect}>Connect local agents <ArrowUpRight size={14} /></button></div>}
  </>;
}

export function Insights({ sessions, tasks, usage, mode, observedAt, onOpen }: { sessions: Session[]; tasks: Task[]; usage: UsageReport | undefined; mode: Mode; observedAt: string; onOpen: (session: Session) => void }) {
  const projectNames = [...new Set(sessions.map(s => s.project))];
  return <><UsageDashboard report={usage} sessions={sessions} mode={mode} observedAt={observedAt} onOpen={onOpen} /><div className="insights-layout"><ActivityChart sessions={sessions} large /><section className="panel project-panel"><SectionHeading title="Project overview" count={projectNames.length} />{projectNames.length ? <div className="project-list">{projectNames.map(project => <div className="project-row" key={project}><span className="project-icon"><Folder size={18} /></span><div><strong>{project}</strong><span>{sessions.filter(s => s.project === project).length} observed runs</span></div><span>{sessions.filter(s => s.project === project && s.kind === 'subagent').length} subagents</span></div>)}</div> : <EmptyState title="No projects yet" description="Projects are discovered from agent session logs." />}</section><section className="panel completion-panel"><SectionHeading title="Task progress" /><div className="completion-number">{tasks.filter(t => t.status === 'done').length}<span> / {tasks.length}</span></div><p className="muted">Tasks completed in this workspace</p><div className="completion-statuses">{(['todo', 'in_progress', 'done'] as const).map((status, i) => <div key={status}><span className={['purple-dot', 'amber-dot', 'green-dot'][i]} /><span>{['To do', 'In progress', 'Done'][i]}</span><strong>{tasks.filter(t => t.status === status).length}</strong></div>)}</div></section></div></>;
}
