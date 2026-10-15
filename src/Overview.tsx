import { useMemo, useState } from 'react';
import { Activity, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronRight, Clock3, Code2, Folder, Layers3, Plus, Sparkles, Zap } from 'lucide-react';
import { EmptyState, ProviderMark, SectionHeading, SessionCard, TaskRow } from './components';
import { compact, providerLabel, timeAgo, uniqueRuns, type Mode, type Page, type Session, type Task, type UsageReport } from './types';
import { UsageDashboard } from './Usage';

export function ActivityChart({ sessions, large = false }: { sessions: Session[]; large?: boolean }) {
  const [period, setPeriod] = useState('7d');
  const [hovered, setHovered] = useState<number | null>(null);
  const buckets = useMemo(() => {
    const count = period === '7d' ? 7 : 12;
    const step = period === '7d' ? 86400000 : 7200000;
    const end = new Date();
    if (period === '7d') end.setHours(23, 59, 59, 999);
    const result = Array.from({ length: count }, (_, i) => {
      const date = new Date(end.getTime() - (count - 1 - i) * step);
      return { label: period === '7d' ? date.toLocaleDateString('en', { weekday: 'short' }) : date.toLocaleTimeString('en', { hour: 'numeric', hour12: false }), date, claude: 0, codex: 0 };
    });
    for (const session of sessions) {
      const started = Date.parse(session.startedAt);
      const index = result.findIndex(b => started <= b.date.getTime() && started > b.date.getTime() - step);
      if (index !== -1) result[index][session.provider]++;
    }
    return result;
  }, [sessions, period]);
  const max = Math.max(4, ...buckets.map(b => b.claude + b.codex));
  const ticks = [max, Math.round(max * 0.75), Math.round(max * 0.5), Math.round(max * 0.25), 0];
  const total = buckets.reduce((sum, b) => sum + b.claude + b.codex, 0);
  return <section className={`panel chart-panel ${large ? 'large' : ''}`}>
    <SectionHeading title="Observed log starts" description="Log files by their first recorded timestamp, including subagents and copies" action={<select aria-label="Activity chart period" className="compact-select" value={period} onChange={e => { setPeriod(e.target.value); setHovered(null); }}><option value="7d">Last 7 days</option><option value="24h">Last 24 hours</option></select>} />
    <div className="chart-topline"><strong>{total}<span> logs</span></strong><div className="chart-legend"><span><i className="claude-dot" />Claude</span><span><i className="codex-dot" />Codex</span></div></div>
    <div className="chart" role="img" aria-label={`${total} log files in the ${period === '7d' ? 'last 7 days' : 'last 24 hours'}. ${buckets.map(b => `${b.label}: Claude ${b.claude}, Codex ${b.codex}`).join('; ')}`}>
      <div className="chart-axis">{ticks.map((n, i) => <span key={i}>{n}</span>)}</div>
      <div className="chart-plot"><div className="chart-lines">{ticks.map((_, i) => <i key={i} />)}</div><div className="chart-bars">{buckets.map((bucket, i) => <div className={`chart-column ${hovered === i ? 'highlight' : ''}`} key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
        {hovered === i && <div className="chart-tooltip">{bucket.claude} Claude · {bucket.codex} Codex</div>}
        <div className="stack"><div className="bar-codex" style={{ height: `${bucket.codex / max * 100}%` }} /><div className="bar-claude" style={{ height: `${bucket.claude / max * 100}%` }} /></div><span className="chart-day">{bucket.label}</span>
      </div>)}</div></div>
    </div>
  </section>;
}

