import { useCallback, useEffect, useRef, useState } from 'react';
import { demoSessions, demoTasks, demoUsage } from './demo';
import type { Mode, Snapshot, Task, TaskInput } from './types';

export function readPreference(key: string, fallback: string) {
  try { return localStorage.getItem(`agency.${key}`) ?? fallback; } catch { return fallback; }
}
export function writePreference(key: string, value: string) {
  try { localStorage.setItem(`agency.${key}`, value); return true; } catch { return false; }
}
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed. Try again.');
  return data;
}
function initialDemoTasks(): Task[] {
  try {
    const stored = JSON.parse(readPreference('demoTasks', 'null'));
    if (!Array.isArray(stored)) return demoTasks;
    if (stored.every(t => typeof t.id === 'string' && typeof t.title === 'string' && ['claude', 'codex'].includes(t.provider) && ['todo', 'in_progress', 'done'].includes(t.status) && ['low', 'medium', 'high'].includes(t.priority) && typeof t.project === 'string' && typeof t.description === 'string' && (t.sessionId == null || (typeof t.sessionId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(t.sessionId))))) return stored;
  } catch { /* Retain usable seed data if browser storage is malformed. */ }
  return demoTasks;
}
export function useWorkspace() {
  const [mode, setModeState] = useState<Mode>(() => readPreference('mode', 'local') === 'demo' ? 'demo' : 'local');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [snapshot, setSnapshot] = useState<Snapshot>({ sessions: [], sources: [], scannedAt: '' });
  const [localTasks, setLocalTasks] = useState<Task[]>([]);
  const [sampleTasks, setSampleTasks] = useState<Task[]>(initialDemoTasks);
  const sampleRef = useRef(sampleTasks);
  sampleRef.current = sampleTasks;
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [storageError, setStorageError] = useState('');
  const refreshingRef = useRef(false);
  const refresh = useCallback(async (silent = false) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (!silent) setRefreshing(true);
    const results = await Promise.allSettled([request<Snapshot>('/api/sessions'), request<Task[]>('/api/tasks')]);
    if (results[0].status === 'fulfilled') setSnapshot(results[0].value);
    if (results[1].status === 'fulfilled') setLocalTasks(results[1].value);
    const failed = results.filter(r => r.status === 'rejected');
    setError(failed.map(r => r.status === 'rejected' ? r.reason.message : '').join(' '));
    setRefreshing(false); setLoading(false); refreshingRef.current = false;
  }, []);
  useEffect(() => {
    if (mode !== 'local') return;
    setLoading(true);
    void refresh();
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(true); }, 10000);
    return () => window.clearInterval(interval);
  }, [mode, refresh]);
  const setMode = (value: Mode) => {
    if (!writePreference('mode', value)) setStorageError('Browser storage is unavailable. Your workspace preference will reset after reload.');
    setModeState(value);
  };
  function saveDemo(tasks: Task[]) {
    if (!writePreference('demoTasks', JSON.stringify(tasks))) throw new Error('Browser storage is full or unavailable. Task was not saved.');
    sampleRef.current = tasks;
    setSampleTasks(tasks);
  }
  async function saveTask(input: TaskInput, task?: Task) {
    const targetMode = modeRef.current;
    if (targetMode === 'demo') {
      if (task && sampleRef.current.find(t => t.id === task.id)?.revision !== task.revision) throw new Error('This task changed. Reopen it and try again.');
      const now = new Date().toISOString();
      const next: Task = { ...input, id: task?.id || crypto.randomUUID(), revision: (task?.revision || 0) + 1, createdAt: task?.createdAt || now, updatedAt: now };
      saveDemo(task ? sampleRef.current.map(t => t.id === task.id ? next : t) : [next, ...sampleRef.current]);
    } else {
      const result = await request<Task>(task ? `/api/tasks/${task.id}` : '/api/tasks', { method: task ? 'PATCH' : 'POST', body: JSON.stringify({ ...input, revision: task?.revision }) });
      setLocalTasks(tasks => task ? tasks.map(t => t.id === task.id ? result : t) : [result, ...tasks]);
    }
  }
  async function deleteTask(task: Task) {
    if (modeRef.current === 'demo') saveDemo(sampleRef.current.filter(t => t.id !== task.id));
    else {
      await request(`/api/tasks/${task.id}`, { method: 'DELETE', body: JSON.stringify({ revision: task.revision }) });
      setLocalTasks(tasks => tasks.filter(t => t.id !== task.id));
    }
  }
  function resetDemo() { saveDemo(demoTasks); }
  return { mode, setMode, sessions: mode === 'demo' ? demoSessions : snapshot.sessions, tasks: mode === 'demo' ? sampleTasks : localTasks, usage: mode === 'demo' ? demoUsage : snapshot.usage, topology: mode === 'local' ? snapshot.topology : undefined, sources: snapshot.sources, scannedAt: snapshot.scannedAt, loading: mode === 'local' && loading, refreshing, error: mode === 'local' ? error : '', storageError, refresh, saveTask, deleteTask, resetDemo };
}
