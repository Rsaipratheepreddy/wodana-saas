import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  ApplicableSupplierOffersQueryDto,
  CreateSupplierOfferDto,
  ListSupplierOffersQueryDto,
  SupplierOfferLifecycleDto,
  UpdateSupplierOfferDto,
} from "./supplier-offer.dto";

type OfferRow = {
  id: string;
  vendorId: string;
  vendorSiteId: string | null;
  legalEntityId: string | null;
  catalogRecordId: string;
  unitRecordId: string | null;
  replacesOfferId: string | null;
  supplierSku: string | null;
  amount: number | null;
  currency: string | null;
  quantityFrom: number | null;
  minimumOrderQuantity: number | null;
  orderMultiple: number | null;
  leadTimeDays: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sourceType: string | null;
  sourceReference: string | null;
  taxTreatment: string;
  inclusions: string[];
  terms: string;
  notes: string;
  status: "draft" | "active" | "archived";
  archivedReason: string | null;
  archivedAt: string | null;
  version: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  vendorName: string;
  vendorStatus: string;
  vendorSiteName: string | null;
  legalEntityName: string | null;
  legalEntityBaseCurrency: string | null;
  currencyBoundary: "base" | "conversion_required" | "unbound";
  catalogRecordName: string;
  catalogRecordCode: string;
  catalogRecordKind: string;
  unitName: string | null;
  unitCode: string | null;
};

type MutableOffer = Pick<OfferRow,
  "vendorSiteId" | "legalEntityId" | "unitRecordId" | "supplierSku" | "amount" | "currency" | "quantityFrom" |
  "minimumOrderQuantity" | "orderMultiple" | "leadTimeDays" | "effectiveFrom" | "effectiveTo" |
  "sourceType" | "sourceReference" | "taxTreatment" | "inclusions" | "terms" | "notes">;

const offerColumns = `offer.id,offer.vendor_id AS "vendorId",offer.vendor_site_id AS "vendorSiteId",
  offer.legal_entity_id AS "legalEntityId",offer.catalog_record_id AS "catalogRecordId",
  offer.unit_record_id AS "unitRecordId",offer.replaces_offer_id AS "replacesOfferId",
  offer.supplier_sku AS "supplierSku",offer.amount::float8 AS amount,offer.currency,
  offer.quantity_from::float8 AS "quantityFrom",offer.minimum_order_quantity::float8 AS "minimumOrderQuantity",
  offer.order_multiple::float8 AS "orderMultiple",offer.lead_time_days AS "leadTimeDays",
  offer.effective_from::text AS "effectiveFrom",offer.effective_to::text AS "effectiveTo",
  offer.source_type AS "sourceType",offer.source_reference AS "sourceReference",
  offer.tax_treatment AS "taxTreatment",offer.inclusions,offer.terms,offer.notes,offer.status,
  offer.archived_reason AS "archivedReason",offer.archived_at AS "archivedAt",offer.version,
  offer.created_at AS "createdAt",offer.updated_at AS "updatedAt",vendor.display_name AS "vendorName",
  vendor.status AS "vendorStatus",site.name AS "vendorSiteName",entity.display_name AS "legalEntityName",
  entity.base_currency AS "legalEntityBaseCurrency",
  CASE WHEN entity.id IS NULL THEN 'unbound' WHEN offer.currency=entity.base_currency THEN 'base' ELSE 'conversion_required' END AS "currencyBoundary",
  record.name AS "catalogRecordName",
  record.code AS "catalogRecordCode",record.kind AS "catalogRecordKind",unit.name AS "unitName",unit.code AS "unitCode"`;
