import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthClient, type SessionStorage } from '../src/auth/client';

const profile = { id: 'user-1', primaryEmail: 'member@example.com', displayName: 'Member', status: 'active', nextAction: 'enter_workspace',
  memberships: [{ workspaceId: 'workspace-1', workspaceName: 'Iglo Architects', workspaceSlug: 'iglo-architects', status: 'active', roles: ['member'] }] };
const tokens = (version = 1) => ({ accessToken: `access-${version}`, refreshToken: `refresh-${version}`, accessTokenExpiresIn: 900, refreshTokenExpiresIn: 2592000 });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function harness() {
  let saved: string | null = null;
  let clock = 1000;
  let rotations = 0;
  let override: ((path: string, init: RequestInit) => Promise<Response> | Response | undefined) | undefined;
  const calls: { path: string; body?: Record<string, unknown>; token: string | null }[] = [];
  const storage: SessionStorage = { read: async () => saved, write: async (value) => { saved = value; }, clear: async () => { saved = null; } };
  const fetcher: typeof fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname.replace('/api/v1', '');
    calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined, token: new Headers(init.headers).get('authorization') });
    const overridden = override?.(path, init);
    if (overridden) return await overridden;
    if (path === '/auth/login') return response({ ...tokens(), selectedWorkspaceId: 'workspace-1' }, 201);
    if (path === '/auth/refresh') return response(tokens(2 + rotations++), 201);
    if (path === '/auth/logout') return response({ signedOut: true }, 201);
    if (path === '/me') return response(profile);
    throw new Error(`Unexpected path ${path}`);
  };
  const create = () => new AuthClient({ baseUrl: 'https://api.example.com/api/v1', tenantSlug: 'iglo-architects', storage, fetch: fetcher, now: () => clock });
  return { create, storage, calls, get saved() { return saved; }, set saved(value) { saved = value; }, set clock(value: number) { clock = value; },
    set override(value: typeof override) { override = value; } };
}

