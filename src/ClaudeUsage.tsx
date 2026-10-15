import { useCallback, useEffect, useRef, useState } from 'react';
import { SectionHeading } from './components';
import { HistoricalLimitReport, LimitWindows, limitReportIsOld, ProviderLimitCard } from './ProviderLimitCard';
import type { LimitSnapshot, Mode } from './types';

interface AccountUsage {
  status: 'available' | 'unavailable' | 'error';
  limits: LimitSnapshot | null;
  fetchedAt: string | null;
  reason?: string;
}
const nativeHelp = 'Use Claude /usage or sign in normally with Claude Code.';

function LocalClaudeUsage({ snapshot }: { snapshot: LimitSnapshot | null }) {
  const [result, setResult] = useState<AccountUsage | null>(null);
  const [busy, setBusy] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async (refresh = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setCooldownUntil(Date.now() + 10000);
    try {
      const response = await fetch('/api/claude-usage' + (refresh ? '?refresh=1' : ''), { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
      if (!response.ok) throw new Error('Account usage request failed');
      const data = await response.json() as AccountUsage;
      if (!data || !['available', 'unavailable', 'error'].includes(data.status) || (data.status === 'available' && (!data.limits || !Array.isArray(data.limits.windows) || !data.fetchedAt))) throw new Error('Invalid account usage response');
      if (!controller.signal.aborted) setResult(data);
      return data.fetchedAt;
    } catch {
      if (!controller.signal.aborted) setResult({ status: 'error', limits: null, fetchedAt: null, reason: 'Account usage could not be read. ' + nativeHelp });
    } finally {
      if (!controller.signal.aborted) { setBusy(false); setClock(Date.now()); }
    }
  }, []);
  useEffect(() => {
    let stopped = false, poll = 0;
    async function pollAccount() {
      const fetchedAt = document.hidden ? null : await load();
      const delay = fetchedAt && Number.isFinite(Date.parse(fetchedAt)) ? Math.max(1000, 60000 - (Date.now() - Date.parse(fetchedAt)) + 250) : 60000;
      if (!stopped) poll = window.setTimeout(() => void pollAccount(), delay);
    }
    void pollAccount();
    const tick = window.setInterval(() => setClock(Date.now()), 1000);
    return () => { stopped = true; window.clearTimeout(poll); window.clearInterval(tick); request.current?.abort(); };
  }, [load]);
  const fetched = Date.parse(result?.fetchedAt || '');
  const recent = Number.isFinite(fetched) && clock - fetched < 60000 && fetched <= clock + 60000;
  const windows = result?.status === 'available' && recent ? result.limits?.windows.filter(window => typeof window.usedPercent === 'number' && Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100 && window.resetsAt && Date.parse(window.resetsAt) > clock) || [] : [];
  const current = windows.length && result?.limits ? { ...result.limits, windows } : null;
  const staleLog = snapshot && (limitReportIsOld(snapshot, clock) || snapshot.windows.some(window => window.resetsAt && Date.parse(window.resetsAt) <= clock));
  const reason = typeof result?.reason === 'string' ? result.reason : '';
  const unavailableHelp = /\/usage|sign in/i.test(reason) ? reason : `${reason} ${nativeHelp}`;
  return <section className="panel limit-card" role="region" aria-label="Claude account usage" aria-busy={busy}>
    <SectionHeading title="Claude limits" action={<span className="usage-tag">Account usage</span>} />
    <button className="button secondary" type="button" disabled={busy || clock < cooldownUntil} onClick={() => void load(true)} title={clock < cooldownUntil ? 'Account refresh has a 10-second cooldown.' : 'Read current Claude account usage'}>Refresh account usage</button>
    <div aria-live="polite">
      {current ? <LimitWindows provider="claude" snapshot={current} account /> : <p className="usage-unavailable">{busy && !result ? 'Checking account usage…' : staleLog || result?.status === 'available' ? 'Waiting for a fresh report' : 'Account usage unavailable'}</p>}
      {!current && result && <p className="field-help">{result.status === 'available' ? 'The account report expired or its window reset. Current usage is unknown. ' + nativeHelp : unavailableHelp}</p>}
      {busy && result && <p className="field-help">Refreshing account usage…</p>}
    </div>
    <p className="field-help">Source: Account usage. {current ? 'Fetched from your native Claude account login; cached for up to 60 seconds.' : 'No current quota percentage is available.'}</p>
    {snapshot && <HistoricalLimitReport provider="claude" snapshot={snapshot} />}
  </section>;
}

export function ClaudeUsage({ snapshot, mode }: { snapshot: LimitSnapshot | null; mode: Mode }) {
  return mode === 'demo' ? <ProviderLimitCard provider="claude" snapshot={snapshot} mode={mode} /> : <LocalClaudeUsage snapshot={snapshot} />;
}
