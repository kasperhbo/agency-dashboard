# Agency implementation plan and tracker

Goal: a polished, runnable local workspace for tracking Claude and Codex agents.
Architecture: React UI with separate demo/local sources; a loopback Node API discovers native logs read-only and persists local tasks atomically.
Design: [docs/design.md](docs/design.md). Execution: implement inline in this session.

## Build
- [x] Inspect workspace, runtime, and all five reference URLs.
- [x] Record scope, visual tokens, data ownership, and invariants.
- [x] Build native session readers and local API; verify malformed logs, stale status, persistence, and request validation.
- [x] Build responsive overview with agent cards, workload, activity, and task preview.
- [x] Implement Agents, Tasks, Activity, Insights, and Settings views.
- [x] Implement search, filters, session detail, task CRUD, shortcuts, notifications, and source switching.
- [x] Add honest demo/local labels, errors, empty states, keyboard access, and reduced motion.
- [x] Run production build, backend tests, browser workflows, and mobile checks.
- [x] Write setup instructions, source limitations, and final verification results.

## Verification — 2026-10-15
- `npm test`: 10 passed. Parser boundaries, large/partial logs, token accounting, task storage, concurrent revisions, and API request validation.
- `npm run test:e2e`: production build passed; 8 browser checks passed. Task CRUD/reload, filters, search, local fixtures, mobile layouts, keyboard/focus, themes, error recovery, accessibility, and production CSP.
- Automated WCAG A/AA audit: no violations in checked overview/task/settings views, task dialog, and light overview.
- Local discovery verified against native logs; machine-specific evidence is kept privately outside version control.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Desktop/mobile screenshots: `docs/screenshots/overview.png` and `docs/screenshots/mobile.png`.
- App running at `http://127.0.0.1:5173`; local API/production build at `http://127.0.0.1:4318`.

## Review focus
- Partial/malformed JSONL and missing roots must not crash discovery.
- Repeated token usage events must not double count usage.
- Stale sessions must never appear as currently running.
- Concurrent task changes and corrupt storage must not lose data.
- API must reject cross-origin mutations and invalid payloads.

## Future scope (not part of this version)
- [ ] Native lifecycle hooks for definitive running/waiting/approval state.
- [ ] Optional agent execution and approval integration with explicit user controls.
- [ ] Provider billing integration for actual costs; token counts alone cannot establish billed spend.
- [x] Session-to-task links and richer project grouping (completed in the continuation below).

## Continuation — projects and connected tasks
- [x] Validate optional session references without breaking existing task files; preserve links during edits and reload.
- [x] Link follow-up tasks to their source session and show linked tasks in session details.
- [x] Add a project workspace grouping observed sessions and planned tasks, with search and project-scoped task creation.
- [x] Cover missing sessions, provider changes, demo/local separation, persistence, mobile layout, and accessibility.
- [x] Update documentation and record verification.

### Continuation verification
- `npm test`: 12 passed, including session reference validation, legacy file compatibility, omitted-field preservation, and explicit unlinking.
- `npm run test:e2e`: production build and 12 browser checks passed, including project search/detail/task creation, bidirectional session/task navigation, reload persistence, provider changes, missing sessions, source switching, mobile project layouts, and accessibility.
- Original atomic task storage and revision checks retained. No migration, native hook installation, execution integration, or new dependency required.
- Previews: `docs/screenshots/projects.png`, `docs/screenshots/project-detail.png`, `docs/screenshots/project-mobile.png`.

## Data accuracy and usage audit
- [x] Independently reconcile full native log files against the existing reader.
- [x] Replace head/tail usage sampling with bounded full-log streaming and explicit coverage.
- [x] Correct synthetic model names, log timestamps, subagent labels, missing usage, and duplicate response accounting.
- [x] Add input/output, cache, reasoning, dated usage, context snapshots, quota snapshots, and recorded CLI estimates with source labels.
- [x] Default new workspaces to local data; retain an explicit demo option and user preferences.
- [x] Reconcile real files again, test calculations and UI, and document remaining source limitations.

### Usage verification
- `npm test`: 19 passed, including provider-specific accounting, timestamp attribution, synthetic errors, undated inherited counters, and decreasing-counter warnings.
- `npm run test:e2e`: production build and 14 browser checks passed, including default-local behavior, UTC daily values, usage filters, missing data, quota expiry, context snapshots, CLI estimate labels, mobile layouts, and accessibility.
- `npm run audit:usage`: selected native files and independently deduplicated provider aggregates matched. Detailed local counts are kept in ignored private evidence.
- Physical logs, unique sessions, subagents, replayed responses, and duplicated threads are counted separately. Inconsistent counters remain explicitly partial/lower-bound.
- Evidence and boundaries: [docs/data-audit.md](docs/data-audit.md). Estimates are not bills; provider limits are timestamped snapshots; historical scan caps remain visible.
- Previews: `docs/screenshots/usage.png` and `docs/screenshots/usage-mobile.png`, using explicitly labeled sample data.

## Agent network folder hierarchy
- [x] Preserve native Claude/Codex working-directory metadata through the topology API.
- [x] Group each top-level agent family under its recorded full folder path; retain nested parent-child links and each child's own folder detail.
- [x] Normalize Windows paths safely across platforms, preserve POSIX case, and group unknown/relative folders explicitly.
- [x] Render/filter folder roots in Overview and Agent network; keep provider identity on agent sessions.
- [x] Hide error/completed runs after 24 hours since the last recorded log update while preserving visible descendant grouping.
- [x] Verify API/layout unit coverage, browser interactions, mobile, and isolated staging fixtures.

### Folder hierarchy verification — 2026-10-16
- `npm run test:coverage`: 72 passed; topology/layout combined line coverage 97.94%.
- `npm run test:e2e`: 24 passed, 4 staging-only cases skipped.
- `npm run test:staging`: 3 passed against generated isolated fixtures.
- `npm run build`: passed.
- Local dev API health and topology endpoint respond; the page accepts the folder-node graph schema.
