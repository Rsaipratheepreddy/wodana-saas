import { key } from '../core/i18n';
import type { PortalChoice, PortalDigest, PortalFeedCard, PortalFeedKind, PortalMilestone, PortalProject, PortalStep } from './types';

/**
 * What the client app shows, worked out from the portal's read model the same way the web portal does (apps/web/
 * components/client-portal): the words for states and steps, what is waiting for the client and where each thing opens.
 * Pure, so it is tested in node; labels are the web's English keys.
 */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const STATES: Record<string, [string, Tone]> = {
  issued: [key('Waiting for you'), 'warning'], client_review: [key('Waiting for you'), 'warning'], sent: [key('Waiting for you'), 'warning'],
  awaiting_confirmation: [key('Waiting for you'), 'warning'], awaiting_decision: [key('Waiting for you'), 'warning'],
  accepted: [key('Accepted'), 'success'], approved: [key('Approved'), 'success'], signed_off: [key('Signed off'), 'success'], confirmed: [key('Confirmed'), 'success'],
  changes_requested: [key('Changes asked'), 'info'], declined: [key('Declined'), 'neutral'], rejected: [key('Declined'), 'neutral'], refused: [key('Not accepted'), 'info'],
  expired: [key('Expired'), 'neutral'], superseded: [key('Replaced'), 'neutral'], withdrawn: [key('Withdrawn'), 'neutral'],
  paid: [key('Paid'), 'success'], part_paid: [key('Part paid'), 'info'], due: [key('Due'), 'warning'], overdue: [key('Overdue'), 'danger'], upcoming: [key('Upcoming'), 'neutral'],
  credited: [key('Cancelled'), 'neutral'], received: [key('Received'), 'success'], checking: [key('Being checked'), 'info'],
  open: [key('Open'), 'info'], under_review: [key('With the team'), 'info'], resolved: [key('Done'), 'success'],
  covered: [key('Covered'), 'success'], not_covered: [key('Not covered'), 'neutral'], chargeable: [key('Chargeable'), 'warning'],
  done: [key('Done'), 'success'], current: [key('Now'), 'info'],
  waiting: [key('Waiting for you'), 'warning'], with_team: [key('With the team'), 'info'], changed: [key('Changed'), 'warning'], presented: [key('Waiting for you'), 'warning'],
  chosen: [key('Chosen'), 'success'], proposed: [key('Waiting for you'), 'warning'],
};
const WAITING = new Set(['issued', 'client_review', 'sent', 'awaiting_confirmation', 'awaiting_decision', 'waiting', 'presented', 'proposed']);

/**
 * A one-word state and its tone. Something still waiting that this person can't decide is someone else's decision
 * (the named decision-maker), so it doesn't say "Waiting for you" to them.
 */
export function stateLabel(state: string, canDecide?: boolean): { label: string; tone: Tone } {
  if (canDecide === false && WAITING.has(state)) return { label: key('Waiting for a decision'), tone: 'info' };
  const known = STATES[state];
  return known ? { label: known[0], tone: known[1] } : { label: state.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase()), tone: 'neutral' };
}

export const STEP_TITLES: Record<PortalStep['kind'], string> = {
  quote: key('Quotation to decide'), design: key('Design to review'), definition: key('Requirements to confirm'), materials: key('Material list to sign off'),
  handover: key('Handover to accept'), request: key('Question to answer'), invoice: key('Invoice to pay'), site_access: key('Confirm site access'),
  change: key('Change to approve'), presentation: key('Concepts to choose from'), choice: key('Choice to make'),
};

export const FEED_KINDS: Record<PortalFeedKind, string> = {
  day: key('Day on site'), update: key('Update'), design: key('Design shared'), presentation: key('Concepts to choose'), document: key('Document'), quote: key('Quotation'),
  change: key('Change request'), invoice: key('Invoice'), payment: key('Payment received'), reply: key('Reply from your team'), handover: key('Handover'), choice: key('Choice changed'),
};

