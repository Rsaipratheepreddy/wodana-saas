import { randomUUID } from "node:crypto";
import { bindEvidence, evidenceFor, evidenceIds, type EvidenceFile } from "../evidence/decision-evidence";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { maskAccountNumber, readSupplier } from "./suppliers";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const DOCUMENT_KINDS = ["trade_licence", "tax_certificate", "insurance", "bank_letter", "other"] as const;
const DOCUMENT_WORDS: Record<(typeof DOCUMENT_KINDS)[number], string> = { trade_licence: "trade licence", tax_certificate: "tax certificate", insurance: "insurance", bank_letter: "bank letter", other: "document" };
const SOURCES = ["supplier_letter", "email", "in_person", "phone"] as const;
const OPEN_ORDER = ["approved", "sent", "confirmed", "partly_received"];

export type VendorDocument = {
  id: string; kind: (typeof DOCUMENT_KINDS)[number]; label: string; number: string; expiresOn: string | null; required: boolean; hasFile: boolean; fileName: string | null;
  createdByName: string; createdAt: string; replacedAt: string | null;
};
export type BankAccount = {
  id: string; accountName: string; bankName: string; accountNumber: string; swift: string; currency: string | null; source: (typeof SOURCES)[number];
  status: "pending" | "approved" | "rejected" | "retired"; requestedBy: string; requestedByName: string; requestedAt: string; callbackByName: string | null; callbackAt: string | null;
  callbackNote: string; decidedByName: string | null; decidedAt: string | null; rejectReason: string | null;
  /** The supplier's bank letter or cancelled cheque (for those who verify bank details). */
  files?: EvidenceFile[];
};

async function readDocuments(db: Db, workspaceId: string, vendorId: string): Promise<VendorDocument[]> {
  return (await db.query<VendorDocument>(
    `SELECT document.id, document.kind, document.label, document.number, document.expires_on::text AS "expiresOn", document.required, document.object_key IS NOT NULL AS "hasFile",
            document.original_name AS "fileName", person.display_name AS "createdByName", document.created_at AS "createdAt", document.replaced_at AS "replacedAt"
       FROM vendor_documents document JOIN users person ON person.id = document.created_by
      WHERE document.workspace_id = $1 AND document.vendor_id = $2 ORDER BY document.replaced_at NULLS FIRST, document.kind, document.created_at DESC`, [workspaceId, vendorId])).rows;
}

async function readBankAccounts(db: Db, workspaceId: string, vendorId: string, full: boolean): Promise<BankAccount[]> {
  const rows = (await db.query<BankAccount>(
    `SELECT account.id, account.account_name AS "accountName", account.bank_name AS "bankName", account.account_number AS "accountNumber", account.swift, account.currency, account.source,
            account.status, account.requested_by AS "requestedBy", requester.display_name AS "requestedByName", account.requested_at AS "requestedAt",
            caller.display_name AS "callbackByName", account.callback_at AS "callbackAt", account.callback_note AS "callbackNote", decider.display_name AS "decidedByName",
            account.decided_at AS "decidedAt", account.reject_reason AS "rejectReason"
       FROM vendor_bank_accounts account JOIN users requester ON requester.id = account.requested_by
       LEFT JOIN users caller ON caller.id = account.callback_by LEFT JOIN users decider ON decider.id = account.decided_by
      WHERE account.workspace_id = $1 AND account.vendor_id = $2
      ORDER BY array_position(ARRAY['pending', 'approved', 'rejected', 'retired'], account.status::text), account.requested_at DESC`, [workspaceId, vendorId])).rows;
  // Only people who verify bank details see the whole number (and the bank letter); everyone else sees its last four digits.
  const files = full ? await evidenceFor(db, workspaceId, "supplier_bank", rows.map((row) => row.id)) : new Map();
  return full ? rows.map((row) => ({ ...row, files: files.get(row.id) ?? [] })) : rows.map((row) => ({ ...row, accountNumber: maskAccountNumber(row.accountNumber) }));
}

