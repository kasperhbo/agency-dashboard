import type { Mode, Task } from './types';

export function taskBackup(tasks: Task[], source: Mode, lastSuccessfulReadAt: string, lastConfirmedUpdateAt: string, readFailed: boolean, now = Date.now()) {
  const observed = Date.parse(lastConfirmedUpdateAt);
  return JSON.stringify({
    schemaVersion: 1,
    source,
    exportedAt: new Date(now).toISOString(),
    snapshot: {
      basis: source === 'demo' ? 'Demo tasks in this browser' : 'Last confirmed local task state in this browser',
      lastSuccessfulReadAt: source === 'local' ? lastSuccessfulReadAt || null : null,
      lastConfirmedUpdateAt: source === 'local' ? lastConfirmedUpdateAt || null : null,
      status: source === 'demo' ? 'demo' : readFailed || !Number.isFinite(observed) || now - observed > 120000 ? 'stale' : 'last_confirmed',
      note: 'Contains task text and session references. Unconfirmed writes are excluded. This is a browser snapshot, not an atomic disk backup. No import or restore is provided.',
    },
    tasks,
  }, null, 2) + '\n';
}
