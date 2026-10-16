import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { discoverSessions } from './sessions.mjs';
import { TaskStore, HttpError } from './store.mjs';
import { buildTopology } from './topology.mjs';
import { sampleTopology } from './topology-demo.mjs';
import { createClaudeAccountUsage } from './claude-account-usage.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultRoots = { claude: path.join(homedir(), '.claude', 'projects'), codex: path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'sessions') };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

export function createApp({ store = new TaskStore(path.join(projectRoot, '.agency', 'tasks.json')), roots = { claude: process.env.AGENCY_CLAUDE_ROOT || defaultRoots.claude, codex: process.env.AGENCY_CODEX_ROOT || defaultRoots.codex }, discover = discoverSessions, enableLiveClaudeUsage = true, accountUsageFetcher } = {}) {
  const accountUsage = enableLiveClaudeUsage ? accountUsageFetcher || createClaudeAccountUsage() : null;
  let snapshot, expires = 0, scanning;
  async function sessions() {
    if (snapshot && Date.now() < expires) return snapshot;
    if (!scanning) scanning = discover(roots).then(data => {
      snapshot = { ...data, topology: buildTopology({ ...data, dataSource: data.dataSource === 'fixture' ? 'fixture' : 'local' }) };
      expires = Date.now() + 9000;
      return snapshot;
    }).finally(() => { scanning = null; });
    return scanning;
  }
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    function json(status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw new HttpError(403, 'Local access only.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
      const origin = req.headers.origin;
      const allowed = new Set([`http://${host}`, 'http://127.0.0.1:5173', 'http://localhost:5173']);
      if (origin && !allowed.has(origin)) throw new HttpError(403, 'Origin is not allowed.');
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/claude-usage') {
          if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
          if ([...url.searchParams.keys()].some(key => key !== 'refresh') || url.searchParams.getAll('refresh').length > 1 || (url.searchParams.has('refresh') && url.searchParams.get('refresh') !== '1')) throw new HttpError(400, 'Only refresh=1 is accepted.');
          if (!accountUsage) return json(200, { status: 'unavailable', limits: null, fetchedAt: null, reason: 'Live Claude account usage is disabled on this server.' });
          try { return json(200, await accountUsage({ refresh: url.searchParams.has('refresh') })); }
          catch { return json(200, { status: 'error', limits: null, fetchedAt: null, reason: 'Claude account usage could not be read. Use Claude /usage or sign in normally.' }); }
        }
        if (req.method === 'GET' && url.pathname === '/api/sessions') return json(200, await sessions());
        if (req.method === 'GET' && url.pathname === '/api/topology') {
          if ([...url.searchParams.keys()].some(key => key !== 'mode') || url.searchParams.getAll('mode').length > 1) throw new HttpError(400, 'Only one mode parameter is accepted.');
          const mode = url.searchParams.get('mode') ?? 'local';
          if (mode !== 'local' && mode !== 'demo') throw new HttpError(400, 'Mode must be local or demo.');
          return json(200, mode === 'demo' ? sampleTopology() : (await sessions()).topology);
        }
        if (req.method === 'GET' && url.pathname === '/api/tasks') return json(200, await store.list());
        if (req.method === 'GET' && url.pathname === '/api/health') return json(200, { ok: true, version: '1.0.0' });
        if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
          if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Send application/json.');
          const chunks = [];
          let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 16000) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
          let body;
          try { body = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON.'); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'A JSON object is required.');
          if (req.method === 'POST' && url.pathname === '/api/tasks') return json(201, await store.create(body));
          const match = url.pathname.match(/^\/api\/tasks\/([a-zA-Z0-9-]{1,80})$/);
          if (match && req.method === 'PATCH') return json(200, await store.update(match[1], body, body.revision));
          if (match && req.method === 'DELETE') return json(200, await store.delete(match[1], body.revision));
        }
        throw new HttpError(404, 'API route not found.');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      const dist = path.join(projectRoot, 'dist');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Invalid URL encoding.'); }
      const requested = path.resolve(dist, '.' + pathname);
      if (requested !== dist && !requested.startsWith(dist + path.sep)) throw new HttpError(403, 'Invalid path.');
      let target = requested;
      try { if (!(await stat(target)).isFile()) target = path.join(dist, 'index.html'); }
      catch { target = path.extname(requested) ? requested : path.join(dist, 'index.html'); }
      let content;
      try { content = await readFile(target); } catch { throw new HttpError(404, 'App is not built. Run npm run build, or npm run dev for development.'); }
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!error.status) console.error('Agency request failed:', error.message);
      json(error.status || 500, { error: error.status ? error.message : 'Request failed. Check the server console and try again.' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.AGENCY_PORT || 4318);
  const server = createApp();
  server.listen(port, '127.0.0.1', () => console.log(`Agency API + production app: http://127.0.0.1:${port}`));
  server.on('error', error => { console.error(error.message); process.exit(1); });
}