export type RateContract = {
  id: string; reference: string; currency: string; validFrom: string; validTo: string; note: string; status: "active" | "cancelled"; cancelReason: string | null;
  state: "upcoming" | "valid" | "expired" | "cancelled"; createdByName: string;
  lines: Array<{ id: string; catalogItemId: string; itemName: string; unit: string; unitPrice: string; minimum: string | null; packSize: string | null; leadDays: number | null }>;
};

async function readContracts(db: Db, workspaceId: string, vendorId: string): Promise<RateContract[]> {
  const contracts = (await db.query<Omit<RateContract, "lines">>(
    `SELECT contract.id, contract.reference, contract.currency, contract.valid_from::text AS "validFrom", contract.valid_to::text AS "validTo", contract.note, contract.status,
            contract.cancel_reason AS "cancelReason", person.display_name AS "createdByName",
            CASE WHEN contract.status = 'cancelled' THEN 'cancelled' WHEN contract.valid_from > clock.today THEN 'upcoming' WHEN contract.valid_to < clock.today THEN 'expired' ELSE 'valid' END AS state
       FROM supplier_rate_contracts contract JOIN users person ON person.id = contract.created_by
       CROSS JOIN (SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date AS today FROM workspaces WHERE id = $1) clock
      WHERE contract.workspace_id = $1 AND contract.vendor_id = $2 ORDER BY contract.valid_to DESC, contract.reference`, [workspaceId, vendorId])).rows;
  const lines = (await db.query<RateContract["lines"][number] & { contractId: string }>(
    `SELECT line.id, line.contract_id AS "contractId", line.catalog_item_id AS "catalogItemId", item.name AS "itemName", item.unit_code AS unit, line.unit_price::text AS "unitPrice",
            line.minimum::text AS minimum, line.pack_size::text AS "packSize", line.lead_days AS "leadDays"
       FROM supplier_rate_contract_lines line JOIN catalog_items item ON item.workspace_id = line.workspace_id AND item.id = line.catalog_item_id
      WHERE line.workspace_id = $1 AND line.contract_id = ANY($2::uuid[]) ORDER BY item.name`, [workspaceId, contracts.map((contract) => contract.id)])).rows;
  return contracts.map((contract) => ({ ...contract, lines: lines.filter((line) => line.contractId === contract.id).map(({ contractId: _c, ...line }) => line) }));
}

/** The valid contract price for a supplier's catalog item in a currency today, if there is one. */
export async function contractPrice(db: Db, workspaceId: string, vendorId: string, catalogItemId: string, currency: string) {
  return (await db.query<{ reference: string; unitPrice: string; minimum: string | null; packSize: string | null }>(
    `SELECT contract.reference, line.unit_price::text AS "unitPrice", line.minimum::text AS minimum, line.pack_size::text AS "packSize"
       FROM supplier_rate_contract_lines line JOIN supplier_rate_contracts contract ON contract.workspace_id = line.workspace_id AND contract.id = line.contract_id
       CROSS JOIN (SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date AS today FROM workspaces WHERE id = $1) clock
      WHERE line.workspace_id = $1 AND contract.vendor_id = $2 AND line.catalog_item_id = $3 AND contract.currency = $4 AND contract.status = 'active'
        AND clock.today BETWEEN contract.valid_from AND contract.valid_to
      ORDER BY line.unit_price, contract.valid_to DESC LIMIT 1`, [workspaceId, vendorId, catalogItemId, currency])).rows[0] ?? null;
}

/**
 * How a supplier performs, from the records: orders placed and their value, lines delivered on time,
 * goods rejected, returns, and how they answer price requests.
 */
