import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClaude, normalizeCodex, reportUsage } from './usage.mjs';
import { parseSession } from './sessions.mjs';

test('cache and reasoning are accounted according to each provider, never added twice', () => {
  const claude = normalizeClaude({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 30, output_tokens_details: { thinking_tokens: 5 } });
  assert.deepEqual(claude, { inputTokens: 140, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 30, reasoningTokens: 5, totalTokens: 160 });
  const codex = normalizeCodex({ input_tokens: 140, output_tokens: 20, cached_input_tokens: 100, cache_write_input_tokens: 30, reasoning_output_tokens: 5, total_tokens: 160 });
  assert.deepEqual(codex, claude);
});

test('unreported usage stays unknown instead of becoming zero', () => {
  assert.equal(normalizeClaude({}), null);
  assert.equal(normalizeCodex({}), null);
  const session = parseSession(JSON.stringify({ type: 'session_meta', timestamp: '2026-10-10T12:00:00Z', payload: { id: 'no-usage' } }), 'codex', '/empty.jsonl', Date.now());
  assert.equal(session.tokens, null);
  assert.equal(session.usage.coverage, 'unavailable');
});

test('provider aggregate removes replayed responses and keeps UTC days separate', () => {
  const metrics = normalizeClaude({ input_tokens: 10, output_tokens: 5 });
  const run = (id, timestamp) => ({ session: { provider: 'claude', nativeId: id, tokens: 15, updatedAt: timestamp, usage: { coverage: 'complete' } }, entries: [{ id: 'shared-response', timestamp, metrics }] });
  const report = reportUsage([run('two', '2026-10-15T00:01:00.000Z'), run('one', '2026-10-14T23:59:00.000Z')]);
  assert.equal(report.totalTokens, 15);
  assert.equal(report.providers[0].duplicateRecordsRemoved, 1);
  assert.equal(report.daily.length, 1);
  assert.equal(report.daily[0].day, '2026-10-14');
});

test('synthetic error records do not replace the real model or add zero usage', () => {
  const data = [
    { type: 'assistant', timestamp: '2026-10-14T12:00:00Z', sessionId: 's', message: { id: 'm1', model: 'claude-sonnet-5-5', usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' } },
    { type: 'assistant', timestamp: '2026-10-14T12:01:00Z', isApiErrorMessage: true, message: { id: 'error', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } }, quotaLimits: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1792152000 } },
  ].map(JSON.stringify).join('\n');
  const session = parseSession(data, 'claude', '/s.jsonl', Date.parse('2026-10-15T12:00:00Z'));
  assert.equal(session.model, 'claude-sonnet-5-5');
  assert.equal(session.tokens, 15);
  assert.equal(session.usage.records, 1);
  assert.equal(session.status, 'error');
  assert.equal(session.updatedAt, '2026-10-14T12:01:00.000Z');
  assert.equal(session.usage.limits.windows[0].usedPercent, null);
});

test('touching old files does not create fresh activity or move usage to today', () => {
  const record = { type: 'assistant', timestamp: '2026-10-10T12:00:00Z', sessionId: 's', message: { id: 'm', usage: { input_tokens: 20, output_tokens: 10 } } };
  const session = parseSession(JSON.stringify(record), 'claude', '/s.jsonl', Date.parse('2026-10-15T12:00:00Z'), Date.parse('2026-10-15T12:00:00Z'));
  assert.equal(session.startedAt, '2026-10-10T12:00:00.000Z');
  assert.equal(session.updatedAt, '2026-10-10T12:00:00.000Z');
  assert.equal(session.status, 'idle');
  assert.equal(session.usage.daily[0].day, '2026-10-10');
});

test('Codex supports native token_usage_record, preserves inherited undated usage, and exposes snapshot limits', () => {
  const data = [
    { type: 'session_meta', timestamp: '2026-10-14T23:00:00Z', payload: { id: 'thread' } },
    { type: 'token_usage_record', timestamp: '2026-10-14T23:59:00Z', payload: { thread_token_usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 }, usage: { input_tokens: 90, output_tokens: 10, total_tokens: 100 } } },
    { type: 'event_msg', timestamp: '2026-10-15T00:01:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 990, output_tokens: 110, total_tokens: 1100 }, last_token_usage: { input_tokens: 90, output_tokens: 10, total_tokens: 100 }, model_context_window: 200000 }, rate_limits: { primary: { used_percent: 55, window_minutes: 300, resets_at: 1792152000 }, credits: { has_credits: false, unlimited: false, balance: '0' } } } },
  ].map(JSON.stringify).join('\n');
  const session = parseSession(data, 'codex', '/s.jsonl', Date.now());
  assert.equal(session.tokens, 1100);
  assert.equal(session.usage.undatedTokens, 900);
  assert.deepEqual(session.usage.daily.map(day => [day.day, day.totalTokens]), [['2026-10-14', 100], ['2026-10-15', 100]]);
  assert.equal(session.usage.context.lastRequestTokens, 100);
  assert.equal(session.usage.context.windowTokens, 200000);
  assert.equal(session.usage.limits.windows[0].usedPercent, 55);
  assert.equal(session.usage.limits.credits.balance, '0');
});

test('a decreasing native counter is explicitly partial instead of silently claiming exact usage', () => {
  const data = [
    { type: 'session_meta', payload: { id: 'inconsistent' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 100 } } } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 90 } } } },
  ].map(JSON.stringify).join('\n');
  const session = parseSession(data, 'codex', '/inconsistent.jsonl', Date.now());
  assert.equal(session.tokens, 100);
  assert.equal(session.usage.coverage, 'partial');
  assert.match(session.usage.issues[0], /counter decreased/);
});
