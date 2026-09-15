import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PoolClient } from "pg";
import { CrmSlaLifecycleService } from "../leads/crm-sla-lifecycle.service";
import { MessageReceiptDto } from "./dto/conversations.dto";

@Injectable()
export class CrmMessageReceiptService {
  constructor(private readonly slas: CrmSlaLifecycleService = new CrmSlaLifecycleService()) {}

  async record(
    client: PoolClient,
    messageId: string,
    input: MessageReceiptDto,
    options: { ignoreMissing?: boolean; ignoreNonOutbound?: boolean } = {},
  ) {
    const before = await client.query<Record<string, unknown>>(
      `SELECT message.*,conversation.lead_id AS "leadId",conversation.channel
       FROM crm_messages message
       JOIN crm_conversations conversation
         ON conversation.workspace_id=message.workspace_id AND conversation.id=message.conversation_id
       WHERE message.id=$1 AND message.workspace_id=$2 FOR UPDATE OF message`,
      [messageId, input.workspaceId],
    );
    if (!before.rowCount) {
      if (options.ignoreMissing) return { ignored: true, reason: "message_not_found" };
      throw new NotFoundException("Message not found");
    }
    const message = before.rows[0];
    if (message.direction !== "outbound") {
      if (options.ignoreNonOutbound) return { ignored: true, reason: "message_not_outbound" };
      throw new ConflictException("Only outbound messages have provider receipts");
    }
    const successRanks: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };
    const current = String(message.status);
    if (current === input.status) return { ignored: true, reason: "duplicate_receipt" };
    if (current === "failed") return { ignored: true, reason: "terminal_failure" };
    if (input.status === "failed" && ["delivered", "read"].includes(current)) return { ignored: true, reason: "stale_failure" };
    if (input.status !== "failed" && (successRanks[input.status] ?? -1) < (successRanks[current] ?? -1)) {
      return { ignored: true, reason: "stale_receipt" };
    }

    const receiptAt = new Date();
    const result = await client.query(
      `UPDATE crm_messages SET status = $1::crm_message_status,
         provider_message_id = COALESCE($2, provider_message_id),
         sent_at = CASE WHEN $1 IN ('sent','delivered','read') THEN COALESCE(sent_at,$6) ELSE sent_at END,
         delivered_at = CASE WHEN $1 IN ('delivered','read') THEN COALESCE(delivered_at,$6) ELSE delivered_at END,
         read_at = CASE WHEN $1 = 'read' THEN COALESCE(read_at,$6) ELSE read_at END,
         failure_code = CASE WHEN $1 = 'failed' THEN $3 ELSE NULL END,
         version = version + 1,updated_at=$6 WHERE id = $4 AND workspace_id = $5
       RETURNING id, status, provider_message_id AS "providerMessageId", sent_at AS "sentAt",
                 delivered_at AS "deliveredAt", read_at AS "readAt", failure_code AS "failureCode", version`,
      [input.status, input.providerMessageId ?? null, input.failureCode ?? null, messageId, input.workspaceId, receiptAt],
    );
    const response = result.rows[0];
    if (
      ["sent", "delivered", "read"].includes(input.status)
      && message.authorship === "human"
      && message.sender_id
      && message.leadId
    ) {
      await this.slas.recordFirstResponse(client, input.workspaceId, String(message.leadId), {
        sourceType: "message",
        sourceId: messageId,
        actorUserId: String(message.sender_id),
        respondedAt: new Date(response.sentAt ?? receiptAt),
        details: {
          channel: message.channel,
          providerMessageId: response.providerMessageId ?? null,
          providerStatus: input.status,
        },
      });
    }
    return response;
  }
}
