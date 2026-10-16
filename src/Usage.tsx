import { useEffect, useState } from 'react';
import { ArrowUpRight, Info, Layers3, Timer, Zap } from 'lucide-react';
import { ProviderMark, SectionHeading } from './components';
import { ClaudeUsage } from './ClaudeUsage';
import { ProviderLimitCard } from './ProviderLimitCard';
import { useObservationClock } from './useObservationClock';
import { compact, providerLabel, shortModel, type Mode, type Session, type UsageReport, type ProviderUsage } from './types';
import { usageCsv } from './usage-export';
import { dailyUsageBuckets, dailyUsageTotalLabel, dailyUsageValueLabel, exactTokens, periodMetrics, sumMetrics, utcTime } from './usage-view';

function DailyUsageChart({ providers, now }: { providers: ProviderUsage[]; now: number }) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [previewDay, setPreviewDay] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const buckets = dailyUsageBuckets(providers, now);
  const dates = buckets.map(bucket => bucket.day).join(',');
  useEffect(() => {
    if (selectedDay && !dates.split(',').includes(selectedDay)) {
      setSelectedDay(null);
      setNotice('The selected date is outside the current chart window. Selection cleared.');
    }
  }, [dates, selectedDay]);
  const selected = buckets.find(bucket => bucket.day === (previewDay || selectedDay));
  const max = Math.max(1, ...buckets.map(bucket => bucket.total ?? 0));
  function reset() { setSelectedDay(null); setPreviewDay(null); setNotice('Selection cleared.'); }
  return <section className="panel usage-days" onKeyDown={event => { if (event.key === 'Escape') reset(); }}>
    <SectionHeading title="Recorded tokens by day" description="Fixed last 7 calendar days · UTC · independent of summary period · undated usage excluded" action={<button className="text-button chart-reset" onClick={reset} aria-label="Reset daily usage selection">Reset selection</button>} />
    <div className="usage-day-bars" aria-label="Daily recorded usage">
      {buckets.map(bucket => <button type="button" className="usage-day" key={bucket.day} aria-pressed={selectedDay === bucket.day} aria-label={`${bucket.day} UTC: ${bucket.values.map(value => `${providerLabel(value.provider)}: ${dailyUsageValueLabel(value)}`).join('; ')}`} onFocus={() => { setSelectedDay(bucket.day); setPreviewDay(null); setNotice(''); }} onClick={() => { setSelectedDay(bucket.day); setPreviewDay(null); setNotice(''); }} onMouseEnter={() => setPreviewDay(bucket.day)} onMouseLeave={() => setPreviewDay(null)}>
        <span className="usage-day-total">{bucket.total === null ? '—' : compact(bucket.total)}{bucket.total !== null && bucket.incomplete ? '*' : ''}</span>
        <span className="usage-day-stack" aria-hidden="true">{bucket.values.map(value => <span key={value.provider} className={`usage-day-bar ${value.provider}`} style={{ height: `${(value.tokens ?? 0) / max * 100}%` }} />)}</span>
        <span>{new Date(bucket.day + 'T12:00:00Z').toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' })}</span>
      </button>)}
    </div>
    <div className="chart-legend">{providers.map(item => <span key={item.provider}><i className={`${item.provider}-dot`} />{providerLabel(item.provider)}</span>)}</div>
    <div className="chart-selection" role="region" aria-label="Daily usage details" aria-live="polite">
      {selected ? <><strong>{selected.day} UTC</strong><p>{dailyUsageTotalLabel(selected)}</p><dl className="chart-selection-details">{selected.values.map(value => <div key={value.provider}><dt>{providerLabel(value.provider)}: </dt><dd>{dailyUsageValueLabel(value)}</dd></div>)}</dl></> : <p>{notice || 'Select a day for exact recorded usage.'}</p>}
    </div>
    <p className="field-help">* Partial observations: some provider values are unavailable. No recorded usage means no dated record, not zero consumption. Log coverage may be partial.</p>
    <details className="chart-data"><summary>View daily usage data</summary><div className="usage-table-scroll" role="region" aria-label="Daily usage data table" tabIndex={0}><table className="sessions-table"><caption>Daily recorded usage · UTC</caption><thead><tr><th scope="col">Date (UTC)</th>{providers.map(item => <th scope="col" key={item.provider}>{providerLabel(item.provider)}</th>)}<th scope="col">Recorded total</th></tr></thead><tbody>{buckets.map(bucket => <tr key={bucket.day}><th scope="row">{bucket.day}</th>{bucket.values.map(value => <td key={value.provider}>{dailyUsageValueLabel(value)}</td>)}<td>{dailyUsageTotalLabel(bucket)}</td></tr>)}</tbody></table></div></details>
  </section>;
}

