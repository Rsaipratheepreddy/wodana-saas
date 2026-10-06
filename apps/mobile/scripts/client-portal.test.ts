import assert from 'node:assert/strict';
import test from 'node:test';
import { inviteToken, portalLookups } from '../src/portal/address';
import { PortalClient, PortalError, type PortalStorage } from '../src/portal/client';
import { CodedDecision, reportPayment, uploadAll } from '../src/portal/flows';
import {
  clientPushStep, decisionPurpose, designWaiting, digestLines, feedFor, feedTarget, logoUrl, milestoneAmount, paymentProblem, sortMilestones, stateLabel, stepTarget, waitingFor,
} from '../src/portal/model';
import type { PortalMilestone, PortalProject, PortalSite } from '../src/portal/types';

const BASE = 'https://firm.example/api/v1';
const site: PortalSite = {
  slug: 'atelier', brand: { name: 'Atelier', logoUrl: '/api/auth/tenant-logo/atelier?v=1', primaryColor: '#123456', secondaryColor: null, headingFont: null, bodyFont: null },
  welcomeTitle: 'Welcome home', welcomeText: '', support: { phone: '', email: '', whatsapp: '' }, region: { locale: 'ar-AE', currency: 'AED', timeZone: 'Asia/Dubai', country: 'AE' },
  signIn: { channels: ['whatsapp', 'email'], demo: false }, gallerySlug: null,
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
/** A business core in memory: answers by path, records every request. */
function server(routes: Record<string, (call: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetcher = (async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const call: Call = { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body ?? null };
    calls.push(call);
    const path = url.slice(BASE.length + 1).split('?')[0];
    const route = Object.keys(routes).find((pattern) => new RegExp(`^${pattern}$`).test(path));
    if (!route) return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
    const answer = routes[route](call);
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}
function memory(initial: string | null = null): PortalStorage & { value: string | null } {
  const store = { value: initial, read: async () => store.value, write: async (value: string) => { store.value = value; }, clear: async () => { store.value = null; } };
  return store;
}
let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

test('a portal is found from the link the team sent, the firm\'s domain or its sign-in name', () => {
  assert.deepEqual(portalLookups('https://app.example.com/portal/atelier?invite=abc'), [{ by: 'slug', value: 'atelier' }, { by: 'host', value: 'app.example.com' }]);
  assert.deepEqual(portalLookups('portal.atelier.ae'), [{ by: 'host', value: 'portal.atelier.ae' }]);
  assert.deepEqual(portalLookups('https://portal.atelier.ae/portal'), [{ by: 'host', value: 'portal.atelier.ae' }]);
  assert.deepEqual(portalLookups(' Atelier '), [{ by: 'slug', value: 'atelier' }, { by: 'login', value: 'atelier' }]);
  assert.deepEqual(portalLookups(''), []);
  assert.equal(inviteToken('https://app.example.com/portal/atelier?invite=AbCdEfGhIjKlMnOpQrStUvWx'), 'AbCdEfGhIjKlMnOpQrStUvWx');
  assert.equal(inviteToken('atelier'), null);
});

test('sign-in: portal, number, code; the session is kept in secure storage and the brand follows the portal', async () => {
  const api = server({
    'client-portal-sites/host/portal\\.atelier\\.ae': () => ({ body: { slug: 'atelier' } }),
    'client-portal/atelier/site': () => ({ body: site }),
    'client-portal/atelier/challenge': () => ({ body: { challengeId: 'c-1', channel: 'whatsapp', expiresIn: 300, resendAfter: 30 } }),
    'client-portal/atelier/login': (call) => ((call.body as { code: string }).code === '123456'
      ? { body: { token: 'session-token', expiresIn: 7_776_000, needsName: true } } : { status: 400, body: { message: 'That code isn\'t right or has expired. Check it, or ask for a new one.' } }),
    'client-portal/atelier/view': (call) => (call.headers.authorization === 'Bearer session-token'
      ? { body: { contact: { name: 'Maya', nameConfirmed: false, phone: '+15550100001' }, today: '2026-10-06', projects: [] } } : { status: 401, body: { message: 'Sign in to continue.' } }),
    'client-portal/atelier/command': () => ({ body: { ok: true, name: 'Maya Client' } }),
  });
  const storage = memory();
  const client = new PortalClient({ baseUrl: BASE, storage, fetch: api.fetcher, newId });
  await client.restore();
  assert.deepEqual(client.getSnapshot(), { status: 'signedOut', slug: null, site: null });

  await client.choose('portal.atelier.ae');
  const chosen = client.getSnapshot();
  assert.equal(chosen.status === 'signedOut' && chosen.site?.brand.primaryColor, '#123456');
  assert.deepEqual(JSON.parse(storage.value!), { slug: 'atelier', token: null });

  const code = await client.challenge({ phone: '+15550100001', channel: 'whatsapp' });
  assert.equal(code.challengeId, 'c-1');
  assert.equal(api.calls.at(-1)!.headers.authorization, undefined, 'a sign-in code is asked for without a session');

  await assert.rejects(client.login({ challengeId: 'c-1', code: '000000' }), (error: PortalError) => error.status === 400 && /isn't right/.test(error.message));
  assert.equal(client.getSnapshot().status, 'signedOut');

  assert.deepEqual(await client.login({ challengeId: 'c-1', code: '123456' }), { needsName: true });
  assert.deepEqual(JSON.parse(storage.value!), { slug: 'atelier', token: 'session-token' });
  assert.equal(client.getSnapshot().status === 'signedIn' && client.getSnapshot().status, 'signedIn');
  assert.equal(client.authorization, 'Bearer session-token');
  assert.equal(client.fileUrl('design', 'v-1', true), `${BASE}/client-portal/atelier/files/design/v-1?preview=1`);

  await client.confirmName(newId(), 'Maya Client');
  const named = client.getSnapshot();
  assert.equal(named.status === 'signedIn' && named.needsName, false);
  const view = await client.view();
  assert.equal(view.contact.name, 'Maya');

  // A new launch restores the session from storage.
  const again = new PortalClient({ baseUrl: BASE, storage, fetch: api.fetcher, newId });
  await again.restore();
  assert.equal(again.getSnapshot().status, 'signedIn');
});

test('a session the server ended signs the phone out on the next view; a wrong decision code does not', async () => {
  const api = server({
    'client-portal/atelier/site': () => ({ body: site }),
    'client-portal/atelier/command': () => ({ status: 401, body: { message: 'That code isn\'t right or has expired. Ask for a new one.' } }),
    'client-portal/atelier/view': () => ({ status: 401, body: { message: 'You were signed out. Sign in again to continue.' } }),
  });
  const storage = memory(JSON.stringify({ slug: 'atelier', token: 'old' }));
  const client = new PortalClient({ baseUrl: BASE, storage, fetch: api.fetcher, newId });
  await client.restore();
  await assert.rejects(client.command(newId(), { action: 'change_decision' }), PortalError);
  assert.equal(client.getSnapshot().status, 'signedIn', 'a wrong code keeps the client signed in to try again');
  await assert.rejects(client.view(), PortalError);
  const after = client.getSnapshot();
  assert.equal(after.status, 'signedOut');
  assert.equal(after.status === 'signedOut' && after.message, 'You were signed out. Sign in again to continue.');
  assert.deepEqual(JSON.parse(storage.value!), { slug: 'atelier', token: null }, 'the portal is remembered for next time');
});

test('no connection says so, and a firm\'s own build opens straight on its portal', async () => {
  const offline = new PortalClient({ baseUrl: BASE, storage: memory(), newId, fetch: (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch });
  await assert.rejects(offline.find('atelier'), (error: PortalError) => error.status === 0);
  const api = server({ 'client-portal-sites/tenant/atelier': () => ({ body: { slug: 'atelier-portal' } }), 'client-portal/atelier-portal/site': () => ({ body: { ...site, slug: 'atelier-portal' } }) });
  const locked = new PortalClient({ baseUrl: BASE, storage: memory(), fetch: api.fetcher, newId, lockedTo: 'atelier' });
  await locked.restore();
  const state = locked.getSnapshot();
  assert.equal(state.status === 'signedOut' && state.slug, 'atelier-portal', 'a bare name that is not a portal link is tried as the firm\'s sign-in name');
  await locked.forgetPortal();
  assert.equal(locked.slug, 'atelier-portal', 'a locked build never forgets its portal');
});

test('approve with code: the code is asked for exactly this decision and the decision goes once, under one id', async () => {
  const sent: Array<{ id: string; body: Record<string, unknown> }> = [];
  let tries = 0;
  const client = {
    newId,
    challenge: async (input: { purpose?: string; channel: string }) => ({ challengeId: `ch-${input.purpose}`, channel: input.channel as 'whatsapp', expiresIn: 300, resendAfter: 30 }),
    command: async (id: string, body: Record<string, unknown>) => {
      sent.push({ id, body });
      if (++tries === 1) throw new PortalError('That code isn\'t right or has expired. Ask for a new one.', 401);
      return { ok: true };
    },
    upload: async () => { throw new Error('unused'); },
  };
  const purpose = decisionPurpose('change', 'case-1', 'cr-1', 'accept');
  assert.equal(purpose, 'change:case-1:cr-1:accept');
  const decision = new CodedDecision(client as never, purpose, { action: 'change_decision', caseId: 'case-1', changeId: 'cr-1', decision: 'accept', version: 3 });
  await assert.rejects(decision.confirm('123456'), /Send a new code/);
  const challenge = await decision.send('whatsapp');
  assert.equal(challenge.challengeId, `ch-${purpose}`);
  await assert.rejects(decision.confirm('12 34'), /6-digit code/);
  await assert.rejects(decision.confirm('111111'), PortalError);
  assert.deepEqual(await decision.confirm('123 456'), { ok: true });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].id, sent[1].id, 'a retry is the same command, so the server never applies it twice');
  assert.deepEqual(sent[1].body, { action: 'change_decision', caseId: 'case-1', changeId: 'cr-1', decision: 'accept', version: 3, challengeId: `ch-${purpose}`, code: '123456' });
});

test('upload proof: photos go up first under their own ids, then "I\'ve paid" with them', async () => {
  const uploads: Array<{ caseId: string; id: string; file: { uri: string; name: string; type: string } }> = [];
  const commands: Array<{ id: string; body: Record<string, unknown> }> = [];
  const client = {
    newId,
    upload: async (caseId: string, id: string, file: { uri: string; name: string; type: string }) => { uploads.push({ caseId, id, file }); return { id, name: file.name, mimeType: file.type, hasPreview: true }; },
    command: async (id: string, body: Record<string, unknown>) => { commands.push({ id, body }); return { ok: true }; },
    challenge: async () => { throw new Error('unused'); },
  };
  const ids = await uploadAll(client as never, 'case-1', [
    { id: 'photo-a', uri: 'file:///receipt-1.jpg', name: 'receipt-1.jpg', type: 'image/jpeg' },
    { uri: 'file:///receipt-2.jpg', name: 'receipt-2.jpg', type: 'image/jpeg' },
  ]);
  assert.equal(ids[0], 'photo-a', 'a picked photo keeps its id, so a retried upload returns the same file');
  assert.equal(ids.length, 2);
  await reportPayment(client as never, { commandId: 'cmd-1', caseId: 'case-1', paymentId: 'pay-1', paidOn: '2026-10-05', amount: ' 12500,50 ', reference: ' FT123 ', uploadIds: ids });
  assert.deepEqual(commands[0], { id: 'cmd-1', body: { action: 'report_payment', caseId: 'case-1', paymentId: 'pay-1', paidOn: '2026-10-05', amount: '12500.50', reference: 'FT123', note: '', uploadIds: ids } });

  const today = '2026-10-06';
  assert.equal(paymentProblem({ paidOn: '2026-10-05', amount: '', reference: '', photos: 1, uploading: false }, today), null, 'a receipt photo alone is enough');
  assert.equal(paymentProblem({ paidOn: '2026-10-05', amount: '', reference: 'FT1', photos: 0, uploading: false }, today), null);
  assert.equal(paymentProblem({ paidOn: '2026-10-07', amount: '', reference: 'FT1', photos: 0, uploading: false }, today), 'The payment date can\'t be in the future.');
  assert.equal(paymentProblem({ paidOn: '2026-10-05', amount: '12,5x', reference: 'FT1', photos: 0, uploading: false }, today), 'Enter the amount you paid.');
  assert.equal(paymentProblem({ paidOn: '2026-10-05', amount: '', reference: '', photos: 0, uploading: false }, today), 'Add the bank reference or a photo of the receipt.');
  assert.equal(paymentProblem({ paidOn: '2026-10-05', amount: '', reference: '', photos: 1, uploading: true }, today), 'Adding…', 'it waits for the photos');
});

const project = (patch: Partial<PortalProject> = {}): PortalProject => ({
  id: 'case-1', title: 'Villa 12', reference: 'P-012', role: 'approver', status: 'active', paused: false,
  sections: { progress: true, moodboard: true, decisions: true, payments: true, documents: true, warranty: true, messages: true }, manager: 'Sam', stage: { number: 3, total: 6, name: 'MEP' },
  handoverDate: '2026-12-01', handedOverOn: null, warrantyUntil: null, rooms: [], next: [], unread: 0, latestUpdate: null, progress: null, moodboard: null, decisions: null, payments: null,
  documents: null, warranty: null, messages: null, ...patch,
});

test('home: what waits for the client, where each thing opens, and the feed without the day shown above it', () => {
  const home = project({
    next: [
      { kind: 'change', id: 'cr-1', title: 'CR-004 Extra wardrobe', due: '2026-10-10' },
      { kind: 'invoice', id: 'inv-1', title: 'Milestone 2', due: '2026-10-08' },
      { kind: 'presentation', id: 'pr-1', title: 'Concepts', due: null },
      { kind: 'quote', id: 'q-1', title: 'Q-12', due: null },
      { kind: 'site_access', id: 'sa-1', title: 'Kitchen delivery', due: '2026-10-09' },
    ],
    messages: { unread: 1, requests: [{ id: 'th-1', number: 1, title: 'Tiles', detail: 'Which grout?', status: 'open', createdAt: '2026-10-01T08:00:00Z', resolution: '', files: [],
      comments: [], unread: 1, seenByTeam: true, lastAt: '2026-10-05T10:00:00Z' }] },
    progress: { stages: [], updates: [], photoDays: [], issues: [], canReportIssue: false, siteAccess: [],
      cards: [{ id: 'day-1', date: '2026-10-05', sentAt: '2026-10-05T16:00:00Z', summary: 'Wiring done', noWork: false, hero: null, photos: [], completed: [], advanced: [], next: [], notes: [],
        reactions: { like: 0, love: 0 }, mine: { like: false, love: false } }] },
    feed: [{ kind: 'day', id: 'day-1', at: '2026-10-05T16:00:00Z', title: '2026-10-05', note: null, status: null },
      { kind: 'reply', id: 'th-1', at: '2026-10-05T10:00:00Z', title: 'Tiles', note: 'Epoxy', status: null }],
    digest: { since: '2026-10-01T00:00:00Z', items: [{ kind: 'day', count: 2, titles: ['2026-10-04', '2026-10-05'] }, { kind: 'reply', count: 1, titles: ['Tiles'] }] },
  });
  const waiting = waitingFor(home);
  assert.deepEqual(waiting.map((item) => item.title), ['Change to approve', 'Invoice to pay', 'Concepts to choose from', 'Quotation to decide', 'Confirm site access for {date}', 'New reply from your team']);
  assert.deepEqual(waiting.map((item) => item.target), [{ screen: 'changes', id: 'cr-1' }, { tab: 'payments' }, { tab: 'design' }, { web: true }, { web: true }, { screen: 'thread', id: 'th-1' }]);
  assert.deepEqual(feedFor(home).map((card) => card.id), ['th-1'], 'the latest day shows above the feed, not twice');
  assert.deepEqual(feedTarget(feedFor(home)[0]), { screen: 'thread', id: 'th-1' });
  assert.deepEqual(stepTarget({ kind: 'request', id: 'qq', title: '', due: null }), { screen: 'question', id: 'qq' });
  assert.deepEqual(digestLines(home.digest).map((line) => [line.label, line.count]), [['{count} days on site', 2], ['1 reply from your team', 1]]);
  assert.equal(designWaiting(project({ choices: { presentations: [], locked: false, currency: null, choices: [
    { entryId: 'e', kind: 'material', room: null, versionId: 'v1', number: 1, title: 'Oak', specification: '', quantity: null, unit: '', unitPrice: null, currency: null, priceImpact: '0', timeImpactDays: 0,
      afterLock: false, status: 'declined', confirmedAt: null, confirmedByName: null, changed: false, canDecide: false,
      alternatives: [{ id: 'a', title: 'Walnut', unit: '', unitPrice: null, currency: null, lineTotal: null, inStock: true, inBudget: true, fromPastJobs: false, canChoose: true }] },
  ] } })), 1, 'a declined choice with alternatives to pick still waits for the client');
});

test('states read like the web portal, and someone else\'s decision never says "Waiting for you"', () => {
  assert.deepEqual(stateLabel('client_review', true), { label: 'Waiting for you', tone: 'warning' });
  assert.deepEqual(stateLabel('client_review', false), { label: 'Waiting for a decision', tone: 'info' });
  assert.deepEqual(stateLabel('overdue'), { label: 'Overdue', tone: 'danger' });
  assert.deepEqual(stateLabel('something_new'), { label: 'Something new', tone: 'neutral' });
});

test('payments: what is owed comes first, and a part-paid row shows what is left', () => {
  const row = (id: string, status: PortalMilestone['status'], amount = '1000.00', left = amount): PortalMilestone => ({ id, title: id, amount, paid: null, left, dueDate: null, status,
    invoice: null, receipts: [], payUrl: null, report: null, canReport: false });
  assert.deepEqual(sortMilestones([row('a', 'paid'), row('b', 'upcoming'), row('c', 'overdue'), row('d', 'due')]).map((item) => item.id), ['c', 'd', 'b', 'a']);
  assert.deepEqual(milestoneAmount(row('p', 'part_paid', '1000.00', '400.00')), { amount: '400.00', left: true });
  assert.deepEqual(milestoneAmount(row('q', 'paid')), { amount: '1000.00', left: false });
});

test('push: nothing is registered without the client\'s yes; "not now" waits a week; off stays off', () => {
  const now = Date.parse('2026-10-06T10:00:00Z');
  assert.equal(clientPushStep({ supported: false, consent: 'yes', permission: 'granted' }), 'unavailable');
  assert.equal(clientPushStep({ supported: true, consent: null, permission: 'undetermined' }), 'ask');
  assert.equal(clientPushStep({ supported: true, consent: 'later', laterAt: now - 86_400_000, permission: 'undetermined', now }), 'wait');
  assert.equal(clientPushStep({ supported: true, consent: 'later', laterAt: now - 8 * 86_400_000, permission: 'undetermined', now }), 'ask');
  assert.equal(clientPushStep({ supported: true, consent: 'yes', permission: 'granted' }), 'register');
  assert.equal(clientPushStep({ supported: true, consent: 'yes', permission: 'denied' }), 'blocked');
  assert.equal(clientPushStep({ supported: true, consent: 'no', permission: 'granted' }), 'off', 'a phone that allows notifications still gets none after the client turned them off');
});

test('the firm\'s logo loads from the business core on the phone', () => {
  assert.equal(logoUrl('/api/auth/tenant-logo/atelier?v=9', BASE), `${BASE}/public/tenant-branding/atelier/logo`);
  assert.equal(logoUrl('https://cdn.example/logo.png', BASE), 'https://cdn.example/logo.png');
  assert.equal(logoUrl('http://insecure/logo.png', BASE), null);
  assert.equal(logoUrl(null, BASE), null);
});

test('devices: the phone is registered with consent, and turned off by its install id', async () => {
  const api = server({
    'client-portal/atelier/devices': () => ({ body: { registered: true, consentedAt: '2026-10-06T10:00:00Z', optedOutAt: null } }),
    'client-portal/atelier/devices/opt-out': () => ({ body: { registered: false, consentedAt: '2026-10-06T10:00:00Z', optedOutAt: '2026-10-06T11:00:00Z' } }),
  });
  const client = new PortalClient({ baseUrl: BASE, storage: memory(JSON.stringify({ slug: 'atelier', token: 't' })), fetch: api.fetcher, newId });
  await client.restore();
  await client.registerDevice({ requestId: 'r', installationId: 'i', platform: 'ios', token: 'ExponentPushToken[x]', locale: 'en', timezone: 'UTC' });
  assert.deepEqual((api.calls.find((call) => call.url.endsWith('/devices'))!.body as { consent: boolean }).consent, true);
  assert.equal((await client.optOutDevice('i')).registered, false);
});
