import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Folder, Info, Plus, Search } from 'lucide-react';
import { EmptyState, ProviderMark, SectionHeading, SessionCard, TaskRow } from './components';
import { compact, timeAgo, type Mode, type Session, type Task } from './types';

const label = (name: string) => name.trim() || 'Unassigned';
const active = (session: Session) => ['running', 'waiting', 'error'].includes(session.status);

export function ProjectsPage({ sessions, tasks, mode, onOpen, newTask, editTask, toggleTask, busyTask }: {
  sessions: Session[]; tasks: Task[]; mode: Mode; onOpen: (session: Session) => void;
  newTask: (project: string) => void; editTask: (task: Task) => void; toggleTask: (task: Task) => void; busyTask: string;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [sessionLimit, setSessionLimit] = useState(12);
  const [taskLimit, setTaskLimit] = useState(20);
  const [taskStatus, setTaskStatus] = useState('all');
  const [taskPriority, setTaskPriority] = useState('all');
  const heading = useRef<HTMLHeadingElement>(null);
  const projects = useMemo(() => {
    const names = new Set([...sessions.map(s => label(s.project)), ...tasks.map(t => label(t.project))]);
    return [...names].map(name => {
      const items = sessions.filter(s => label(s.project) === name);
      const work = tasks.filter(t => label(t.project) === name);
      const updated = Math.max(0, ...items.map(s => Date.parse(s.updatedAt) || 0), ...work.map(t => Date.parse(t.updatedAt) || 0));
      return { name, sessions: items, tasks: work, active: items.filter(active).length, open: work.filter(t => t.status !== 'done').length, tokens: items.some(s => s.tokens !== null) ? items.reduce((sum, s) => sum + (s.tokens ?? 0), 0) : null, updated };
    }).sort((a, b) => b.updated - a.updated || a.name.localeCompare(b.name));
  }, [sessions, tasks]);
  const current = projects.find(project => project.name === selected);
  const filteredTasks = (current?.tasks ?? []).filter(task => (taskStatus === 'all' || (taskStatus === 'open' ? task.status !== 'done' : task.status === 'done')) && (taskPriority === 'all' || task.priority === taskPriority));
  const visible = projects.filter(project => project.name.toLowerCase().includes(query.toLowerCase().trim()));
  function select(name: string | null) {
    setSelected(name); setSessionLimit(12); setTaskLimit(20);
    setTaskStatus('all'); setTaskPriority('all');
    requestAnimationFrame(() => heading.current?.focus());
  }
  function resetTaskFilters() { setTaskStatus('all'); setTaskPriority('all'); setTaskLimit(20); }
  return <>
    <div className="project-page-heading"><div>{selected !== null && <button className="text-button" onClick={() => select(null)}><ArrowLeft size={14} />All projects</button>}<h2 ref={heading} tabIndex={-1}>{selected ?? 'Project workspaces'}</h2><p>{selected === null ? 'Observed sessions and planned work, grouped by project.' : 'The sessions and tasks moving this project forward.'}</p></div>{selected !== null && <button className="button secondary" onClick={() => newTask(selected === 'Unassigned' ? '' : selected)}><Plus size={15} />Add project task</button>}</div>
    {selected === null ? <>
      <div className="filter-bar"><div className="filter-search"><Search size={16} /><input aria-label="Search projects" placeholder="Find a project…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="text-button" onClick={() => setQuery('')}>Clear</button>}</div><span className="filter-count">{visible.length} project{visible.length === 1 ? '' : 's'}</span></div>
      {visible.length ? <div className="project-workspaces">{visible.map(project => <button className="panel project-workspace" key={project.name} onClick={() => select(project.name)} aria-label={`Open project ${project.name}`}>
        <div className="project-workspace-top"><span className="project-icon"><Folder size={20} /></span><ArrowUpRight size={16} /></div><h3>{project.name}</h3><p>{project.sessions.length} run{project.sessions.length === 1 ? '' : 's'}<span>·</span>{project.tasks.length} task{project.tasks.length === 1 ? '' : 's'}</p>
        <div className="project-workspace-stats"><span><i className="green-dot" />{project.active} in focus</span><span>{project.open} open tasks</span><span>{compact(project.tokens)} per-run tokens</span></div>
        <div className="project-workspace-bottom"><div>{(['claude', 'codex'] as const).filter(provider => project.sessions.some(s => s.provider === provider) || project.tasks.some(t => t.provider === provider)).map(provider => <ProviderMark key={provider} provider={provider} small />)}</div><time>{project.updated ? `Updated ${timeAgo(new Date(project.updated).toISOString()).toLowerCase()}` : 'No activity yet'}</time></div>
      </button>)}</div> : <section className="panel"><EmptyState title={projects.length ? 'No projects match' : 'Your next project starts here'} description={projects.length ? 'Try another project name or clear the search.' : 'Projects appear when a session or task has a project label. Create a task to plan your first one.'} action={projects.length ? <button className="button secondary" onClick={() => setQuery('')}>Clear search</button> : <button className="button primary" onClick={() => newTask('')}><Plus size={15} />Create a task</button>} /></section>}
    </> : current ? <div className="project-detail-layout">
      <section><SectionHeading title="Sessions" count={current.sessions.length} description={`${current.active} active · ${compact(current.tokens)} recorded tokens`} />{current.sessions.length ? <><div className="project-session-grid">{current.sessions.slice(0, sessionLimit).map(session => <SessionCard key={session.id} session={session} mode={mode} onOpen={() => onOpen(session)} />)}</div>{current.sessions.length > sessionLimit && <button className="button secondary show-more" onClick={() => setSessionLimit(sessionLimit + 12)}>Show more sessions ({current.sessions.length - sessionLimit} remaining)</button>}</> : <div className="panel"><EmptyState title="No observed sessions yet" description="When an agent works in this project, its session will appear here." /></div>}</section>
      <section className="panel project-task-panel">
        <SectionHeading title="Project tasks" count={current.tasks.length} description={`${current.open} open · ${current.tasks.length - current.open} done`} action={<button className="text-button" onClick={() => newTask(current.name === 'Unassigned' ? '' : current.name)}><Plus size={14} />Add task</button>} />
        {current.tasks.length ? <>
          <div className="filter-bar" role="group" aria-label="Project task filters">
            <select aria-label="Project task status" value={taskStatus} onChange={event => { setTaskStatus(event.target.value); setTaskLimit(20); }}><option value="all">All statuses</option><option value="open">Open</option><option value="done">Done</option></select>
            <select aria-label="Project task priority" value={taskPriority} onChange={event => { setTaskPriority(event.target.value); setTaskLimit(20); }}><option value="all">All priorities</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select>
          </div>
          <p className="field-help" role="status">{filteredTasks.length} matching of {current.tasks.length} project tasks</p>
          {filteredTasks.length ? <>{filteredTasks.slice(0, taskLimit).map(task => <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task)} onEdit={() => editTask(task)} busy={busyTask === task.id} />)}{filteredTasks.length > taskLimit && <button className="text-button show-more" onClick={() => setTaskLimit(taskLimit + 20)}>Show more tasks ({filteredTasks.length - taskLimit} remaining)</button>}{(taskStatus !== 'all' || taskPriority !== 'all') && <button className="text-button show-more" onClick={resetTaskFilters}>Reset filters</button>}</> : <EmptyState title="No tasks match" description="Choose another status or priority to see this project's tasks." action={<button className="button secondary" onClick={resetTaskFilters}>Reset filters</button>} />}
        </> : <EmptyState title="Give this project a next step" description="Add a task or open a session to create a connected follow-up." action={<button className="button secondary" onClick={() => newTask(current.name === 'Unassigned' ? '' : current.name)}>Add project task</button>} />}
      </section>
    </div> : <section className="panel"><EmptyState title="Project no longer in this workspace" description="Its sessions may be outside the latest scan. Return to the project list to see current work." action={<button className="button secondary" onClick={() => select(null)}>All projects</button>} /></section>}
    <p className="page-footnote"><Info size={13} />Grouped by recorded project label; same-name folders are combined. Per-run token sums can overlap replayed history. Deduplicated workspace totals are in Usage & insights.</p>
  </>;
}
