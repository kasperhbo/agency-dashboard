import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskStore, validateTask } from './store.mjs';

test('validates task boundaries and ignores untrusted extra fields', () => {
  assert.throws(() => validateTask({ title: '   ', provider: 'claude', status: 'todo', priority: 'medium' }));
  assert.throws(() => validateTask({ title: 'x', provider: 'unknown', status: 'todo', priority: 'medium' }));
  assert.deepEqual(validateTask({ title: ' Fix bug ', provider: 'codex', status: 'todo', priority: 'high', id: 'injected' }), { title: 'Fix bug', description: '', project: '', provider: 'codex', status: 'todo', priority: 'high' });
});

test('serializes concurrent writes, survives restart, and detects revision conflicts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agency-store-'));
  try {
    const file = path.join(root, 'tasks.json');
    const store = new TaskStore(file);
    const tasks = await Promise.all(Array.from({ length: 12 }, (_, i) => store.create({ title: `Task ${i}`, provider: 'claude', status: 'todo', priority: 'medium' })));
    assert.equal((await new TaskStore(file).list()).length, 12);
    const updated = await store.update(tasks[0].id, { ...tasks[0], status: 'done' }, tasks[0].revision);
    assert.equal(updated.status, 'done');
    await assert.rejects(store.update(tasks[0].id, tasks[0], tasks[0].revision), /changed/);
    await store.delete(updated.id, updated.revision);
    assert.equal((await store.list()).length, 11);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupt storage fails safely without overwriting user data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agency-corrupt-'));
  const file = path.join(root, 'tasks.json');
  try {
    await writeFile(file, 'broken');
    await assert.rejects(new TaskStore(file).create({ title: 'Test', provider: 'claude', status: 'todo', priority: 'medium' }), /could not be read/);
    assert.equal(await readFile(file, 'utf8'), 'broken');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('session references validate, persist, survive legacy edits, and can be unlinked', async () => {
  const input = { title: 'Follow up', provider: 'claude', status: 'todo', priority: 'medium' };
  for (const sessionId of ['', '../private', {}, ['id'], 12, 'x'.repeat(81)]) {
    assert.throws(() => validateTask({ ...input, sessionId }), /session/i);
  }
  const root = await mkdtemp(path.join(tmpdir(), 'agency-linked-task-'));
  try {
    const file = path.join(root, 'tasks.json');
    const store = new TaskStore(file);
    const task = await store.create({ ...input, sessionId: 'archived-session_1' });
    assert.equal((await new TaskStore(file).list())[0].sessionId, 'archived-session_1');
    const updated = await store.update(task.id, { ...input, title: 'Legacy client edit' }, task.revision);
    assert.equal(updated.sessionId, 'archived-session_1');
    const unlinked = await store.update(task.id, { ...input, sessionId: null }, updated.revision);
    assert.equal(unlinked.sessionId, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('existing task files without session references remain readable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agency-legacy-task-'));
  try {
    const file = path.join(root, 'tasks.json');
    const legacy = { title: 'Existing task', description: '', project: '', provider: 'codex', status: 'todo', priority: 'medium', id: 'existing', revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeFile(file, JSON.stringify([legacy]));
    assert.deepEqual(await new TaskStore(file).list(), [legacy]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
