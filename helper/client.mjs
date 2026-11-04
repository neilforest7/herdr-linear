#!/usr/bin/env node
import { Entry } from '@napi-rs/keyring';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callbackCode, nextCursor } from './callback.mjs';
import { normalizeIssue, normalizeIssueListItem } from './issue.mjs';
import { prepareDescription, downloadLinearImage } from './description.mjs';
import { options as createOptions, start as createStart, status as createStatus, createWorker, chooseFiles, pickWorker } from './create.mjs';
import { withVaultLock } from './vault-lock.mjs';

const SERVER = 'https://mcp.linear.app/mcp';
const READONLY_SERVER = 'https://mcp.linear.app/mcp/readonly';
const serverFor = vault => vault.discovery?.resourceMetadata?.resource === READONLY_SERVER ? READONLY_SERVER : SERVER;
const SERVICE = 'Herdr Linear MCP';
const ACCOUNT = 'oauth';
const RUNTIME = join(process.env.HERDR_APP_HOME || join(homedir(), '.config/herdr-app'), 'data/linear-auth.json');
const TIMEOUT = 22_000;
const entry = new Entry(SERVICE, ACCOUNT);
const ownFile = fileURLToPath(import.meta.url);

const readVault = () => JSON.parse(entry.getPassword() || '{}');
const writeVault = value => entry.setPassword(JSON.stringify(value));
const readRuntime = async () => {
  try { return JSON.parse(await readFile(RUNTIME, 'utf8')); }
  catch { return {}; }
};
async function writeRuntime(value) {
  await mkdir(dirname(RUNTIME), { recursive: true });
  const temp = `${RUNTIME}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, RUNTIME);
}
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
function loginPending(state) {
  if (!state.pending || Date.now() - (state.startedAt || 0) >= 4 * 60_000) return false;
  if (!state.pid) return true;
  try { process.kill(state.pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
const safeError = error => {
  if (error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT') return 'Linear request timed out';
  if (error?.name === 'UnauthorizedError' || /unauthorized|invalid_grant|no access token/i.test(error?.message || '')) return 'Linear authorization required';
  return 'Linear request failed';
};

class LinearOAuthProvider {
  constructor(port, stored = {}, scope = 'read', staged = false) { this.port = port; this.data = { ...stored }; this.scope = scope; this.staged = staged; this.savedTokens = stored.tokens?.access_token; this.savedClient = (staged ? readVault() : stored).clientInformation?.client_id; if (port) this.data.redirectUrl = `http://127.0.0.1:${port}/callback`; }
  async persist() {
    if (this.staged) return;
    await withVaultLock(() => {
      const current = readVault();
      if (current.tokens?.access_token !== this.savedTokens || current.clientInformation?.client_id !== this.savedClient) return;
      writeVault(this.data);
      this.savedTokens = this.data.tokens?.access_token;
      this.savedClient = this.data.clientInformation?.client_id;
    });
  }
  get redirectUrl() { return this.data.redirectUrl; }
  get clientMetadata() {
    return {
      client_name: 'Herdr',
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: this.scope,
    };
  }
  state() { this.data.state = randomUUID(); return this.data.state; }
  clientInformation() { return this.data.clientInformation; }
  async saveClientInformation(value) { this.data.clientInformation = value; await this.persist(); }
  tokens() { return this.data.tokens; }
  async saveTokens(value) {
    this.data.tokens = value; this.data.scope = value.scope || this.scope;
    if (this.staged) {
      await withVaultLock(() => {
        if (readVault().clientInformation?.client_id !== this.savedClient) throw new Error('Linear credentials changed during login');
        writeVault(this.data);
        this.staged = false;
        this.savedTokens = value.access_token;
        this.savedClient = this.data.clientInformation?.client_id;
      });
    } else await this.persist();
  }
  async invalidateCredentials(scope) {
    if (scope === 'all') this.data = { redirectUrl: this.data.redirectUrl };
    else {
      const keys = { client: 'clientInformation', tokens: 'tokens', verifier: 'codeVerifier', discovery: 'discovery' };
      delete this.data[keys[scope]];
    }
    await this.persist();
  }
  async saveCodeVerifier(value) { this.data.codeVerifier = value; await this.persist(); }
  codeVerifier() { return this.data.codeVerifier; }
  async saveDiscoveryState(value) { this.data.discovery = value; await this.persist(); }
  discoveryState() { return this.data.discovery; }
  async redirectToAuthorization(url) {
    if (!this.port) throw Object.assign(new Error('authorization required'), { name: 'UnauthorizedError' });
    const child = spawn('open', [url.href], { detached: true, stdio: 'ignore' });
    child.unref();
  }
}

