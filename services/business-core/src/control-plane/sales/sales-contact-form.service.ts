import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../database/database.service";
import {
  publicFormView,
  readFormConfiguration,
  SalesEnquiryRuleError,
  validateFormConfiguration,
  type SalesFormConfiguration,
} from "./sales-enquiry.domain";

type Db = Pick<PoolClient, "query">;

/**
 * The versioned "Contact sales" form configuration: the public page reads the current version without the
 * recipients; operators read everything and save a new version (version-checked, idempotent, audited).
 */
@Injectable()
export class SalesContactFormService {
  constructor(private readonly database: DatabaseService) {}

  /** The current version inside any transaction (the public form policy lets everyone read it). */
  async current(client: Db): Promise<{ version: number; configuration: SalesFormConfiguration }> {
    const row = (await client.query<{ version: number; configuration: unknown }>(
      `SELECT version, configuration FROM sales_contact_form_versions ORDER BY version DESC LIMIT 1`,
    )).rows[0];
    if (!row) throw new ConflictException("The contact form is not set up yet.");
    return { version: row.version, configuration: readFormConfiguration(row.configuration) };
  }

  async publicForm() {
    const current = await this.database.transaction((client) => this.current(client));
    return publicFormView(current.version, current.configuration);
  }

  async settings(operatorUserId: string) {
    return this.database.actorTransaction(operatorUserId, (client) => this.read(client));
  }

  async save(operatorUserId: string, input: { expectedVersion: number; configuration: unknown }, idempotencyKey: string | undefined) {
    const key = idempotencyKey?.trim();
    if (!key || !/^[a-zA-Z0-9_-]{8,160}$/.test(key)) throw new BadRequestException("A request key is required.");
    let configuration: SalesFormConfiguration;
    try {
      configuration = validateFormConfiguration(input.configuration);
    } catch (error) {
      if (error instanceof SalesEnquiryRuleError) throw new BadRequestException(error.message);
      throw error;
    }
    return this.database.actorTransaction(operatorUserId, async (client) => {
      const replay = await client.query<{ createdBy: string | null }>(
        `SELECT created_by AS "createdBy" FROM sales_contact_form_versions WHERE idempotency_key = $1`, [key]);
      if (replay.rowCount) {
        if (replay.rows[0].createdBy !== operatorUserId) throw new ConflictException("This request key was already used.");
        return this.read(client);
      }
      // Serialize saves so two operators cannot both write the next version.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('sales_contact_form_versions'))`);
      const before = await this.current(client);
      if (before.version !== input.expectedVersion) throw new ConflictException("The form changed. Refresh and try again.");
      const version = before.version + 1;
      await client.query(
        `INSERT INTO sales_contact_form_versions (version, configuration, idempotency_key, created_by) VALUES ($1, $2::jsonb, $3, $4)`,
        [version, JSON.stringify(configuration), key, operatorUserId]);
      await client.query(
        `INSERT INTO platform_operator_audit (actor_user_id, action, target_type, target_id, correlation_id, details)
         VALUES ($1, 'sales_contact_form.saved', 'sales_contact_form', $2, $3, $4::jsonb)`,
        [operatorUserId, String(version), randomUUID(), JSON.stringify({ before: before.configuration, after: configuration, version })]);
      return this.read(client);
    });
  }

  private async read(client: Db) {
    const current = await this.current(client);
    const history = await client.query<{ version: number; createdAt: Date; createdByName: string | null }>(
      `SELECT form.version, form.created_at AS "createdAt", app_user.display_name AS "createdByName"
         FROM sales_contact_form_versions form LEFT JOIN users app_user ON app_user.id = form.created_by
        ORDER BY form.version DESC LIMIT 10`);
    return { version: current.version, configuration: current.configuration, history: history.rows };
  }
}
