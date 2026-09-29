import assert from 'node:assert/strict';
import test from 'node:test';
import {
  byUrgency, contactProblem, contactQuery, contactRules, endOfToday, enquiryProblem, intakeBody, isMyDay, isUnowned, quickFollowUps, referralKind, regionOf, sourceAllowed,
  type EnquiryForm,
} from '../src/features/sales/model';

const me = 'member-1';
const lead = (overrides: Partial<Parameters<typeof isMyDay>[0]> = {}) => ({ status: 'attempting_contact', ownerMembershipId: me, isConverted: false, nextActionAt: null, slaStatus: null, slaDueAt: null, ...overrides });

test('My day holds my new enquiries, those waiting for a first response, and follow-ups due by the end of today (S-30)', () => {
  const dayEnds = endOfToday('2026-09-29', 'Asia/Dubai');
  assert.equal(new Date(dayEnds).toISOString(), '2026-09-29T20:00:00.000Z');
  assert.equal(isMyDay(lead({ status: 'new' }), me, dayEnds), true);
  assert.equal(isMyDay(lead({ slaStatus: 'warning', slaDueAt: '2026-09-30T08:00:00Z' }), me, dayEnds), true);
  assert.equal(isMyDay(lead({ nextActionAt: '2026-09-29T19:59:00Z' }), me, dayEnds), true);
  assert.equal(isMyDay(lead({ nextActionAt: '2026-09-28T08:00:00Z' }), me, dayEnds), true, 'overdue');
  assert.equal(isMyDay(lead({ nextActionAt: '2026-09-29T20:00:00Z' }), me, dayEnds), false, 'tomorrow in Dubai');
  assert.equal(isMyDay(lead({ status: 'new', ownerMembershipId: 'someone-else' }), me, dayEnds), false);
  assert.equal(isMyDay(lead({ status: 'paused', nextActionAt: '2026-09-28T08:00:00Z' }), me, dayEnds), false);
  assert.equal(isMyDay(lead({ status: 'qualified', nextActionAt: '2026-09-28T08:00:00Z' }), me, dayEnds), false);
  assert.equal(isMyDay(lead({ status: 'new', isConverted: true }), me, dayEnds), false);
  // A timer that has stopped (met) no longer counts.
  assert.equal(isMyDay(lead({ slaStatus: 'met', slaDueAt: '2026-09-28T08:00:00Z' }), me, dayEnds), false);
});

test('unowned open enquiries are for whoever gives them out; the most urgent come first', () => {
  assert.equal(isUnowned(lead({ ownerMembershipId: null, status: 'new' })), true);
  assert.equal(isUnowned(lead({ ownerMembershipId: null, status: 'paused' })), false);
  assert.equal(isUnowned(lead({ ownerMembershipId: null, status: 'disqualified' })), false);
  assert.equal(isUnowned(lead({ ownerMembershipId: me })), false);
  const late = lead({ slaStatus: 'breached', slaDueAt: '2026-09-29T06:00:00Z' });
  const soon = lead({ slaStatus: 'active', slaDueAt: '2026-09-29T09:00:00Z' });
  const due = lead({ nextActionAt: '2026-09-29T07:00:00Z' });
  const later = lead({ nextActionAt: '2026-09-30T07:00:00Z' });
  assert.deepEqual([later, due, soon, late].sort(byUrgency), [late, soon, due, later]);
});

test('a logged contact needs a note unless nobody answered, a reason when not interested, and a future date to come back', () => {
  assert.deepEqual(contactRules('no_answer'), { noteRequired: false, reasonRequired: false, followUp: true, followUpRequired: false });
  assert.deepEqual(contactRules('unreachable'), { noteRequired: false, reasonRequired: false, followUp: false, followUpRequired: false });
  assert.deepEqual(contactRules('not_interested'), { noteRequired: true, reasonRequired: true, followUp: false, followUpRequired: false });
  assert.deepEqual(contactRules('come_back_later'), { noteRequired: true, reasonRequired: false, followUp: true, followUpRequired: true });
  const now = Date.parse('2026-09-29T08:00:00Z');
  assert.equal(contactProblem({ outcome: null, note: '', reason: '', nextAt: null }, now), 'Choose the outcome of this contact.');
  assert.equal(contactProblem({ outcome: 'no_answer', note: '', reason: '', nextAt: null }, now), null);
  assert.equal(contactProblem({ outcome: 'unreachable', note: '', reason: '', nextAt: null }, now), null);
  assert.equal(contactProblem({ outcome: 'willing_to_talk', note: ' ', reason: '', nextAt: null }, now), 'Add a note about this contact.');
  assert.equal(contactProblem({ outcome: 'not_interested', note: 'Too pricey', reason: '', nextAt: null }, now), 'Add the reason the client is not interested.');
  assert.equal(contactProblem({ outcome: 'come_back_later', note: 'Travelling', reason: '', nextAt: '2026-09-29T07:00:00Z' }, now), 'Book a follow-up date in the future.');
  assert.equal(contactProblem({ outcome: 'come_back_later', note: 'Travelling', reason: '', nextAt: '2026-10-02T06:00:00Z' }, now), null);
  assert.equal(contactProblem({ outcome: 'come_back_later', note: 'Travelling', reason: '', nextAt: null }, now), 'Book a follow-up date in the future.');
  // Any next try in the past would be overdue at once.
  assert.equal(contactProblem({ outcome: 'no_answer', note: '', reason: '', nextAt: '2026-09-29T07:59:00Z' }, now), 'Book a follow-up date in the future.');
  assert.equal(contactProblem({ outcome: 'no_answer', note: '', reason: '', nextAt: '2026-09-29T10:00:00Z' }, now), null);
});

