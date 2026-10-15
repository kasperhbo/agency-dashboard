# Native data and usage audit — 2026-10-15

## What was wrong

The original bounded reader inspected only the first 32 KiB and last 256 KiB of large logs. Independent full-log inspection found accounting mismatches. Detailed machine-specific audit evidence is kept privately in ignored local storage. The audit identified these errors in meaning and presentation:

- Claude synthetic error messages could replace the real model with `<synthetic>`.
- File modification time could override the real last-log timestamp, shifting old activity into today.
- Subagent logs were described as ordinary sessions; copied thread logs could inflate counts and aggregate usage.
- The overview summed whole runs updated today instead of usage recorded on that day.
- Missing token records were represented as zero.
- Recent Codex `token_usage_record` records, cache/reasoning details, and quota snapshots were not displayed.

## Correction and reconciliation

The reader now streams selected logs, retains a bounded activity history separately from usage accounting, preserves real model IDs, and uses log timestamps. It accounts for provider-specific cache semantics and both Codex usage formats. Workspace aggregation removes replayed Claude response IDs and duplicate Codex thread histories. Physical logs, unique sessions, and subagents are distinguished.

The independent checker is `npm run audit:usage`. It has a separate full-log calculation rather than calling the production normalizer for expected values. It checks stable selected files and provider-wide deduplicated sums. It emits counts and hashed file identifiers, never conversations or tool arguments.

After the corrections, reconciliation found no per-file mismatches and the deduplicated provider aggregates matched for the selected logs. Response replays and copied thread histories were excluded. Native logs change as work continues; rerun the command locally for current values. Account-specific values are not published with the source code.

This proves supported usage accounting against those selected source records. It does not claim all historical logs were scanned, that every provider field is emitted, or that local counters equal an account invoice.

Physical logs are distinguished from unique top-level sessions and subagents. When a native log contains a decreasing cumulative counter, its maximum observed count is retained as a lower bound and its coverage is marked partial; the source inconsistency is not silently repaired. Recorded model labels mean the last non-synthetic model observed in that log, not a claim that every request used one model.

## Display and validation

- Overview daily usage uses deduplicated dated entries in UTC. A browser fixture independently verifies a 500-token day despite 3,000 tokens in whole-run totals.
- Input/cache and output/reasoning are shown without adding subsets twice.
- Unknown values say “Not reported”. Log/field coverage and undated baseline tokens are visible.
- Quota snapshots show source, report time, reset time, and stale status; expired snapshots are not reset to zero.
- Context-window and last-request sizes are not presented as live context utilization.
- Claude CLI cost estimates are explicitly separated from actual billing and never summed across runs.
- New workspaces default to local data. Demo usage remains explicitly labeled and isolated.

The regression suite covers streaming usage in the middle of large logs, malformed lines, cache/reasoning semantics, synthetic errors, touched files, native Codex records, inherited counters, UTC attribution, response deduplication, default local mode, usage period/provider filters, stale quotas, and missing values. Existing task, project, API, mobile, and accessibility checks remain in place.
