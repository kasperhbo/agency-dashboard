import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { EmptyState, ProviderMark, SectionHeading, StatusBadge } from './components';
import { providerLabel, taskStatusLabel, type Mode, type Session, type Task } from './types';

export function AttentionPage({ sessions, tasks, mode, sessionError, taskError, loading, scannedAt, tasksReadAt, sessionPartial, sessionAttentionKnown, now, onOpen, onEdit }: {
  sessions: Session[]; tasks: Task[]; mode: Mode; sessionError: string; taskError: string; loading: boolean;
  scannedAt: string; tasksReadAt: string; sessionPartial: boolean; onOpen: (session: Session) => void; onEdit: (task: Task) => void;
  sessionAttentionKnown: boolean; now: number;
}) {
  const [tab, setTab] = useState<'sessions' | 'tasks'>('sessions');
  const demo = mode === 'demo';
  const sessionTime = Date.parse(scannedAt), taskTime = Date.parse(tasksReadAt);
  const sessionsObserved = demo || Number.isFinite(sessionTime);
  const tasksObserved = demo || Number.isFinite(taskTime);
  const sessionStale = !demo && sessionsObserved && now - sessionTime > 120000;
  const taskStale = !demo && tasksObserved && now - taskTime > 120000;
  const sessionUncertain = !sessionAttentionKnown;
  const taskUncertain = !tasksObserved || !!taskError || taskStale;
  const uncertain = tab === 'sessions' ? sessionUncertain : taskUncertain;
  const observed = tab === 'sessions' ? sessionsObserved : tasksObserved;
  const error = tab === 'sessions' ? sessionError : taskError;
  const stale = tab === 'sessions' ? sessionStale : taskStale;
  const timestamp = tab === 'sessions' ? scannedAt : tasksReadAt;
  const items = tab === 'sessions' ? sessions : tasks;
  return <>
    <div className="tabs" role="group" aria-label="Attention views">
      <button type="button" aria-pressed={tab === 'sessions'} className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}>Sessions <span>{sessions.length || sessionAttentionKnown ? sessions.length : '—'}</span></button>
      <button type="button" aria-pressed={tab === 'tasks'} className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>High-priority tasks <span>{tasksObserved ? tasks.length : '—'}</span></button>
    </div>
    <section className="panel attention-preview" aria-label={tab === 'sessions' ? 'Session attention' : 'High-priority task attention'} data-state={uncertain ? 'uncertain' : 'observed'}>
      <SectionHeading title={tab === 'sessions' ? 'Waiting & error sessions' : 'Open high-priority tasks'} description={demo ? 'Demo sample data only.' : 'Currently loaded Local data; not complete history or live process state.'} />
      <p className="field-help" role="status">
        {demo ? 'Sample items for exploring the dashboard.' : <>
          {!observed ? (tab === 'sessions' && loading ? 'Reading session logs. Attention status is not yet known.' : `${tab === 'sessions' ? 'Session' : 'Task'} data has not been successfully observed. Attention status is unknown.`) : <>{tab === 'sessions' ? 'Sessions' : 'Tasks'} last read <time dateTime={timestamp}>{new Date(timestamp).toISOString().replace('T', ' ').replace('Z', ' UTC')}</time>. </>}
          {error && 'The latest read failed; retained items may be outdated. '}
          {stale && 'The retained observation is stale. '}
          {tab === 'sessions' && sessionPartial && 'Session discovery is partial or a source is unavailable. '}
          {uncertain && 'This view cannot confirm that no attention items exist.'}
        </>}
      </p>
      {items.length ? <div className="attention-preview-list">{tab === 'sessions' ? sessions.map(session => <button type="button" key={session.id} aria-label={`Open attention session ${session.title || session.name || providerLabel(session.provider)}`} onClick={() => onOpen(session)}><ProviderMark provider={session.provider} small /><span><strong>{session.title || session.name || providerLabel(session.provider)}</strong><small>{providerLabel(session.provider)} · {session.project}</small><StatusBadge status={session.status} /></span><ArrowUpRight size={15} /></button>) : tasks.map(task => <button type="button" key={task.id} aria-label={`Edit high-priority task ${task.title}`} onClick={() => onEdit(task)}><ProviderMark provider={task.provider} small /><span><strong>{task.title}</strong><small>{providerLabel(task.provider)} · {task.project || 'No project'} · {taskStatusLabel[task.status]}</small></span><ArrowUpRight size={15} /></button>)}</div> : <EmptyState title={uncertain ? 'Attention status unconfirmed' : tab === 'sessions' ? 'No waiting or error sessions observed' : 'No open high-priority tasks observed'} description={uncertain ? 'Refresh the workspace to check current data. The retained list is not an all-clear.' : tab === 'sessions' ? 'No waiting or error states were found in the currently loaded sessions.' : 'No high-priority tasks with an unfinished status were found in this workspace.'} />}
      <p className="field-help">{tab === 'sessions' ? 'Session states are inferred from logs. Native approvals stay in Claude and Codex.' : 'Tasks are plans. This view includes high-priority tasks whose status is not Done; it does not start agents.'}</p>
    </section>
  </>;
}
