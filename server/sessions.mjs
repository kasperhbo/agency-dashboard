import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { SessionParser } from './session-parser.mjs';
import { reportUsage } from './usage.mjs';

const MAX_FILES = 100;
const MAX_ENTRIES = 6000;
const MAX_LOG_BYTES = 64 * 1024 * 1024;
const MAX_LINE_CHARS = 2 * 1024 * 1024;
const freshness = 2 * 60 * 1000;
const fileCache = new Map();
function pushLine(parser, line) {
  if (!line.trim()) return;
  if (line.length > MAX_LINE_CHARS) { parser.skippedLines++; return; }
  try { parser.push(JSON.parse(line)); } catch { parser.skippedLines++; }
}
export function parseSession(text, provider, file, modified, now = Date.now()) {
  const parser = new SessionParser(provider, file, modified);
  for (const line of text.split('\n')) pushLine(parser, line);
  return parser.finish(now)?.session || null;
}
async function readSession(file, provider, size, modified) {
  const parser = new SessionParser(provider, file, modified);
  parser.partial = size > MAX_LOG_BYTES;
  if (parser.partial) parser.issues.add('Only the first 64 MiB of this log could be read. Usage is a lower bound.');
  let pending = '', dropping = false;
  if (size) for await (let chunk of createReadStream(file, { encoding: 'utf8', end: Math.min(size, MAX_LOG_BYTES) - 1 })) {
    if (dropping) {
      const newline = chunk.indexOf('\n');
      if (newline === -1) continue;
      chunk = chunk.slice(newline + 1); dropping = false;
    }
    pending += chunk;
    let start = 0, newline;
    while ((newline = pending.indexOf('\n', start)) !== -1) { pushLine(parser, pending.slice(start, newline)); start = newline + 1; }
    pending = pending.slice(start);
    if (pending.length > MAX_LINE_CHARS) { pending = ''; dropping = true; parser.skippedLines++; }
  }
  if (pending) pushLine(parser, pending);
  return parser.finish();
}

async function scanRoot(root, provider) {
  const files = [], warnings = [];
  let entries = 0, limited = false;
  async function walk(dir, depth) {
    if (depth > 8 || entries >= MAX_ENTRIES) { limited = true; return; }
    const children = await readdir(dir, { withFileTypes: true });
    // Newest date folders first for Codex, so a bounded scan remains useful.
    children.sort((a, b) => b.name.localeCompare(a.name));
    for (const child of children) {
      if (++entries > MAX_ENTRIES) { limited = true; break; }
      const full = path.join(dir, child.name);
      if (child.isDirectory()) {
        try { await walk(full, depth + 1); } catch (err) { warnings.push(`A session folder could not be read (${err.code || 'read error'}).`); }
      } else if (child.isFile() && child.name.endsWith('.jsonl')) {
        try { const info = await stat(full); files.push({ file: full, size: info.size, modified: info.mtimeMs }); }
        catch { warnings.push('A session file changed during discovery.'); }
      }
    }
  }
  try { await walk(root, 0); }
  catch (err) {
    return { sessions: [], source: { provider, path: root, status: err.code === 'ENOENT' ? 'not_found' : 'error', count: 0, limited: false, warnings: err.code === 'ENOENT' ? [] : [`Session folder could not be read (${err.code || 'read error'}).`] } };
  }
  files.sort((a, b) => b.modified - a.modified);
  if (files.length > MAX_FILES) limited = true;
  const sessions = [], results = [];
  for (const entry of files.slice(0, MAX_FILES)) {
    try {
      const key = `${entry.modified}:${entry.size}`;
      const cached = fileCache.get(entry.file);
      let result;
      if (cached?.key === key) result = cached.result;
      else {
        result = await readSession(entry.file, provider, entry.size, entry.modified);
        fileCache.set(entry.file, { key, result });
      }
      if (result) {
        const session = structuredClone(result.session);
        if (session.status === 'running' && Date.now() - Date.parse(session.lastActivityAt) > freshness) session.status = 'idle';
        sessions.push(session);
        results.push({ ...result, session });
        if (session.usage.coverage === 'partial') warnings.push('Some logs have skipped lines or counter inconsistencies. Recorded usage may be a lower bound.');
      }
    } catch { warnings.push('A session file could not be read. Try refreshing.'); }
  }
  if (fileCache.size > 400) fileCache.clear();
  return { sessions, results, source: { provider, path: root, status: 'connected', count: sessions.length, sessionCount: new Set(sessions.filter(session => session.kind === 'session').map(session => session.nativeId)).size, subagentCount: new Set(sessions.filter(session => session.kind === 'subagent').map(session => `${session.parentNativeId || ''}:${session.nativeId}`)).size, limited, warnings: [...new Set(warnings)] } };
}

export async function discoverSessions(roots) {
  const results = await Promise.all(Object.entries(roots).map(([provider, root]) => scanRoot(root, provider)));
  return { sessions: results.flatMap(r => r.sessions).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), sources: results.map(r => r.source), usage: reportUsage(results.flatMap(result => result.results || [])), scannedAt: new Date().toISOString() };
}
