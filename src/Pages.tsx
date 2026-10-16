import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Folder, Info, LayoutGrid, Link2, List, LoaderCircle, Plus, RefreshCw, Search, Terminal, Trash2 } from 'lucide-react';
import { EmptyState, ProviderMark, SectionHeading, SessionCard, StatusBadge } from './components';
import { ActivityFeed } from './Overview';
import { taskBackup } from './task-backup';
import { useObservationClock } from './useObservationClock';
import { utcTime } from './usage-view';
import { compareTaskPriority, compareTaskRecent } from './task-view';
import { readPreference, writePreference } from './useWorkspace';
import { compact, providerLabel, taskStatusLabel, timeAgo, type Mode, type Provider, type Session, type Source, type Task, type TaskStatus } from './types';

function connectionSummary(source: Source) {
  if (source.status === 'not_found') return 'Session directory not found. Compare this path with the directory used by your CLI account.';
  if (source.status !== 'connected') return 'Session directory could not be read. Check permissions.';
  return `${source.count} observed logs${source.sessionCount !== undefined ? ` · ${source.sessionCount} unique sessions · ${source.subagentCount ?? 0} subagents` : ''}${source.limited ? ' · scan limit reached' : ''}`;
}

function FilterBar({ query, setQuery, provider, setProvider, placeholder, children }: { query: string; setQuery: (q: string) => void; provider: string; setProvider: (p: string) => void; placeholder: string; children?: React.ReactNode }) {
  return <div className="filter-bar"><div className="filter-search"><Search size={16} /><input aria-label={placeholder} placeholder={placeholder} value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="text-button" onClick={() => setQuery('')}>Clear</button>}</div><select aria-label="Filter by provider" value={provider} onChange={e => setProvider(e.target.value)}><option value="all">All providers</option><option value="claude">Claude</option><option value="codex">Codex</option></select>{children}</div>;
}

