import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function validateTask(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'A task object is required.');
  const { title, description = '', project = '', provider, status, priority } = data;
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 160) throw new HttpError(400, 'Title must contain 1–160 characters.');
  if (typeof description !== 'string' || description.length > 3000) throw new HttpError(400, 'Description must be under 3,000 characters.');
  if (typeof project !== 'string' || project.length > 80) throw new HttpError(400, 'Project must be under 80 characters.');
  if (!['claude', 'codex'].includes(provider)) throw new HttpError(400, 'Choose Claude or Codex.');
  if (!['todo', 'in_progress', 'done'].includes(status)) throw new HttpError(400, 'Choose a valid task status.');
  if (!['low', 'medium', 'high'].includes(priority)) throw new HttpError(400, 'Choose a valid priority.');
  if (Object.hasOwn(data, 'sessionId') && data.sessionId !== null && (typeof data.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.sessionId))) throw new HttpError(400, 'Choose a valid session reference, or unlink the session.');
  return { title: title.trim(), description: description.trim(), project: project.trim(), provider, status, priority, ...(Object.hasOwn(data, 'sessionId') ? { sessionId: data.sessionId } : {}) };
}
export class TaskStore {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); }
  async list() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(data) || data.some(t => {
        validateTask(t);
        return typeof t.id !== 'string' || !Number.isInteger(t.revision) || t.revision < 1 || !Number.isFinite(Date.parse(t.createdAt)) || !Number.isFinite(Date.parse(t.updatedAt));
      })) throw new Error('Invalid store');
      return data;
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw new HttpError(500, 'Task storage could not be read. Preserve .agency/tasks.json and restore a valid backup.');
    }
  }
  mutate(fn) {
    const operation = this.queue.then(async () => {
      const tasks = await this.list();
      const result = fn(tasks);
      await mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(tasks, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(temp, this.file);
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  create(data) {
    const values = validateTask(data);
    return this.mutate(tasks => {
      if (tasks.length >= 2000) throw new HttpError(400, 'Task limit reached (2,000). Remove completed tasks first.');
      const now = new Date().toISOString();
      const task = { ...values, id: randomUUID(), revision: 1, createdAt: now, updatedAt: now };
      tasks.unshift(task); return task;
    });
  }
  update(id, data, revision) {
    const values = validateTask(data);
    return this.mutate(tasks => {
      const index = tasks.findIndex(t => t.id === id);
      if (index === -1) throw new HttpError(404, 'Task was not found.');
      if (revision !== tasks[index].revision) throw new HttpError(409, 'Task changed in another window. Refresh and try again.');
      if (values.provider !== tasks[index].provider && !Object.hasOwn(values, 'sessionId')) values.sessionId = null;
      tasks[index] = { ...tasks[index], ...values, revision: revision + 1, updatedAt: new Date().toISOString() };
      return tasks[index];
    });
  }
  delete(id, revision) {
    return this.mutate(tasks => {
      const index = tasks.findIndex(t => t.id === id);
      if (index === -1) throw new HttpError(404, 'Task was not found.');
      if (revision !== tasks[index].revision) throw new HttpError(409, 'Task changed in another window. Refresh and try again.');
      tasks.splice(index, 1); return { ok: true };
    });
  }
}