const offerFrom = `FROM workspace_supplier_offers offer
  JOIN workspace_vendors vendor ON vendor.workspace_id=offer.workspace_id AND vendor.id=offer.vendor_id
  LEFT JOIN workspace_vendor_sites site ON site.workspace_id=offer.workspace_id AND site.id=offer.vendor_site_id
  LEFT JOIN legal_entities entity ON entity.workspace_id=offer.workspace_id AND entity.id=offer.legal_entity_id
  JOIN workspace_catalog_records record ON record.workspace_id=offer.workspace_id AND record.id=offer.catalog_record_id
  LEFT JOIN workspace_catalog_records unit ON unit.workspace_id=offer.workspace_id AND unit.id=offer.unit_record_id`;
const offerSelect = `SELECT ${offerColumns} ${offerFrom} WHERE offer.workspace_id=$1`;
const purchasableKinds = new Set(["work", "variant", "material", "sku", "hardware", "consumable", "service", "factory_process", "site_process", "resource", "logistics_rule", "installation_rule", "custom"]);

const nullable = (value: string | null | undefined) => value?.trim() || null;
const sorted = (values: string[] | undefined) => [...new Set(values ?? [])].sort();
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const isoDay = (value: string | null | undefined) => {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
    throw new BadRequestException("Choose a valid offer date.");
  return value;
};
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`
    : JSON.stringify(value);

function offerInput(input: CreateSupplierOfferDto): MutableOffer;
function offerInput(input: UpdateSupplierOfferDto, current: OfferRow): MutableOffer;
function offerInput(input: CreateSupplierOfferDto | UpdateSupplierOfferDto, current?: OfferRow): MutableOffer {
  const existing = current as OfferRow | undefined;
  const choose = <T>(provided: T | undefined, fallback: T) => provided === undefined ? fallback : provided;
  return {
    vendorSiteId: choose(input.vendorSiteId, existing?.vendorSiteId ?? null) ?? null,
    legalEntityId: choose(input.legalEntityId, existing?.legalEntityId ?? null) ?? null,
    unitRecordId: choose(input.unitRecordId, existing?.unitRecordId ?? null) ?? null,
    supplierSku: input.supplierSku === undefined ? existing?.supplierSku ?? null : nullable(input.supplierSku),
    amount: choose(input.amount, existing?.amount ?? null) ?? null,
    currency: input.currency === undefined ? existing?.currency ?? null : input.currency?.trim().toUpperCase() || null,
    quantityFrom: choose(input.quantityFrom, existing?.quantityFrom ?? null) ?? null,
    minimumOrderQuantity: choose(input.minimumOrderQuantity, existing?.minimumOrderQuantity ?? null) ?? null,
    orderMultiple: choose(input.orderMultiple, existing?.orderMultiple ?? null) ?? null,
    leadTimeDays: choose(input.leadTimeDays, existing?.leadTimeDays ?? null) ?? null,
    effectiveFrom: input.effectiveFrom === undefined ? existing?.effectiveFrom ?? null : isoDay(input.effectiveFrom),
    effectiveTo: input.effectiveTo === undefined ? existing?.effectiveTo ?? null : isoDay(input.effectiveTo),
    sourceType: input.sourceType === undefined ? existing?.sourceType ?? null : nullable(input.sourceType),
    sourceReference: input.sourceReference === undefined ? existing?.sourceReference ?? null : nullable(input.sourceReference),
    taxTreatment: input.taxTreatment ?? existing?.taxTreatment ?? "unconfirmed",
    inclusions: input.inclusions === undefined ? existing?.inclusions ?? [] : sorted(input.inclusions),
    terms: input.terms === undefined ? existing?.terms ?? "" : input.terms.trim(),
    notes: input.notes === undefined ? existing?.notes ?? "" : input.notes.trim(),
  };
}

export function validateSupplierOfferShape(value: MutableOffer, active: boolean) {
  if (value.effectiveFrom && value.effectiveTo && value.effectiveTo < value.effectiveFrom)
    throw new BadRequestException("The offer end date cannot precede its start date.");
  if (value.amount === 0 && value.sourceType !== "included")
    throw new BadRequestException("Mark a zero-cost offer as included so it cannot be confused with a missing price.");
  if (value.sourceType === "included" && value.amount !== null && value.amount !== 0)
    throw new BadRequestException("An included offer must have a zero amount.");
  if (active && (value.legalEntityId === null || value.unitRecordId === null || value.amount === null || !value.currency || !value.effectiveFrom ||
    !value.sourceType || !value.sourceReference?.trim() || value.taxTreatment === "unconfirmed"))
    throw new BadRequestException("Complete the legal entity, unit, price, currency, effective date, source reference and tax treatment before activation.");
}

function cursor(row: OfferRow) {
  return Buffer.from(JSON.stringify({ updatedAt: new Date(row.updatedAt).toISOString(), id: row.id })).toString("base64url");
}
function parseCursor(value?: string): { updatedAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.updatedAt !== "string" || !Number.isFinite(Date.parse(parsed.updatedAt)) || typeof parsed.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) return null;
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch { return null; }
}

@Injectable()
export class SupplierOfferService {
  constructor(private readonly access: WorkspaceAccessService, private readonly events: CrmEventsService) {}

  list(actor: RequestActor, workspaceId: string, input: ListSupplierOffersQueryDto) {
    return this.access.withPermission(actor, workspaceId, "supplier_offers.view", async (client) => {
      const page = parseCursor(input.cursor);
      if (input.cursor && !page) throw new BadRequestException("Invalid supplier-offer page cursor.");
      const values: unknown[] = [workspaceId];
      const clauses = ["offer.workspace_id=$1"];
      if (input.status) { values.push(input.status); clauses.push(`offer.status=$${values.length}`); }
      else clauses.push("offer.status<>'archived'");
      if (input.vendorId) { values.push(input.vendorId); clauses.push(`offer.vendor_id=$${values.length}::uuid`); }
      if (input.legalEntityId) { values.push(input.legalEntityId); clauses.push(`offer.legal_entity_id=$${values.length}::uuid`); }
      if (input.catalogRecordId) { values.push(input.catalogRecordId); clauses.push(`offer.catalog_record_id=$${values.length}::uuid`); }
      if (input.search) {
        values.push(input.search.trim().toLowerCase());
        clauses.push(`strpos(lower(vendor.display_name||' '||record.name||' '||record.code||' '||coalesce(offer.supplier_sku,'')||' '||coalesce(offer.source_reference,'')),$${values.length})>0`);
      }
      if (page) {
        values.push(page.updatedAt, page.id);
        clauses.push(`(offer.updated_at,offer.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
      }
      values.push(input.limit + 1);
      const rows = (await client.query<OfferRow>(`SELECT ${offerColumns} ${offerFrom} WHERE ${clauses.join(" AND ")} ORDER BY offer.updated_at DESC,offer.id DESC LIMIT $${values.length}`, values)).rows;
      const more = rows.length > input.limit;
      const data = more ? rows.slice(0, input.limit) : rows;
      return { data, nextCursor: more ? cursor(data[data.length - 1]!) : null };
    });
  }

  applicable(actor: RequestActor, workspaceId: string, input: ApplicableSupplierOffersQueryDto) {
    return this.access.withPermission(actor, workspaceId, "supplier_offers.view", async (client) => {
      const validOn = isoDay(input.validOn) ?? (await client.query<{ today: string }>(
        `SELECT (now() AT TIME ZONE default_timezone)::date::text AS today FROM workspaces WHERE id=$1`,
        [workspaceId],
      )).rows[0]!.today;
      const rows = (await client.query<OfferRow & { tierRank: string }>(
        `WITH eligible AS (
          SELECT ${offerColumns},row_number() OVER(
            PARTITION BY offer.vendor_id,offer.vendor_site_id
            ORDER BY coalesce(offer.quantity_from,0) DESC,offer.effective_from DESC,offer.id
          ) AS "tierRank"
          ${offerFrom}
          JOIN workspace_catalog_records owner ON owner.workspace_id=record.workspace_id AND owner.id=record.catalog_id
          JOIN workspace_catalog_records unit_owner ON unit_owner.workspace_id=unit.workspace_id AND unit_owner.id=unit.catalog_id
          WHERE offer.workspace_id=$1 AND offer.catalog_record_id=$2 AND offer.unit_record_id=$3
            AND offer.legal_entity_id=$4 AND offer.currency=$5 AND offer.status='active' AND vendor.status='active'
            AND (offer.vendor_site_id IS NULL OR site.status='active')
            AND NOT record.archived AND NOT owner.archived AND NOT unit.archived AND NOT unit_owner.archived
            AND offer.effective_from<=$6::date AND (offer.effective_to IS NULL OR offer.effective_to>=$6::date)
            AND coalesce(offer.quantity_from,0)<=$7
        ) SELECT * FROM eligible WHERE "tierRank"=1 ORDER BY lower("vendorName"),lower(coalesce("vendorSiteName",'')),id`,
        [workspaceId, input.catalogRecordId, input.unitRecordId, input.legalEntityId, input.currency, validOn, input.quantity],
      )).rows;
      return { catalogRecordId: input.catalogRecordId, unitRecordId: input.unitRecordId, legalEntityId: input.legalEntityId, currency: input.currency, quantity: input.quantity, validOn, options: rows };
    });
  }

  get(actor: RequestActor, workspaceId: string, offerId: string) {
    return this.access.withPermission(actor, workspaceId, "supplier_offers.view", (client) => this.offer(client, workspaceId, offerId));
  }

  create(actor: RequestActor, workspaceId: string, input: CreateSupplierOfferDto) {
    return this.access.withPermission(actor, workspaceId, "supplier_offers.manage", async (client, user) => {
      await this.lock(client, workspaceId);
      const value = offerInput(input);
      validateSupplierOfferShape(value, false);
      const existing = (await client.query<OfferRow>(`${offerSelect} AND offer.id=$2`, [workspaceId, input.id])).rows[0];
      if (existing) {
        if (existing.vendorId !== input.vendorId || existing.catalogRecordId !== input.catalogRecordId || existing.replacesOfferId !== (input.replacesOfferId ?? null) || existing.status !== "draft" || !same(this.mutable(existing), value))
          throw new ConflictException("This supplier-offer identifier is already in use.");
        return existing;
      }
      await this.assertReferences(client, workspaceId, input.id, input.vendorId, value.vendorSiteId, value.legalEntityId, input.catalogRecordId, value.unitRecordId, input.replacesOfferId ?? null, false);
      await client.query(
        `INSERT INTO workspace_supplier_offers(workspace_id,id,vendor_id,vendor_site_id,legal_entity_id,catalog_record_id,unit_record_id,replaces_offer_id,
          supplier_sku,amount,currency,quantity_from,minimum_order_quantity,order_multiple,lead_time_days,effective_from,
          effective_to,source_type,source_reference,tax_treatment,inclusions,terms,notes,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$24)`,
        [workspaceId, input.id, input.vendorId, value.vendorSiteId, value.legalEntityId, input.catalogRecordId, value.unitRecordId, input.replacesOfferId ?? null,
          value.supplierSku, value.amount, value.currency, value.quantityFrom, value.minimumOrderQuantity,
          value.orderMultiple, value.leadTimeDays, value.effectiveFrom, value.effectiveTo, value.sourceType,
          value.sourceReference, value.taxTreatment, value.inclusions, value.terms, value.notes, user.userId],
      );
      const after = await this.offer(client, workspaceId, input.id);
      await this.record(client, workspaceId, user.userId, "supplier_offer.created.v1", input.id, null, after);
      return after;
    });
  }

  update(actor: RequestActor, workspaceId: string, offerId: string, input: UpdateSupplierOfferDto) {
    return this.access.withPermission(actor, workspaceId, "supplier_offers.manage", async (client, user) => {
      await this.lock(client, workspaceId);
      const before = await this.offer(client, workspaceId, offerId, true);
      if (before.status !== "draft") throw new ConflictException("Active or archived supplier offers are immutable. Create a replacement offer.");
      if (before.version !== input.version) throw new ConflictException("This supplier offer changed. Reload it and try again.");
      const value = offerInput(input, before);
      validateSupplierOfferShape(value, false);
      await this.assertReferences(client, workspaceId, before.id, before.vendorId, value.vendorSiteId, value.legalEntityId, before.catalogRecordId, value.unitRecordId, before.replacesOfferId, false);
      if (same(this.mutable(before), value)) return before;
      await client.query(
        `UPDATE workspace_supplier_offers SET vendor_site_id=$3,legal_entity_id=$4,unit_record_id=$5,supplier_sku=$6,amount=$7,
          currency=$8,quantity_from=$9,minimum_order_quantity=$10,order_multiple=$11,lead_time_days=$12,
          effective_from=$13,effective_to=$14,source_type=$15,source_reference=$16,tax_treatment=$17,
          inclusions=$18,terms=$19,notes=$20,version=version+1,updated_by=$21,updated_at=now()
         WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, offerId, value.vendorSiteId, value.legalEntityId, value.unitRecordId, value.supplierSku, value.amount,
          value.currency, value.quantityFrom, value.minimumOrderQuantity, value.orderMultiple, value.leadTimeDays,
          value.effectiveFrom, value.effectiveTo, value.sourceType, value.sourceReference, value.taxTreatment,
          value.inclusions, value.terms, value.notes, user.userId],
      );
      const after = await this.offer(client, workspaceId, offerId);
      await this.record(client, workspaceId, user.userId, "supplier_offer.updated.v1", offerId, before, after);
      return after;
    });
  }

  lifecycle(actor: RequestActor, workspaceId: string, offerId: string, input: SupplierOfferLifecycleDto) {
    return this.access.withPermission(actor, workspaceId, "supplier_offers.manage", async (client, user) => {
      await this.lock(client, workspaceId);
      const intent = { offerId, action: input.action, version: input.version, reason: input.reason?.trim() || null };
      const requestHash = createHash("sha256").update(canonical(intent)).digest("hex");
      const prior = (await client.query<{ requestHash: string; response: OfferRow }>(
        `SELECT request_hash AS "requestHash",response FROM workspace_supplier_offer_commands WHERE workspace_id=$1 AND request_id=$2`,
        [workspaceId, input.requestId],
      )).rows[0];
      if (prior) {
        if (prior.requestHash !== requestHash) throw new ConflictException("This supplier-offer request identifier was already used for another action.");
        return prior.response;
      }
      const before = await this.offer(client, workspaceId, offerId, true);
      if (before.version !== input.version) throw new ConflictException("This supplier offer changed. Reload it and try again.");
      let event: string;
      if (input.action === "activate") {
        if (before.status !== "draft") throw new ConflictException("Only a draft supplier offer can be activated.");
        const value = this.mutable(before);
        validateSupplierOfferShape(value, true);
        await this.assertReferences(client, workspaceId, before.id, before.vendorId, value.vendorSiteId, value.legalEntityId, before.catalogRecordId, value.unitRecordId, before.replacesOfferId, true);
        await this.assertNoOverlap(client, workspaceId, before);
        await client.query(`UPDATE workspace_supplier_offers SET status='active',version=version+1,updated_by=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, offerId, user.userId]);
        event = "supplier_offer.activated.v1";
      } else if (input.action === "archive") {
        if (before.status === "archived") throw new ConflictException("This supplier offer is already archived.");
        const reason = input.reason?.trim();
        if (!reason) throw new BadRequestException("Explain why this supplier offer is being archived.");
        await client.query(`UPDATE workspace_supplier_offers SET status='archived',archived_reason=$3,archived_at=now(),archived_by=$4,version=version+1,updated_by=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, offerId, reason, user.userId]);
        event = "supplier_offer.archived.v1";
      } else {
        if (before.status !== "archived") throw new ConflictException("Only an archived supplier offer can be restored.");
        if (!input.reason?.trim()) throw new BadRequestException("Explain why this supplier offer is being restored.");
        await client.query(`UPDATE workspace_supplier_offers SET status='draft',archived_reason=NULL,archived_at=NULL,archived_by=NULL,version=version+1,updated_by=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, offerId, user.userId]);
        event = "supplier_offer.restored.v1";
      }
      const after = await this.offer(client, workspaceId, offerId);
      await client.query(`INSERT INTO workspace_supplier_offer_commands(workspace_id,request_id,offer_id,action,request_hash,response,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [workspaceId, input.requestId, offerId, input.action, requestHash, after, user.userId]);
      await this.record(client, workspaceId, user.userId, event, offerId, before, { ...after, reason: input.reason?.trim() || null });
      return after;
    });
  }

  private mutable(row: OfferRow): MutableOffer {
    const { vendorSiteId, legalEntityId, unitRecordId, supplierSku, amount, currency, quantityFrom, minimumOrderQuantity,
      orderMultiple, leadTimeDays, effectiveFrom, effectiveTo, sourceType, sourceReference, taxTreatment,
      inclusions, terms, notes } = row;
    return { vendorSiteId, legalEntityId, unitRecordId, supplierSku, amount, currency, quantityFrom, minimumOrderQuantity,
      orderMultiple, leadTimeDays, effectiveFrom, effectiveTo, sourceType, sourceReference, taxTreatment,
      inclusions, terms, notes };
  }

  private async offer(client: PoolClient, workspaceId: string, offerId: string, lock = false) {
    const row = (await client.query<OfferRow>(`${offerSelect} AND offer.id=$2${lock ? " FOR UPDATE OF offer" : ""}`, [workspaceId, offerId])).rows[0];
    if (!row) throw new NotFoundException("Supplier offer not found.");
    return row;
  }

  private async assertReferences(client: PoolClient, workspaceId: string, offerId: string, vendorId: string, siteId: string | null,
    legalEntityId: string | null, recordId: string, unitId: string | null, replacesOfferId: string | null, requireActiveVendor: boolean) {
    const vendor = (await client.query<{ status: string }>(`SELECT status FROM workspace_vendors WHERE workspace_id=$1 AND id=$2 FOR SHARE`, [workspaceId, vendorId])).rows[0];
    if (!vendor || vendor.status === "archived" || (requireActiveVendor && vendor.status !== "active"))
      throw new BadRequestException(requireActiveVendor ? "Choose an active vendor." : "Choose an available vendor from this workspace.");
    if (siteId) {
      const site = (await client.query<{ status: string }>(`SELECT status FROM workspace_vendor_sites WHERE workspace_id=$1 AND vendor_id=$2 AND id=$3 FOR SHARE`, [workspaceId, vendorId, siteId])).rows[0];
      if (!site || site.status !== "active") throw new BadRequestException("Choose an active location belonging to this vendor.");
    }
    if (legalEntityId) {
      const entity = (await client.query<{ status: string }>(
        `SELECT status FROM legal_entities WHERE workspace_id=$1 AND id=$2 FOR SHARE`, [workspaceId, legalEntityId],
      )).rows[0];
      if (!entity || entity.status !== "active") throw new BadRequestException("Choose an active legal entity from this workspace.");
    } else if (requireActiveVendor) throw new BadRequestException("Choose the legal entity that owns this cost.");
    const record = (await client.query<{ kind: string; archived: boolean; catalogId: string; ownerArchived: boolean }>(
      `SELECT record.kind,record.archived,record.catalog_id AS "catalogId",owner.archived AS "ownerArchived"
       FROM workspace_catalog_records record JOIN workspace_catalog_records owner
         ON owner.workspace_id=record.workspace_id AND owner.id=record.catalog_id
       WHERE record.workspace_id=$1 AND record.id=$2 FOR SHARE OF record,owner`, [workspaceId, recordId])).rows[0];
    if (!record || record.archived || record.ownerArchived || !purchasableKinds.has(record.kind))
      throw new BadRequestException("Choose an active purchasable catalog item or service.");
    if (unitId) {
      const unit = (await client.query<{ kind: string; archived: boolean; catalogId: string; ownerArchived: boolean }>(
        `SELECT unit.kind,unit.archived,unit.catalog_id AS "catalogId",owner.archived AS "ownerArchived"
         FROM workspace_catalog_records unit JOIN workspace_catalog_records owner
           ON owner.workspace_id=unit.workspace_id AND owner.id=unit.catalog_id
         WHERE unit.workspace_id=$1 AND unit.id=$2 FOR SHARE OF unit,owner`, [workspaceId, unitId])).rows[0];
      if (!unit || unit.kind !== "unit" || unit.archived || unit.ownerArchived || unit.catalogId !== record.catalogId)
        throw new BadRequestException("Choose an active unit from the same catalog as the offered item.");
    }
    if (replacesOfferId) {
      if (replacesOfferId === offerId) throw new BadRequestException("A supplier offer cannot replace itself.");
      const replaced = (await client.query<{ vendorId: string; catalogRecordId: string; unitRecordId: string | null }>(
        `SELECT vendor_id AS "vendorId",catalog_record_id AS "catalogRecordId",unit_record_id AS "unitRecordId"
         FROM workspace_supplier_offers WHERE workspace_id=$1 AND id=$2 FOR SHARE`, [workspaceId, replacesOfferId],
      )).rows[0];
      if (!replaced || replaced.vendorId !== vendorId || replaced.catalogRecordId !== recordId || replaced.unitRecordId !== unitId)
        throw new BadRequestException("A replacement must refer to an earlier offer for the same vendor, item and unit.");
    }
  }

  private async assertNoOverlap(client: PoolClient, workspaceId: string, offer: OfferRow) {
    const overlap = await client.query(
      `SELECT 1 FROM workspace_supplier_offers WHERE workspace_id=$1 AND id<>$2 AND status='active'
        AND vendor_id=$3 AND vendor_site_id IS NOT DISTINCT FROM $4::uuid
        AND legal_entity_id IS NOT DISTINCT FROM $5::uuid AND catalog_record_id=$6
        AND unit_record_id=$7 AND currency=$8 AND coalesce(quantity_from,0)=coalesce($9,0)
        AND effective_from<=coalesce($11::date,'infinity'::date)
        AND $10::date<=coalesce(effective_to,'infinity'::date) LIMIT 1`,
      [workspaceId, offer.id, offer.vendorId, offer.vendorSiteId, offer.legalEntityId, offer.catalogRecordId,
        offer.unitRecordId, offer.currency, offer.quantityFrom, offer.effectiveFrom, offer.effectiveTo],
    );
    if (overlap.rowCount) throw new ConflictException("This vendor already has an active overlapping offer for the same item, unit, currency and quantity tier.");
  }

  private async lock(client: PoolClient, workspaceId: string) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`catalog:${workspaceId}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`supplier-offers:${workspaceId}`]);
  }

  private record(client: PoolClient, workspaceId: string, actorUserId: string, action: string,
    entityId: string, before: unknown, after: unknown) {
    return this.events.record(client, { workspaceId, actorUserId, source: "user", action,
      entityType: "supplier_offer", entityId,
      before: before === null ? null : before as Record<string, unknown>,
      after: after === null ? null : after as Record<string, unknown> });
  }
}