async function loginWorker(write = false) {
  await writeRuntime({ pending: true, startedAt: Date.now(), pid: process.pid });
  const server = createServer();
  let provider;
  let callbackTimer;
  const callback = new Promise((resolve, reject) => {
    const timer = callbackTimer = setTimeout(() => reject(new Error('timeout')), 4 * 60_000);
    server.on('request', (req, res) => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== `127.0.0.1:${server.address().port}`) { res.writeHead(400).end(); return; }
      const url = new URL(req.url, origin);
      if (req.method !== 'GET' || url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      let code;
      try {
        code = callbackCode(url.searchParams, provider?.data.state, provider?.data.discovery?.authorizationServerUrl);
      } catch {
        res.writeHead(400).end('Linear login was not completed. Return to Herdr.');
        clearTimeout(timer); reject(new Error('callback')); return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Linear connected. You can close this tab.');
      clearTimeout(timer); resolve(code);
    });
    server.on('error', reject);
  });
  callback.catch(() => {});
  try {
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
    const scope = write ? 'read write' : 'read';
    provider = new LinearOAuthProvider(server.address().port, {}, scope, true);
    const options = { serverUrl: SERVER, scope };
    await auth(provider, { ...options, fetchFn: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) }) });
    await auth(provider, { ...options, authorizationCode: await callback, fetchFn: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) }) });
    await writeRuntime({ pending: false });
  } catch {
    await writeRuntime({ pending: false, error: 'Linear login failed or expired' });
  } finally {
    clearTimeout(callbackTimer);
    server.close();
  }
}

function resultData(result) {
  if (result?.isError) throw new Error('tool');
  if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  for (const item of result?.content || []) {
    if (item.type !== 'text') continue;
    try { return JSON.parse(item.text); } catch { /* try the next text block */ }
  }
  throw new Error('unexpected result');
}

function records(data, keys) {
  if (Array.isArray(data)) return data;
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return [];
}

async function query(kind, projectId) {
  const vault = readVault();
  if (!vault.tokens?.access_token) throw Object.assign(new Error(), { name: 'UnauthorizedError' });
  const client = new Client({ name: 'herdr-linear', version: '1.0.0' });
  const controller = new AbortController();
  const transport = new StreamableHTTPClientTransport(new URL(serverFor(vault)), {
    authProvider: new LinearOAuthProvider(0, vault, vault.scope || 'read'),
    requestInit: { signal: controller.signal },
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 100, maxReconnectionDelay: 100, reconnectionDelayGrowFactor: 1 },
  });
  let timer;
  try {
    const work = (async () => {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    const name = kind === 'projects' ? 'list_projects' : kind === 'issue' ? 'get_issue' : 'list_issues';
    const tool = tools.find(item => item.name === name);
    if (!tool) throw new Error('tool unavailable');
    if (kind === 'issue') {
      const data = resultData(await client.callTool({ name, arguments: { id: projectId, includeRelations: true } }));
      const issue = normalizeIssue(data);
      issue.descriptionParts = await prepareDescription(issue.description, src => downloadLinearImage(src, markdown => client.callTool({ name: 'extract_images', arguments: { markdown } })));
      return { issue };
    }
    const schema = tool.inputSchema?.properties || {};
    const cursorKey = 'cursor' in schema ? 'cursor' : undefined;
    const limitKey = 'limit' in schema ? 'limit' : undefined;
    const pageLimit = Math.min(100, schema[limitKey]?.maximum || 100);
    const projectKey = 'project' in schema ? 'project' : undefined;
    if (kind === 'issues' && !projectKey) throw new Error('project filter unavailable');
    const all = [];
    let cursor;
    for (let page = 0; page < 100; page++) {
      const args = {};
      if (limitKey) args[limitKey] = pageLimit;
      if (cursorKey && cursor) args[cursorKey] = cursor;
      if (kind === 'issues') {
        args[projectKey] = projectId;
      }
      if ('includeArchived' in schema) args.includeArchived = true;
      const data = resultData(await client.callTool({ name, arguments: args }));
      const rows = records(data, [kind, 'nodes', 'results', 'items']);
      all.push(...rows);
      const next = nextCursor(data, cursorKey);
      if (!next) break;
      if (next === cursor) throw new Error('pagination stalled');
      if (page === 99) throw new Error('pagination limit exceeded');
      cursor = next;
    }
    return kind === 'projects'
      ? { projects: all.map(p => ({ id: p.uuid ?? p.id, name: p.name })) }
      : { issues: all.map(normalizeIssueListItem) };
    })();
    return await Promise.race([
      work,
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error(), { name: 'TimeoutError' })); }, TIMEOUT); }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    await Promise.race([client.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 500))]);
  }
}


function safeCreateError(error) {
  const message = error?.message || '';
  if (/^(Invalid |Job |Team unavailable|Project |Milestone |Parent issue|Linear authorization required|list_[a-z_]+ (failed|unavailable|returned invalid data))/.test(message)) return message;
  return safeError(error);
}

