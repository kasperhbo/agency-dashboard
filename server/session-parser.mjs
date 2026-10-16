import path from 'node:path';
import { createHash } from 'node:crypto';
import { addMetrics, emptyMetrics, maxMetrics, metricKeys, normalizeClaude, normalizeCodex, number, usageByDay } from './usage.mjs';

const short = (text, length = 160) => String(text ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, length);
const basename = cwd => String(cwd ?? '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Unassigned';
const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;
const difference = (a, b) => Object.fromEntries(metricKeys.map(key => [key, a[key] === null ? null : Math.max(0, a[key] - (b[key] ?? 0))]));
const metadataText = value => typeof value === 'string' ? short(value, 100) : '';

export class SessionParser {
  constructor(provider, file, modified) {
    Object.assign(this, { provider, file, modified, id: createHash('sha256').update(`${provider}:${file}`).digest('hex').slice(0, 20), nativeId: '', agentId: '', title: '', cwd: '', model: provider === 'claude' ? 'Claude Code' : 'Codex', status: 'idle', started: null, updated: null, lastActivity: null, recognized: false, eventCount: 0, events: [], messages: new Map(), entries: [], cumulative: emptyMetrics(), hasSnapshot: false, partial: false, skippedLines: 0, limits: null, context: null, costEstimate: null, issues: new Set(), subagent: provider === 'claude' && /[\\/]subagents[\\/]/.test(file), parentNativeId: '', agentName: '' });
  }
  event(label, timestamp, kind = 'info') {
    this.lastActivity = timestamp;
    this.events.push({ id: String(this.eventCount++), label: short(label), timestamp: iso(timestamp), kind });
    if (this.events.length > 35) this.events.shift();
  }
  codexUsage(raw, single, timestamp) {
    const next = normalizeCodex(raw);
    if (!next) return;
    if (this.hasSnapshot && next.totalTokens < this.cumulative.totalTokens) this.issues.add('A cumulative usage counter decreased; totals are a lower bound.');
    const merged = maxMetrics(this.cumulative, next);
    const delta = difference(merged, this.cumulative);
    const prefix = `codex:${this.nativeId || this.id}:${this.cumulative.totalTokens ?? 0}:${merged.totalTokens}`;
    if (delta.totalTokens > 0 || !this.hasSnapshot) {
      if (!this.hasSnapshot) {
        // An initial cumulative counter may include inherited/resumed work. Only the
        // explicitly reported last request can be assigned to this timestamp.
        const last = normalizeCodex(single);
        const attributable = last && last.totalTokens <= delta.totalTokens ? last : null;
        if (attributable) this.entries.push({ id: `${prefix}:last`, metrics: attributable, timestamp: iso(timestamp) });
        const remainder = attributable ? difference(delta, attributable) : delta;
        if (!attributable || remainder.totalTokens > 0) this.entries.push({ id: `${prefix}:baseline`, metrics: remainder, timestamp: null });
      } else this.entries.push({ id: prefix, metrics: delta, timestamp: iso(timestamp) });
    }
    this.cumulative = merged;
    this.hasSnapshot = true;
  }
  push(record) {
    if (!record || typeof record !== 'object') return;
    const parsed = Date.parse(record.timestamp);
    const hasTimestamp = Number.isFinite(parsed);
    if (hasTimestamp) {
      this.started = this.started === null ? parsed : Math.min(this.started, parsed);
      this.updated = this.updated === null ? parsed : Math.max(this.updated, parsed);
    }
    const time = hasTimestamp ? parsed : this.updated ?? this.modified;
    const usageTime = hasTimestamp ? parsed : null;
    if (this.provider === 'claude') {
      if (record.sessionId) { this.nativeId = short(record.sessionId, 100); this.recognized = true; }
      if (record.agentId) { this.agentId = short(record.agentId, 100); if (record.isSidechain) this.subagent = true; }
      if (record.cwd) this.cwd = record.cwd;
      if (record.type === 'cost-state' && number(record.totalCostUSD) !== null) this.costEstimate = { amountUsd: record.totalCostUSD, reportedAt: iso(time), timeBasis: hasTimestamp ? 'record' : 'preceding-log', incomplete: record.hasUnknownModelCost === true, source: 'Claude CLI cost-state estimate' };
      const quota = record.quotaLimits;
      if (quota && typeof quota.status === 'string') this.limits = { reportedAt: iso(time), source: 'Claude log quotaLimits', windows: [{ label: short(quota.rateLimitType || 'Reported limit', 50), usedPercent: null, windowMinutes: null, resetsAt: number(quota.resetsAt) !== null ? iso(quota.resetsAt * 1000) : null, status: short(quota.status, 50) }], credits: null, plan: null };
      const message = record.message;
      if (record.type === 'user' && message) {
        this.recognized = true;
        const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.filter(block => block?.type === 'text').map(block => typeof block.text === 'string' ? block.text : '').join(' ') : '';
        if (text && !text.startsWith('<') && !this.title) this.title = short(text);
        if (text) { this.status = 'running'; this.event('User prompt received', time); }
      }
      if (record.type === 'assistant' && message) {
        this.recognized = true;
        const synthetic = record.isApiErrorMessage || String(message.model || '').startsWith('<');
        if (!synthetic) {
          this.lastActivity = time;
          this.status = 'running';
          if (message.model) this.model = short(message.model, 80);
          const metrics = normalizeClaude(message.usage);
          if (metrics) {
            const id = message.id || record.uuid;
            if (id) {
              const prior = this.messages.get(id);
              this.messages.set(id, { id: `claude:${id}`, metrics: prior ? maxMetrics(prior.metrics, metrics) : metrics, timestamp: iso(usageTime) || prior?.timestamp || null });
            } else this.issues.add('A usage record without a response ID could not be safely counted.');
          }
          for (const block of Array.isArray(message.content) ? message.content : []) if (block?.type === 'tool_use') this.event(`Using ${short(block.name, 60)}`, time, 'tool');
          if (message.stop_reason === 'end_turn') { this.status = 'completed'; this.event('Turn completed', time, 'success'); }
        }
      }
      if (record.isApiErrorMessage) { this.status = 'error'; this.event('Agent reported an API error', time, 'error'); }
      if (record.type === 'system' && record.subtype === 'turn_duration') { this.status = 'completed'; this.event('Turn completed', time, 'success'); }
    } else {
      const p = record.payload || {};
      if (record.type === 'session_meta') {
        this.recognized = true; this.nativeId ||= metadataText(p.id); this.cwd = p.cwd || this.cwd;
        // Only native spawn metadata establishes lineage. forked_from_id and generic
        // parent_thread_id may describe a fork, so neither alone implies a spawn.
        const spawn = p.source?.subagent?.thread_spawn;
        if (spawn && typeof spawn === 'object' && !Array.isArray(spawn)) {
          this.subagent = true;
          this.parentNativeId = metadataText(spawn.parent_thread_id);
          this.agentName = metadataText(p.agent_nickname) || metadataText(spawn.agent_nickname) || metadataText(p.agent_role) || metadataText(spawn.agent_role);
        } else if (p.source?.subagent) {
          this.subagent = true;
          this.agentName = metadataText(p.agent_nickname) || metadataText(p.agent_role) || metadataText(p.source.subagent);
        }
      }
      if (record.type === 'turn_context') { this.cwd = p.cwd || this.cwd; if (p.model) this.model = short(p.model, 80); }
      if (record.type === 'token_usage_record') this.codexUsage(p.thread_token_usage, p.usage, usageTime);
      if (record.type === 'event_msg') {
        if (p.type === 'user_message') { if (!this.title) this.title = short(p.message); this.status = 'running'; this.event('User prompt received', time); }
        if (p.type === 'task_started') { this.status = 'running'; this.event('Turn started', time); }
        if (p.type === 'task_complete' || p.type === 'task_completed') { this.status = 'completed'; this.event('Turn completed', time, 'success'); }
        if (p.type === 'turn_aborted') { this.status = 'idle'; this.event('Turn interrupted', time); }
        if (p.type === 'error') { this.status = 'error'; this.event('Agent reported an error', time, 'error'); }
        if (p.type === 'token_count') {
          this.codexUsage(p.info?.total_token_usage, p.info?.last_token_usage, usageTime);
          const last = normalizeCodex(p.info?.last_token_usage);
          if (number(p.info?.model_context_window) !== null) this.context = { reportedAt: iso(time), windowTokens: p.info.model_context_window, lastRequestTokens: last?.totalTokens ?? null, source: 'Codex token_count' };
          const limits = p.rate_limits;
          if (limits) {
            const windows = ['primary', 'secondary'].flatMap((key, i) => {
              const window = limits[key];
              return window && number(window.used_percent) !== null ? [{ label: i ? 'Secondary window' : 'Primary window', usedPercent: window.used_percent, windowMinutes: number(window.window_minutes), resetsAt: number(window.resets_at) !== null ? iso(window.resets_at * 1000) : null, status: null }] : [];
            });
            if (windows.length) this.limits = { reportedAt: iso(time), source: 'Codex token_count rate_limits', windows, credits: limits.credits ? { hasCredits: typeof limits.credits.has_credits === 'boolean' ? limits.credits.has_credits : null, unlimited: typeof limits.credits.unlimited === 'boolean' ? limits.credits.unlimited : null, balance: typeof limits.credits.balance === 'string' && /^\d+(\.\d+)?$/.test(limits.credits.balance) ? limits.credits.balance.slice(0, 40) : null } : null, plan: typeof limits.plan_type === 'string' ? short(limits.plan_type, 40) : null };
          }
        }
      }
      if (record.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) { this.status = 'running'; this.event(`Using ${short(p.name, 60)}`, time, 'tool'); }
    }
  }
  finish(now = Date.now()) {
    if (!this.recognized) return null;
    const entries = this.provider === 'claude' ? [...this.messages.values()] : this.entries;
    const metrics = this.provider === 'claude' ? addMetrics(entries.map(entry => entry.metrics)) : this.cumulative;
    const coverage = metrics.totalTokens === null ? 'unavailable' : this.partial || this.skippedLines || this.issues.size ? 'partial' : 'complete';
    const age = now - (this.lastActivity ?? 0);
    const status = this.status === 'running' && (age > 120000 || age < -60000) ? 'idle' : this.status;
    const portableFile = this.file.replace(/\\/g, '/');
    const pathParent = this.provider === 'claude' ? portableFile.match(/(?:^|\/)([^/]+)\/subagents\/[^/]+$/)?.[1] : '';
    const parentNativeId = this.subagent ? this.provider === 'claude' ? this.nativeId || pathParent : this.parentNativeId : '';
    // Claude child records carry the parent's sessionId. Without an agentId,
    // use the native agent filename, never that parent's ID, as child identity.
    const fileNativeId = path.posix.basename(portableFile, '.jsonl');
    const nativeId = this.provider === 'claude' && this.subagent ? this.agentId || `path-agent:${fileNativeId || this.id}` : this.agentId || this.nativeId || fileNativeId;
    const session = {
      id: this.id, nativeId, provider: this.provider,
      title: this.title || `${this.provider === 'claude' ? 'Claude' : 'Codex'} session`, project: basename(this.cwd), model: this.model, status,
      ...(typeof this.cwd === 'string' && this.cwd.trim() && !/[\x00-\x1f\x7f]/.test(this.cwd) ? { workingDirectory: this.cwd } : {}),
      kind: this.subagent ? 'subagent' : 'session', ...(this.subagent ? { name: this.agentName || `${this.provider === 'claude' ? 'Claude' : 'Codex'} subagent` } : {}),
      ...(parentNativeId ? { parentNativeId, parentEvidence: this.provider === 'claude' && !this.nativeId ? 'path-parent' : 'log-parent' } : {}),
      startedAt: iso(this.started ?? this.modified), updatedAt: iso(this.updated ?? this.modified), lastActivityAt: iso(this.lastActivity ?? this.modified), timestampSource: this.updated === null ? 'file' : 'log',
      fileModifiedAt: iso(this.modified), tokens: metrics.totalTokens, events: [...this.events].reverse(), partial: this.partial || this.skippedLines > 0,
      usage: { ...metrics, coverage, records: entries.length, daily: usageByDay(entries), undatedTokens: entries.filter(entry => !entry.timestamp).reduce((sum, entry) => sum + (entry.metrics.totalTokens ?? 0), 0), skippedLines: this.skippedLines, issues: [...this.issues], limits: this.limits, context: this.context, costEstimate: this.costEstimate },
    };
    return { session, entries };
  }
}
