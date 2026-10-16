import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { Modal, ProviderMark } from './components';
import type { Mode, Provider, Session, Task, TaskInput } from './types';
import { WorkspaceRequestError } from './useWorkspace';

export function TaskEditor({ task, initial, sessions, mode, onClose, onSave, onDelete, onReload }: {
  task?: Task; initial?: Partial<TaskInput>; sessions: Session[]; mode: Mode; onClose: () => void;
  onSave: (input: TaskInput, task?: Task) => Promise<void>; onDelete: (task: Task) => Promise<void>;
  onReload?: (task: Task, signal: AbortSignal) => Promise<Task>;
}) {
  const [original, setOriginal] = useState<TaskInput>(() => ({ title: task?.title ?? initial?.title ?? '', description: task?.description ?? initial?.description ?? '', project: task?.project ?? initial?.project ?? '', provider: task?.provider ?? initial?.provider ?? 'claude', status: task?.status ?? initial?.status ?? 'todo', priority: task?.priority ?? initial?.priority ?? 'medium', sessionId: task ? task.sessionId ?? null : initial?.sessionId ?? null }));
  const [baselineTask, setBaselineTask] = useState(task);
  const [values, setValues] = useState<TaskInput>(() => ({ ...original }));
  const matchingSessions = sessions.filter(session => session.provider === values.provider);
  const missingSession = values.sessionId && !matchingSessions.some(session => session.id === values.sessionId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const reloadController = useRef<AbortController | null>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const dismissOrigin = useRef<HTMLElement | null>(null);
  const discardDescription = useId();
  const dirty = (Object.keys(original) as (keyof TaskInput)[]).some(key => original[key] !== values[key]);
  useEffect(() => { if (confirmDiscard || confirmReload) keepEditingRef.current?.focus(); }, [confirmDiscard, confirmReload]);
  useEffect(() => {
    setBusy(false); setConfirmReload(false); setConflict(false);
    return () => { reloadController.current?.abort(); reloadController.current = null; };
  }, [mode]);
  function keepEditing() {
    setConfirmDiscard(false);
    setConfirmReload(false);
    requestAnimationFrame(() => dismissOrigin.current?.focus());
  }
  function dismiss() {
    if (busy) return;
    if (confirmDiscard || confirmReload) { keepEditing(); return; }
    if (!dirty) { onClose(); return; }
    dismissOrigin.current = document.activeElement as HTMLElement | null;
    setConfirmDelete(false);
    setConfirmDiscard(true);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || confirmDiscard || confirmReload) return;
    if (!values.title.trim()) { setError('Give this task a title.'); return; }
    setBusy(true); setError('');
    try { await onSave({ ...values, title: values.title.trim() }, baselineTask); onClose(); }
    catch (e) { setError((e as Error).message); setConflict(e instanceof WorkspaceRequestError && e.status === 409); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!baselineTask || busy) return;
    setBusy(true); setError('');
    try { await onDelete(baselineTask); onClose(); }
    catch (e) { setError((e as Error).message); setConfirmDelete(false); setConflict(e instanceof WorkspaceRequestError && e.status === 409); }
    finally { setBusy(false); }
  }
  async function reloadLatest() {
    if (!baselineTask || !onReload || busy || reloadController.current) return;
    const controller = new AbortController(); reloadController.current = controller;
    setConfirmReload(false); setBusy(true);
    try {
      const latest = await onReload(baselineTask, controller.signal);
      if (controller.signal.aborted || reloadController.current !== controller) return;
      const next: TaskInput = { title: latest.title, description: latest.description, project: latest.project, provider: latest.provider, status: latest.status, priority: latest.priority, sessionId: latest.sessionId ?? null };
      setValues(next); setOriginal(next); setBaselineTask(latest); setError(''); setConflict(false);
      requestAnimationFrame(() => document.getElementById('task-title')?.focus());
    } catch (e) {
      if (!controller.signal.aborted && reloadController.current === controller) setError(`Could not reload latest. ${(e as Error).message}`);
    } finally {
      if (reloadController.current === controller) { reloadController.current = null; setBusy(false); }
    }
  }
  return <Modal title={task ? 'Edit task' : 'A little direction goes a long way.'} onClose={dismiss} className="task-editor">
    <p className="form-intro">{mode === 'demo' ? 'Saved in your demo workspace in this browser.' : 'Saved locally on this computer.'} Assigning a provider organizes your work; it won’t start an agent.</p>
    <form onSubmit={save} onKeyDownCapture={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); } }}><fieldset disabled={busy || confirmDiscard || confirmReload}>
      <label className="form-label" htmlFor="task-title">Task title</label><input id="task-title" data-autofocus autoFocus required maxLength={160} value={values.title} onChange={e => setValues({ ...values, title: e.target.value })} placeholder="What would you like to get done?" />
      <label className="form-label" htmlFor="task-description">Description <span>optional</span></label><textarea id="task-description" maxLength={3000} rows={3} value={values.description} onChange={e => setValues({ ...values, description: e.target.value })} placeholder="Add context, a checklist, or a definition of done…" />
      <span className="form-label" id="provider-label">Assign to</span><div className="provider-picker" role="group" aria-labelledby="provider-label">{(['claude', 'codex'] as Provider[]).map(provider => <button key={provider} type="button" aria-pressed={values.provider === provider} className={values.provider === provider ? 'selected' : ''} onClick={() => setValues({ ...values, provider, sessionId: values.provider === provider ? values.sessionId : null })}><ProviderMark provider={provider} small />{provider === 'claude' ? 'Claude' : 'Codex'}<span className="radio-dot" /></button>)}</div>
      <label className="form-label" htmlFor="task-session">Linked session <span>optional</span></label><select id="task-session" className="task-session-select" aria-describedby="session-help" value={values.sessionId || ''} onChange={event => setValues({ ...values, sessionId: event.target.value || null })}><option value="">No linked session</option>{missingSession && <option value={values.sessionId!}>Unavailable in loaded sessions ({values.sessionId})</option>}{matchingSessions.map(session => <option value={session.id} key={session.id}>{session.title.slice(0, 90)} — {session.project}</option>)}</select><p className="field-help" id="session-help">{missingSession ? 'This linked session is unavailable in currently loaded sessions. Its reference is preserved. It may be outside this loaded data; absence does not prove deletion.' : 'Keep the task connected to the work that prompted it. Changing provider removes the session link.'}</p>
      <div className="form-columns"><label className="form-label">Status<select value={values.status} onChange={e => setValues({ ...values, status: e.target.value as TaskInput['status'] })}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select></label><label className="form-label">Priority<select value={values.priority} onChange={e => setValues({ ...values, priority: e.target.value as TaskInput['priority'] })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div>
      <label className="form-label" htmlFor="task-project">Project <span>optional</span></label><input id="task-project" maxLength={80} value={values.project} onChange={e => setValues({ ...values, project: e.target.value })} placeholder="e.g. agency-dashboard" />
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    {conflict && onReload && mode === 'local' && <button type="button" className="button secondary" disabled={busy || confirmDiscard || confirmReload} onClick={() => { dismissOrigin.current = document.activeElement as HTMLElement | null; setConfirmReload(true); setConfirmDelete(false); }}>Reload latest</button>}
    {confirmReload && <div className="delete-confirm" role="group" aria-label="Reload latest task"><p>Discard this draft and reload the latest task? Changes are replaced only after the task is successfully read.</p><button ref={keepEditingRef} type="button" className="button secondary" onClick={keepEditing}>Keep editing</button><button type="button" className="button danger" onClick={() => void reloadLatest()}>Discard draft and reload</button></div>}
    {confirmDelete && <div className="delete-confirm"><p>Delete “{baselineTask?.title}”? This removes it from this workspace.</p><button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep task</button><button type="button" className="button danger" disabled={busy} onClick={() => void remove()}>Delete task</button></div>}
    {confirmDiscard && <div className="delete-confirm" role="group" aria-label="Unsaved changes" aria-describedby={discardDescription}><p id={discardDescription}>Discard unsaved changes? Your draft will be lost.</p><button ref={keepEditingRef} type="button" className="button secondary" onClick={keepEditing}>Keep editing</button><button type="button" className="button danger" onClick={onClose}>Discard changes</button></div>}
    <div className="modal-footer">{task && <button type="button" className="icon-button delete-button" aria-label="Delete task" disabled={busy || confirmDiscard || confirmReload} onClick={() => setConfirmDelete(true)}><Trash2 size={17} /></button>}<button type="button" className="button secondary" disabled={busy || confirmDiscard || confirmReload} onClick={dismiss}>Cancel</button><button type="submit" className="button primary" disabled={busy || confirmDiscard || confirmReload}>{busy && <LoaderCircle size={15} className="spin" />}{task ? 'Save changes' : 'Create task'}</button></div>
    </form>
  </Modal>;
}
