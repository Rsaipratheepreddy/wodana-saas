import { randomUUID as randomUUIDv4 } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { currencyDecimals } from "../catalog-core/catalog-v2.service";
import { Dec } from "../catalog-core/decimal";
import { FormulaError } from "../catalog-core/formula";
import { parsePaymentTerms } from "../commercial/commercial.domain";
import { effectivePortalBrand } from "../commercial/effective-brand";
import { defaultDocument, parseDocument, type QuoteDocument } from "./quote-document";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { catalogLine, searchCatalog } from "./quote-catalog";
import { priceQuote, PricingError, type PricingPolicy, type QuoteDiscountInput } from "./quote-pricing";
import { buildUp, checkFormula, lineQuantity } from "./quote-quantity";

type Db = PoolClient;
const VIEW = "pre_projects.view", EDIT = "pre_projects.edit";
const SETTINGS = ["workspace.settings.manage", "finance.settings.manage"];
export const LINE_KINDS = ["item", "service", "allowance", "client_supplied", "relocate", "dismantle", "remove_store", "dispose"] as const;
const COMPONENT_KINDS = ["material", "finish", "hardware", "labour", "other"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type QuotationSettings = {
  defaultView: "area" | "trade" | "area_trade"; pricesIncludeTax: boolean; rounding: "line" | "document";
  defaultMarkupPercent: string; marginFloorPercent: string | null; discountApprovalPercent: string | null;
  validityDays: number; internalReview: boolean; priceBookId: string | null; version: number;
};
const DEFAULT_SETTINGS: QuotationSettings = {
  defaultView: "area", pricesIncludeTax: false, rounding: "line", defaultMarkupPercent: "0", marginFloorPercent: null,
  discountApprovalPercent: null, validityDays: 30, internalReview: true, priceBookId: null, version: 0,
};

type LineRow = {
  id: string; position: number; version: number; kind: string; areaId: string | null; fromAreaId: string | null; workPackageId: string | null;
  title: string; description: string; unit: string; quantity: string; formula: string | null; length: string | null; width: string | null;
  height: string | null; count: string | null; dimensionUnit: string | null; rate: string; unitCost: string | null; markupPercent: string | null;
  pricingMode: "rate" | "build_up"; discountKind: "percent" | "amount" | null; discountValue: string | null; taxCode: string | null;
  taxRate: string | null; optional: boolean | null; optionGroup: string | null; note: string; catalogItemId: string | null;
  catalogSnapshot: Record<string, unknown> | null; updatedAt: string; updatedByName: string | null;
};
type ComponentRow = {
  id: string; lineId: string; kind: string; catalogItemId: string | null; name: string; quantityFormula: string | null; quantity: string;
  unit: string; unitCost: string | null; rate: string | null; wastePercent: string | null; suppliedByClient: boolean;
};
type Quote = { id: string; number: number; title: string; status: string; currency: string; kind: string; round: string | null; familyId: string | null; taxRate: string; validUntil: string | null; detail: Record<string, unknown> };

/**
 * The quotation builder (plan §6.8): one flat list of lines per quote with an area and a trade each,
 * edited line by line. Every command is validated, version-checked per line (a replay of the same
 * change is accepted), priced by the shared engine and audited. The quote's total and the case
 * revision move with every change, so the existing issue, portal and release flows see exactly
 * what the builder shows.
 */
@Injectable()
export class QuotationBuilderService {
  constructor(private readonly access: WorkspaceAccessService) {}

  // ---------- settings and trades ----------
  settings(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => ({
      settings: await readSettings(client, workspaceId),
      workPackages: await workPackages(client, workspaceId, true),
      priceBooks: (await client.query(`SELECT id, name, currency, status FROM price_books WHERE workspace_id = $1 AND status <> 'expired' ORDER BY name`, [workspaceId])).rows,
      canManage: await this.anyPermission(client, workspaceId, user.userId, SETTINGS),
    }));
  }

  saveSettings(actor: RequestActor, workspaceId: string, input: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, SETTINGS, async (client, user) => {
      const current = await readSettings(client, workspaceId);
      if (Number(input.version) !== current.version) throw new ConflictException("Someone changed these settings. Reload to see the latest.");
      const next = { ...current };
      if (input.defaultView !== undefined) next.defaultView = oneOf(input.defaultView, ["area", "trade", "area_trade"] as const, "view");
      if (input.pricesIncludeTax !== undefined) next.pricesIncludeTax = bool(input.pricesIncludeTax);
      if (input.rounding !== undefined) next.rounding = oneOf(input.rounding, ["line", "document"] as const, "rounding");
      if (input.defaultMarkupPercent !== undefined) next.defaultMarkupPercent = decimal(input.defaultMarkupPercent, "Markup", { max: "1000" })!;
      if (input.marginFloorPercent !== undefined) next.marginFloorPercent = decimal(input.marginFloorPercent, "Margin floor", { max: "99.99", nullable: true });
      if (input.discountApprovalPercent !== undefined) next.discountApprovalPercent = decimal(input.discountApprovalPercent, "Discount approval", { max: "100", nullable: true });
      if (input.validityDays !== undefined) {
        const days = Number(input.validityDays);
        if (!Number.isInteger(days) || days < 1 || days > 365) throw new BadRequestException("Validity is 1 to 365 days.");
        next.validityDays = days;
      }
      if (input.internalReview !== undefined) next.internalReview = bool(input.internalReview);
      if (input.priceBookId !== undefined) {
        next.priceBookId = input.priceBookId === null ? null : uuid(input.priceBookId, "Price book");
        if (next.priceBookId && !(await client.query(`SELECT 1 FROM price_books WHERE workspace_id = $1 AND id = $2`, [workspaceId, next.priceBookId])).rowCount)
          throw new BadRequestException("Choose a price book from your catalog.");
      }
      await client.query(
        `INSERT INTO workspace_quotation_settings (workspace_id, default_view, prices_include_tax, rounding, default_markup_percent, margin_floor_percent,
           discount_approval_percent, validity_days, internal_review, price_book_id, version, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, now())
         ON CONFLICT (workspace_id) DO UPDATE SET default_view = excluded.default_view, prices_include_tax = excluded.prices_include_tax,
           rounding = excluded.rounding, default_markup_percent = excluded.default_markup_percent, margin_floor_percent = excluded.margin_floor_percent,
           discount_approval_percent = excluded.discount_approval_percent, validity_days = excluded.validity_days, internal_review = excluded.internal_review,
           price_book_id = excluded.price_book_id, version = workspace_quotation_settings.version + 1, updated_by = excluded.updated_by, updated_at = now()`,
        [workspaceId, next.defaultView, next.pricesIncludeTax, next.rounding, next.defaultMarkupPercent, next.marginFloorPercent,
          next.discountApprovalPercent, next.validityDays, next.internalReview, next.priceBookId, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.settings_changed.v1", entityType: "workspace", entityId: workspaceId, before: current, after: next });
      return readSettings(client, workspaceId);
    });
  }

  addWorkPackage(actor: RequestActor, workspaceId: string, input: { id?: string; name?: string }) {
    return this.access.withPermission(actor, workspaceId, EDIT, async (client, user) => {
      const id = uuid(input.id, "Work package");
      const name = text(input.name, "Name", 120);
      const existing = (await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM workspace_work_packages WHERE workspace_id = $1 AND (id = $2 OR (lower(btrim(name)) = lower(btrim($3)) AND archived_at IS NULL))`,
        [workspaceId, id, name])).rows[0];
      if (existing) return existing; // the same add again, or the trade already exists
      const position = Number((await client.query<{ next: number }>(`SELECT coalesce(max(position), -1) + 1 AS next FROM workspace_work_packages WHERE workspace_id = $1`, [workspaceId])).rows[0].next);
      await client.query(`INSERT INTO workspace_work_packages (id, workspace_id, name, position, created_by) VALUES ($1, $2, $3, $4, $5)`, [id, workspaceId, name, position, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.work_package_added.v1", entityType: "work_package", entityId: id, after: { name } });
      return { id, name };
    });
  }

  updateWorkPackage(actor: RequestActor, workspaceId: string, id: string, input: { name?: string; archived?: boolean }) {
    return this.access.withAnyPermission(actor, workspaceId, SETTINGS, async (client, user) => {
      const before = (await client.query(`SELECT name, archived_at AS "archivedAt" FROM workspace_work_packages WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      if (!before) throw new NotFoundException("Work package not found.");
      const name = input.name === undefined ? null : text(input.name, "Name", 120);
      try {
        await client.query(`UPDATE workspace_work_packages SET name = coalesce($3, name), archived_at = CASE WHEN $4::boolean IS NULL THEN archived_at WHEN $4 THEN coalesce(archived_at, now()) ELSE NULL END
          WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, name, input.archived ?? null]);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new ConflictException("A work package with this name already exists.");
        throw error;
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.work_package_changed.v1", entityType: "work_package", entityId: id, before, after: input });
      return workPackages(client, workspaceId, true);
    });
  }

  // ---------- the builder ----------
  builder(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => this.state(client, workspaceId, caseId, quoteId, user.userId));
  }

  search(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, query: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      const quote = await readQuote(client, workspaceId, caseId, quoteId);
      const settings = await readSettings(client, workspaceId);
      return { items: await searchCatalog(client, workspaceId, { search: query.slice(0, 120), currency: quote.currency, priceBookId: settings.priceBookId }) };
    });
  }

  /**
   * Applies a batch of line changes in one transaction: upsert (fields to change, with the version
   * the editor saw), delete, reorder, or fill a line from a catalog item. On a version clash the
   * whole batch is refused with the line as it is now, so the editor can merge.
   */
  apply(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, input: { ops?: unknown }) {
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      const { quote } = await this.editable(client, workspaceId, caseId, quoteId);
      if (!Array.isArray(input.ops) || !input.ops.length || input.ops.length > 200) throw new BadRequestException("Send 1 to 200 changes.");
      const canEditCosts = await this.access.hasPermission(client, workspaceId, user.userId, "commercial.costs.manage");
      const settings = await readSettings(client, workspaceId);
      const decimals = currencyDecimals(quote.currency);
      const areas = new Map((await caseAreas(client, workspaceId, caseId)).map((area) => [area.id, area.name]));
      const trades = new Set((await workPackages(client, workspaceId, false)).map((trade) => trade.id));
      const codes = await taxCodes(client, workspaceId, caseId);
      const taxes = new Map(codes.map((tax) => [tax.code, tax.rate]));
      // New lines take the firm's default tax; without tax codes the quote's own rate applies.
      const standard = codes.find((tax) => tax.isDefault);
      const defaultTax = standard ? { taxCode: standard.code, taxRate: standard.rate } : {};
      const changed: string[] = [];
      for (const raw of input.ops) {
        const op = object(raw);
        const kind = String(op.op ?? "");
        if (kind === "delete") {
          const id = lineId(op.id);
          const current = await readLine(client, workspaceId, caseId, quoteId, id, true);
          if (!current) continue; // already gone: the same delete again
          if (Number(op.version) !== current.version) throw conflict(current);
          await client.query(`DELETE FROM commercial_quote_lines WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 AND id = $4`, [workspaceId, caseId, quoteId, id]);
          changed.push(id);
        } else if (kind === "reorder") {
          if (!Array.isArray(op.ids) || op.ids.length > 500) throw new BadRequestException("Send the lines in their new order.");
          const ids = op.ids.map(lineId);
          await client.query(
            `UPDATE commercial_quote_lines line SET sort_order = ordered.position - 1
               FROM unnest($4::text[]) WITH ORDINALITY AS ordered(id, position)
              WHERE line.workspace_id = $1 AND line.case_id = $2 AND line.quote_id = $3 AND line.id = ordered.id`, [workspaceId, caseId, quoteId, ids]);
        } else if (kind === "upsert" || kind === "catalog") {
          const fields = object(op.line);
          const id = lineId(fields.id);
          const current = await readLine(client, workspaceId, caseId, quoteId, id, true);
          if (current && fields.version === undefined) throw new BadRequestException("Send the version of the line you edited.");
          if (current && Number(fields.version) !== current.version) {
            if (Number(fields.version) + 1 === current.version && sameChange(current, fields)) continue; // a replay of the change just saved
            throw conflict(current);
          }
          let next: LineRow & { components?: ComponentRow[] | null } = current
            ? { ...current, components: null }
            : { ...blankLine(id), position: await nextPosition(client, workspaceId, caseId, quoteId), markupPercent: settings.defaultMarkupPercent, components: null, ...defaultTax };
          if (kind === "catalog") next = await this.fromCatalog(client, workspaceId, quote, settings, decimals, next, uuid(op.itemId, "Catalog item"));
          next = applyFields(next, fields, { canEditCosts, areas, trades, taxes });
          await this.saveLine(client, workspaceId, caseId, quoteId, next, current, areas, decimals, user.userId);
          changed.push(id);
        } else throw new BadRequestException(`Unknown change "${kind}".`);
      }
      await this.reprice(client, workspaceId, caseId, quote, settings);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.lines_changed.v1", entityType: "commercial_case", entityId: caseId, after: { quoteId, lines: changed, ops: input.ops.length } });
      return this.state(client, workspaceId, caseId, quoteId, user.userId);
    });
  }

  /** Sets (or clears, with value 0) a discount on the quote, an area or a trade. */
  setDiscount(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, input: Record<string, unknown>) {
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      const { quote } = await this.editable(client, workspaceId, caseId, quoteId);
      const scope = oneOf(input.scope, ["quote", "area", "trade"] as const, "discount scope");
      const target = scope === "quote" ? "" : String(input.target ?? "");
      if (scope === "area" && target !== "general" && !(await caseAreas(client, workspaceId, caseId)).some((area) => area.id === target)) throw new BadRequestException("Choose an area of this quote.");
      if (scope === "trade" && target !== "none" && !(await workPackages(client, workspaceId, false)).some((trade) => trade.id === target)) throw new BadRequestException("Choose a work package.");
      const kind = oneOf(input.kind, ["percent", "amount"] as const, "discount type");
      const value = decimal(input.value, "Discount", { max: kind === "percent" ? "100" : "100000000000" })!;
      const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
      const before = (await client.query(`SELECT kind, value::text AS value FROM commercial_quote_discounts WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 AND scope = $4 AND target_key = $5`, [workspaceId, caseId, quoteId, scope, target])).rows[0] ?? null;
      if (Dec.of(value).isZero()) await client.query(`DELETE FROM commercial_quote_discounts WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 AND scope = $4 AND target_key = $5`, [workspaceId, caseId, quoteId, scope, target]);
      else await client.query(
        `INSERT INTO commercial_quote_discounts (workspace_id, case_id, quote_id, scope, target_key, kind, value, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (workspace_id, case_id, quote_id, scope, target_key) DO UPDATE SET kind = excluded.kind, value = excluded.value, reason = excluded.reason, version = commercial_quote_discounts.version + 1`,
        [workspaceId, caseId, quoteId, scope, target, kind, value, reason, user.userId]);
      await this.reprice(client, workspaceId, caseId, quote, await readSettings(client, workspaceId));
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.discount_changed.v1", entityType: "commercial_case", entityId: caseId, before, after: { quoteId, scope, target, kind, value, reason } });
      return this.state(client, workspaceId, caseId, quoteId, user.userId);
    });
  }

  /** The quote-wide tax rate, used when the firm has no tax codes set up. */
  setQuoteTax(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, input: { taxRate?: unknown }) {
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      const { quote } = await this.editable(client, workspaceId, caseId, quoteId);
      const rate = decimal(input.taxRate, "Tax", { max: "100" })!;
      await client.query(`UPDATE commercial_quotes SET tax_rate = $4 WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, quoteId, rate]);
      await this.reprice(client, workspaceId, caseId, { ...quote, taxRate: rate }, await readSettings(client, workspaceId));
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.tax_changed.v1", entityType: "commercial_case", entityId: caseId, before: { taxRate: quote.taxRate }, after: { quoteId, taxRate: rate } });
      return this.state(client, workspaceId, caseId, quoteId, user.userId);
    });
  }

  /** The quote's payment milestones (percent of the total, what triggers each, which must be paid before the project starts). */
  setPaymentTerms(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, input: { terms?: unknown }) {
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      const { quote } = await this.editable(client, workspaceId, caseId, quoteId);
      let terms;
      try { terms = parsePaymentTerms(input.terms, false); }
      catch (error) { if (error instanceof Error) throw new BadRequestException(error.message); throw error; }
      await client.query(`UPDATE commercial_quotes SET detail = detail || jsonb_build_object('paymentTerms', $4::jsonb) WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
        [workspaceId, caseId, quoteId, JSON.stringify(terms)]);
      await client.query(`UPDATE commercial_cases SET revision = revision + 1, updated_at = now() WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.payment_terms_changed.v1", entityType: "commercial_case", entityId: caseId, before: quote.detail.paymentTerms ?? [], after: { quoteId, terms } });
      return this.state(client, workspaceId, caseId, quoteId, user.userId);
    });
  }

  /** The client document's style, texts and sections. Items and money always come from the quote. */
  setDocument(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, input: Record<string, unknown>) {
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      const { quote } = await this.editable(client, workspaceId, caseId, quoteId);
      const settings = await readSettings(client, workspaceId);
      const current = documentOf(quote, settings);
      const next = parseDocument(input ?? {}, current);
      if (next.coverAssetId && next.coverAssetId !== current.coverAssetId
        && !(await client.query(`SELECT 1 FROM pre_project_brief_assets WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, next.coverAssetId])).rowCount)
        throw new BadRequestException("Choose a cover image from this project.");
      await client.query(`UPDATE commercial_quotes SET detail = detail || jsonb_build_object('document', $4::jsonb) WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, quoteId, JSON.stringify(next)]);
      await client.query(`UPDATE commercial_cases SET revision = revision + 1, updated_at = now() WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.document_changed.v1", entityType: "commercial_case", entityId: caseId, after: { quoteId, style: next.style } });
      return this.state(client, workspaceId, caseId, quoteId, user.userId);
    });
  }

  /** The firm's quote templates, each line ready to insert (builder templates keep formulas and build-ups; older ones keep name, quantity and rate). */
  templates(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      const canCosts = await this.access.hasPermission(client, workspaceId, user.userId, "commercial.costs.view") || await this.access.hasPermission(client, workspaceId, user.userId, "commercial.costs.manage");
      const rows = (await client.query<{ id: string; name: string; content: { builder?: boolean; lines?: Array<Record<string, unknown>> } }>(
        `SELECT id, name, content FROM commercial_quotation_templates WHERE workspace_id = $1 AND status = 'active' ORDER BY name`, [workspaceId])).rows;
      return { templates: rows.map((row) => ({ id: row.id, name: row.name, lines: (row.content.lines ?? []).slice(0, 300).map((line) => templateLine(line, Boolean(row.content.builder), canCosts)) })) };
    });
  }

  /** Saves the lines of one area (or trade, or the whole quote) as a reusable template. */
  saveTemplate(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string, input: Record<string, unknown>) {
    return this.access.withPermissions(actor, workspaceId, [VIEW, EDIT], async (client, user) => {
      await readQuote(client, workspaceId, caseId, quoteId);
      const id = uuid(input.id, "Template");
      const name = text(input.name, "Template name", 160);
      const scope = oneOf(input.scope, ["area", "trade", "quote"] as const, "what to save");
      const target = String(input.target ?? "");
      const lines = (await readLines(client, workspaceId, caseId, quoteId)).filter((line) => scope === "quote" || (scope === "area" ? (line.areaId ?? "general") === target : (line.workPackageId ?? "none") === target));
      if (!lines.length) throw new BadRequestException("There are no lines to save.");
      const parts = await readComponents(client, workspaceId, caseId, quoteId, null);
      const content = {
        builder: true, rooms: [],
        lines: lines.map((line) => ({
          id: randomUUIDv4(), room: "", title: line.title, description: line.description, specification: line.description, material: "", finish: "",
          quantity: Number(line.quantity), unit: line.unit, rate: Number(line.rate), unitCost: line.unitCost === null ? null : Number(line.unitCost),
          kind: line.kind, formula: line.formula, length: line.length, width: line.width, height: line.height, count: line.count, markupPercent: line.markupPercent,
          pricingMode: line.pricingMode === "build_up" ? "build_up" : "item", catalogItemId: line.catalogItemId, workPackageId: line.workPackageId, optional: line.optional ?? false,
          components: parts.filter((part) => part.lineId === line.id).map(({ id: _id, lineId: _lineId, ...part }) => part),
        })),
      };
      const existing = (await client.query(`SELECT 1 FROM commercial_quotation_templates WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount;
      if (!existing) {
        if ((await client.query(`SELECT 1 FROM commercial_quotation_templates WHERE workspace_id = $1 AND lower(name) = lower($2)`, [workspaceId, name])).rowCount)
          throw new ConflictException("A template with this name already exists.");
        await client.query(`INSERT INTO commercial_quotation_templates (id, workspace_id, name, content) VALUES ($1, $2, $3, $4::jsonb)`, [id, workspaceId, name, JSON.stringify(content)]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "quotation.template_saved.v1", entityType: "quotation_template", entityId: id, after: { name, lines: content.lines.length } });
      }
      return { id, name, lines: content.lines.length };
    });
  }

  // ---------- internals ----------
  private async editable(client: Db, workspaceId: string, caseId: string, quoteId: string) {
    const record = (await client.query<{ status: string }>(`SELECT status FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, caseId])).rows[0];
    if (!record) throw new NotFoundException("Case not found.");
    if (!["active", "released"].includes(record.status)) throw new ConflictException("This case is closed.");
    const quote = await readQuote(client, workspaceId, caseId, quoteId, true);
    if (quote.status !== "draft") throw new ConflictException("This quote has been sent. Start a new revision to change it.");
    return { quote };
  }

  private async fromCatalog(client: Db, workspaceId: string, quote: Quote, settings: QuotationSettings, decimals: number, line: LineRow & { components?: ComponentRow[] | null }, itemId: string) {
    const item = await catalogLine(client, workspaceId, { itemId, currency: quote.currency, priceBookId: settings.priceBookId, decimals });
    if (!item) throw new BadRequestException("That catalog item isn't available.");
    const components: ComponentRow[] = item.components.map((part) => ({
      id: "", lineId: line.id, kind: part.kind, catalogItemId: part.catalogItemId, name: part.name, quantityFormula: part.quantityFormula,
      quantity: "0", unit: part.unit, unitCost: part.unitCost, rate: part.rate, wastePercent: part.wastePercent, suppliedByClient: false,
    }));
    if (item.rollup?.labour) components.push({ id: "", lineId: line.id, kind: "labour", catalogItemId: null, name: "Labour", quantityFormula: null, quantity: "1", unit: item.unit, unitCost: null, rate: item.rollup.labour, wastePercent: null, suppliedByClient: false });
    const buildUpMode = Boolean(item.rollup && components.length);
    return {
      ...line,
      kind: item.kind === "service" && line.kind === "item" ? "service" : line.kind,
      title: item.title, description: item.description, unit: item.unit, catalogItemId: item.snapshot.itemId,
      catalogSnapshot: { ...item.snapshot, priceReason: item.priceReason },
      rate: item.rate ?? "0", unitCost: item.unitCost,
      pricingMode: buildUpMode ? "build_up" as const : "rate" as const,
      markupPercent: buildUpMode ? item.rollup?.marginPercent ?? line.markupPercent : line.markupPercent,
      components: components.length ? components : [],
    };
  }

  private async saveLine(client: Db, workspaceId: string, caseId: string, quoteId: string, line: LineRow & { components?: ComponentRow[] | null }, current: LineRow | null, areas: Map<string, string>, decimals: number, userId: string) {
    if (!line.title.trim()) throw new BadRequestException("Give the line a name.");
    if (line.kind === "relocate" && !line.fromAreaId) throw new BadRequestException("Choose the area the item moves from.");
    if (line.kind === "relocate" && line.fromAreaId && line.fromAreaId === line.areaId) throw new BadRequestException("Moving an item needs a different area.");
    if (line.formula) { try { checkFormula(line.formula); } catch (error) { throw new BadRequestException(error instanceof FormulaError ? `Formula: ${error.message}` : "Check the formula."); } }
    const measurements = { length: line.length, width: line.width, height: line.height, count: line.count };
    const quantity = lineQuantity({ ...measurements, formula: line.formula, quantity: line.quantity });
    line.quantity = quantity.quantity;
    const components = line.components ?? await readComponents(client, workspaceId, caseId, quoteId, line.id);
    if (line.pricingMode === "build_up") {
      if (!components.length) throw new BadRequestException("Add what the item is made of, or price it with a rate.");
      const built = buildUp(components, measurements, line.markupPercent, decimals);
      line.rate = built.rate;
      line.unitCost = built.cost;
    }
    if (line.kind === "client_supplied") line.rate = "0";
    const room = line.areaId ? areas.get(line.areaId) ?? "" : "";
    await client.query(
      `INSERT INTO commercial_quote_lines (workspace_id, case_id, quote_id, id, sort_order, room, title, quantity, unit, unit_cost, rate, optional,
         kind, description, pricing_mode, note, area_id, from_area_id, work_package_id, catalog_item_id, catalog_snapshot, formula, length, width, height,
         count, dimension_unit, markup_percent, discount_kind, discount_value, tax_code, tax_rate, option_group, version, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, 1, $34, now())
       ON CONFLICT (case_id, quote_id, id) DO UPDATE SET sort_order = excluded.sort_order, room = excluded.room, title = excluded.title, quantity = excluded.quantity,
         unit = excluded.unit, unit_cost = excluded.unit_cost, rate = excluded.rate, optional = excluded.optional, kind = excluded.kind, description = excluded.description,
         pricing_mode = excluded.pricing_mode, note = excluded.note, area_id = excluded.area_id, from_area_id = excluded.from_area_id, work_package_id = excluded.work_package_id,
         catalog_item_id = excluded.catalog_item_id, catalog_snapshot = excluded.catalog_snapshot, formula = excluded.formula, length = excluded.length, width = excluded.width,
         height = excluded.height, count = excluded.count, dimension_unit = excluded.dimension_unit, markup_percent = excluded.markup_percent,
         discount_kind = excluded.discount_kind, discount_value = excluded.discount_value, tax_code = excluded.tax_code, tax_rate = excluded.tax_rate,
         option_group = excluded.option_group, version = commercial_quote_lines.version + 1, updated_by = excluded.updated_by, updated_at = now()`,
      [workspaceId, caseId, quoteId, line.id, line.position, room, line.title.trim(), line.quantity, line.unit, line.unitCost, line.rate, line.optional || null,
        line.kind, line.description, line.pricingMode, line.note, line.areaId, line.fromAreaId, line.workPackageId, line.catalogItemId,
        line.catalogSnapshot ? JSON.stringify(line.catalogSnapshot) : null, line.formula, line.length, line.width, line.height, line.count, line.dimensionUnit,
        line.markupPercent, line.discountKind, line.discountValue, line.taxCode, line.taxRate, line.optionGroup, userId]);
    if (line.components) {
      await client.query(`DELETE FROM commercial_quote_line_components WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 AND line_id = $4`, [workspaceId, caseId, quoteId, line.id]);
      for (const [position, component] of line.components.entries())
        await client.query(
          `INSERT INTO commercial_quote_line_components (workspace_id, case_id, quote_id, line_id, position, kind, catalog_item_id, name, quantity_formula, quantity, unit, unit_cost, rate, waste_percent, supplied_by_client)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [workspaceId, caseId, quoteId, line.id, position, component.kind, component.catalogItemId, component.name, component.quantityFormula, component.quantity,
            component.unit, component.unitCost, component.rate, component.wastePercent, component.suppliedByClient]);
    }
    void current;
  }

  /** Prices the quote with the shared engine and keeps its header (total, discount, pricing policy) in step. */
  private async reprice(client: Db, workspaceId: string, caseId: string, quote: Quote, settings: QuotationSettings) {
    const policy: PricingPolicy = { currencyDecimals: currencyDecimals(quote.currency), pricesIncludeTax: settings.pricesIncludeTax, rounding: settings.rounding };
    const lines = await readLines(client, workspaceId, caseId, quote.id);
    const discounts = await readDiscounts(client, workspaceId, caseId, quote.id);
    let pricing;
    try { pricing = priceQuote(lines.map((line) => pricedInput(line, quote.taxRate)), discounts, policy); }
    catch (error) { if (error instanceof PricingError) throw new BadRequestException(error.message); throw error; }
    await client.query(
      `UPDATE commercial_quotes SET total = $4, discount = $5, detail = detail || jsonb_build_object('pricing', $6::jsonb),
              valid_until = CASE WHEN status = 'draft' THEN (SELECT (now() AT TIME ZONE default_timezone)::date FROM workspaces WHERE id = $1) + $7::int ELSE valid_until END
        WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
      [workspaceId, caseId, quote.id, pricing.total, pricing.discounts.total, JSON.stringify(policy), settings.validityDays]);
    // Other commands read the case under its revision; moving it makes them reload instead of overwriting.
    await client.query(`UPDATE commercial_cases SET revision = revision + 1, updated_at = now() WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId]);
    return pricing;
  }

  private async state(client: Db, workspaceId: string, caseId: string, quoteId: string, userId: string) {
    const quote = await readQuote(client, workspaceId, caseId, quoteId);
    const settings = await readSettings(client, workspaceId);
    const canEditCosts = await this.access.hasPermission(client, workspaceId, userId, "commercial.costs.manage");
    const canViewCosts = canEditCosts || await this.access.hasPermission(client, workspaceId, userId, "commercial.costs.view");
    const canEdit = quote.status === "draft" && await this.access.hasPermission(client, workspaceId, userId, EDIT);
    const decimals = currencyDecimals(quote.currency);
    const lines = await readLines(client, workspaceId, caseId, quoteId);
    const components = await readComponents(client, workspaceId, caseId, quoteId, null);
    const discounts = await readDiscounts(client, workspaceId, caseId, quoteId);
    const policy: PricingPolicy = { currencyDecimals: decimals, pricesIncludeTax: settings.pricesIncludeTax, rounding: settings.rounding };
    const pricing = priceQuote(lines.map((line) => pricedInput(line, quote.taxRate)), discounts, policy);
    const commercial = (await client.query<{ revision: number; palm: boolean }>(`SELECT revision, content ? 'palmFlow' AND content->'palmFlow' <> 'null'::jsonb AS palm FROM commercial_cases WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0];
    const revision = commercial?.revision ?? 0;
    const family = (await client.query<{ id: string; number: number; status: string; total: string; createdAt: string | null }>(
      `SELECT id, number, status, total::text AS total, detail->>'createdAt' AS "createdAt" FROM commercial_quotes
        WHERE workspace_id = $1 AND case_id = $2 AND kind = $3 AND coalesce(family_id, id) = coalesce($4, $5) ORDER BY number`,
      [workspaceId, caseId, quote.kind, quote.familyId, quote.id])).rows;
    const can = async (code: string) => this.access.hasPermission(client, workspaceId, userId, code);
    const decision = quote.detail.clientDecision as { decision: string; decidedBy: string; decidedAt: string; note?: string; method?: string; recordedBy?: string } | undefined;
    const hideCost = <T extends { unitCost: string | null }>(row: T) => (canViewCosts ? row : { ...row, unitCost: null });
    const checks = await quoteChecks(client, workspaceId, caseId, { lines, components, decimals, pricing, settings, canViewCosts, paymentTerms: (quote.detail.paymentTerms as unknown[] | undefined) ?? [], draft: quote.status === "draft" });
    return {
      quote: { id: quote.id, number: quote.number, title: quote.title, status: quote.status, kind: quote.kind, round: quote.round, currency: quote.currency, decimals, validUntil: quote.validUntil, taxRate: quote.taxRate, revision,
        paymentTerms: (quote.detail.paymentTerms as unknown[] | undefined) ?? [], approvedBy: (quote.detail.approvedBy as string | undefined) ?? null,
        clientDecision: decision ? { decision: decision.decision, decidedBy: decision.decidedBy, decidedAt: decision.decidedAt, note: decision.note ?? "", method: decision.method ?? null, recordedBy: decision.recordedBy ?? null } : null },
      family,
      flow: { internalReview: settings.internalReview, reviewAction: commercial?.palm && quote.kind === "quotation" ? "qs_approve" : "approve",
        canReview: await can(commercial?.palm && quote.kind === "quotation" ? "commercial.estimate" : "commercial.approve"), canRecordDecision: await can("commercial.approve") },
      paymentTemplates: (await client.query<{ id: string; name: string; milestones: unknown }>(`SELECT id, name, milestones FROM commercial_payment_templates WHERE workspace_id = $1 AND status = 'active' ORDER BY name`, [workspaceId])).rows,
      settings,
      areas: await caseAreas(client, workspaceId, caseId),
      workPackages: await workPackages(client, workspaceId, false),
      taxCodes: await taxCodes(client, workspaceId, caseId),
      lines: lines.map((line) => {
        const parts = components.filter((part) => part.lineId === line.id);
        const measurements = { length: line.length, width: line.width, height: line.height, count: line.count };
        const quantity = lineQuantity({ ...measurements, formula: line.formula, quantity: line.quantity });
        const built = line.pricingMode === "build_up" ? buildUp(parts, measurements, line.markupPercent, decimals) : null;
        return {
          ...hideCost(line), markupPercent: canViewCosts ? line.markupPercent : null, formulaError: quantity.error,
          buildUpComplete: built?.complete ?? null,
          components: parts.map((part, index) => ({ ...hideCost(part), worked: built?.components[index] ? { quantity: built.components[index].quantity, amount: built.components[index].amount, error: built.components[index].error } : null })),
        };
      }),
      discounts,
      pricing: canViewCosts ? pricing : { ...pricing, cost: null, margin: null, lines: pricing.lines.map((line) => ({ ...line, cost: null })) },
      checks,
      me: userId,
      document: documentOf(quote, settings),
      brand: await effectivePortalBrand(client, workspaceId, null),
      client: (await client.query<{ name: string; project: string; address: string | null }>(
        `SELECT coalesce(party.display_name, opportunity.title) AS name, opportunity.title AS project,
                (SELECT concat_ws(', ', NULLIF(address.line1, ''), NULLIF(address.locality, ''), NULLIF(address.region, '')) FROM crm_addresses address
                  WHERE address.workspace_id = party.workspace_id AND address.party_id = party.id ORDER BY address.is_primary DESC, address.created_at LIMIT 1) AS address
           FROM pre_project_cases pre_case JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
           LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
          WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0] ?? { name: "", project: "", address: null },
      canEdit, canEditCosts, canViewCosts,
    };
  }

  private async anyPermission(client: PoolClient, workspaceId: string, userId: string, permissions: string[]) {
    for (const permission of permissions) if (await this.access.hasPermission(client, workspaceId, userId, permission)) return true;
    return false;
  }
}

