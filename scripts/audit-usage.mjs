// Read-only reconciliation. Prints counts and hashes, never prompts or tool arguments.
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { discoverSessions } from '../server/sessions.mjs';

const roots = {
  claude: process.env.AGENCY_CLAUDE_ROOT || path.join(homedir(), '.claude/projects'),
  codex: process.env.AGENCY_CODEX_ROOT || path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'sessions'),
};
const observed = await discoverSessions(roots);
const reports = [];
for (const [provider, root] of Object.entries(roots)) {
  const files = []; let entries = 0;
  async function walk(dir, depth = 0) {
    if (depth > 8 || entries >= 6000) return;
    const children = await readdir(dir, { withFileTypes: true });
    children.sort((a, b) => b.name.localeCompare(a.name));
    for (const item of children) {
      if (++entries > 6000) break;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await walk(file, depth + 1);
      else if (item.isFile() && file.endsWith('.jsonl')) files.push({ file, info: await stat(file) });
    }
  }
  try { await walk(root); } catch (error) { reports.push({ provider, error: error.code }); continue; }
  files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
  const globalMessages = new Map(), threadTotals = new Map(), mismatchHashes = [];
  let total = 0, checked = 0, changing = 0, subagents = 0, repeated = 0;
  for (const { file, info } of files.slice(0, 100)) {
    const id = createHash('sha256').update(`${provider}:${file}`).digest('hex').slice(0, 20);
    const found = observed.sessions.find(session => session.id === id);
    if (!found || !info.size) continue;
    if (found.fileModifiedAt && Date.parse(found.fileModifiedAt) !== info.mtimeMs && Math.abs(Date.parse(found.fileModifiedAt) - info.mtimeMs) >= 1) { changing++; continue; }
    const messages = new Map(); let cumulative = null;
    const rows = createInterface({ input: createReadStream(file, { end: info.size - 1 }), crlfDelay: Infinity });
    for await (const line of rows) {
      let record; try { record = JSON.parse(line); } catch { continue; }
      if (provider === 'claude' && record.type === 'assistant' && !record.isApiErrorMessage && record.message?.usage) {
        const message = record.message, usage = message.usage;
        const values = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].map(key => Number.isFinite(usage[key]) && usage[key] >= 0 ? usage[key] : 0);
        const key = message.id || record.uuid;
        if (!key) continue;
        const previous = messages.get(key) || [0, 0, 0, 0];
        messages.set(key, values.map((value, i) => Math.max(value, previous[i])));
      }
      if (provider === 'codex') {
        const usage = record.type === 'token_usage_record' ? record.payload?.thread_token_usage : record.type === 'event_msg' && record.payload?.type === 'token_count' ? record.payload.info?.total_token_usage : null;
        if (Number.isFinite(usage?.total_tokens)) cumulative = Math.max(cumulative ?? 0, usage.total_tokens);
      }
    }
    const fresh = await stat(file);
    if (fresh.size !== info.size || fresh.mtimeMs !== info.mtimeMs) { changing++; continue; }
    const expected = provider === 'claude' ? messages.size ? [...messages.values()].flat().reduce((a, b) => a + b, 0) : null : cumulative;
    for (const [key, value] of messages) {
      if (globalMessages.has(key)) repeated++;
      const previous = globalMessages.get(key) || [0, 0, 0, 0];
      globalMessages.set(key, value.map((n, i) => Math.max(n, previous[i])));
    }
    checked++; total += expected ?? 0;
    if (provider === 'codex' && expected !== null) threadTotals.set(found.nativeId, Math.max(threadTotals.get(found.nativeId) ?? 0, expected));
    if (file.includes(`${path.sep}subagents${path.sep}`)) subagents++;
    if (found.tokens !== expected) mismatchHashes.push(id);
  }
  const expectedAggregate = provider === 'claude' ? [...globalMessages.values()].flat().reduce((a, b) => a + b, 0) : [...threadTotals.values()].reduce((a, b) => a + b, 0);
  const dashboardTokens = observed.usage?.providers.find(item => item.provider === provider)?.totalTokens ?? null;
  reports.push({ provider, checked, changingFilesExcluded: changing, subagents, fullLogTokens: total, duplicateMessageIdsAcrossFiles: repeated, independentlyDeduplicatedTokens: expectedAggregate, dashboardTokens, aggregateMatches: changing ? null : dashboardTokens === expectedAggregate, mismatches: mismatchHashes.length, mismatchHashes });
}
console.log(JSON.stringify({ auditedAt: new Date().toISOString(), reports }, null, 2));
if (reports.some(report => report.mismatches || report.error || report.aggregateMatches === false)) process.exitCode = 1;
