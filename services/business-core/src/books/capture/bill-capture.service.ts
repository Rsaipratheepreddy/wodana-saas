import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../../auth/actor";
import { recordAudit } from "../../audit/record-audit";
import { AiGatewayService } from "../../ai-gateway/ai-gateway.service";
import { Dec } from "../../catalog-core/decimal";
import { currencyDecimals } from "../../common/currency";
import { notifyUserInApp } from "../../notifications/default-templates";
import { firstTime } from "../../purchasing/orders";
import { readInvoiceable } from "../../purchasing/payables";
import { PayablesService } from "../../purchasing/payables.service";
import { BrandAssetStorageService } from "../../workspaces/brand-asset-storage.service";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import {
  BILL_CAPTURE_FEATURE, billReadingRequest, fieldHints, matchVendor, proposeLines, sameOrderNumber, taxNumberKey, validateBillReading,
  type BillReading, type CaptureWarning, type DraftLine, type PurchaseTaxCode, type VendorMatch,
} from "./bill-reading";
import { prepareCapture, readableCapture, type CaptureUpload } from "./capture-file";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** How long an upload waits for its reading; a slower one finishes in the background and tells the uploader. */
export const CAPTURE_WAIT_MS = 18_000;
const READ_TIMEOUT_MS = 25_000;
/** Orders a supplier can invoice (payables: placed, including closed ones). */
const INVOICEABLE_ORDERS = ["approved", "sent", "confirmed", "closed"];
/** Reading a bill is an AI suggestion: without the person's right to use them, it's said plainly rather than tried. */
const AI_USE = "ai.suggestions.use";
export const NO_AI_READING = "Reading bills needs the Use AI suggestions permission. Enter the bill by hand, or ask an admin for it.";

export type CaptureStatus = "reading" | "read" | "failed" | "drafted" | "discarded";
type CaptureRow = {
  id: string; legalEntityId: string | null; storageKey: string; fileName: string; contentType: string; byteSize: number | null; sha256: string; status: CaptureStatus;
  reading: (BillReading & { raw?: unknown }) | null; model: string | null; confidence: string | null; error: string | null; matchedVendorId: string | null; matchedOrderId: string | null;
  supplierInvoiceId: string | null; confirmedBy: string | null; confirmedAt: string | null; createdBy: string; createdByName: string; createdAt: string; version: number;
};

/** The bill a reading proposes, for the draft and for the person's review. */
export type CaptureProposal = {
  vendorId: string | null; vendorName: string | null; vendorMatch: NonNullable<VendorMatch>["method"] | null; legalEntityId: string | null; currency: string | null;
  orderId: string | null; orderNumber: string | null; number: string | null; invoiceDate: string | null; dueDate: string | null; statedTotal: string | null;
  lines: DraftLine[]; warnings: CaptureWarning[]; hints: ReturnType<typeof fieldHints>;
  /** Everything a draft needs is there and nothing stops it (a duplicate, a future date, a line without a price). */
  ready: boolean;
};

const CAPTURE_SELECT = `SELECT capture.id, capture.legal_entity_id AS "legalEntityId", capture.storage_key AS "storageKey", capture.file_name AS "fileName",
  capture.content_type AS "contentType", capture.byte_size::int AS "byteSize", capture.sha256, capture.status, capture.reading, capture.model, capture.confidence::text AS confidence,
  capture.error, capture.matched_vendor_id AS "matchedVendorId", capture.matched_order_id AS "matchedOrderId", capture.supplier_invoice_id AS "supplierInvoiceId",
  capture.confirmed_by AS "confirmedBy", capture.confirmed_at AS "confirmedAt", capture.created_by AS "createdBy", creator.display_name AS "createdByName",
  capture.created_at AS "createdAt", capture.version
  FROM books_bill_captures capture JOIN users creator ON creator.id = capture.created_by`;

/**
 * "Snap a bill, Woddy books it" (Ledger, plan §6.21b): a photo or PDF of a supplier's invoice is stored, read by the
 * workspace's AI and turned into a draft supplier invoice through the payables commands: the supplier matched by
 * tax number or name, the order matched by the PO number it quotes, a duplicate or a total that doesn't add up
 * flagged. Nothing posts: the Ledger posts a bill only once a person approves it. The reading is kept as it was
 * read (model, confidence and the model's own answer), and the file becomes the invoice's document once confirmed.
 */
