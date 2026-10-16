# Production readiness decision — 2026-10-16

## Scope and decision authority

The user requested an agent discussion, feature proposals, and completion toward production readiness. The repository's `.codex/agents` definitions informed the backend, frontend, and engineering senior developer roles. Engineering senior developer chaired the decision and had final authority for close choices.

The target remains the existing React/Node application for one trusted local user. Production readiness here means a built application served on loopback with its existing privacy, bounded discovery, task persistence, and request safeguards. It does not mean approval for public hosting or deployment.

## Evidence and discussion

Existing functionality includes task CRUD with revisions, project workspaces, session links, source separation, usage inspection, freshness indicators, accessible chart inspection, and graph/list navigation. These are reused rather than rebuilt. The initial backend baseline passed 74 tests.

| Proposal | Evidence and discussion | Decision |
| --- | --- | --- |
| Preserve UTF-8 task input across request chunks | Backend traced per-chunk Buffer-to-string conversion in `server/index.mjs`; a multibyte character split between chunks can be replaced, silently changing task content. Senior approved fixing decoding at the request boundary. | Implement first; protect stored data. |
| Return a client error for malformed encoded static paths | Backend found unhandled `decodeURIComponent` failures becoming HTTP 500. Senior approved a bounded invalid-input fix. | Implement with request regression coverage. |
| Add system appearance | Frontend confirmed only light/dark choices currently exist. The senior role calls for light/dark/system; a system choice adds useful native-platform behavior without another dependency. | Implement, preserving explicit choices and the quick toggle. |
| Recover from React render failures | Frontend found no root error boundary in `src/main.tsx`. A render failure can leave an empty application. Senior ranked a clear reload recovery above an additional reporting feature. | Implement a bounded recovery view; never clear user data. |
| Local usage CSV export | Useful for taking recorded usage into other tools, and proposed by the earlier dashboard review. It does not close the confirmed data corruption or recovery gaps. | Defer to a follow-up increment. |
| PWA and offline task writes | Offline mutations introduce conflict and synchronization semantics beyond the existing revision contract. | Defer. |
| Native hooks, agent execution, and actual billing | Require new integration, authorization, and source-of-truth contracts; existing observations must stay honest about their limits. | Defer. |
| Public hosting and authentication | Changes the documented single-user loopback trust boundary. | Outside this batch. |
| Decorative 3D, framework replacement, blanket dependency upgrades | No demonstrated product gap justifies the complexity. Dependencies should change for a verified need or vulnerability. | Do not add. |

These decisions reflect actual backend/frontend proposals and senior responses. Both specialists accepted the bounded work; no numerical vote or user-research result is implied. The senior decision prioritizes data integrity, then recovery and native appearance support.

## Acceptance and invariants

- Task titles/descriptions containing split UTF-8 sequences, including emoji, round-trip unchanged; the existing request byte cap and JSON validation remain effective.
- Malformed encoded static paths return HTTP 400 without changing valid static serving or traversal protection.
- System appearance follows current and changing OS preference. Explicit light/dark choices ignore OS changes, and all choices survive reload. The quick toggle remains available.
- A React render failure presents an accessible recovery view with a working reload action. Task files, browser storage, and source preferences are not deleted. Verification must not add a production crash route or switch.
- Existing loopback Host/Origin guards, task revisions, atomic writes, bounded log discovery, demo/local separation, reduced motion, and responsive workflows remain intact.
- Run the backend suite, production build, and relevant browser coverage; report actual results and any checks that could not run. A passing suite is evidence for its tested cases, not proof of every production condition.

## Operational limits

This change does not deploy, publish, or expose the application. Browser recovery cannot handle failures before JavaScript loads, server outages, or every asynchronous event failure. Session activity remains inferred from native logs, with documented scan and coverage limits. This review does not establish a 1.5-second load-time target, a 60fps guarantee, or comprehensive accessibility compliance; such claims require their own measurements.

Verification results are recorded in `TODO.md` with the continuation for this batch.

## Follow-up completion discussion

A fresh review by the repository-defined Backend Architect, Frontend Developer, and Engineering Senior Developer confirmed that the resilience batch above was already present. Before further changes, the backend suite passed 75 tests and the production build passed; `npm audit --omit=dev` reported no known vulnerabilities. Existing uncommitted changes were preserved.

The backend identified one remaining integrity defect: changing a task's provider through the API while omitting `sessionId` inherited the previous provider's session link. The frontend supported the previously deferred usage CSV export as a bounded follow-up using the existing deduplicated calculations. Engineering Senior Developer approved both, prioritizing integrity before export; neither proposal required a close-vote tiebreak.

- Clear an inherited session link when its provider changes and the request omits `sessionId`. Preserve omitted links for same-provider legacy clients, explicit replacements, explicit unlinking, revision checks, and atomic storage.
- Export the selected usage providers and period locally as CSV, including distinct summary and dated rows, unknown values, undated-history information, source and coverage context. Reuse workspace accounting rather than summing overlapping runs. Do not include session paths, prompts, credentials, or billing estimates.

The user also requested a Feature Dev agent, assigned to discuss feature acceptance and review edge cases with the frontend and senior agents. Senior retains final decision authority. Further proposals remain deferred unless they close a demonstrated gap in this completion batch. Public hosting, agent execution, billing integration, and offline mutation remain outside the documented local application boundary.

Engineering Senior Developer approved the completed implementation after the specialists' review; Feature Dev independently found no blocking export issue. Final verification passed the production build, all 76 backend tests and the scoped coverage gate (98.07% lines), 64 browser tests (4 staging-conditional cases skipped), and 3 isolated staging checks. The production dependency audit reported no known vulnerabilities.

The user's report of entirely missing current Codex sessions was traced to the running API reading another Windows account's home directory. Discovery against the active account's directory returned current sessions, including a running observation. After the user stopped the old servers, the development server was restarted with an explicit correct Codex root. Both API and development proxy returned 12 Codex logs, and a real browser check confirmed 12 Codex rows in Local workspace. This was a runtime source mismatch; no parser or freshness rule needed changing. README now explains how to compare resolved source paths and restart under the correct account.
