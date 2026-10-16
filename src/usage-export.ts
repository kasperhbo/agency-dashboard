import { providerLabel, type Mode, type ProviderUsage, type UsageMetrics } from './types';
import { metricKeys, periodMetrics, sumMetrics } from './usage-view';

function csvCell(value: string | number) {
  const text = String(value);
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function usageCsv(providers: ProviderUsage[], period: string, mode: Mode, observedAt: string, now: number) {
  const today = new Date(now).toISOString().slice(0, 10);
  const from = period === 'today' ? today : period === '7d' ? new Date(now - 6 * 86400000).toISOString().slice(0, 10) : null;
  const exportedAt = new Date(now).toISOString();
  const observation = mode === 'local' && Number.isFinite(Date.parse(observedAt)) ? new Date(observedAt).toISOString() : 'Not reported';
  const caveat = 'Recorded native-log observations, not billing. Coverage counts describe all observed history, independent of period. Coverage may be partial; missing daily records do not establish zero consumption. Input includes cache; output includes reasoning. Summary rows are deduplicated; daily rows exclude undated usage. Do not sum summary and daily rows.';
  const headers = ['row_type', 'provider', 'date_utc', 'observation', ...metricKeys, 'undated_tokens_all_history', 'logs_without_usage', 'partial_logs', 'source', 'period', 'observed_at_utc', 'exported_at_utc', 'caveats'];
  const rows: (string | number)[][] = [headers];
  function row(kind: string, provider: string, day: string, state: string, metrics: UsageMetrics, undated: number | null, unavailable: number, partial: number) {
    rows.push([kind, provider, day, state, ...metricKeys.map(key => metrics[key] ?? 'Not reported'), undated ?? 'Not reported', unavailable, partial, mode === 'demo' ? 'Demo sample data' : 'Local native logs', period, observation, exportedAt, caveat]);
  }
  const summaries = providers.map(item => periodMetrics(item, item.daily, period, now));
  row('summary', 'All selected providers', '', 'Selected summary', sumMetrics(summaries), providers.some(item => item.undatedTokens === null) ? null : providers.reduce((sum, item) => sum + (item.undatedTokens ?? 0), 0), providers.reduce((sum, item) => sum + item.unavailableCount, 0), providers.reduce((sum, item) => sum + item.partialCount, 0));
  for (const item of providers) {
    row('summary', providerLabel(item.provider), '', 'Selected summary', periodMetrics(item, item.daily, period, now), item.undatedTokens, item.unavailableCount, item.partialCount);
    const dates = from ? Array.from({ length: period === 'today' ? 1 : 7 }, (_, index) => new Date(Date.parse(`${from}T00:00:00Z`) + index * 86400000).toISOString().slice(0, 10)) : item.daily.map(day => day.day).sort();
    for (const day of dates) {
      const record = item.daily.find(value => value.day === day);
      row('daily', providerLabel(item.provider), day, !record ? 'No recorded usage' : record.totalTokens === null ? 'Not reported' : 'Recorded', record ?? sumMetrics([]), null, item.unavailableCount, item.partialCount);
    }
  }
  return '\uFEFF' + rows.map(values => values.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
