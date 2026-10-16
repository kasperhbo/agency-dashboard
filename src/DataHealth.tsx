import { RefreshCw, Settings2 } from 'lucide-react';
import { ProviderMark, SectionHeading } from './components';
import { providerLabel, type Mode, type Session, type Source } from './types';
import './data-health.css';

type HealthState = 'unknown' | 'error' | 'not_found' | 'stale' | 'partial' | 'empty' | 'observed' | 'sample';
const labels: Record<HealthState, string> = { unknown: 'Not observed / unknown', error: 'Read error', not_found: 'Not found', stale: 'Stale observation', partial: 'Partial observation', empty: 'Observed empty', observed: 'Observed', sample: 'Demo sample' };

function ObservationTime({ value, now }: { value: string; now: number }) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return <>Not reported</>;
  const iso = new Date(parsed).toISOString();
  const seconds = Math.max(0, Math.floor((now - parsed) / 1000));
  const age = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 86400)}d`;
  return <time dateTime={iso}>{iso.slice(0, 10)} {iso.slice(11, 19)} UTC · {age} ago</time>;
}

export function DataHealthPage({ mode, sources, sessions, tasksCount, scannedAt, tasksReadAt, tasksUpdatedAt, sessionError, taskError, loading, refreshing, now, onRefresh, onOpenSettings }: {
  mode: Mode; sources: Source[]; sessions: Session[]; tasksCount: number; scannedAt: string; tasksReadAt: string; tasksUpdatedAt: string;
  sessionError: string; taskError: string; loading: boolean; refreshing: boolean; now: number; onRefresh: () => void; onOpenSettings: () => void;
}) {
  const demo = mode === 'demo';
  const sessionsObserved = Number.isFinite(Date.parse(scannedAt));
  const tasksObserved = Number.isFinite(Date.parse(tasksReadAt));
  const sessionStale = sessionsObserved && now - Date.parse(scannedAt) > 120000;
  const taskStale = tasksObserved && now - Date.parse(tasksReadAt) > 120000;
  const coverage = { complete: 0, partial: 0, unavailable: 0, unknown: 0 };
  for (const session of sessions) {
    const reported = session.usage?.coverage;
    coverage[reported === 'complete' || reported === 'partial' || reported === 'unavailable' ? reported : 'unknown']++;
  }
  const taskState: HealthState = demo ? 'sample' : taskError ? 'error' : !tasksObserved ? 'unknown' : taskStale ? 'stale' : tasksCount === 0 ? 'empty' : 'observed';
  const coverageState: HealthState = demo ? 'sample' : !sessionsObserved ? 'unknown' : sessionError ? 'error' : sessionStale ? 'stale' : sessions.length === 0 ? 'empty' : coverage.unknown === sessions.length ? 'unknown' : coverage.partial || coverage.unavailable || coverage.unknown ? 'partial' : 'observed';
  return <div className="data-health">
    <div className="data-health-actions"><button type="button" className="button secondary" disabled={demo || refreshing} onClick={onRefresh}><RefreshCw size={15} className={refreshing ? 'spin' : ''} />{refreshing && !demo ? 'Refreshing observations…' : 'Refresh observations'}</button><button type="button" className="button secondary" onClick={onOpenSettings}><Settings2 size={15} />Open source settings</button></div>
    <p className="info-note">{demo ? 'Demo sample data only. Local source paths, errors, and observation timestamps are not shown. Select Local workspace in Settings to inspect this server’s observations.' : 'These are the observations currently held in this browser. A readable source does not confirm where your CLI writes, a running process, or complete history. Checks occur every 10 seconds while visible; observations older than 2 minutes are marked stale.'}</p>
    <section aria-label="Provider observations"><SectionHeading title="Provider observations" description={demo ? 'Sample session records, not local source diagnostics.' : 'Directory availability and counts from the last successful workspace snapshot.'} /><div className="data-health-grid">
      {(['claude', 'codex'] as const).map(provider => {
        const source = demo ? undefined : sources.find(item => item.provider === provider);
        const partial = !!source && (source.limited || source.warnings.length > 0);
        const state: HealthState = demo ? 'sample' : sessionError ? 'error' : !sessionsObserved || !source ? 'unknown' : source.status === 'not_found' ? 'not_found' : source.status === 'error' ? 'error' : sessionStale ? 'stale' : partial ? 'partial' : source.count === 0 ? 'empty' : 'observed';
        return <article key={provider} className="panel data-health-panel" aria-label={`${providerLabel(provider)} source observation`} data-state={state}>
          <h3><ProviderMark provider={provider} small />{providerLabel(provider)}</h3><p className="data-health-state" role="status">{labels[state]}</p>
          {demo ? <p>{sessions.filter(session => session.provider === provider).length} sample session records. No local directory observation is implied.</p> : <>
            <dl><div><dt>Directory status</dt><dd>{!source ? 'Not reported' : source.status === 'connected' ? 'Connected (directory readable)' : source.status === 'not_found' ? 'Not found' : 'Read error'}</dd></div><div><dt>Parsed session records</dt><dd>{sessionsObserved && source?.status === 'connected' ? source.count : 'Not reported'}</dd></div><div><dt>Unique sessions reported</dt><dd>{sessionsObserved && source?.status === 'connected' ? source.sessionCount ?? 'Not reported' : 'Not reported'}</dd></div><div><dt>Subagents reported</dt><dd>{sessionsObserved && source?.status === 'connected' ? source.subagentCount ?? 'Not reported' : 'Not reported'}</dd></div></dl>
            <p className="field-help">Resolved directory: {source?.path || 'Not reported'}</p>
            <p className="field-help">Last successful workspace observation: <ObservationTime value={scannedAt} now={now} />. This is a snapshot time, not agent activity.</p>
            {loading && !sessionsObserved && <p>Reading session observations. Availability is not yet known.</p>}
            {sessionError && <p className="info-note">Session refresh failed: {sessionError}. {sessionsObserved ? 'Showing retained source observations and counts; current availability is unconfirmed.' : 'No successful session observation is available.'}</p>}
            {!source && <p>No source observation was returned for this provider.</p>}
            {source?.status === 'not_found' && <p>The configured directory was not found. This does not establish that no sessions exist elsewhere.</p>}
            {source?.status === 'error' && <p>The configured source could not be read; its current history is unavailable.</p>}
            {source?.status === 'connected' && source.count === 0 && <p>The directory was readable but had no observed logs in this scan. This does not establish that no sessions exist.</p>}
            {sessionStale && <p>The retained source observation is stale.</p>}
            {source?.limited && <p>Scan limits were reached. Source history is partial.</p>}
            {!!source?.warnings.length && <ul className="data-health-warnings" aria-label={`${providerLabel(provider)} source warnings`}>{source.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          </>}
        </article>;
      })}
    </div></section>
    <section className="panel data-health-panel" aria-label="Task data observation" data-state={taskState}>
      <SectionHeading title="Task data" description={demo ? 'Sample task board in this browser.' : 'Task list reads are tracked independently from session discovery.'} /><p className="data-health-state" role="status">{labels[taskState]}</p>
      <dl><div><dt>{demo ? 'Sample tasks' : 'Tasks in retained browser state'}</dt><dd>{demo || tasksObserved ? tasksCount : 'Not reported'}</dd></div>{!demo && <><div><dt>Last successful task list read</dt><dd><ObservationTime value={tasksReadAt} now={now} /></dd></div><div><dt>Last confirmed task update</dt><dd><ObservationTime value={tasksUpdatedAt} now={now} /></dd></div></>}</dl>
      {!demo && <>
        {!tasksObserved && <p>No task list has been successfully read. An empty browser array is not evidence of an empty task file.</p>}
        {tasksObserved && tasksCount === 0 && <p>The last confirmed browser task state is empty.</p>}
        {taskError && <p className="info-note">Task list read failed: {taskError}. {tasksObserved ? 'Retained tasks may be outdated.' : 'Task availability is unknown.'}</p>}
        {taskStale && <p>The last successful task list read is stale.</p>}
        <p className="field-help">The browser state can include confirmed writes after its list read. A recent task update does not renew list-read freshness; unconfirmed writes are excluded. This is not an atomic disk snapshot.</p>
      </>}
    </section>
    <section className="panel data-health-panel" aria-label="Loaded session usage coverage" data-state={coverageState}>
      <SectionHeading title="Loaded session usage coverage" description={demo ? 'Reported coverage among sample session records only.' : 'Reported usage coverage among currently loaded session records, not all history.'} /><p className="data-health-state" role="status">{labels[coverageState]}</p>
      <dl>{([['Loaded session records', sessions.length], ['Complete usage coverage reported', coverage.complete], ['Partial usage coverage reported', coverage.partial], ['Usage unavailable reported', coverage.unavailable], ['Coverage not reported (unknown)', coverage.unknown]] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{demo || sessionsObserved ? count : 'Not reported'}</dd></div>)}</dl>
      {!demo && !sessionsObserved && <p>Session data has not been successfully observed. Usage coverage is unknown.</p>}
      {!demo && sessionError && sessionsObserved && <p>Session refresh failed; coverage describes retained records.</p>}
      {!demo && sessionStale && <p>Coverage describes a stale loaded snapshot.</p>}
      <p className="field-help">Missing coverage stays unknown; unavailable and partial are separate reported states. “Complete” describes the loaded record’s parser coverage, not complete discovery, actual billing, or a live process. Counts are session records, not deduplicated workspace token totals.</p>
    </section>
  </div>;
}
