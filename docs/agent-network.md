# Agent network implementation plan

Goal: an animated, inspectable view of Claude/Codex parents and subagents, backed by a real API, meaningful unit/functional coverage, and a reproducible staging deployment.

## Design
Reuse the existing graphite/lavender workspace and provider colors. A dotted graph canvas contains a workspace hub, provider branches, and log-backed run cards. Real parent references draw child links; provider membership is visually distinct from lineage. Selecting a node highlights its immediate neighborhood and opens an inspector. Filtering, bounded family expansion, pan/zoom, a list alternative, pause, and reduced motion keep large snapshots usable.

## Ownership and invariants
- `server/topology.mjs` normalizes and deduplicates the graph; `GET /api/topology` and cached session snapshots share the same data.
- Provider availability means readable source logs, not authenticated provider uptime or a live process connection.
- Claude and Codex lineage is derived from native parent metadata. Unknown parents appear as explicit missing-parent nodes; no communication edges are guessed from project names.
- Opaque node identities remain stable across polling and canonical log selection. All edges resolve, parent relationships are provider-scoped, and cycles/self-links are rejected or clearly marked unresolved.
- `shared/topology-layout.mjs` owns deterministic client layout/filtering. Native SVG draws edges; semantic HTML buttons expose the same relationships to keyboard users. No graph dependency or physics loop is required.
- Activity animation follows reported working state only. Pause/reduced motion and stale/error snapshots stop animation.
- Staging uses isolated fixture logs and task storage. Native agent data, credentials, local task files, and agent configuration must never enter CI artifacts or public images.

## Work and acceptance
- [ ] API and native lineage: tests for native parent correlation, duplicates, missing parents, source failure, cycles, stable identities, and invalid requests.
- [ ] Graph/list frontend: visible hierarchy, inspector, source/project/search/activity filtering, family expansion, pan/zoom, motion controls, and error/empty states.
- [ ] Unit coverage: gate topology and layout logic with native V8 coverage; run all existing backend tests.
- [ ] Functional coverage: exercise the actual API from fixture JSONL through graph rendering, interaction, mobile accessibility, and reduced motion.
- [ ] GitHub CI: clean install, unit/functional gates, production build, coverage/test artifacts, isolated staging gate.
- [ ] Deploy: build a private-data-free runtime artifact, deploy isolated staging, verify health/API/browser behavior, preserve previous good release on failure.
- [ ] Remote GitHub/staging: connect the user's repository and runtime target, then observe actual workflow/deployment results. No remote URL or green run is claimed before it exists.

## Deployment target
The user supplied `kasperhbo/agency-dashboard` and chose public source code with private, self-hosted staging. A repository-scoped Windows runner is configured for owner-triggered trusted-main deployments only. PR checks run on GitHub-hosted runners. Staging binds to localhost and uses generated fixtures, never native logs. Docker is installed locally but its daemon is unavailable, so OCI runtime verification belongs to the hosted CI container job.
