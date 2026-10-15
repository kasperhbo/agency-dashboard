# CI and private staging

The code repository is public: https://github.com/kasperhbo/agency-dashboard.
Staging is a private Node process on this Windows machine at
http://127.0.0.1:4320/#network. It uses synthetic fixture logs and an isolated task
store. This is local staging, not public hosting. Do not open firewall ports,
bind the host process to `0.0.0.0`, or create a public tunnel.

## Local verification and deployment

Use Node.js 24 and install Chromium once:

```powershell
npm ci
npx playwright install chromium
node --test server/deployment.test.mjs
node scripts/deploy-staging.mjs verify
```

`verify` builds the frontend, copies an allowlist of runtime artifacts into
`.agency/staging/releases/<release-id>`, starts the actual production backend
against generated JSONL files on a free loopback port, checks the API and built
bundle, runs the staging Playwright spec, and stops its owned server even on
failure. It does not attach to an existing developer server.

For persistent staging, use a directory outside both your checkout and the
GitHub runner checkout:

```powershell
$env:AGENCY_STAGING_ROOT = 'G:\agency-staging\agency-dashboard'
node scripts/deploy-staging.mjs deploy
node scripts/deploy-staging.mjs status
# Stop this managed staging instance when required:
node scripts/deploy-staging.mjs stop
```

Use the same `AGENCY_STAGING_ROOT` for all three commands. `status` verifies the
running release identity and prints its version and build SHA without its stop
token. `AGENCY_BUILD_SHA` supplies a local build identifier; GitHub uses
`GITHUB_SHA`. With neither set, health honestly reports `uncommitted`.

`deploy` first verifies a candidate on a temporary port while the current release
keeps serving. After all checks pass it stops that candidate and the prior
managed server, starts the candidate on port 4320, repeats the API smoke checks,
and atomically replaces `active.json`. There is a short switch interruption.
If browser verification fails, the previous process stays running. If the final
start or promotion fails after stopping the previous process, the script
restarts that previous release at its prior address and refreshes its marker.
An unrelated process occupying port 4320 is never stopped. Rollback failure is
reported as an error, not hidden as a successful deploy.

For manual recovery, `previous.json` retains the prior release identity and
release directory; release files and each release's task store remain on disk.
No automatic retention deletion is performed. A crashed deployment can leave
`deploy.lock`; inspect running staging/deployment processes before removing that
specific stale lock. The lock prevents concurrent deployments and stops.
Staging is a user process, so a reboot/logoff requires another deployment or a
separately configured service. The runner setup does not make staging a service.

## Browser test interface

The package script is `"test:staging": "node scripts/staging-check.mjs"`.
`npm run test:staging` without a URL invokes the complete
isolated build/verify/stop flow. With `AGENCY_STAGING_URL` set to a loopback HTTP
origin, it attaches to that staging server and runs:

```text
node node_modules/@playwright/test/cli.js test tests/network-staging.spec.ts --reporter=line,html
```

The spec uses the absolute URL from `AGENCY_STAGING_URL`, an empty storage state,
and the real `/#network` route. It must not depend on the development server or
intercept API requests with mocks. The generated fixtures are:

| Provider | Native ID | Relationship |
| --- | --- | --- |
| Claude | `staging-claude-parent` | Parent session |
| Claude | `staging-child` | `sessionId=staging-claude-parent`, `agentId=staging-child`, sidechain |
| Codex | `staging-codex-parent` | Parent session |

The Claude child is stored at
`claude/staging-claude-parent/subagents/agent-staging-child.jsonl`. All records,
messages, usage, and project paths are synthetic. The real parser and topology
builder process them. `/api/health` reports `environment: staging`,
`dataSource: fixture`, `releaseId`, `buildSha`, and `version`. Discovery explicitly
labels its real parsed snapshot as fixture data; both `/api/topology?mode=local`
and `snapshot.topology` retain `dataSource: fixture`. The staging wrapper preserves
the application's Host, Origin, and cross-site guards. The stop endpoint requires
a per-process bearer token kept only in the private staging marker.

## GitHub Actions

`.github/workflows/ci.yml` runs on pushes, pull requests, and manual dispatches.
All PR jobs run on GitHub-hosted runners:

