export const metricKeys = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'];
export const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const emptyMetrics = () => Object.fromEntries(metricKeys.map(key => [key, null]));
export function addMetrics(items) {
  const result = emptyMetrics();
  for (const item of items) for (const key of metricKeys) {
    if (number(item[key]) !== null) result[key] = (result[key] ?? 0) + item[key];
  }
  return result;
}
export function maxMetrics(a, b) {
  return Object.fromEntries(metricKeys.map(key => [key, a[key] == null ? b[key] : b[key] == null ? a[key] : Math.max(a[key], b[key])]));
}
export function normalizeClaude(raw) {
  if (!raw || number(raw.input_tokens) === null || number(raw.output_tokens) === null) return null;
  const cacheReadTokens = number(raw.cache_read_input_tokens) ?? 0;
  const cacheWriteTokens = number(raw.cache_creation_input_tokens) ?? 0;
  const inputTokens = raw.input_tokens + cacheReadTokens + cacheWriteTokens;
  return { inputTokens, outputTokens: raw.output_tokens, cacheReadTokens, cacheWriteTokens, reasoningTokens: number(raw.output_tokens_details?.thinking_tokens), totalTokens: inputTokens + raw.output_tokens };
}
export function normalizeCodex(raw) {
  if (!raw || number(raw.total_tokens) === null) return null;
  return { inputTokens: number(raw.input_tokens), outputTokens: number(raw.output_tokens), cacheReadTokens: number(raw.cached_input_tokens), cacheWriteTokens: number(raw.cache_write_input_tokens), reasoningTokens: number(raw.reasoning_output_tokens), totalTokens: raw.total_tokens };
}
export function usageByDay(entries) {
  const days = new Map();
  for (const entry of entries) {
    if (!entry.timestamp) continue;
    const day = entry.timestamp.slice(0, 10);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(entry.metrics);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, items]) => ({ day, ...addMetrics(items) }));
}
export function reportUsage(results) {
  const providers = [];
  for (const provider of ['claude', 'codex']) {
    const runs = results.filter(item => item.session.provider === provider);
    const unique = new Map(); let duplicateRecordsRemoved = 0;
    // Copied Codex thread logs contain the same cumulative history. Pick one complete view.
    const selected = provider === 'codex' ? [...runs.reduce((map, item) => {
      const prior = map.get(item.session.nativeId);
      if (!prior || (item.session.tokens ?? -1) > (prior.session.tokens ?? -1) || ((item.session.tokens ?? -1) === (prior.session.tokens ?? -1) && item.session.updatedAt > prior.session.updatedAt)) map.set(item.session.nativeId, item);
      return map;
    }, new Map()).values()] : runs;
    for (const item of selected) for (const entry of item.entries) {
      const prior = unique.get(entry.id);
      if (prior) duplicateRecordsRemoved++;
      const timestamps = [prior?.timestamp, entry.timestamp].filter(Boolean).sort();
      unique.set(entry.id, prior ? { ...entry, timestamp: timestamps[0] || null, metrics: maxMetrics(prior.metrics, entry.metrics) } : entry);
    }
    const entries = [...unique.values()];
    const dated = addMetrics(entries.filter(entry => entry.timestamp).map(entry => entry.metrics));
    const totals = addMetrics(entries.map(entry => entry.metrics));
    const withUsage = runs.filter(item => item.session.usage.coverage !== 'unavailable').length;
    const limits = runs.flatMap(item => item.session.usage.limits ? [item.session.usage.limits] : []).sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
    const contexts = runs.flatMap(item => item.session.usage.context ? [item.session.usage.context] : []).sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
    providers.push({ provider, ...totals, daily: usageByDay(entries), undatedTokens: totals.totalTokens === null ? null : totals.totalTokens - (dated.totalTokens ?? 0), runCount: runs.length, sessionCount: new Set(runs.filter(item => item.session.kind !== 'subagent').map(item => item.session.nativeId)).size, subagentCount: new Set(runs.filter(item => item.session.kind === 'subagent').map(item => `${item.session.parentNativeId || ''}:${item.session.nativeId}`)).size, withUsage, unavailableCount: runs.length - withUsage, partialCount: runs.filter(item => item.session.usage.coverage === 'partial').length, duplicateRecordsRemoved, duplicateThreadsRemoved: runs.length - selected.length, limits: limits[0] || null, context: contexts[0] || null });
  }
  const daily = new Map();
  for (const provider of providers) for (const day of provider.daily) {
    if (!daily.has(day.day)) daily.set(day.day, []);
    daily.get(day.day).push(day);
  }
  return { ...addMetrics(providers), providers, daily: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([day, items]) => ({ day, ...addMetrics(items) })), undatedTokens: providers.reduce((sum, provider) => sum + (provider.undatedTokens ?? 0), 0) };
}