test('sign-in verifies /me and persists only refresh metadata, never password or access token', async () => {
  const h = harness(), client = h.create();
  await client.signIn(' Member@Example.com ', ' Keep#Spaces ');
  assert.equal(client.getSnapshot().status, 'signedIn');
  assert.deepEqual(h.calls[0].body, { email: 'member@example.com', password: ' Keep#Spaces ', tenantSlug: 'iglo-architects' });
  assert.equal(h.calls[1].path, '/me');
  assert.equal(h.calls[1].token, 'Bearer access-1');
  assert.equal(JSON.parse(h.saved!).refreshToken, 'refresh-1');
  assert.doesNotMatch(h.saved!, /Keep#Spaces|access-1|primaryEmail/);
});
test('invalid credentials cannot create a session', async () => {
  const h = harness(), client = h.create();
  h.override = () => response({ message: 'Invalid credentials' }, 401);
  await assert.rejects(client.signIn('member@example.com', 'wrong'), /Email or password is incorrect/);
  assert.equal(client.getSnapshot().status, 'signedOut');
  assert.equal(h.saved, null);
});
test('a login response cannot bypass active workspace membership verification', async () => {
  const h = harness(), client = h.create();
  h.override = (path) => path === '/me' ? response({ ...profile, memberships: [] }) : undefined;
  await assert.rejects(client.signIn('member@example.com', 'password'), /no longer have access/);
  assert.equal(client.getSnapshot().status, 'signedOut');
  assert.equal(h.saved, null);
  assert.ok(h.calls.some((call) => call.path === '/auth/logout'));
});
test('relaunch rotates the saved token and revalidates the profile', async () => {
  const h = harness();
  await h.create().signIn('member@example.com', 'password');
  const client = h.create();
  await client.restore();
  assert.equal(client.getSnapshot().status, 'signedIn');
  assert.equal(JSON.parse(h.saved!).refreshToken, 'refresh-2');
  assert.deepEqual(h.calls.filter((c) => c.path === '/auth/refresh').map((c) => c.body), [{ refreshToken: 'refresh-1' }]);
});
test('simultaneous expired-token requests share exactly one rotation', async () => {
  const h = harness(), client = h.create();
  await client.signIn('member@example.com', 'password');
  h.clock = 950000;
  await Promise.all([client.get('/me'), client.get('/me'), client.get('/me')]);
  assert.equal(h.calls.filter((call) => call.path === '/auth/refresh').length, 1);
  assert.equal(JSON.parse(h.saved!).refreshToken, 'refresh-2');
});
test('401 retries once with a rotated token; rejected refresh clears authentication', async () => {
  const h = harness(), client = h.create();
  await client.signIn('member@example.com', 'password');
  h.override = (path, init) => path === '/me' && new Headers(init.headers).get('authorization') === 'Bearer access-1' ? response({}, 401) : undefined;
  await client.get('/me');
  assert.equal(h.calls.filter((call) => call.path === '/auth/refresh').length, 1);
  h.clock = 950000;
  h.override = (path) => path === '/auth/refresh' ? response({}, 401) : undefined;
  await assert.rejects(client.get('/me'), /expired/);
  assert.equal(client.getSnapshot().status, 'signedOut');
  assert.equal(h.saved, null);
});
test('a temporary outage keeps saved credentials and blocks Home until retry succeeds', async () => {
  const h = harness();
  await h.create().signIn('member@example.com', 'password');
  const client = h.create(), saved = h.saved;
  h.override = (path) => path === '/auth/refresh' ? Promise.reject(new Error('offline')) : undefined;
  await client.restore();
  assert.equal(client.getSnapshot().status, 'unavailable');
  assert.equal(h.saved, saved);
  h.override = undefined;
  await client.restore();
  assert.equal(client.getSnapshot().status, 'signedIn');
});
test('logout during a pending login cannot restore Home or save credentials later', async () => {
  const h = harness(), client = h.create(), wait = deferred<Response>();
  h.override = (path) => path === '/auth/login' ? wait.promise : undefined;
  const attempt = client.signIn('member@example.com', 'password');
  const rejected = assert.rejects(attempt, /cancelled/);
  await client.signOut();
  wait.resolve(response({ ...tokens(), selectedWorkspaceId: 'workspace-1' }));
  await rejected;
  assert.equal(client.getSnapshot().status, 'signedOut');
  assert.equal(h.saved, null);
  assert.ok(h.calls.some((c) => c.path === '/auth/logout' && c.body?.refreshToken === 'refresh-1'));
});
test('logout during refresh revokes the late token and does not resurrect storage', async () => {
  const h = harness(), client = h.create(), wait = deferred<Response>();
  await client.signIn('member@example.com', 'password');
  h.clock = 950000;
  h.override = (path) => path === '/auth/refresh' ? wait.promise : undefined;
  const pending = assert.rejects(client.get('/me'), /cancelled/);
  await client.signOut();
  wait.resolve(response(tokens(2)));
  await pending;
  assert.equal(client.getSnapshot().status, 'signedOut');
  assert.equal(h.saved, null);
  assert.ok(h.calls.some((c) => c.path === '/auth/logout' && c.body?.refreshToken === 'refresh-2'));
});
test('secure storage failure fails closed and revokes the issued refresh token', async () => {
  const h = harness(), client = h.create();
  h.storage.write = async () => { throw new Error('keychain locked'); };
  await assert.rejects(client.signIn('member@example.com', 'password'), /save your sign-in securely/);
  assert.equal(client.getSnapshot().status, 'signedOut');
  assert.ok(h.calls.some((c) => c.path === '/auth/logout'));
});
test('a session from another API or tenant is discarded without sending its token', async () => {
  const h = harness();
  await h.create().signIn('member@example.com', 'password');
  h.saved = JSON.stringify({ ...JSON.parse(h.saved!), scope: 'https://other-api.example.com/api/v1|another' });
  h.calls.length = 0;
  const client = h.create();
  await client.restore();
  assert.equal(h.saved, null);
  assert.equal(client.getSnapshot().status, 'signedOut');
  assert.equal(h.calls.length, 0);
});
test('malformed storage is cleared and offline logout still closes the session', async () => {
  const h = harness(), client = h.create();
  h.saved = '{';
  await client.restore();
  assert.equal(client.getSnapshot().status, 'signedOut');
  await client.signIn('member@example.com', 'password');
  h.override = (path) => path === '/auth/logout' ? Promise.reject(new Error('offline')) : undefined;
  await client.signOut();
  assert.equal(h.saved, null);
  assert.equal(client.getSnapshot().status, 'signedOut');
});
test('authenticated requests cannot send a bearer token to another origin', async () => {
  const h = harness(), client = h.create();
  await client.signIn('member@example.com', 'password');
  const before = h.calls.length;
  await assert.rejects(client.get('//evil.example.com'), /not configured/);
  assert.equal(h.calls.length, before);
});

test('workspace writes retry a 401 with the same action and preserve API validation errors',async()=>{
 const h=harness(),client=h.create();await client.signIn('member@example.com','password');
 h.override=(path,init)=>path.includes('/hrms/')?new Headers(init.headers).get('authorization')==='Bearer access-1'?response({},401):response({id:'recorded'}):undefined;
 const body={actionId:'fixed-id',kind:'check_in'};
 assert.deepEqual(await client.api('/workspaces/workspace-1/hrms/attendance/actions','POST',body),{id:'recorded'});
 const attempts=h.calls.filter(c=>c.path.includes('/hrms/'));assert.equal(attempts.length,2);assert.deepEqual(attempts.map(c=>c.body),[body,body]);
 h.override=path=>path.includes('/hrms/')?response({message:'Already checked in',issues:['open_session']},409):undefined;
 await assert.rejects(client.api('/workspaces/workspace-1/hrms/attendance/actions','POST',body),(e:unknown)=>e instanceof Error&&'status' in e&&e.status===409&&e.message==='Already checked in');
 assert.equal(client.getSnapshot().status,'signedIn');
 await assert.rejects(client.api('/workspaces/other-workspace/hrms/bootstrap'),/outside the active workspace/);
});
test('foreground session refresh keeps active forms mounted, including transient outages',async()=>{
 const h=harness(),client=h.create();await client.signIn('member@example.com','password');const states:string[]=[];client.subscribe(()=>states.push(client.getSnapshot().status));
 await client.restore();assert.ok(!states.includes('checking'));assert.equal(client.getSnapshot().status,'signedIn');
 h.override=path=>path==='/auth/refresh'?Promise.reject(new Error('offline')):undefined;
 await client.restore();assert.equal(client.getSnapshot().status,'signedIn');
});

test('an empty successful attendance response means no active session, not a network error', async () => {
  const h = harness(), client = h.create();
  await client.signIn('member@example.com', 'password');
  for (const status of [200, 204]) {
    h.override = path => path.endsWith('/attendance/current') ? new Response(null, { status }) : undefined;
    assert.equal(await client.api('/workspaces/workspace-1/hrms/attendance/current'), null);
    assert.equal(client.getSnapshot().status, 'signedIn');
  }
});
test('private attendance image bytes are preserved when parsing nullable API responses', async () => {
  const h = harness(), client = h.create();
  await client.signIn('member@example.com', 'password');
  const bytes = new Uint8Array([255, 216, 255, 224, 0, 16]);
  h.override = path => path.endsWith('/photo') ? new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }) : undefined;
  const result = await client.api<ArrayBuffer>('/workspaces/workspace-1/hrms/captures/example/photo', 'GET', undefined, true);
  assert.deepEqual(new Uint8Array(result), bytes);
});

