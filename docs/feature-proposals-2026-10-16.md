# Feature discovery and proof-of-concept proposals

Date: 2026-10-16. Owner: Feature Dev. Reviewers: Frontend Developer and Engineering Senior Developer. Status: proposals and interface sketch only; none of these features has been implemented by this document.

## Evidence and boundaries

The application already supports local/demo separation, task revisions and atomic writes, project workspaces, linked follow-ups, accessible usage inspection, CSV export, source warnings, refresh recovery, and network views. These proposals extend those seams rather than replace them. Evidence: `README.md`, `TODO.md`, `docs/dashboard-review-2026-10-16.md`, `docs/production-readiness-2026-10-16.md`, `src/Pages.tsx`, `src/Projects.tsx`, `src/Usage.tsx`, `src/useWorkspace.ts`, and `src/types.ts`.

The recent missing-Codex-session incident came from the running server reading a different Windows account's directory. A readable directory can be connected while omitting the user's expected session. Restarting with the correct source resolved that incident; this does not establish a parser defect or a need for a source configurator. Source paths, status, counts, and warnings already appear in Settings. The next improvement should explain these observations where users recover, not create another diagnostics page.

All sizes below are planning estimates in focused engineering days, including relevant tests, not delivery commitments. No proposal requires a new dependency. Public hosting, authentication, billing, native execution, lifecycle hooks, cross-account discovery, and offline mutation remain outside scope.

## Ranked shortlist

| Rank | Proposal | Why now | Size |
| --- | --- | --- | --- |
| 1 | Guided connection diagnostics in existing Settings | Directly addresses the demonstrated source-directory confusion without changing discovery | 0.5–1 day |
| 2 | Coverage-focused usage run filter | Makes existing partial/unavailable evidence actionable without inventing accounting | 0.5–1 day |
| 3 | Task-board priority filter and ordering | Helps select the next task using existing priorities and overview ordering | 0.5–1 day |
| 4 | Local task backup download | Provides an accessible copy of planned work, with privacy and restore-expectation costs | 1 day |
| 5 | Retained session-event timeline | Makes observed history easier to inspect, but cannot supply missing lifecycle evidence | 1 day |
| 6 | Remember Agents filters and view per workspace | Reduces navigation friction, with preference lifecycle cost; convenience rather than demonstrated failure | 0.5–1 day |

## Proposal details

### 1. Guided connection diagnostics — recommended local PoC

**Problem:** “Connected” can be mistaken for “my current CLI session must be present.” Starting another session or waiting does not correct a wrong-account source root.

**Reuse:** Extend `SettingsPage`'s existing Agent connections section and Check connections action in `src/Pages.tsx`. Pass existing `sessions` and `scannedAt` from `src/App.tsx` / `useWorkspace`; use `Source.path/status/count/limited/warnings` and supported `Session.lastActivityAt`. Existing source paths remain displayed locally. Do not add a source-origin enum or endpoint merely for this PoC.

**Observable acceptance:** Each provider distinguishes directory readability, count of observed logs, snapshot observation time, and latest supported activity. Missing timestamps say “Not reported”; file modification times must not masquerade as native activity. A native disclosure explains root comparison and restart steps. Connected-empty, connected-stale, missing, failed, and demo states never promise that waiting will reveal a session. The interface must not diagnose an account mismatch from absence or age alone.

**Tradeoffs:** A little additional Settings text is preferable to a new page. Latest activity is limited to selected/scanned logs and can remain unknown. Browser UI cannot know which account or environment launched the CLI; root provenance cannot be inferred from a path. No automatic detection claim is justified.

**Provenance prerequisite:** Before implementation, trace how the parser populates `lastActivityAt` and any timestamp-source fields. The field name alone does not prove native-log provenance. If the existing payload cannot substantiate supported log activity separately from file fallback, omit that activity display or label it Not reported; do not invent a provenance distinction. The remainder of the diagnostic PoC still works with source and snapshot observations.

**Dependencies/permissions:** Existing data only; no new package, filesystem access, command execution, network destination, or permission. Environment changes and server restarts remain explicit operator actions, outside this proposed UI.

### 2. Coverage-focused usage run filter

**Problem:** Coverage warnings exist, but users must inspect many rows to find incomplete or unavailable logs.

**Reuse:** `UsageDashboard`'s run selection/table and `Session.usage.coverage` plus existing per-session detail. Add a native “Run coverage” select with All / Partial / Unavailable / Complete. Missing usage maps to unavailable, matching the existing table display.