// ---------- reading ----------
async function readSettings(db: Db, workspaceId: string): Promise<QuotationSettings> {
  const row = (await db.query<QuotationSettings>(
    `SELECT default_view AS "defaultView", prices_include_tax AS "pricesIncludeTax", rounding, default_markup_percent::text AS "defaultMarkupPercent",
            margin_floor_percent::text AS "marginFloorPercent", discount_approval_percent::text AS "discountApprovalPercent", validity_days AS "validityDays",
            internal_review AS "internalReview", price_book_id AS "priceBookId", version
       FROM workspace_quotation_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  return row ? { ...row, defaultMarkupPercent: Dec.of(row.defaultMarkupPercent).toString(), marginFloorPercent: row.marginFloorPercent === null ? null : Dec.of(row.marginFloorPercent).toString(), discountApprovalPercent: row.discountApprovalPercent === null ? null : Dec.of(row.discountApprovalPercent).toString() } : { ...DEFAULT_SETTINGS };
}

async function workPackages(db: Db, workspaceId: string, includeArchived: boolean) {
  return (await db.query<{ id: string; name: string; archived: boolean }>(
    `SELECT id, name, archived_at IS NOT NULL AS archived FROM workspace_work_packages WHERE workspace_id = $1 AND ($2 OR archived_at IS NULL) ORDER BY position, name`,
    [workspaceId, includeArchived])).rows;
}

async function caseAreas(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ id: string; name: string }>(`SELECT id, name FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2 ORDER BY lower(name)`, [workspaceId, caseId])).rows;
}

/** The tax codes of the legal entity on the case's opportunity (or the workspace's first active entity), current rates only. */
async function taxCodes(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ code: string; label: string; rate: string; isDefault: boolean }>(
    `SELECT rate.code, rate.label, rate.rate::text AS rate, rate.is_default AS "isDefault"
       FROM tax_rates rate JOIN tax_profiles profile ON profile.id = rate.tax_profile_id
      WHERE rate.workspace_id = $1 AND rate.effective_to IS NULL AND profile.status = 'active' AND profile.effective_to IS NULL
        AND profile.legal_entity_id = coalesce(
          (SELECT opportunity.legal_entity_id FROM pre_project_cases pre_case
             JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
            WHERE pre_case.workspace_id = $1 AND pre_case.id = $2),
          (SELECT entity.id FROM legal_entities entity WHERE entity.workspace_id = $1 AND entity.status = 'active' ORDER BY entity.created_at LIMIT 1))
      ORDER BY rate.is_default DESC, rate.label`, [workspaceId, caseId])).rows.map((row) => ({ ...row, rate: Dec.of(row.rate).toString() }));
}

async function readQuote(db: Db, workspaceId: string, caseId: string, quoteId: string, lock = false): Promise<Quote> {
  const quote = (await db.query<Quote>(
    `SELECT id, number, title, status, currency, kind, round, family_id AS "familyId", tax_rate::text AS "taxRate", valid_until::text AS "validUntil", detail
       FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3 ${lock ? "FOR UPDATE" : ""}`, [workspaceId, caseId, quoteId])).rows[0];
  if (!quote) throw new NotFoundException("Quote not found.");
  return quote;
}

const LINE_SELECT = `SELECT line.id, line.sort_order AS position, line.version, line.kind, line.area_id AS "areaId", line.from_area_id AS "fromAreaId",
  line.work_package_id AS "workPackageId", line.title, line.description, line.unit, line.quantity::text AS quantity, line.formula,
  line.length::text AS length, line.width::text AS width, line.height::text AS height, line.count::text AS count, line.dimension_unit AS "dimensionUnit",
  line.rate::text AS rate, line.unit_cost::text AS "unitCost", line.markup_percent::text AS "markupPercent", line.pricing_mode AS "pricingMode",
  line.discount_kind AS "discountKind", line.discount_value::text AS "discountValue", line.tax_code AS "taxCode", line.tax_rate::text AS "taxRate",
  line.optional, line.option_group AS "optionGroup", line.note, line.catalog_item_id AS "catalogItemId", line.catalog_snapshot AS "catalogSnapshot",
  line.updated_at AS "updatedAt", editor.display_name AS "updatedByName"
  FROM commercial_quote_lines line LEFT JOIN users editor ON editor.id = line.updated_by`;

async function readLines(db: Db, workspaceId: string, caseId: string, quoteId: string) {
  return (await db.query<LineRow>(`${LINE_SELECT} WHERE line.workspace_id = $1 AND line.case_id = $2 AND line.quote_id = $3 ORDER BY line.sort_order, line.id`, [workspaceId, caseId, quoteId])).rows.map(tidyLine);
}
async function readLine(db: Db, workspaceId: string, caseId: string, quoteId: string, id: string, lock = false) {
  const row = (await db.query<LineRow>(`${LINE_SELECT} WHERE line.workspace_id = $1 AND line.case_id = $2 AND line.quote_id = $3 AND line.id = $4 ${lock ? "FOR UPDATE OF line" : ""}`, [workspaceId, caseId, quoteId, id])).rows[0];
  return row ? tidyLine(row) : null;
}
const trim = (value: string | null) => (value === null ? null : Dec.of(value).toString());
const tidyLine = (line: LineRow): LineRow => ({
  ...line, quantity: Dec.of(line.quantity).toString(), rate: Dec.of(line.rate).toString(), unitCost: trim(line.unitCost),
  length: trim(line.length), width: trim(line.width), height: trim(line.height), count: trim(line.count), markupPercent: trim(line.markupPercent),
  discountValue: trim(line.discountValue), taxRate: trim(line.taxRate),
});
async function readComponents(db: Db, workspaceId: string, caseId: string, quoteId: string, lineIdFilter: string | null) {
  return (await db.query<ComponentRow>(
    `SELECT id, line_id AS "lineId", kind, catalog_item_id AS "catalogItemId", name, quantity_formula AS "quantityFormula", quantity::text AS quantity, unit,
            unit_cost::text AS "unitCost", rate::text AS rate, waste_percent::text AS "wastePercent", supplied_by_client AS "suppliedByClient"
       FROM commercial_quote_line_components WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 AND ($4::text IS NULL OR line_id = $4) ORDER BY line_id, position`,
    [workspaceId, caseId, quoteId, lineIdFilter])).rows.map((row) => ({ ...row, quantity: Dec.of(row.quantity).toString(), unitCost: trim(row.unitCost), rate: trim(row.rate), wastePercent: trim(row.wastePercent) }));
}
async function readDiscounts(db: Db, workspaceId: string, caseId: string, quoteId: string): Promise<Array<QuoteDiscountInput & { reason: string }>> {
  return (await db.query<{ scope: "quote" | "area" | "trade"; target: string; kind: "percent" | "amount"; value: string; reason: string }>(
    `SELECT scope, target_key AS target, kind, value::text AS value, reason FROM commercial_quote_discounts WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 ORDER BY scope, target_key`,
    [workspaceId, caseId, quoteId])).rows.map((row) => ({ ...row, value: Dec.of(row.value).toString() }));
}
async function nextPosition(db: Db, workspaceId: string, caseId: string, quoteId: string) {
  return Number((await db.query<{ next: number }>(`SELECT coalesce(max(sort_order), -1) + 1 AS next FROM commercial_quote_lines WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3`, [workspaceId, caseId, quoteId])).rows[0].next);
}

export const pricedInput = (line: Pick<LineRow, "id" | "quantity" | "rate" | "unitCost" | "optional" | "areaId" | "workPackageId" | "discountKind" | "discountValue" | "taxRate">, quoteTaxRate: string) => ({
  id: line.id, quantity: line.quantity, rate: line.rate, unitCost: line.unitCost, optional: Boolean(line.optional),
  areaKey: line.areaId ?? "general", tradeKey: line.workPackageId ?? "none",
  discountKind: line.discountKind, discountValue: line.discountValue, taxRate: line.taxRate ?? quoteTaxRate,
});

// ---------- editing ----------
const blankLine = (id: string): LineRow => ({
  id, position: 0, version: 0, kind: "item", areaId: null, fromAreaId: null, workPackageId: null, title: "", description: "", unit: "",
  quantity: "1", formula: null, length: null, width: null, height: null, count: null, dimensionUnit: null, rate: "0", unitCost: null,
  markupPercent: null, pricingMode: "rate", discountKind: null, discountValue: null, taxCode: null, taxRate: null, optional: null,
  optionGroup: null, note: "", catalogItemId: null, catalogSnapshot: null, updatedAt: "", updatedByName: null,
});

/** Validates and applies the editor's fields to a line. Costs and markup change only with cost permission. */
function applyFields(line: LineRow & { components?: ComponentRow[] | null }, fields: Record<string, unknown>, context: { canEditCosts: boolean; areas: Map<string, string>; trades: Set<string>; taxes: Map<string, string> }) {
  const next = { ...line };
  const has = (key: string) => Object.prototype.hasOwnProperty.call(fields, key);
  if (has("kind")) next.kind = oneOf(fields.kind, LINE_KINDS, "line kind");
  if (has("title")) next.title = text(fields.title, "Name", 240, true);
  if (has("description")) next.description = text(fields.description, "Description", 4000, true);
  if (has("unit")) next.unit = text(fields.unit, "Unit", 20, true);
  if (has("note")) next.note = text(fields.note, "Note", 4000, true);
  if (has("areaId")) next.areaId = area(fields.areaId, context.areas);
  if (has("fromAreaId")) next.fromAreaId = area(fields.fromAreaId, context.areas);
  if (has("workPackageId")) {
    next.workPackageId = fields.workPackageId === null ? null : uuid(fields.workPackageId, "Work package");
    if (next.workPackageId && !context.trades.has(next.workPackageId)) throw new BadRequestException("Choose a work package from the list.");
  }
  if (has("quantity")) next.quantity = decimal(fields.quantity, "Quantity", { max: "1000000000" })!;
  if (has("formula")) next.formula = typeof fields.formula === "string" && fields.formula.trim() ? text(fields.formula, "Formula", 500) : null;
  for (const key of ["length", "width", "height", "count"] as const) if (has(key)) next[key] = decimal(fields[key], key[0].toUpperCase() + key.slice(1), { max: "1000000", nullable: true });
  if (has("dimensionUnit")) next.dimensionUnit = fields.dimensionUnit === null ? null : text(fields.dimensionUnit, "Unit", 8);
  if (has("rate")) next.rate = decimal(fields.rate, "Rate", { max: "100000000000" })!;
  if (has("pricingMode")) next.pricingMode = oneOf(fields.pricingMode, ["rate", "build_up"] as const, "pricing");
  if (context.canEditCosts) {
    if (has("unitCost")) next.unitCost = decimal(fields.unitCost, "Cost", { max: "100000000000", nullable: true });
    if (has("markupPercent")) next.markupPercent = decimal(fields.markupPercent, "Markup", { max: "1000", nullable: true });
    // A new cost or markup (without a typed rate) sets the sell rate: cost plus markup.
    if ((has("unitCost") || has("markupPercent")) && !has("rate") && next.pricingMode === "rate" && next.markupPercent !== null && next.unitCost !== null && !Dec.of(next.unitCost).isZero())
      next.rate = Dec.of(next.unitCost).mul(Dec.of(next.markupPercent).add(100)).div(100).toString();
  }
  if (has("discountKind") || has("discountValue")) {
    const kind = fields.discountKind === null || fields.discountValue === null || fields.discountValue === "" ? null : oneOf(fields.discountKind ?? next.discountKind, ["percent", "amount"] as const, "discount type");
    next.discountKind = kind;
    next.discountValue = kind ? decimal(fields.discountValue ?? next.discountValue, "Discount", { max: kind === "percent" ? "100" : "100000000000" }) : null;
  }
  if (has("taxCode")) {
    if (fields.taxCode === null || fields.taxCode === "") { next.taxCode = null; next.taxRate = null; }
    else {
      const code = String(fields.taxCode);
      if (!context.taxes.has(code)) throw new BadRequestException("Choose a tax from your tax settings.");
      next.taxCode = code; next.taxRate = context.taxes.get(code)!;
    }
  }
  if (has("optional")) next.optional = bool(fields.optional) || null;
  if (has("optionGroup")) next.optionGroup = fields.optionGroup === null || fields.optionGroup === "" ? null : text(fields.optionGroup, "Option group", 80);
  if (has("components")) {
    if (!Array.isArray(fields.components) || fields.components.length > 60) throw new BadRequestException("Use up to 60 rows in a build-up.");
    next.components = fields.components.map((raw) => {
      const part = object(raw);
      const quantityFormula = typeof part.quantityFormula === "string" && part.quantityFormula.trim() ? text(part.quantityFormula, "Formula", 500) : null;
      if (quantityFormula) { try { checkFormula(quantityFormula); } catch (error) { throw new BadRequestException(`${String(part.name ?? "Row")}: ${error instanceof Error ? error.message : "check the formula"}`); } }
      return {
        id: "", lineId: line.id, kind: oneOf(part.kind ?? "material", COMPONENT_KINDS, "row type"),
        catalogItemId: part.catalogItemId ? uuid(part.catalogItemId, "Catalog item") : null,
        name: text(part.name, "Row name", 200), quantityFormula, quantity: decimal(part.quantity ?? "0", "Quantity", { max: "1000000000" })!,
        unit: text(part.unit ?? "", "Unit", 16, true),
        unitCost: context.canEditCosts ? decimal(part.unitCost ?? null, "Cost", { max: "100000000000", nullable: true }) : null,
        rate: decimal(part.rate ?? null, "Rate", { max: "100000000000", nullable: true }),
        wastePercent: decimal(part.wastePercent ?? null, "Waste", { max: "100", nullable: true }),
        suppliedByClient: bool(part.suppliedByClient ?? false),
      };
    });
  }
  return next;
}

/** True when the line already holds exactly the requested values (a retried request). */
function sameChange(current: LineRow, fields: Record<string, unknown>) {
  return Object.entries(fields).every(([key, value]) => {
    if (["id", "version", "components"].includes(key)) return true;
    const now = (current as unknown as Record<string, unknown>)[key];
    if (now === null || now === undefined) return value === null || value === undefined || value === "";
    if (typeof now === "string" && /^-?\d+(\.\d+)?$/.test(now) && value !== null && value !== "" && !Number.isNaN(Number(value))) return Dec.of(now).cmp(String(value)) === 0;
    return String(now) === String(value);
  });
}

function conflict(current: LineRow) {
  return new ConflictException({ message: `${current.updatedByName ?? "Someone"} just changed "${current.title}". Review their change, then try again.`, line: current });
}

// ---------- validation ----------
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Send the change as an object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, allowEmpty = false) {
  if (typeof value !== "string") throw new BadRequestException(`${label} must be text.`);
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) throw new BadRequestException(`${label} is required.`);
  if (trimmed.length > max) throw new BadRequestException(`${label} is too long (${max} characters at most).`);
  return trimmed;
}
function bool(value: unknown) {
  if (typeof value !== "boolean") throw new BadRequestException("Expected yes or no.");
  return value;
}
function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} id is invalid.`);
  return value.toLowerCase();
}
function lineId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new BadRequestException("Line id is invalid.");
  return value;
}
function area(value: unknown, areas: Map<string, string>) {
  if (value === null || value === "" || value === "general") return null;
  const id = uuid(value, "Area");
  if (!areas.has(id)) throw new BadRequestException("Choose an area of this project.");
  return id;
}
function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) throw new BadRequestException(`Choose a valid ${label}.`);
  return value as T;
}
function decimal(value: unknown, label: string, options: { max: string; nullable?: boolean }): string | null {
  if (value === null || value === undefined || value === "") {
    if (options.nullable) return null;
    throw new BadRequestException(`${label} is required.`);
  }
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^\d+(\.\d{1,6})?$/.test(raw.trim())) throw new BadRequestException(`${label} must be a number of zero or more.`);
  const parsed = Dec.of(raw.trim());
  if (parsed.cmp(options.max) > 0) throw new BadRequestException(`${label} is too large.`);
  return parsed.toString();
}

