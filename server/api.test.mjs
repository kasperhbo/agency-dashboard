import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApp } from './index.mjs';
import { TaskStore } from './store.mjs';

test('API validates origin, request shape, revisions, and persistence', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'agency-api-'));
  const server = createApp({ store: new TaskStore(path.join(root, 'tasks.json')), discover: async () => ({ sessions: [], sources: [], scannedAt: new Date().toISOString() }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const data = { title: 'Build overview', provider: 'claude', status: 'todo', priority: 'high' };
  const send = (route, method, body, extra = {}) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  assert.equal((await send('/api/tasks', 'POST', data, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await send('/api/tasks', 'POST', data, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const invalidHost = await new Promise((resolve, reject) => {
    const req = httpRequest(base + '/api/tasks', { method: 'POST', headers: { Host: 'rebind.example', 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end(JSON.stringify(data));
  });
  assert.equal(invalidHost, 403);
  assert.equal((await send('/api/tasks', 'POST', data, { Origin: 'http://localhost:6666' })).status, 403);
  assert.equal((await send('/api/tasks', 'POST', null)).status, 400);
  assert.equal((await send('/api/tasks', 'POST', { ...data, title: '' })).status, 400);
  assert.equal((await fetch(base + '/api/tasks', { method: 'POST', body: 'text' })).status, 415);
  assert.equal((await fetch(base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' })).status, 400);
  const response = await send('/api/tasks', 'POST', data);
  assert.equal(response.status, 201);
  const task = await response.json();
  const update = await send(`/api/tasks/${task.id}`, 'PATCH', { ...task, status: 'done' });
  assert.equal(update.status, 200);
  const saved = await update.json();
  assert.equal((await send(`/api/tasks/${task.id}`, 'PATCH', task)).status, 409);
  assert.equal((await (await fetch(base + '/api/tasks')).json())[0].status, 'done');
  assert.equal((await send(`/api/tasks/${task.id}`, 'DELETE', { revision: saved.revision })).status, 200);
  assert.deepEqual(await (await fetch(base + '/api/tasks')).json(), []);
  assert.equal((await fetch(base + '/api/unknown')).status, 404);
});

test('streamed JSON preserves multibyte task text and rejects malformed URL escapes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'agency-api-utf8-'));
  const server = createApp({ store: new TaskStore(path.join(root, 'tasks.json')), enableLiveClaudeUsage: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const data = { title: '修復 café 🛠️', description: 'Résumé 完了 ✅', provider: 'codex', status: 'todo', priority: 'medium' };
  const bytes = Buffer.from(JSON.stringify(data));
  const result = await new Promise((resolve, reject) => {
    const req = httpRequest(base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    // Each non-ASCII code point crosses HTTP chunks, including four-byte emoji.
    void (async () => {
      for (const byte of bytes) {
        req.write(Buffer.from([byte]));
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      req.end();
    })().catch(reject);
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.title, data.title);
  assert.equal(result.body.description, data.description);
  const tasks = await (await fetch(base + '/api/tasks')).json();
  assert.equal(tasks[0].title, data.title);
  assert.equal((await fetch(base + '/%E0%A4%A')).status, 400);
  const oversized = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, description: '界'.repeat(6000) }) });
  assert.equal(oversized.status, 413);
  assert.equal((await (await fetch(base + '/api/tasks')).json()).length, 1);
});