const DIGEST_ONE: Record<PortalFeedKind, string> = {
  day: key('1 day on site'), update: key('1 update'), design: key('1 design shared'), presentation: key('1 set of concepts to choose'), document: key('1 document'), quote: key('1 quotation'),
  change: key('1 change request'), invoice: key('1 invoice'), payment: key('1 payment received'), reply: key('1 reply from your team'), handover: key('1 handover pack'), choice: key('1 choice changed'),
};
const DIGEST_MANY: Record<PortalFeedKind, string> = {
  day: key('{count} days on site'), update: key('{count} updates'), design: key('{count} designs shared'), presentation: key('{count} concepts to choose'), document: key('{count} documents'),
  quote: key('{count} quotations'), change: key('{count} change requests'), invoice: key('{count} invoices'), payment: key('{count} payments received'),
  reply: key('{count} replies from your team'), handover: key('{count} handover packs'), choice: key('{count} choices changed'),
};

/** "What changed since you last looked" (AI2) as lines: the count by kind (a label key and its count) and the first names. */
export function digestLines(digest: PortalDigest | null | undefined) {
  return (digest?.items ?? []).filter((item) => item.count > 0).map((item) => ({
    kind: item.kind, label: item.count === 1 ? DIGEST_ONE[item.kind] : DIGEST_MANY[item.kind], count: item.count, titles: item.titles,
  }));
}

/** Where something opens in the app: one of its tabs, a screen with the record, or the web portal for what the app doesn't decide. */
export type ClientTarget =
  | { tab: 'index' | 'design' | 'payments' | 'messages' }
  | { screen: 'changes' | 'documents' | 'warranty'; id?: string }
  | { screen: 'thread'; id: string }
  | { screen: 'question'; id: string }
  | { web: true };

/** Where a step that waits for the client is done. */
export function stepTarget(step: PortalStep): ClientTarget {
  switch (step.kind) {
    case 'invoice': return { tab: 'payments' };
    case 'design': case 'presentation': case 'choice': return { tab: 'design' };
    case 'change': return { screen: 'changes', id: step.id };
    case 'request': return { screen: 'question', id: step.id };
    // Quotations, the requirements, the material list, handovers and site access are decided in the web portal.
    default: return { web: true };
  }
}

/** Where a feed card opens: its decision or conversation, or its section. */
export function feedTarget(card: PortalFeedCard): ClientTarget {
  switch (card.kind) {
    case 'design': case 'presentation': case 'choice': return { tab: 'design' };
    case 'change': return { screen: 'changes', id: card.id };
    case 'reply': return { screen: 'thread', id: card.id };
    case 'document': return { screen: 'documents' };
    case 'invoice': case 'payment': return { tab: 'payments' };
    case 'quote': case 'handover': return { web: true };
    default: return { tab: 'index' };
  }
}

export type WaitingItem = { id: string; title: string; detail: string; due: string | null; target: ClientTarget; reply?: boolean };

/**
 * "Waiting for you": every step the team is waiting on (with its due date), then each conversation with a reply the
 * client hasn't read. A step without a section on this project isn't listed.
 */
export function waitingFor(project: PortalProject): WaitingItem[] {
  const steps = project.next.map((step): WaitingItem => ({
    id: `${step.kind}-${step.id}`, title: step.kind === 'site_access' ? key('Confirm site access for {date}') : STEP_TITLES[step.kind], detail: step.title, due: step.due,
    target: stepTarget(step),
  }));
  const replies = (project.messages?.requests ?? []).filter((request) => request.unread > 0).map((request): WaitingItem => ({
    id: `reply-${request.id}`, title: key('New reply from your team'), detail: request.title, due: null, target: { screen: 'thread', id: request.id }, reply: true,
  }));
  return [...steps, ...replies];
}

/** The feed under "Latest", without the day already shown above it. */
export function feedFor(project: PortalProject) {
  const latestDay = project.progress?.cards?.[0]?.id ?? null;
  return (project.feed ?? []).filter((card) => !(latestDay && card.kind === 'day' && card.id === latestDay));
}

/** A choice still waits for the client while they can decide it or pick one of its alternatives (R2). */
export const choicePending = (choice: PortalChoice) => choice.canDecide || Boolean(choice.alternatives?.some((alternative) => alternative.canChoose));

/** The design tab's count: concepts to choose, choices to confirm and designs to review. */
export function designWaiting(project: PortalProject) {
  const presentations = project.choices?.presentations.filter((item) => item.canDecide).length ?? 0;
  const choices = project.choices?.choices.filter(choicePending).length ?? 0;
  const designs = project.decisions?.designs.filter((item) => item.canDecide).length ?? 0;
  return presentations + choices + designs;
}

