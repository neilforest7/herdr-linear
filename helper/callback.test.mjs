import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callbackCode, nextCursor } from './callback.mjs';
const state = 'random-secure-state';
const issuer = 'https://mcp.linear.app';
test('OAuth callback verifies state and issuer and passes only code to SDK', () => {
  const valid = () => new URLSearchParams({ state, iss: issuer, code: 'sample-code' });
  assert.equal(callbackCode(valid(), state, issuer), 'sample-code');
  for (const key of ['state', 'iss', 'code']) {
    const params = valid(); params.delete(key);
    assert.throws(() => callbackCode(params, state, issuer));
  }
  const wrong = valid(); wrong.set('state', 'other');
  assert.throws(() => callbackCode(wrong, state, issuer));
  const badIssuer = valid(); badIssuer.set('iss', 'https://evil.test');
  assert.throws(() => callbackCode(badIssuer, state, issuer));
  const duplicate = valid(); duplicate.append('code', 'other');
  assert.throws(() => callbackCode(duplicate, state, issuer));
  assert.throws(() => callbackCode(valid(), undefined, issuer));
});
test('pagination cannot silently return a partial list', () => {
  assert.equal(nextCursor({ hasNextPage: true, cursor: 'next' }, 'cursor'), 'next');
  assert.equal(nextCursor({ hasNextPage: false }, 'cursor'), undefined);
  assert.throws(() => nextCursor({ hasNextPage: true }, 'cursor'));
  assert.throws(() => nextCursor({ hasNextPage: true, cursor: 'next' }, undefined));
});