export function AgentsPage({ sessions, mode, sessionObserved, onOpen, onOpenSettings }: { sessions: Session[]; mode: Mode; sessionObserved: boolean; onOpen: (s: Session) => void; onOpenSettings: () => void }) {
  const [query, setQuery] = useState('');
  const [preferences, setPreferences] = useState(() => {
    let saved: Record<string, unknown> = {};
    try {
      const value: unknown = JSON.parse(readPreference(`agents.${mode}`, '{}'));
      if (value && typeof value === 'object' && !Array.isArray(value)) saved = value as Record<string, unknown>;
    } catch { /* Invalid saved preferences fall back to usable defaults. */ }
    return {
      provider: typeof saved.provider === 'string' && ['all', 'claude', 'codex'].includes(saved.provider) ? saved.provider : 'all',
      status: typeof saved.status === 'string' && ['all', 'active', 'completed', 'idle'].includes(saved.status) ? saved.status : 'all',
      layout: typeof saved.layout === 'string' && ['grid', 'list'].includes(saved.layout) ? saved.layout : 'grid',
    };
  });
  const [preferenceError, setPreferenceError] = useState('');
  const { provider, status, layout } = preferences;
  function updatePreferences(next: typeof preferences) {
    setPreferences(next);
    setPreferenceError(writePreference(`agents.${mode}`, JSON.stringify(next)) ? '' : 'Browser storage is unavailable. Agent filters and view work for this visit but will not be remembered.');
  }
  function setProvider(value: string) { updatePreferences({ ...preferences, provider: value }); }
  function setStatus(value: string) { updatePreferences({ ...preferences, status: value }); }
  function setLayout(value: string) { updatePreferences({ ...preferences, layout: value }); }
  function resetFilters() { setQuery(''); updatePreferences({ provider: 'all', status: 'all', layout: 'grid' }); }
  const filtered = sessions.filter(s => (provider === 'all' || s.provider === provider) && (status === 'all' || (status === 'active' ? ['running', 'waiting', 'error'].includes(s.status) : s.status === status)) && `${s.title} ${s.name || ''} ${s.project} ${s.model}`.toLowerCase().includes(query.toLowerCase()));
  return <><FilterBar query={query} setQuery={setQuery} provider={provider} setProvider={setProvider} placeholder="Search agents, sessions, projects…"><div className="view-switch" aria-label="Session layout"><button aria-label="Grid view" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><LayoutGrid size={16} /></button><button aria-label="List view" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List size={17} /></button></div></FilterBar><div className="tabs" role="group" aria-label="Session status">{[['all', 'All sessions'], ['active', 'Active'], ['completed', 'Completed'], ['idle', 'Idle']].map(([value, label]) => <button key={value} aria-pressed={status === value} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{label}<span>{sessions.filter(s => value === 'all' || (value === 'active' ? ['running', 'waiting', 'error'].includes(s.status) : s.status === value)).length}</span></button>)}</div>
    <div className="page-footnote" role="region" aria-label="Active agent filters"><span>Provider: {provider === 'all' ? 'All providers' : providerLabel(provider as Provider)} · Status: {({ all: 'All sessions', active: 'Active', completed: 'Completed', idle: 'Idle' } as Record<string, string>)[status]} · View: {layout === 'grid' ? 'Grid' : 'List'}{query ? ' · Search active' : ''}<br />{mode === 'demo' ? 'Sample sessions for exploring Agency. Switch to Local workspace to see your own.' : 'Observing up to 100 recent logs per provider. Status comes from log activity, not process monitoring.'}</span><button className="text-button" onClick={resetFilters}>Reset filters</button></div>
    {preferenceError && <p className="info-note" role="status">{preferenceError}</p>}
    {!filtered.length ? <div className="panel"><EmptyState title={sessions.length ? 'No sessions match' : 'Meet your next pair of hands'} description={sessions.length ? 'Try another search or choose a different filter.' : 'No sessions are available in this workspace. In Local workspace, check Settings to compare the configured source with your CLI account.'} action={mode === 'local' && sessionObserved && !sessions.length ? <button className="button secondary" onClick={onOpenSettings}>Check source settings</button> : undefined} /></div> : layout === 'grid' ? <div className="all-agents-grid">{filtered.map(session => <SessionCard key={session.id} session={session} mode={mode} onOpen={() => onOpen(session)} />)}</div> : <section className="panel sessions-table-wrap"><table className="sessions-table"><thead><tr><th>Agent / session</th><th>Project</th><th>Status</th><th>Tokens</th><th>Updated</th></tr></thead><tbody>{filtered.map(s => <tr key={s.id}><td><button className="table-session" onClick={() => onOpen(s)}><ProviderMark provider={s.provider} small /><span><strong>{s.name || providerLabel(s.provider)}</strong><small>{s.title}</small></span></button></td><td>{s.project}</td><td><StatusBadge status={s.status} /></td><td>{compact(s.tokens)}</td><td>{timeAgo(s.updatedAt)}</td></tr>)}</tbody></table></section>}
  </>;
}

