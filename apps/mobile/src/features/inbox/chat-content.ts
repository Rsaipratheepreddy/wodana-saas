/**
 * What a chat message carries besides its text, and the WhatsApp templates a reply can use, as the web inbox reads them
 * (apps/web/lib/crm/inbox.ts): files kept in the workspace's storage, the template a message was sent from, and a
 * template's values from its mapping and the chat's records.
 */
export type ChatAttachment = {
  id: string; kind: 'image' | 'document' | 'audio' | 'video' | 'sticker'; mimeType: string | null; fileName: string | null;
  byteSize: number | null; status: 'pending' | 'stored' | 'failed'; failureCode: string | null;
};

export type ChatTemplate = {
  id: string; code: string; locale: string; body: string; positions: number[]; usable: boolean;
  variables: Array<{ position: number; source: string }>;
  approved?: boolean; providerStatus?: string | null;
};

type Message = { bodyText: string | null; metadata?: Record<string, unknown> | null; attachment?: ChatAttachment | null };

/** Where a chat file is read from (workspace-relative; the server checks the person may read the chat). */
export const attachmentPath = (chatId: string, attachmentId: string) => `crm/conversations/${chatId}/attachments/${attachmentId}`;

/** The template a message went out as, by its code, or null. */
export function templateOf(message: Pick<Message, 'metadata'>): string | null {
  const template = message.metadata && typeof message.metadata === 'object' ? (message.metadata as Record<string, unknown>).template : null;
  const code = template && typeof template === 'object' ? (template as Record<string, unknown>).code : null;
  return typeof code === 'string' && code ? code : null;
}

/** The provider's "Image received" (or the file's own name) isn't repeated under the file. */
export function captionOf(message: Message): string | null {
  const text = (message.bodyText ?? '').trim();
  const fileName = message.attachment?.fileName ?? (typeof message.metadata?.fileName === 'string' ? message.metadata.fileName : null);
  if (!message.attachment && !(typeof message.metadata?.messageType === 'string' && message.metadata.messageType !== 'text')) return text || null;
  return !text || text === fileName || /^(Image|Video|Document|Audio|Sticker) received$/.test(text) ? null : text;
}

/** Whether a message shows anything: text, a file, a template or that it was hidden. */
export const hasContent = (message: Message & { hiddenAt: string | null }) => Boolean(message.bodyText || message.hiddenAt || message.attachment || templateOf(message));

/** A template the team can send now: numbered 1, 2, 3… and approved here and at Meta. */
export const sendableTemplate = (template: ChatTemplate) => template.usable && template.approved !== false && (template.providerStatus ?? 'approved') === 'approved';

/** A template's values from its mapping and the chat's records; `missing` names each position without one. */
export function fillTemplate(template: Pick<ChatTemplate, 'positions' | 'variables'>, values: Record<string, string | null | undefined>) {
  const parameters: string[] = [];
  const missing: Array<{ position: number; source: string | null }> = [];
  for (const position of template.positions) {
    const source = template.variables.find((variable) => variable.position === position)?.source ?? null;
    const value = source ? values[source]?.trim() : '';
    if (!value) missing.push({ position, source });
    parameters.push(value ?? '');
  }
  return { parameters, missing };
}

/** The template's text with its values in place; a value still missing shows as its {{n}}. */
export const renderTemplate = (body: string, parameters: ReadonlyArray<string | null | undefined>) =>
  body.replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (all, position: string) => parameters[Number(position) - 1] || all);
