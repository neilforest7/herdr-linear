import { createReadStream, constants } from 'node:fs';
import { open, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';

const root = join(process.env.HERDR_APP_HOME || join(homedir(), '.config/herdr-app'), 'data/linear/create');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain' };
const fields = new Set(['id', 'team', 'title', 'description', 'state', 'priority', 'project', 'labels', 'dueDate', 'estimate', 'cycle', 'milestone', 'parentId', 'attachments']);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' && value.trim().length > 0;
const identifier = value => string(value) && value.length <= 256;
const pathFor = id => { if (!uuid.test(id || '')) throw new Error('Invalid job ID'); return join(root, id); };

export function validateRequest(request) {
  if (!record(request) || Object.keys(request).some(k => !fields.has(k))) throw new Error('Invalid request fields');
  if (!uuid.test(request.id || '') || !identifier(request.team) || !string(request.title)) throw new Error('Job ID, team and title are required');
  for (const key of ['state', 'project', 'cycle', 'milestone', 'parentId']) if (request[key] != null && !identifier(request[key])) throw new Error(`Invalid ${key}`);
  if (request.description != null && typeof request.description !== 'string') throw new Error('Invalid description');
  if (request.priority != null && (!Number.isInteger(request.priority) || request.priority < 0 || request.priority > 4)) throw new Error('Invalid priority');
  if (request.estimate != null && (typeof request.estimate !== 'number' || !Number.isFinite(request.estimate) || request.estimate < 0)) throw new Error('Invalid estimate');
  if (request.dueDate != null && (typeof request.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(request.dueDate) || !Number.isFinite(Date.parse(request.dueDate)) || new Date(request.dueDate).toISOString().slice(0, 10) !== request.dueDate)) throw new Error('Invalid due date');
  if (request.labels != null && (!Array.isArray(request.labels) || request.labels.some(x => !identifier(x)))) throw new Error('Invalid labels');
  if (request.attachments != null && (!Array.isArray(request.attachments) || request.attachments.some(a => !record(a) || Object.keys(a).some(k => !['path', 'name', 'contentType', 'size'].includes(k)) || !string(a.path) || !string(a.name) || (a.contentType != null && !string(a.contentType))))) throw new Error('Invalid attachments');
  return request;
}

export async function options(call, projectId = '', teamId = '') {
  const [teams, projects] = await Promise.all([
    call('list_teams', {}, 'teams'),
    call('list_projects', { fields: ['id', 'uuid', 'name', 'teams'] }, 'projects'),
  ]);
  const normalizedTeams = teams.map(t => ({ id: t.id, name: t.name, key: t.key }));
  const normalizedProjects = projects.map(p => ({ id: p.uuid ?? p.id, name: p.name, teamIds: (p.teams || []).map(t => t.id) }));
  if (projectId && !normalizedProjects.some(p => p.id === projectId)) throw new Error('Project unavailable');
  if (teamId && !normalizedTeams.some(t => t.id === teamId)) throw new Error('Team unavailable');
  if (teamId && projectId && !normalizedProjects.find(p => p.id === projectId).teamIds.includes(teamId)) throw new Error('Project is not available to this team');
  const [states, labels, cycles, milestones] = await Promise.all([
    teamId ? call('list_issue_statuses', { team: teamId }, 'states') : [],
    teamId ? call('list_issue_labels', { team: teamId }, 'labels') : [],
    teamId ? call('list_cycles', { teamId }, 'cycles') : [],
    projectId ? call('list_milestones', { project: projectId }, 'milestones') : [],
  ]);
  return {
    teams: normalizedTeams, projects: normalizedProjects,
    states: states.map(x => ({ id: x.id, name: x.name, type: x.type })),
    labels: labels.filter(x => !x.retiredAt && !x.archivedAt && !x.isGroup && (!x.teamId || x.teamId === teamId)).map(x => ({ id: x.id, name: x.name, ...(x.teamId ? { teamId: x.teamId } : {}) })),
    cycles: cycles.map(x => ({ id: x.id, name: x.name, number: x.number })),
    milestones: milestones.map(x => ({ id: x.id, name: x.name })), teamId, projectId,
  };
}

export async function validateSelection(request, metadata, call) {
  const includes = (items, id) => items.some(item => item.id === id);
  if (!includes(metadata.teams, request.team)) throw new Error('Team unavailable');
  if (request.project && !metadata.projects.some(p => p.id === request.project && p.teamIds.includes(request.team))) throw new Error('Project is not available to this team');
  for (const [key, list] of [['state', 'states'], ['cycle', 'cycles'], ['milestone', 'milestones']]) if (request[key] && !includes(metadata[list], request[key])) throw new Error(`Invalid ${key} selection`);
  if (request.labels?.some(id => !includes(metadata.labels, id))) throw new Error('Invalid label selection');
  if (request.milestone && !request.project) throw new Error('Milestone requires a project');
  if (request.parentId) {
    const parent = await call('get_issue', { id: request.parentId, fields: ['id', 'uuid', 'teamId'] });
    if (parent.teamId !== request.team) throw new Error('Parent issue belongs to another team');
  }
}

function safeUrl(value, upload = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid upload URL'); }
  const host = url.hostname.toLowerCase();
  const allowed = upload ? host === 'storage.googleapis.com' || host.endsWith('.storage.googleapis.com') : host === 'uploads.linear.app' || host.endsWith('.linear.app') || host === 'storage.googleapis.com' || host.endsWith('.storage.googleapis.com');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed) throw new Error('Untrusted upload URL');
  return url.href;
}