export type QuoteCheck = { code: string; values?: Record<string, string>; lineId?: string; tone: "danger" | "warning" };

/**
 * What to fix before sending: lines without a price or quantity, formulas and build-ups that don't
 * work out, rooms with approved designs but no items, margin under the firm's floor, and a missing
 * payment schedule. Messages are translation keys with their values.
 */
async function quoteChecks(db: Db, workspaceId: string, caseId: string, input: {
  lines: LineRow[]; components: ComponentRow[]; decimals: number; pricing: ReturnType<typeof priceQuote>; settings: QuotationSettings; canViewCosts: boolean; paymentTerms: unknown[]; draft: boolean;
}): Promise<QuoteCheck[]> {
  const checks: QuoteCheck[] = [];
  for (const line of input.lines) {
    const name = { name: line.title };
    if (line.kind !== "client_supplied" && Dec.of(line.rate).isZero()) checks.push({ code: "{name} has no price", values: name, lineId: line.id, tone: "danger" });
    if (Dec.of(line.quantity).isZero()) checks.push({ code: "{name} has no quantity", values: name, lineId: line.id, tone: "danger" });
    const measurements = { length: line.length, width: line.width, height: line.height, count: line.count };
    if (line.formula && lineQuantity({ ...measurements, formula: line.formula, quantity: line.quantity }).error) checks.push({ code: "{name}: the formula doesn't work out", values: name, lineId: line.id, tone: "danger" });
    if (line.pricingMode === "build_up" && !buildUp(input.components.filter((part) => part.lineId === line.id), measurements, line.markupPercent, input.decimals).complete)
      checks.push({ code: "{name}: some parts have no price", values: name, lineId: line.id, tone: "warning" });
  }
  const designed = (await db.query<{ name: string }>(
    `SELECT DISTINCT room.name FROM pre_project_designs design JOIN pre_project_rooms room ON room.workspace_id = design.workspace_id AND room.id = design.room_id
      WHERE design.workspace_id = $1 AND design.case_id = $2 AND design.archived_at IS NULL
        AND (SELECT version.status FROM pre_project_design_versions version WHERE version.workspace_id = design.workspace_id AND version.design_id = design.id ORDER BY number DESC LIMIT 1) = 'approved'
        AND NOT EXISTS (SELECT 1 FROM unnest($3::uuid[]) AS used(id) WHERE used.id = room.id)`,
    [workspaceId, caseId, [...new Set(input.lines.map((line) => line.areaId).filter(Boolean))]])).rows;
  for (const room of designed) checks.push({ code: "{name} has approved designs but no items", values: { name: room.name }, tone: "warning" });
  const floor = input.settings.marginFloorPercent;
  if (input.canViewCosts && floor !== null && input.pricing.margin !== null && Dec.of(input.pricing.margin).cmp(floor) < 0)
    checks.push({ code: "Margin is below the {floor}% floor", values: { floor }, tone: "warning" });
  if (input.draft && input.lines.length && !input.paymentTerms.length) checks.push({ code: "Add the payment milestones", tone: "warning" });
  return checks;
}