export async function readScorecard(db: Db, workspaceId: string, vendorId: string) {
  const orders = (await db.query<{ currency: string; orders: number; value: string }>(
    `SELECT currency, count(*)::int AS orders, sum(total)::text AS value FROM purchase_orders
      WHERE workspace_id = $1 AND vendor_id = $2 AND status IN ('approved', 'sent', 'confirmed', 'partly_received', 'received', 'closed') GROUP BY currency ORDER BY currency`,
    [workspaceId, vendorId])).rows;
  const delivery = (await db.query<{ lines: number; onTime: number }>(
    `WITH first_arrival AS (
       SELECT line.id, coalesce(line.promised_date, purchase.promised_date, purchase.expected_date) AS due, min(receipt.received_on) AS arrived
         FROM purchase_order_lines line
         JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
         JOIN goods_receipt_lines got ON got.workspace_id = line.workspace_id AND got.order_line_id = line.id
         JOIN goods_receipts receipt ON receipt.workspace_id = got.workspace_id AND receipt.id = got.receipt_id AND receipt.reversed_at IS NULL
        WHERE line.workspace_id = $1 AND purchase.vendor_id = $2 GROUP BY line.id, line.promised_date, purchase.promised_date, purchase.expected_date)
     SELECT count(*)::int AS lines, count(*) FILTER (WHERE arrived <= due)::int AS "onTime" FROM first_arrival WHERE due IS NOT NULL`, [workspaceId, vendorId])).rows[0];
  const quality = (await db.query<{ received: string; rejected: string; returns: number }>(
    `SELECT coalesce(sum(got.received), 0)::text AS received, coalesce(sum(got.rejected), 0)::text AS rejected,
            (SELECT count(*)::int FROM supplier_returns back JOIN purchase_orders purchase ON purchase.workspace_id = back.workspace_id AND purchase.id = back.order_id
              WHERE back.workspace_id = $1 AND purchase.vendor_id = $2 AND back.status <> 'cancelled') AS returns
       FROM goods_receipt_lines got JOIN goods_receipts receipt ON receipt.workspace_id = got.workspace_id AND receipt.id = got.receipt_id AND receipt.reversed_at IS NULL
       JOIN purchase_orders purchase ON purchase.workspace_id = receipt.workspace_id AND purchase.id = receipt.order_id
      WHERE got.workspace_id = $1 AND purchase.vendor_id = $2`, [workspaceId, vendorId])).rows[0];
  const quotes = (await db.query<{ asked: number; replied: number; days: string | null }>(
    `SELECT count(*)::int AS asked, count(*) FILTER (WHERE asked.replied_at IS NOT NULL)::int AS replied,
            round(avg(extract(epoch FROM asked.replied_at - request.created_at) / 86400) FILTER (WHERE asked.replied_at IS NOT NULL)::numeric, 1)::text AS days
       FROM price_request_suppliers asked JOIN price_requests request ON request.workspace_id = asked.workspace_id AND request.id = asked.request_id
      WHERE asked.workspace_id = $1 AND asked.vendor_id = $2`, [workspaceId, vendorId])).rows[0];
  const percent = (part: number | string, whole: number | string) => (Dec.of(whole).isZero() ? null : Dec.of(part).mul(100).div(whole).round(1).toString());
  return {
    orders, deliveredLines: delivery.lines, onTimePercent: percent(delivery.onTime, delivery.lines),
    received: quality.received, rejected: quality.rejected, rejectPercent: percent(quality.rejected, quality.received), returns: quality.returns,
    priceRequests: quotes.asked, replyPercent: percent(quotes.replied, quotes.asked), replyDays: quotes.days,
  };
}

/**
 * A supplier's controls: documents with expiry (an expired required one puts the supplier on hold),
 * bank accounts (changed only after a call-back to a known number and a second person's approval),
 * and how the supplier performs.
 */
