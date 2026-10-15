import { buildTopology } from './topology.mjs';

/** Explicit, deterministic sample scenario; never reads or represents local logs. */
export function sampleTopology() {
  const observedAt = '2026-10-15T16:00:00.000Z';
  const run = (provider, nativeId, title, status, tokens, parentNativeId) => ({
    id: `demo-${nativeId}`, nativeId, provider, title, status, tokens,
    kind: parentNativeId ? 'subagent' : 'session',
    ...(parentNativeId ? { parentNativeId, parentEvidence: 'log-parent', name: title } : {}),
    model: provider === 'claude' ? 'claude-sonnet-4-6' : 'gpt-5.4',
    project: 'Sample agency', startedAt: '2026-10-15T15:30:00.000Z', updatedAt: observedAt, lastActivityAt: observedAt,
  });
  return buildTopology({
    dataSource: 'demo', observedAt,
    sessions: [
      run('claude', 'claude-lead', 'Design coordinator', 'running', 12400),
      run('claude', 'claude-builder', 'Interface builder', 'running', 4800, 'claude-lead'),
      run('claude', 'claude-reviewer', 'Review needs your input', 'waiting', 2200, 'claude-lead'),
      run('codex', 'codex-lead', 'Backend coordinator', 'running', 9100),
      run('codex', 'codex-tester', 'Curie', 'completed', 3600, 'codex-lead'),
    ],
    sources: ['claude', 'codex'].map(provider => ({ provider, path: 'demo', status: 'connected', count: provider === 'claude' ? 3 : 2, sessionCount: 1, subagentCount: provider === 'claude' ? 2 : 1, limited: false, warnings: [] })),
  });
}
