import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { renderBrandedEmail } from "../email/branded-email";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { currencyDecimals, ensurePurchasingSettings } from "./orders";
import { OrdersService } from "./orders.service";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RequestLine = { id: string; position: number; projectId: string | null; projectReference: string | null; source: "material" | "line" | "free"; materialItemId: string | null; boqLineId: string | null;
  description: string; specification: string; quantity: string; unit: string; awardedVendorId: string | null; awardReason: string; orderId: string | null };

/**
 * Price requests: the same lines asked of several suppliers (any supplier may be asked; only approved
 * ones get orders), their prices recorded as they reply, and each line awarded to one supplier — with
 * the reason when it isn't the cheapest. Awarding writes one draft order per supplier at those prices.
 */
@Injectable()
export class PriceRequestsService {
  private readonly logger = new Logger(PriceRequestsService.name);

  constructor(private readonly access: WorkspaceAccessService, private readonly orders: OrdersService, @Optional() private readonly email?: TransactionalEmailService) {}

  list(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "purchasing.view", async (client, user) => ({
      requests: (await client.query<{ id: string; number: number; status: string; neededBy: string | null; createdAt: string; createdByName: string; lines: number; suppliers: number; replied: number; projects: string[] }>(
        `SELECT request.id, request.number, request.status, request.needed_by::text AS "neededBy", request.created_at AS "createdAt", creator.display_name AS "createdByName",
                (SELECT count(*)::int FROM price_request_lines line WHERE line.workspace_id = request.workspace_id AND line.request_id = request.id) AS lines,
                (SELECT count(*)::int FROM price_request_suppliers asked WHERE asked.workspace_id = request.workspace_id AND asked.request_id = request.id) AS suppliers,
                (SELECT count(*)::int FROM price_request_suppliers asked WHERE asked.workspace_id = request.workspace_id AND asked.request_id = request.id AND asked.status = 'replied') AS replied,
                coalesce((SELECT array_agg(DISTINCT project.reference) FROM price_request_lines line JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
                           WHERE line.workspace_id = request.workspace_id AND line.request_id = request.id), '{}') AS projects
           FROM price_requests request JOIN users creator ON creator.id = request.created_by
          WHERE request.workspace_id = $1 ORDER BY request.created_at DESC LIMIT 500`, [workspaceId])).rows,
      canBuy: await this.access.hasPermission(client, workspaceId, user.userId, "purchasing.manage"),
    }));
  }

  get(actor: RequestActor, workspaceId: string, requestId: string) {
    return this.access.withPermission(actor, workspaceId, "purchasing.view", async (client, user) => this.detail(client, workspaceId, requestId, user.userId));
  }

  /** Asks the chosen suppliers for prices on the lines. Creating it again with the same id changes nothing. */
  create(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "purchasing.manage", async (client, user) => {
      const id = uuid(body.id, "Price request");
      if ((await client.query(`SELECT 1 FROM price_requests WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) return { ...(await this.detail(client, workspaceId, id, user.userId)), asks: [] };
      const vendorIds = Array.isArray(body.vendorIds) ? [...new Set(body.vendorIds.map((item) => uuid(item, "Supplier")))] : [];
      if (!vendorIds.length || vendorIds.length > 12) throw new BadRequestException("Ask between 1 and 12 suppliers.");
      const suppliers = [];
      for (const vendorId of vendorIds) suppliers.push(await this.orders.orderableSupplier(client, workspaceId, vendorId));
      const companies = (await client.query<{ id: string; currency: string }>(`SELECT id, base_currency AS currency FROM legal_entities WHERE workspace_id = $1 AND status = 'active'`, [workspaceId])).rows;
      const legalEntityId = typeof body.legalEntityId === "string" && UUID.test(body.legalEntityId) ? body.legalEntityId : companies.length === 1 ? companies[0].id : null;
      const company = companies.find((item) => item.id === legalEntityId);
      if (!company) throw new BadRequestException("Choose which of your companies is buying.");
      const lines = this.lineInputs(body.lines);
      // The same checks as an order's lines (running projects, what each line is for), without prices.
      const checked = await this.orders.checkLines(client, workspaceId, lines.map((line) => ({ ...line, unitPrice: "0" })), company.currency);
      await ensurePurchasingSettings(client, workspaceId);
      await client.query(`SELECT 1 FROM workspace_purchasing_settings WHERE workspace_id = $1 FOR UPDATE`, [workspaceId]);
      const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM price_requests WHERE workspace_id = $1`, [workspaceId])).rows[0].next;
      const neededBy = date(body.neededBy, "Needed by");
      await client.query(`INSERT INTO price_requests (id, workspace_id, number, needed_by, notes, currency, legal_entity_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, workspaceId, number, neededBy, text(body.notes, 2000, "Notes"), company.currency, company.id, user.userId]);
      for (const [position, line] of checked.entries())
        await client.query(`INSERT INTO price_request_lines (id, workspace_id, request_id, position, project_id, source, material_item_id, boq_line_id, description, specification, quantity, unit)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [line.id, workspaceId, id, position, line.projectId, line.source, line.materialItemId, line.boqLineId, line.description, line.specification, line.quantity, line.unit]);
      const asks: Array<{ to: string; supplier: string }> = [];
      for (const supplier of suppliers) {
        const to = body.send === true && supplier.email && EMAIL.test(supplier.email) ? supplier.email : null;
        await client.query(`INSERT INTO price_request_suppliers (workspace_id, request_id, vendor_id, asked_to) VALUES ($1, $2, $3, $4)`, [workspaceId, id, supplier.id, to]);
        if (to) asks.push({ to, supplier: supplier.name });
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "price_request.created", entityType: "price_request", entityId: id, after: { number, suppliers: vendorIds, lines: checked.length } });
      return { ...(await this.detail(client, workspaceId, id, user.userId)), asks };
    }).then(async (result) => {
      // Each supplier gets the lines by email once the request is saved.
      for (const ask of result.asks) await this.emailSupplier(workspaceId, result, ask.to);
      return result;
    });
  }

  command(actor: RequestActor, workspaceId: string, requestId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "purchasing.manage", async (client, user) => {
      const request = (await client.query<{ status: string; version: number; currency: string; legalEntityId: string; neededBy: string | null; number: number }>(
        `SELECT status, version, currency, legal_entity_id AS "legalEntityId", needed_by::text AS "neededBy", number FROM price_requests WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [workspaceId, requestId])).rows[0];
      if (!request) throw new NotFoundException("Price request not found.");
      if (body.version !== request.version) throw new ConflictException("Someone else changed this price request. Reload to see their changes.");
      if (request.status !== "open") throw new ConflictException(request.status === "awarded" ? "This price request is already awarded." : "This price request is cancelled.");
      const action = String(body.action ?? "");
      const lines = await this.readLines(client, workspaceId, requestId);
      let audit: Record<string, unknown> = {};

      if (action === "record_reply" || action === "decline") {
        const vendorId = uuid(body.vendorId, "Supplier");
        const asked = (await client.query(`SELECT 1 FROM price_request_suppliers WHERE workspace_id = $1 AND request_id = $2 AND vendor_id = $3 FOR UPDATE`, [workspaceId, requestId, vendorId])).rowCount;
        if (!asked) throw new NotFoundException("That supplier wasn't asked.");
        if (action === "decline") {
          await client.query(`DELETE FROM price_request_quotes WHERE workspace_id = $1 AND request_id = $2 AND vendor_id = $3`, [workspaceId, requestId, vendorId]);
          await client.query(`UPDATE price_request_suppliers SET status = 'declined', note = $4, replied_at = now() WHERE workspace_id = $1 AND request_id = $2 AND vendor_id = $3`,
            [workspaceId, requestId, vendorId, text(body.note, 1000, "Note")]);
          audit = { vendorId, declined: true };
        } else {
          const prices = Array.isArray(body.prices) ? body.prices as Array<Record<string, unknown>> : [];
          const known = new Set(lines.map((line) => line.id));
          await client.query(`DELETE FROM price_request_quotes WHERE workspace_id = $1 AND request_id = $2 AND vendor_id = $3`, [workspaceId, requestId, vendorId]);
          let priced = 0;
          for (const price of prices) {
            const lineId = uuid(price.lineId, "Line");
            if (!known.has(lineId)) throw new BadRequestException("That line isn't on this request.");
            if (price.unitPrice === null || price.unitPrice === undefined || price.unitPrice === "") continue;
            const unitPrice = amount(price.unitPrice, "Price");
            const discount = price.discountPercent === undefined || price.discountPercent === null || price.discountPercent === "" ? "0" : amount(price.discountPercent, "Discount");
            if (Dec.of(discount).cmp(100) >= 0) throw new BadRequestException("The discount is under 100%.");
            await client.query(`INSERT INTO price_request_quotes (workspace_id, request_id, vendor_id, line_id, unit_price, discount_percent) VALUES ($1, $2, $3, $4, $5, $6)`,
              [workspaceId, requestId, vendorId, lineId, unitPrice, discount]);
            priced++;
          }
          if (!priced) throw new BadRequestException("Enter at least one price.");
          const lead = body.leadTimeDays === undefined || body.leadTimeDays === null || body.leadTimeDays === "" ? null : Number(body.leadTimeDays);
          if (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > 3650)) throw new BadRequestException("Lead time is a whole number of days.");
          await client.query(`UPDATE price_request_suppliers SET status = 'replied', lead_time_days = $4, valid_until = $5, note = $6, replied_at = now() WHERE workspace_id = $1 AND request_id = $2 AND vendor_id = $3`,
            [workspaceId, requestId, vendorId, lead, date(body.validUntil, "Valid until"), text(body.note, 1000, "Note")]);
          audit = { vendorId, priced };
        }
      } else if (action === "add_supplier") {
        const supplier = await this.orders.orderableSupplier(client, workspaceId, uuid(body.vendorId, "Supplier"));
        await client.query(`INSERT INTO price_request_suppliers (workspace_id, request_id, vendor_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [workspaceId, requestId, supplier.id]);
        audit = { vendorId: supplier.id };
      } else if (action === "award") {
        const awards = Array.isArray(body.awards) ? body.awards as Array<Record<string, unknown>> : [];
        const quotes = await this.readQuotes(client, workspaceId, requestId);
        const decimals = currencyDecimals(request.currency);
        const net = (quote: { unitPrice: string; discountPercent: string }) => Dec.of(quote.unitPrice).mul(Dec.of(100).sub(quote.discountPercent)).div(100).round(decimals);
        const chosen = new Map<string, { vendorId: string; reason: string }>();
        for (const award of awards) {
          const line = lines.find((item) => item.id === award.lineId);
          if (!line) throw new BadRequestException("That line isn't on this request.");
          const vendorId = uuid(award.vendorId, "Supplier");
          const quote = quotes.find((item) => item.lineId === line.id && item.vendorId === vendorId);
          if (!quote) throw new BadRequestException(`${line.description}: that supplier hasn't priced it.`);
          const cheapest = quotes.filter((item) => item.lineId === line.id).reduce((best, item) => (net(item).cmp(net(best)) < 0 ? item : best), quote);
          const reason = text(award.reason, 500, "Reason");
          if (net(cheapest).cmp(net(quote)) < 0 && !reason) throw new BadRequestException(`${line.description}: say why it isn't going to the cheapest supplier.`);
          chosen.set(line.id, { vendorId, reason });
        }
        if (chosen.size !== lines.length) throw new BadRequestException("Award every line to a supplier.");
        const settings = await ensurePurchasingSettings(client, workspaceId);
        const orders: Array<{ id: string; number: string; vendorId: string }> = [];
        for (const vendorId of new Set([...chosen.values()].map((item) => item.vendorId))) {
          const supplier = await this.orders.orderableSupplier(client, workspaceId, vendorId);
          if (settings.requireApprovedSupplier && supplier.approval !== "approved") throw new ConflictException(`${supplier.name} isn't approved as a supplier yet, so it can't get the order.`);
          const legalEntityId = await this.orders.buyingCompany(client, workspaceId, supplier, request.legalEntityId);
          const mine = lines.filter((line) => chosen.get(line.id)!.vendorId === vendorId);
          const orderId = randomUUID();
          const created = await this.orders.createDraft(client, workspaceId, user.userId, {
            id: orderId, supplier, legalEntityId, currency: request.currency, from: { priceRequest: request.number },
            header: { deliverTo: "site", deliveryAddress: "", expectedDate: request.neededBy, notes: "" },
            lines: mine.map((line) => {
              const quote = quotes.find((item) => item.lineId === line.id && item.vendorId === vendorId)!;
              return { source: line.source, materialItemId: line.materialItemId, boqLineId: line.boqLineId, projectId: line.projectId, description: line.description, specification: line.specification,
                quantity: line.quantity, unit: line.unit, unitPrice: quote.unitPrice, discountPercent: quote.discountPercent };
            }),
          });
          for (const line of mine)
            await client.query(`UPDATE price_request_lines SET awarded_vendor_id = $3, award_reason = $4, order_id = $5 WHERE workspace_id = $1 AND id = $2`,
              [workspaceId, line.id, vendorId, chosen.get(line.id)!.reason, orderId]);
          orders.push({ id: orderId, number: created.number, vendorId });
        }
        await client.query(`UPDATE price_requests SET status = 'awarded', awarded_by = $3, awarded_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, requestId, user.userId]);
        audit = { orders };
      } else if (action === "cancel") {
        const reason = text(body.reason, 500, "Reason");
        if (!reason) throw new BadRequestException("Say why the price request is cancelled.");
        await client.query(`UPDATE price_requests SET status = 'cancelled', cancel_reason = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, requestId, reason]);
        audit = { reason };
      } else {
        throw new BadRequestException("Unknown action.");
      }
      await client.query(`UPDATE price_requests SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, requestId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `price_request.${action}`, entityType: "price_request", entityId: requestId, after: audit });
      return this.detail(client, workspaceId, requestId, user.userId);
    });
  }

  // ---------- reads ----------
  private async detail(client: Db, workspaceId: string, requestId: string, userId: string) {
    const request = (await client.query<{ id: string; number: number; status: string; neededBy: string | null; notes: string; currency: string; legalEntityId: string; companyName: string;
      createdByName: string; createdAt: string; awardedAt: string | null; cancelReason: string | null; version: number }>(
      `SELECT request.id, request.number, request.status, request.needed_by::text AS "neededBy", request.notes, request.currency, request.legal_entity_id AS "legalEntityId",
              entity.display_name AS "companyName", creator.display_name AS "createdByName", request.created_at AS "createdAt", request.awarded_at AS "awardedAt",
              request.cancel_reason AS "cancelReason", request.version
         FROM price_requests request JOIN legal_entities entity ON entity.workspace_id = request.workspace_id AND entity.id = request.legal_entity_id
         JOIN users creator ON creator.id = request.created_by WHERE request.workspace_id = $1 AND request.id = $2`, [workspaceId, requestId])).rows[0];
    if (!request) throw new NotFoundException("Price request not found.");
    const suppliers = (await client.query<{ vendorId: string; name: string; approval: string; email: string | null; status: string; askedTo: string | null; leadTimeDays: number | null; validUntil: string | null; note: string; repliedAt: string | null }>(
      `SELECT asked.vendor_id AS "vendorId", vendor.display_name AS name, vendor.approval, site.email, asked.status, asked.asked_to AS "askedTo", asked.lead_time_days AS "leadTimeDays",
              asked.valid_until::text AS "validUntil", asked.note, asked.replied_at AS "repliedAt"
         FROM price_request_suppliers asked JOIN workspace_vendors vendor ON vendor.workspace_id = asked.workspace_id AND vendor.id = asked.vendor_id
         LEFT JOIN LATERAL (SELECT email FROM workspace_vendor_sites WHERE workspace_id = vendor.workspace_id AND vendor_id = vendor.id AND status = 'active' ORDER BY is_primary DESC LIMIT 1) site ON true
        WHERE asked.workspace_id = $1 AND asked.request_id = $2 ORDER BY vendor.display_name`, [workspaceId, requestId])).rows;
    const lines = await this.readLines(client, workspaceId, requestId);
    const quotes = await this.readQuotes(client, workspaceId, requestId);
    const decimals = currencyDecimals(request.currency);
    // Each quote's line amount (net of discount), and the cheapest supplier per line.
    const priced = quotes.map((quote) => {
      const line = lines.find((item) => item.id === quote.lineId)!;
      const net = Dec.of(line.quantity).mul(quote.unitPrice).mul(Dec.of(100).sub(quote.discountPercent)).div(100).round(decimals);
      return { ...quote, net: net.toFixed(decimals) };
    });
    const cheapest = Object.fromEntries(lines.map((line) => {
      const options = priced.filter((quote) => quote.lineId === line.id);
      const best = options.reduce<typeof options[number] | null>((found, quote) => (!found || Dec.of(quote.net).cmp(found.net) < 0 ? quote : found), null);
      return [line.id, best?.vendorId ?? null];
    }));
    const totals = Object.fromEntries(suppliers.map((supplier) => {
      const mine = priced.filter((quote) => quote.vendorId === supplier.vendorId);
      return [supplier.vendorId, { net: mine.reduce((sum, quote) => sum.add(quote.net), Dec.ZERO).toFixed(decimals), priced: mine.length }];
    }));
    const orders = (await client.query<{ id: string; number: string; vendorId: string }>(
      `SELECT DISTINCT purchase.id, purchase.number, purchase.vendor_id AS "vendorId" FROM price_request_lines line JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
        WHERE line.workspace_id = $1 AND line.request_id = $2`, [workspaceId, requestId])).rows;
    return { request, suppliers, lines, quotes: priced, cheapest, totals, orders, canBuy: await this.access.hasPermission(client, workspaceId, userId, "purchasing.manage") };
  }

  private async readLines(client: Db, workspaceId: string, requestId: string): Promise<RequestLine[]> {
    return (await client.query<RequestLine>(
      `SELECT line.id, line.position, line.project_id AS "projectId", project.reference AS "projectReference", line.source, line.material_item_id AS "materialItemId", line.boq_line_id AS "boqLineId",
              line.description, line.specification, line.quantity::text AS quantity, line.unit, line.awarded_vendor_id AS "awardedVendorId", line.award_reason AS "awardReason", line.order_id AS "orderId"
         FROM price_request_lines line LEFT JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
        WHERE line.workspace_id = $1 AND line.request_id = $2 ORDER BY line.position`, [workspaceId, requestId])).rows;
  }

  private async readQuotes(client: Db, workspaceId: string, requestId: string) {
    return (await client.query<{ vendorId: string; lineId: string; unitPrice: string; discountPercent: string }>(
      `SELECT vendor_id AS "vendorId", line_id AS "lineId", unit_price::text AS "unitPrice", discount_percent::text AS "discountPercent" FROM price_request_quotes WHERE workspace_id = $1 AND request_id = $2`,
      [workspaceId, requestId])).rows;
  }

  private lineInputs(value: unknown) {
    if (!Array.isArray(value) || !value.length) throw new BadRequestException("Add at least one line.");
    if (value.length > 200) throw new BadRequestException("A price request has up to 200 lines.");
    return value.map((raw) => ({ ...((raw ?? {}) as Record<string, unknown>), id: randomUUID() }));
  }

  /** The lines to price, in the firm's branded email. Never throws. */
  private async emailSupplier(workspaceId: string, detail: Awaited<ReturnType<PriceRequestsService["detail"]>>, to: string) {
    if (!this.email) return;
    try {
      const brand = await this.email.brand({ workspaceId });
      const paragraphs = [
        `Please send us your prices for the following${detail.request.neededBy ? `, needed by ${detail.request.neededBy}` : ""}:`,
        ...detail.lines.map((line) => `${line.description}${line.specification ? ` (${line.specification})` : ""}: ${Dec.of(line.quantity).toString()} ${line.unit}`),
        ...(detail.request.notes ? [detail.request.notes] : []),
        `Price request ${detail.request.number} from ${detail.request.companyName}. Please include your delivery time and how long the prices are valid.`,
      ];
      const { html, text: plain } = renderBrandedEmail({ brand, preheader: `Price request ${detail.request.number}`, heading: `Price request ${detail.request.number}`, paragraphs });
      await this.email.send({ to, subject: `Price request ${detail.request.number} · ${detail.request.companyName}`, text: plain, html, fromName: brand.name });
    } catch (error) {
      this.logger.error(`Couldn't email price request ${detail.request.number}: ${(error as Error).message}`);
    }
  }
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

function amount(value: unknown, label: string) {
  const textValue = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!NUMBER.test(textValue)) throw new BadRequestException(`${label} must be a number with up to 4 decimals.`);
  return textValue;
}

function date(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  return value;
}
