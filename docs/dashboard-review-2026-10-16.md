# Dashboard review and owner decision

Date: 2026-10-16. Decision owner: root. Reviewers: dashboard UX, data reliability, product opportunities. Scope: review, discussion, vote, and implementation recommendation. Application source was not changed.

## Decision

Keep the current visual system and local-first architecture. Implement, in order: polling integrity, visible freshness, honest and accessible charts, actionable overview, and bounded mobile network improvements. Add local usage CSV export afterward.

| Proposal | UX | Reliability | Product | Owner decision |
| --- | --- | --- | --- | --- |
| P1 Polling and task response integrity | Approve | Approve | Approve | First |
| P2 Freshness and recovery near evidence | Approve | Approve | Approve | Second |
| P4 Chart semantics, keyboard and touch access | Approve | Approve | Approve | Third |
| P3 Actionable overview and priority ordering | Approve | Approve | Approve | Fourth |
| P5 Mobile network controls and readable graph | Approve | Approve | Approve | Fifth |
| P6 New local usage CSV export | Defer | Defer | Defer | Follow-up |

These are actual agent votes, not user-research results. The owner resolves ordering. UX and reliability ranked P4 third; product ranked P3 third. Product initially deferred P5, then approved the bounded proposal after current mobile captures showed clipped graph branches and truncated controls. The owner puts chart correctness before layout changes and limits P5 to native disclosure, readable controls, fit/summary access, and preserving the user's graph/list choice.

## Current behavior and invariants

- Local workspace refreshes a full sessions snapshot and task list every 10 seconds while visible. It retains successful prior state on failed requests. Topology has its own 10-second polling loop with a 20-second timeout.
- This is near-real-time observation of native logs, not a process monitor, approval gateway, or account billing system. Activity states are inferred. Demo content remains explicitly labeled and isolated.
- Native scanning is bounded and deduplicated. Coverage warnings, nullable metrics, task revision checks, atomic persistence, and loopback Host/Origin validation must remain intact.
- Task CRUD, project workspaces, session-linked follow-ups, search, usage breakdowns, graph/list views, and reduced-motion support already exist. Reuse them.

## Captured walkthrough

Fresh captures used isolated Playwright browser contexts and explicitly labeled demo data at desktop 1440×1000 and mobile portrait 390×844. All six pages had body width equal to viewport width. This does not establish accessibility compliance or real-device performance.

### Step 1: Overview — functional, hierarchy needs improvement

The 441px desktop graph preview precedes active sessions. On mobile the preview starts at y436 and occupies 433px; active cards begin at y895 and the task preview at y1749, below the initial 844px viewport. Users see counters and a representative graph before actionable work.

![Desktop overview](../test-results/review-desktop-overview.jpg)

![Mobile overview](../test-results/review-mobile-overview.jpg)

### Step 2: Usage and insights — detailed, trend and inspection need improvement

The daily trend begins at y1262 on desktop and y2265 on mobile, after provider breakdowns and limit cards. Source tracing finds missing daily rows/null totals converted to zero for chart rendering. Exact provider values use title attributes, limiting touch and keyboard inspection. Keep the strong UTC, coverage, deduplication, and non-billing caveats.

![Desktop usage](../test-results/review-desktop-insights.jpg)

![Mobile usage](../test-results/review-mobile-insights.jpg)

### Step 3: Agent network — useful desktop graph, mobile navigation needs improvement

On mobile the graph begins at y584, with branches clipped at the initial 80% zoom and a truncated provider label. The page itself does not overflow horizontally; the graph has its own viewport. Source CSS hides observation-age text below 620px. A hierarchy list and fit controls already exist.

![Desktop network](../test-results/review-desktop-network.jpg)

![Mobile network](../test-results/review-mobile-network.jpg)

## Bounded proposals and acceptance

### P1: Preserve polling and mutation integrity

