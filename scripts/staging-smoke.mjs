import assert from 'node:assert/strict';

export function stagingURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Staging URL must be a plain loopback HTTP origin.');
  return url.origin;
}

export async function smokeStaging(value, { releaseId, requireTopology = true } = {}) {
  const base = stagingURL(value);
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`${base}${route}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000), redirect: 'error' });
    assert.ok(response.ok, `${method} ${route}: HTTP ${response.status}`);
    return response.json();
  };
  const health = await request('/api/health');
  assert.equal(health.ok, true);
  assert.equal(health.environment, 'staging');
  assert.equal(health.dataSource, 'fixture');
  if (releaseId) assert.equal(health.releaseId, releaseId);
  const snapshot = await request('/api/sessions');
  assert.equal(snapshot.dataSource, 'fixture');
  assert.ok(snapshot.sessions.some(session => session.provider === 'codex'));
  const parent = snapshot.sessions.find(session => session.nativeId === 'staging-claude-parent');
  assert.ok(parent, 'Synthetic Claude parent was parsed');
  assert.ok(snapshot.sessions.some(session => session.kind === 'subagent' && session.parentNativeId === parent.nativeId), 'Synthetic child retains its parent link');
  assert.ok(snapshot.sources.every(source => source.status === 'connected'));
  if (requireTopology) {
    const topology = await request('/api/topology?mode=local');
    assert.equal(topology.version, 1);
    assert.equal(topology.dataSource, 'fixture');
    assert.ok(topology.nodes.some(node => node.kind === 'subagent' || node.type === 'subagent'));
    assert.ok(topology.summary.subagents >= 1);
  }
  const home = await fetch(base, { signal: AbortSignal.timeout(5000) });
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<div[^>]+id=["']root["']/);
  const asset = html.match(/<script[^>]+src=["']([^"']+)/)?.[1];
  assert.ok(asset, 'Built HTML references a JavaScript bundle');
  const assetURL = new URL(asset, base);
  assert.equal(assetURL.origin, base);
  const bundle = await fetch(assetURL, { signal: AbortSignal.timeout(5000) });
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get('content-type'), /javascript/);
  const task = await request('/api/tasks', 'POST', { title: 'Synthetic staging smoke', provider: 'claude', status: 'todo', priority: 'medium' });
  let latest = task;
  try {
    assert.ok((await request('/api/tasks')).some(item => item.id === task.id));
    latest = await request(`/api/tasks/${task.id}`, 'PATCH', { ...task, status: 'done' });
    assert.equal(latest.status, 'done');
  } finally { await request(`/api/tasks/${task.id}`, 'DELETE', { revision: latest.revision }); }
  const blocked = await fetch(`${base}/api/tasks`, { headers: { Origin: 'https://untrusted.invalid' }, signal: AbortSignal.timeout(5000) });
  assert.equal(blocked.status, 403);
  return { ok: true, environment: health.environment, releaseId: health.releaseId, sessions: snapshot.sessions.length, checked: ['health', 'parsed-fixtures', ...(requireTopology ? ['topology'] : []), 'built-app', 'task-crud', 'origin-guard'] };
}
