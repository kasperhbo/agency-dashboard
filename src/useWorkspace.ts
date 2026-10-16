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
  const response = await fetch(url, { ...options, signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', ...options?.headers } });
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
  const [sessionError, setSessionError] = useState('');
  const [taskError, setTaskError] = useState('');
  const [tasksUpdatedAt, setTasksUpdatedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [storageError, setStorageError] = useState('');
  const scope = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const mutations = useRef(new Set<AbortController>());
  const taskGeneration = useRef(0);
  const refresh = useCallback(async (silent = false) => {
    if (modeRef.current !== 'local' || refreshController.current) return;
    const controller = new AbortController();
    refreshController.current = controller;
    const currentScope = scope.current;
    const tasksGeneration = taskGeneration.current;
    const current = () => !controller.signal.aborted && scope.current === currentScope && modeRef.current === 'local';
    if (!silent) setRefreshing(true);
    await Promise.allSettled([
      (async () => {
        try {
          const result = await request<Snapshot>('/api/sessions', { signal: controller.signal });
          if (current()) { setSnapshot(result); setSessionError(''); }
        } catch (error) {
          if (current()) setSessionError((error as Error).message);
        } finally { if (current()) setLoading(false); }
      })(),
      (async () => {
        try {
          const result = await request<Task[]>('/api/tasks', { signal: controller.signal });
          // A list read before or during a write cannot replace that write's result.
          if (current() && taskGeneration.current === tasksGeneration && mutations.current.size === 0) {
            setLocalTasks(result); setTaskError(''); setTasksUpdatedAt(new Date().toISOString());
          }
        } catch (error) {
          if (current() && taskGeneration.current === tasksGeneration && mutations.current.size === 0) setTaskError((error as Error).message);
        }
      })(),
    ]);
    if (current()) setRefreshing(false);
    if (refreshController.current === controller) refreshController.current = null;
  }, []);
  useEffect(() => {
    if (mode !== 'local') return;
    setLoading(true);
    void refresh();
    const resume = () => { if (!document.hidden) void refresh(true); };
    const interval = window.setInterval(resume, 10000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      scope.current++;
      refreshController.current?.abort();
      refreshController.current = null;
      for (const controller of mutations.current) controller.abort();
      mutations.current.clear();
    };
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
      const controller = new AbortController(), currentScope = scope.current;
      mutations.current.add(controller); taskGeneration.current++;
      try {
        const result = await request<Task>(task ? `/api/tasks/${task.id}` : '/api/tasks', { method: task ? 'PATCH' : 'POST', body: JSON.stringify({ ...input, revision: task?.revision }), signal: controller.signal });
        if (!controller.signal.aborted && scope.current === currentScope) {
          setLocalTasks(tasks => task ? tasks.map(t => t.id === task.id ? result : t) : [result, ...tasks]);
          setTaskError(''); setTasksUpdatedAt(new Date().toISOString());
        }
      } finally { mutations.current.delete(controller); if (scope.current === currentScope) taskGeneration.current++; }
    }
  }
  async function deleteTask(task: Task) {
    if (modeRef.current === 'demo') saveDemo(sampleRef.current.filter(t => t.id !== task.id));
    else {
      const controller = new AbortController(), currentScope = scope.current;
      mutations.current.add(controller); taskGeneration.current++;
      try {
        await request(`/api/tasks/${task.id}`, { method: 'DELETE', body: JSON.stringify({ revision: task.revision }), signal: controller.signal });
        if (!controller.signal.aborted && scope.current === currentScope) {
          setLocalTasks(tasks => tasks.filter(t => t.id !== task.id));
          setTaskError(''); setTasksUpdatedAt(new Date().toISOString());
        }
      } finally { mutations.current.delete(controller); if (scope.current === currentScope) taskGeneration.current++; }
    }
  }
  function resetDemo() { saveDemo(demoTasks); }
  return { mode, setMode, sessions: mode === 'demo' ? demoSessions : snapshot.sessions, tasks: mode === 'demo' ? sampleTasks : localTasks, usage: mode === 'demo' ? demoUsage : snapshot.usage, topology: mode === 'local' ? snapshot.topology : undefined, sources: snapshot.sources, scannedAt: snapshot.scannedAt, loading: mode === 'local' && loading, refreshing: mode === 'local' && refreshing, error: mode === 'local' ? [sessionError, taskError].filter(Boolean).join(' ') : '', sessionError: mode === 'local' ? sessionError : '', taskError: mode === 'local' ? taskError : '', tasksUpdatedAt: mode === 'local' ? tasksUpdatedAt : '', storageError, refresh, saveTask, deleteTask, resetDemo };
}
