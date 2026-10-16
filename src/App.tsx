import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, Bell, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, Command, Cpu, ExternalLink, FolderKanban, LayoutDashboard, ListTodo, LoaderCircle, Menu, Moon, Network, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Sun, X, type LucideIcon } from 'lucide-react';
import { AgencyMark, EmptyState, Modal, ProviderMark, SessionDetail } from './components';
import { Overview, Insights } from './Overview';
import { ActivityPage, AgentsPage, SettingsPage, TasksPage } from './Pages';
import { TaskEditor } from './TaskEditor';
import { ProjectsPage } from './Projects';
import { NetworkPage } from './NetworkPage';
import { useWorkspace } from './useWorkspace';
import { useTheme } from './useTheme';
import { useObservationClock } from './useObservationClock';
import { providerLabel, uniqueRuns, type Page, type Session, type Task, type TaskInput, type TaskStatus } from './types';

const navigation: { id: Page; label: string; icon: LucideIcon; description: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, description: 'The big picture, without the noise.' },
  { id: 'network', label: 'Agent network', icon: Network, description: 'A connected view of your agents and the teams they create.' },
  { id: 'agents', label: 'Agents', icon: Cpu, description: 'Your extra pairs of hands, all in one place.' },
  { id: 'projects', label: 'Projects', icon: FolderKanban, description: 'Every project, with its agents and next steps.' },
  { id: 'tasks', label: 'Task board', icon: ListTodo, description: 'Good work starts with a little direction.' },
  { id: 'activity', label: 'Activity', icon: Activity, description: 'Follow the thread of your agents’ work.' },
  { id: 'insights', label: 'Usage & insights', icon: Sparkles, description: 'Recorded usage, provider limits, and the work behind them.' },
];
const allPages = [...navigation, { id: 'settings' as Page, label: 'Settings', icon: Settings2, description: 'A workspace that feels like yours.' }];
function pageFromHash(): Page {
  const hash = window.location.hash.slice(1);
  return allPages.some(p => p.id === hash) ? hash as Page : 'overview';
}