**Observable acceptance:** Provider, date, and coverage filters compose; changing coverage resets pagination. Filtering rows does not change deduplicated workspace summaries, daily chart, or existing aggregate CSV scope. Label the control “Run coverage” so that distinction is explicit. Unknown values remain unknown. Empty results provide a clear reset.

**Tradeoffs:** More toolbar surface; does not reconstruct ignored records or expand scan caps. Date filters can legitimately exclude unavailable logs without dated evidence; explain this rather than assigning them to today.

**Dependencies/permissions:** Existing report/session fields and controls; no new API or permissions. Focused browser fixture verifies composition and unchanged summary/CSV accounting.

### 3. Task-board priority filter and ordering

**Problem:** The board preserves storage order, making urgent work harder to find when many tasks share a column.

**Reuse:** `TasksPage` in `src/Pages.tsx`, existing task priorities, and the overview's status/priority ranking. If ranking is shared, extract the existing rule rather than duplicate it. Use native selects for priority and explicit priority/recent ordering.

**Observable acceptance:** Each board column obeys the chosen deterministic ordering; equal priorities have a stable recency/id tie-break. Provider/search/priority filters compose and reset clearly. Read-only ordering never changes persisted task arrays, revisions, or updated timestamps. Empty columns and keyboard operation remain usable.

**Tradeoffs:** Explicit controls add UI density. User-selected ordering must be visible so rows moving after edits are understandable. No drag-and-drop ordering or schema change.

**Dependencies/permissions:** Existing tasks and native controls; no server mutation or new permission. Test mixed priority/status fixture, tied values, and unchanged stored revisions.

### 4. Local task backup download

**Problem:** Local tasks require manually copying `.agency/tasks.json`; demo tasks reside only in browser storage.

**Reuse:** Existing loaded tasks and the browser Blob/download pattern used by usage CSV. Export a versioned JSON document containing workspace kind, export time, and task data. Do not read server files from the browser or imply that loaded data is a complete disk snapshot during a fetch error.

**Observable acceptance:** Export includes only the active workspace's successfully loaded tasks, with an explicit source and load-time context. Local export is disabled until a successful task read; a stale snapshot is clearly labeled if allowed. Titles, descriptions, timestamps, links, and revisions round-trip through JSON serialization unchanged. Demo/local records never mix.

**Tradeoffs:** Task text can contain sensitive information; explain that the download contains task contents before activation. A download is not a tested restore system. Restore/import requires separate schema, conflict, revision, and rollback design and is excluded. Browser-mediated download does not provide a scheduled backup guarantee.

**Dependencies/permissions:** Native browser download only, initiated by the user. No external upload, filesystem enumeration, storage migration, or import endpoint.

### 5. Retained session-event timeline

**Problem:** Users may struggle to distinguish recent observed activity from an inferred status summary.

**Reuse:** Existing session detail and `Session.events` with timestamps/kinds; first check whether existing event presentation already meets the desired reading flow. Add a chronological/timestamp inspection only if that review demonstrates a gap.

**Observable acceptance:** Retained supported events display timestamps and accessible text; empty/partial history is labeled. Explain the existing last-35-supported-event retention boundary. No event is synthesized from file timestamps; a finished turn is not labeled completion of the whole project.

**Tradeoffs:** This may be a small presentation improvement rather than a net-new feature. It cannot establish real process liveness or capture native approvals. Event content remains local and must not be included in diagnostics downloads.

**Dependencies/permissions:** Existing read-only session data. No native hooks, new scanning, or permission. Verify chronological order, identical timestamps, and missing history fixtures.

### 6. Remember Agents filters and view per workspace

**Problem:** Navigating away resets Agents search/provider/status/view state, interrupting repeated inspection.

**Reuse:** Existing `readPreference`/`writePreference` helpers in `src/useWorkspace.ts`, `AgentsPage` state, and network view persistence pattern. Prefer remembering finite selects and view first; persisting free-text search has extra privacy/staleness cost.

**Observable acceptance:** Valid provider/status/view choices survive navigation/reload independently for demo/local workspaces. Invalid stored values fall back safely. Storage failures are handled visibly without preventing browsing. A reset restores defaults. No URL-sharing feature is bundled in.

**Tradeoffs:** Hidden old filters can make live sessions appear missing; show active filters and an obvious reset. This weakens its priority while connection confusion remains the proven problem.

