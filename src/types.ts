export type Provider = 'claude' | 'codex';
export type SessionStatus = 'running' | 'waiting' | 'completed' | 'idle' | 'error';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type Page = 'overview' | 'network' | 'agents' | 'projects' | 'tasks' | 'activity' | 'insights' | 'settings';
export type Mode = 'demo' | 'local';
export interface AgentEvent { id: string; label: string; timestamp: string; kind: string }
export interface Session {
  id: string; nativeId: string; provider: Provider; title: string; project: string;
  model: string; status: SessionStatus; startedAt: string; updatedAt: string;
  tokens: number | null; events: AgentEvent[]; partial: boolean; name?: string;
  kind?: 'session' | 'subagent'; parentNativeId?: string; lastActivityAt?: string; timestampSource?: 'file' | 'log';
  usage?: SessionUsage;
}
export interface Task {
  id: string; title: string; description: string; project: string; provider: Provider;
  status: TaskStatus; priority: 'low' | 'medium' | 'high';
  sessionId?: string | null;
  revision: number; createdAt: string; updatedAt: string;
}
export type TaskInput = Pick<Task, 'title' | 'description' | 'project' | 'provider' | 'status' | 'priority' | 'sessionId'>;
export interface Source { provider: Provider; path: string; status: 'connected' | 'not_found' | 'error'; count: number; sessionCount?: number; subagentCount?: number; limited: boolean; warnings: string[] }
export interface UsageMetrics { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; reasoningTokens: number | null; totalTokens: number | null }
export interface UsageDay extends UsageMetrics { day: string }
export interface LimitSnapshot {
  reportedAt: string; source: string; plan: string | null;
  windows: { label: string; usedPercent: number | null; windowMinutes: number | null; resetsAt: string | null; status: string | null }[];
  credits: { hasCredits: boolean | null; unlimited: boolean | null; balance: string | null } | null;
}
export interface ContextSnapshot { reportedAt: string; windowTokens: number; lastRequestTokens: number | null; source: string }
export interface SessionUsage extends UsageMetrics {
  coverage: 'complete' | 'partial' | 'unavailable'; records: number; daily: UsageDay[]; undatedTokens: number;
  skippedLines: number; issues: string[]; limits: LimitSnapshot | null; context: ContextSnapshot | null;
  costEstimate: { amountUsd: number; reportedAt: string; timeBasis?: 'record' | 'preceding-log'; incomplete: boolean; source: string } | null;
}
export interface ProviderUsage extends UsageMetrics {
  provider: Provider; daily: UsageDay[]; undatedTokens: number | null;
  runCount: number; sessionCount: number; subagentCount: number; withUsage: number; unavailableCount: number; partialCount: number;
  duplicateRecordsRemoved: number; duplicateThreadsRemoved: number; limits: LimitSnapshot | null; context: ContextSnapshot | null;
}
export interface UsageReport extends UsageMetrics { providers: ProviderUsage[]; daily: UsageDay[]; undatedTokens: number }
export interface Snapshot { sessions: Session[]; sources: Source[]; scannedAt: string; usage?: UsageReport }
export interface TopologyNode {
  id: string; kind: 'workspace' | 'provider' | 'session' | 'subagent' | 'missing-parent'; label: string;
  provider?: Provider; status?: SessionStatus; availability?: 'connected' | 'not_found' | 'error';
  sessionId?: string; nativeId?: string; parentNativeId?: string; model?: string; project?: string; tokens?: number | null; updatedAt?: string;
}
export interface TopologyEdge {
  id: string; source: string; target: string; kind: 'membership' | 'parent-child';
  evidence: 'workspace' | 'provider' | 'log-parent' | 'path-parent' | 'missing-parent'; animated: boolean;
}
export interface AgentTopology {
  version: 1; observedAt: string; dataSource: 'local' | 'demo' | 'fixture';
  nodes: TopologyNode[]; edges: TopologyEdge[];
  summary: { sessions: number; subagents: number; unresolvedParents: number; activeRuns: number; duplicatesMerged: number };
  sources: Source[]; coverage: { limited: boolean; notes: string[] };
}
export function uniqueRuns(sessions: Session[]) {
  const runs = new Map<string, Session>();
  for (const session of sessions) {
    const key = `${session.provider}:${session.kind || 'session'}:${session.parentNativeId || ''}:${session.nativeId}`;
    const prior = runs.get(key);
    if (!prior || session.updatedAt > prior.updatedAt || (session.updatedAt === prior.updatedAt && (session.tokens ?? -1) > (prior.tokens ?? -1))) runs.set(key, session);
  }
  return [...runs.values()];
}
export const providerLabel = (provider: Provider) => provider === 'claude' ? 'Claude' : 'Codex';
export const statusLabel: Record<SessionStatus, string> = { running: 'Working', waiting: 'Needs you', completed: 'Completed', idle: 'Idle', error: 'Error' };
export const taskStatusLabel: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
export const compact = (n: number | null | undefined) => n == null ? '—' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export function timeAgo(date: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
export function shortModel(model: string) {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/^gpt-/, 'GPT-').replace(/sonnet-/, 'Sonnet ').replace(/opus-/, 'Opus ').replace(/(\d)-(\d)/, '$1.$2');
}
