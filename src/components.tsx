import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowUpRight, Check, ChevronRight, Circle, Code2, Folder, GitBranch, Plus, Sparkles, Terminal, X } from 'lucide-react';
import { compact, providerLabel, shortModel, statusLabel, taskStatusLabel, timeAgo, type Provider, type Session, type Task } from './types';
import { UsageNumbers } from './UsageDetails';

export function AgencyMark({ small = false }: { small?: boolean }) {
  return <span className={`agency-mark ${small ? 'small' : ''}`} aria-hidden="true"><svg viewBox="0 0 36 36" fill="none"><path d="m8 26 10-19 10 19h-6l-4-8-4 8H8Z" fill="currentColor" /><circle cx="18" cy="28" r="2.5" fill="currentColor" /></svg></span>;
}
export function ProviderMark({ provider, small = false }: { provider: Provider; small?: boolean }) {
  return <span className={`provider-mark ${provider} ${small ? 'small' : ''}`} aria-hidden="true">{provider === 'claude' ? <svg viewBox="0 0 28 28"><g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">{Array.from({ length: 10 }, (_, i) => <path key={i} d="M14 4v7" transform={`rotate(${i * 36} 14 14)`} />)}</g></svg> : <Terminal size={small ? 14 : 22} strokeWidth={2} />}</span>;
}
export function StatusBadge({ status }: { status: Session['status'] }) {
  return <span className={`status-badge ${status}`}><i />{statusLabel[status]}</span>;
}
export function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = ref.current!;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    element.showModal();
    element.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => { element.close(); previouslyFocused?.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal ${className}`} aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === ref.current) { const rect = ref.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <header className="modal-header"><h2 id={id}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></header>{children}
  </dialog>;
}
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Sparkles size={26} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function SectionHeading({ title, count, description, action }: { title: string; count?: number; description?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}{count !== undefined && <span className="count">{count}</span>}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}
export function SessionCard({ session, onOpen, mode }: { session: Session; onOpen: () => void; mode: string }) {
  return <button className={`session-card ${session.status}`} onClick={onOpen}>
    <div className="session-top"><ProviderMark provider={session.provider} /><StatusBadge status={session.status} /></div>
    <div className="session-card-title"><h3>{session.name || providerLabel(session.provider) + ' session'}</h3><ArrowUpRight size={16} /></div>
    <p className="session-description">{session.title}</p>
    <div className="session-project"><Folder size={13} />{session.project}</div>
    <div className="session-bottom"><span title={`Last observed model: ${session.model}`}>{shortModel(session.model)}</span><span>{session.tokens === null ? 'Usage not reported' : `${compact(session.tokens)} tokens`}</span></div>
    {mode === 'demo' ? <div className={`agent-progress ${session.status}`} aria-label="Sample agent activity"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div> : <div className="session-observation"><span className={session.status === 'running' ? 'green-dot' : 'quiet-dot'} />Log updated {timeAgo(session.updatedAt).toLowerCase()}</div>}
  </button>;
}
export function TaskRow({ task, onToggle, onEdit, busy = false }: { task: Task; onToggle: () => void; onEdit: () => void; busy?: boolean }) {
  return <div className={`task-row ${task.status === 'done' ? 'done' : ''}`}>
    <button className="check-button" disabled={busy} aria-label={task.status === 'done' ? `Reopen ${task.title}` : `Complete ${task.title}`} onClick={onToggle}>{task.status === 'done' ? <Check size={13} /> : <Circle size={17} />}</button>
    <button className="task-main" onClick={onEdit}><span>{task.title}</span><small><Folder size={12} />{task.project || 'No project'}</small></button>
    <span className={`priority ${task.priority}`}><i />{task.priority}</span><ProviderMark provider={task.provider} small /><ChevronRight className="muted" size={15} />
  </div>;
}
export function SessionDetail({ session, tasks, mode, onClose, onCreateTask, onEditTask }: { session: Session; tasks: Task[]; mode: string; onClose: () => void; onCreateTask: () => void; onEditTask: (task: Task) => void }) {
  const linked = tasks.filter(task => task.sessionId === session.id && task.provider === session.provider);
  return <Modal title="Session details" className="detail-modal" onClose={onClose}>
    <div className="detail-intro"><ProviderMark provider={session.provider} /><div><span className="muted">{providerLabel(session.provider)}</span><h3>{session.name || shortModel(session.model)}</h3></div><StatusBadge status={session.status} /></div>
    <p className="detail-title">{session.title}</p>
    <div className="detail-grid"><div><span>Project</span><strong><Folder size={14} />{session.project}</strong></div><div><span>Last observed model</span><strong>{session.model}</strong></div><div><span>Tokens recorded</span><strong>{session.tokens?.toLocaleString() ?? 'Not reported'}</strong></div><div><span>Last activity</span><strong>{timeAgo(session.lastActivityAt || session.updatedAt)}</strong></div></div>
    {session.kind === 'subagent' && <p className="info-note">Subagent run. Parent session: {session.parentNativeId || 'Not reported'}. Subagents are counted separately from top-level sessions.</p>}
    <UsageNumbers usage={session.usage} />
    <p className="info-note">{mode === 'demo' ? 'This is a sample session. No agent is running from this dashboard.' : 'Status is inferred from meaningful log activity, not process monitoring. Unfinished work becomes idle after 2 minutes without activity. File modification time does not make an old run active.'}</p>
    <section className="linked-tasks"><SectionHeading title="Linked tasks" count={linked.length} />{linked.length ? linked.map(task => <button key={task.id} className="linked-task-row" onClick={() => onEditTask(task)}><span>{task.title}<small>{taskStatusLabel[task.status]}</small></span><ArrowUpRight size={15} /></button>) : <p>No follow-up tasks linked yet.</p>}</section>
    {session.partial && <p className="warning-note">Some log content was skipped or the 64 MiB read limit was reached. Usage coverage is partial; values may be a lower bound.</p>}
    <SectionHeading title="Recent session events" />
    <p className="field-help">Up to the last 35 supported events, in reverse source log order; not a complete lifecycle or timestamp-sorted history. Times are shown in UTC. When an event timestamp is missing, the parser may use a preceding log timestamp or file modification time.</p>
    <div className="detail-events">{session.events.length ? session.events.map(event => {
      const parsed = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : NaN;
      const timestamp = Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
      return <div className="detail-event" key={event.id}><span className={`event-icon ${event.kind}`}>{event.kind === 'tool' ? <Code2 size={14} /> : event.kind === 'success' ? <Check size={14} /> : <GitBranch size={14} />}</span><span>{event.label}</span>{timestamp ? <time dateTime={timestamp}>{timestamp.slice(0, 10)} {timestamp.slice(11, 19)} UTC</time> : <span className="muted">Not reported</span>}</div>;
    }) : <p className="muted">No supported events were found in this session.</p>}</div>
    <div className="detail-id">Session ID <code>{session.nativeId}</code></div>
    <div className="modal-footer"><button className="button secondary" onClick={onClose}>Close</button><button className="button primary" onClick={onCreateTask}><Plus size={16} />Create follow-up task</button></div>
  </Modal>;
}