export function UsageDashboard({ report, sessions, mode, observedAt, onOpen }: { report: UsageReport | undefined; sessions: Session[]; mode: Mode; observedAt: string; onOpen: (session: Session) => void }) {
  const now = useObservationClock();
  const [period, setPeriod] = useState('all');
  const [provider, setProvider] = useState('all');
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState('usage');
  const [coverage, setCoverage] = useState('all');
  if (!report) return <section className="panel"><SectionHeading title="Usage & limits" /><p className="usage-unavailable">Usage details are not available from this server response. Refresh the workspace to read supported native logs.</p></section>;
  const providers = report.providers.filter(item => provider === 'all' || item.provider === provider);
  const totals = sumMetrics(providers.map(item => periodMetrics(item, item.daily, period, now)));
  const runs = sessions.filter(session => provider === 'all' || session.provider === provider).filter(session => coverage === 'all' || (session.usage?.coverage || 'unavailable') === coverage).filter(session => period === 'all' || (session.usage?.daily || []).some(day => day.totalTokens !== null && periodMetrics(day, [day], period, now).totalTokens !== null)).map(session => ({ session, totals: session.usage ? periodMetrics(session.usage, session.usage.daily, period, now) : null })).sort((a, b) => sort === 'recent' ? b.session.updatedAt.localeCompare(a.session.updatedAt) : (b.totals?.totalTokens ?? -1) - (a.totals?.totalTokens ?? -1));
  const duplicates = providers.reduce((sum, item) => sum + item.duplicateRecordsRemoved, 0);
  const duplicateThreads = providers.reduce((sum, item) => sum + item.duplicateThreadsRemoved, 0);
  const missing = providers.reduce((sum, item) => sum + item.unavailableCount, 0);
  const partial = providers.reduce((sum, item) => sum + item.partialCount, 0);
  function exportUsage() {
    const exportedAt = Date.now();
    const url = URL.createObjectURL(new Blob([usageCsv(providers, period, mode, observedAt, exportedAt)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'agency-usage-' + mode + '-' + period + '-' + new Date(exportedAt).toISOString().slice(0, 10) + '.csv';
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="usage-dashboard">
    <div className="usage-toolbar"><div><h2>Usage & limits</h2><p>{mode === 'demo' ? 'Sample usage for exploring the dashboard.' : 'Recorded native-log usage, with coverage and source timestamps.'}</p></div><div><button type="button" className="button secondary" disabled={!providers.length} onClick={exportUsage}>Export CSV</button><select aria-label="Usage provider" value={provider} onChange={event => { setProvider(event.target.value); setLimit(20); }}><option value="all">Both providers</option><option value="claude">Claude</option><option value="codex">Codex</option></select><select aria-label="Usage period" value={period} onChange={event => { setPeriod(event.target.value); setLimit(20); }}><option value="all">All observed history</option><option value="today">Today (UTC)</option><option value="7d">Last 7 days (UTC)</option></select></div></div>
    <div className="usage-summary"><article className="panel"><span><Zap size={15} />Recorded tokens</span><strong title={exactTokens(totals.totalTokens)}>{compact(totals.totalTokens)}</strong><small>{period === 'all' ? 'Deduplicated observed history' : 'Dated usage only · UTC'}</small></article><article className="panel"><span><Layers3 size={15} />Input, including cache</span><strong title={exactTokens(totals.inputTokens)}>{compact(totals.inputTokens)}</strong><small>{compact(totals.cacheReadTokens)} cache read · {compact(totals.cacheWriteTokens)} cache write</small></article><article className="panel"><span><Timer size={15} />Output</span><strong title={exactTokens(totals.outputTokens)}>{compact(totals.outputTokens)}</strong><small>{compact(totals.reasoningTokens)} reasoning, included in output</small></article></div>
    <p className="usage-scope"><Info size={14} />{providers.reduce((sum, item) => sum + item.runCount, 0)} log files from {providers.reduce((sum, item) => sum + item.sessionCount, 0)} unique sessions and {providers.reduce((sum, item) => sum + item.subagentCount, 0)} subagents. {missing} without usage, {partial} partial. {duplicates} replayed responses removed from workspace totals. {duplicateThreads} duplicate thread logs excluded.</p>
    {providers.some(item => (item.undatedTokens ?? 0) > 0) && <p className="usage-scope">{compact(providers.reduce((sum, item) => sum + (item.undatedTokens ?? 0), 0))} tokens have no attributable date and appear only in all-history totals. An inherited initial counter is not assigned to today.</p>}
    <DailyUsageChart providers={providers} now={now} />
    <div className="usage-provider-grid">{providers.map(item => {
      const metrics = periodMetrics(item, item.daily, period, now);
      return <section className="panel usage-provider-card" key={item.provider}><SectionHeading title={`${providerLabel(item.provider)} breakdown`} action={<ProviderMark provider={item.provider} small />} /><dl className="usage-numbers"><div><dt>Input, including cache</dt><dd>{exactTokens(metrics.inputTokens)}</dd></div><div><dt>Output</dt><dd>{exactTokens(metrics.outputTokens)}</dd></div><div><dt>Cache read <small>part of input</small></dt><dd>{exactTokens(metrics.cacheReadTokens)}</dd></div><div><dt>Cache write <small>part of input</small></dt><dd>{exactTokens(metrics.cacheWriteTokens)}</dd></div><div><dt>Reasoning <small>part of output</small></dt><dd>{exactTokens(metrics.reasoningTokens)}</dd></div><div><dt>Total tokens</dt><dd>{exactTokens(metrics.totalTokens)}</dd></div></dl><p className="field-help">{item.withUsage} of {item.runCount} observed logs report usage. Cached and reasoning tokens are subsets, not extras added to the total. Unknown fields show “Not reported”.</p>{item.context && <div className="usage-context"><span>Reported context window <strong>{exactTokens(item.context.windowTokens)} tokens</strong></span><span>Last request <strong>{exactTokens(item.context.lastRequestTokens)} tokens</strong></span><small>{utcTime(item.context.reportedAt)} · Last request size is not a live context meter.</small></div>}</section>;
    })}</div>
    <div className="usage-provider-grid">{providers.map(item => item.provider === 'claude' ? <ClaudeUsage key={item.provider} snapshot={item.limits} mode={mode} /> : <ProviderLimitCard key={item.provider} provider={item.provider} snapshot={item.limits} mode={mode} />)}</div>
    <section className="panel usage-run-panel"><SectionHeading title="Usage by run" count={runs.length} description="Per-run values can overlap; workspace totals above remove replayed responses." action={<select aria-label="Sort usage runs" value={sort} onChange={event => setSort(event.target.value)}><option value="usage">Most tokens</option><option value="recent">Most recent</option></select>} /><label className="form-label">Run coverage<select aria-describedby="run-coverage-help" value={coverage} onChange={event => { setCoverage(event.target.value); setLimit(20); }}><option value="all">All coverage</option><option value="partial">Partial</option><option value="unavailable">Unavailable</option><option value="complete">Complete</option></select></label><p className="field-help" id="run-coverage-help">Coverage filters this run table only; summary, chart, and CSV retain their provider and period scope. Coverage describes the observed log, not an individual day. Runs without recorded dated usage are excluded from Today and Last 7 days, including unavailable and undated-only runs.</p><div className="usage-table-scroll" role="region" aria-label="Recorded usage by run" tabIndex={0}><table className="sessions-table usage-table"><thead><tr><th>Run</th><th>Input incl. cache</th><th>Cache read</th><th>Output</th><th>Total</th><th>Coverage</th><th>CLI estimate · not billing</th></tr></thead><tbody>{runs.slice(0, limit).map(({ session, totals: metrics }) => <tr key={session.id}><td><button className="table-session" onClick={() => onOpen(session)}><ProviderMark provider={session.provider} small /><span><strong>{session.kind === 'subagent' ? 'Subagent' : 'Session'} · {shortModel(session.model)}</strong><small>{session.project}</small></span><ArrowUpRight size={13} /></button></td><td>{exactTokens(metrics?.inputTokens)}</td><td>{exactTokens(metrics?.cacheReadTokens)}</td><td>{exactTokens(metrics?.outputTokens)}</td><td>{exactTokens(metrics?.totalTokens)}</td><td><span className={`usage-coverage ${session.usage?.coverage || 'unavailable'}`}>{session.usage?.coverage || 'unavailable'}</span></td><td>{session.usage?.costEstimate ? session.usage.costEstimate.amountUsd.toLocaleString('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }) : 'Not reported'}</td></tr>)}</tbody></table></div>{!runs.length && <div className="usage-unavailable"><p>{period === 'all' ? 'No runs match the selected provider and run coverage.' : 'No runs with recorded dated usage match the selected provider, period, and run coverage.'}</p>{coverage !== 'all' && <button type="button" className="button secondary" onClick={() => { setCoverage('all'); setLimit(20); }}>Reset run coverage</button>}</div>}{runs.length > limit && <button className="button secondary show-more" onClick={() => setLimit(limit + 20)}>Show more runs ({runs.length - limit} remaining)</button>}<p className="field-help">CLI cost estimates are whole-session snapshots, independent of the date filter. No account bill, subscription cost, or aggregate spend is inferred.</p></section>
  </div>;
}