**Dependencies/permissions:** Existing browser storage only; no backend schema or external permission. Test workspace isolation, invalid storage, and blocked storage.

## Concrete PoC interface and flow

Modify the existing Settings connection section only; preserve its current path, warnings, status badge, and refresh button. Add a compact observation line and a native disclosure, for example:

```text
Agent connections                                  [Check connections]

Codex                                                  Connected
C:\Users\Example\.codex\sessions
12 observed logs
Snapshot observed: Oct 16, 14:30 UTC
Latest supported log activity: Oct 16, 14:29 UTC

> Missing an expected session?
  Connected means this directory can be read. It does not confirm that
  the CLI you are using writes here or that a process is running.
  Compare the source path above with the directory used by your CLI account.
  The server uses AGENCY_CODEX_ROOT, otherwise CODEX_HOME/sessions when set,
  otherwise its own account's ~/.codex/sessions.
  If you correct the server environment or launch account, restart Agency,
  then choose Check connections. Visible tabs refresh every 10 seconds.
  Activity is inferred from supported logs; scans are bounded.
```

Use the equivalent existing Claude root guidance for Claude. These are proposed copy and invented example values, not evidence from a real user's machine. Prefer existing UTC/observation formatting and clock helpers. Do not add an independent polling timer; snapshot time is an observation timestamp, not a provider activity timestamp. If an age is displayed, reuse the existing observation clock.

**Example inputs and outputs:**

| Input fixture | Expected visible interpretation |
| --- | --- |
| Connected source, 0 logs, no sessions | Readable directory; no observed logs; latest activity Not reported; troubleshooting available; no wrong-account verdict |
| Connected source, old supported activity | Connected plus the actual old timestamp; no “live process” assurance and no automatic account-mismatch claim |
| Connected source with only file-based fallback timestamps | Latest supported log activity Not reported; snapshot observation remains independently visible |
| Missing source | Not found; show resolved path and comparison guidance; do not say starting a session necessarily fixes it |
| Read error | Error and existing warning; guide permission/root review without changing access |
| Failed refresh retaining an older successful snapshot | Keep the old observation timestamp and existing refresh error; do not imply that a fresh connection check succeeded |
| Provider absent from the snapshot | Not yet observed; no invented connection or activity state |
| Partial/bounded scan | Preserve current warning; latest observed activity is not promised to cover every session |
| Demo mode | Any real source details remain clearly labeled as local connection information, never demo activity; alternatively omit the new observation line until Local workspace is selected |

**Implementation boundary:** Candidate files are `src/Pages.tsx`, `src/App.tsx`, and one focused browser test file. Add a small existing-pattern formatter only if needed. No server/parser changes, path editor, clipboard/export of absolute paths, search across Windows profiles, launch-account switch, new route, or source reconfiguration API. Do not restart a user's running server as part of the PoC.

**Proof plan:** Build TypeScript/production assets. Run targeted browser fixtures for the table above and check that Check connections still uses the existing refresh action. Verify disclosure access by keyboard, local/demo labeling, and no horizontal overflow at 390px. Inspect network requests to confirm no added endpoint or outbound destination. Assert refresh/observation timestamps do not convert absent activity into zero age. No broad suite rerun is needed for this planning document; an eventual implementation should run the smallest tests appropriate to its changes.

**Stop condition:** The existing Settings section explains a connected-but-unexpected source using current observations and actionable manual comparison. Stop before automatic mismatch detection, backend provenance metadata, or source editing. Root must select an implementation batch; this document alone does not claim a built or verified PoC.

## Agent discussion and decision

Frontend independently ranked guided source diagnostics first, task priority controls next, and remembered filters as lower-priority convenience. Engineering Senior Developer also prioritized the demonstrated live-visibility complaint and recommended extending existing Settings with observation/activity distinctions rather than adding another page. Both reject automatic cross-account scanning and promises of process liveness. Root requires a concrete proposal/sketch, not speculative implementation, for this discovery turn.

Engineering Senior Developer approved the final six-item order: diagnostics, coverage filtering, task priority controls, task backup, retained-event inspection, and remembered filters. Senior resolved the close coverage-versus-priority choice in favor of inspecting partial evidence before ordering convenience. Frontend supported diagnostics first and cautioned that timeline work must first demonstrate a gap beyond existing event details. These are agent judgments, not user-research findings or numerical votes. No dependency installation, account changes, application code, or runtime source change was performed for these proposals.
