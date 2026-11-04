import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const home = await mkdtemp(join(tmpdir(), 'herdr-create-'));
process.env.HERDR_APP_HOME = home;
const { validateRequest, validateSelection, options, uploadAttachment, createWorker, start, status } = await import('./create.mjs');
const id = '12345678-1234-4234-8234-123456789abc';
const request = { id, team: 'team', title: 'Example' };
const metadata = { teams: [{ id: 'team' }], projects: [{ id: 'project', teamIds: ['team'] }], states: [{ id: 'state' }], labels: [{ id: 'label' }], cycles: [{ id: 'cycle' }], milestones: [{ id: 'milestone' }] };
const rows = { list_teams: [{ id: 'team', name: 'Team', key: 'T' }], list_projects: [{ uuid: 'project', name: 'Project', teams: [{ id: 'team' }] }], list_issue_statuses: metadata.states, list_issue_labels: metadata.labels, list_cycles: metadata.cycles, list_milestones: metadata.milestones };

test.after(async () => rm(home, { recursive: true, force: true }));

test('validates request and team-owned properties before any mutation', async () => {
  assert.equal(validateRequest(request), request);
  for (const extra of [{ assignee: 'me' }, { priority: 5 }, { title: ' ' }, { dueDate: '2026-02-30' }, { estimate: -1 }, { labels: [''] }]) {
    assert.throws(() => validateRequest({ ...request, ...extra }));
  }
  await assert.rejects(validateSelection({ ...request, project: 'other' }, metadata), /Project/);
  await assert.rejects(validateSelection({ ...request, cycle: 'other' }, metadata), /cycle/);
  await assert.rejects(validateSelection({ ...request, labels: ['other'] }, metadata), /label/);
  await assert.rejects(validateSelection({ ...request, milestone: 'milestone' }, metadata), /project/);
  await assert.rejects(validateSelection({ ...request, parentId: 'JUP-1' }, metadata, async () => ({ teamId: 'other' })), /Parent/);
  await validateSelection({ ...request, project: 'project', state: 'state', labels: ['label'], cycle: 'cycle', milestone: 'milestone', parentId: 'JUP-1' }, metadata, async () => ({ teamId: 'team' }));
});

test('normalizes option data and checks team and project eligibility', async () => {
  const call = async name => rows[name];
  const result = await options(call, 'project', 'team');
  assert.deepEqual(result.projects, [{ id: 'project', name: 'Project', teamIds: ['team'] }]);
  assert.deepEqual(result.teams, [{ id: 'team', name: 'Team', key: 'T' }]);
  assert.equal(result.teamId, 'team');
  await assert.rejects(options(call, 'project', 'wrong'), /Team/);
});

test('streams a signed upload and rejects untrusted URLs before sending bytes', async () => {
  const path = join(home, 'sample.txt');
  await writeFile(path, 'sample');
  const attachment = { path, name: 'sample.txt', contentType: 'text/plain' };
  let uploads = 0;
  const prepare = async () => ({ uploadRequest: { url: 'https://storage.googleapis.com/bucket/object?signature=secret', headers: { 'content-type': 'text/plain' } }, assetUrl: 'https://uploads.linear.app/id' });
  const markdown = await uploadAttachment(attachment, prepare, async (url, init) => {
    uploads++;
    assert.equal(init.method, 'PUT');
    assert.equal(init.redirect, 'error');
    let data = ''; for await (const chunk of init.body) data += chunk;
    assert.equal(data, 'sample');
    return { ok: true };
  });
  assert.equal(markdown, '[sample.txt](https://uploads.linear.app/id)');
  await assert.rejects(uploadAttachment(attachment, async () => ({ uploadRequest: { url: 'https://storage.googleapis.com.evil.test/x', headers: {} }, assetUrl: 'https://uploads.linear.app/id' }), async () => { uploads++; }), /Untrusted/);
  assert.equal(uploads, 1);
});

