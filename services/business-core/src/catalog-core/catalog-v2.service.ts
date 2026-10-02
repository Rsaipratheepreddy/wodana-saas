import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { AiGatewayService } from "../ai-gateway/ai-gateway.service";
import { CLEAN_SYSTEM, COMPONENTS_SYSTEM, cleanPrompt, componentsPrompt, validateClean, validateComponents, type CleanSuggestion } from "./catalog-ai";
import { PACK_UNITS, planCatalogImport, type ImportRow } from "./catalog-import";
import { AttributeValueError, normalizeAttributeValues, type AttributeDefinition, type AttributeType } from "./attributes";
import { assertNoCycle, BomError, checkFormulas, explode, type BomComponent } from "./bom";
import { Dec } from "./decimal";
import { formulaInputs, FormulaError, parseFormula } from "./formula";
import { price, type PriceMethod } from "./pricing";
import { convert, STANDARD_UNITS, UnitError, type Unit } from "./units";

const VIEW = "catalog.view";
const MANAGE = "catalog.manage";
const COST_PERMISSIONS = ["commercial.costs.view", "supplier_offers.view"];
const ITEM_TYPES = ["product", "material", "assembly", "service", "package", "ready_made"] as const;
const slug = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

type Actor = { userId: string };
export type ItemInput = {
  version?: number; code: string; name: string; itemType: (typeof ITEM_TYPES)[number]; unitCode: string; categoryId?: string | null;
  description?: string | null; wastePercent?: string | null; purchaseRoundTo?: string | null; values?: Record<string, unknown>;
};
export type PriceEntryInput = {
  variantId?: string | null; method: PriceMethod["method"];
  price?: string | null; cost?: string | null; markupPercent?: string | null; rate?: string | null; minimumCharge?: string | null;
  labour?: string | null; marginPercent?: string | null;
  tiers?: Array<{ fromQuantity: string; price: string }>;
  surcharges?: Array<{ attributeCode: string; value: string; percent?: string | null; amount?: string | null; label?: string | null }>;
};

/** Catalog v2: typed catalogs, items, BoM and explainable prices (plan §6.4). */
@Injectable()
export class CatalogV2Service {
  constructor(private readonly access: WorkspaceAccessService, private readonly ai: AiGatewayService) {}