Owners: `useTopology` in `src/NetworkPage.tsx:20` and `useWorkspace` in `src/useWorkspace.ts:37`.

Periodic topology refresh must not abort a still-valid preceding request. Keep at most one poll in flight, retaining timeout and mode/unmount cancellation. Protect successful task mutations against earlier GET responses being applied afterward; the server's revision checks remain authoritative.

Acceptance: a 12-second topology response completes under a 10-second cadence; failed refresh retains the last graph; a GET started before successful create/edit/delete cannot restore stale task state. Mode changes and unmount cancel obsolete work.

Runtime proof in isolated routed browser contexts reproduced both issues: delayed topology showed zero completed requests and no rendered graph during observation; a successful task PATCH displayed the saved title, then an older GET restored the original title. Task endpoints were mocked: no real task writes occurred.

### P2: Put freshness beside operational evidence

Owners: `src/useWorkspace.ts:37`, `src/App.tsx:134`, `src/NetworkPage.tsx:86`.

Show last successful observation age and 10-second cadence near the summary, including mobile. Distinguish unavailable initial data, stale retained data, partial scan coverage, and request failure. Keep sessions and task request failures separate. Refresh immediately on return to a visible tab and on a connectivity hint, with request results determining actual recovery. Age must advance without requiring a successful response.

Acceptance: offline/error retains the last good snapshot and exposes its age; partial source data never looks complete; a task failure does not falsely mark session evidence stale; resume causes one immediate refresh without duplicate requests. No-data failure must not look like healthy zero activity.

### P4: Make charts inspectable and preserve data meaning

Owners: `ActivityChart` in `src/Overview.tsx:8`, `src/Usage.tsx:22`.

Retain the existing activity chart screen-reader summary. Add one focusable/tappable date bucket exposing both providers and exact counts, persistent selection, Escape/reset, and a disclosed semantic data table. Move the seven-day usage trend closer to its headline totals; keep provider and UTC scope explicit. The fixed last-seven-days trend must remain clearly distinct from the summary's selected period.

Missing daily row means "No recorded usage"; an explicit zero means "0 recorded tokens"; a null metric means "Not reported". Do not claim actual zero consumption or per-day completeness from absent observations. Keep partial-coverage caveats.

Acceptance: pointer, touch, keyboard, and table expose the same exact values and dates. Selection survives refresh by stable date/provider identity; a removed selected bucket clears explicitly. Unknown and zero remain distinct in text and exports.

### P3: Lead the overview with decisions and next steps

Owners: `src/Overview.tsx:66` and the existing notification queue in `src/App.tsx:152`.

The attention metric should open the existing complete queue rather than only `attention[0]`. Show a bounded attention preview and active work before the representative network. Put priority tasks near active work, ahead of secondary history and decorative pulse content. Sort unfinished task preview explicitly by in-progress status, priority, then stable age/id; do not reorder persisted storage.

Acceptance: three attention items are individually reachable from both metric and bell; an older high-priority task is not crowded out by newer low-priority tasks; the mobile first scan exposes the most urgent action with freshness. Keep log-inferred status and native-approval caveats. Do not add acknowledgement states or task execution.

### P5: Reduce mobile network friction

Owners: `src/NetworkPage.tsx:128` and `src/network.css:158`.

Keep source status and age visible. Collapse secondary filters with native disclosure; retain active-filter count and reset. Ensure provider labels fit. Provide a meaningful initial fit or compact summary, plus the existing explicit hierarchy-list choice. Keep one-finger page scrolling available outside an intentional graph inspection mode.

Acceptance: 390px portrait permits a quick state scan and node inspection without truncated controls; applying/closing filters returns to evidence; keyboard focus remains predictable; refresh preserves selected node and chosen view. Validate touch page scrolling and mobile landscape before changing gesture ownership.

### P6: Add local usage CSV export afterward

Owner: existing derived usage view in `src/Usage.tsx`, with no new backend service.

