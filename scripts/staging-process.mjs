import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Own the complete build/test process tree, including npm and browser children.
export async function runOwnedNode(args, { cwd, env = process.env, timeoutMs = 180000, label = 'Staging command' } = {}) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32' });
  let termination;
  let reason;
  const terminate = message => {
    reason ||= message;
    if (termination || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      termination = once(killer, 'exit').catch(() => { child.kill(); });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      termination = Promise.resolve();
    }
  };
  const interrupt = () => terminate('interrupted');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const timeout = setTimeout(() => terminate('timed out'), timeoutMs);
  try {
    const [code, signal] = await once(child, 'exit');
    await termination;
    if (reason || code !== 0) throw new Error(`${label} ${reason || `failed (${signal || code})`}.`);
  } finally {
    clearTimeout(timeout);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}
