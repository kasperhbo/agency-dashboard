import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createApp } from '../server/index.mjs';

// Own test servers directly: Windows process-tree termination can hang in WMI.
// Close only servers created here, preserving any existing developer servers.
const owned = [];
let vite;
let runner;
async function running(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const data = await response.json();
    return response.ok && data.ok === true && data.version === '1.0.0';
  } catch { return false; }
}
async function listen(port) {
  const server = createApp();
  const ready = once(server, 'listening');
  server.listen(port, '127.0.0.1');
  await ready;
  owned.push(server);
}
async function cleanup() {
  if (vite) await vite.close();
  await Promise.all(owned.map(server => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  })));
}
process.once('SIGINT', () => runner?.kill());
process.once('SIGTERM', () => runner?.kill());
try {
  if (!await running(4318)) await listen(4318);
  if (!await running(5173)) {
    vite = await createViteServer();
    await vite.listen();
  }
  await listen(4319);
  const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
  runner = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
  const [code] = await once(runner, 'exit');
  process.exitCode = code ?? 1;
} catch (error) {
  console.error(`Browser checks could not run: ${error.message}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
