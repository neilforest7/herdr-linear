import { execFile } from 'node:child_process';
import { mkdir, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const shlock = promisify(execFile);
const defaultPath = join(homedir(), '.config/herdr-app/data/linear-vault.lock');

export async function withVaultLock(fn, path = defaultPath) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 3_000;
  while (true) {
    try {
      await shlock('/usr/bin/shlock', ['-p', String(process.pid), '-f', path], { timeout: Math.max(1, deadline - Date.now()) });
      break;
    } catch (error) {
      if (typeof error.code !== 'number' || Date.now() >= deadline) throw new Error('Linear credential lock unavailable');
      await delay(Math.min(25, Math.max(0, deadline - Date.now())));
    }
  }
  try { return fn(); }
  finally { await unlink(path); }
}
