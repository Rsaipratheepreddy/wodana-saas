import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, AuthClient, DeviceLimitError, modulesForPath, type SessionStorage } from '../src/auth/client';

const profile = { id: 'user-1', primaryEmail: 'member@example.com', displayName: 'Member', status: 'active', nextAction: 'enter_workspace',
  memberships: [{ workspaceId: 'workspace-1', workspaceName: 'Iglo Architects', workspaceSlug: 'iglo-architects', workspaceStatus: 'active',
    workspaceLogoUrl: null, workspacePrimaryColor: null, status: 'active', roles: ['member'], allowedModules: ['workspace', 'crm', 'pre-project', 'projects', 'hrms'] }] };
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
  const create = (tenantSlug = 'iglo-architects', profileCache?: SessionStorage) => new AuthClient({ baseUrl: 'https://api.example.com/api/v1', tenantSlug, storage, profileCache, fetch: fetcher, now: () => clock });
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
test('organization lookup accepts name, slug, or ID before tenant-scoped sign-in', async () => {
  const h = harness(), client = h.create('');
  h.override = (path) => path === '/auth/organization/resolve'
    ? response({ displayName: 'Palm Living', loginSlug: 'palm-living', logoUrl: '/api/auth/tenant-logo/palm-living', primaryColor: '#E4E3DE' }, 201)
    : undefined;
  for (const identifier of ['Palm Living', 'palm-living', '00000000-0000-4000-8000-000000000001']) {
    const organization = await client.resolveOrganization(identifier);
    assert.equal(organization.displayName, 'Palm Living');
    assert.equal(organization.loginSlug, 'palm-living');
    assert.equal(organization.logoUrl, 'https://api.example.com/api/v1/public/tenant-branding/palm-living/logo');
  }
  assert.deepEqual(h.calls.map((call) => call.body?.identifier), ['Palm Living', 'palm-living', '00000000-0000-4000-8000-000000000001']);
  assert.equal(client.tenantSlug, 'palm-living');
});
test('unknown or ambiguous organization does not advance to sign-in', async () => {
  const h = harness(), client = h.create('');
  h.override = () => response({ message: 'Organization was not found' }, 404);
  await assert.rejects(client.resolveOrganization('missing'), /Organization was not found/);
  assert.equal(client.tenantSlug, '');
});
test('native sign-in waits for an MFA challenge and persists no token before verification', async () => {
  const h = harness(), client = h.create();
  h.override = (path, init) => {
    if (path === '/auth/login') return response({ mfaRequired: true, challengeToken: 'one-time-challenge', selectedWorkspaceId: 'workspace-1' }, 201);
    if (path === '/auth/mfa/verify') return JSON.parse(String(init.body)).code === '123456'
      ? response({ ...tokens(), selectedWorkspaceId: 'workspace-1' }, 201)
      : response({ message: 'Incorrect code' }, 401);
    return undefined;
  };
  await client.signIn('member@example.com', 'password');
  assert.equal(client.getSnapshot().status, 'mfa');
  assert.equal(h.saved, null);
  assert.equal(h.calls.some((call) => call.path === '/me'), false);
  await assert.rejects(client.verifyMfa('000000'), /Verification code is incorrect/);
  assert.equal(client.getSnapshot().status, 'mfa');
  await client.verifyMfa('123456');
  assert.equal(client.getSnapshot().status, 'signedIn');
  assert.equal(JSON.parse(h.saved!).refreshToken, 'refresh-1');
  assert.equal(h.calls.find((call) => call.path === '/auth/mfa/verify')?.body?.challengeToken, 'one-time-challenge');
});
test('an expired MFA challenge and cancellation fail closed', async () => {
  const h = harness(), client = h.create();
  h.override = (path) => path === '/auth/login'
    ? response({ mfaRequired: true, challengeToken: 'one-time-challenge', selectedWorkspaceId: 'workspace-1' }, 201)
    : path === '/auth/mfa/verify' ? response({ message: 'Expired' }, 410) : undefined;
  await client.signIn('member@example.com', 'password');
  await assert.rejects(client.verifyMfa('123456'), /session has expired/);
  assert.equal(client.getSnapshot().status, 'signedOut');
  assert.equal(h.saved, null);
  await client.signIn('member@example.com', 'password');
  client.cancelMfa();
  assert.equal(client.getSnapshot().status, 'signedOut');
  await assert.rejects(client.verifyMfa('123456'), /expired/);
});
test('a generic native build signs into the selected tenant and restores only that scoped session', async () => {
  const h = harness(), client = h.create('');
  const palmProfile = { ...profile, memberships: [{ ...profile.memberships[0], workspaceSlug: 'plm' }] };
  h.override = (path) => path === '/me' ? response(palmProfile) : undefined;
  await assert.rejects(client.signIn('member@example.com', 'password', 'bad/tenant'), /workspace code/);
  assert.equal(h.calls.length, 0);
  await client.signIn('member@example.com', 'password', 'plm');
  assert.equal(client.tenantSlug, 'plm');
  assert.equal(h.calls.find((call) => call.path === '/auth/login')?.body?.tenantSlug, 'plm');
  assert.equal(JSON.parse(h.saved!).scope, 'https://api.example.com/api/v1|plm');
  const restored = h.create('');
  await restored.restore();
  assert.equal(restored.tenantSlug, 'plm');
  assert.equal(restored.getSnapshot().status, 'signedIn');
  const locked = h.create('iglo-architects');
  await assert.rejects(locked.signIn('member@example.com', 'password', 'plm'), /different workspace/);
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
test('suspended organization and missing module grants fail closed at mobile sign-in', async () => {
  const h = harness(), client = h.create();
  h.override = (path) => path === '/me' ? response({ ...profile, memberships: [{ ...profile.memberships[0], workspaceStatus: 'suspended' }] }) : undefined;
  await assert.rejects(client.signIn('member@example.com', 'password'), /no longer have access/);
  h.override = (path) => path === '/me' ? response({ ...profile, memberships: [{ ...profile.memberships[0], allowedModules: undefined }] }) : undefined;
  await assert.rejects(client.signIn('member@example.com', 'password'), /could not be verified/);
});
test('team-inherited role unions and their effective modules are accepted without local role guessing', async () => {
  const h = harness(), client = h.create();
  const inherited = {
    ...profile,
    memberships: [{
      ...profile.memberships[0],
      roles: ['sales-agent', 'project-reporter'],
      allowedModules: ['workspace', 'crm', 'projects'],
    }],
  };
  h.override = (path) => path === '/me' ? response(inherited) : undefined;
  await client.signIn('member@example.com', 'password');
  const state = client.getSnapshot();
  assert.equal(state.status, 'signedIn');
  if (state.status !== 'signedIn') throw new Error('Expected a signed-in state');
  assert.deepEqual(state.profile.memberships[0].roles, ['sales-agent', 'project-reporter']);
  assert.deepEqual(state.profile.memberships[0].allowedModules, ['workspace', 'crm', 'projects']);
});
test('malformed effective roles fail closed instead of granting a native session', async () => {
  const h = harness(), client = h.create();
  h.override = (path) => path === '/me' ? response({ ...profile, memberships: [{ ...profile.memberships[0], roles: undefined }] }) : undefined;
  await assert.rejects(client.signIn('member@example.com', 'password'), /could not be verified/);
  assert.equal(client.getSnapshot().status, 'signedOut');
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
test('a command keeps its own idempotency key across the 401 retry, and it can never replace the token', async () => {
  const h = harness(), client = h.create(); await client.signIn('member@example.com', 'password');
  const seen: Array<{ key: string | null; auth: string | null }> = [];
  h.override = (path, init) => {
    if (!path.includes('/crm/intake-events')) return undefined;
    const headers = new Headers(init.headers);
    seen.push({ key: headers.get('idempotency-key'), auth: headers.get('authorization') });
    return headers.get('authorization') === 'Bearer access-1' ? response({}, 401) : response({ leadId: 'lead-1' }, 201);
  };
  const result = await client.api('/workspaces/workspace-1/crm/intake-events', 'POST', { source: 'company' }, false, { headers: { 'idempotency-key': 'lead-app:1', authorization: 'Bearer forged' } });
  assert.deepEqual(result, { leadId: 'lead-1' });
  assert.deepEqual(seen.map((item) => item.key), ['lead-app:1', 'lead-app:1']);
  assert.deepEqual(seen.map((item) => item.auth), ['Bearer access-1', 'Bearer access-2']);
});
test('a server-side module downgrade refreshes stale native capabilities and blocks later queued writes locally',async()=>{
 const h=harness(),client=h.create();
 let current={...profile,memberships:[{...profile.memberships[0],allowedModules:['workspace','crm','projects']}]} as typeof profile;
 h.override=(path)=>path==='/me'?response(current):path.includes('/projects/')?response({message:'This module is not included.'},403):undefined;
 await client.signIn('member@example.com','password');
 current={...profile,memberships:[{...profile.memberships[0],allowedModules:['workspace','crm']}]} as typeof profile;
 await assert.rejects(client.api('/workspaces/workspace-1/projects/project-1/field-actions','POST',{action:'draft'}),(error:unknown)=>error instanceof ApiError&&error.status===403);
 const state=client.getSnapshot();assert.equal(state.status,'signedIn');
 if(state.status!=='signedIn')throw new Error('Expected signed-in state');
 assert.deepEqual(state.profile.memberships[0].allowedModules,['workspace','crm']);
 const requests=h.calls.filter(call=>call.path.includes('/projects/')).length;
 await assert.rejects(client.api('/workspaces/workspace-1/projects/project-1/field-actions','POST',{action:'retry'}),(error:unknown)=>error instanceof ApiError&&error.status===403);
 assert.equal(h.calls.filter(call=>call.path.includes('/projects/')).length,requests);
});
test('past-due billing remains visible without silently removing native module access',async()=>{
 const h=harness(),client=h.create();
 const pastDue={...profile,memberships:[{...profile.memberships[0],billingAccess:{state:'past_due',effect:'unchanged',warning:true,
  actionDueAt:null,affectedModules:[],message:'Payment is past due. Workspace access remains unchanged.'}}]};
 h.override=path=>path==='/me'?response(pastDue):path.endsWith('/billing')?response({accessPolicy:pastDue.memberships[0].billingAccess}):undefined;
 await client.signIn('member@example.com','password');
 const state=client.getSnapshot();assert.equal(state.status,'signedIn');
 if(state.status!=='signedIn')throw new Error('Expected signed-in state');
 assert.deepEqual(state.profile.memberships[0].allowedModules,profile.memberships[0].allowedModules);
 assert.equal(state.profile.memberships[0].billingAccess?.state,'past_due');
 assert.deepEqual(await client.api('/workspaces/workspace-1/billing'),{accessPolicy:pastDue.memberships[0].billingAccess});
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

test('email-first sign-in takes the workspace from the account and scopes the saved session to it', async () => {
  const h = harness(), client = h.create('');
  const result = await client.signIn('member@example.com', 'password');
  assert.deepEqual(result, { kind: 'signedIn' });
  assert.equal(h.calls.find((call) => call.path === '/auth/login')?.body?.tenantSlug, undefined);
  assert.equal(client.tenantSlug, 'iglo-architects');
  assert.equal(JSON.parse(h.saved!).scope, 'https://api.example.com/api/v1|iglo-architects');
  assert.equal(client.getSnapshot().status, 'signedIn');
});

test('an email in several workspaces offers a choice without a session, then signs in to the chosen one', async () => {
  const h = harness(), client = h.create('');
  h.override = (path, init) => {
    if (path !== '/auth/login') return undefined;
    const body = JSON.parse(String(init.body));
    if (body.tenantSlug) return undefined;
    return response({ workspaceSelectionRequired: true, workspaces: [
      { workspaceId: 'workspace-1', name: 'Iglo Architects', loginSlug: 'iglo-architects', logoUrl: '/api/auth/tenant-logo/iglo-architects?v=1', primaryColor: '#123456' },
      { workspaceId: 'bad', name: 'Bad', loginSlug: 'Not A Slug', logoUrl: null, primaryColor: null },
    ] }, 201);
  };
  const choice = await client.signIn('member@example.com', 'password');
  assert.equal(choice?.kind, 'chooseWorkspace');
  assert.deepEqual(choice?.kind === 'chooseWorkspace' ? choice.workspaces : [], [{
    workspaceId: 'workspace-1', name: 'Iglo Architects', loginSlug: 'iglo-architects', primaryColor: '#123456',
    logoUrl: 'https://api.example.com/api/v1/public/tenant-branding/iglo-architects/logo',
  }]);
  assert.equal(client.getSnapshot().status, 'signedOut');
  assert.equal(h.saved, null);
  assert.deepEqual(await client.signIn('member@example.com', 'password', 'iglo-architects'), { kind: 'signedIn' });
  assert.equal(h.calls.filter((call) => call.path === '/auth/login').at(-1)?.body?.tenantSlug, 'iglo-architects');
});

test('the device limit lists the other sessions, and signing one out is sent with the retry', async () => {
  const h = harness(), client = h.create('');
  let limited = true;
  h.override = (path) => (path === '/auth/login' && limited ? response({ code: 'DEVICE_LIMIT_REACHED', message: 'You are already signed in on 2 devices.', maxActiveDevices: 2,
    sessions: [{ familyId: 'f-1', createdAt: '2026-09-01', lastActiveAt: '2026-09-20', expiresAt: '2026-10-20', userAgent: 'iPhone', ipAddress: null }] }, 409) : undefined);
  await assert.rejects(client.signIn('member@example.com', 'password'), (error: unknown) => error instanceof DeviceLimitError && error.sessions[0].familyId === 'f-1' && error.maxActiveDevices === 2);
  limited = false;
  await client.signIn('member@example.com', 'password', null, { revokeFamilyId: 'f-1' });
  assert.equal(h.calls.filter((call) => call.path === '/auth/login').at(-1)?.body?.revokeFamilyId, 'f-1');
});

test('password help needs only the email, and signing in with another email forgets the workspace', async () => {
  const h = harness(), client = h.create('');
  h.override = (path) => (path === '/auth/password/forgot' ? response({ accepted: true }, 201) : undefined);
  await client.requestPasswordReset('Member@Example.com');
  assert.deepEqual(h.calls.at(-1)?.body, { email: 'member@example.com' });
  await client.signIn('member@example.com', 'password');
  await client.signOut();
  client.resetTenant();
  assert.equal(client.tenantSlug, '');
});

test('attendance may read offices, sites and work contexts from the projects area with HRMS alone', () => {
  assert.deepEqual(modulesForPath('projects/locations'), ['projects', 'hrms']);
  assert.deepEqual(modulesForPath('projects'), ['projects', 'hrms']);
  assert.deepEqual(modulesForPath('projects/abc/execution'), ['projects']);
  assert.deepEqual(modulesForPath('project-core/projects'), ['projects']);
  assert.deepEqual(modulesForPath('crm/notifications'), ['crm']);
});

const memoryCache = () => { let value: string | null = null; return { cache: { read: async () => value, write: async (next: string) => { value = next; }, clear: async () => { value = null; } } satisfies SessionStorage, get value() { return value; } }; };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('coming back to the app refreshes the profile with the live token and rotates only near expiry', async () => {
  const h = harness(), client = h.create();
  await client.signIn('member@example.com', 'password');
  await client.restore();
  assert.equal(h.calls.filter((call) => call.path === '/auth/refresh').length, 0);
  assert.equal(h.calls.at(-1)?.path, '/me');
  h.clock = 1000 + 900_000 - 60_000;
  await client.restore();
  assert.equal(h.calls.filter((call) => call.path === '/auth/refresh').length, 1);
  assert.equal(client.getSnapshot().status, 'signedIn');
});

test('a start without a connection opens with the last verified profile and verifies it once back online', async () => {
  const h = harness(), memory = memoryCache();
  await h.create('iglo-architects', memory.cache).signIn('member@example.com', 'password');
  await settle();
  assert.match(memory.value ?? '', /workspace-1/);
  assert.doesNotMatch(memory.value ?? '', /refresh-1|access-1/);
  const client = h.create('iglo-architects', memory.cache);
  h.override = (path) => path === '/auth/refresh' ? Promise.reject(new Error('offline')) : undefined;
  await client.restore();
  const offline = client.getSnapshot();
  assert.equal(offline.status, 'signedIn');
  assert.equal(offline.status === 'signedIn' && offline.offline, true);
  // Requests fail as offline (queued captures wait) without signing the person out.
  await assert.rejects(client.api('/workspaces/workspace-1/hrms/bootstrap'), /Unable to connect/);
  assert.equal(client.getSnapshot().status, 'signedIn');
  h.override = undefined;
  await client.restore();
  const online = client.getSnapshot();
  assert.equal(online.status === 'signedIn' && !online.offline, true);
  assert.equal(JSON.parse(h.saved!).refreshToken, 'refresh-2');
});

test('without a remembered profile, or after signing out, a start without a connection shows the retry screen', async () => {
  const other = harness();
  await other.create().signIn('member@example.com', 'password');
  const uncached = other.create();
  other.override = (path) => path === '/auth/refresh' ? Promise.reject(new Error('offline')) : undefined;
  await uncached.restore();
  assert.equal(uncached.getSnapshot().status, 'unavailable');

  const h = harness(), memory = memoryCache();
  const client = h.create('iglo-architects', memory.cache);
  await client.signIn('member@example.com', 'password');
  await settle();
  await client.signOut();
  assert.equal(memory.value, null);
  h.override = (path) => path === '/auth/refresh' ? Promise.reject(new Error('offline')) : undefined;
  await h.create('iglo-architects', memory.cache).restore();
  assert.equal(h.saved, null);
});
