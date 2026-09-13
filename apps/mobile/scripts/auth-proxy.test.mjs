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

test('field proxy forwards private markups and rejects unrelated write routes',async(t)=>{
 const id='00000000-0000-4000-8000-000000000001';let calls=0;
 const request=await setup(t,async(url,init)=>{calls++;assert.match(url,/\/assets\/.+\/markup$/);assert.equal(init.headers.authorization,'Bearer field-token');assert.deepEqual(JSON.parse(init.body.toString()),{id:'same-drawing',strokes:[]});return Response.json({id:'saved'});});
 const base=`/workspaces/${id}/pre-projects/${id}`;
 assert.equal((await request(`${base}/assets/${id}/markup`,{id:'same-drawing',strokes:[]},{authorization:'Bearer field-token'})).status,200);
 assert.equal((await request(`${base}/designs`,{},{authorization:'Bearer field-token'})).status,404);
 assert.equal((await request(`${base}/site/${id}/review`,{},{origin:'https://outside.example',authorization:'Bearer field-token'})).status,403);
 assert.equal(calls,1);
});
