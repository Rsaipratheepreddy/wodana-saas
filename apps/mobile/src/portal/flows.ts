import { key } from '../core/i18n';
import type { Challenge, LocalFile, PortalChannel, PortalClient } from './client';
import { cleanAmount } from './model';
import type { PortalFile } from './types';

/**
 * The client's actions that take more than one request, kept out of the screens so they are tested in node:
 * a decision confirmed with a fresh code bound to exactly that decision, and files added before what they go with.
 */
type Client = Pick<PortalClient, 'challenge' | 'command' | 'upload' | 'newId'>;

/**
 * A decision that matters (a design, a change request) is confirmed with a code sent for exactly that decision.
 * `send` asks for the code (WhatsApp, or email as the fallback); `confirm` sends the decision with it, under the
 * same command id on every try, so a retry after a dropped connection is recognised and a wrong code can be retyped.
 */
export class CodedDecision {
  readonly commandId: string;
  challenge: Challenge | null = null;

  constructor(private readonly client: Client, readonly purpose: string, private readonly command: Record<string, unknown>) {
    this.commandId = client.newId();
  }

  async send(channel: PortalChannel) {
    this.challenge = await this.client.challenge({ purpose: this.purpose, channel });
    return this.challenge;
  }

  async confirm(code: string) {
    const clean = code.replace(/\D/g, '');
    if (!this.challenge) throw new Error(key('Send a new code'));
    if (!/^\d{6}$/.test(clean)) throw new Error(key('Enter the 6-digit code.'));
    return this.client.command(this.commandId, { ...this.command, challengeId: this.challenge.challengeId, code: clean });
  }
}

/** Uploads files one by one, each under its own id (a retried upload returns the same file); the ids that are up. */
export async function uploadAll(client: Pick<Client, 'upload' | 'newId'>, caseId: string, files: Array<LocalFile & { id?: string }>) {
  const added: PortalFile[] = [];
  for (const file of files) added.push(await client.upload(caseId, file.id ?? client.newId(), { uri: file.uri, name: file.name, type: file.type }));
  return added.map((file) => file.id);
}

/**
 * "I've paid": when, how much (optional), the bank reference and photos of the receipt (from the camera or library),
 * sent once the photos are up. It is the client's word until finance records the payment.
 */
export async function reportPayment(client: Client, input: {
  commandId: string; caseId: string; paymentId: string; paidOn: string; amount: string; reference: string; note?: string; uploadIds: string[];
}) {
  return client.command(input.commandId, {
    action: 'report_payment', caseId: input.caseId, paymentId: input.paymentId, paidOn: input.paidOn, amount: cleanAmount(input.amount),
    reference: input.reference.trim(), note: (input.note ?? '').trim(), uploadIds: input.uploadIds,
  });
}