@Injectable()
export class BillCaptureService {
  private readonly logger = new Logger(BillCaptureService.name);

  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly ai: AiGatewayService,
    private readonly payables: PayablesService,
    @Optional() private readonly storage?: BrandAssetStorageService,
  ) {}

  /**
   * Stores the file and reads it. The same file again returns its first capture ("already captured"). A reading
   * that takes longer than the upload waits carries on in the background and tells the uploader when it's done.
   */
  async upload(actor: RequestActor, workspaceId: string, file?: CaptureUpload, wait = CAPTURE_WAIT_MS) {
    const prepared = await prepareCapture(file);
    const storage = this.storage;
    if (!storage) throw new ConflictException("Files can't be stored here yet.");
    const started = await this.access.withPermission(actor, workspaceId, "payables.manage", async (client, user) => {
      const live = await this.liveCapture(client, workspaceId, prepared.sha256);
      if (live) return { id: live, duplicate: true, userId: user.userId, currency: null, canRead: true };
      const id = randomUUID();
      const key = `books-captures/${workspaceId}/${id}/${prepared.sha256}`;
      await storage.put(key, prepared.stored.body, prepared.stored.mimeType);
      const inserted = await client.query(
        `INSERT INTO books_bill_captures (id, workspace_id, storage_key, file_name, content_type, byte_size, sha256, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'reading', $8) ON CONFLICT DO NOTHING`,
        [id, workspaceId, key, prepared.name, prepared.stored.mimeType, prepared.byteSize, prepared.sha256, user.userId]);
      // Someone captured the same file a moment ago.
      if (!inserted.rowCount) return { id: (await this.liveCapture(client, workspaceId, prepared.sha256))!, duplicate: true, userId: user.userId, currency: null, canRead: true };
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "books_capture.uploaded", entityType: "books_bill_capture", entityId: id,
        after: { fileName: prepared.name, sha256: prepared.sha256, byteSize: prepared.byteSize, contentType: prepared.stored.mimeType } });
      const currency = (await client.query<{ currency: string | null }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? null;
      return { id, duplicate: false, userId: user.userId, currency, canRead: await this.access.hasPermission(client, workspaceId, user.userId, AI_USE) };
    });
    if (!started.duplicate) await this.read(actor, workspaceId, started, prepared.readable, wait);
    const view = await this.get(actor, workspaceId, started.id);
    return { ...view, duplicate: started.duplicate };
  }

  /**
   * Reads a capture, waiting up to `wait`; a slower reading carries on in the background and tells the uploader.
   * Someone without the right to AI suggestions isn't sent to the AI: the capture fails at once, saying why.
   */
  private async read(actor: RequestActor, workspaceId: string, started: { id: string; userId: string; currency: string | null; canRead: boolean },
    readable: { body: Buffer; mimeType: string }, wait: number) {
    if (!started.canRead) { await this.fail(actor, workspaceId, started.id, NO_AI_READING, "no AI permission"); return; }
    let background = false;
    const reading = this.readAndDraft(actor, workspaceId, started.id, readable, started.currency)
      .then(async (outcome) => { if (background) await this.tellRead(actor, workspaceId, started.id, started.userId, outcome).catch(() => undefined); })
      .catch(() => undefined);
    const finished = await Promise.race([reading.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), wait).unref?.())]);
    if (!finished) background = true;
  }

  /**
   * Reads a bill again after its reading failed (the AI refused, ran out of time or answered something unusable):
   * the same stored file, the same capture. Version-checked, once per command id, audited.
   */
  async retry(actor: RequestActor, workspaceId: string, captureId: string, body: Record<string, unknown>, wait = CAPTURE_WAIT_MS) {
    const id = uuid(captureId, "Capture");
    const storage = this.storage;
    if (!storage) throw new ConflictException("Files can't be stored here yet.");
    const started = await this.access.withPermission(actor, workspaceId, "payables.manage", async (client, user) => {
      const commandId = uuid(body.commandId, "Command");
      const capture = (await client.query<CaptureRow>(`${CAPTURE_SELECT} WHERE capture.workspace_id = $1 AND capture.id = $2 FOR UPDATE OF capture`, [workspaceId, id])).rows[0];
      if (!capture) throw new NotFoundException("Capture not found.");
      if (!(await firstTime(client, workspaceId, commandId, id, "books_capture_retry", user.userId))) return null;
      if (body.version !== capture.version) throw new ConflictException("Someone else changed this capture. Reload to see their changes.");
      if (capture.status !== "failed") throw new ConflictException(capture.status === "reading" ? "Woddy is still reading this bill." : "Only a bill that couldn't be read is read again.");
      await client.query(`UPDATE books_bill_captures SET status = 'reading', error = NULL, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "books_capture.retried", entityType: "books_bill_capture", entityId: id, before: { error: capture.error } });
      const currency = (await client.query<{ currency: string | null }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? null;
      return { id, userId: user.userId, currency, key: capture.storageKey, mimeType: capture.contentType, canRead: await this.access.hasPermission(client, workspaceId, user.userId, AI_USE) };
    });
    if (started) {
      const stored = await storage.read(started.key).catch(() => null);
      if (!stored) await this.fail(actor, workspaceId, id, "The bill's file couldn't be opened. Enter it by hand.", "file missing");
      else await this.read(actor, workspaceId, started, await readableCapture({ body: stored.body, mimeType: started.mimeType }), wait);
    }
    return this.get(actor, workspaceId, id);
  }

  get(actor: RequestActor, workspaceId: string, captureId: string) {
    return this.access.withPermission(actor, workspaceId, "payables.manage", (client) => this.view(client, workspaceId, uuid(captureId, "Capture")));
  }

  file(actor: RequestActor, workspaceId: string, captureId: string) {
    return this.access.withPermission(actor, workspaceId, "payables.view", async (client) => {
      const row = (await client.query<{ key: string; type: string }>(`SELECT storage_key AS key, content_type AS type FROM books_bill_captures WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, uuid(captureId, "Capture")])).rows[0];
      if (!row || !this.storage) throw new NotFoundException("Document not found.");
      const stored = await this.storage.read(row.key).catch(() => null);
      if (!stored) throw new NotFoundException("Document not found.");
      return { body: stored.body, contentType: row.type || "application/octet-stream" };
    });
  }

  /** confirm (the person saved the draft: the capture names the invoice and its file becomes the invoice's document) · discard. */
  command(actor: RequestActor, workspaceId: string, captureId: string, body: Record<string, unknown>) {
    const action = body.action;
    if (action === "retry") return this.retry(actor, workspaceId, captureId, body);
    if (action !== "confirm" && action !== "discard") throw new BadRequestException("Unknown action.");
    const id = uuid(captureId, "Capture");
    return this.access.withPermission(actor, workspaceId, "payables.manage", async (client, user) => {
      const commandId = uuid(body.commandId, "Command");
      const capture = (await client.query<CaptureRow>(`${CAPTURE_SELECT} WHERE capture.workspace_id = $1 AND capture.id = $2 FOR UPDATE OF capture`, [workspaceId, id])).rows[0];
      if (!capture) throw new NotFoundException("Capture not found.");
      if (!(await firstTime(client, workspaceId, commandId, id, `books_capture_${action}`, user.userId))) return this.view(client, workspaceId, id);
      if (body.version !== capture.version) throw new ConflictException("Someone else changed this capture. Reload to see their changes.");
      if (action === "discard") {
        if (capture.status === "drafted") throw new ConflictException("Its draft invoice is entered; cancel the invoice instead.");
        if (capture.status === "discarded") return this.view(client, workspaceId, id);
        await client.query(`UPDATE books_bill_captures SET status = 'discarded', version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "books_capture.discarded", entityType: "books_bill_capture", entityId: id, before: { status: capture.status } });
        return this.view(client, workspaceId, id);
      }
      const billId = uuid(body.billId, "Invoice");
      if (capture.status === "reading") throw new ConflictException("Woddy is still reading this bill.");
      if (capture.status === "discarded") throw new ConflictException("This capture was discarded.");
      if (capture.supplierInvoiceId && capture.supplierInvoiceId !== billId) throw new ConflictException("This bill is already captured as another invoice.");
      const bill = (await client.query<{ vendorId: string; legalEntityId: string }>(
        `SELECT vendor_id AS "vendorId", legal_entity_id AS "legalEntityId" FROM supplier_invoices WHERE workspace_id = $1 AND id = $2`, [workspaceId, billId])).rows[0];
      if (!bill) throw new NotFoundException("Invoice not found.");
      await client.query(
        `UPDATE books_bill_captures SET status = CASE WHEN status = 'read' THEN 'drafted' ELSE status END, supplier_invoice_id = $3, legal_entity_id = $4,
                confirmed_by = $5, confirmed_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, id, billId, bill.legalEntityId, user.userId]);
      await this.payables.linkCapturedFile(client as PoolClient, workspaceId, user.userId, billId,
        { name: capture.fileName, mimeType: capture.contentType, key: capture.storageKey, sha256: capture.sha256 });
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "books_capture.confirmed", entityType: "books_bill_capture", entityId: id,
        before: { status: capture.status, supplierInvoiceId: capture.supplierInvoiceId }, after: { supplierInvoiceId: billId, vendorId: bill.vendorId } });
      return this.view(client, workspaceId, id);
    });
  }

  /**
   * What a company's bill lines can name: its purchase tax codes in force on the day and the accounts a bill line
   * can be charged to. Empty, with `enabled` false, when the company doesn't keep its books in Wodana.
   */
  coding(actor: RequestActor, workspaceId: string, legalEntityId: string, onDay?: string) {
    if (onDay !== undefined && onDay !== "" && !DATE.test(onDay)) throw new BadRequestException("The day must be a date.");
    return this.access.withPermission(actor, workspaceId, "payables.view", async (client) => {
      const entity = uuid(legalEntityId, "Company");
      const settings = (await client.query<{ enabled: boolean }>(`SELECT enabled FROM books_settings WHERE workspace_id = $1 AND legal_entity_id = $2`, [workspaceId, entity])).rows[0];
      const taxCodes = await readPurchaseTaxCodes(client, workspaceId, entity, onDay || null);
      const accounts = (await client.query<{ id: string; code: string; name: string; type: string }>(
        `SELECT id, code, name, type FROM books_accounts
          WHERE workspace_id = $1 AND legal_entity_id = $2 AND archived_at IS NULL AND NOT is_control AND type IN ('expense', 'asset') ORDER BY code`,
        [workspaceId, entity])).rows;
      return { enabled: Boolean(settings), ledgerOn: Boolean(settings?.enabled), taxCodes, accounts };
    });
  }

  // ---------- reading ----------

  /** Reads the stored bill with the AI and, when the reading is enough, enters the draft invoice. Never throws. */
  async readAndDraft(actor: RequestActor, workspaceId: string, captureId: string, file: { body: Buffer; mimeType: string }, currency: string | null) {
    let reading: BillReading, raw: unknown, model: string;
    try {
      const answer = await this.ai.generate(actor, workspaceId, {
        feature: BILL_CAPTURE_FEATURE, timeoutMs: READ_TIMEOUT_MS,
        request: billReadingRequest({ mimeType: file.mimeType, base64: file.body.toString("base64") }, { currency }),
      });
      raw = JSON.parse(answer.text);
      reading = validateBillReading(raw);
      model = `${answer.provider}:${answer.model}`.slice(0, 120);
    } catch (error) {
      const message = error instanceof HttpException ? messageOf(error) : "Woddy couldn't read this bill. Enter it beside the photo.";
      // What failed, for the people who run the service: the HTTP status or the error's name, never the bill's content.
      await this.fail(actor, workspaceId, captureId, message, error instanceof HttpException ? `HTTP ${error.getStatus()}` : (error as Error)?.name ?? "unknown");
      return { status: "failed" as const };
    }
    const snapshot = { ...reading, raw: JSON.stringify(raw).length <= 100_000 ? raw : null };
    const proposal = await this.access.withPermission(actor, workspaceId, "payables.manage", async (client, user) => {
      const updated = await client.query(
        `UPDATE books_bill_captures SET status = 'read', reading = $3::jsonb, model = $4, confidence = $5, version = version + 1 WHERE workspace_id = $1 AND id = $2 AND status = 'reading'`,
        [workspaceId, captureId, JSON.stringify(snapshot), model, reading.confidence]);
      if (!updated.rowCount) return null;
      const found = await this.propose(client, workspaceId, reading, null);
      await client.query(`UPDATE books_bill_captures SET matched_vendor_id = $3, matched_order_id = $4, legal_entity_id = $5 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, captureId, found.vendorId, found.orderId, found.legalEntityId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "books_capture.read", entityType: "books_bill_capture", entityId: captureId,
        after: { model, confidence: reading.confidence, vendorId: found.vendorId, vendorMatch: found.vendorMatch, orderId: found.orderId, warnings: found.warnings.map((item) => item.code) } });
      return found;
    }).catch(() => null);
    if (!proposal?.ready) return { status: "read" as const, proposal };
    // The draft goes in through the payables command, as if the person had typed it; it stays a draft.
    const billId = randomUUID();
    try {
      await this.payables.command(actor, workspaceId, {
        action: "save", commandId: randomUUID(), id: billId, vendorId: proposal.vendorId, legalEntityId: proposal.legalEntityId, currency: proposal.currency, number: proposal.number,
        invoiceDate: proposal.invoiceDate, dueDate: proposal.dueDate, statedTotal: proposal.statedTotal,
        lines: proposal.lines.map((line) => ({ orderLineId: line.orderLineId, projectId: line.orderLineId ? null : line.projectId, description: line.description, quantity: line.quantity,
          unitPrice: line.unitPrice, taxRate: line.taxRate, taxCode: line.taxCode })),
      });
    } catch {
      // Something the draft can't hold (a closed period, a rule the reading didn't meet): the person completes it.
      return { status: "read" as const, proposal };
    }
    await this.access.withPermission(actor, workspaceId, "payables.manage", async (client, user) => {
      await client.query(`UPDATE books_bill_captures SET status = 'drafted', supplier_invoice_id = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2 AND status = 'read'`,
        [workspaceId, captureId, billId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "books_capture.drafted", entityType: "books_bill_capture", entityId: captureId, after: { supplierInvoiceId: billId } });
    });
    return { status: "drafted" as const, proposal };
  }

  /**
   * The bill a reading proposes: the supplier (tax number, then name), the company it's addressed to (the buyer's
   * tax number, else the order's company, else the supplier's only company, else the workspace's only one), the
   * order its PO number names, the lines, and what stops a draft.
   */
  async propose(client: Db, workspaceId: string, reading: BillReading, ownBillId: string | null): Promise<CaptureProposal> {
    const vendors = (await client.query<{ id: string; name: string; legalName: string | null; taxNumber: string | null; currency: string | null }>(
      `SELECT id, display_name AS name, legal_name AS "legalName", tax_registration_number AS "taxNumber", default_currency AS currency
         FROM workspace_vendors WHERE workspace_id = $1 AND status <> 'archived' ORDER BY display_name LIMIT 5000`, [workspaceId])).rows;
    const match = matchVendor(reading, vendors);
    const vendor = match ? vendors.find((item) => item.id === match.vendorId)! : null;
    const warnings: CaptureWarning[] = [];
    if (!vendor) warnings.push({ code: "supplier_not_found", name: reading.supplierName, taxNumber: reading.supplierTaxNumber });
    const companies = (await client.query<{ id: string; currency: string; taxNumber: string | null }>(
      `SELECT id, base_currency AS currency, tax_registration_number AS "taxNumber" FROM legal_entities WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY display_name`, [workspaceId])).rows;

    let order: { id: string; number: string; legalEntityId: string; currency: string } | null = null;
    if (vendor && reading.poNumber) {
      const orders = (await client.query<{ id: string; number: string; legalEntityId: string; currency: string }>(
        `SELECT id, number, legal_entity_id AS "legalEntityId", currency FROM purchase_orders WHERE workspace_id = $1 AND vendor_id = $2 AND status = ANY($3::text[])
          ORDER BY created_at DESC LIMIT 500`, [workspaceId, vendor.id, INVOICEABLE_ORDERS])).rows.filter((item) => sameOrderNumber(reading.poNumber, item.number));
      order = orders.length === 1 ? orders[0] : null;
    }
    const buyerKey = taxNumberKey(reading.buyerTaxNumber);
    const byTax = buyerKey.length >= 5 ? companies.filter((company) => taxNumberKey(company.taxNumber) === buyerKey) : [];
    const supplied = vendor ? (await client.query<{ id: string }>(
      `SELECT link.legal_entity_id AS id FROM vendor_legal_entities link JOIN legal_entities company ON company.workspace_id = link.workspace_id AND company.id = link.legal_entity_id
        WHERE link.workspace_id = $1 AND link.vendor_id = $2 AND company.archived_at IS NULL`, [workspaceId, vendor.id])).rows : [];
    const legalEntityId = byTax.length === 1 ? byTax[0].id : order?.legalEntityId ?? (supplied.length === 1 ? supplied[0].id : companies.length === 1 ? companies[0].id : null);
    const company = companies.find((item) => item.id === legalEntityId) ?? null;
    const workspaceCurrency = (await client.query<{ currency: string | null }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? null;
    const currency = reading.currency ?? order?.currency ?? vendor?.currency ?? company?.currency ?? workspaceCurrency;

    const orderLines = order ? (await readInvoiceable(client, workspaceId, order.id)).map((line) => ({
      orderLineId: line.orderLineId, description: line.description, unit: line.unit, ordered: line.ordered, billed: line.billed, left: line.left,
      netUnitPrice: line.netUnitPrice, taxRate: line.taxRate, projectId: line.projectId, projectReference: line.projectReference,
    })) : [];
    const taxCodes = legalEntityId ? await readPurchaseTaxCodes(client, workspaceId, legalEntityId, reading.invoiceDate) : [];
    const drafted = currency ? proposeLines({ reading, currency, order: order ? { number: order.number, currency: order.currency, lines: orderLines } : null, taxCodes })
      : { lines: [], statedTotal: null, warnings: [] };
    warnings.push(...drafted.warnings);

    if (vendor && reading.invoiceNumber) {
      const duplicate = (await client.query<{ id: string; number: string }>(
        `SELECT id, number FROM supplier_invoices WHERE workspace_id = $1 AND vendor_id = $2 AND lower(btrim(number)) = lower(btrim($3)) AND status <> 'cancelled'
            AND ($4::uuid IS NULL OR id <> $4) ORDER BY created_at LIMIT 1`, [workspaceId, vendor.id, reading.invoiceNumber, ownBillId])).rows[0];
      if (duplicate) warnings.push({ code: "duplicate_bill", billId: duplicate.id, number: duplicate.number });
    }
    const today = (await client.query<{ today: string }>(
      `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.today ?? null;
    if (reading.invoiceDate && today && reading.invoiceDate > today) warnings.push({ code: "future_date", date: reading.invoiceDate });
    const dueDate = reading.dueDate && reading.invoiceDate && reading.dueDate >= reading.invoiceDate ? reading.dueDate : null;
    const blocked = warnings.some((item) => ["duplicate_bill", "future_date", "supplier_not_found"].includes(item.code));
    const ready = Boolean(vendor && legalEntityId && currency && reading.invoiceNumber && reading.invoiceDate && !blocked && drafted.lines.length
      && drafted.lines.every((line) => line.unitPrice !== null && Dec.of(line.quantity).cmp(0) > 0));
    return {
      vendorId: vendor?.id ?? null, vendorName: vendor?.name ?? null, vendorMatch: match?.method ?? null, legalEntityId, currency, orderId: order?.id ?? null, orderNumber: order?.number ?? null,
      number: reading.invoiceNumber, invoiceDate: reading.invoiceDate, dueDate, statedTotal: drafted.statedTotal, lines: drafted.lines, warnings, hints: fieldHints(reading), ready,
    };
  }

  // ---------- helpers ----------

  /** A reading that failed: the capture says why (the person enters the bill beside the photo, or tries again), logged and audited. */
  private async fail(actor: RequestActor, workspaceId: string, captureId: string, message: string, cause: string) {
    this.logger.warn(`Bill capture ${captureId} (workspace ${workspaceId}) wasn't read: ${cause}`);
    await this.access.withPermission(actor, workspaceId, "payables.manage", async (client, user) => {
      const failed = await client.query(`UPDATE books_bill_captures SET status = 'failed', error = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2 AND status = 'reading'`,
        [workspaceId, captureId, message.slice(0, 1000)]);
      if (failed.rowCount) await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "books_capture.failed", entityType: "books_bill_capture", entityId: captureId, after: { error: message, cause } });
    }).catch(() => undefined);
  }

  private async view(client: Db, workspaceId: string, captureId: string) {
    const row = (await client.query<CaptureRow>(`${CAPTURE_SELECT} WHERE capture.workspace_id = $1 AND capture.id = $2`, [workspaceId, captureId])).rows[0];
    if (!row) throw new NotFoundException("Capture not found.");
    const { reading: stored, storageKey: _key, ...capture } = row;
    const reading = stored ? withoutRaw(stored) : null;
    const proposal = reading && ["read", "drafted"].includes(row.status) ? await this.propose(client, workspaceId, reading, row.supplierInvoiceId) : null;
    return { capture: { ...capture, billId: row.supplierInvoiceId }, reading, proposal };
  }

  private async liveCapture(client: Db, workspaceId: string, sha256: string) {
    return (await client.query<{ id: string }>(
      `SELECT id FROM books_bill_captures WHERE workspace_id = $1 AND sha256 = $2 AND status NOT IN ('discarded', 'failed') LIMIT 1`, [workspaceId, sha256])).rows[0]?.id ?? null;
  }

  /** books.capture_read: the uploader hears once a reading that outlasted the upload has finished, read or not. */
  private async tellRead(actor: RequestActor, workspaceId: string, captureId: string, userId: string, outcome: { status: "failed" | "read" | "drafted"; proposal?: CaptureProposal | null }) {
    await this.access.withPermission(actor, workspaceId, "payables.view", async (client) => {
      const proposal = outcome.status === "failed" ? null : outcome.proposal ?? null;
      const supplier = proposal?.vendorName ?? null;
      const total = proposal?.statedTotal && proposal.currency ? `${proposal.currency} ${Dec.of(proposal.statedTotal).toFixed(currencyDecimals(proposal.currency))}` : "";
      const title = outcome.status === "failed" ? "Bill photo not read" : supplier ? `Bill read: ${supplier}${proposal?.number ? ` ${proposal.number}` : ""}` : "Bill read";
      const note = outcome.status === "failed" ? "Enter it beside the photo."
        : outcome.status === "drafted" ? `Draft invoice ready to check${total ? `: ${total}` : ""}.` : "Check it and complete the invoice.";
      await notifyUserInApp(client, { workspaceId, recipientUserId: userId, code: "books.capture_read", eventType: "books.capture_read",
        variables: { title: title.slice(0, 200), note }, deepLink: `/workspace/finance/bills?capture=${captureId}`, idempotencyKey: `books.capture_read:${captureId}` });
    });
  }
}

/** A company's purchase tax codes in force on a day (today when no day is given). */
export async function readPurchaseTaxCodes(db: Db, workspaceId: string, legalEntityId: string, onDay: string | null): Promise<Array<PurchaseTaxCode & { name: string }>> {
  return (await db.query<PurchaseTaxCode & { name: string }>(
    `SELECT DISTINCT ON (code) code, name, rate::text AS rate, treatment FROM books_tax_codes
      WHERE workspace_id = $1 AND legal_entity_id = $2 AND direction = 'purchases' AND archived_at IS NULL
        AND effective_from <= coalesce($3::date, current_date) AND (effective_to IS NULL OR effective_to >= coalesce($3::date, current_date))
      ORDER BY code, effective_from DESC`, [workspaceId, legalEntityId, onDay])).rows;
}

function withoutRaw(reading: BillReading & { raw?: unknown }): BillReading {
  const { raw: _raw, ...rest } = reading;
  return rest;
}

function messageOf(error: HttpException) {
  const response = error.getResponse();
  const message = typeof response === "string" ? response : typeof (response as { message?: unknown }).message === "string" ? String((response as { message: string }).message) : error.message;
  return message || "Woddy couldn't read this bill. Enter it beside the photo.";
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} is not valid.`);
  return value;
}
