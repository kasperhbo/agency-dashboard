import type { Provider, ProviderUsage, UsageDay, UsageMetrics } from './types';

export const metricKeys: (keyof UsageMetrics)[] = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'];
export function sumMetrics(items: UsageMetrics[]): UsageMetrics {
  return Object.fromEntries(metricKeys.map(key => {
    const known = items.map(item => item[key]).filter((value): value is number => value !== null);
    return [key, known.length ? known.reduce((sum, value) => sum + value, 0) : null];
  })) as unknown as UsageMetrics;
}
export function periodMetrics(all: UsageMetrics, daily: UsageDay[], period: string, now = Date.now()): UsageMetrics {
  if (period === 'all') return all;
  const today = new Date(now).toISOString().slice(0, 10);
  const from = period === 'today' ? today : new Date(now - 6 * 86400000).toISOString().slice(0, 10);
  return sumMetrics(daily.filter(day => day.day >= from && day.day <= today));
}
export const exactTokens = (number: number | null | undefined) => number == null ? 'Not reported' : number.toLocaleString('en');
export const utcTime = (date: string) => new Date(date).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }) + ' UTC';

export interface DailyUsageValue {
  provider: Provider;
  tokens: number | null;
  observation: 'recorded' | 'unreported' | 'absent';
}
export interface DailyUsageBucket {
  day: string;
  values: DailyUsageValue[];
  total: number | null;
  incomplete: boolean;
}
export function dailyUsageBuckets(providers: ProviderUsage[], now = Date.now()): DailyUsageBucket[] {
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(now - (6 - index) * 86400000).toISOString().slice(0, 10);
    const values = providers.map(provider => {
      const row = provider.daily.find(item => item.day === day);
      return { provider: provider.provider, tokens: row?.totalTokens ?? null, observation: !row ? 'absent' : row.totalTokens === null ? 'unreported' : 'recorded' } as DailyUsageValue;
    });
    const known = values.filter(value => value.tokens !== null);
    return { day, values, total: known.length ? known.reduce((sum, value) => sum + value.tokens!, 0) : null, incomplete: known.length !== values.length };
  });
}
export function dailyUsageValueLabel(value: DailyUsageValue) {
  return value.observation === 'absent' ? 'No recorded usage' : value.tokens === null ? 'Not reported' : `${exactTokens(value.tokens)} recorded tokens`;
}
export function dailyUsageTotalLabel(bucket: DailyUsageBucket) {
  if (bucket.total === null) return bucket.values.some(value => value.observation === 'unreported') ? 'Not reported' : 'No recorded usage';
  return `${exactTokens(bucket.total)} recorded tokens${bucket.incomplete ? ' · partial observations' : ''}`;
}
