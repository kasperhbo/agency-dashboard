import { SectionHeading } from './components';
import { providerLabel, type LimitSnapshot, type Mode, type Provider } from './types';
import { utcTime } from './usage-view';

export function limitReportIsOld(snapshot: LimitSnapshot, now = Date.now()) {
  const reported = Date.parse(snapshot.reportedAt);
  return !Number.isFinite(reported) || now - reported > 20 * 60000 || reported > now + 60000;
}

export function LimitWindows({ provider, snapshot, historical = false, account = false }: { provider: Provider; snapshot: LimitSnapshot; historical?: boolean; account?: boolean }) {
  return <>
    <p className="limit-reported">{historical ? 'Historically reported' : account ? 'Fetched' : 'Reported'} {utcTime(snapshot.reportedAt)}{snapshot.plan && !account ? ` · ${snapshot.plan}` : ''}</p>
    {snapshot.windows.map((window, index) => {
      const expired = Boolean(window.resetsAt && Date.parse(window.resetsAt) <= Date.now());
      const label = window.windowMinutes ? window.windowMinutes >= 1440 ? `${window.windowMinutes / 1440}-day window` : `${window.windowMinutes / 60}-hour window` : window.label.replaceAll('_', ' ');
      const percent = typeof window.usedPercent === 'number' && Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100 ? window.usedPercent : null;
      return <div className="limit-window" key={index}>
        <div><strong>{label}</strong><span>{percent === null ? window.status ? `${historical ? 'Historical status: ' : 'Reported status: '}${window.status}` : 'Percentage not reported' : `${percent}% used${historical ? ' (historical)' : ''}`}</span></div>
        {percent !== null && <div className={`limit-track ${historical ? 'stale' : ''}`} role="meter" aria-label={`${providerLabel(provider)} ${label} ${account ? 'account usage' : historical ? 'historical usage' : 'last reported usage'}`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${percent}% ${historical ? 'historically reported, current usage unknown' : account ? 'account usage' : 'reported'}`}><span style={{ width: `${percent}%` }} /></div>}
        <p>{window.resetsAt ? `${account ? 'Resets' : 'Reported reset'}: ${utcTime(window.resetsAt)}` : 'Reset time not reported.'}</p>
        {expired && <span className="usage-stale">Reset time passed. Current usage is unknown.</span>}
        {percent === null && <p>The source supplies a status, not a quota percentage.</p>}
      </div>;
    })}
    {snapshot.credits && <p className="credit-snapshot">Reported credit balance: <strong>{snapshot.credits.unlimited ? 'Unlimited' : snapshot.credits.balance ?? 'Not reported'}</strong></p>}
  </>;
}

export function HistoricalLimitReport({ provider, snapshot }: { provider: Provider; snapshot: LimitSnapshot }) {
  return <details className="field-help"><summary>Historical log report</summary>
    <p>Historical log observation. This is not current account usage.</p>
    <LimitWindows provider={provider} snapshot={snapshot} historical />
    <p>Source: {snapshot.source}.</p>
  </details>;
}

export function ProviderLimitCard({ provider, snapshot, mode }: { provider: Provider; snapshot: LimitSnapshot | null; mode: Mode }) {
  const old = snapshot ? limitReportIsOld(snapshot) : false;
  const currentWindows = snapshot?.windows.filter(window => !old && (!window.resetsAt || Date.parse(window.resetsAt) > Date.now())) || [];
  const historicalWindows = snapshot?.windows.filter(window => !currentWindows.includes(window)) || [];
  return <section className="panel limit-card"><SectionHeading title={`${providerLabel(provider)} limits`} action={<span className="usage-tag">{mode === 'demo' ? 'Sample' : 'Log snapshot'}</span>} />
    {!snapshot ? <p className="usage-unavailable">No quota snapshot was found. This does not mean unlimited usage.</p> : <>
      {!currentWindows.length && <p className="usage-unavailable">Waiting for a fresh report</p>}
      {!!currentWindows.length && <LimitWindows provider={provider} snapshot={{ ...snapshot, windows: currentWindows }} />}
      {!!historicalWindows.length && <>
        <p className="usage-stale">{old ? 'This log report is old. Current usage is unknown.' : 'This log window has reset. Current usage is unknown.'}</p>
        <HistoricalLimitReport provider={provider} snapshot={{ ...snapshot, windows: historicalWindows }} />
      </>}
      <p className="field-help">Source: {snapshot.source}. These are last-reported values, not a live account query.</p>
    </>}
  </section>;
}
