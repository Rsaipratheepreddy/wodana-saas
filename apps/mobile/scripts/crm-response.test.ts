import assert from 'node:assert/strict';
import test from 'node:test';
import { contactUrl, responseActivityBody } from '../src/crm/response';

test('builds safe contact links without claiming delivery', () => {
  assert.equal(contactUrl('phone', '+971 50 123 4567'), 'tel:+971501234567');
  assert.equal(contactUrl('whatsapp', '+971 50 123 4567'), 'https://wa.me/971501234567');
  assert.equal(contactUrl('email', 'operations@palmlivingae.com'), 'mailto:operations@palmlivingae.com');
  assert.equal(contactUrl('phone', '   '), '');
});

test('separates internal notes, scheduled work and completed outbound call evidence', () => {
  const base = { leadId: 'lead', partyId: 'party', ownerMembershipId: 'owner', text: 'Called about the villa', followUpAt: '2026-09-19T06:00:00.000Z' };
  assert.deepEqual(responseActivityBody({ ...base, kind: 'note' }), {
    leadId: 'lead', partyId: 'party', ownerMembershipId: 'owner', type: 'note',
    interactionDirection: 'internal', title: 'Internal note', description: 'Called about the villa',
    priority: 'normal', isNextAction: false,
  });
  assert.deepEqual(responseActivityBody({ ...base, kind: 'call' }), {
    leadId: 'lead', partyId: 'party', ownerMembershipId: 'owner', type: 'call',
    interactionDirection: 'outbound', title: 'Customer call', description: 'Called about the villa',
    priority: 'normal', isNextAction: false,
  });
  const followUp = responseActivityBody({ ...base, kind: 'follow_up' });
  assert.ok('dueAt' in followUp);
  assert.match(String(followUp.dueAt), /^2026-09-19/);
});
