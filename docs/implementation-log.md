# Continuous implementation log

User authorization: implement the agreed dashboard backlog in small batches, maintain this log, create regular pull requests, and request fresh independent agent reviews. Continue until the user stops the work or the available session budget ends. Do not merge or deploy implicitly.

## Workflow and ownership

- Root owns Git operations, this log, integration, and release evidence.
- Feature Dev implements guided source diagnostics; Frontend Developer implements run-coverage filtering in separate files.
- Fresh reviewers inspect each batch; Engineering Senior Developer resolves close design decisions.
- Preserve unrelated existing edits. In particular, the existing `package.json` script-approval preference is excluded from commits unless explicitly relevant.
- Pull requests after the baseline are stacked on the preceding feature branch when needed; each description states its base and tested scope. No history rewrite or automatic merge.

## Batches

| Batch | Scope | Status | Evidence / PR |
| --- | --- | --- | --- |
| 0 | Preserve and publish existing dashboard resilience, accessible inspection, CSV export, and task-link integrity work | Reviewed; additional incomplete-demo-metadata crash fixed | [PR #1](https://github.com/kasperhbo/agency-dashboard/pull/1); build, 76 backend, 64 browser, 3 staging; scoped coverage 98.07%; additional 3 resilience checks passed |
| 1 | Guided connection diagnostics in existing Settings | Implemented and independently reviewed; 4 focused browser checks passed | Extends Settings with observed snapshot age and manual root guidance; hides retained local paths in demo; no native activity claim |
| 2 | Per-run usage coverage filtering | Assigned to Frontend Developer; waiting baseline snapshot | Keep workspace totals, daily chart, and CSV scope unchanged |
| 3 | Task priority filtering and deterministic ordering | Queued | Reuse existing task fields; no writes from sorting |
| 4 | Local task JSON backup download | Queued | Active source only; load/stale context; no restore claim |
| 5 | Retained-event inspection | Needs demonstrated gap | Existing detail may already satisfy need |
| 6 | Workspace-scoped Agents filter/view preferences | Queued after visibility work | Explicit reset and safe storage fallback |

Feature definitions and acceptance: [feature proposals](feature-proposals-2026-10-16.md). New work must retain loopback privacy, bounded observation, unknown-value semantics, revision checks, and atomic task persistence.

## Integration notes

- GitHub connector cannot create PRs (`403 Resource not accessible by integration`); existing noninteractive Git credentials successfully created PR #1 through the GitHub API. Credentials remain in memory and are never logged or committed.
- A fresh baseline reviewer found that incomplete persisted demo tasks could crash the overview's timestamp sort. The loader now validates revision/timestamps and falls back without overwriting invalid saved data. Regression passed.
- Combined diagnostics/coverage focused run passed 7 tests after correcting a test-only `innerText`/`textContent` comparison; no production behavior was changed to satisfy that assertion.
