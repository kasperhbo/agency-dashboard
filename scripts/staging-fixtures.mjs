import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Generated synthetic records only. Never discover or copy a user's agent roots.
export async function writeFixtures(directory) {
  const roots = { claude: path.join(directory, 'claude'), codex: path.join(directory, 'codex') };
  const timestamp = new Date().toISOString();
  const parent = 'staging-claude-parent';
  const common = { sessionId: parent, cwd: '/synthetic/staging-project', timestamp };
  const assistant = (id, extra = {}) => ({ ...common, ...extra, type: 'assistant', message: { id, model: 'claude-sonnet-4-5', content: [{ type: 'tool_use', id: `${id}-tool`, name: 'Read', input: {} }], usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 40, cache_creation_input_tokens: 0 } } });
  const files = [
    [path.join(roots.claude, `${parent}.jsonl`), [{ ...common, type: 'user', message: { content: 'Synthetic staging parent: verify agent topology' } }, assistant('staging-parent-message')]],
    [path.join(roots.claude, parent, 'subagents', 'agent-staging-child.jsonl'), [{ ...common, agentId: 'staging-child', isSidechain: true, type: 'user', message: { content: 'Synthetic staging subagent: inspect graph' } }, assistant('staging-child-message', { agentId: 'staging-child', isSidechain: true })]],
    [path.join(roots.codex, 'staging-codex-parent.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'staging-codex-parent', cwd: '/synthetic/staging-project' } },
      { timestamp, type: 'turn_context', payload: { model: 'gpt-5-codex' } },
      { timestamp, type: 'event_msg', payload: { type: 'user_message', message: 'Synthetic staging Codex session' } },
      { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 200, cached_input_tokens: 50, output_tokens: 40, reasoning_output_tokens: 10, total_tokens: 240 }, last_token_usage: { input_tokens: 200, cached_input_tokens: 50, output_tokens: 40, reasoning_output_tokens: 10, total_tokens: 240 } } } },
    ]],
  ];
  for (const [file, records] of files) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, records.map(record => JSON.stringify(record)).join('\n') + '\n', { mode: 0o600 });
  }
  return roots;
}
