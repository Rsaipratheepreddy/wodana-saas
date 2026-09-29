import { addDays, wallTimeToIso } from '../../core/format-core';
import { key } from '../../core/i18n';

/**
 * Sales on the phone, without native code (node tests import it): which enquiries are "My day", who may pick
 * a source, what a logged contact needs, and the new-enquiry command. The rules are the web's (S-30, LF-1,
 * PLM-042, S-16); the server still decides every request.
 */
export type LeadLike = {
  status: string; ownerMembershipId: string | null; isConverted?: boolean; nextActionAt: string | null;
  slaStatus?: string | null; slaDueAt?: string | null;
};

/** Enquiries still being worked (a paused one waits for its date). */
export const ACTIVE_LEAD_STATUSES: ReadonlySet<string> = new Set(['new', 'attempting_contact', 'connected', 'nurturing', 'paused']);
export const CLOSED_LEAD_STATUSES: ReadonlySet<string> = new Set(['qualified', 'disqualified', 'duplicate']);

/** When the first response is due, while its timer runs; never otherwise. */
export const respondBy = (lead: LeadLike) => (lead.slaDueAt && ['active', 'warning', 'breached'].includes(lead.slaStatus ?? '') ? Date.parse(lead.slaDueAt) : Number.POSITIVE_INFINITY);

/** The first instant after today in the workspace's zone: a follow-up before it is due today or overdue. */
export const endOfToday = (today: string, timeZone: string) => Date.parse(wallTimeToIso(addDays(today, 1), '00:00', timeZone));

/** My day (S-30): my own open enquiries that are new, waiting for a first response, or due today or earlier. */
export function isMyDay(lead: LeadLike, me: string, dayEnds: number) {
  if (lead.isConverted || lead.ownerMembershipId !== me || !ACTIVE_LEAD_STATUSES.has(lead.status) || lead.status === 'paused') return false;
  return lead.status === 'new' || Number.isFinite(respondBy(lead)) || (lead.nextActionAt !== null && Date.parse(lead.nextActionAt) < dayEnds);
}

/** Open enquiries nobody owns yet, for the people who give them out. */
export const isUnowned = (lead: LeadLike) => !lead.isConverted && ACTIVE_LEAD_STATUSES.has(lead.status) && lead.status !== 'paused' && !lead.ownerMembershipId;

/** The order people answer them in: respond-by first, then the follow-up that's due. */
export function byUrgency(a: LeadLike, b: LeadLike) {
  const due = (lead: LeadLike) => (lead.nextActionAt ? Date.parse(lead.nextActionAt) : Number.POSITIVE_INFINITY);
  const first = respondBy(a) - respondBy(b);
  if (first !== 0 && !Number.isNaN(first)) return first;
  const second = due(a) - due(b);
  return Number.isNaN(second) ? 0 : second;
}

export type ContactOutcome = 'no_answer' | 'message_sent_no_reply' | 'willing_to_talk' | 'come_back_later' | 'not_interested' | 'unreachable';
export type ContactChannel = 'call' | 'whatsapp' | 'email' | 'meeting' | 'sms';
export const CONTACT_OUTCOMES: Array<{ value: ContactOutcome; label: string }> = [
  { value: 'no_answer', label: key('No answer') }, { value: 'message_sent_no_reply', label: key('Message sent, no reply') },
  { value: 'willing_to_talk', label: key('Willing to talk') }, { value: 'come_back_later', label: key('Come back later') },
  { value: 'not_interested', label: key('Not interested') }, { value: 'unreachable', label: key('Unreachable') },
];
export const CONTACT_CHANNELS: Array<{ value: ContactChannel; label: string }> = [
  { value: 'call', label: key('Call') }, { value: 'whatsapp', label: key('WhatsApp') }, { value: 'email', label: key('Email') },
  { value: 'meeting', label: key('Meeting') }, { value: 'sms', label: key('SMS') },
];
/** Tries that reached nobody: the note is optional (the server notes the attempt). */
export const UNANSWERED: ReadonlySet<ContactOutcome> = new Set(['no_answer', 'message_sent_no_reply', 'unreachable']);