async function withCreateClient(work, timeout = 0) {
  const vault = readVault();
  if (!vault.tokens?.access_token) throw Object.assign(new Error('Linear authorization required'), { name: 'UnauthorizedError' });
  const client = new Client({ name: 'herdr-linear', version: '1.0.0' });
  const controller = new AbortController();
  const transport = new StreamableHTTPClientTransport(new URL(serverFor(vault)), {
    authProvider: new LinearOAuthProvider(0, vault, vault.scope || 'read'),
    requestInit: { signal: controller.signal },
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 100, maxReconnectionDelay: 100, reconnectionDelayGrowFactor: 1 },
  });
  let timer;
  if (timeout) timer = setTimeout(() => controller.abort(), timeout);
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    const call = async (name, args, listKey) => {
      const tool = tools.find(t => t.name === name);
      if (!tool) throw new Error(`${name} unavailable`);
      const schema = tool.inputSchema?.properties || {};
      let cursor;
      const all = [];
      for (let page = 0; page < 100; page++) {
        const params = { ...args };
        if (listKey && 'limit' in schema) params.limit = Math.min(50, schema.limit?.maximum || 50);
        if (cursor) params.cursor = cursor;
        let data;
        try { data = resultData(await client.callTool({ name, arguments: params })); }
        catch (error) { if (name === 'save_issue') throw error; throw new Error(`${name} failed`); }
        if (!listKey) return data;
        const rows = records(data, [listKey, 'nodes', 'results', 'items']);
        if (!Array.isArray(data) && ![listKey, 'nodes', 'results', 'items'].some(key => Array.isArray(data?.[key]))) throw new Error(`${name} returned invalid data`);
        all.push(...rows);
        const next = nextCursor(data, 'cursor' in schema ? 'cursor' : undefined);
        if (!next) return all;
        if (next === cursor) throw new Error('pagination stalled');
        cursor = next;
      }
      throw new Error('pagination limit exceeded');
    };
    return await work(call);
  } finally {
    clearTimeout(timer);
    controller.abort();
    await Promise.race([client.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 500))]);
  }
}

async function main() {
  const [command, arg, arg2] = process.argv.slice(2);
  if (command === '_login-worker') return loginWorker(arg === 'write');
  if (command === '_create-worker') return createWorker(arg, withCreateClient);
  if (command === '_pick-worker') return pickWorker(arg);
  if (command === 'status') {
    const [vault, state] = await Promise.all([Promise.resolve(readVault()), readRuntime()]);
    const pending = loginPending(state);
    emit({ authenticated: Boolean(vault.tokens?.access_token), pending, canWrite: Boolean(vault.tokens?.access_token && String(vault.scope || vault.tokens?.scope || '').split(/\s+/).includes('write')), ...(state.error && !pending ? { error: state.error } : {}) });
  } else if (command === 'login') {
    const state = await readRuntime();
    if (loginPending(state)) return emit({ ok: true, pending: true });
    const child = spawn(process.execPath, [ownFile, '_login-worker', ...(arg === 'write' ? ['write'] : [])], { detached: true, stdio: 'ignore', cwd: dirname(dirname(ownFile)) });
    child.unref();
    await writeRuntime({ pending: true, startedAt: Date.now(), pid: child.pid });
    emit({ ok: true, pending: true });
  } else if (command === 'create-options') {
    try { emit(await withCreateClient(call => createOptions(call, arg || '', arg2 || ''), TIMEOUT)); }
    catch (error) { emit({ ok: false, error: safeCreateError(error) }); }
  } else if (command === 'create-start') {
    const vault = readVault();
    if (!vault.tokens?.access_token || !String(vault.scope || vault.tokens?.scope || '').split(/\s+/).includes('write')) return emit({ ok: false, error: 'Linear write authorization required', authRequired: true });
    try { emit(await createStart(arg, ownFile)); } catch (error) { emit({ ok: false, error: safeCreateError(error) }); }
  } else if (command === 'choose-files') {
    try { emit(await chooseFiles(ownFile)); } catch { emit({ ok: false, error: 'File selection failed' }); }
  } else if (command === 'create-status') {
    try { emit(await createStatus(arg)); } catch { emit({ ok: false, error: 'Job not found' }); }
  } else if (command === 'logout') {
    await withVaultLock(() => entry.deletePassword());
    await writeRuntime({ pending: false });
    emit({ ok: true });
  } else if (command === 'projects' || command === 'issues' || command === 'issue') {
    if (command === 'issues' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg || '')) return emit({ ok: false, error: 'Project UUID required' });
    if (command === 'issue' && !arg?.trim()) return emit({ ok: false, error: 'Issue ID required' });
    try { emit(await query(command, arg)); }
    catch (error) { emit({ ok: false, error: safeError(error), ...(safeError(error) === 'Linear authorization required' ? { authRequired: true } : {}) }); }
  } else {
    emit({ ok: false, error: 'Usage: status | login | projects | issues PROJECT_UUID | issue ISSUE_ID | logout' });
    process.exitCode = 2;
  }
}

main().catch(() => { emit({ ok: false, error: 'Linear helper failed' }); process.exitCode = 1; });