export function TasksPage({ tasks, sessions, onOpen, newTask, editTask, moveTask, busyTask }: { tasks: Task[]; sessions: Session[]; onOpen: (session: Session) => void; newTask: (status?: TaskStatus) => void; editTask: (task: Task) => void; moveTask: (task: Task, status: TaskStatus) => void; busyTask: string }) {
  const [query, setQuery] = useState(''), [provider, setProvider] = useState('all');
  const [priority, setPriority] = useState('all'), [sort, setSort] = useState('stored');
  const filtered = tasks.filter(t => (provider === 'all' || t.provider === provider) && (priority === 'all' || t.priority === priority) && `${t.title} ${t.project} ${t.description}`.toLowerCase().includes(query.toLowerCase()));
  if (sort !== 'stored') filtered.sort(sort === 'priority' ? compareTaskPriority : compareTaskRecent);
  const hasFilters = Boolean(query || provider !== 'all' || priority !== 'all');
  return <>
    <FilterBar query={query} setQuery={setQuery} provider={provider} setProvider={setProvider} placeholder="Find a task…">
      <select aria-label="Task priority" value={priority} onChange={event => setPriority(event.target.value)}><option value="all">All priorities</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select>
      <select aria-label="Task ordering" value={sort} onChange={event => setSort(event.target.value)}><option value="stored">Stored order</option><option value="priority">Priority: high first</option><option value="recent">Recently updated</option></select>
      {(hasFilters || sort !== 'stored') && <button className="text-button" onClick={() => { setQuery(''); setProvider('all'); setPriority('all'); setSort('stored'); }}>Reset task filters</button>}
      <span className="filter-count">{filtered.length} task{filtered.length !== 1 ? 's' : ''}</span>
    </FilterBar>
    <div className="kanban-board">{(['todo', 'in_progress', 'done'] as TaskStatus[]).map(status => <section className={`kanban-column ${status}`} key={status}>
      <header><span><i />{taskStatusLabel[status]}<b>{filtered.filter(t => t.status === status).length}</b></span><button className="icon-button" aria-label={`Add ${taskStatusLabel[status].toLowerCase()} task`} onClick={() => newTask(status)}><Plus size={17} /></button></header>
      <div className="kanban-tasks">{filtered.filter(t => t.status === status).map(task => {
        const linked = sessions.find(session => session.id === task.sessionId && session.provider === task.provider);
        return <article className="kanban-task" key={task.id}>
          <div className="kanban-top"><span className={`priority ${task.priority}`}><i />{task.priority}</span><button className="text-button" aria-label={`Edit ${task.title}`} onClick={() => editTask(task)}><ArrowUpRight size={16} /></button></div>
          <button className="kanban-title" onClick={() => editTask(task)}>{task.title}</button>{task.description && <p>{task.description}</p>}
          <span className="session-project"><Folder size={13} />{task.project || 'No project'}</span>
          {task.sessionId && (linked ? <button className="task-session-link" onClick={() => onOpen(linked)} aria-label={`Open linked session for ${task.title}`}><Link2 size={13} /><span>Linked session</span><ArrowUpRight size={12} /></button> : <span className="task-session-unavailable"><Link2 size={13} />Linked session outside current scan</span>)}
          <div className="kanban-footer"><span><ProviderMark provider={task.provider} small />{providerLabel(task.provider)}</span><label className="status-select"><span className="sr-only">Status of {task.title}</span><select value={task.status} disabled={busyTask === task.id} onChange={e => moveTask(task, e.target.value as TaskStatus)}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select>{busyTask === task.id ? <LoaderCircle size={12} className="spin" /> : <ChevronDown size={12} />}</label></div>
        </article>;
      })}{!filtered.some(t => t.status === status) && <div className="column-empty"><Check size={19} /><span>{hasFilters ? 'No matching tasks' : status === 'done' ? 'Good things take small steps.' : 'Room for your next idea.'}</span></div>}<button className="kanban-add" onClick={() => newTask(status)}><Plus size={15} />Add task</button></div>
    </section>)}</div>
    <p className="page-footnote"><Info size={13} />Your board is a plan for your agents. Creating or moving a task does not execute it.</p>
  </>;
}

export function ActivityPage({ sessions, onOpen }: { sessions: Session[]; onOpen: (s: Session) => void }) {
  const [query, setQuery] = useState(''), [provider, setProvider] = useState('all');
  return <><FilterBar query={query} setQuery={setQuery} provider={provider} setProvider={setProvider} placeholder="Search activity…" /><section className="panel activity-page-panel"><SectionHeading title="The story so far" description="Most recent supported events from your agent sessions" /><ActivityFeed sessions={sessions} onOpen={onOpen} full query={query} provider={provider} /></section><p className="page-footnote"><Info size={13} />Up to 100 events displayed. Open a session to see its recent history.</p></>;
}