- Node.js 24 on Linux and Windows: `npm ci`, `npm run test:coverage`, build.
- Hosted Linux Chromium: `npm run test:e2e` with HTML evidence.
- Hosted Linux fixture staging: real built app, API smoke, staging browser spec,
  and automatic process cleanup.
- Hosted Linux Docker: build the runtime image and check its health and topology
  through a loopback-only published port. No image push occurs in normal CI.

The coverage script owns its V8 thresholds and targets `server/topology.mjs` and
`shared/topology-layout.mjs`. CI uploads coverage and fixture-based Playwright
reports for seven days. Runtime release directories, marker tokens, `.agency`,
home log roots, `.claude`, `.codex`, `.remember`, credentials, and JSONL logs must
never be uploaded as artifacts or committed. E2E roots point at empty runner
directories; staging supplies its own generated roots explicitly.

## Private Windows runner setup

Repository runner registration is a separate administrative setup task. Register
a repository-scoped runner for `kasperhbo/agency-dashboard` on this machine,
using labels `self-hosted`, `Windows`, and `agency-staging`. Use a dedicated
unprivileged account and runner checkout, with Node.js 24, npm, Chromium, and
write access to the chosen persistent staging directory. Keep registration and
OAuth credentials outside this repository and outside artifacts.

Create a GitHub environment named `staging`, restrict it to the trusted `main`
branch, and configure its protection rules as desired. Add repository variables:

| Variable | Value |
| --- | --- |
| `ENABLE_PRIVATE_STAGING` | `true` |
| `AGENCY_STAGING_ROOT` | Absolute Windows path outside the runner checkout, e.g. `G:\agency-staging\agency-dashboard` |

Push the reviewed code to `main`, obtain a green CI run for that exact commit,
then run **Manual staging deployment** from `main` with
`deploy_private_runner=true` and `publish_image=false`. The workflow is triggered
only by `workflow_dispatch`; its self-hosted job additionally requires
`refs/heads/main`. Fork PRs cannot trigger it. It checks out that dispatch's exact
commit and calls `node scripts/deploy-staging.mjs deploy`. New staging process
tracking is detached deliberately so the runner does not kill the promoted
process after the job. Failed candidates are explicitly stopped by the script.

The workflow can be dispatched against a branch other than `main` for optional
image publishing, but its private-runner job is skipped. Treat anyone able to
push trusted workflow changes to `main` as able to execute code as the runner's
account; public repositories should review contributions on hosted CI before
merging. No pull-request workflow uses a self-hosted runner.

## Optional fixture container

Docker is an alternative fixture staging runtime. Its daemon must already be
available; these scripts do not start or reconfigure it. Node.js 24 multi-stage
builds install production dependencies, compile the frontend, then run as the
non-root `node` user. The positive `.dockerignore` allowlist excludes local data,
credentials, test files, and JSONL logs from the build context. Fixtures are
generated at runtime, never copied from native agent logs.

```powershell
docker compose -f deploy/compose.staging.yml up --build -d
docker compose -f deploy/compose.staging.yml ps
docker compose -f deploy/compose.staging.yml down
```

Stop Node staging before using the same host port. The app binds `0.0.0.0` only
inside this fixture container, with host publishing restricted to
`127.0.0.1:4320`. The root filesystem is read-only, task data is ephemeral tmpfs,
and no native data directories are mounted. The backend continues to accept
only loopback Host headers. `docker stop` is handled gracefully.

Optional GHCR publishing requires the explicit `publish_image=true` dispatch
input and `ENABLE_GHCR=true` repository variable. Review package visibility
before enabling it. The publishing job alone has `packages: write`, uses the
short-lived workflow token, and tags the image by the exact commit SHA. It does
not deploy that image or expose a host. The normal private Windows deployment
requires neither GHCR nor Docker.

## Verification limits

Local Node release, fixture parsing, task CRUD, promotion, failed-candidate
cleanup, and rollback are exercised by `server/deployment.test.mjs`. Full staging
verification additionally requires `tests/network-staging.spec.ts` and a passing
frontend build. Windows is checked locally; Linux and OCI runtime proof come
from the hosted CI jobs. When the local Docker daemon is unavailable, an image
build or runtime must not be claimed as locally tested. A committed workflow is
configuration until GitHub has actually run it; runner registration, repository
variables, and environment setup must be completed before remote deployment.