export async function uploadAttachment(attachment, call, fetchFn = fetch) {
  const file = await open(attachment.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size >= 2_000_000_000) throw new Error('Invalid attachment size or file');
    const name = basename(attachment.name);
    if (!name || name !== attachment.name || /[\r\n]/.test(name)) throw new Error('Invalid attachment name');
    const contentType = attachment.contentType || mimeTypes[extname(name).toLowerCase()] || 'application/octet-stream';
    const result = await call('prepare_file_upload', { filename: name, contentType, size: stat.size });
    const url = safeUrl(result.uploadRequest?.url, true);
    const asset = safeUrl(result.assetUrl);
    if (!record(result.uploadRequest?.headers) || Object.values(result.uploadRequest.headers).some(v => typeof v !== 'string')) throw new Error('Invalid upload headers');
    const response = await fetchFn(url, { method: 'PUT', headers: result.uploadRequest.headers, body: createReadStream(null, { fd: file.fd, autoClose: false }), duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error('Attachment upload failed');
    return `${/^image\//i.test(contentType) ? '!' : ''}[${name.replace(/[\\\[\]]/g, '\\$&')}](${asset.replace(/[()]/g, x => encodeURIComponent(x))})`;
  } finally { await file.close(); }
}

async function save(id, value) {
  const dir = pathFor(id);
  const tmp = join(dir, `${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await rename(tmp, join(dir, 'status.json'));
}
export async function status(id) {
  const dir = pathFor(id);
  let value;
  try { value = JSON.parse(await readFile(join(dir, 'status.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    let info;
    try { info = await stat(dir); } catch (err) {
      if (err.code === 'ENOENT') return { ok: true, pending: false, missing: true };
      throw err;
    }
    if (Date.now() - info.mtimeMs < 30_000) return { pending: true, phase: 'queued' };
    return { pending: false, error: 'Job stopped during startup; check Linear before retrying', uncertain: true };
  }
  if (value.pending) {
    let pid;
    try { pid = Number(await readFile(join(dir, 'worker.lock'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (Number.isSafeInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); } catch (error) {
        if (error.code === 'ESRCH') {
          value = { pending: false, error: value.phase === 'creating' ? 'Issue creation may have succeeded; check Linear before retrying' : 'Job stopped unexpectedly', ...(value.phase === 'creating' ? { uncertain: true } : {}) };
          await save(id, value);
        }
      }
    } else if (value.phase === 'queued') {
      const startedAt = value.startedAt || (await stat(join(dir, 'status.json'))).mtimeMs;
      if (Date.now() - startedAt >= 30_000) {
        let alive = false;
        if (Number.isSafeInteger(value.starterPid) && value.starterPid > 0) {
          try { process.kill(value.starterPid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') alive = true; }
        }
        if (!alive) return { pending: false, error: 'Job stopped during startup; check Linear before retrying', uncertain: true };
      }
    }
  }
  const { starterPid, startedAt, ...result } = value;
  return result;
}
async function claim(id, initial) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  try { await mkdir(pathFor(id), { mode: 0o700 }); }
  catch (e) { if (e.code === 'EEXIST') return false; throw e; }
  await save(id, initial);
  return true;
}
export async function start(requestPath, workerFile, spawnFn = spawn) {
  const path = resolve(requestPath || '');
  if (dirname(path) !== root || !/^request-[0-9a-f-]+\.json$/i.test(basename(path))) throw new Error('Invalid request path');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let request;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) || stat.size > 1_000_000 || stat.uid !== process.getuid()) throw new Error('Invalid request file');
    request = validateRequest(JSON.parse(await file.readFile('utf8')));
    if (basename(path).toLowerCase() !== `request-${request.id.toLowerCase()}.json`) throw new Error('Invalid request filename');
  } finally { await file.close(); }
  if (await claim(request.id, { pending: true, phase: 'queued', starterPid: process.pid, startedAt: Date.now() })) {
    try {
      await writeFile(join(pathFor(request.id), 'request.json'), JSON.stringify(request), { mode: 0o600, flag: 'wx' });
      const child = spawnFn(process.execPath, [workerFile, '_create-worker', request.id], { detached: true, stdio: 'ignore' });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
    } catch {
      await save(request.id, { pending: false, error: 'Could not start issue creation' });
    }
  }
  return { jobId: request.id, pending: true };
}
export async function chooseFiles(workerFile) {
  const id = randomUUID();
  await claim(id, { pending: true, phase: 'choosing' });
  const child = spawn(process.execPath, [workerFile, '_pick-worker', id], { detached: true, stdio: 'ignore' }); child.unref();
  return { jobId: id, pending: true };
}
export async function pickWorker(id) {
  try {
    await writeFile(join(pathFor(id), 'worker.lock'), String(process.pid), { flag: 'wx', mode: 0o600 });
    const script = 'ObjC.import("AppKit"); var a=Application.currentApplication(); a.includeStandardAdditions=true; try { JSON.stringify(a.chooseFile({multipleSelectionsAllowed:true}).map(x=>x.toString())); } catch(e) { if(e.errorNumber === -128) "CANCEL"; else throw e; }';
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { maxBuffer: 1024 * 1024 });
    if (stdout.trim() === 'CANCEL') return save(id, { pending: false, canceled: true });
    const paths = JSON.parse(stdout);
    const { stat } = await import('node:fs/promises');
    const files = await Promise.all(paths.map(async path => ({ path, name: basename(path), size: (await stat(path)).size })));
    await save(id, { pending: false, files });
  } catch { await save(id, { pending: false, error: 'File selection failed' }); }
}
export async function createWorker(id, withClient) {
  try { await writeFile(join(pathFor(id), 'worker.lock'), String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') return; throw error; }
  let sent = false;
  try {
    const request = validateRequest(JSON.parse(await readFile(join(pathFor(id), 'request.json'), 'utf8')));
    await withClient(async call => {
      await save(id, { pending: true, phase: 'validating' });
      const metadata = await options(call, request.project || '', request.team);
      await validateSelection(request, metadata, call);
      const attachments = [];
      for (const attachment of request.attachments || []) {
        await save(id, { pending: true, phase: 'uploading' });
        attachments.push(await uploadAttachment(attachment, call));
      }
      const { id: jobId, attachments: ignored, ...issue } = request;
      issue.title = issue.title.trim();
      if (attachments.length) issue.description = [issue.description, ...attachments].filter(Boolean).join('\n\n');
      await save(id, { pending: true, phase: 'creating' });
      sent = true;
      const result = await call('save_issue', issue);
      if (!result?.id && !result?.identifier && !result?.issue?.id) throw new Error('Invalid issue response');
      await save(id, { pending: false, issue: result.issue || result });
    });
  } catch (error) {
    await save(id, { pending: false, error: sent ? 'Issue creation may have succeeded; check Linear before retrying' : (/^(Invalid |Team unavailable|Project |Milestone |Parent issue|list_[a-z_]+ (failed|unavailable|returned invalid data)|Linear authorization required)/.test(error?.message || '') ? error.message : 'Issue creation failed'), ...(sent ? { uncertain: true } : {}) });
  }
}
