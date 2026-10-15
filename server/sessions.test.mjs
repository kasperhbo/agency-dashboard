import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseSession, discoverSessions } from './sessions.mjs';

const now = Date.parse('2026-10-15T16:00:00Z');
const line = data => JSON.stringify(data);

test('Claude deduplicates streaming usage by message ID and handles partial lines', () => {
  const data = [
    { type: 'user', sessionId: 'c1', cwd: 'G:\\repos\\app', timestamp: new Date(now - 30000).toISOString(), message: { content: 'Build a settings panel' } },
    { type: 'assistant', timestamp: new Date(now).toISOString(), message: { id: 'm1', model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: 'tool_use', name: 'Read' }] } },
    { type: 'assistant', timestamp: new Date(now).toISOString(), message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 40 }, stop_reason: 'end_turn' } },
  ].map(line).join('\n') + '\n{"incomplete';
  const session = parseSession(data, 'claude', '/logs/c1.jsonl', now, now);
  assert.equal(session.title, 'Build a settings panel');
  assert.equal(session.project, 'app');
  assert.equal(session.tokens, 140);
  assert.equal(session.status, 'completed');
  assert.equal(session.model, 'claude-sonnet-4-6');
  assert.equal(session.events.length, 3);
});

test('Codex cumulative token counts are not summed and stale work is idle', () => {
  const data = [
    { type: 'session_meta', timestamp: new Date(now - 600000).toISOString(), payload: { id: 'x1', cwd: '/work/api' } },
    { type: 'turn_context', payload: { model: 'gpt-5.4' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Review the API' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 300 } } } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 600 } } } },
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command' } },
  ].map(line).join('\n');
  const session = parseSession(data, 'codex', '/logs/x1.jsonl', now - 600000, now);
  assert.equal(session.tokens, 600);
  assert.equal(session.status, 'idle');
  assert.equal(session.model, 'gpt-5.4');
  assert.equal(session.project, 'api');
});

test('missing metadata and unsupported records never produce a fake session', () => {
  assert.equal(parseSession('{broken\n{}\n', 'codex', '/x', now, now), null);
});

test('unsupported assistant content does not discard a valid Claude session', () => {
  const data = [
    { type: 'user', sessionId: 's', message: { content: 'Inspect malformed logs' } },
    { type: 'assistant', message: { content: { unexpected: 'object' }, stop_reason: 'end_turn' } },
  ].map(line).join('\n');
  assert.equal(parseSession(data, 'claude', '/x', now, now).status, 'completed');
});

test('full-log discovery retains metadata, middle usage, and final events in a large log', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agency-large-log-'));
  try {
    const head = line({ type: 'session_meta', payload: { id: 'large', cwd: '/work/large-project' } });
    const filler = (line({ type: 'unknown', payload: 'x'.repeat(1024) }) + '\n').repeat(400);
    const tail = line({ type: 'event_msg', payload: { type: 'task_complete' } });
    const middle = line({ type: 'token_usage_record', timestamp: '2026-10-15T12:00:00Z', payload: { thread_token_usage: { total_tokens: 125 }, usage: { total_tokens: 125 } } });
    await writeFile(path.join(root, 'large.jsonl'), head + '\n' + filler + middle + '\n' + filler + tail + '\n{"partial');
    const result = await discoverSessions({ codex: root });
    assert.equal(result.sessions[0].partial, true);
    assert.equal(result.sessions[0].project, 'large-project');
    assert.equal(result.sessions[0].status, 'completed');
    assert.equal(result.sessions[0].tokens, 125);
    assert.equal(result.sessions[0].usage.skippedLines, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('discovery handles absent roots and reports available sessions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agency-reader-'));
  try {
    await mkdir(path.join(root, 'project'));
    await writeFile(path.join(root, 'project', 'session.jsonl'), line({ type: 'user', sessionId: 's', cwd: '/work/site', message: { content: 'Add tests' } }));
    const result = await discoverSessions({ claude: root, codex: path.join(root, 'missing') });
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sources[0].status, 'connected');
    assert.equal(result.sources[1].status, 'not_found');
  } finally { await rm(root, { recursive: true, force: true }); }
});
