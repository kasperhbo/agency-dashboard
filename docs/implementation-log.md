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
| 0 | Preserve and publish existing dashboard resilience, accessible inspection, CSV export, and task-link integrity work | Fresh independent review in progress | Existing verification: build, 76 backend tests, 64 browser tests, 3 isolated staging checks; scoped coverage 98.07% lines |
| 1 | Guided connection diagnostics in existing Settings | Assigned to Feature Dev; waiting baseline snapshot | No parser changes or unsupported native activity claims |
| 2 | Per-run usage coverage filtering | Assigned to Frontend Developer; waiting baseline snapshot | Keep workspace totals, daily chart, and CSV scope unchanged |
| 3 | Task priority filtering and deterministic ordering | Queued | Reuse existing task fields; no writes from sorting |
| 4 | Local task JSON backup download | Queued | Active source only; load/stale context; no restore claim |
| 5 | Retained-event inspection | Needs demonstrated gap | Existing detail may already satisfy need |
| 6 | Workspace-scoped Agents filter/view preferences | Queued after visibility work | Explicit reset and safe storage fallback |

Feature definitions and acceptance: [feature proposals](feature-proposals-2026-10-16.md). New work must retain loopback privacy, bounded observation, unknown-value semantics, revision checks, and atomic task persistence.