export function SettingsPage({ mode, setMode, sources, scannedAt, tasks, tasksReadAt, tasksUpdatedAt, taskError, refreshing, refresh, theme, setTheme, resetDemo, notify }: {
  mode: Mode; setMode: (mode: Mode) => void; sources: Source[]; scannedAt: string; refreshing: boolean; refresh: () => void;
  theme: string; setTheme: (theme: string) => void; resetDemo: () => void; notify: (message: string) => void;
  tasks: Task[]; tasksReadAt: string; tasksUpdatedAt: string; taskError: string;
}) {
  const [resetConfirm, setResetConfirm] = useState(false);
  function downloadTasks() {
    if (mode === 'local' && !tasksReadAt) return;
    try {
      const url = URL.createObjectURL(new Blob([taskBackup(tasks, mode, tasksReadAt, tasksUpdatedAt, Boolean(taskError))], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = `agency-tasks-${mode}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { notify('Task download could not be prepared. Try again.'); }
  }
  const now = useObservationClock(mode === 'local');
  const observation = Date.parse(scannedAt);
  const ageMinutes = Math.max(0, Math.floor((now - observation) / 60000));
  return <div className="settings-layout"><section className="panel settings-section"><SectionHeading title="Your workspace" description="Choose where Agency gets its information." /><div className="source-picker">{(['demo', 'local'] as const).map(value => <button key={value} className={mode === value ? 'selected' : ''} aria-pressed={mode === value} onClick={() => setMode(value)}><span className="source-choice-icon">{value === 'demo' ? <LayoutGrid size={22} /> : <Terminal size={22} />}</span><strong>{value === 'demo' ? 'Demo workspace' : 'Local workspace'}</strong><p>{value === 'demo' ? 'Explore sample agents and try the task board. Tasks stay in this browser.' : 'Discover your Claude and Codex sessions. Tasks stay on this computer.'}</p><span className="radio-dot" /></button>)}</div><p className="info-note">Local discovery reads session metadata from this computer. Your logs stay on this computer. Agency never modifies native agent files or installs hooks.</p></section>
    <section className="panel settings-section" aria-label="Task backup">
      <SectionHeading title="Download task backup" description={mode === 'demo' ? 'Demo tasks from this browser only.' : 'Last confirmed local task state held in this browser.'} />
      <p className="info-note">The JSON download contains task titles, descriptions, project labels, and session references. It excludes unconfirmed writes. This browser snapshot is not an atomic disk backup; no import or restore is provided.</p>
      {mode === 'local' && <p className="info-note">{tasksReadAt ? <>Last successful task read: <time dateTime={tasksReadAt}>{new Date(tasksReadAt).toLocaleString()}</time>. Last confirmed update: <time dateTime={tasksUpdatedAt}>{new Date(tasksUpdatedAt).toLocaleString()}</time>. {taskError ? 'Task refresh failed; the retained snapshot is stale.' : 'The snapshot may exclude changes made after the last confirmed update.'}</> : 'Tasks have not been successfully read. Check connections before downloading.'}</p>}
      <button type="button" className="button secondary" disabled={mode === 'local' && !tasksReadAt} onClick={downloadTasks}>Download task JSON</button>
    </section>
    <section className="panel settings-section" aria-label="Agent connections">
      <SectionHeading title="Agent connections" description="No API keys. Just your local session logs." action={<button className="button secondary small-button" disabled={refreshing || mode !== 'local'} onClick={refresh}><RefreshCw size={14} className={refreshing ? 'spin' : ''} />{refreshing ? 'Checking…' : 'Check connections'}</button>} />
      {mode === 'demo' ? <p className="info-note">Demo workspace uses sample sessions. Select Local workspace above to inspect this server's source paths and connection observations.</p> : <>
        <p className="info-note">Snapshot observed: {Number.isFinite(observation) ? <time dateTime={scannedAt}>{utcTime(scannedAt)} · {ageMinutes < 1 ? 'less than 1 minute ago' : `${ageMinutes} minutes ago`}</time> : 'Not yet observed'}. This is when Agency checked the logs, not when an agent last worked.</p>
        {(['claude', 'codex'] as Provider[]).map(provider => {
          const source = sources.find(s => s.provider === provider);
          return <div className="connection-row" key={provider}>
            <ProviderMark provider={provider} />
            <div className="connection-copy">
              <strong>{providerLabel(provider)}{provider === 'claude' ? ' Code' : ''}</strong>
              <span>{source?.path || 'Resolved source path not yet observed'}</span>
              <p>{!source ? 'No connection observation for this provider. Check connections to read the server’s configured source.' : connectionSummary(source)}</p>
              {source?.warnings.map(w => <p className="amber-text" key={w}>{w}</p>)}
              <details>
                <summary>Missing expected {providerLabel(provider)} sessions?</summary>
                <p>Connected means the configured directory can be read. It does not confirm that your CLI writes there, that an expected session was scanned, or that a process is running.</p>
                <p>Compare the source path above with the directory used by the account running your CLI. A readable directory can belong to a different account; missing or old observations alone do not establish a mismatch.</p>
                <p>{provider === 'codex' ? <>The server uses <code>AGENCY_CODEX_ROOT</code> first, otherwise <code>CODEX_HOME/sessions</code> when <code>CODEX_HOME</code> is set, otherwise <code>~/.codex/sessions</code> under the server account.</> : <>The server uses <code>AGENCY_CLAUDE_ROOT</code> first, otherwise <code>~/.claude/projects</code> under the server account.</>}</p>
                <p>If the account or source environment is wrong, correct it before starting the server, restart Agency, then choose Check connections. This page does not change source paths or switch accounts.</p>
                <p>Visible Local workspace tabs check every 10 seconds. Scans are bounded; warnings above describe observed limits. Session activity is inferred from supported logs, not live process monitoring.</p>
              </details>
            </div>
            <span className={`connection-state ${source?.status === 'connected' ? 'connected' : ''}`}><i />{!source ? 'Not checked' : source.status === 'connected' ? 'Connected' : source.status === 'not_found' ? 'Not found' : 'Error'}</span>
          </div>;
        })}
      </>}
    </section>
    <section className="panel settings-section"><SectionHeading title="Make yourself at home" /><div className="setting-row"><div><strong>Appearance</strong><p>A little easier on the eyes.</p></div><select aria-label="Appearance" value={theme} onChange={e => setTheme(e.target.value)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></div><div className="setting-row"><div><strong>Keyboard shortcuts</strong><p>Move around without breaking your flow.</p></div><div className="shortcut-list"><span>Search <kbd>Ctrl K</kbd></span><span>New task <kbd>N</kbd></span><span>Close dialog <kbd>Esc</kbd></span></div></div></section>
    <section className="panel settings-section"><SectionHeading title="About Agency" description="A calmer workspace for your Claude and Codex agents." /><p className="settings-about">Inspired by the observable agent workspaces in AgentGUI and the unified workflow of FounderOS. Built as an independent local app.</p><div className="reference-links"><a href="https://agent-gui-project.github.io/" target="_blank" rel="noreferrer">AgentGUI <ArrowUpRight size={14} /></a><a href="https://founderos.sh/" target="_blank" rel="noreferrer">FounderOS <ArrowUpRight size={14} /></a></div><p className="info-note">This version observes sessions and organizes tasks. Agent commands, native approvals, and billing remain in their original tools. Token totals are not cost estimates.</p><div className="setting-row"><div><strong>Reset demo tasks</strong><p>Restore the sample board. Local workspace tasks are preserved.</p></div>{resetConfirm ? <div className="inline-actions"><button className="button secondary small-button" onClick={() => setResetConfirm(false)}>Cancel</button><button className="button danger small-button" onClick={() => { try { resetDemo(); notify('Demo task board restored'); setResetConfirm(false); } catch (e) { notify((e as Error).message); } }}>Reset demo</button></div> : <button className="button secondary small-button" onClick={() => setResetConfirm(true)}><Trash2 size={14} />Reset demo</button>}</div></section>
    {mode === 'demo' && <button className="button primary settings-connect" onClick={() => { setMode('local'); notify('Switched to your local workspace'); }}>Connect local agents <ArrowRight size={16} /></button>}
  </div>;
}