test('a lost create response is uncertain and duplicate workers cannot submit twice', async () => {
  const dir = join(home, 'data/linear/create', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'request.json'), JSON.stringify(request));
  let saves = 0;
  const withClient = async work => work(async name => {
    if (name === 'save_issue') { saves++; await new Promise(resolve => setTimeout(resolve, 20)); throw new Error('connection lost'); }
    return rows[name];
  });
  await Promise.all([createWorker(id, withClient), createWorker(id, withClient)]);
  assert.equal(saves, 1);
  const result = await status(id);
  assert.equal(result.pending, false);
  assert.equal(result.uncertain, true);
  assert.match(result.error, /may have succeeded/);
  assert.doesNotMatch(await readFile(join(dir, 'status.json'), 'utf8'), /connection lost/);
});


test('detects image MIME types and embeds images while other files remain links', async () => {
  const path = join(home, 'upload');
  await writeFile(path, 'file');
  const seen = [];
  const call = async (name, args) => {
    seen.push(args.contentType);
    return { uploadRequest: { url: 'https://storage.googleapis.com/bucket/object', headers: {} }, assetUrl: 'https://uploads.linear.app/id' };
  };
  const send = async (url, init) => { for await (const chunk of init.body) { /* consume the stream */ } return { ok: true }; };
  assert.equal(await uploadAttachment({ path, name: 'screen.PNG' }, call, send), '![screen.PNG](https://uploads.linear.app/id)');
  assert.equal(await uploadAttachment({ path, name: 'file.pdf' }, call, send), '[file.pdf](https://uploads.linear.app/id)');
  assert.equal(await uploadAttachment({ path, name: 'file.bin', contentType: 'image/webp' }, call, send), '![file.bin](https://uploads.linear.app/id)');
  assert.deepEqual(seen, ['image/png', 'application/pdf', 'image/webp']);
});

test('missing jobs are retryable, failed starts terminate, and duplicate IDs stay claimed', async () => {
  const jobId = '23456789-1234-4234-8234-123456789abc';
  const root = join(home, 'data/linear/create');
  const path = join(root, `request-${jobId}.json`);
  await mkdir(root, { recursive: true });
  await writeFile(path, JSON.stringify({ ...request, id: jobId }), { mode: 0o600 });
  assert.deepEqual(await status(jobId), { ok: true, pending: false, missing: true });
  let attempts = 0;
  const failSpawn = () => {
    attempts++;
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('error', new Error('spawn failed')));
    return child;
  };
  assert.deepEqual(await start(path, 'unused', failSpawn), { jobId, pending: true });
  assert.deepEqual(await status(jobId), { pending: false, error: 'Could not start issue creation' });
  await start(path, 'unused', failSpawn);
  assert.equal(attempts, 1);
});

test('an abandoned queued job never appears missing or safe to retry', async () => {
  const jobId = '34567890-1234-4234-8234-123456789abc';
  const dir = join(home, 'data/linear/create', jobId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'status.json'), JSON.stringify({ pending: true, phase: 'queued', starterPid: 99999999, startedAt: Date.now() - 31_000 }));
  const result = await status(jobId);
  assert.equal(result.pending, false);
  assert.equal(result.uncertain, true);
  assert.equal(result.missing, undefined);
});


test('rejects a FIFO attachment without blocking or contacting Linear', async () => {
  const path = join(home, 'pipe');
  execFileSync('/usr/bin/mkfifo', [path]);
  const moduleUrl = new URL('./create.mjs', import.meta.url).href;
  const script = `import { uploadAttachment } from ${JSON.stringify(moduleUrl)};
    try { await uploadAttachment({ path: process.argv[1], name: 'pipe' }, () => { throw Error('unexpected upload'); }); process.exitCode = 1; }
    catch (error) { if (!/Invalid attachment/.test(error.message)) process.exitCode = 1; }`;
  execFileSync(process.execPath, ['--input-type=module', '-e', script, path], { timeout: 2_000 });
});
