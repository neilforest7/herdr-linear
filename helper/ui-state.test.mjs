import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { find } from '../mods/linear/model.js';

test('unbound spaces collapse once on entry, allow reopening, and discard a stale collapse', async () => {
  let current = 'bound';
  let toggle;
  const bindings = { bound: { id: 'project', name: 'Project' }, skipped: { disabled: true } };
  const panel = { id: 'panel', hidden: false };
  const body = { id: 'panel-body', active: 'linear' };
  const root = { children: [panel, body] };
  const calls = [], pending = [];
  const element = new Proxy({}, { get: () => () => element });
  const cx = { sleep: async () => {}, spawn: fn => pending.push(fn(cx)), notify: () => {} };
  globalThis.herdrLinearFixture = {
    View: class {}, h_flex: () => element, div: () => element, svg: () => element,
    action: (id, _label, fn) => { if(id === 'linear-toggle') toggle = fn; return element; }, theme: () => ({}), props: () => ({ button: true }),
    spaces: () => [{ id: current, active: true }], layout: () => root, find,
    shared: key => key === 'linear.projects.v1' ? bindings : ['files', 'changes', 'linear'],
    setShared: (_key, value) => Object.assign(bindings, value),
    run: (command, args) => { if(command === 'layout.hide'){calls.push([command,args]);panel.hidden=true;} else if(command === 'layout.show')panel.hidden=false; else if(command === 'layout.select')body.active=args.child; },
  };
  try {
    const source = (await readFile(new URL('../mods/linear/main.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
    const bindingsCode = `const {View,h_flex,div,svg,action,theme,props,spaces,layout,find,shared,setShared,run}=globalThis.herdrLinearFixture;\n`;
    const { default: Linear } = await import(`data:text/javascript;base64,${Buffer.from(bindingsCode + source).toString('base64')}`);
    const view = new Linear(); view.init(null, cx);
    const flush = async () => { await Promise.all(pending.splice(0)); };
    view.render(cx); await flush(); assert.equal(calls.length, 0);
    current = 'skipped'; view.render(cx); await flush(); assert.equal(panel.hidden, true);
    toggle(null,cx); view.render(cx); await flush(); assert.equal(panel.hidden, false);
    current = 'bound'; view.render(cx); await flush();
    current = 'skipped'; view.render(cx); current = 'bound'; view.render(cx);
    await flush(); assert.equal(panel.hidden, false);
    current = 'skipped'; view.render(cx); await flush(); assert.equal(panel.hidden, true);
    assert.equal(calls.length, 2);
    current = 'bound'; view.render(cx); panel.hidden = false;
    current = 'skipped'; view.render(cx); body.active = 'files'; await flush();
    assert.equal(panel.hidden, false); assert.equal(calls.length, 2);
    current='bound'; panel.hidden=true; body.active='linear'; view.render(cx); await flush();
    current='skipped'; view.render(cx); await flush();
    panel.hidden=false; view.render(cx); await flush(); assert.equal(panel.hidden,true); assert.equal(calls.length,3);
    const screen = new Linear(); screen.space = 'bound'; screen.epoch = 0; screen.disable(cx);
    assert.deepEqual(bindings.bound, { disabled: true });
  } finally { delete globalThis.herdrLinearFixture; }
});