test('the next try is in two hours, tomorrow morning or in three days, on the workspace clock', () => {
  const picks = quickFollowUps(new Date('2026-09-29T08:07:00Z'), '2026-09-29', 'Asia/Kolkata');
  assert.deepEqual(picks.map((pick) => pick.id), ['two_hours', 'tomorrow', 'three_days']);
  assert.equal(picks[0].at, '2026-09-29T10:15:00.000Z');
  assert.equal(picks[1].at, '2026-09-30T04:30:00.000Z');
  assert.equal(picks[2].at, '2026-10-02T04:30:00.000Z');
});

test('a source limited to roles is offered to its roles and their teams, and always to owners', () => {
  const self = { id: 'self_generated', label: 'Self Generated', allowedRoles: ['Sales'] };
  assert.equal(sourceAllowed({ id: 'company', label: 'Company' }, []), true);
  assert.equal(sourceAllowed(self, ['team_sales']), true);
  assert.equal(sourceAllowed(self, ['sales']), true);
  assert.equal(sourceAllowed(self, ['designer']), false);
  assert.equal(sourceAllowed(self, ['owner']), true);
});

test('who referred an enquiry follows its channel', () => {
  assert.equal(referralKind('company', 'website'), null);
  assert.equal(referralKind('referral', ''), null);
  assert.equal(referralKind('referral', 'friend'), 'external');
  assert.equal(referralKind('referral', 'internal'), 'internal');
  assert.equal(referralKind('referral', 'broker'), 'broker');
});

test('a number typed without its code is read in the workspace\'s country; nothing is guessed from a constant', () => {
  assert.equal(regionOf('en-AE'), 'AE');
  assert.equal(regionOf('ar_SA'), 'SA');
  assert.equal(regionOf('zh-Hant-TW'), 'TW');
  assert.equal(regionOf('en'), null);
  assert.equal(regionOf(null), null);
  assert.deepEqual(contactQuery('050 123 4567', '', 'AE'), { mobile: '050 123 4567', countryCode: 'AE' });
  assert.deepEqual(contactQuery('+44 7700 900123', 'maya@', 'AE'), { mobile: '+44 7700 900123' });
  assert.deepEqual(contactQuery('0501', 'maya@example.com', 'AE'), { email: 'maya@example.com' });
  assert.equal(contactQuery('05', '', 'AE'), null);
});

const form: EnquiryForm = { name: 'Maya', mobile: '0501234567', email: '', region: 'dubai', area: 'Marina', serviceType: 'kitchen', source: 'company', channel: 'website',
  customerType: '', summary: ' A new kitchen ', referral: { name: '', contact: '', membershipId: '', option: '' } };

test('a new enquiry asks for what the workspace requires, and for a choice when the client may already exist (LF-1)', () => {
  const base = { matches: 0, identity: null, regions: true, customerTypes: false, owner: 'me' as const };
  assert.equal(enquiryProblem(form, base), null);
  assert.equal(enquiryProblem(form, { ...base, matches: 1 }), 'Choose the existing client or Different person.');
  assert.equal(enquiryProblem({ ...form, name: '' }, { ...base, matches: 1, identity: { kind: 'existing', partyId: 'p', name: 'Maya K' } }), null);
  assert.equal(enquiryProblem({ ...form, mobile: ' ' }, base), 'Enter a mobile number.');
  assert.equal(enquiryProblem({ ...form, region: '' }, base), 'Choose the region.');
  assert.equal(enquiryProblem({ ...form, region: '' }, { ...base, regions: false }), null);
  assert.equal(enquiryProblem({ ...form, source: 'referral', channel: 'friend' }, base), 'Add who referred this client.');
  assert.equal(enquiryProblem(form, { ...base, customerTypes: true }), 'Choose the client type.');
  assert.equal(enquiryProblem(form, { ...base, owner: null }), 'Choose an owner, routing, or leave unassigned.');
});

test('the intake command carries the client, the answer to "existing client?", and the owner', () => {
  const mine = intakeBody(form, { identity: null, owner: 'me', me, countryCode: 'AE' });
  assert.deepEqual(mine.party, { displayName: 'Maya', mobile: '0501234567', mobileCountryCode: 'AE' });
  assert.deepEqual(mine.assignment, { mode: 'manual', ownerMembershipId: me });
  assert.deepEqual(mine.details, { emirate: 'dubai', area: 'Marina' });
  assert.equal(mine.summary, 'A new kitchen');
  assert.equal(mine.intakeMethod, 'manual');
  assert.equal('identity' in mine, false);
  const existing = intakeBody({ ...form, mobile: '+971501234567', source: 'referral', channel: 'friend', referral: { name: 'Omar', contact: '', membershipId: '', option: '' } },
    { identity: { kind: 'existing', partyId: 'party-1', name: 'Maya K' }, owner: 'routing', me, countryCode: 'AE' });
  assert.deepEqual(existing.party, { displayName: 'Maya K', mobile: '+971501234567' });
  assert.deepEqual(existing.assignment, { mode: 'automatic' });
  assert.deepEqual((existing as { referral?: unknown }).referral, { name: 'Omar' });
  assert.equal((existing as { identity?: string }).identity, 'existing');
  assert.equal((existing as { partyId?: string }).partyId, 'party-1');
  assert.deepEqual(intakeBody(form, { identity: { kind: 'new' }, owner: { membershipId: 'member-2' }, me, countryCode: null }).assignment, { mode: 'manual', ownerMembershipId: 'member-2' });
  assert.deepEqual(intakeBody(form, { identity: null, owner: 'unassigned', me, countryCode: null }).assignment, { mode: 'unassigned' });
});
