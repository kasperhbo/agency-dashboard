import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.mjs';
import { TaskStore } from '../server/store.mjs';
import { discoverSessions } from '../server/sessions.mjs';
import { writeFixtures } from './staging-fixtures.mjs';

export async function startStaging({ directory, port = 4320, host = '127.0.0.1', release = {}, token = randomUUID(), container = false } = {}) {
  if (host !== '127.0.0.1' && !(container && host === '0.0.0.0')) throw new Error('Staging binds loopback; wildcard binding is reserved for the fixture container.');
  if (!directory) throw new Error('An isolated staging data directory is required.');
  await mkdir(directory, { recursive: true });
  const roots = await writeFixtures(path.join(directory, 'fixtures'));
  const server = createApp({
    enableLiveClaudeUsage: false,
    roots,
    store: new TaskStore(path.join(directory, 'tasks.json')),
    discover: async fixtureRoots => ({ ...await discoverSessions(fixtureRoots), dataSource: 'fixture' }),
  });
  const handler = server.listeners('request')[0];
  server.removeAllListeners('request');
  const metadata = { environment: 'staging', dataSource: 'fixture', releaseId: release.id || 'standalone', buildSha: release.sha || 'uncommitted', version: release.version || '1.0.0' };
  let closed;
  const stop = () => closed ||= new Promise(resolve => {
    server.close(resolve);
    server.closeIdleConnections();
    const timer = setTimeout(() => server.closeAllConnections(), 1000);
    timer.unref();
  });
  server.on('request', (req, res) => {
    // Port 4320 can move between releases; do not reuse a socket to a retired one.
    res.setHeader('Connection', 'close');
    // The original handler continues to enforce its real-data host/origin policy.
    const hostHeader = req.headers.host || '';
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(hostHeader)
      && req.headers['sec-fetch-site'] !== 'cross-site'
      && (!req.headers.origin || req.headers.origin === `http://${hostHeader}`);
    if (local && req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ ok: true, ...metadata }));
      return;
    }
    if (local && !container && req.method === 'POST' && req.url === '/__staging/stop' && req.headers.authorization === `Bearer ${token}`) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.once('finish', () => setImmediate(() => void stop()));
      res.end('{"ok":true}');
      return;
    }
    void handler(req, res);
  });
  server.listen(port, host);
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  return { server, stop, url, metadata, token };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let stage;
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    let release = {};
    try { release = JSON.parse(await readFile(path.join(root, 'release.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const directory = path.resolve(process.env.AGENCY_STAGING_DATA || path.join(root, '.agency', 'staging', 'standalone'));
    stage = await startStaging({ directory, port: Number(process.env.AGENCY_STAGING_PORT || 4320), host: process.env.AGENCY_STAGING_HOST || '127.0.0.1', container: process.env.AGENCY_STAGING_CONTAINER === '1', release, token: process.env.AGENCY_STAGING_TOKEN });
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => void stage.stop());
    const readyFile = path.join(directory, 'ready.json');
    await writeFile(`${readyFile}.tmp`, JSON.stringify({ url: stage.url, ...stage.metadata }), { mode: 0o600 });
    await rename(`${readyFile}.tmp`, readyFile);
    console.log(`Fixture staging: ${stage.url} (${stage.metadata.releaseId})`);
  } catch (error) {
    await stage?.stop();
    console.error(`Staging startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