Export the current provider/period selection as aggregated daily usage with UTC dates, source, observation timestamp, coverage caveats, and explicit unknown values. Keep deduplicated workspace data separate from overlapping per-run data. Quote cells correctly and neutralize spreadsheet formulas. Exclude prompts, tool arguments, and absolute paths; download locally with no upload.

Acceptance: exported totals match the selected visible summary and scope, with unknown distinct from zero. No inferred billing or summed CLI estimates. This is the agreed new-feature candidate after the core fixes.

## Technical design and budgets for proposed work

Retain React DOM/CSS bars and SVG graph edges; no new renderer or chart dependency is justified. Current activity charts have 7 or 12 buckets; usage has 7 dates and at most two provider stacks. Insights has two main charts simultaneously, plus existing quota indicators. Overview has one activity chart, one bounded graph preview, and up to four existing microcharts.

Proposed limits: keep those visible counts and bounded initial graph families; use hierarchy/list disclosure when further expansion harms readability. Keep one request per polling channel in flight and pause periodic requests in hidden tabs. Do not introduce an animation loop for charts or freshness; a low-frequency shared clock is sufficient for age. Target chart selection under 100ms and graph/filter commits under 100ms at the existing 100-file-per-provider scan limit, measuring before optimizing. These are proposed acceptance budgets, not measured performance results.

When scale rises, aggregate, cap visible graph families, and use list/details before considering Canvas/WebGL. Preserve selected identity across snapshot replacement. Native disclosure and the existing modal/list patterns minimize maintenance. Polling remains appropriate; no subsecond streaming requirement was established.

Mobile first scan should answer: what needs attention, how fresh is the evidence, and what action can I take? Controls must not hide that context. Offline/stale views retain the last snapshot; avoid automatic offline mutation queues in this revision. Permission-gated notifications, sensors, and vibration are unnecessary. Static chart/table output must include dates, source, units, legend, and coverage without hover; CSV follows only after the data contract is established.

## Verification limits

Completed: six fresh screenshots, inspection of saved images, viewport overflow measurements, targeted source tracing, isolated delayed-poll reproduction, isolated out-of-order task-response reproduction, reviewer discussion and actual votes.

Not performed: fixes, full regression suite, real mobile hardware, screen-reader audit, measured contrast audit, throttled performance profiling, or end-to-end offline recovery testing. Visual captures used sample data; reliability findings additionally use source inspection and mocked request ordering. Existing user modification to `package.json` was preserved.

## Implementation decision and final validation

Three cavecrew investigators reviewed the existing product and proposed changes; two network/mobile reviewers independently voted for proposal B. The owner accepted P1–P5 and the mobile list-first refinement: portrait narrow screens open the existing hierarchy list, desktop opens the graph, and refresh, filters, Reset, and rotation preserve the user's chosen view. No new graph widget or dependency was added. P6 (local usage CSV export) was explicitly deferred so the reviewed data and observation semantics could ship first.

Implemented the accepted reliability, freshness, chart inspection, overview priority, and mobile network changes in the existing React app. A final review also found the daily usage window could stay on yesterday after a UTC midnight if no successful workspace response rerendered the page; the chart and period summaries now share the low-frequency observation clock. The empty notification state also reports session data as unavailable when no observation exists.

Final validation: `npm test` passed (74 tests); the full Playwright suite passed 58 tests with 4 cases skipped because no staging URL was configured. Focused additions cover the UTC midnight rollover, failed initial session observation, portrait list-first default, graph-choice retention, and the prior polling, mutation, chart, and overview regressions. Desktop and mobile screenshots were captured from the production build using isolated demo contexts. A separate manual screen-reader and real-device audit was not performed.

The connected GitHub integration still rejects issue creation with HTTP 403 (`Resource not accessible by integration`). No issues were created. Ready-to-post issue drafts are in `docs/github-issue-drafts-2026-10-16.md`.
