# Agency dashboard design

## Purpose
Give one person a clear view of their Claude Code and Codex sessions: what is running, what needs attention, and what to do next. This is a local monitor and task organizer; agent execution and approval remain in their original tools.

## Reference research
- https://agent-gui-project.github.io/ and https://github.com/eth-medical-ai-lab/agent-gui: observable agent work, inspectable session history, an overview that leads into a detailed desk view.
- https://founderos.sh/ and https://github.com/Bennettxai/FounderOS: unified workspace, consistent navigation, tasks, usage, and honest connection states.
- https://github.com/EverythingAI-Pro/founderos-releases: public desktop release feed, not a public implementation source. No installer or source code copied.

## Visual system
Graphite #101115, panels #18191e, borders #2b2c34, text #f1f0f5, lavender #a99af9, mint #83c7ab. Claude uses muted orange; Codex uses mint. System sans with a compact, left-aligned hierarchy. Sidebar, generous main workspace, and a quieter activity rail. A subtle orbit visualization makes agent status readable without turning the interface into a game.

## Architecture and ownership
React + TypeScript + Vite, with Lucide icons. Node's built-in HTTP/filesystem APIs own a loopback-only API. Session readers normalize bounded reads of local JSONL files into metadata; they never change native agent logs. Explicit demo data remains separate from local data. Browser storage owns demo tasks and preferences. Atomic server storage owns local tasks. Polling refreshes local sessions every 10 seconds. No external services or credentials required.

## Behavior and invariants
- Demo is clearly labeled. Sample activity never appears as live telemetry.
- Local status is inferred from recent log events and freshness, not guaranteed process liveness. Old unfinished sessions become idle, not active.
- Missing roots, incomplete JSONL lines, and unsupported records do not crash discovery. Partial scans report limits.
- No arbitrary filesystem paths are accepted through HTTP. Roots are server environment settings.
- Task changes validate on the server and survive restart; writes serialize and use atomic replacement. Invalid existing state is reported, never silently overwritten.
- The service binds to 127.0.0.1, validates Host and Origin, rejects cross-site requests, and only accepts JSON for writes.
- Search, filters, navigation, task creation/edit/completion/deletion, session inspection, connection mode, notifications, and keyboard shortcuts work. Tasks organize work and do not execute commands.
- Keyboard-visible focus, focus-contained dialogs with return focus, reduced motion, semantic controls, narrow layouts, and explicit empty/error states.

## Project and task continuation
Projects group existing session and task labels, including task-only projects and an Unassigned group. They do not introduce a filesystem API or a second project database. Same-name directories combine, which is stated in the UI. Project detail reuses session cards and task rows, with bounded initial rendering and show-more controls.

Tasks have an optional `sessionId` reference. This is additive: older task files remain readable, omitted fields on an update preserve a link, and explicit null removes it. References validate to 1–80 letters, digits, hyphens, or underscores. Missing sessions are allowed because recent discovery is bounded; their references must not be silently discarded. UI selection is restricted to the same source and assigned provider, and a provider change clears the link. Task edits retain existing revision/concurrency checks. No provider execution or native hooks are installed.

## Data correctness and usage
Selected logs are fully streamed up to 64 MiB per file; large/malformed lines are explicitly flagged, and only activity history is reduced to its last 35 events. Usage is not sampled from head/tail fragments. Session activity uses log timestamps, never a file touch as evidence of new work. Native model IDs survive synthetic error messages. Top-level sessions, subagents, copied thread logs, and usage responses are counted distinctly.

Canonical usage has nullable input, output, cache-read, cache-write, reasoning, and total fields. Claude cache fields add to its uncached `input_tokens`; Codex cache fields are subsets of `input_tokens`. Reasoning is a subset of output for both. Responses are deduplicated within Claude logs and across files for workspace totals; Codex thread copies use one cumulative view. A supported log with no usage has unknown tokens, not zero.

UTC daily usage is built from response records or cumulative counter increments. Unattributable inherited Codex baseline counters remain undated. Dated period filters never substitute a whole-session total. Quota snapshots retain report/reset timestamps and become visibly stale rather than resetting to a guessed value. Model context windows and last-request tokens are separately labeled. Claude CLI estimates are shown per run, not summed or represented as paid bills. Partial reporting and scan coverage remain visible.

New workspaces open local data by default, while saved mode preferences and explicit demo exploration are preserved. Demo usage and limits are seeded only in demo mode. Browser tests explicitly choose their sample workspace.

## Proof
Typecheck and production build; Node tests for log parsing, stale status, truncation, duplicate token accounting, persistence, validation, and API boundaries; browser checks for core workflows, reload persistence, responsive layout, and keyboard dialogs.