@Injectable()
export class SupplierControlsService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  detail(actor: RequestActor, workspaceId: string, vendorId: string) {
    return this.access.withPermission(actor, workspaceId, "vendors.view", async (client, user) => this.view(client, workspaceId, vendorId, user.userId));
  }

  /** Adds a document; one of the same kind (and label, for "other") that it replaces is kept as history. */
  addDocument(actor: RequestActor, workspaceId: string, vendorId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      await this.vendor(client, workspaceId, vendorId, true);
      const id = uuid(body.id, "Document");
      if ((await client.query(`SELECT 1 FROM vendor_documents WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) return this.view(client, workspaceId, vendorId, user.userId);
      const kind = oneOf(body.kind, DOCUMENT_KINDS, "Document");
      const label = text(body.label, 120, "Name");
      if (kind === "other" && !label) throw new BadRequestException("Name the document.");
      const expiresOn = body.expiresOn ? date(body.expiresOn, "Expiry date") : null;
      const required = body.required === true;
      if (required && !expiresOn && kind !== "other") throw new BadRequestException("A required document needs its expiry date.");
      await client.query(`UPDATE vendor_documents SET replaced_at = now() WHERE workspace_id = $1 AND vendor_id = $2 AND kind = $3 AND replaced_at IS NULL AND ($3 <> 'other' OR lower(label) = lower($4))`,
        [workspaceId, vendorId, kind, label]);
      await client.query(`INSERT INTO vendor_documents (id, workspace_id, vendor_id, kind, label, number, expires_on, required, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, workspaceId, vendorId, kind, label, text(body.number, 120, "Number"), expiresOn, required, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "supplier.document_added", entityType: "supplier", entityId: vendorId, after: { id, kind, label, expiresOn, required } });
      return this.view(client, workspaceId, vendorId, user.userId);
    });
  }

  /** The document's file (a PDF or a photo of it). */
  async uploadDocumentFile(actor: RequestActor, workspaceId: string, vendorId: string, documentId: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/") && prepared.mimeType !== "application/pdf") throw new BadRequestException("Choose a PDF or a photo of the document.");
    const storage = this.storage;
    if (!storage) throw new ConflictException("Files can't be stored here yet.");
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      const row = (await client.query<{ sha256: string | null }>(`SELECT sha256 FROM vendor_documents WHERE workspace_id = $1 AND vendor_id = $2 AND id = $3 FOR UPDATE`,
        [workspaceId, vendorId, uuid(documentId, "Document")])).rows[0];
      if (!row) throw new NotFoundException("Document not found.");
      if (row.sha256 !== prepared.digest) {
        const key = `suppliers/documents/${workspaceId}/${documentId}/${prepared.digest.slice(0, 16)}`;
        await storage.put(key, prepared.body, prepared.mimeType);
        await client.query(`UPDATE vendor_documents SET original_name = $3, mime_type = $4, byte_size = $5, object_key = $6, sha256 = $7 WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, documentId, prepared.name, prepared.mimeType, prepared.body.length, key, prepared.digest]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "supplier.document_file_added", entityType: "supplier", entityId: vendorId, after: { documentId } });
      }
      return this.view(client, workspaceId, vendorId, user.userId);
    });
  }

  documentFile(actor: RequestActor, workspaceId: string, documentId: string) {
    return this.access.withPermission(actor, workspaceId, "vendors.view", async (client) => {
      const row = (await client.query<{ objectKey: string | null; mimeType: string | null }>(
        `SELECT object_key AS "objectKey", mime_type AS "mimeType" FROM vendor_documents WHERE workspace_id = $1 AND id = $2`, [workspaceId, uuid(documentId, "Document")])).rows[0];
      if (!row?.objectKey || !this.storage) throw new NotFoundException("Document not found.");
      const stored = await this.storage.read(row.objectKey).catch(() => null);
      if (!stored) throw new NotFoundException("Document not found.");
      return { body: stored.body, contentType: row.mimeType ?? "application/octet-stream" };
    });
  }

  /** New bank details, as the supplier sent them; they wait for a call-back and someone else's approval. */
  requestBankAccount(actor: RequestActor, workspaceId: string, vendorId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      const supplier = await this.vendor(client, workspaceId, vendorId, true);
      const id = uuid(body.id, "Bank account");
      if ((await client.query(`SELECT 1 FROM vendor_bank_accounts WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) return this.view(client, workspaceId, vendorId, user.userId);
      if ((await client.query(`SELECT 1 FROM vendor_bank_accounts WHERE workspace_id = $1 AND vendor_id = $2 AND status = 'pending'`, [workspaceId, vendorId])).rowCount)
        throw new ConflictException("Other new bank details for this supplier are still waiting; decide on those first.");
      const account = { accountName: required(body.accountName, 200, "Say whose account it is."), bankName: required(body.bankName, 200, "Name the bank."),
        accountNumber: required(body.accountNumber, 60, "Enter the account number or IBAN.").replace(/\s+/g, " "), swift: text(body.swift, 20, "SWIFT").toUpperCase(),
        currency: body.currency ? String(body.currency).toUpperCase() : null, source: oneOf(body.source, SOURCES, "How the details came") };
      if (account.currency && !/^[A-Z]{3}$/.test(account.currency)) throw new BadRequestException("Choose a currency.");
      await client.query(
        `INSERT INTO vendor_bank_accounts (id, workspace_id, vendor_id, account_name, bank_name, account_number, swift, currency, source, requested_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, workspaceId, vendorId, account.accountName, account.bankName, account.accountNumber, account.swift, account.currency, account.source, user.userId]);
      // §0.3 P0: the supplier's bank letter (or a cancelled cheque), read by whoever verifies the details.
      await bindEvidence(client, workspaceId, user.userId, "supplier_bank", id, evidenceIds(body.evidenceFileIds));
      await this.tell(client, workspaceId, "supplier.bank_change", await this.holders(client, workspaceId, ["vendors.approve"]), user.userId, supplier.name,
        `${account.bankName}, ending ${account.accountNumber.replace(/\s+/g, "").slice(-4)}, ${account.source.replace("_", " ")}`, `bank:${id}`, vendorId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "supplier.bank_requested", entityType: "supplier", entityId: vendorId,
        after: { id, bankName: account.bankName, last4: account.accountNumber.slice(-4), source: account.source } });
      return this.view(client, workspaceId, vendorId, user.userId);
    });
  }

  /**
   * The call-back (who was called, on which number the firm already had) and the decision. Neither is
   * done by whoever recorded the details; approving needs the call-back, and retires the old account.
   */
  bankAccountCommand(actor: RequestActor, workspaceId: string, vendorId: string, accountId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "vendors.approve", async (client, user) => {
      await this.vendor(client, workspaceId, vendorId, true);
      const account = (await client.query<{ status: string; requestedBy: string; callbackBy: string | null }>(
        `SELECT status, requested_by AS "requestedBy", callback_by AS "callbackBy" FROM vendor_bank_accounts WHERE workspace_id = $1 AND vendor_id = $2 AND id = $3 FOR UPDATE`,
        [workspaceId, vendorId, uuid(accountId, "Bank account")])).rows[0];
      if (!account) throw new NotFoundException("Bank details not found.");
      if (account.status !== "pending") throw new ConflictException("These bank details are already decided.");
      if (account.requestedBy === user.userId) throw new ForbiddenException("Someone else checks bank details you recorded.");
      const action = String(body.action ?? "");
      if (action === "callback") {
        const note = required(body.note, 500, "Say who you called and on which number the firm already had.");
        await client.query(`UPDATE vendor_bank_accounts SET callback_by = $3, callback_at = now(), callback_note = $4 WHERE workspace_id = $1 AND id = $2`, [workspaceId, accountId, user.userId, note]);
      } else if (action === "approve") {
        if (!account.callbackBy) throw new ConflictException("Call the supplier on a number the firm already has before approving.");
        await client.query(`UPDATE vendor_bank_accounts SET status = 'retired' WHERE workspace_id = $1 AND vendor_id = $2 AND status = 'approved'`, [workspaceId, vendorId]);
        await client.query(`UPDATE vendor_bank_accounts SET status = 'approved', decided_by = $3, decided_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, accountId, user.userId]);
      } else if (action === "reject") {
        const reason = required(body.reason, 500, "Say why.");
        await client.query(`UPDATE vendor_bank_accounts SET status = 'rejected', decided_by = $3, decided_at = now(), reject_reason = $4 WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, accountId, user.userId, reason]);
      } else throw new BadRequestException("Unknown action.");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `supplier.bank_${action}`, entityType: "supplier", entityId: vendorId, after: { accountId, note: body.note ?? body.reason ?? null } });
      return this.view(client, workspaceId, vendorId, user.userId);
    });
  }

  /** A rate contract: prices agreed for a period, per catalog item. It's cancelled (with why), not edited. */
  saveContract(actor: RequestActor, workspaceId: string, vendorId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      await this.vendor(client, workspaceId, vendorId, true);
      const id = uuid(body.id, "Contract");
      if ((await client.query(`SELECT 1 FROM supplier_rate_contracts WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) return this.view(client, workspaceId, vendorId, user.userId);
      const reference = required(body.reference, 80, "Give the contract its reference.");
      if ((await client.query(`SELECT 1 FROM supplier_rate_contracts WHERE workspace_id = $1 AND vendor_id = $2 AND lower(reference) = lower($3)`, [workspaceId, vendorId, reference])).rowCount)
        throw new ConflictException("This supplier already has a contract with that reference.");
      const currency = String(body.currency ?? "").toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException("Choose a currency.");
      const validFrom = date(body.validFrom, "Valid from"), validTo = date(body.validTo, "Valid to");
      if (validTo < validFrom) throw new BadRequestException("The contract ends after it starts.");
      if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException("Add the items and their prices.");
      const seen = new Set<string>();
      const lines = [];
      for (const raw of body.lines as Array<Record<string, unknown>>) {
        const catalogItemId = uuid(raw?.catalogItemId, "Item");
        if (seen.has(catalogItemId)) throw new BadRequestException("An item is on the contract twice.");
        seen.add(catalogItemId);
        if (!(await client.query(`SELECT 1 FROM catalog_items WHERE workspace_id = $1 AND id = $2`, [workspaceId, catalogItemId])).rowCount) throw new BadRequestException("Choose items from the catalog.");
        const price = positive(raw.unitPrice, "Price", true)!;
        lines.push({ catalogItemId, price, minimum: positive(raw.minimum, "Minimum"), packSize: positive(raw.packSize, "Pack size"),
          leadDays: raw.leadDays === undefined || raw.leadDays === null || raw.leadDays === "" ? null : wholeDays(raw.leadDays) });
      }
      await client.query(`INSERT INTO supplier_rate_contracts (id, workspace_id, vendor_id, reference, currency, valid_from, valid_to, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, workspaceId, vendorId, reference, currency, validFrom, validTo, text(body.note, 1000, "Note"), user.userId]);
      for (const line of lines)
        await client.query(`INSERT INTO supplier_rate_contract_lines (id, workspace_id, contract_id, catalog_item_id, unit_price, minimum, pack_size, lead_days) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), workspaceId, id, line.catalogItemId, line.price, line.minimum, line.packSize, line.leadDays]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "supplier.contract_added", entityType: "supplier", entityId: vendorId, after: { id, reference, currency, validFrom, validTo, lines } });
      return this.view(client, workspaceId, vendorId, user.userId);
    });
  }

  cancelContract(actor: RequestActor, workspaceId: string, vendorId: string, contractId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      const reason = required(body.reason, 500, "Say why the contract is cancelled.");
      const updated = await client.query(`UPDATE supplier_rate_contracts SET status = 'cancelled', cancel_reason = $4 WHERE workspace_id = $1 AND vendor_id = $2 AND id = $3 AND status = 'active'`,
        [workspaceId, vendorId, uuid(contractId, "Contract"), reason]);
      if (!updated.rowCount) throw new ConflictException("That contract isn't active.");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "supplier.contract_cancelled", entityType: "supplier", entityId: vendorId, after: { contractId, reason } });
      return this.view(client, workspaceId, vendorId, user.userId);
    });
  }

  // ---------- helpers ----------
  private async view(client: Db, workspaceId: string, vendorId: string, userId: string) {
    const supplier = await this.vendor(client, workspaceId, vendorId);
    const has = (code: string) => this.access.hasPermission(client as PoolClient, workspaceId, userId, code);
    const canApprove = await has("vendors.approve");
    const openOrders = (await client.query<{ id: string; number: string; status: string; total: string; currency: string }>(
      `SELECT id, number, status, total::text AS total, currency FROM purchase_orders WHERE workspace_id = $1 AND vendor_id = $2 AND status = ANY($3::text[]) ORDER BY created_at DESC`,
      [workspaceId, vendorId, OPEN_ORDER])).rows;
    const catalogItems = (await client.query<{ id: string; name: string; unit: string }>(
      `SELECT id, name, unit_code AS unit FROM catalog_items WHERE workspace_id = $1 AND status = 'active' ORDER BY name LIMIT 1000`, [workspaceId])).rows;
    return { supplier, documents: await readDocuments(client, workspaceId, vendorId), bankAccounts: await readBankAccounts(client, workspaceId, vendorId, canApprove),
      contracts: await readContracts(client, workspaceId, vendorId), catalogItems,
      scorecard: await readScorecard(client, workspaceId, vendorId), openOrders, canManage: await has("vendors.manage"), canApprove, me: userId };
  }

  private async vendor(client: Db, workspaceId: string, vendorId: string, lock = false) {
    const supplier = await readSupplier(client, workspaceId, uuid(vendorId, "Supplier"), lock);
    if (!supplier) throw new NotFoundException("Supplier not found.");
    return supplier;
  }

  private async holders(client: Db, workspaceId: string, codes: string[]) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = effective_role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = ANY($2::text[])
        WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId, codes])).rows.map((row) => row.userId);
  }

  private async tell(client: Db, workspaceId: string, code: string, userIds: string[], actorId: string | null, supplier: string, note: string, key: string, vendorId: string) {
    const actor = actorId ? (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "Someone" : "";
    for (const userId of new Set(userIds.filter((id) => id !== actorId)))
      await notifyUserInApp(client, { workspaceId, recipientUserId: userId, code, eventType: code, variables: { supplier, actor, note },
        deepLink: `/workspace/purchasing/suppliers?supplier=${vendorId}`, idempotencyKey: `${code}:${key}:${userId}`.slice(0, 160) });
  }
}