test('Site and Brief calls use the active workspace and preserve markup bytes and retry IDs',async()=>{
 const h=harness(),client=h.create();await client.signIn('member@example.com','password');
 h.override=(path,init)=>path.includes('/pre-projects/')?new Headers(init.headers).get('authorization')==='Bearer access-1'?response({},401):response({id:'marked-photo'}):undefined;
 const body={id:'same-markup',strokes:[{color:'#694f7a',width:.004,points:[{x:.2,y:.4}]}]};
 const path='/workspaces/workspace-1/pre-projects/case-1/assets/photo-1/markup';
 assert.deepEqual(await client.api(path,'POST',body),{id:'marked-photo'});assert.deepEqual(h.calls.filter(c=>c.path===path).map(c=>c.body),[body,body]);
 const before=h.calls.length;await assert.rejects(client.api('/workspaces/other-workspace/pre-projects/case-1/site'),/outside the active workspace/);assert.equal(h.calls.length,before);
 const bytes=new Uint8Array([137,80,78,71]);h.override=p=>p.endsWith('/assets/photo-1')?new Response(bytes):undefined;
 assert.deepEqual(new Uint8Array(await client.api<ArrayBuffer>('/workspaces/workspace-1/pre-projects/case-1/assets/photo-1','GET',undefined,true)),bytes);
});