/** What a logged contact needs: a note unless nobody answered, a reason when not interested, a future date to come back. */
export function contactRules(outcome: ContactOutcome | null) {
  const closes = outcome === 'not_interested' || outcome === 'unreachable';
  return {
    noteRequired: !!outcome && !UNANSWERED.has(outcome),
    reasonRequired: outcome === 'not_interested',
    followUp: !!outcome && !closes,
    followUpRequired: outcome === 'come_back_later',
  };
}

export function contactProblem(input: { outcome: ContactOutcome | null; note: string; reason: string; nextAt: string | null }, now = Date.now()) {
  const rules = contactRules(input.outcome);
  if (!input.outcome) return key('Choose the outcome of this contact.');
  if (rules.noteRequired && !input.note.trim()) return key('Add a note about this contact.');
  if (rules.reasonRequired && !input.reason.trim()) return key('Add the reason the client is not interested.');
  if (rules.followUpRequired && (!input.nextAt || Date.parse(input.nextAt) <= now)) return key('Book a follow-up date in the future.');
  return null;
}

/** Quick picks for the next try: in two hours, tomorrow morning, in three days (the workspace's clock). */
export function quickFollowUps(now: Date, today: string, timeZone: string) {
  const morning = (day: string) => wallTimeToIso(day, '10:00', timeZone);
  return [
    { id: 'two_hours' as const, at: new Date(Math.ceil((now.getTime() + 2 * 3_600_000) / 900_000) * 900_000).toISOString() },
    { id: 'tomorrow' as const, at: morning(addDays(today, 1)) },
    { id: 'three_days' as const, at: morning(addDays(today, 3)) },
  ];
}

export type LeadOption = { id: string; label: string; allowedRoles?: string[] };
export type LeadOptions = {
  sources: LeadOption[]; channels: Record<string, LeadOption[]>; enquiryTypes: LeadOption[]; budgetRanges: LeadOption[];
  customerTypes: LeadOption[]; emirates: LeadOption[]; areas: Record<string, LeadOption[]>;
  referralBrokers?: LeadOption[]; referralPartners?: LeadOption[]; roleKeys?: string[];
};

/** The source a known client gets from the system; nobody picks it by hand. */
export const RETURNING_SOURCE = 'returning_customer';
export const REFERRAL_SOURCE = 'referral';

/** A source limited to roles is offered only to people holding one of them (a role or its team; owners and administrators always). */
export function sourceAllowed(source: LeadOption, roleKeys: readonly string[]) {
  if (!source.allowedRoles?.length) return true;
  const held = new Set<string>();
  for (const code of roleKeys) {
    const value = code.trim().toLowerCase();
    if (!value) continue;
    held.add(value);
    held.add(value.startsWith('team_') ? value.slice(5) : `team_${value}`);
  }
  if (held.has('owner') || held.has('administrator')) return true;
  return source.allowedRoles.some((role) => held.has(role.trim().toLowerCase()));
}

export type ReferralKind = 'external' | 'internal' | 'broker' | 'partner';
/** Who referred a referral enquiry, by channel: an outside person, a team member, or a broker or partner from their list. */
export const referralKind = (source: string, channel: string): ReferralKind | null =>
  source !== REFERRAL_SOURCE || !channel ? null : channel === 'internal' || channel === 'broker' || channel === 'partner' ? channel : 'external';

/** The country of a BCP 47 locale ("en-AE" → "AE"), for numbers typed without their code. */
export function regionOf(locale: string | null | undefined) {
  const match = /^[a-z]{2,3}(?:[-_][a-z]{4})?[-_]([a-z]{2}|\d{3})(?:$|[-_])/i.exec(locale ?? '');
  return match ? match[1].toUpperCase() : null;
}

/** What to ask the server while a mobile or email is typed; null until there's something worth checking. */
export function contactQuery(mobile: string, email: string, region: string | null) {
  const digits = mobile.replace(/[^\d]/g, '');
  const number = digits.length >= 7 ? mobile.trim() : '';
  const address = /^\S+@\S+\.\S+$/.test(email.trim()) ? email.trim() : '';
  if (!number && !address) return null;
  return {
    ...(number ? { mobile: number, ...(number.startsWith('+') || !region ? {} : { countryCode: region }) } : {}),
    ...(address ? { email: address } : {}),
  };
}