/**
 * Tells the buyers of a supplier's open orders, and the people who approve suppliers, that the supplier
 * is on hold: the orders wait until someone says they continue, or are cancelled or replaced.
 */
export async function tellSupplierOnHold(db: Db, workspaceId: string, vendorId: string, supplier: string, note: string, actorId: string | null, key: string) {
  const buyers = (await db.query<{ userId: string }>(
    `SELECT DISTINCT created_by AS "userId" FROM purchase_orders WHERE workspace_id = $1 AND vendor_id = $2 AND status = ANY($3::text[])`, [workspaceId, vendorId, OPEN_ORDER])).rows.map((row) => row.userId);
  const approvers = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'vendors.approve'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
  const actor = actorId ? (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "Someone" : "";
  let sent = 0;
  for (const userId of new Set([...buyers, ...approvers].filter((id) => id !== actorId))) {
    const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "supplier.on_hold", eventType: "supplier.on_hold", variables: { supplier, actor, note },
      deepLink: `/workspace/purchasing/suppliers?supplier=${vendorId}`, idempotencyKey: `supplier.on_hold:${key}:${userId}`.slice(0, 160) });
    if (result.queued) sent += 1;
  }
  return sent;
}

/**
 * The daily supplier document check, inside one workspace's tenant transaction: 30 days before a
 * document expires, the people who manage suppliers hear once; when a required one has expired, an
 * approved supplier goes on hold and its open orders' buyers and the approvers hear.
 */
