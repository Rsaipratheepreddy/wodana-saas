import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createAuthProxy } from './auth-proxy.cjs';

async function setup(t, fetcher) {
  const proxy = createAuthProxy({ target: 'https://api.example.com/api/v1', fetcher });
  const server = createServer((req, res) => { void proxy(req, res, () => { res.writeHead(404); res.end(); }); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return (path, body = {}, extra = {}) => fetch(`${origin}/api/v1${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin, ...extra }, body: JSON.stringify(body),
  });
}

test('refresh token is HttpOnly and excluded from browser JSON; rotation uses only its cookie', async (t) => {
  const request = await setup(t, async (url, init) => {
    if (url.endsWith('/refresh')) assert.equal(JSON.parse(init.body).refreshToken, 'real-refresh');
    return Response.json({ accessToken: 'access', refreshToken: 'real-refresh', accessTokenExpiresIn: 900, refreshTokenExpiresIn: 2592000 });
  });
  const login = await request('/auth/login', { email: 'member@example.com', password: 'test', tenantSlug: 'iglo-architects' });
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal((await login.json()).refreshToken, 'http-only-cookie');
  const refreshed = await request('/auth/refresh', { refreshToken: 'untrusted-body-token' }, { cookie: cookie.split(';')[0] });
  assert.equal(refreshed.status, 200);
});
test('browser preview passes MFA challenges without a cookie and seals the verified session', async (t) => {
  const request = await setup(t, async (url, init) => {
    if (url.endsWith('/login')) return Response.json({ mfaRequired: true, challengeToken: 'challenge', selectedWorkspaceId: 'workspace-1' }, { status: 201 });
    assert.ok(url.endsWith('/mfa/verify'));
    assert.deepEqual(JSON.parse(init.body), { challengeToken: 'challenge', code: '123456' });
    return Response.json({ accessToken: 'access', refreshToken: 'private-refresh', selectedWorkspaceId: 'workspace-1', accessTokenExpiresIn: 900, refreshTokenExpiresIn: 2592000 }, { status: 201 });
  });
  const challenge = await request('/auth/login', { email: 'member@example.com', password: 'test', tenantSlug: 'plm' });
  assert.equal(challenge.status, 201);
  assert.equal(challenge.headers.get('set-cookie'), null);
  assert.deepEqual(await challenge.json(), { mfaRequired: true, challengeToken: 'challenge', selectedWorkspaceId: 'workspace-1' });
  const verified = await request('/auth/mfa/verify', { challengeToken: 'challenge', code: '123456' });
  assert.match(verified.headers.get('set-cookie'), /HttpOnly/);
  const payload = await verified.json();
  assert.equal(payload.refreshToken, 'http-only-cookie');
  assert.equal(JSON.stringify(payload).includes('private-refresh'), false);
});
test('cross-origin auth requests and missing refresh cookies are rejected before upstream', async (t) => {
  const request = await setup(t, async () => { assert.fail('must not reach upstream'); });
  assert.equal((await request('/auth/login', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/auth/refresh', { refreshToken: 'attacker-token' })).status, 401);
});
test('browser never receives development password reset tokens', async (t) => {
  const request = await setup(t, async () => Response.json({ accepted: true, developmentResetToken: 'sensitive-token' }));
  const result = await request('/auth/password/forgot', { email: 'member@example.com' });
  assert.deepEqual(await result.json(), { accepted: true });
});
test('browser preview resolves organizations and serves their public logo', async (t) => {
  const calls = [];
  const proxy = createAuthProxy({ target: 'https://api.example.com/api/v1', fetcher: async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    if (String(url).endsWith('/logo')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    return Response.json({ displayName: 'Palm Living', loginSlug: 'palm-living', logoUrl: '/logo' }, { status: 201 });
  } });
  const server = createServer((req, res) => { void proxy(req, res, () => { res.writeHead(404); res.end(); }); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const lookup = await fetch(`${origin}/api/v1/auth/organization/resolve`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'Palm Living' }),
  });
  assert.equal(lookup.status, 201);
  assert.equal((await lookup.json()).loginSlug, 'palm-living');
  const logo = await fetch(`${origin}/api/v1/public/tenant-branding/palm-living/logo`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await logo.arrayBuffer())], [1, 2, 3]);
  assert.equal(calls.length, 2);
});
test('expired refresh and unavailable logout clear the browser cookie', async (t) => {
  const request = await setup(t, async (url) => {
    if (url.endsWith('/logout')) throw new Error('offline');
    return Response.json({}, { status: 401 });
  });
  for (const path of ['/auth/refresh', '/auth/logout']) {
    const result = await request(path, {}, { cookie: 'wodana_mobile_refresh=old' });
    assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
  }
});

test('workspace proxy preserves action bodies, requires bearer auth, and blocks cross-origin writes',async(t)=>{
 let calls=0;const request=await setup(t,async(url,init)=>{calls++;assert.match(url,/\/hrms\/attendance\/actions$/);assert.equal(init.headers.authorization,'Bearer access');assert.deepEqual(JSON.parse(init.body.toString()),{actionId:'same-action'});return Response.json({id:'receipt'});});
 const path='/workspaces/00000000-0000-4000-8000-000000000001/hrms/attendance/actions';
 assert.equal((await request(path,{actionId:'same-action'})).status,401);
 assert.equal((await request(path,{}, {authorization:'Bearer access',origin:'https://outside.example'})).status,403);
 const result=await request(path,{actionId:'same-action'},{authorization:'Bearer access'});assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'private, no-store');assert.deepEqual(await result.json(),{id:'receipt'});assert.equal(calls,1);
});

test('workspace proxy permits tenant-scoped CRM reads', async (t) => {
  const calls = [];
  const proxy = createAuthProxy({ target: 'https://api.example.com/api/v1', fetcher: async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ summary: { activeLeads: 2 }, items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const server = createServer((req, res) => { void proxy(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${origin}/api/v1/workspaces/00000000-0000-4000-8000-000000000001/crm/today`, { headers: { authorization: 'Bearer crm-token' } });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/crm\/today$/);
  assert.equal(calls[0].init.headers.authorization, 'Bearer crm-token');
});

test('workspace proxy forwards the app areas only', async (t) => {
 const id = '00000000-0000-4000-8000-000000000001'; const seen = [];
 const request = await setup(t, async (url, init) => { seen.push(String(url)); assert.equal(init.headers.authorization, 'Bearer field-token'); return Response.json({ ok: true }); });
 // Field work, and what Today, Approvals, Woddy, Me and Finance read.
 const paths = [`project-core/projects/${id}/work`, `site/projects/${id}`, 'purchasing/receipts', `factory/orders/${id}`, `pre-projects/${id}/assets/${id}/markup`,
  'home/summary', 'home/metrics', 'approvals/mine/count', 'ai-settings', 'ai/agent/runs', 'me/feedback', 'members', `payables/bills/${id}`, 'receivables'];
 for (const path of paths) assert.equal((await request(`/workspaces/${id}/${path}`, { id }, { authorization: 'Bearer field-token' })).status, 200, path);
 for (const other of ['settings', 'billing', 'home-overview', 'site/../settings']) {
  assert.equal((await request(`/workspaces/${id}/${other}`, {}, { authorization: 'Bearer field-token' })).status, 404, other);
 }
 assert.equal((await request(`/workspaces/${id}/site/projects/${id}`, {}, { origin: 'https://outside.example', authorization: 'Bearer field-token' })).status, 403);
 assert.equal(seen.length, paths.length);
});