export default function App() {
  const workspace = useWorkspace();
  const [page, setPage] = useState<Page>(pageFromHash);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [selected, setSelected] = useState<Session | null>(null);
  const [editor, setEditor] = useState<{ task?: Task; initial?: Partial<TaskInput> } | null>(null);
  const [busyTask, setBusyTask] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const currentPage = allPages.find(p => p.id === page)!;
  const active = uniqueRuns(workspace.sessions).filter(s => ['running', 'waiting', 'error'].includes(s.status));
  const observed = workspace.mode === 'demo' || Number.isFinite(Date.parse(workspace.scannedAt));
  const attention = uniqueRuns(workspace.sessions).filter(s => ['waiting', 'error'].includes(s.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 5500);
  }, []);
  const { appearance, theme, setTheme } = useTheme(notify);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  const navigate = useCallback((target: Page) => {
    setPage(target); window.location.hash = target;
    setSidebarOpen(false); setWorkspaceMenu(false); setCommandOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
  }, []);
  useEffect(() => {
    function change() { setPage(pageFromHash()); }
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    if (!sidebarOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector<HTMLElement>('.sidebar-close')?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const controls = [...(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') || [])].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    function resize() { if (window.innerWidth > 800) setSidebarOpen(false); }
    document.addEventListener('keydown', trap);
    window.addEventListener('resize', resize);
    return () => { document.body.style.overflow = scroll; previous?.focus(); document.removeEventListener('keydown', trap); window.removeEventListener('resize', resize); };
  }, [sidebarOpen]);
  useEffect(() => { document.title = `${currentPage.label} · Agency`; }, [currentPage.label]);
  useEffect(() => {
    function outside(event: MouseEvent) { if (!workspaceMenuRef.current?.contains(event.target as Node)) setWorkspaceMenu(false); }
    document.addEventListener('click', outside);
    return () => document.removeEventListener('click', outside);
  }, []);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
      if (event.key === 'Escape') { setWorkspaceMenu(false); setSidebarOpen(false); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !editor && !selected && !notificationsOpen) { event.preventDefault(); setCommandOpen(value => !value); setCommandQuery(''); }
      if (event.key.toLowerCase() === 'n' && !editing && !event.ctrlKey && !event.metaKey && !event.altKey && !commandOpen && !editor && !selected && !notificationsOpen) { event.preventDefault(); setEditor({}); }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [editor, selected, notificationsOpen, commandOpen]);
  function newTask(status: TaskStatus = 'todo') { setEditor({ initial: { status } }); }
  async function changeTask(task: Task, status: TaskStatus) {
    if (busyTask) return;
    setBusyTask(task.id);
    try { await workspace.saveTask({ ...task, status }, task); notify(status === 'done' ? 'Task completed. One step closer.' : 'Task updated'); }
    catch (e) { notify((e as Error).message); }
    finally { setBusyTask(''); }
  }
  function connectLocal() { workspace.setMode('local'); navigate('settings'); notify('Discovering your local Claude and Codex sessions'); }
  const search = commandQuery.toLowerCase().trim();
  const matchingPages = allPages.filter(p => `${p.label} ${p.description}`.toLowerCase().includes(search));
  const matchingSessions = workspace.sessions.filter(s => `${s.name || ''} ${s.title} ${s.project} ${providerLabel(s.provider)}`.toLowerCase().includes(search)).slice(0, 5);
  const matchingTasks = workspace.tasks.filter(t => `${t.title} ${t.project}`.toLowerCase().includes(search)).slice(0, 4);

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a>
    {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Main navigation" ref={sidebarRef}>
      <a href="#overview" className="brand" onClick={event => { event.preventDefault(); navigate('overview'); }}><AgencyMark /><span>agency<span className="brand-period">.</span></span><span className="brand-beta">BETA</span></a>
      <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={19} /></button>
      <div className="workspace-switcher" ref={workspaceMenuRef}><button className="workspace-button" aria-expanded={workspaceMenu} aria-controls="workspace-menu" onClick={() => setWorkspaceMenu(!workspaceMenu)}><span className="workspace-avatar">M<span /></span><span><strong>My workspace</strong><small>{workspace.mode === 'demo' ? 'Demo workspace' : 'Local workspace'}</small></span><ChevronDown size={15} /></button>{workspaceMenu && <div className="workspace-menu" id="workspace-menu">{(['demo', 'local'] as const).map(mode => <button key={mode} onClick={() => { workspace.setMode(mode); setWorkspaceMenu(false); }}><span>{mode === 'demo' ? 'Demo workspace' : 'Local workspace'}<small>{mode === 'demo' ? 'Explore sample data' : 'Your agents on this computer'}</small></span>{workspace.mode === mode && <Check size={16} />}</button>)}</div>}</div>
      <button className="sidebar-search" onClick={() => { setCommandOpen(true); setCommandQuery(''); }}><Search size={15} /><span>Quick search</span><kbd>⌘ K</kbd></button>
      <span className="nav-group-label">Workspace</span>
      <nav>{navigation.map(item => <a key={item.id} href={`#${item.id}`} onClick={event => { event.preventDefault(); navigate(item.id); }} aria-current={page === item.id ? 'page' : undefined} className={`nav-item ${page === item.id ? 'active' : ''}`}><item.icon size={18} /><span>{item.label}</span>{item.id === 'agents' && <span className="nav-count">{active.length}</span>}{item.id === 'tasks' && <span className="nav-task-dot" />}</a>)}</nav>
      <div className="sidebar-providers"><span className="nav-group-label">Your agents</span>{(['claude', 'codex'] as const).map(provider => <button className="sidebar-provider" key={provider} onClick={() => { const session = workspace.sessions.find(s => s.provider === provider && s.status === 'running') || workspace.sessions.find(s => s.provider === provider); if (session) setSelected(session); else navigate('settings'); }}><ProviderMark provider={provider} small /><span>{providerLabel(provider)}{provider === 'claude' ? ' Code' : ''}</span><span className={workspace.sessions.some(s => s.provider === provider && s.status === 'running') ? 'green-dot' : 'quiet-dot'} /></button>)}</div>
      <div className="sidebar-bottom"><div className="local-card"><span className="local-icon"><ShieldCheck size={17} /></span><strong>Your space. Your data.</strong><p>Built to stay on your machine.</p><button onClick={() => navigate('settings')}>Workspace settings <ArrowUpRight size={13} /></button></div><a className={`nav-item ${page === 'settings' ? 'active' : ''}`} href="#settings" onClick={event => { event.preventDefault(); navigate('settings'); }} aria-current={page === 'settings' ? 'page' : undefined}><Settings2 size={18} /><span>Settings</span></a><a className="nav-item muted" href="https://github.com/eth-medical-ai-lab/agent-gui" target="_blank" rel="noreferrer"><BookOpen size={17} /><span>Inspiration & resources</span><ExternalLink size={12} /></a><div className="sidebar-user"><span className="user-avatar">ME</span><div><strong>Personal workspace</strong><span>Just you and your agents</span></div><span className="user-status" /></div></div>
    </aside>
    <div className="app-body" inert={sidebarOpen || undefined}><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><span className="breadcrumb-home"><LayoutDashboard size={15} />Workspace</span><ChevronRight size={13} /><strong>{currentPage.label}</strong></div><div className="topbar-actions"><span className={`connection-indicator ${workspace.mode}`}><i />{workspace.mode === 'demo' ? 'Demo workspace' : workspace.error ? 'Connection issue' : workspace.loading ? 'Discovering…' : 'Local workspace'}</span><span className="topbar-divider" /><button className="icon-button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button><button className="icon-button notification-button" aria-label={`Notifications${attention.length ? `, ${attention.length} need attention` : ''}`} onClick={() => setNotificationsOpen(true)}><Bell size={18} />{attention.length > 0 && <i />}</button><button className="topbar-avatar" aria-label="Workspace settings" onClick={() => navigate('settings')}>ME</button></div></header>
      <main className="page-content" id="main-content" ref={mainRef} tabIndex={-1}><div className="page-heading"><div><div className="page-kicker"><span className="purple-dot" />{new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}</div><h1>{page === 'overview' ? 'Your agents, in sync' : currentPage.label}<span className="heading-dot">.</span></h1><p>{currentPage.description}</p></div><div className="heading-actions">{workspace.mode === 'local' && <button className="icon-button refresh-button" disabled={workspace.refreshing} aria-label="Refresh workspace" onClick={() => void workspace.refresh()}><RefreshCw size={17} className={workspace.refreshing ? 'spin' : ''} /></button>}<button className="button primary new-task-button" aria-label="New task" onClick={() => newTask()}><Plus size={17} />New task<kbd aria-hidden="true">N</kbd></button></div></div>
        <WorkspaceFreshness workspace={workspace} />
        {(workspace.error || workspace.storageError) && <div className="error-banner" role="alert"><InfoSymbol /><span>{workspace.error || workspace.storageError}</span>{workspace.error && <button className="text-button" onClick={() => void workspace.refresh()}>Retry <RefreshCw size={13} /></button>}</div>}
        {workspace.mode === 'local' && workspace.sources.some(s => s.limited || s.warnings.length) && <div className="warning-banner"><InfoSymbol /><span>Some session history is partial or unreadable. Check Settings for connection details.</span><button className="text-button" onClick={() => navigate('settings')}>Details <ArrowRight size={13} /></button></div>}
        {workspace.loading && !workspace.sessions.length ? <div className="loading-state" role="status"><LoaderCircle size={27} className="spin" /><h3>Getting the workspace together…</h3><p>Reading your local agent session metadata.</p></div> : <>
          {page === 'overview' && <Overview sessions={workspace.sessions} tasks={workspace.tasks} usage={workspace.usage} topology={workspace.topology} mode={workspace.mode} observed={observed} attention={attention} onAttention={() => setNotificationsOpen(true)} onOpen={setSelected} navigate={navigate} newTask={() => newTask()} toggleTask={task => void changeTask(task, task.status === 'done' ? 'todo' : 'done')} editTask={task => setEditor({ task })} busyTask={busyTask} connect={connectLocal} />}
          {page === 'agents' && <AgentsPage key={workspace.mode} sessionObserved={observed && !workspace.sessionError} sessions={workspace.sessions} mode={workspace.mode} onOpen={setSelected} onOpenSettings={() => navigate('settings')} />}
          {page === 'network' && <NetworkPage mode={workspace.mode} sessions={workspace.sessions} onOpen={setSelected} />}
          {page === 'projects' && <ProjectsPage key={workspace.mode} sessions={workspace.sessions} tasks={workspace.tasks} mode={workspace.mode} onOpen={setSelected} newTask={project => setEditor({ initial: { project } })} editTask={task => setEditor({ task })} toggleTask={task => void changeTask(task, task.status === 'done' ? 'todo' : 'done')} busyTask={busyTask} />}
          {page === 'tasks' && <TasksPage tasks={workspace.tasks} sessions={workspace.sessions} onOpen={setSelected} newTask={newTask} editTask={task => setEditor({ task })} moveTask={(task, status) => void changeTask(task, status)} busyTask={busyTask} />}
          {page === 'activity' && <ActivityPage sessions={workspace.sessions} onOpen={setSelected} />}
          {page === 'insights' && <Insights sessions={workspace.sessions} tasks={workspace.tasks} usage={workspace.usage} mode={workspace.mode} observedAt={workspace.scannedAt} onOpen={setSelected} />}
          {page === 'settings' && <SettingsPage tasks={workspace.tasks} tasksReadAt={workspace.tasksReadAt} tasksUpdatedAt={workspace.tasksUpdatedAt} taskError={workspace.taskError} mode={workspace.mode} setMode={workspace.setMode} sources={workspace.sources} scannedAt={workspace.scannedAt} refreshing={workspace.refreshing} refresh={() => void workspace.refresh()} theme={appearance} setTheme={setTheme} resetDemo={workspace.resetDemo} notify={notify} />}
        </>}
        <footer className="page-footer"><span><AgencyMark small />A little more clarity. A little less tab-switching.</span><span>Agency v1.0<span className="footer-dot">·</span>{workspace.mode === 'demo' ? 'Sample data' : workspace.scannedAt ? `Scanned ${new Date(workspace.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Local only'}</span></footer>
      </main>
    </div>
    {selected && <SessionDetail session={workspace.sessions.find(s => s.id === selected.id) || selected} tasks={workspace.tasks} mode={workspace.mode} onClose={() => setSelected(null)} onEditTask={task => { setSelected(null); setEditor({ task }); }} onCreateTask={() => { setEditor({ initial: { title: `Follow up: ${selected.title}`.slice(0, 160), project: selected.project, provider: selected.provider, sessionId: selected.id } }); setSelected(null); }} />}
    {editor && <TaskEditor {...editor} onReload={(task, signal) => workspace.reloadTask(task.id, signal)} sessions={workspace.sessions} mode={workspace.mode} onClose={() => setEditor(null)} onSave={async (input, task) => { await workspace.saveTask(input, task); notify(task ? 'Task updated' : 'Task created. Give that idea a home.'); }} onDelete={async task => { await workspace.deleteTask(task); notify('Task deleted'); }} />}
    {notificationsOpen && <Modal title="A little heads-up" onClose={() => setNotificationsOpen(false)} className="notification-modal"><p className="form-intro">{workspace.mode === 'demo' ? 'Sample attention items from the demo workspace.' : 'Errors detected in the most recent session logs.'}</p>{attention.length ? <div className="notification-list">{attention.map(s => <button key={s.id} onClick={() => { setNotificationsOpen(false); setSelected(s); }}><ProviderMark provider={s.provider} /><span><strong>{s.name || providerLabel(s.provider)}</strong><span>{s.status === 'waiting' ? 'Ready for your review' : 'An error needs a closer look'}</span><small>{s.title}</small></span><ArrowUpRight size={17} /></button>)}</div> : <EmptyState title={observed ? 'You’re all caught up' : 'Session data unavailable'} description={observed ? 'No attention items were found in your sessions.' : 'Session logs have not been observed yet, so attention status is unknown.'} />}<div className="notification-note"><CheckCheck size={16} />Native approvals stay in Claude and Codex.</div></Modal>}
    {commandOpen && <Modal title="Find your way" className="command-modal" onClose={() => setCommandOpen(false)}><div className="command-search"><Search size={20} /><input data-autofocus autoFocus aria-label="Search workspace" placeholder="Search agents, tasks, or jump to a page…" value={commandQuery} onChange={e => setCommandQuery(e.target.value)} /></div><div className="command-results">{matchingPages.length > 0 && <div className="command-group"><span>Go to</span>{matchingPages.map(item => <button key={item.id} onClick={() => navigate(item.id)}><item.icon size={17} /><span>{item.label}</span><ArrowDownLeft size={14} /></button>)}</div>}{search && matchingSessions.length > 0 && <div className="command-group"><span>Sessions</span>{matchingSessions.map(s => <button key={s.id} onClick={() => { setCommandOpen(false); setSelected(s); }}><ProviderMark provider={s.provider} small /><span>{s.title}<small>{s.project}</small></span><ArrowUpRight size={14} /></button>)}</div>}{search && matchingTasks.length > 0 && <div className="command-group"><span>Tasks</span>{matchingTasks.map(task => <button key={task.id} onClick={() => { setCommandOpen(false); setEditor({ task }); }}><ListTodo size={17} /><span>{task.title}</span><ArrowUpRight size={14} /></button>)}</div>}{search && !matchingPages.length && !matchingSessions.length && !matchingTasks.length && <EmptyState title="Nothing found just yet" description="Try an agent name, project, task title, or page." />}</div><div className="command-footer"><Command size={13} /><span>Your workspace, a few keystrokes away.</span><kbd>Esc to close</kbd></div></Modal>}
    {toast && <div className="toast" role="status"><span className="toast-icon"><Check size={14} /></span><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15} /></button></div>}
  </div>;
}

function InfoSymbol() { return <span className="info-symbol" aria-hidden="true">!</span>; }

function WorkspaceFreshness({ workspace }: { workspace: ReturnType<typeof useWorkspace> }) {
  const now = useObservationClock(workspace.mode === 'local');
  if (workspace.mode !== 'local') return null;
  const observed = Date.parse(workspace.scannedAt);
  const hasObservation = Number.isFinite(observed);
  const age = hasObservation ? Math.max(0, now - observed) : 0;
  const partial = workspace.sources.some(source => source.limited || source.warnings.length || source.status !== 'connected');
  const state = !hasObservation ? 'unavailable' : age > 120000 ? 'stale' : workspace.sessionError ? 'error' : partial ? 'partial' : 'current';
  const label = { unavailable: workspace.sessionError ? 'Session data unavailable' : 'Reading session logs…', stale: 'Stale observation', error: 'Session update failed', partial: 'Partial observation', current: 'Observed' }[state];
  function ago(timestamp: number) {
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
  }
  return <section className="workspace-freshness" aria-label="Workspace data freshness" data-state={state} data-tasks-state={workspace.taskError ? 'error' : workspace.tasksUpdatedAt ? 'current' : 'unavailable'}>
    <span className="freshness-observation"><i aria-hidden="true" /><strong>{label}</strong>{hasObservation && <time dateTime={workspace.scannedAt} title={new Date(observed).toLocaleString()}> · {ago(observed)}</time>}</span>
    <span>Checks every 10s while visible</span>
    <span className={workspace.taskError ? 'freshness-task-error' : ''}>{workspace.taskError ? 'Task update failed' : workspace.tasksUpdatedAt ? `Tasks updated ${ago(Date.parse(workspace.tasksUpdatedAt))}` : 'Tasks not yet available'}</span>
    {hasObservation && workspace.sessionError && <span>Showing the last session observation</span>}
  </section>;
}