  // ---------- catalogs, categories, attributes ----------
  listCatalogs(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => (await client.query(
      `SELECT catalog.id, catalog.code, catalog.name, catalog.purpose, catalog.status, catalog.version,
              (SELECT count(*)::int FROM catalog_items item WHERE item.catalog_id = catalog.id AND item.status <> 'archived') AS "itemCount"
       FROM catalogs catalog WHERE catalog.workspace_id = $1 AND catalog.status = 'active' ORDER BY catalog.name`, [workspaceId])).rows);
  }

  createCatalog(actor: RequestActor, workspaceId: string, input: { name: string; code?: string; purpose?: "sell" | "buy" | "reference" }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const code = input.code ? slug(input.code) : slug(input.name);
      if (!code || !input.name?.trim()) throw new UnprocessableEntityException("Give the catalog a name");
      const created = await this.unique(() => client.query<{ id: string }>(
        `INSERT INTO catalogs (workspace_id, code, name, purpose, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [workspaceId, code.replace(/_/g, "-"), input.name.trim(), input.purpose ?? "sell", user.userId]), "A catalog with this name already exists");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.created", entityType: "catalog", entityId: created.rows[0].id, after: { code, name: input.name } });
      return { id: created.rows[0].id };
    });
  }

  structure(actor: RequestActor, workspaceId: string, catalogId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      await this.catalog(client, workspaceId, catalogId);
      const categories = await client.query(
        `SELECT id, parent_id AS "parentId", code, name, sort_order AS "sortOrder" FROM catalog_categories
         WHERE workspace_id = $1 AND catalog_id = $2 AND status = 'active' ORDER BY sort_order, name`, [workspaceId, catalogId]);
      const attributes = await this.attributes(client, workspaceId, catalogId, null, true);
      return { categories: categories.rows, attributes, units: await this.units(client, workspaceId) };
    });
  }

  createCategory(actor: RequestActor, workspaceId: string, catalogId: string, input: { name: string; parentId?: string | null }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      await this.catalog(client, workspaceId, catalogId);
      if (!input.name?.trim()) throw new UnprocessableEntityException("Give the category a name");
      if (input.parentId) await this.category(client, workspaceId, catalogId, input.parentId);
      const created = await this.unique(() => client.query<{ id: string }>(
        `INSERT INTO catalog_categories (workspace_id, catalog_id, parent_id, code, name,
           sort_order) VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(sort_order), 0) + 1 FROM catalog_categories WHERE catalog_id = $2)) RETURNING id`,
        [workspaceId, catalogId, input.parentId ?? null, slug(input.name).replace(/_/g, "-") || "category", input.name.trim()]), "A category with this name already exists");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.category_created", entityType: "catalog", entityId: catalogId, after: input });
      return { id: created.rows[0].id };
    });
  }

  createAttribute(actor: RequestActor, workspaceId: string, catalogId: string, input: { label: string; code?: string; categoryId?: string | null; valueType: AttributeType; unitCode?: string | null; required?: boolean; choices?: string[] }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      await this.catalog(client, workspaceId, catalogId);
      if (input.categoryId) await this.category(client, workspaceId, catalogId, input.categoryId);
      const code = slug(input.code ?? input.label);
      if (!code || !/^[a-z]/.test(code)) throw new UnprocessableEntityException("Start the attribute name with a letter");
      const choices = [...new Set((input.choices ?? []).map((choice) => choice.trim()).filter(Boolean))].map((label) => ({ value: slug(label) || label, label }));
      if ((input.valueType === "choice" || input.valueType === "multi_choice") && !choices.length) throw new UnprocessableEntityException("Add at least one option");
      if (input.valueType === "dimension") {
        if (!input.unitCode) throw new UnprocessableEntityException("Choose the unit for this dimension");
        await this.unit(client, workspaceId, input.unitCode);
      }
      const created = await this.unique(() => client.query<{ id: string }>(
        `INSERT INTO catalog_attributes (workspace_id, catalog_id, category_id, code, label, value_type, unit_code, required, choices)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) RETURNING id`,
        [workspaceId, catalogId, input.categoryId ?? null, code, input.label.trim(), input.valueType, input.unitCode ?? null, Boolean(input.required), JSON.stringify(choices)]),
        "An attribute with this name already exists here");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.attribute_created", entityType: "catalog", entityId: catalogId, after: { ...input, code } });
      return { id: created.rows[0].id };
    });
  }

  // ---------- items ----------
  listItems(actor: RequestActor, workspaceId: string, catalogId: string, query: { categoryId?: string; search?: string; itemType?: string; limit?: number; cursor?: string }) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      await this.catalog(client, workspaceId, catalogId);
      const values: unknown[] = [workspaceId, catalogId];
      const where = ["item.workspace_id = $1", "item.catalog_id = $2", "item.status <> 'archived'"];
      if (query.categoryId) {
        values.push(query.categoryId);
        // The category and everything below it.
        where.push(`item.category_id IN (WITH RECURSIVE tree AS (SELECT id FROM catalog_categories WHERE id = $${values.length}
          UNION ALL SELECT child.id FROM catalog_categories child JOIN tree ON child.parent_id = tree.id) SELECT id FROM tree)`);
      }
      if (query.itemType) { values.push(query.itemType); where.push(`item.item_type = $${values.length}`); }
      if (query.search?.trim()) { values.push(`%${query.search.trim().replace(/[%_]/g, "\\$&")}%`); where.push(`(item.name ILIKE $${values.length} OR item.code ILIKE $${values.length})`); }
      if (query.cursor) { values.push(query.cursor); where.push(`item.name > $${values.length}`); }
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
      values.push(limit + 1);
      const rows = await client.query<{ id: string; name: string }>(
        `SELECT item.id, item.code, item.name, item.item_type AS "itemType", item.unit_code AS "unitCode", item.status, item.version,
                item.category_id AS "categoryId", category.name AS "categoryName",
                coalesce((SELECT jsonb_object_agg(attribute.code, value.value) FROM catalog_item_values value
                  JOIN catalog_attributes attribute ON attribute.id = value.attribute_id WHERE value.item_id = item.id), '{}'::jsonb) AS "values",
                (SELECT jsonb_build_object('method', entry.method, 'price', entry.price::text, 'rate', entry.rate::text, 'currency', book.currency, 'status', entry.status)
                  FROM price_entries entry JOIN price_books book ON book.id = entry.price_book_id
                  WHERE entry.item_id = item.id AND entry.variant_id IS NULL AND entry.status = 'active' AND book.status = 'active'
                  ORDER BY book.effective_from DESC LIMIT 1) AS "sellPrice",
                (SELECT jsonb_build_object('id', image.id, 'hasPreview', image.preview_key IS NOT NULL) FROM catalog_item_images image
                  WHERE image.workspace_id = item.workspace_id AND image.item_id = item.id ORDER BY image.sort_order, image.created_at LIMIT 1) AS "image"
         FROM catalog_items item LEFT JOIN catalog_categories category ON category.id = item.category_id
         WHERE ${where.join(" AND ")} ORDER BY item.name LIMIT $${values.length}`, values);
      const page = rows.rows.slice(0, limit);
      return { items: page, nextCursor: rows.rows.length > limit ? page[page.length - 1].name : null };
    });
  }

  getItem(actor: RequestActor, workspaceId: string, catalogId: string, itemId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      const canViewCosts = await this.canViewCosts(actor, workspaceId);
      return this.itemDetail(client, workspaceId, catalogId, itemId, canViewCosts);
    });
  }

  createItem(actor: RequestActor, workspaceId: string, catalogId: string, input: ItemInput) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      await this.catalog(client, workspaceId, catalogId);
      const clean = await this.cleanItem(client, workspaceId, catalogId, input);
      const created = await this.unique(() => client.query<{ id: string }>(
        `INSERT INTO catalog_items (workspace_id, catalog_id, category_id, code, name, item_type, unit_code, description, waste_percent, purchase_round_to, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::numeric, $11, $11) RETURNING id`,
        [workspaceId, catalogId, clean.categoryId, clean.code, clean.name, clean.itemType, clean.unitCode, clean.description, clean.wastePercent, clean.purchaseRoundTo, user.userId]),
        `Code ${clean.code} is already used in this catalog`);
      const itemId = created.rows[0].id;
      await this.writeValues(client, workspaceId, itemId, clean.values);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.item_created", entityType: "catalog_item", entityId: itemId, after: clean });
      return this.itemDetail(client, workspaceId, catalogId, itemId, await this.canViewCosts(actor, workspaceId));
    });
  }

  updateItem(actor: RequestActor, workspaceId: string, catalogId: string, itemId: string, input: ItemInput) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const before = await this.lockItem(client, workspaceId, catalogId, itemId);
      if (input.version !== before.version) throw new ConflictException("This item changed; reload and try again");
      const clean = await this.cleanItem(client, workspaceId, catalogId, input);
      await this.unique(() => client.query(
        `UPDATE catalog_items SET category_id = $3, code = $4, name = $5, item_type = $6, unit_code = $7, description = $8, waste_percent = $9::numeric,
           purchase_round_to = $10::numeric, updated_by = $11, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, itemId, clean.categoryId, clean.code, clean.name, clean.itemType, clean.unitCode, clean.description, clean.wastePercent, clean.purchaseRoundTo, user.userId]),
        `Code ${clean.code} is already used in this catalog`);
      await client.query(`DELETE FROM catalog_item_values WHERE workspace_id = $1 AND item_id = $2`, [workspaceId, itemId]);
      await this.writeValues(client, workspaceId, itemId, clean.values);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.item_updated", entityType: "catalog_item", entityId: itemId, before, after: clean });
      return this.itemDetail(client, workspaceId, catalogId, itemId, await this.canViewCosts(actor, workspaceId));
    });
  }

  archiveItem(actor: RequestActor, workspaceId: string, catalogId: string, itemId: string, version: number) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const before = await this.lockItem(client, workspaceId, catalogId, itemId);
      if (version !== before.version) throw new ConflictException("This item changed; reload and try again");
      const usedIn = await client.query<{ name: string }>(
        `SELECT parent.name FROM catalog_components component JOIN catalog_items parent ON parent.id = component.parent_item_id
         WHERE component.workspace_id = $1 AND component.component_item_id = $2 AND parent.status <> 'archived' LIMIT 3`, [workspaceId, itemId]);
      if (usedIn.rowCount) throw new ConflictException(`Used in ${usedIn.rows.map((row) => row.name).join(", ")}. Remove it there first.`);
      await client.query(`UPDATE catalog_items SET status = 'archived', version = version + 1, updated_by = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, itemId, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.item_archived", entityType: "catalog_item", entityId: itemId, before });
      return { id: itemId, status: "archived" };
    });
  }

  setComponents(actor: RequestActor, workspaceId: string, catalogId: string, itemId: string, input: { version: number; components: Array<{ componentItemId: string; componentVariantId?: string | null; quantityFormula: string; unitCode: string }> }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const before = await this.lockItem(client, workspaceId, catalogId, itemId);
      if (input.version !== before.version) throw new ConflictException("This item changed; reload and try again");
      if (!["assembly", "package"].includes(before.itemType)) throw new UnprocessableEntityException("Only assemblies and packages have components");
      const ids = input.components.map((component) => component.componentItemId);
      const found = await client.query<{ id: string; name: string; status: string }>(
        `SELECT id, name, status FROM catalog_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])`, [workspaceId, ids]);
      const byId = new Map(found.rows.map((row) => [row.id, row]));
      const missing = ids.find((id) => !byId.get(id) || byId.get(id)!.status === "archived");
      if (missing) throw new UnprocessableEntityException("A component is missing or archived");
      for (const component of input.components) await this.unit(client, workspaceId, component.unitCode);
      const components: BomComponent[] = input.components.map((component) => ({ ...component, label: byId.get(component.componentItemId)!.name }));
      try {
        checkFormulas(components);
        const edges = await client.query<{ parent: string; child: string }>(
          `SELECT parent_item_id AS parent, component_item_id AS child FROM catalog_components WHERE workspace_id = $1`, [workspaceId]);
        const children = new Map<string, string[]>();
        for (const edge of edges.rows) if (edge.parent !== itemId) children.set(edge.parent, [...(children.get(edge.parent) ?? []), edge.child]);
        assertNoCycle(itemId, ids, (id) => children.get(id) ?? []);
      } catch (error) {
        if (error instanceof BomError) throw new UnprocessableEntityException(error.message);
        throw error;
      }
      await client.query(`DELETE FROM catalog_components WHERE workspace_id = $1 AND parent_item_id = $2`, [workspaceId, itemId]);
      for (const [index, component] of input.components.entries()) {
        await client.query(
          `INSERT INTO catalog_components (workspace_id, parent_item_id, component_item_id, component_variant_id, quantity_formula, unit_code, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [workspaceId, itemId, component.componentItemId, component.componentVariantId ?? null, component.quantityFormula.trim(), component.unitCode, index]);
      }
      await client.query(`UPDATE catalog_items SET version = version + 1, updated_by = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, itemId, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.components_set", entityType: "catalog_item", entityId: itemId, after: input.components });
      return this.itemDetail(client, workspaceId, catalogId, itemId, await this.canViewCosts(actor, workspaceId));
    });
  }

  // ---------- prices ----------
  createPriceBook(actor: RequestActor, workspaceId: string, catalogId: string, input: { name: string; currency: string; legalEntityId?: string | null; segment?: string | null; effectiveFrom?: string; effectiveTo?: string | null }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      await this.catalog(client, workspaceId, catalogId);
      if (!/^[A-Z]{3}$/.test(input.currency ?? "")) throw new UnprocessableEntityException("Choose a currency");
      if (input.legalEntityId) {
        const entity = await client.query<{ currency: string }>(`SELECT base_currency AS currency FROM legal_entities WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.legalEntityId]);
        if (!entity.rowCount) throw new NotFoundException("Business not found");
      }
      const created = await client.query<{ id: string }>(
        `INSERT INTO price_books (workspace_id, catalog_id, name, currency, legal_entity_id, segment, effective_from, effective_to)
         VALUES ($1, $2, $3, $4, $5, $6, coalesce($7::date, current_date), $8::date) RETURNING id`,
        [workspaceId, catalogId, input.name?.trim() || `${input.currency} prices`, input.currency, input.legalEntityId ?? null, input.segment ?? null, input.effectiveFrom ?? null, input.effectiveTo ?? null]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.price_book_created", entityType: "catalog", entityId: catalogId, after: input });
      return { id: created.rows[0].id };
    });
  }

  listPriceBooks(actor: RequestActor, workspaceId: string, catalogId: string) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => (await client.query(
      `SELECT id, name, currency, legal_entity_id AS "legalEntityId", segment, effective_from::text AS "effectiveFrom", effective_to::text AS "effectiveTo", status, version
       FROM price_books WHERE workspace_id = $1 AND catalog_id = $2 ORDER BY status = 'active' DESC, effective_from DESC`, [workspaceId, catalogId])).rows);
  }

  setPriceBookStatus(actor: RequestActor, workspaceId: string, bookId: string, input: { version: number; status: "active" | "expired" }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const book = await client.query<{ version: number; status: string }>(`SELECT version, status FROM price_books WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, bookId]);
      if (!book.rowCount) throw new NotFoundException("Price book not found");
      if (book.rows[0].version !== input.version) throw new ConflictException("This price book changed; reload and try again");
      await client.query(`UPDATE price_books SET status = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, bookId, input.status]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `catalog.price_book_${input.status}`, entityType: "price_book", entityId: bookId });
      return { id: bookId, status: input.status };
    });
  }

  /** Draft or replace the price of an item in a book. A change goes back to draft until reviewed. */
  savePrice(actor: RequestActor, workspaceId: string, bookId: string, itemId: string, input: PriceEntryInput) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const book = await client.query<{ catalogId: string; status: string }>(`SELECT catalog_id AS "catalogId", status FROM price_books WHERE workspace_id = $1 AND id = $2`, [workspaceId, bookId]);
      if (!book.rowCount) throw new NotFoundException("Price book not found");
      if (book.rows[0].status === "expired") throw new UnprocessableEntityException("This price book has expired");
      const item = await this.lockItem(client, workspaceId, book.rows[0].catalogId, itemId);
      const numbers = this.priceNumbers(input);
      const surcharges = await this.resolveSurcharges(client, workspaceId, book.rows[0].catalogId, input.surcharges ?? []);
      if (input.method === "tiered" && !(input.tiers ?? []).length) throw new UnprocessableEntityException("Add at least one quantity tier");
      if (input.method === "assembly_rollup" && item.itemType !== "assembly") throw new UnprocessableEntityException("Only assemblies can roll up their components");
      if (input.variantId) {
        const variant = await client.query(`SELECT 1 FROM catalog_variants WHERE workspace_id = $1 AND id = $2 AND item_id = $3`, [workspaceId, input.variantId, itemId]);
        if (!variant.rowCount) throw new NotFoundException("Variant not found");
      }
      // Close the current entry (kept as history) and open a new draft.
      await client.query(
        `UPDATE price_entries SET status = 'expired', updated_at = now() WHERE workspace_id = $1 AND price_book_id = $2 AND item_id = $3
           AND variant_id IS NOT DISTINCT FROM $4 AND status <> 'expired'`, [workspaceId, bookId, itemId, input.variantId ?? null]);
      let entryId: string;
      try {
        const created = await client.query<{ id: string }>(
          `INSERT INTO price_entries (workspace_id, price_book_id, item_id, variant_id, method, price, cost, markup_percent, rate, minimum_charge, labour, margin_percent, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12::numeric, $13, $13) RETURNING id`,
          [workspaceId, bookId, itemId, input.variantId ?? null, input.method, numbers.price, numbers.cost, numbers.markupPercent, numbers.rate, numbers.minimumCharge, numbers.labour, numbers.marginPercent, user.userId]);
        entryId = created.rows[0].id;
      } catch (error) {
        if ((error as { code?: string }).code === "23514") throw new UnprocessableEntityException("Fill in the values this price method needs");
        throw error;
      }
      for (const tier of input.tiers ?? []) {
        await client.query(`INSERT INTO price_entry_tiers (workspace_id, price_entry_id, from_quantity, price) VALUES ($1, $2, $3::numeric, $4::numeric)`,
          [workspaceId, entryId, this.decimal(tier.fromQuantity, "Tier quantity"), this.decimal(tier.price, "Tier price")]);
      }
      for (const surcharge of surcharges) {
        await client.query(`INSERT INTO price_entry_surcharges (workspace_id, price_entry_id, attribute_id, value, percent, amount, label) VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7)`,
          [workspaceId, entryId, surcharge.attributeId, surcharge.value, surcharge.percent, surcharge.amount, surcharge.label]);
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.price_drafted", entityType: "catalog_item", entityId: itemId, after: { bookId, ...input } });
      return { id: entryId, status: "draft" };
    });
  }

  /** QS review then activation; the person who drafted a price cannot review it. */
  reviewPrice(actor: RequestActor, workspaceId: string, entryId: string, input: { version: number; decision: "reviewed" | "active" }) {
    const permission = input.decision === "reviewed" ? "commercial.estimate" : MANAGE;
    return this.access.withPermission(actor, workspaceId, permission, async (client, user) => {
      const entry = await client.query<{ version: number; status: string; createdBy: string; itemId: string }>(
        `SELECT version, status, created_by AS "createdBy", item_id AS "itemId" FROM price_entries WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, entryId]);
      if (!entry.rowCount) throw new NotFoundException("Price not found");
      const current = entry.rows[0];
      if (current.version !== input.version) throw new ConflictException("This price changed; reload and try again");
      if (input.decision === "reviewed") {
        if (current.status !== "draft") throw new UnprocessableEntityException("Only a draft price can be reviewed");
        if (current.createdBy === user.userId) throw new UnprocessableEntityException("Someone other than the author must review this price");
        await client.query(`UPDATE price_entries SET status = 'reviewed', reviewed_by = $3, reviewed_at = now(), version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, entryId, user.userId]);
      } else {
        if (current.status !== "reviewed") throw new UnprocessableEntityException("A price must be reviewed before it goes live");
        await client.query(`UPDATE price_entries SET status = 'active', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, entryId]);
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `catalog.price_${input.decision}`, entityType: "catalog_item", entityId: current.itemId, after: { entryId } });
      return { id: entryId, status: input.decision };
    });
  }

  /**
   * What an item costs the customer for a quantity (with measurements for assemblies): quantity in
   * the sell unit, BoM explosion, and the price with its breakdown. Cost lines only for cost viewers.
   */
  pricePreview(actor: RequestActor, workspaceId: string, catalogId: string, input: { itemId: string; variantId?: string | null; priceBookId: string; quantity: string; quantityUnit?: string; attributes?: Record<string, string>; measurements?: Record<string, string> }) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      const canViewCosts = await this.canViewCosts(actor, workspaceId);
      const detail = await this.itemDetail(client, workspaceId, catalogId, input.itemId, true);
      const book = await client.query<{ currency: string }>(`SELECT currency FROM price_books WHERE workspace_id = $1 AND id = $2 AND catalog_id = $3`, [workspaceId, input.priceBookId, catalogId]);
      if (!book.rowCount) throw new NotFoundException("Price book not found");
      const decimals = currencyDecimals(book.rows[0].currency);
      let quantity: Dec;
      try {
        quantity = convert(this.decimal(input.quantity, "Quantity"), input.quantityUnit ?? detail.unitCode, detail.unitCode, await this.units(client, workspaceId), detail.conversions);
      } catch (error) { if (error instanceof UnitError) throw new UnprocessableEntityException(error.message); throw error; }
      const entry = detail.prices.find((row) => row.priceBookId === input.priceBookId && (row.variantId ?? null) === (input.variantId ?? null) && row.status !== "expired");
      let components: ReturnType<typeof explode> = [];
      try {
        if (detail.components.length) components = explode(detail.components.map((component) => ({ ...component, label: component.name })), quantity, input.measurements ?? {});
      } catch (error) {
        if (error instanceof FormulaError || error instanceof BomError) throw new UnprocessableEntityException(error.message);
        throw error;
      }
      let method: PriceMethod | null = entry ? await this.toMethod(client, workspaceId, entry, detail, input.priceBookId) : null;
      const result = price(method, { quantity, currencyDecimals: decimals, attributes: input.attributes });
      if (result.available && !canViewCosts && method && ["cost_plus", "assembly_rollup"].includes(method.method)) {
        // Selling price only: hide how cost and margin were built.
        method = null;
        return { quantity: quantity.toString(), unitCode: detail.unitCode, currency: book.rows[0].currency, status: entry?.status ?? null, result: { ...result, breakdown: [{ label: "Price", amount: result.total }] }, components };
      }
      return { quantity: quantity.toString(), unitCode: detail.unitCode, currency: book.rows[0].currency, status: entry?.status ?? null, result, components };
    });
  }

  /** AI clean-up for an import: suggestions per row (name, size, colour, brand, unit, category), never applied by itself. */
  async aiCleanImport(actor: RequestActor, workspaceId: string, catalogId: string, input: { rows: ImportRow[] }) {
    if (!input.rows?.length) throw new UnprocessableEntityException("The file has no rows to tidy");
    if (input.rows.length > 1000) throw new UnprocessableEntityException("Tidy at most 1,000 rows at a time");
    const context = await this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      await this.catalog(client, workspaceId, catalogId);
      const categories = await client.query<{ name: string }>(`SELECT name FROM catalog_categories WHERE workspace_id = $1 AND catalog_id = $2 AND status = 'active'`, [workspaceId, catalogId]);
      return { categories: [...new Set([...categories.rows.map((row) => row.name), ...input.rows.map((row) => row.category ?? "").filter(Boolean)])], units: (await this.units(client, workspaceId)).map((unit) => unit.code) };
    });
    const units = [...new Set([...context.units, ...Object.keys(PACK_UNITS)])];
    const suggestions: CleanSuggestion[] = [];
    for (let start = 0; start < input.rows.length; start += 50) {
      const batch = input.rows.slice(start, start + 50);
      suggestions.push(...await this.ai.run(actor, workspaceId, {
        feature: "catalog.import_clean", system: CLEAN_SYSTEM, prompt: cleanPrompt(batch, context.categories, units), maxTokens: 6000,
        validate: (value) => validateClean(value, batch, context.categories),
      }));
    }
    return { suggestions };
  }

  /** AI: suggest components (with formulas) for an assembly from this catalog's own items. */
  async aiSuggestComponents(actor: RequestActor, workspaceId: string, catalogId: string, itemId: string) {
    const context = await this.access.withPermission(actor, workspaceId, VIEW, async (client) => {
      const item = await this.itemDetail(client, workspaceId, catalogId, itemId, false);
      if (!["assembly", "package"].includes(item.itemType)) throw new UnprocessableEntityException("Only assemblies and packages have components");
      const candidates = await client.query<{ id: string; name: string; code: string; unitCode: string; itemType: string }>(
        `SELECT id, name, code, unit_code AS "unitCode", item_type AS "itemType" FROM catalog_items
         WHERE workspace_id = $1 AND catalog_id = $2 AND status = 'active' AND id <> $3 AND item_type IN ('material', 'product', 'ready_made', 'service')
         ORDER BY name LIMIT 400`, [workspaceId, catalogId, itemId]);
      return { item, candidates: candidates.rows, units: (await this.units(client, workspaceId)).map((unit) => unit.code) };
    });
    if (!context.candidates.length) throw new UnprocessableEntityException("Add materials or products to this catalog first");
    const suggestions = await this.ai.run(actor, workspaceId, {
      feature: "catalog.suggest_components", system: COMPONENTS_SYSTEM, prompt: componentsPrompt(context.item, context.candidates), maxTokens: 3000,
      validate: (value) => validateComponents(value, context.candidates, (formula) => formulaInputs(parseFormula(formula)), context.units),
    });
    return { suggestions };
  }

  /** Spreadsheet import: preview explains every row; commit applies the same plan in one transaction. */
  importItems(actor: RequestActor, workspaceId: string, catalogId: string, input: { mode: "preview" | "commit"; rows: ImportRow[] }) {
    const permission = input.mode === "commit" ? MANAGE : VIEW;
    return this.access.withPermission(actor, workspaceId, permission, async (client, user) => {
      await this.catalog(client, workspaceId, catalogId);
      if (!input.rows?.length) throw new UnprocessableEntityException("The file has no rows to import");
      if (input.rows.length > 5000) throw new UnprocessableEntityException("Import at most 5,000 rows at a time");
      const codes = await client.query<{ code: string }>(`SELECT code FROM catalog_items WHERE workspace_id = $1 AND catalog_id = $2`, [workspaceId, catalogId]);
      const units = await client.query<{ code: string }>(`SELECT code FROM catalog_units WHERE workspace_id = $1`, [workspaceId]);
      const vendors = await client.query<{ id: string; name: string }>(`SELECT id, display_name AS name FROM workspace_vendors WHERE workspace_id = $1 AND status = 'active'`, [workspaceId]);
      const currency = await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId]);
      const plan = planCatalogImport(input.rows, {
        existingCodes: new Set(codes.rows.map((row) => row.code)), units: new Set(units.rows.map((row) => row.code)),
        vendors: new Map(vendors.rows.map((row) => [row.name.trim().toLowerCase(), row.id])), defaultCurrency: currency.rows[0]?.currency ?? "USD",
      });
      if (input.mode === "preview") return plan;

      for (const unit of plan.summary.newUnits) {
        if (!PACK_UNITS[unit]) throw new UnprocessableEntityException(`Unknown unit ${unit}`);
        await client.query(`INSERT INTO catalog_units (workspace_id, code, label, kind, to_base) VALUES ($1, $2, $3, 'count', 1) ON CONFLICT DO NOTHING`, [workspaceId, unit, PACK_UNITS[unit]]);
      }
      const categoryIds = new Map<string, string>();
      for (const name of plan.summary.newCategories) {
        const found = await client.query<{ id: string }>(`SELECT id FROM catalog_categories WHERE workspace_id = $1 AND catalog_id = $2 AND parent_id IS NULL AND lower(name) = lower($3) AND status = 'active'`, [workspaceId, catalogId, name]);
        categoryIds.set(name, found.rows[0]?.id ?? (await client.query<{ id: string }>(
          `INSERT INTO catalog_categories (workspace_id, catalog_id, code, name, sort_order) VALUES ($1, $2, $3, $4, (SELECT coalesce(max(sort_order), 0) + 1 FROM catalog_categories WHERE catalog_id = $2))
           ON CONFLICT (catalog_id, code) DO UPDATE SET status = 'active' RETURNING id`, [workspaceId, catalogId, slug(name).replace(/_/g, "-") || "category", name])).rows[0].id);
      }
      const attributeIds = new Map<string, string>();
      for (const label of plan.summary.newAttributes) {
        const code = slug(label) || "attribute";
        const found = await client.query<{ id: string }>(`SELECT id FROM catalog_attributes WHERE workspace_id = $1 AND catalog_id = $2 AND category_id IS NULL AND code = $3`, [workspaceId, catalogId, /^[a-z]/.test(code) ? code : `a_${code}`]);
        attributeIds.set(label, found.rows[0]?.id ?? (await client.query<{ id: string }>(
          `INSERT INTO catalog_attributes (workspace_id, catalog_id, code, label, value_type) VALUES ($1, $2, $3, $4, 'text') RETURNING id`,
          [workspaceId, catalogId, /^[a-z]/.test(code) ? code : `a_${code}`, label])).rows[0].id);
      }
      const vendorIds = new Map(vendors.rows.map((row) => [row.name.trim().toLowerCase(), row.id]));
      for (const row of plan.rows) {
        if (row.action !== "create" && row.action !== "update") continue;
        const categoryId = row.category ? categoryIds.get(row.category) ?? null : null;
        const item = await client.query<{ id: string }>(
          `INSERT INTO catalog_items (workspace_id, catalog_id, category_id, code, name, item_type, unit_code, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
           ON CONFLICT (catalog_id, code) DO UPDATE SET category_id = EXCLUDED.category_id, name = EXCLUDED.name, item_type = EXCLUDED.item_type,
             unit_code = EXCLUDED.unit_code, status = CASE WHEN catalog_items.status = 'archived' THEN 'active' ELSE catalog_items.status END,
             updated_by = EXCLUDED.updated_by, version = catalog_items.version + 1, updated_at = now()
           RETURNING id`, [workspaceId, catalogId, categoryId, row.code, row.name, row.itemType, row.unit, user.userId]);
        const itemId = item.rows[0].id;
        for (const [label, value] of Object.entries(row.attributes)) {
          await client.query(`INSERT INTO catalog_item_values (workspace_id, item_id, attribute_id, value) VALUES ($1, $2, $3, $4)
            ON CONFLICT (item_id, attribute_id) DO UPDATE SET value = EXCLUDED.value`, [workspaceId, itemId, attributeIds.get(label), value]);
        }
        if (row.supplier) {
          const vendorId = vendorIds.get(row.supplier.toLowerCase())!;
          const link = await client.query<{ id: string }>(`SELECT id FROM catalog_supplier_links WHERE workspace_id = $1 AND item_id = $2 AND vendor_id = $3 AND variant_id IS NULL`, [workspaceId, itemId, vendorId]);
          if (link.rowCount) await client.query(`UPDATE catalog_supplier_links SET cost = coalesce($2::numeric, cost), currency = coalesce($3, currency), updated_at = now() WHERE id = $1`, [link.rows[0].id, row.cost, row.currency]);
          else await client.query(`INSERT INTO catalog_supplier_links (workspace_id, item_id, vendor_id, cost, currency) VALUES ($1, $2, $3, $4::numeric, $5)`, [workspaceId, itemId, vendorId, row.cost, row.currency]);
        }
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "catalog.imported", entityType: "catalog", entityId: catalogId, after: plan.summary });
      return plan;
    });
  }

  // ---------- helpers ----------
  private async itemDetail(client: PoolClient, workspaceId: string, catalogId: string, itemId: string, canViewCosts: boolean) {
    const item = await client.query<{ id: string; code: string; name: string; itemType: string; unitCode: string; categoryId: string | null; description: string | null; wastePercent: string | null; purchaseRoundTo: string | null; status: string; version: number }>(
      `SELECT id, code, name, item_type AS "itemType", unit_code AS "unitCode", category_id AS "categoryId", description,
              waste_percent::text AS "wastePercent", purchase_round_to::text AS "purchaseRoundTo", status, version
       FROM catalog_items WHERE workspace_id = $1 AND catalog_id = $2 AND id = $3`, [workspaceId, catalogId, itemId]);
    if (!item.rowCount) throw new NotFoundException("Item not found");
    const row = item.rows[0];
    const values = await client.query<{ code: string; value: string }>(
      `SELECT attribute.code, value.value FROM catalog_item_values value JOIN catalog_attributes attribute ON attribute.id = value.attribute_id WHERE value.workspace_id = $1 AND value.item_id = $2`, [workspaceId, itemId]);
    const components = await client.query<{ componentItemId: string; name: string; quantityFormula: string; unitCode: string; wastePercent: string | null; purchaseRoundTo: string | null }>(
      `SELECT component.component_item_id AS "componentItemId", child.name, component.quantity_formula AS "quantityFormula", component.unit_code AS "unitCode",
              child.waste_percent::text AS "wastePercent", child.purchase_round_to::text AS "purchaseRoundTo"
       FROM catalog_components component JOIN catalog_items child ON child.id = component.component_item_id
       WHERE component.workspace_id = $1 AND component.parent_item_id = $2 ORDER BY component.sort_order`, [workspaceId, itemId]);
    const conversions = await client.query<{ from: string; to: string; factor: string }>(
      `SELECT from_unit AS "from", to_unit AS "to", factor::text AS factor FROM catalog_item_conversions WHERE workspace_id = $1 AND item_id = $2`, [workspaceId, itemId]);
    const prices = await client.query<Record<string, string | null> & { id: string; priceBookId: string; variantId: string | null; method: string; status: string; version: number }>(
      `SELECT entry.id, entry.price_book_id AS "priceBookId", entry.variant_id AS "variantId", entry.method, entry.status, entry.version,
              entry.price::text AS price, entry.cost::text AS cost, entry.markup_percent::text AS "markupPercent", entry.rate::text AS rate,
              entry.minimum_charge::text AS "minimumCharge", entry.labour::text AS labour, entry.margin_percent::text AS "marginPercent", book.currency
       FROM price_entries entry JOIN price_books book ON book.id = entry.price_book_id
       WHERE entry.workspace_id = $1 AND entry.item_id = $2 AND entry.status <> 'expired'`, [workspaceId, itemId]);
    const suppliers = canViewCosts ? (await client.query(
      `SELECT link.id, link.vendor_id AS "vendorId", vendor.display_name AS "vendorName", link.vendor_sku AS "vendorSku", link.cost::text AS cost, link.currency,
              link.pack_size::text AS "packSize", link.minimum_order::text AS "minimumOrder", link.lead_time_days AS "leadTimeDays", link.preferred
       FROM catalog_supplier_links link JOIN workspace_vendors vendor ON vendor.workspace_id = link.workspace_id AND vendor.id = link.vendor_id
       WHERE link.workspace_id = $1 AND link.item_id = $2 ORDER BY link.preferred DESC`, [workspaceId, itemId])).rows : [];
    return {
      ...row,
      values: Object.fromEntries(values.rows.map((value) => [value.code, value.value])),
      components: components.rows,
      conversions: conversions.rows,
      prices: prices.rows.map((entry) => canViewCosts ? entry : { ...entry, cost: null, markupPercent: null, labour: null, marginPercent: null }),
      suppliers,
      canViewCosts,
    };
  }

  private async toMethod(client: PoolClient, workspaceId: string, row: { id: string; method: string; [field: string]: unknown }, detail: Awaited<ReturnType<CatalogV2Service["itemDetail"]>>, bookId: string): Promise<PriceMethod> {
    const entry = row as { id: string; method: string } & Record<"price" | "cost" | "markupPercent" | "rate" | "minimumCharge" | "labour" | "marginPercent", string | null>;
    switch (entry.method) {
      case "fixed": return { method: "fixed", price: entry.price! };
      case "cost_plus": return { method: "cost_plus", cost: entry.cost!, markupPercent: entry.markupPercent! };
      case "per_measure": return { method: "per_measure", rate: entry.rate!, minimumCharge: entry.minimumCharge ?? undefined };
      case "tiered": {
        const tiers = await client.query<{ fromQuantity: string; price: string }>(`SELECT from_quantity::text AS "fromQuantity", price::text AS price FROM price_entry_tiers WHERE workspace_id = $1 AND price_entry_id = $2`, [workspaceId, entry.id]);
        return { method: "tiered", tiers: tiers.rows };
      }
      case "attribute_surcharge": {
        const rows = await client.query<{ attribute: string; value: string; percent: string | null; amount: string | null; label: string | null }>(
          `SELECT attribute.code AS attribute, surcharge.value, surcharge.percent::text AS percent, surcharge.amount::text AS amount, surcharge.label
           FROM price_entry_surcharges surcharge JOIN catalog_attributes attribute ON attribute.id = surcharge.attribute_id WHERE surcharge.workspace_id = $1 AND surcharge.price_entry_id = $2`, [workspaceId, entry.id]);
        return { method: "attribute_surcharge", base: entry.price!, surcharges: rows.rows.map((row) => ({ ...row, percent: row.percent ?? undefined, amount: row.amount ?? undefined, label: row.label ?? undefined })) };
      }
      default: {
        // Components priced from the same book (active or reviewed), per one assembly.
        const componentPrices = await client.query<{ itemId: string; price: string | null }>(
          `SELECT item_id AS "itemId", coalesce(price, rate)::text AS price FROM price_entries
           WHERE workspace_id = $1 AND price_book_id = $2 AND item_id = ANY($3::uuid[]) AND variant_id IS NULL AND status IN ('active', 'reviewed') AND method IN ('fixed', 'per_measure')`,
          [workspaceId, bookId, detail.components.map((component) => component.componentItemId)]);
        const perUnit = new Map(componentPrices.rows.map((row) => [row.itemId, row.price]));
        return {
          method: "assembly_rollup", labour: entry.labour ?? undefined, marginPercent: entry.marginPercent ?? undefined,
          components: detail.components.map((component) => ({ label: component.name, quantity: "1", unitPrice: perUnit.get(component.componentItemId) ?? null })),
        };
      }
    }
  }

  private async cleanItem(client: PoolClient, workspaceId: string, catalogId: string, input: ItemInput) {
    const code = input.code?.trim(), name = input.name?.trim();
    if (!code) throw new UnprocessableEntityException("Enter a code");
    if (!name) throw new UnprocessableEntityException("Enter a name");
    if (!ITEM_TYPES.includes(input.itemType)) throw new UnprocessableEntityException("Choose what kind of item this is");
    await this.unit(client, workspaceId, input.unitCode);
    if (input.categoryId) await this.category(client, workspaceId, catalogId, input.categoryId);
    const definitions = await this.attributes(client, workspaceId, catalogId, input.categoryId ?? null, false);
    let values: Array<{ attributeId: string; value: string }>;
    try { values = normalizeAttributeValues(definitions, input.values ?? {}); }
    catch (error) { if (error instanceof AttributeValueError) throw new UnprocessableEntityException(error.message); throw error; }
    return {
      code, name, itemType: input.itemType, unitCode: input.unitCode, categoryId: input.categoryId ?? null, description: input.description?.trim() || null,
      wastePercent: input.wastePercent ? this.decimal(input.wastePercent, "Waste") : null,
      purchaseRoundTo: input.purchaseRoundTo ? this.decimal(input.purchaseRoundTo, "Buy in multiples of") : null,
      values,
    };
  }

  private async writeValues(client: PoolClient, workspaceId: string, itemId: string, values: Array<{ attributeId: string; value: string }>) {
    for (const value of values) {
      await client.query(`INSERT INTO catalog_item_values (workspace_id, item_id, attribute_id, value) VALUES ($1, $2, $3, $4)`, [workspaceId, itemId, value.attributeId, value.value]);
    }
  }

  /** Attributes that apply to a category: catalog-wide ones plus those on the category and its ancestors. */
  private async attributes(client: PoolClient, workspaceId: string, catalogId: string, categoryId: string | null, all: boolean): Promise<Array<AttributeDefinition & { categoryId: string | null }>> {
    const rows = await client.query<AttributeDefinition & { categoryId: string | null }>(
      `WITH RECURSIVE ancestors AS (SELECT id, parent_id FROM catalog_categories WHERE id = $3
         UNION ALL SELECT parent.id, parent.parent_id FROM catalog_categories parent JOIN ancestors ON ancestors.parent_id = parent.id)
       SELECT id, code, label, value_type AS "valueType", required, choices, unit_code AS "unitCode", category_id AS "categoryId"
       FROM catalog_attributes WHERE workspace_id = $1 AND catalog_id = $2 AND status = 'active'
         AND ($4 OR category_id IS NULL OR category_id IN (SELECT id FROM ancestors)) ORDER BY sort_order, label`,
      [workspaceId, catalogId, categoryId, all]);
    return rows.rows;
  }

  private async units(client: PoolClient, workspaceId: string): Promise<Unit[]> {
    const custom = await client.query<Unit>(`SELECT code, label, kind, to_base::text AS "toBase" FROM catalog_units WHERE workspace_id = $1`, [workspaceId]);
    return [...STANDARD_UNITS, ...custom.rows.filter((unit) => !STANDARD_UNITS.some((standard) => standard.code === unit.code))];
  }

  private async unit(client: PoolClient, workspaceId: string, code: string) {
    if (!(await this.units(client, workspaceId)).some((unit) => unit.code === code)) throw new UnprocessableEntityException(`Unknown unit ${code}`);
  }

  private async catalog(client: PoolClient, workspaceId: string, catalogId: string) {
    const found = await client.query(`SELECT 1 FROM catalogs WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, catalogId]);
    if (!found.rowCount) throw new NotFoundException("Catalog not found");
  }

  private async category(client: PoolClient, workspaceId: string, catalogId: string, categoryId: string) {
    const found = await client.query(`SELECT 1 FROM catalog_categories WHERE workspace_id = $1 AND catalog_id = $2 AND id = $3 AND status = 'active'`, [workspaceId, catalogId, categoryId]);
    if (!found.rowCount) throw new NotFoundException("Category not found");
  }

  private async lockItem(client: PoolClient, workspaceId: string, catalogId: string, itemId: string) {
    const found = await client.query<{ version: number; itemType: string; status: string }>(
      `SELECT version, item_type AS "itemType", status FROM catalog_items WHERE workspace_id = $1 AND catalog_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, catalogId, itemId]);
    if (!found.rowCount || found.rows[0].status === "archived") throw new NotFoundException("Item not found");
    return found.rows[0];
  }

  private async resolveSurcharges(client: PoolClient, workspaceId: string, catalogId: string, surcharges: NonNullable<PriceEntryInput["surcharges"]>) {
    const result = [];
    for (const surcharge of surcharges) {
      const attribute = await client.query<{ id: string }>(`SELECT id FROM catalog_attributes WHERE workspace_id = $1 AND catalog_id = $2 AND code = $3 LIMIT 1`, [workspaceId, catalogId, surcharge.attributeCode]);
      if (!attribute.rowCount) throw new UnprocessableEntityException(`Unknown attribute ${surcharge.attributeCode}`);
      if (!surcharge.percent === !surcharge.amount) throw new UnprocessableEntityException("A surcharge is either a percentage or an amount");
      result.push({ attributeId: attribute.rows[0].id, value: surcharge.value, percent: surcharge.percent ? this.decimal(surcharge.percent, "Surcharge") : null, amount: surcharge.amount ? this.decimal(surcharge.amount, "Surcharge") : null, label: surcharge.label ?? null });
    }
    return result;
  }

  private priceNumbers(input: PriceEntryInput) {
    const pick = (value: string | null | undefined, label: string) => (value === undefined || value === null || value === "" ? null : this.decimal(value, label));
    return {
      price: pick(input.price, "Price"), cost: pick(input.cost, "Cost"), markupPercent: pick(input.markupPercent, "Markup"), rate: pick(input.rate, "Rate"),
      minimumCharge: pick(input.minimumCharge, "Minimum charge"), labour: pick(input.labour, "Labour"), marginPercent: pick(input.marginPercent, "Margin"),
    };
  }

  private decimal(value: string, label: string) {
    try { const parsed = Dec.of(String(value)); if (parsed.isNegative()) throw new Error(); return parsed.toString(); }
    catch { throw new UnprocessableEntityException(`${label} must be a positive number`); }
  }

  private async canViewCosts(actor: RequestActor, workspaceId: string) {
    try { await this.access.withAnyPermission(actor, workspaceId, COST_PERMISSIONS, async () => true); return true; }
    catch { return false; }
  }

  private async unique<T>(work: () => Promise<T>, message: string) {
    try { return await work(); }
    catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ConflictException(message);
      if ((error as { code?: string }).code === "22P02") throw new BadRequestException("Invalid identifier");
      throw error;
    }
  }
}

/** ISO 4217 minor units for currencies that are not 2 decimals. */
export function currencyDecimals(currency: string) {
  if (["KWD", "BHD", "OMR", "JOD", "TND", "LYD", "IQD"].includes(currency)) return 3;
  if (["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF"].includes(currency)) return 0;
  return 2;
}