export function ActivityFeed({ sessions, onOpen, full = false, query = '', provider = 'all' }: { sessions: Session[]; onOpen: (s: Session) => void; full?: boolean; query?: string; provider?: string }) {
  const events = sessions.flatMap(s => s.events.map(e => ({ ...e, session: s }))).filter(e => (provider === 'all' || e.session.provider === provider) && `${e.label} ${e.session.title} ${e.session.project} ${e.session.name || ''}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const displayed = events.slice(0, full ? 100 : 6);
  if (!displayed.length) return <EmptyState title="A quiet moment" description="Session activity will appear here as your agents work." />;
  return <div className={`activity-feed ${full ? 'full' : ''}`}>{displayed.map((event, index) => <button className="activity-item" key={`${event.session.id}-${event.id}`} onClick={() => onOpen(event.session)}>
    <span className={`feed-icon ${event.kind}`}>{event.kind === 'success' ? <Check size={14} /> : event.kind === 'tool' ? <Code2 size={14} /> : event.kind === 'waiting' ? <Clock3 size={14} /> : <Zap size={14} />}</span>
    <span className="feed-copy"><span><strong>{event.session.name || providerLabel(event.session.provider)}</strong> {event.label.toLowerCase()}</span><small><span className={`provider-text ${event.session.provider}`}>{providerLabel(event.session.provider)}</span><i />{event.session.project}</small><time>{timeAgo(event.timestamp)}</time></span>
    {full && <ArrowUpRight size={15} className="muted" />}{index < displayed.length - 1 && <i className="feed-line" />}
  </button>)}</div>;
}

export function Overview({ sessions, tasks, usage, mode, onOpen, navigate, newTask, toggleTask, editTask, busyTask, connect }: {
  sessions: Session[]; tasks: Task[]; usage: UsageReport | undefined; mode: Mode; onOpen: (s: Session) => void; navigate: (p: Page) => void;
  newTask: () => void; toggleTask: (task: Task) => void; editTask: (task: Task) => void; busyTask: string; connect: () => void;
}) {
  const runs = uniqueRuns(sessions);
  const active = runs.filter(s => s.status === 'running' || s.status === 'waiting' || s.status === 'error');
  const attention = runs.filter(s => s.status === 'waiting' || s.status === 'error');
  const today = new Date().toISOString().slice(0, 10);
  const todaySessions = runs.filter(s => s.updatedAt.slice(0, 10) === today);
  const completed = todaySessions.filter(s => s.status === 'completed').length;
  const tokens = usage?.daily.find(day => day.day === today)?.totalTokens ?? null;
  const projects = new Set(sessions.map(s => s.project));
  const topTasks = tasks.filter(t => t.status !== 'done').slice(0, 4);
  const done = tasks.filter(t => t.status === 'done').length;
  return <>
    <div className="summary-grid">
      <div className="summary-item"><span className="summary-label">Runs in focus <span className="stat-icon purple"><Layers3 size={16} /></span></span><div className="summary-value">{active.length}<span className="stat-context"><i className="green-dot" />{sessions.filter(s => s.status === 'running').length} working</span></div><span className="summary-note">Across {projects.size} project{projects.size !== 1 ? 's' : ''}</span></div>
      <div className="summary-item"><span className="summary-label">Completed runs today <span className="stat-icon green"><CheckCheck size={17} /></span></span><div className="summary-value">{completed}<span className="stat-context positive">Latest turn finished</span></div><span className="summary-note">UTC · within observed logs</span></div>
      <button className="summary-item usage-summary-button" onClick={() => navigate('insights')}><span className="summary-label">Recorded tokens today <span className="stat-icon blue"><Zap size={16} /></span></span><div className="summary-value">{compact(tokens)}<span className="stat-context">recorded</span></div><span className="summary-note">UTC · deduplicated · see usage <ArrowUpRight size={12} /></span></button>
      <button className="summary-item attention-summary" onClick={() => attention.length ? onOpen(attention[0]) : navigate('agents')}><span className="summary-label">Needs your attention <span className="stat-icon amber"><Clock3 size={17} /></span></span><div className="summary-value">{attention.length}<span className="stat-context amber-text">{attention.length ? 'A quick look' : 'All clear'}</span></div><span className="summary-note">{attention.length ? 'Your agents could use a hand' : 'Nothing waiting for you'}<ArrowUpRight size={13} /></span></button>
    </div>
    <div className="overview-columns"><div className="overview-main">
      <section className="agents-section"><SectionHeading title="In the loop" count={active.length} description="A little teamwork. A lot of forward motion." action={<button className="text-button" onClick={() => navigate('agents')}>All agents <ArrowRight size={14} /></button>} />
        {active.length ? <div className="agent-grid">{active.slice(0, 4).map(session => <SessionCard key={session.id} session={session} mode={mode} onOpen={() => onOpen(session)} />)}</div> : <div className="panel"><EmptyState title={sessions.length ? 'Your agents are taking a breather' : 'Your workspace starts here'} description={sessions.length ? 'Recent sessions are in the Agents view. Start work in Claude or Codex and it will appear here.' : 'Run Claude Code or Codex on this computer. Agency reads their local session logs automatically.'} action={<button className="button secondary" onClick={() => navigate('agents')}>Explore sessions <ArrowRight size={15} /></button>} /></div>}
      </section>
      <ActivityChart sessions={sessions} />
      <section className="panel tasks-preview"><SectionHeading title="On your radar" count={tasks.filter(t => t.status !== 'done').length} action={<button className="text-button" onClick={() => navigate('tasks')}>View board <ArrowRight size={14} /></button>} />
        {topTasks.length ? <div className="task-rows">{topTasks.map(task => <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task)} onEdit={() => editTask(task)} busy={busyTask === task.id} />)}</div> : <div className="small-empty">{tasks.length ? 'Everything is checked off. Nice work.' : 'Make room for your next idea.'}</div>}
        <button className="add-task-row" onClick={newTask}><Plus size={15} />Add a task <span>N</span></button>
      </section>
    </div><aside className="overview-rail">
      <section className="panel workspace-pulse"><div className="pulse-heading"><span className="pulse-icon"><Sparkles size={16} /></span>Workspace pulse<span className="tiny-dot" /></div><div className="orbit-scene" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-center"><span className="orbit-asterisk">✳</span></div><span className="orbit-agent orbit-claude"><ProviderMark provider="claude" small /></span><span className="orbit-agent orbit-codex"><ProviderMark provider="codex" small /></span><span className="orbit-pip pip-one" /><span className="orbit-pip pip-two" /><span className="orbit-pip pip-three" /></div>
        <h3>{active.length ? 'Good things are in motion.' : 'Ready when you are.'}</h3><p>{active.length ? `${active.length} sessions in focus. One place to keep a clear head.` : 'Your agents and ideas, together in one workspace.'}</p><div className="pulse-footer"><span><i className={mode === 'demo' ? 'purple-dot' : 'green-dot'} />{mode === 'demo' ? 'Sample workspace' : 'Local observation'}</span><span>{mode === 'demo' ? 'Demo' : '10s refresh'}</span></div>
      </section>
      <section className="panel recent-activity"><SectionHeading title="Recent activity" action={<span className="activity-ping"><Activity size={14} /></span>} /><ActivityFeed sessions={sessions} onOpen={onOpen} /><button className="rail-link" onClick={() => navigate('activity')}>View all activity <ChevronRight size={14} /></button></section>
      <section className="task-progress-panel"><div className="progress-icon"><CheckCheck size={19} /></div><div><strong>Small steps add up.</strong><p>{done} of {tasks.length} tasks completed</p></div><div className="task-progress-track"><span style={{ width: `${tasks.length ? done / tasks.length * 100 : 0}%` }} /></div><span className="progress-note">A little closer to done.</span></section>
    </aside></div>
    {mode === 'demo' && <div className="demo-bottom"><span><span className="demo-pill">Demo</span>You’re exploring a sample workspace. Your real agents are a click away.</span><button className="text-button" onClick={connect}>Connect local agents <ArrowUpRight size={14} /></button></div>}
  </>;
}

export function Insights({ sessions, tasks, usage, mode, onOpen }: { sessions: Session[]; tasks: Task[]; usage: UsageReport | undefined; mode: Mode; onOpen: (session: Session) => void }) {
  const projectNames = [...new Set(sessions.map(s => s.project))];
  return <><UsageDashboard report={usage} sessions={sessions} mode={mode} onOpen={onOpen} /><div className="insights-layout"><ActivityChart sessions={sessions} large /><section className="panel project-panel"><SectionHeading title="Project overview" count={projectNames.length} />{projectNames.length ? <div className="project-list">{projectNames.map(project => <div className="project-row" key={project}><span className="project-icon"><Folder size={18} /></span><div><strong>{project}</strong><span>{sessions.filter(s => s.project === project).length} observed runs</span></div><span>{sessions.filter(s => s.project === project && s.kind === 'subagent').length} subagents</span></div>)}</div> : <EmptyState title="No projects yet" description="Projects are discovered from agent session logs." />}</section><section className="panel completion-panel"><SectionHeading title="Task progress" /><div className="completion-number">{tasks.filter(t => t.status === 'done').length}<span> / {tasks.length}</span></div><p className="muted">Tasks completed in this workspace</p><div className="completion-statuses">{(['todo', 'in_progress', 'done'] as const).map((status, i) => <div key={status}><span className={['purple-dot', 'amber-dot', 'green-dot'][i]} /><span>{['To do', 'In progress', 'Done'][i]}</span><strong>{tasks.filter(t => t.status === status).length}</strong></div>)}</div></section></div></>;
}
