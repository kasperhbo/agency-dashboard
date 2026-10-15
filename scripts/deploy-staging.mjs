import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import { access, cp, mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runStagingBrowser } from './staging-browser.mjs';
import { smokeStaging, stagingURL } from './staging-smoke.mjs';
import { runOwnedNode } from './staging-process.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stagingDirectory = sourceRoot => path.resolve(process.env.AGENCY_STAGING_ROOT || path.join(sourceRoot, '.agency/staging'));

async function readJSON(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function atomicJSON(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  try { await rename(temporary, file); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function build(cwd) {
  // Invoke npm's JS entry point directly, avoiding cmd.exe and an extra process tree.
  const executableDirectory = path.dirname(process.execPath);
  const candidates = [process.env.npm_execpath, path.join(executableDirectory, 'node_modules/npm/bin/npm-cli.js'), path.resolve(executableDirectory, '../lib/node_modules/npm/bin/npm-cli.js'), '/usr/share/nodejs/npm/bin/npm-cli.js'].filter(Boolean);
  let npm;
  for (const candidate of candidates) { try { await access(candidate); npm = candidate; break; } catch {} }
  if (!npm) throw new Error('Cannot locate npm-cli.js. Run through npm run test:staging or install a standard Node.js distribution.');
  await runOwnedNode([npm, 'run', 'build'], { cwd, label: 'Frontend build' });
}

export async function prepareRelease({ sourceRoot = project, stagingRoot = stagingDirectory(sourceRoot), buildApp = true } = {}) {
  if (buildApp) await build(sourceRoot);
  await access(path.join(sourceRoot, 'dist/index.html'));
  const pkg = await readJSON(path.join(sourceRoot, 'package.json'));
  const sha = process.env.GITHUB_SHA || process.env.AGENCY_BUILD_SHA || 'uncommitted';
  const id = `${new Date().toISOString().replace(/[^0-9]/g, '')}-${randomUUID().slice(0, 8)}`;
  const releaseRoot = path.join(stagingRoot, 'releases', id);
  await mkdir(path.join(releaseRoot, 'scripts'), { recursive: true });
  // Positive allowlist: no home roots, .agency data, credentials, tests, or reports.
  const copy = (from, to) => cp(from, to, { recursive: true, filter: async (entry) => {
    const { lstat } = await import('node:fs/promises');
    if ((await lstat(entry)).isSymbolicLink()) throw new Error('Release artifacts must not contain symbolic links.');
    return !/\.test\.mjs$/.test(entry);
  } });
  await copy(path.join(sourceRoot, 'dist'), path.join(releaseRoot, 'dist'));
  await mkdir(path.join(releaseRoot, 'server'), { recursive: true });
  for (const entry of await readdir(path.join(sourceRoot, 'server'))) {
    if (entry.endsWith('.mjs') && !entry.endsWith('.test.mjs')) await copy(path.join(sourceRoot, 'server', entry), path.join(releaseRoot, 'server', entry));
  }
  try { await copy(path.join(sourceRoot, 'shared'), path.join(releaseRoot, 'shared')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const entry of ['staging-server.mjs', 'staging-fixtures.mjs']) await copy(path.join(sourceRoot, 'scripts', entry), path.join(releaseRoot, 'scripts', entry));
  const manifest = { id, sha, version: pkg.version, builtAt: new Date().toISOString() };
  await atomicJSON(path.join(releaseRoot, 'release.json'), manifest);
  return { ...manifest, releaseRoot };
}

async function startCandidate(release, port) {
  const directory = path.join(release.releaseRoot, 'runtime');
  await mkdir(directory, { recursive: true });
  await unlink(path.join(directory, 'ready.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const token = randomUUID();
  const log = openSync(path.join(directory, 'server.log'), 'a', 0o600);
  const child = spawn(process.execPath, [path.join(release.releaseRoot, 'scripts/staging-server.mjs')], {
    cwd: release.releaseRoot, detached: true, windowsHide: true, stdio: ['ignore', log, log],
    env: { ...process.env, RUNNER_TRACKING_ID: '', AGENCY_STAGING_DATA: directory, AGENCY_STAGING_PORT: String(port), AGENCY_STAGING_HOST: '127.0.0.1', AGENCY_STAGING_CONTAINER: '0', AGENCY_STAGING_TOKEN: token },
  });
  closeSync(log);
  let startupError;
  child.once('error', error => { startupError = error; });
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (startupError) throw startupError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Candidate exited before readiness; inspect ${path.join(directory, 'server.log')}.`);
      const ready = await readJSON(path.join(directory, 'ready.json'));
      if (ready?.releaseId === release.id) {
        const url = stagingURL(ready.url);
        const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) }).then(response => response.json());
        if (health.releaseId !== release.id || health.environment !== 'staging') throw new Error('Candidate release identity did not match.');
        return { ...release, url, token, child };
      }
      await delay(100);
    }
    throw new Error('Candidate startup exceeded 10 seconds.');
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const exited = once(child, 'exit');
  child.kill();
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  try { await exited; } finally { clearTimeout(timer); }
}

async function stopManaged(active) {
  if (!active) return;
  const base = stagingURL(active.url);
  let health;
  try { health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) }).then(response => response.json()); }
  catch (error) { if (error.cause?.code === 'ECONNREFUSED') return; throw error; }
  if (health.environment !== 'staging' || health.releaseId !== active.id) throw new Error('Refusing to stop a server with a different release identity.');
  try {
    const response = await fetch(`${base}/__staging/stop`, { method: 'POST', headers: { Authorization: `Bearer ${active.token}`, Connection: 'close' }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Managed staging stop failed: HTTP ${response.status}.`);
    await response.text();
  } catch (error) {
    // A server retiring its sockets can close the control connection first.
    if (!['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes(error.cause?.code)) throw error;
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${base}/api/health`, { headers: { Connection: 'close' }, signal: AbortSignal.timeout(1000) });
      await response.text();
    } catch (error) {
      if (error.cause?.code === 'ECONNREFUSED') return;
      if (!['ECONNRESET', 'UND_ERR_SOCKET'].includes(error.cause?.code)) throw error;
    }
    await delay(100);
  }
  throw new Error('Managed staging did not stop within 3 seconds.');
}

export async function deployStaging({ sourceRoot = project, stagingRoot = stagingDirectory(sourceRoot), verifyOnly = false, buildApp = true, port, browser = runStagingBrowser, smoke = smokeStaging } = {}) {
  await mkdir(stagingRoot, { recursive: true });
  const lockPath = path.join(stagingRoot, 'deploy.lock');
  const lock = await open(lockPath, 'wx').catch(error => { if (error.code === 'EEXIST') throw new Error('Another staging operation owns deploy.lock. Inspect it before removing a stale lock.'); throw error; });
  let candidate;
  let promoted = false;
  let previousStopped = false;
  let previous;
  const interrupt = () => { if (!promoted) candidate?.child.kill(); };
  process.once('SIGTERM', interrupt);
  process.once('SIGINT', interrupt);
  try {
    const activeFile = path.join(stagingRoot, 'active.json');
    previous = await readJSON(activeFile);
    const release = await prepareRelease({ sourceRoot, stagingRoot, buildApp });
    candidate = await startCandidate(release, 0);
    const report = await smoke(candidate.url, { releaseId: candidate.id });
    await browser(candidate.url, { cwd: sourceRoot });
    const evidence = path.join(sourceRoot, 'test-results/staging');
    await mkdir(evidence, { recursive: true });
    await atomicJSON(path.join(evidence, 'smoke.json'), { ...report, buildSha: release.sha, version: release.version, browser: 'passed', checkedAt: new Date().toISOString() });
    if (!verifyOnly) {
      const targetPort = port ?? Number(process.env.AGENCY_STAGING_PORT || 4320);
      if (targetPort !== 0) {
        await stopChild(candidate.child);
        await stopManaged(previous);
        previousStopped = Boolean(previous);
        candidate = await startCandidate(release, targetPort);
        await smoke(candidate.url, { releaseId: candidate.id });
      }
      const { child, ...marker } = candidate;
      if (previous) await atomicJSON(path.join(stagingRoot, 'previous.json'), previous);
      await atomicJSON(activeFile, marker);
      promoted = true;
      child.unref();
      try { if (!previousStopped) await stopManaged(previous); }
      catch (error) { console.warn(`New release is active; previous instance could not be stopped: ${error.message}`); }
    }
    console.log(`${verifyOnly ? 'Verified and stopped' : 'Active local staging'}: ${candidate.url} release=${candidate.id}`);
    return { id: candidate.id, url: candidate.url, verified: true, promoted: !verifyOnly };
  } catch (error) {
    if (previousStopped && !promoted) {
      if (candidate) await stopChild(candidate.child);
      try {
        const restored = await startCandidate(previous, Number(new URL(previous.url).port));
        const { child, ...marker } = restored;
        await atomicJSON(path.join(stagingRoot, 'active.json'), marker);
        child.unref();
        console.warn(`Previous staging release restored: ${restored.id}`);
      } catch (restoreError) { throw new AggregateError([error, restoreError], `Candidate failed and previous staging could not restart: ${restoreError.message}`); }
    }
    throw error;
  } finally {
    if (candidate && !promoted) await stopChild(candidate.child);
    process.removeListener('SIGTERM', interrupt);
    process.removeListener('SIGINT', interrupt);
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stagingRoot = stagingDirectory(project);
  try {
    const command = process.argv[2] || 'verify';
    if (['verify', 'deploy'].includes(command)) await deployStaging({ verifyOnly: command === 'verify' });
    else if (command === 'status') {
      const active = await readJSON(path.join(stagingRoot, 'active.json'));
      if (!active) console.log('No managed local staging deployment.');
      else {
        const response = await fetch(`${stagingURL(active.url)}/api/health`, { signal: AbortSignal.timeout(3000) });
        const health = await response.json();
        if (!response.ok || health.releaseId !== active.id || health.environment !== 'staging') throw new Error('Active marker does not match a healthy staging process.');
        console.log(JSON.stringify({ url: active.url, ...health }, null, 2));
      }
    } else if (command === 'stop') {
      await mkdir(stagingRoot, { recursive: true });
      const lock = await open(path.join(stagingRoot, 'deploy.lock'), 'wx');
      try {
        const active = await readJSON(path.join(stagingRoot, 'active.json'));
        await stopManaged(active);
        if (active) await unlink(path.join(stagingRoot, 'active.json'));
        console.log('Managed local staging stopped.');
      } finally { await lock.close(); await unlink(path.join(stagingRoot, 'deploy.lock')); }
    } else throw new Error('Usage: node scripts/deploy-staging.mjs verify|deploy|status|stop');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
