import { useState, type FormEvent } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { Modal, ProviderMark } from './components';
import type { Mode, Provider, Session, Task, TaskInput } from './types';

export function TaskEditor({ task, initial, sessions, mode, onClose, onSave, onDelete }: {
  task?: Task; initial?: Partial<TaskInput>; sessions: Session[]; mode: Mode; onClose: () => void;
  onSave: (input: TaskInput, task?: Task) => Promise<void>; onDelete: (task: Task) => Promise<void>;
}) {
  const [values, setValues] = useState<TaskInput>({ title: task?.title ?? initial?.title ?? '', description: task?.description ?? '', project: task?.project ?? initial?.project ?? '', provider: task?.provider ?? initial?.provider ?? 'claude', status: task?.status ?? initial?.status ?? 'todo', priority: task?.priority ?? 'medium', sessionId: task?.sessionId ?? initial?.sessionId ?? null });
  const matchingSessions = sessions.filter(session => session.provider === values.provider);
  const missingSession = values.sessionId && !matchingSessions.some(session => session.id === values.sessionId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!values.title.trim()) { setError('Give this task a title.'); return; }
    setBusy(true); setError('');
    try { await onSave({ ...values, title: values.title.trim() }, task); onClose(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!task) return;
    setBusy(true); setError('');
    try { await onDelete(task); onClose(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal title={task ? 'Edit task' : 'A little direction goes a long way.'} onClose={() => { if (!busy) onClose(); }} className="task-editor">
    <p className="form-intro">{mode === 'demo' ? 'Saved in your demo workspace in this browser.' : 'Saved locally on this computer.'} Assigning a provider organizes your work; it won’t start an agent.</p>
    <form onSubmit={save}><fieldset disabled={busy}>
      <label className="form-label" htmlFor="task-title">Task title</label><input id="task-title" data-autofocus autoFocus required maxLength={160} value={values.title} onChange={e => setValues({ ...values, title: e.target.value })} placeholder="What would you like to get done?" />
      <label className="form-label" htmlFor="task-description">Description <span>optional</span></label><textarea id="task-description" maxLength={3000} rows={3} value={values.description} onChange={e => setValues({ ...values, description: e.target.value })} placeholder="Add context, a checklist, or a definition of done…" />
      <span className="form-label" id="provider-label">Assign to</span><div className="provider-picker" role="group" aria-labelledby="provider-label">{(['claude', 'codex'] as Provider[]).map(provider => <button key={provider} type="button" aria-pressed={values.provider === provider} className={values.provider === provider ? 'selected' : ''} onClick={() => setValues({ ...values, provider, sessionId: values.provider === provider ? values.sessionId : null })}><ProviderMark provider={provider} small />{provider === 'claude' ? 'Claude' : 'Codex'}<span className="radio-dot" /></button>)}</div>
      <label className="form-label" htmlFor="task-session">Linked session <span>optional</span></label><select id="task-session" className="task-session-select" aria-describedby="session-help" value={values.sessionId || ''} onChange={event => setValues({ ...values, sessionId: event.target.value || null })}><option value="">No linked session</option>{missingSession && <option value={values.sessionId!}>Session unavailable ({values.sessionId})</option>}{matchingSessions.map(session => <option value={session.id} key={session.id}>{session.title.slice(0, 90)} — {session.project}</option>)}</select><p className="field-help" id="session-help">{missingSession ? 'This session is outside the current scan or no longer available. Its link is preserved until you remove it.' : 'Keep the task connected to the work that prompted it. Changing provider removes the session link.'}</p>
      <div className="form-columns"><label className="form-label">Status<select value={values.status} onChange={e => setValues({ ...values, status: e.target.value as TaskInput['status'] })}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select></label><label className="form-label">Priority<select value={values.priority} onChange={e => setValues({ ...values, priority: e.target.value as TaskInput['priority'] })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div>
      <label className="form-label" htmlFor="task-project">Project <span>optional</span></label><input id="task-project" maxLength={80} value={values.project} onChange={e => setValues({ ...values, project: e.target.value })} placeholder="e.g. agency-dashboard" />
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    {confirmDelete && <div className="delete-confirm"><p>Delete “{task?.title}”? This removes it from this workspace.</p><button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep task</button><button type="button" className="button danger" disabled={busy} onClick={() => void remove()}>Delete task</button></div>}
    <div className="modal-footer">{task && <button type="button" className="icon-button delete-button" aria-label="Delete task" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={17} /></button>}<button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy && <LoaderCircle size={15} className="spin" />}{task ? 'Save changes' : 'Create task'}</button></div>
    </form>
  </Modal>;
}
