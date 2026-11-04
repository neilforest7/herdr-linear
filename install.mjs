import { cp, mkdir, readFile, writeFile, access, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const home = process.env.HERDR_APP_HOME || join(homedir(), '.config/herdr-app');
const mod = join(home, 'mods/linear');
const status = JSON.parse(execFileSync('herdr-app', ['status'], { encoding: 'utf8' }));
const builtIn = ['main', 'terminals', 'win98'].includes(status.layout);
const name = builtIn ? `${status.layout}-linear` : status.layout;
const path = join(home, 'layouts', `${name}.json`);
let needsClone = false;
try { await access(path); } catch { needsClone = builtIn; }
const original = await readFile(needsClone ? join(home, 'layouts', `${status.layout}.json`) : path, 'utf8');
const tree = JSON.parse(original);
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const hit = find(child, id); if (hit) return hit; }
}
let stack = find(tree, 'panel-body');
const tabs = find(tree, 'tabs');
if (!stack && tabs && find(tree, 'work-body')?.type === 'row') {
  stack = { id: 'panel-body', type: 'stack', active: 'linear', children: [] };
  find(tree, 'work-body').children.push({ id: 'panel', type: 'column', hidden: true, size: { px: 380 }, min: 300, max: 900, children: [stack] });
}
if (!stack || !tabs) throw new Error('This layout needs tabs and a work-body row or panel-body stack. No files changed.');
if (!stack.children.some(n => n.id === 'linear')) stack.children.push({ id: 'linear', type: 'block', content: { mod: 'linear' } });
const button = { id: 'linear-toggle', type: 'block', size: { px: 92 }, content: { mod: 'linear', props: { button: true } } };
if (!find(tree, 'linear-toggle')) {
  const row = find(tree, 'tabs-row') || find(tree, 'tab-bar');
  if (row) row.children.push(button);
  else {
    function wrap(node) {
      const index = node.children?.findIndex(c => c.id === 'tabs') ?? -1;
      if (index >= 0) {
        const old = node.children[index];
        node.children[index] = { id: 'tabs-row', type: 'row', size: old.size || { px: 42 }, resizable: false, children: [{ ...old, size: { weight: 1 } }, button] };
        return true;
      }
      return (node.children ?? []).some(wrap);
    }
    wrap(tree);
  }
}
await mkdir(join(home, 'data/linear'), { recursive: true });
try {
  const existing = JSON.parse(await readFile(join(mod, 'mod.json'), 'utf8'));
  if (existing.title !== 'Linear' || existing.place !== 'none') throw new Error('mods/linear is already occupied.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
execFileSync('herdr-app', ['check', join(root, 'mods/linear')], { stdio: 'inherit' });
await cp(join(root, 'mods/linear'), mod, { recursive: true });
await writeFile(join(home, 'data/linear/config.json'), JSON.stringify({ helper: join(root, 'helper/client.mjs'), node: process.execPath }, null, 2));
const staged = `${path}.linear-tmp`;
try {
  await writeFile(staged, JSON.stringify(tree, null, 2) + '\n');
  if (JSON.stringify(tree) !== JSON.stringify(JSON.parse(original))) {
    await writeFile(`${path}.before-linear-${Date.now()}`, original);
  }
  if (needsClone) execFileSync('herdr-app', ['do', 'layout.clone', JSON.stringify({ name: status.layout, as: name })]);
  const expected = await readFile(path, 'utf8');
  if (!needsClone && expected !== original) throw new Error('Layout changed during install. Run install.mjs again.');
  await rename(staged, path);
  if (builtIn && !needsClone) execFileSync('herdr-app', ['do', 'layout.switch', JSON.stringify({ name })]);
} catch (error) {
  if (needsClone) execFileSync('herdr-app', ['do', 'layout.switch', JSON.stringify({ name: status.layout })]);
  throw error;
} finally { await rm(staged, { force: true }); }
console.log(`Installed Linear in ${name}.`);