export async function processSupplierDocuments(db: Db, workspaceId: string) {
  const today = (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.today;
  if (!today) return { held: 0, warned: 0 };
  const current = (await db.query<{ id: string; vendorId: string; supplier: string; kind: (typeof DOCUMENT_KINDS)[number]; label: string; expiresOn: string; required: boolean; approval: string }>(
    `SELECT document.id, document.vendor_id AS "vendorId", vendor.display_name AS supplier, document.kind, document.label, document.expires_on::text AS "expiresOn", document.required, vendor.approval
       FROM vendor_documents document JOIN workspace_vendors vendor ON vendor.workspace_id = document.workspace_id AND vendor.id = document.vendor_id
      WHERE document.workspace_id = $1 AND document.replaced_at IS NULL AND document.expires_on IS NOT NULL AND vendor.status = 'active'
        AND document.expires_on <= $2::date + 30`, [workspaceId, today])).rows;
  const managers = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'vendors.manage'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
  let held = 0, warned = 0;
  for (const document of current) {
    const name = document.kind === "other" ? document.label : DOCUMENT_WORDS[document.kind];
    if (document.expiresOn < today && document.required && document.approval === "approved") {
      const note = `Its ${name} expired on ${document.expiresOn}.`;
      await db.query(`UPDATE workspace_vendors SET approval = 'on_hold', approval_note = $3, approval_at = now(), approval_by = NULL, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, document.vendorId, note]);
      await recordAudit(db, { workspaceId, actorUserId: null, action: "supplier.held_for_document", entityType: "supplier", entityId: document.vendorId, after: { documentId: document.id, note }, source: "internal" });
      await tellSupplierOnHold(db, workspaceId, document.vendorId, document.supplier, note, null, `document:${document.id}`);
      held += 1;
    } else if (document.expiresOn >= today) {
      for (const userId of managers) {
        const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "supplier.document_expiring", eventType: "supplier.document_expiring",
          variables: { supplier: document.supplier, actor: "", note: `the ${name} expires on ${document.expiresOn}` },
          deepLink: `/workspace/purchasing/suppliers?supplier=${document.vendorId}`, idempotencyKey: `supplier.document_expiring:${document.id}:${userId}` });
        if (result.queued) warned += 1;
      }
    }
  }
  return { held, warned };
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} is not valid.`);
  return value;
}

function text(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BadRequestException(`${label} is not valid.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BadRequestException(`${label} is too long (up to ${max} characters).`);
  return trimmed;
}

function required(value: unknown, max: number, message: string) {
  const result = text(value, max, "Text");
  if (!result) throw new BadRequestException(message);
  return result;
}

function positive(value: unknown, label: string, needed = false) {
  if (value === undefined || value === null || value === "") { if (needed) throw new BadRequestException(`${label} is needed.`); return null; }
  const textValue = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,14}(\.\d{1,4})?$/.test(textValue) || (!needed && Dec.of(textValue).isZero())) throw new BadRequestException(`${label} must be a number with up to 4 decimals.`);
  return textValue;
}

function wholeDays(value: unknown) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new BadRequestException("Lead time is a whole number of days, up to a year.");
  return days;
}

function date(value: unknown, label: string) {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) throw new BadRequestException(`${label} is not valid.`);
  return value as T;
}
