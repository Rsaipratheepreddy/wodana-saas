import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { DatabaseService } from "../database/database.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { applyResult, claimPostings, type ClaimedPosting, type PostingResult } from "./accounting-sync";

type Db = PoolClient;
const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROVIDER_ID = /^[\w.:-]{1,120}$/;
const CLAIM_LIMIT = 20;

/**
 * Accounting sync: where each company posts (its QuickBooks or Zoho Books connection, from a start date),
 * the accounts, item and tax codes it posts with, and the postings with where each stands. The integration
 * worker claims postings and reports back through the internal routes.
 */
@Injectable()
export class AccountingService {
  constructor(private readonly access: WorkspaceAccessService, private readonly db: DatabaseService) {}

  settings(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "accounting.manage", async (client) => this.view(client, workspaceId));
  }

  /** Sets where one company posts and what with; version-checked, audited. The connection can't change once something was posted to it. */
  saveLink(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "accounting.manage", async (client, user) => {
      const legalEntityId = uuid(body.legalEntityId, "Company");
      if (!(await client.query(`SELECT 1 FROM legal_entities WHERE workspace_id = $1 AND id = $2`, [workspaceId, legalEntityId])).rowCount) throw new NotFoundException("Company not found.");
      const connectionId = uuid(body.connectionId, "Connection");
      const connection = (await client.query<{ provider: string; legalEntityId: string | null }>(
        `SELECT provider, legal_entity_id AS "legalEntityId" FROM integration_connections WHERE workspace_id = $1 AND id = $2 AND status IN ('connected', 'degraded')`,
        [workspaceId, connectionId])).rows[0];
      if (!connection || !["quickbooks", "zoho_books"].includes(connection.provider)) throw new BadRequestException("Choose a connected QuickBooks or Zoho Books account.");
      if (connection.legalEntityId && connection.legalEntityId !== legalEntityId) throw new ConflictException("That accounting connection belongs to another company.");
      if (typeof body.startDate !== "string" || !DATE.test(body.startDate)) throw new BadRequestException("Choose the date to post from.");
      const ids = Object.fromEntries(["salesItemId", "expenseAccountId", "paymentsAccountId", "depositAccountId"].map((key) => {
        const value = body[key];
        if (value === undefined || value === null || value === "") return [key, null];
        if (typeof value !== "string" || !PROVIDER_ID.test(value)) throw new BadRequestException("An accounting reference is not valid.");
        return [key, value];
      })) as Record<"salesItemId" | "expenseAccountId" | "paymentsAccountId" | "depositAccountId", string | null>;
      const taxCodes = Array.isArray(body.taxCodes) ? (body.taxCodes as Array<Record<string, unknown>>) : [];
      const current = (await client.query<{ id: string; version: number; connectionId: string }>(
        `SELECT id, version, connection_id AS "connectionId" FROM accounting_links WHERE workspace_id = $1 AND legal_entity_id = $2 FOR UPDATE`, [workspaceId, legalEntityId])).rows[0];
      if ((current?.version ?? 0) !== body.version) throw new ConflictException("Someone else changed these accounting settings. Reload to see their change.");
      if (current && current.connectionId !== connectionId
        && (await client.query(`SELECT 1 FROM accounting_postings WHERE workspace_id = $1 AND link_id = $2 AND status = 'sent'`, [workspaceId, current.id])).rowCount)
        throw new ConflictException("Documents were already posted to the other accounting connection; it can't change now.");
      const linkId = current?.id ?? randomUUID();
      const active = body.active !== false;
      if (current)
        await client.query(
          `UPDATE accounting_links SET connection_id = $3, start_date = $4, sales_item_id = $5, expense_account_id = $6, payments_account_id = $7, deposit_account_id = $8, active = $9,
                  version = version + 1, updated_by = $10, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, linkId, connectionId, body.startDate, ids.salesItemId, ids.expenseAccountId, ids.paymentsAccountId, ids.depositAccountId, active, user.userId]);
      else
        await client.query(
          `INSERT INTO accounting_links (id, workspace_id, legal_entity_id, connection_id, start_date, sales_item_id, expense_account_id, payments_account_id, deposit_account_id, active, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [linkId, workspaceId, legalEntityId, connectionId, body.startDate, ids.salesItemId, ids.expenseAccountId, ids.paymentsAccountId, ids.depositAccountId, active, user.userId]);
      await client.query(`DELETE FROM accounting_tax_codes WHERE workspace_id = $1 AND link_id = $2`, [workspaceId, linkId]);
      const rates = new Set<string>();
      for (const item of taxCodes) {
        const rate = typeof item?.rate === "string" || typeof item?.rate === "number" ? String(item.rate).trim() : "";
        if (!/^\d{1,3}(\.\d{1,4})?$/.test(rate) || Dec.of(rate).cmp(100) > 0) throw new BadRequestException("A tax rate is not valid.");
        const providerTaxId = typeof item.providerTaxId === "string" ? item.providerTaxId.trim() : "";
        if (!providerTaxId) continue;
        if (!PROVIDER_ID.test(providerTaxId)) throw new BadRequestException("A tax code is not valid.");
        if (rates.has(Dec.of(rate).toString())) throw new BadRequestException(`The ${Dec.of(rate).toString()}% rate is mapped twice.`);
        rates.add(Dec.of(rate).toString());
        await client.query(`INSERT INTO accounting_tax_codes (id, workspace_id, link_id, rate, provider_tax_id) VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), workspaceId, linkId, rate, providerTaxId]);
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "accounting.link_saved", entityType: "legal_entity", entityId: legalEntityId,
        after: { connectionId, startDate: body.startDate, ...ids, active, taxCodes: [...rates] } });
      return this.view(client, workspaceId);
    });
  }

  /** Postings, newest first, with what each is for and where it stands. */
  postings(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "accounting.manage", async (client) => ({ postings: await this.readPostings(client, workspaceId) }));
  }

  /** Sends a failed or blocked posting again on the worker's next pass. */
  retry(actor: RequestActor, workspaceId: string, postingId: string) {
    return this.access.withPermission(actor, workspaceId, "accounting.manage", async (client, user) => {
      const posting = (await client.query<{ status: string }>(`SELECT status FROM accounting_postings WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [workspaceId, uuid(postingId, "Posting")])).rows[0];
      if (!posting) throw new NotFoundException("Posting not found.");
      if (!["failed", "blocked"].includes(posting.status)) throw new ConflictException("Only a failed or blocked posting is sent again.");
      await client.query(`UPDATE accounting_postings SET status = 'pending', next_at = NULL, error = NULL, error_code = NULL WHERE workspace_id = $1 AND id = $2`, [workspaceId, postingId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "accounting.posting_retried", entityType: "accounting_posting", entityId: postingId, before: posting });
      return { postings: await this.readPostings(client, workspaceId) };
    });
  }

  /** The worker's claim: due postings across the workspaces that post to accounting, each claimed inside its own workspace. */
  async claim() {
    const postings: ClaimedPosting[] = [];
    const workspaces = (await this.db.query<{ workspace_id: string }>("SELECT workspace_id FROM list_accounting_workspaces()")).rows;
    for (const { workspace_id: workspaceId } of workspaces) {
      if (postings.length >= CLAIM_LIMIT) break;
      postings.push(...await this.db.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) => claimPostings(client, workspaceId, CLAIM_LIMIT - postings.length)));
    }
    return { postings };
  }

  /** The worker's report for one posting it claimed; ignored once its lease is gone. */
  async result(input: unknown) {
    const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const id = uuid(body.id, "Posting"), leaseToken = uuid(body.leaseToken, "Lease");
    const workspaceId = (await this.db.query<{ workspaceId: string | null }>(`SELECT accounting_posting_workspace($1, $2) AS "workspaceId"`, [id, leaseToken])).rows[0]?.workspaceId;
    if (!workspaceId) throw new ConflictException("This posting's lease expired or it was already reported.");
    const error = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : null;
    const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : undefined);
    const total = typeof body.providerTotal === "string" && /^-?\d{1,14}(\.\d{1,6})?$/.test(body.providerTotal) ? body.providerTotal : null;
    const result: PostingResult = {
      id, leaseToken, providerId: text(body.providerId, 120), providerNumber: text(body.providerNumber, 120) ?? null, providerTotal: total, contactProviderId: text(body.contactProviderId, 120),
      error: error ? { code: text(error.code, 40) ?? "provider_error", message: text(error.message, 500) ?? "The accounting system refused it.", retryable: error.retryable === true } : undefined,
    };
    return this.db.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) => applyResult(client, workspaceId, result));
  }

  private async view(client: Db, workspaceId: string) {
    const companies = (await client.query<{ id: string; name: string; currency: string }>(
      `SELECT id, display_name AS name, base_currency AS currency FROM legal_entities WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY display_name`, [workspaceId])).rows;
    const links = (await client.query<{ id: string; legalEntityId: string; connectionId: string; startDate: string; salesItemId: string | null; expenseAccountId: string | null;
      paymentsAccountId: string | null; depositAccountId: string | null; active: boolean; version: number }>(
      `SELECT id, legal_entity_id AS "legalEntityId", connection_id AS "connectionId", start_date::text AS "startDate", sales_item_id AS "salesItemId", expense_account_id AS "expenseAccountId",
              payments_account_id AS "paymentsAccountId", deposit_account_id AS "depositAccountId", active, version FROM accounting_links WHERE workspace_id = $1`, [workspaceId])).rows;
    const taxCodes = (await client.query<{ linkId: string; rate: string; providerTaxId: string }>(
      `SELECT link_id AS "linkId", rate::text AS rate, provider_tax_id AS "providerTaxId" FROM accounting_tax_codes WHERE workspace_id = $1 ORDER BY rate`, [workspaceId])).rows;
    // Every rate the company uses: its tax profile's rates, and any rate already on its invoices or bills.
    const rates = (await client.query<{ legalEntityId: string; rate: string }>(
      `SELECT DISTINCT profile.legal_entity_id AS "legalEntityId", rate.rate::numeric(7, 4)::text AS rate FROM tax_rates rate JOIN tax_profiles profile ON profile.id = rate.tax_profile_id
        WHERE rate.workspace_id = $1 AND rate.effective_to IS NULL
       UNION SELECT DISTINCT invoice.legal_entity_id, line.tax_rate::numeric(7, 4)::text FROM client_invoice_lines line
         JOIN client_invoices invoice ON invoice.workspace_id = line.workspace_id AND invoice.id = line.invoice_id WHERE line.workspace_id = $1
       UNION SELECT DISTINCT bill.legal_entity_id, line.tax_rate::numeric(7, 4)::text FROM supplier_invoice_lines line
         JOIN supplier_invoices bill ON bill.workspace_id = line.workspace_id AND bill.id = line.invoice_id WHERE line.workspace_id = $1`, [workspaceId])).rows;
    const connections = (await client.query<{ id: string; provider: string; name: string; legalEntityId: string | null; status: string }>(
      `SELECT id, provider, coalesce(display_name, provider) AS name, legal_entity_id AS "legalEntityId", status::text AS status FROM integration_connections
        WHERE workspace_id = $1 AND provider IN ('quickbooks', 'zoho_books') AND status IN ('connected', 'degraded') ORDER BY display_name`, [workspaceId])).rows;
    const counts = (await client.query<{ linkId: string; status: string; count: number }>(
      `SELECT link_id AS "linkId", status, count(*)::int AS count FROM accounting_postings WHERE workspace_id = $1 GROUP BY link_id, status`, [workspaceId])).rows;
    return {
      companies: companies.map((company) => {
        const link = links.find((item) => item.legalEntityId === company.id) ?? null;
        return { ...company, link: link ? { ...link, taxCodes: taxCodes.filter((item) => item.linkId === link.id).map(({ rate, providerTaxId }) => ({ rate, providerTaxId })),
          counts: Object.fromEntries(counts.filter((item) => item.linkId === link.id).map((item) => [item.status, item.count])) } : null,
          rates: [...new Set(rates.filter((item) => item.legalEntityId === company.id).map((item) => Dec.of(item.rate).toString()))].sort((a, b) => Dec.of(a).cmp(b)) };
      }),
      connections,
    };
  }

  private async readPostings(client: Db, workspaceId: string) {
    return (await client.query<{ id: string; kind: string; status: string; documentDate: string; label: string | null; companyName: string; provider: string; attempts: number;
      providerNumber: string | null; errorCode: string | null; error: string | null; sentAt: string | null; nextAt: string | null }>(
      `SELECT posting.id, posting.kind, posting.status, posting.document_date::text AS "documentDate", entity.display_name AS "companyName", connection.provider, posting.attempts,
              posting.provider_number AS "providerNumber", posting.error_code AS "errorCode", posting.error, posting.sent_at AS "sentAt", posting.next_at AS "nextAt",
              CASE posting.kind
                WHEN 'invoice' THEN (SELECT invoice.number || ' · ' || invoice.customer_name FROM client_invoices invoice WHERE invoice.workspace_id = posting.workspace_id AND invoice.id::text = posting.source_id)
                WHEN 'credit_note' THEN (SELECT credit.number FROM client_credit_notes credit WHERE credit.workspace_id = posting.workspace_id AND credit.id::text = posting.source_id)
                WHEN 'bill' THEN (SELECT vendor.display_name || ' · ' || bill.number FROM supplier_invoices bill JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id
                                   AND vendor.id = bill.vendor_id WHERE bill.workspace_id = posting.workspace_id AND bill.id::text = posting.source_id)
                WHEN 'invoice_payment' THEN (SELECT receipt.reference FROM commercial_allocations allocation JOIN commercial_receipts receipt ON receipt.workspace_id = allocation.workspace_id
                                   AND receipt.case_id = allocation.case_id AND receipt.id = allocation.receipt_id WHERE allocation.workspace_id = posting.workspace_id AND allocation.id = posting.source_id)
                ELSE (SELECT vendor.display_name || ' · ' || bill.number FROM supplier_payment_allocations allocation
                        JOIN supplier_invoices bill ON bill.workspace_id = allocation.workspace_id AND bill.id = allocation.invoice_id
                        JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id AND vendor.id = bill.vendor_id
                       WHERE allocation.workspace_id = posting.workspace_id AND allocation.id::text = posting.source_id)
              END AS label
         FROM accounting_postings posting
         JOIN accounting_links link ON link.workspace_id = posting.workspace_id AND link.id = posting.link_id
         JOIN legal_entities entity ON entity.workspace_id = link.workspace_id AND entity.id = link.legal_entity_id
         JOIN integration_connections connection ON connection.id = link.connection_id
        WHERE posting.workspace_id = $1 ORDER BY posting.document_date DESC, posting.created_at DESC LIMIT 1000`, [workspaceId])).rows;
  }
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} is not valid.`);
  return value;
}