export type ClientMatch = {
  partyId: string; name: string; mobile: string | null; email: string | null; leadId: string | null; reference: string | null;
  status: string | null; receivedAt: string | null; open: boolean; ownerName: string | null;
};
export type Identity = { kind: 'existing'; partyId: string; name: string } | { kind: 'new' } | null;
export type Owner = 'me' | 'routing' | 'unassigned' | { membershipId: string };

export type EnquiryForm = {
  name: string; mobile: string; email: string; region: string; area: string; serviceType: string; source: string; channel: string;
  customerType: string; summary: string; referral: { name: string; contact: string; membershipId: string; option: string };
};

/** Why the enquiry can't be saved yet, as a label key; null when it can. */
export function enquiryProblem(form: EnquiryForm, input: { matches: number; identity: Identity; regions: boolean; customerTypes: boolean; owner: Owner | null }) {
  if (input.matches && !input.identity) return key('Choose the existing client or Different person.');
  if (!form.mobile.trim()) return key('Enter a mobile number.');
  if (!(input.identity?.kind === 'existing' ? input.identity.name : form.name).trim()) return key('Enter a customer name.');
  if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return key('Enter a valid email address.');
  if (input.regions && !form.region) return key('Choose the region.');
  if (!form.serviceType) return key('Choose the enquiry type.');
  if (!form.source) return key('Choose where this enquiry came from.');
  if (!form.channel) return key('Choose the channel for this source.');
  const kind = referralKind(form.source, form.channel);
  if (kind === 'external' && !form.referral.name.trim()) return key('Add who referred this client.');
  if (kind === 'internal' && !form.referral.membershipId) return key('Add who referred this client.');
  if ((kind === 'broker' || kind === 'partner') && !form.referral.option) return key('Add who referred this client.');
  if (input.customerTypes && !form.customerType) return key('Choose the client type.');
  if (!input.owner) return key('Choose an owner, routing, or leave unassigned.');
  return null;
}

/** The intake command's body (`POST crm/intake-events`), the same one the web's New enquiry sends. */
export function intakeBody(form: EnquiryForm, input: { identity: Identity; owner: Owner; me: string; countryCode: string | null }) {
  const kind = referralKind(form.source, form.channel);
  const mobile = form.mobile.trim();
  const name = input.identity?.kind === 'existing' ? input.identity.name : form.name.trim();
  const assignment = input.owner === 'routing' ? { mode: 'automatic' } : input.owner === 'unassigned' ? { mode: 'unassigned' }
    : { mode: 'manual', ownerMembershipId: input.owner === 'me' ? input.me : input.owner.membershipId };
  return {
    source: form.source, channel: form.channel, intakeMethod: 'manual',
    party: {
      displayName: name.slice(0, 240), mobile,
      ...(input.countryCode && !mobile.startsWith('+') ? { mobileCountryCode: input.countryCode } : {}),
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
    },
    title: '', serviceType: form.serviceType,
    ...(form.summary.trim() ? { summary: form.summary.trim().slice(0, 10_000) } : {}),
    details: { emirate: form.region, ...(form.area.trim() ? { area: form.area.trim().slice(0, 240) } : {}), ...(form.customerType ? { customerType: form.customerType } : {}) },
    assignment,
    ...(kind === 'external' ? { referral: { name: form.referral.name.trim(), ...(form.referral.contact.trim() ? { contact: form.referral.contact.trim() } : {}) } }
      : kind === 'internal' ? { referral: { membershipId: form.referral.membershipId } }
        : kind ? { referral: { option: form.referral.option } } : {}),
    ...(input.identity?.kind === 'existing' ? { identity: 'existing', partyId: input.identity.partyId } : input.identity?.kind === 'new' ? { identity: 'new' } : {}),
    originalPayload: { origin: 'wodana_mobile' },
  };
}
