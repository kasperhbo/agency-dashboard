import type { Session, Task, UsageReport } from './types';
import { sumMetrics } from './usage-view';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const make = (id: string, provider: Session['provider'], name: string, title: string, project: string, status: Session['status'], minutes: number, tokens: number): Session => {
  const inputTokens = Math.round(tokens * .85), outputTokens = tokens - inputTokens;
  const metrics = { inputTokens, outputTokens, cacheReadTokens: Math.round(inputTokens * .7), cacheWriteTokens: 0, reasoningTokens: provider === 'codex' ? Math.round(outputTokens * .2) : 0, totalTokens: tokens };
  return {
  id, nativeId: `demo-${id}`, provider, name, title, project, status,
  model: provider === 'claude' ? 'claude-sonnet-4-6' : 'gpt-5.4',
  startedAt: ago(minutes + 24), updatedAt: ago(minutes), tokens, partial: false, kind: 'session',
  usage: { ...metrics, coverage: 'complete', records: 1, daily: [{ day: ago(minutes).slice(0, 10), ...metrics }], undatedTokens: 0, skippedLines: 0, issues: [], limits: null, context: null, costEstimate: null },
  events: [
    { id: '3', label: status === 'completed' ? 'Turn completed' : status === 'waiting' ? 'Waiting for your review' : 'Using ' + (provider === 'claude' ? 'Edit' : 'exec_command'), timestamp: ago(minutes), kind: status === 'completed' ? 'success' : status === 'waiting' ? 'waiting' : 'tool' },
    { id: '2', label: 'Updated project files', timestamp: ago(minutes + 4), kind: 'tool' },
    { id: '1', label: 'Read project instructions', timestamp: ago(minutes + 12), kind: 'info' },
    { id: '0', label: 'User prompt received', timestamp: ago(minutes + 24), kind: 'info' },
  ],
}; };

export const demoSessions: Session[] = [
  make('frontend', 'claude', 'Frontend engineer', 'Build the analytics dashboard and responsive charts', 'agency-dashboard', 'running', 0, 32480),
  make('backend', 'codex', 'Backend engineer', 'Implement authentication endpoints and session validation', 'api-service', 'running', 1, 24600),
  make('reviewer', 'claude', 'Code reviewer', 'Review the checkout flow for accessibility', 'storefront', 'waiting', 3, 18240),
  make('tests', 'codex', 'Test engineer', 'Add integration coverage for the payments service', 'api-service', 'running', 0, 41320),
  make('design', 'claude', 'Design systems', 'Document the new component library', 'design-system', 'completed', 35, 26800),
  make('docs', 'codex', 'Documentation', 'Update the API reference and onboarding guide', 'agency-dashboard', 'completed', 72, 14200),
  make('refactor', 'claude', 'Refactoring assistant', 'Simplify the product filtering logic', 'storefront', 'completed', 105, 22100),
  make('research', 'codex', 'Research assistant', 'Explore caching strategies for the search index', 'api-service', 'idle', 142, 9600),
  ...Array.from({ length: 19 }, (_, i) => make(`history-${i}`, i % 2 ? 'claude' : 'codex', ['Frontend engineer', 'Backend engineer', 'Code reviewer'][i % 3], ['Polish the navigation components', 'Improve query performance', 'Review changes and update tests'][i % 3], ['agency-dashboard', 'api-service', 'storefront'][i % 3], 'completed', (1 + (i % 6)) * 1440 + i * 11, 8000 + i * 1260)),
];

export const demoUsage: UsageReport = (() => {
  const providers = (['claude', 'codex'] as const).map(provider => {
    const sessions = demoSessions.filter(session => session.provider === provider);
    const daily = [...new Set(sessions.flatMap(session => session.usage!.daily.map(day => day.day)))].sort().map(day => ({ day, ...sumMetrics(sessions.flatMap(session => session.usage!.daily.filter(row => row.day === day))) }));
    return { provider, ...sumMetrics(sessions.map(session => session.usage!)), daily, undatedTokens: 0, runCount: sessions.length, sessionCount: sessions.length, subagentCount: 0, withUsage: sessions.length, unavailableCount: 0, partialCount: 0, duplicateRecordsRemoved: 0, duplicateThreadsRemoved: 0, limits: provider === 'codex' ? { reportedAt: ago(0), source: 'Sample data, not account telemetry', plan: null, credits: null, windows: [{ label: 'Primary window', usedPercent: 42, windowMinutes: 300, resetsAt: new Date(Date.now() + 2 * 3600000).toISOString(), status: null }, { label: 'Secondary window', usedPercent: 12, windowMinutes: 10080, resetsAt: new Date(Date.now() + 5 * 86400000).toISOString(), status: null }] } : null, context: null };
  });
  const days = [...new Set(providers.flatMap(provider => provider.daily.map(day => day.day)))].sort();
  return { ...sumMetrics(providers), providers, daily: days.map(day => ({ day, ...sumMetrics(providers.flatMap(provider => provider.daily.filter(row => row.day === day))) })), undatedTokens: 0 };
})();

export const demoTasks: Task[] = [
  { id: 'task-1', title: 'Build the analytics dashboard', description: 'Create responsive charts, summary metrics, and date filters. Check mobile layout before marking complete.', project: 'agency-dashboard', provider: 'claude', status: 'in_progress', priority: 'high', revision: 1, createdAt: ago(200), updatedAt: ago(4) },
  { id: 'task-2', title: 'Add authentication endpoints', description: 'Implement sign-in, token refresh, and session validation.', project: 'api-service', provider: 'codex', status: 'in_progress', priority: 'high', revision: 1, createdAt: ago(250), updatedAt: ago(10) },
  { id: 'task-3', title: 'Review checkout accessibility', description: 'Check keyboard navigation, focus order, and form error messages.', project: 'storefront', provider: 'claude', status: 'todo', priority: 'high', revision: 1, createdAt: ago(300), updatedAt: ago(17) },
  { id: 'task-4', title: 'Write payment integration tests', description: 'Cover success, declined cards, and idempotency behavior.', project: 'api-service', provider: 'codex', status: 'todo', priority: 'medium', revision: 1, createdAt: ago(400), updatedAt: ago(30) },
  { id: 'task-5', title: 'Update component documentation', description: 'Add examples for the new navigation and data table components.', project: 'design-system', provider: 'claude', status: 'done', priority: 'low', revision: 1, createdAt: ago(500), updatedAt: ago(35) },
  { id: 'task-6', title: 'Publish the API reference', description: 'Document new endpoints and request examples.', project: 'agency-dashboard', provider: 'codex', status: 'done', priority: 'medium', revision: 1, createdAt: ago(600), updatedAt: ago(72) },
];
