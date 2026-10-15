import type { SessionUsage } from './types';
import { exactTokens, utcTime } from './usage-view';

export function UsageNumbers({ usage }: { usage: SessionUsage | undefined }) {
  if (!usage) return <p className="info-note">No supported token-usage records were found in this log. Missing usage is not zero usage.</p>;
  return <section className="session-usage-details"><h3>Recorded usage</h3>{usage.coverage === 'unavailable' ? <p className="info-note">No supported token-usage records were found in this log. Missing usage is not zero usage.</p> : <><dl className="usage-numbers">
    <div><dt>Input, including cache</dt><dd>{exactTokens(usage.inputTokens)}</dd></div>
    <div><dt>Output</dt><dd>{exactTokens(usage.outputTokens)}</dd></div>
    <div><dt>Cache read <small>included in input</small></dt><dd>{exactTokens(usage.cacheReadTokens)}</dd></div>
    <div><dt>Cache write <small>included in input</small></dt><dd>{exactTokens(usage.cacheWriteTokens)}</dd></div>
    <div><dt>Reasoning <small>included in output</small></dt><dd>{exactTokens(usage.reasoningTokens)}</dd></div>
    <div><dt>Total tokens</dt><dd>{exactTokens(usage.totalTokens)}</dd></div>
  </dl><p className="field-help">{usage.coverage === 'partial' ? 'Partial log coverage; these values are a lower bound.' : 'Counts from the supported records in this run’s log.'}{usage.undatedTokens > 0 ? ` ${exactTokens(usage.undatedTokens)} tokens have no attributable date.` : ''}</p></>}
  {usage.context && <div className="usage-context"><span>Reported model context window <strong>{exactTokens(usage.context.windowTokens)}</strong></span><span>Last request <strong>{exactTokens(usage.context.lastRequestTokens)}</strong></span><small>{utcTime(usage.context.reportedAt)} · Last-request size is not a live context meter.</small></div>}
  {usage.costEstimate && <div className="cli-estimate"><span>Claude CLI cost estimate</span><strong>{usage.costEstimate.amountUsd.toLocaleString('en', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })}</strong><small>{usage.costEstimate.incomplete ? 'The CLI reports unknown model costs. ' : ''}Recorded estimate, not an invoice. Never summed across runs. {usage.costEstimate.timeBasis === 'preceding-log' ? 'Nearest preceding log time: ' : 'Log time: '}{utcTime(usage.costEstimate.reportedAt)}</small></div>}
  {usage.issues.map(issue => <p className="warning-note" key={issue}>{issue}</p>)}</section>;
}
