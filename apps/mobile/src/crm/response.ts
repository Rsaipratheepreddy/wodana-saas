export type ContactKind = 'phone' | 'email' | 'whatsapp';
export type ResponseAction = 'follow_up' | 'note' | 'call';

export function contactUrl(kind: ContactKind, value: string) {
  const clean = value.trim();
  if (!clean) return '';
  if (kind === 'email') return `mailto:${clean}`;
  const phone = clean.replace(/[^\d+*#,;]/g, '');
  if (!phone) return '';
  if (kind === 'whatsapp') {
    const digits = phone.replace(/\D/g, '');
    return digits ? `https://wa.me/${digits}` : '';
  }
  return `tel:${phone}`;
}

export function responseActivityBody(input: {
  kind: ResponseAction;
  leadId: string;
  partyId?: string;
  ownerMembershipId?: string;
  text: string;
  followUpAt: string;
}) {
  const target = {
    leadId: input.leadId,
    ...(input.partyId ? { partyId: input.partyId } : {}),
    ...(input.ownerMembershipId ? { ownerMembershipId: input.ownerMembershipId } : {}),
  };
  if (input.kind === 'note') return {
    ...target, type: 'note', interactionDirection: 'internal', title: 'Internal note',
    description: input.text.trim(), priority: 'normal', isNextAction: false,
  };
  if (input.kind === 'call') return {
    ...target, type: 'call', interactionDirection: 'outbound', title: 'Customer call',
    description: input.text.trim(), priority: 'normal', isNextAction: false,
  };
  return {
    ...target, type: 'task', title: input.text.trim(), priority: 'normal',
    dueAt: input.followUpAt, isNextAction: true,
  };
}
