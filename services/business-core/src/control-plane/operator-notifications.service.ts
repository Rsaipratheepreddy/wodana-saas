import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { isPlatformOperatorRole, platformOperatorCan, type PlatformOperatorPermission } from "../auth/platform-operator-policy";
import { DatabaseService } from "../database/database.service";

type Db = Pick<PoolClient, "query">;

export type OperatorNotification = {
  id: string; eventType: string; title: string; body: string | null; link: string | null;
  sourceType: string; sourceId: string; readAt: Date | null; createdAt: Date;
};

/** How many notices the bell shows; older ones stay in their module (the enquiry list, the account). */
const LIMIT = 30;

/**
 * Wodana Control's in-app notices: each operator reads and clears their own. Events add them for the
 * operators who can act on them (the operator policy decides), inside the transaction that caused them.
 */
@Injectable()
export class OperatorNotificationsService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Adds one notice per active operator allowed `permission`; a replayed event adds nothing (the unique
   * recipient/event/source key). No conflict target: naming one would make PostgreSQL check the new row
   * against the reader's policy, which the event's own transaction (not the operator) cannot pass.
   */
  async notify(client: Db, input: {
    permission: PlatformOperatorPermission; eventType: string; title: string; body?: string | null; link?: string | null;
    sourceType: string; sourceId: string;
  }) {
    const operators = await client.query<{ userId: string; role: string }>(
      `SELECT operator.user_id AS "userId", operator.role
         FROM platform_administrators operator JOIN users app_user ON app_user.id = operator.user_id AND app_user.status = 'active'
        WHERE operator.status = 'active'`);
    const recipients = operators.rows
      .filter((operator) => isPlatformOperatorRole(operator.role) && platformOperatorCan(operator.role, input.permission))
      .map((operator) => operator.userId);
    if (!recipients.length) return 0;
    await client.query(
      `INSERT INTO platform_operator_notifications (recipient_user_id, event_type, title, body, link, source_type, source_id)
       SELECT recipient, $2, $3, $4, $5, $6, $7 FROM unnest($1::uuid[]) AS recipient
       ON CONFLICT DO NOTHING`,
      [recipients, input.eventType, input.title.slice(0, 200), input.body?.slice(0, 1000) ?? null, input.link ?? null,
        input.sourceType, input.sourceId]);
    return recipients.length;
  }

  async list(operatorUserId: string) {
    return this.database.actorTransaction(operatorUserId, async (client) => {
      const rows = await client.query<OperatorNotification>(
        `SELECT id, event_type AS "eventType", title, body, link, source_type AS "sourceType", source_id AS "sourceId",
                read_at AS "readAt", created_at AS "createdAt"
           FROM platform_operator_notifications ORDER BY created_at DESC, id LIMIT ${LIMIT}`);
      const unread = await client.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM platform_operator_notifications WHERE read_at IS NULL`);
      return { notifications: rows.rows, unread: unread.rows[0]?.count ?? 0 };
    });
  }

  /** Marks the given notices (or every one) as read for this operator; read ones stay read. */
  async markRead(operatorUserId: string, input: { ids?: string[]; all?: boolean }) {
    await this.database.actorTransaction(operatorUserId, (client) => client.query(
      `UPDATE platform_operator_notifications SET read_at = now()
        WHERE read_at IS NULL AND ($1::boolean OR id = ANY($2::uuid[]))`,
      [input.all === true, input.ids ?? []]));
    return this.list(operatorUserId);
  }

  /** Opening the record a notice is about reads it. */
  markSourceRead(client: Db, sourceType: string, sourceId: string) {
    return client.query(
      `UPDATE platform_operator_notifications SET read_at = now()
        WHERE read_at IS NULL AND source_type = $1 AND source_id = $2`, [sourceType, sourceId]);
  }
}
