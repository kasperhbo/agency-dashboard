import type { UsageDay, UsageMetrics } from './types';

export const metricKeys: (keyof UsageMetrics)[] = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'];
export function sumMetrics(items: UsageMetrics[]): UsageMetrics {
  return Object.fromEntries(metricKeys.map(key => {
    const known = items.map(item => item[key]).filter((value): value is number => value !== null);
    return [key, known.length ? known.reduce((sum, value) => sum + value, 0) : null];
  })) as unknown as UsageMetrics;
}
export function periodMetrics(all: UsageMetrics, daily: UsageDay[], period: string): UsageMetrics {
  if (period === 'all') return all;
  const today = new Date().toISOString().slice(0, 10);
  const from = period === 'today' ? today : new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  return sumMetrics(daily.filter(day => day.day >= from && day.day <= today));
}
export const exactTokens = (number: number | null | undefined) => number == null ? 'Not reported' : number.toLocaleString('en');
export const utcTime = (date: string) => new Date(date).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }) + ' UTC';
