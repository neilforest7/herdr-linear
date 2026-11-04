export function callbackCode(params, expectedState, expectedIssuer) {
  if (typeof expectedState !== 'string' || expectedState.length < 16 || params.getAll('state').length !== 1 || params.get('state') !== expectedState) throw new Error('state mismatch');
  if (params.get('iss') !== expectedIssuer) throw new Error('issuer mismatch');
  if (params.has('error') || params.getAll('code').length !== 1 || !params.get('code')) throw new Error('authorization failed');
  return params.get('code');
}

export function nextCursor(data, cursorKey) {
  if (data?.hasNextPage && (!cursorKey || typeof data.cursor !== 'string' || !data.cursor)) throw new Error('pagination unavailable');
  return data?.hasNextPage ? data.cursor : undefined;
}