/** How far the project is, in percent: the team's own measure when shown, else the stages done. */
export function percentOf(project: PortalProject) {
  if (typeof project.progress?.percent === 'number') return project.progress.percent;
  if (project.status === 'completed') return 100;
  if (!project.stage) return null;
  return Math.round(((project.stage.number - 1) / project.stage.total) * 100);
}

/** The amount a payment row shows: the whole amount, or what's left when part is paid. */
export function milestoneAmount(milestone: PortalMilestone): { amount: string | null; left: boolean } {
  if (!milestone.amount) return { amount: null, left: false };
  if (['paid', 'upcoming'].includes(milestone.status) || milestone.left === milestone.amount) return { amount: milestone.amount, left: false };
  return { amount: milestone.left, left: true };
}

/** Payments the client still owes come first (overdue, then due, part paid, being checked), then the rest in order. */
export function sortMilestones(milestones: PortalMilestone[]) {
  const rank: Record<PortalMilestone['status'], number> = { overdue: 0, due: 1, part_paid: 2, checking: 3, upcoming: 4, received: 5, paid: 6 };
  return milestones.map((milestone, index) => ({ milestone, index }))
    .sort((a, b) => rank[a.milestone.status] - rank[b.milestone.status] || a.index - b.index).map(({ milestone }) => milestone);
}

const AMOUNT = /^\d{1,14}([.,]\d{1,4})?$/;
export type PaymentReport = { paidOn: string | null; amount: string; reference: string; photos: number; uploading: boolean };

/**
 * "I've paid" can be sent with a date that isn't in the future, an amount written as a number (or none), and a bank
 * reference or a photo of the receipt, once every photo is up. Returns the first problem as a label key, or null.
 */
export function paymentProblem(report: PaymentReport, today: string): string | null {
  if (!report.paidOn) return key('Enter the date you paid.');
  if (report.paidOn > today) return key('The payment date can\'t be in the future.');
  const amount = report.amount.trim().replace(',', '.');
  if (amount && !AMOUNT.test(amount)) return key('Enter the amount you paid.');
  if (!report.reference.trim() && !report.photos) return key('Add the bank reference or a photo of the receipt.');
  if (report.uploading) return key('Adding…');
  return null;
}

/** The amount as the server reads it (a dot for decimals), or undefined when left empty. */
export const cleanAmount = (value: string) => value.trim().replace(',', '.') || undefined;

/** A signed amount for a change: "+1,200.00" or "-300.00" (the minus comes from the formatted value). */
export const signed = (value: string | null, money: (value: string) => string) => (value === null ? '' : `${value.startsWith('-') ? '' : '+'}${money(value)}`);

/** The decision code's purpose: bound to exactly this record and choice (the server checks it). */
export const decisionPurpose = (kind: 'design' | 'change', caseId: string, id: string, decision: string) => `${kind}:${caseId}:${id}:${decision}`;

/**
 * The firm's logo as the phone loads it: the portal gives the web's logo route (`/api/auth/tenant-logo/{name}`), which
 * the business core serves at `/public/tenant-branding/{name}/logo`; an https logo is used as is.
 */
export function logoUrl(value: string | null | undefined, apiBase: string) {
  if (!value) return null;
  const route = /^\/api\/auth\/tenant-logo\/([^/?#]+)/.exec(value);
  if (route) return `${apiBase.replace(/\/+$/, '')}/public/tenant-branding/${route[1]}/logo`;
  return /^https:\/\//.test(value) ? value : null;
}

/**
 * The client's push consent on this phone: never asked (`null`), said yes, or said no (turned off). The app asks in
 * its own words first and only then shows the phone's prompt; nothing is registered without a yes, and a no is kept.
 */
export type PushConsent = 'yes' | 'no' | 'later' | null;
export type PushPermission = 'undetermined' | 'denied' | 'granted' | 'provisional' | 'ephemeral';
export type ClientPushStep = 'unavailable' | 'ask' | 'register' | 'blocked' | 'off' | 'wait';

export function clientPushStep(input: { supported: boolean; consent: PushConsent; laterAt?: number | null; permission: PushPermission | null; now?: number }): ClientPushStep {
  if (!input.supported) return 'unavailable';
  if (input.consent === 'no') return 'off';
  if (input.consent === 'yes') {
    if (input.permission === 'denied') return 'blocked';
    return 'register';
  }
  // "Not now" waits a week before the app asks again.
  if (input.consent === 'later' && input.laterAt && (input.now ?? Date.now()) - input.laterAt < 7 * 86_400_000) return 'wait';
  return 'ask';
}
