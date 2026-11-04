import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./client.mjs', import.meta.url), 'utf8');
const start = source.indexOf('class LinearOAuthProvider {');
const end = source.indexOf('\nasync function loginWorker', start);
assert.ok(start >= 0 && end > start);

function setup() {
  let vault = { clientInformation: { client_id: 'read-client' }, tokens: { access_token: 'old-read' }, scope: 'read' };
  const readVault = () => structuredClone(vault);
  const writeVault = value => { vault = structuredClone(value); };
  const Provider = vm.runInNewContext(`${source.slice(start, end)}\nLinearOAuthProvider`, { readVault, writeVault, withVaultLock: async fn => fn(), randomUUID: () => 'state', spawn: () => { throw new Error('unexpected browser'); } });
  return { Provider, readVault, logout: () => { vault = {}; } };
}

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
