import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as model from '../mods/linear/create-model.js';

const metadata = { teams: [{ id: 'team', name: 'Team' }, { id: 'other', name: 'Other' }], projects: [{ id: 'project', name: 'Project', teamIds: ['team'] }], states: [{ id: 'state', name: 'Backlog', type: 'backlog' }], labels: [{ id: 'label', name: 'Feature' }], cycles: [{ id: 'cycle' }], milestones: [{ id: 'milestone' }] };

test('composer retains drafts, submits once, and clears content only after confirmed creation', async () => {
  const storage = {}, pending = [], calls = [], written = [];
  let job = { pending: true, phase: 'creating' };
  let failStart = false;
  let closed = 0;
  const cx = { notify() {}, focus_handle: () => ({}), timer: { every() {}, after() {} }, spawn(fn) { pending.push(fn(cx)); } };
  const flush = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
  const inputState = { new({ value = '' } = {}) { const handlers = {}; return { value: () => value, set_value(v) { value = v; handlers.change?.({}, cx); }, focus() {}, on(event, cb) { handlers[event] = cb; } }; } };
  globalThis.composerFixture = {
    ...model, InputState: inputState, TextareaState: inputState,
    shared: key => storage[key], setShared: (key, value) => { storage[key] = value; },
    closeOverlay() { closed++; }, notify() {}, appHome: () => '/private/app',
    exec: async (cmd) => ({ code: 0, stdout: cmd.includes('uuidgen') ? '12345678-1234-4234-8234-123456789abc\n' : '' }),
    fs: { writeFile: async (path, body) => written.push({ path, body: JSON.parse(body) }) },
  };
  const source = (await readFile(new URL('../mods/linear/create.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  const { Composer } = await import(`data:text/javascript;base64,${Buffer.from(`const {${Object.keys(globalThis.composerFixture).join(',')}}=globalThis.composerFixture;\n${source}`).toString('base64')}`);
  const call = async (cmd, ...args) => { calls.push([cmd, ...args]); if (cmd === 'create-start' && failStart) throw new Error('Connection interrupted'); return cmd === 'status' ? { authenticated: true, canWrite: true } : cmd === 'create-options' ? metadata : cmd === 'create-status' ? job : { jobId: 'job' }; };
  try {
    const view = new Composer({ space: 'a', project: 'project', overlay: 'dialog' }, cx, call); await flush();
    view.inputs.title.set_value('  Example  '); view.description.set_value('Actual description');
    Object.assign(view.draft, { createMore: true, dueDate: '2026-12-01', estimate: '3', cycle: 'cycle', milestone: 'milestone', parentId: 'T-1', labels: ['label'], attachments: [{ path: '/private/example.png', name: 'example.png' }] });
    view.dismiss(); assert.equal(closed, 1);
    const reopened = new Composer({ space: 'a', project: 'project' }, cx, call); await flush();
    assert.equal(reopened.inputs.title.value(), '  Example  ');
    assert.equal(reopened.description.value(), 'Actual description');
    reopened.submit(cx); reopened.submit(cx); await flush();
    assert.equal(calls.filter(([cmd]) => cmd === 'create-start').length, 1);
    assert.equal(written[0].body.title, 'Example'); assert.equal(written[0].body.description, 'Actual description');
    assert.equal(written[0].body.estimate, 3); assert.equal(written[0].body.parentId, 'T-1');
    assert.equal('assignee' in written[0].body, false);
    assert.equal(reopened.locked, true);
    reopened.poll(cx); await flush(); assert.equal(reopened.inputs.title.value(), '  Example  ');
    job = { pending: false, issue: { id: 'created', identifier: 'T-2', title: 'Example' } };
    reopened.poll(cx); await flush();
    assert.equal(reopened.inputs.title.value(), ''); assert.equal(reopened.description.value(), ''); assert.deepEqual(reopened.draft.attachments, []);
    assert.equal(reopened.draft.project, 'project'); assert.equal(reopened.draft.priority, 0); assert.equal(reopened.locked, false);
    assert.equal(storage[model.CREATED].space, 'a');
    reopened.inputs.title.set_value('Another'); reopened.submit(cx); await flush();
    job = { pending: false, uncertain: true, error: 'Lost response' }; reopened.poll(cx); await flush();
    const count = calls.filter(([cmd]) => cmd === 'create-start').length;
    reopened.submit(cx); await flush(); assert.equal(calls.filter(([cmd]) => cmd === 'create-start').length, count);
    assert.equal(reopened.inputs.title.value(), 'Another'); assert.equal(reopened.draft.uncertain, true);
    reopened.choose({ id: 'other' }, cx); assert.equal(reopened.draft.team, 'team');
    const uncertain = new Composer({ space: 'a', project: 'project' }, cx, call); await flush();
    assert.equal(uncertain.locked, true); assert.match(uncertain.error, /确认/);
    const fresh = new Composer({ space: 'b', project: 'project' }, cx, call); await flush();
    fresh.inputs.title.set_value('Recover dispatch'); failStart = true; fresh.submit(cx); await flush();
    const savedId = fresh.draft.jobId, savedPath = fresh.draft.requestPath;
    assert.ok(savedId); assert.ok(savedPath); assert.equal(fresh.locked, true);
    failStart = false; job = { pending: false, missing: true }; fresh.poll(cx); await flush();
    assert.equal(fresh.draft.jobId, savedId); assert.equal(calls.at(-1)[0], 'create-start'); assert.equal(calls.at(-1)[1], savedPath);
    assert.equal(written.length, 3);
  } finally { delete globalThis.composerFixture; }
});

test('team and project changes remove ineligible properties; request validation rejects invalid dates and estimates', () => {
  const draft = model.draftFor({ team: 'other', state: 'old', labels: ['label', 'old'], cycle: 'old', milestone: 'old' }, 'project');
  const clean = model.reconcile(draft, metadata);
  assert.equal(clean.project, ''); assert.equal(clean.state, ''); assert.equal(clean.cycle, ''); assert.equal(clean.milestone, ''); assert.deepEqual(clean.labels, ['label']);
  const valid = { ...clean, title: 'Example' };
  assert.throws(() => model.requestFor({ ...valid, dueDate: '2026-02-30' }, 'id'), /截止日期/);
  assert.throws(() => model.requestFor({ ...valid, estimate: '-1' }, 'id'), /估点/);
  assert.throws(() => model.requestFor({ ...valid, estimate: 'Infinity' }, 'id'), /估点/);
});
