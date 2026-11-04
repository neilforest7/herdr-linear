import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { dirname } from 'node:path';
import { refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';

const source = await readFile(new URL('./client.mjs', import.meta.url), 'utf8');
const start = source.indexOf('class LinearOAuthProvider {');
const end = source.indexOf('\nasync function loginWorker', start);
assert.ok(start >= 0 && end > start);

function setup(stored = { clientInformation: { client_id: 'read-client' }, tokens: { access_token: 'old-read' }, scope: 'read' }) {
  let vault = structuredClone(stored);
  const readVault = () => structuredClone(vault);
  const writeVault = value => { vault = structuredClone(value); };
  const Provider = vm.runInNewContext(`${source.slice(start, end)}\nLinearOAuthProvider`, { readVault, writeVault, withVaultLock: async fn => fn(), randomUUID: () => 'state', spawn: () => { throw new Error('unexpected browser'); } });
  return { Provider, readVault, logout: () => { vault = {}; } };
}

const mainStart = source.indexOf('async function main() {');
const mainEnd = source.indexOf('\nmain().catch(', mainStart);
assert.ok(mainStart >= 0 && mainEnd > mainStart);

async function loginWrite(vault, spawn = () => { throw new Error('unexpected browser worker'); }) {
  let result;
  const main = vm.runInNewContext(`${source.slice(mainStart, mainEnd)}\nmain`, {
    process: { argv: ['node', 'client.mjs', 'login', 'write'], execPath: 'node' },
    readVault: () => structuredClone(vault), readRuntime: async () => ({}),
    loginPending: () => false, writeRuntime: async () => {},
    emit: value => { result = structuredClone(value); },
    spawn, ownFile: '/fixture/helper/client.mjs', dirname,
  });
  await main();
  return result;
}

test('login write reuses saved write authorization without a browser worker', async () => {
  assert.deepEqual(await loginWrite({ tokens: { access_token: 'saved-write' }, scope: 'read write' }), {
    ok: true, authenticated: true, canWrite: true, pending: false,
  });
});

test('login write still prompts an upgrade without a token and exact write scope', async () => {
  for (const vault of [
    { tokens: { access_token: 'saved-read' }, scope: 'read' },
    { scope: 'read write' },
    { tokens: { access_token: 'saved-read' }, scope: 'read overwrite' },
  ]) {
    const calls = [];
    const result = await loginWrite(vault, (...args) => {
      calls.push(structuredClone(args));
      return { pid: 12345, unref() {} };
    });
    assert.deepEqual(result, { ok: true, pending: true });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1], ['/fixture/helper/client.mjs', '_login-worker', 'write']);
  }
});

test('restored write provider keeps scope and refresh token after silent refresh omits both', async () => {
  const { Provider, readVault } = setup({
    clientInformation: { client_id: 'write-client' },
    tokens: { access_token: 'saved-write', refresh_token: 'saved-refresh' },
    scope: 'read write',
  });
  const saved = readVault();
  const provider = new Provider(0, saved, saved.scope || 'read');
  const tokens = await refreshAuthorization('https://issuer.test', {
    clientInformation: provider.clientInformation(),
    refreshToken: provider.tokens().refresh_token,
    fetchFn: async (_url, init) => {
      assert.equal(init.body.get('grant_type'), 'refresh_token');
      assert.equal(init.body.get('refresh_token'), 'saved-refresh');
      return new Response(JSON.stringify({ access_token: 'refreshed-write', token_type: 'Bearer' }));
    },
  });
  await provider.saveTokens(tokens);
  const restored = readVault();
  assert.equal(restored.tokens.access_token, 'refreshed-write');
  assert.equal(restored.tokens.refresh_token, 'saved-refresh');
  assert.equal(restored.scope, 'read write');
  const restarted = new Provider(0, restored, restored.scope || 'read');
  assert.equal(restarted.scope, 'read write');
  assert.deepEqual(await loginWrite(restored), { ok: true, authenticated: true, canWrite: true, pending: false });
});

test('staged registration, verifier, discovery and cancellation preserve read credentials', async () => {
  const { Provider, readVault } = setup();
  const original = readVault();
  const upgrade = new Provider(12345, {}, 'read write', true);
  await upgrade.saveClientInformation({ client_id: 'write-client' });
  await upgrade.saveCodeVerifier('verifier');
  await upgrade.saveDiscoveryState({ authorizationServerUrl: 'issuer' });
  await upgrade.invalidateCredentials('all');
  assert.deepEqual(readVault(), original);
});

test('read refresh works during upgrade, which commits write scope only after tokens arrive', async () => {
  const { Provider, readVault } = setup();
  const read = new Provider(0, readVault(), 'read');
  const upgrade = new Provider(12345, {}, 'read write', true);
  await upgrade.saveClientInformation({ client_id: 'write-client' });
  await upgrade.saveCodeVerifier('verifier');
  await read.saveTokens({ access_token: 'refreshed-read' });
  assert.equal(readVault().tokens.access_token, 'refreshed-read');
  assert.equal(readVault().scope, 'read');
  await upgrade.saveTokens({ access_token: 'write-token', scope: 'read write' });
  assert.equal(readVault().clientInformation.client_id, 'write-client');
  assert.equal(readVault().tokens.access_token, 'write-token');
  assert.equal(readVault().scope, 'read write');
  await read.saveTokens({ access_token: 'late-read' });
  await read.saveDiscoveryState({ resource: 'old' });
  await read.invalidateCredentials('all');
  assert.equal(readVault().tokens.access_token, 'write-token');
  assert.equal(readVault().scope, 'read write');
});


test('a pending upgrade cannot restore credentials after logout', async () => {
  const { Provider, readVault, logout } = setup();
  const upgrade = new Provider(12345, {}, 'read write', true);
  await upgrade.saveClientInformation({ client_id: 'write-client' });
  logout();
  await assert.rejects(upgrade.saveTokens({ access_token: 'write-token' }), /credentials changed/);
  assert.deepEqual(readVault(), {});
});
