import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { withVaultLock } from './vault-lock.mjs';

const exec = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), 'herdr-vault-lock-'));
const lock = join(dir, 'lock');
test.after(async () => rm(dir, { recursive: true, force: true }));

test('serializes read and write across processes using a fake vault file', async () => {
  const vault = join(dir, 'vault.json');
  await writeFile(vault, '0');
  const moduleUrl = new URL('./vault-lock.mjs', import.meta.url).href;
  const script = `import { withVaultLock } from ${JSON.stringify(moduleUrl)};
    import { readFileSync, writeFileSync } from 'node:fs';
    const [lock, vault] = process.argv.slice(1);
    for (let i = 0; i < 5; i++) await withVaultLock(() => {
      const n = Number(readFileSync(vault, 'utf8'));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      writeFileSync(vault, String(n + 1));
    }, lock);`;
  await Promise.all(Array.from({ length: 5 }, () => exec(process.execPath, ['--input-type=module', '-e', script, lock, vault], { timeout: 15_000 })));
  assert.equal(await readFile(vault, 'utf8'), '25');
});

test('reclaims stale locks and releases the lock when a callback throws', async () => {
  await writeFile(lock, '2147483647\n');
  await assert.rejects(withVaultLock(() => { throw new Error('test failure'); }, lock), /test failure/);
  assert.equal(await withVaultLock(() => 'recovered', lock), 'recovered');
});

test('times out instead of removing a live process lock', async () => {
  await writeFile(lock, `${process.pid}\n`);
  const start = Date.now();
  await assert.rejects(withVaultLock(() => assert.fail('lock should remain held'), lock), /credential lock unavailable/);
  assert.ok(Date.now() - start >= 2_900 && Date.now() - start < 5_000);
  assert.equal((await readFile(lock, 'utf8')).trim(), String(process.pid));
  await rm(lock);
});
