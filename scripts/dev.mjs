import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const api = spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit', windowsHide: true });
const vite = await createServer();
await vite.listen();
vite.printUrls();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  api.kill();
  await vite.close();
  process.exit();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
api.on('exit', code => { if (!closing) { console.error(`API exited (${code})`); void close(); } });