function documentOf(quote: Quote, settings: QuotationSettings): QuoteDocument {
  const stored = quote.detail.document as Partial<QuoteDocument> | undefined;
  const base = defaultDocument({ terms: typeof quote.detail.terms === "string" ? quote.detail.terms : "", exclusions: typeof quote.detail.exclusions === "string" ? quote.detail.exclusions : "", view: settings.defaultView });
  return stored ? { ...base, ...stored, sections: { ...base.sections, ...(stored.sections ?? {}) } } : base;
}

/** A template line as the builder inserts it. */
function templateLine(line: Record<string, unknown>, builder: boolean, canCosts: boolean) {
  const str = (value: unknown) => (typeof value === "string" ? value : value === null || value === undefined ? null : String(value));
  return {
    title: str(line.title) ?? "", description: str(builder ? line.description : line.specification) ?? "", unit: str(line.unit) ?? "",
    quantity: str(line.quantity) ?? "1", rate: str(line.rate) ?? "0", unitCost: canCosts ? str(line.unitCost) : null,
    kind: builder ? str(line.kind) ?? "item" : "item", formula: builder ? str(line.formula) : null,
    length: builder ? str(line.length) : null, width: builder ? str(line.width) : null, height: builder ? str(line.height) : null, count: builder ? str(line.count) : null,
    markupPercent: builder && canCosts ? str(line.markupPercent) : null, pricingMode: builder && line.pricingMode === "build_up" ? "build_up" : "rate",
    catalogItemId: builder ? str(line.catalogItemId) : null, workPackageId: builder ? str(line.workPackageId) : null, optional: line.optional === true,
    components: builder && Array.isArray(line.components) ? (line.components as Array<Record<string, unknown>>).map((part) => ({ ...part, unitCost: canCosts ? part.unitCost ?? null : null })) : [],
  };
}
