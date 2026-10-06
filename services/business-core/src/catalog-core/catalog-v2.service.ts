import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { likePattern, searchTerms } from "../search/search-terms";
import { AiGatewayService } from "../ai-gateway/ai-gateway.service";
import { CLEAN_SYSTEM, COMPONENTS_SYSTEM, cleanPrompt, componentsPrompt, validateClean, validateComponents, type CleanSuggestion } from "./catalog-ai";
import { PACK_UNITS, planCatalogImport, type ImportRow } from "./catalog-import";
import { categoryKey, categoryTitle } from "./category-names";
import { AttributeValueError, normalizeAttributeValues, type AttributeDefinition, type AttributeType } from "./attributes";
import { assertNoCycle, BomError, checkFormulas, explode, type BomComponent } from "./bom";
import { Dec } from "./decimal";
import { formulaInputs, FormulaError, parseFormula } from "./formula";
import { price, type PriceMethod } from "./pricing";
import { convert, STANDARD_UNITS, UnitError, type Unit } from "./units";

const VIEW = "catalog.view";
const MANAGE = "catalog.manage";
const COST_PERMISSIONS = ["commercial.costs.view", "supplier_offers.view"];
/**
 * Approving a list price outright (a supplier's or the firm's official price list) skips the QS review, so it takes
 * both halves of that path: reviewing prices (QS) and making them live (catalog).
 */
export const APPROVE_PRICE_PERMISSIONS = ["commercial.estimate", MANAGE] as const;
/** Where an approved price came from, for the audit (e.g. a linked import's link and run). */
export type PriceApproval = { source: Record<string, unknown> };
const ITEM_TYPES = ["product", "material", "assembly", "service", "package", "ready_made"] as const;
const slug = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

type Actor = { userId: string };
/** A category's new name and/or parent (null: top level); a field left out stays as it is. */
export type CategoryChange = { version: number; name?: string; parentId?: string | null };
export type ItemInput = {
  version?: number; code: string; name: string; itemType: (typeof ITEM_TYPES)[number]; unitCode: string; categoryId?: string | null;
  description?: string | null; wastePercent?: string | null; purchaseRoundTo?: string | null; values?: Record<string, unknown>;
  /** Working days to make one (a product's production time); left out keeps what the item has. */
  productionDays?: number | null;
  /** A link to the item's technical drawing (PLM-057: a standard item with one needs no project drawing); left out keeps what the item has. */
  technicalDrawingUrl?: string | null;
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
      // Each category's item count is what opening it lists: its items and those of every category below it.
      const categories = await client.query(
        `WITH RECURSIVE tree AS (
           SELECT id AS root, id FROM catalog_categories WHERE workspace_id = $1 AND catalog_id = $2 AND status = 'active'
           UNION ALL SELECT tree.root, child.id FROM catalog_categories child JOIN tree ON child.parent_id = tree.id WHERE child.workspace_id = $1),
         counts AS (SELECT tree.root, count(item.id)::int AS total FROM tree
           LEFT JOIN catalog_items item ON item.workspace_id = $1 AND item.category_id = tree.id AND item.status <> 'archived' GROUP BY tree.root)
         SELECT category.id, category.parent_id AS "parentId", category.code, category.name, category.sort_order AS "sortOrder", category.version,
                coalesce(counts.total, 0) AS "itemCount"
         FROM catalog_categories category LEFT JOIN counts ON counts.root = category.id
         WHERE category.workspace_id = $1 AND category.catalog_id = $2 AND category.status = 'active' ORDER BY category.sort_order, category.name`, [workspaceId, catalogId]);
      const attributes = await this.attributes(client, workspaceId, catalogId, null, true);
      return { categories: categories.rows, attributes, units: await this.units(client, workspaceId) };
    });
  }

  createCategory(actor: RequestActor, workspaceId: string, catalogId: string, input: { name: string; parentId?: string | null }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => this.insertCategory(client, workspaceId, catalogId, input, user.userId));
  }

  /** The create-category command inside a caller's transaction (a linked sheet adds the categories it names). */
  async insertCategory(client: PoolClient, workspaceId: string, catalogId: string, input: { name: string; parentId?: string | null }, userId: string) {
    await this.catalog(client, workspaceId, catalogId);
    if (!input.name?.trim()) throw new UnprocessableEntityException("Give the category a name");
    if (input.parentId) await this.category(client, workspaceId, catalogId, input.parentId);
    await this.uniqueSibling(client, workspaceId, catalogId, null, input.parentId ?? null, input.name.trim());
    const created = await this.unique(() => client.query<{ id: string }>(
      `INSERT INTO catalog_categories (workspace_id, catalog_id, parent_id, code, name,
         sort_order) VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(sort_order), 0) + 1 FROM catalog_categories WHERE catalog_id = $2)) RETURNING id`,
      [workspaceId, catalogId, input.parentId ?? null, slug(input.name).replace(/_/g, "-") || "category", input.name.trim()]), "A category with this name already exists");
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "catalog.category_created", entityType: "catalog", entityId: catalogId, after: input });
    return { id: created.rows[0].id };
  }

  /** Renames a category or moves it under another (null: to the top); version-checked, never into itself or below itself. */
  updateCategory(actor: RequestActor, workspaceId: string, catalogId: string, categoryId: string, input: CategoryChange) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => this.reviseCategory(client, workspaceId, catalogId, categoryId, input, user.userId));
  }

  async reviseCategory(client: PoolClient, workspaceId: string, catalogId: string, categoryId: string, input: CategoryChange, userId: string) {
    await this.catalog(client, workspaceId, catalogId);
    const before = await this.lockCategory(client, workspaceId, catalogId, categoryId);
    const name = input.name === undefined ? before.name : input.name.replace(/\s+/g, " ").trim();
    if (!name) throw new UnprocessableEntityException("Give the category a name");
    if (name.length > 160) throw new UnprocessableEntityException("The category name is longer than 160 characters");
    const parentId = input.parentId === undefined ? before.parentId : input.parentId;
    // The same change again (a retried request) is done already, whatever the version now.
    if (name === before.name && parentId === before.parentId) return { id: categoryId, version: before.version };
    if (input.version !== before.version) throw new ConflictException("This category changed; reload and try again");
    if (parentId) {
      if (parentId === categoryId) throw new UnprocessableEntityException("A category can't sit under itself");
      await this.category(client, workspaceId, catalogId, parentId);
      if ((await this.descendants(client, workspaceId, categoryId)).includes(parentId)) throw new UnprocessableEntityException("A category can't sit under one of its own sub-categories");
    }
    await this.uniqueSibling(client, workspaceId, catalogId, categoryId, parentId, name);
    const updated = await client.query<{ version: number }>(
      `UPDATE catalog_categories SET name = $3, parent_id = $4, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2 RETURNING version`,
      [workspaceId, categoryId, name, parentId]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "catalog.category_changed", entityType: "catalog_category", entityId: categoryId,
      before: { name: before.name, parentId: before.parentId }, after: { catalogId, name, parentId } });
    return { id: categoryId, version: updated.rows[0].version };
  }

  /**
   * Merges a category into another: its items, sub-categories and attributes move there and it is removed. Version-checked
   * on the category merged away; a retried merge that already happened answers as done.
   */
  mergeCategory(actor: RequestActor, workspaceId: string, catalogId: string, categoryId: string, input: { version: number; intoId: string }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => this.mergeCategoryInto(client, workspaceId, catalogId, categoryId, input, user.userId));
  }

  async mergeCategoryInto(client: PoolClient, workspaceId: string, catalogId: string, categoryId: string, input: { version: number; intoId: string }, userId: string) {
    await this.catalog(client, workspaceId, catalogId);
    if (input.intoId === categoryId) throw new UnprocessableEntityException("Choose another category to merge into");
    const done = await this.priorCategoryCommand(client, workspaceId, categoryId, "catalog.category_merged");
    if (done && (done.after as { intoId?: string } | null)?.intoId === input.intoId) return { id: input.intoId, ...(done.after as { items: number; subcategories: number }), merged: true };
    // Both locked in one order, so two merges at once can't deadlock.
    const [first, second] = [categoryId, input.intoId].sort();
    const locked = new Map([[first, await this.lockCategory(client, workspaceId, catalogId, first)], [second, await this.lockCategory(client, workspaceId, catalogId, second)]]);
    const source = locked.get(categoryId)!;
    if (input.version !== source.version) throw new ConflictException("This category changed; reload and try again");
    if ((await this.descendants(client, workspaceId, categoryId)).includes(input.intoId)) throw new UnprocessableEntityException("Merge into a category outside this one");

    // Attributes: one the target also has (same code) has its values moved over; any other moves with the category.
    const attributes = await client.query<{ id: string; code: string; valueType: string; targetId: string | null; targetType: string | null }>(
      `SELECT attribute.id, attribute.code, attribute.value_type AS "valueType", target.id AS "targetId", target.value_type AS "targetType"
         FROM catalog_attributes attribute
         LEFT JOIN catalog_attributes target ON target.workspace_id = attribute.workspace_id AND target.catalog_id = attribute.catalog_id
          AND target.category_id = $3 AND target.code = attribute.code
        WHERE attribute.workspace_id = $1 AND attribute.category_id = $2`, [workspaceId, categoryId, input.intoId]);
    const clash = attributes.rows.find((attribute) => attribute.targetId && attribute.targetType !== attribute.valueType);
    if (clash) throw new ConflictException(`Both categories have the attribute ${clash.code} with different kinds of value. Rename one first.`);
    for (const attribute of attributes.rows) {
      if (!attribute.targetId) {
        await client.query(`UPDATE catalog_attributes SET category_id = $3, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, attribute.id, input.intoId]);
        continue;
      }
      await client.query(`UPDATE catalog_item_values value SET attribute_id = $3 WHERE value.workspace_id = $1 AND value.attribute_id = $2
        AND NOT EXISTS (SELECT 1 FROM catalog_item_values other WHERE other.item_id = value.item_id AND other.attribute_id = $3)`, [workspaceId, attribute.id, attribute.targetId]);
      await client.query(`UPDATE catalog_variant_values value SET attribute_id = $3 WHERE value.workspace_id = $1 AND value.attribute_id = $2
        AND NOT EXISTS (SELECT 1 FROM catalog_variant_values other WHERE other.variant_id = value.variant_id AND other.attribute_id = $3)`, [workspaceId, attribute.id, attribute.targetId]);
      await client.query(`UPDATE price_entry_surcharges SET attribute_id = $3 WHERE workspace_id = $1 AND attribute_id = $2`, [workspaceId, attribute.id, attribute.targetId]);
      await client.query(`DELETE FROM catalog_attributes WHERE workspace_id = $1 AND id = $2`, [workspaceId, attribute.id]);
    }
    const items = await client.query(`UPDATE catalog_items SET category_id = $3, version = version + 1, updated_by = $4, updated_at = now()
      WHERE workspace_id = $1 AND category_id = $2`, [workspaceId, categoryId, input.intoId, userId]);
    const subcategories = await client.query(`UPDATE catalog_categories SET parent_id = $3, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND parent_id = $2`, [workspaceId, categoryId, input.intoId]);
    await client.query(`DELETE FROM catalog_categories WHERE workspace_id = $1 AND id = $2`, [workspaceId, categoryId]);
    await client.query(`UPDATE catalog_categories SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.intoId]);
    const moved = { items: items.rowCount ?? 0, subcategories: subcategories.rowCount ?? 0 };
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "catalog.category_merged", entityType: "catalog_category", entityId: categoryId,
      before: { name: source.name, parentId: source.parentId }, after: { catalogId, intoId: input.intoId, intoName: locked.get(input.intoId)!.name, ...moved } });
    return { id: input.intoId, ...moved, merged: true };
  }

  /** Deletes a category with no items and no sub-categories; version-checked; a retried delete answers as done. */
  deleteCategory(actor: RequestActor, workspaceId: string, catalogId: string, categoryId: string, version: number) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => this.removeCategory(client, workspaceId, catalogId, categoryId, version, user.userId));
  }

  async removeCategory(client: PoolClient, workspaceId: string, catalogId: string, categoryId: string, version: number, userId: string) {
    await this.catalog(client, workspaceId, catalogId);
    if (await this.priorCategoryCommand(client, workspaceId, categoryId, "catalog.category_deleted")) return { id: categoryId, deleted: true };
    const before = await this.lockCategory(client, workspaceId, catalogId, categoryId);
    if (version !== before.version) throw new ConflictException("This category changed; reload and try again");
    const children = await client.query(`SELECT 1 FROM catalog_categories WHERE workspace_id = $1 AND parent_id = $2 LIMIT 1`, [workspaceId, categoryId]);
    if (children.rowCount) throw new ConflictException("Move or delete its sub-categories first");
    const items = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM catalog_items WHERE workspace_id = $1 AND category_id = $2 AND status <> 'archived'`, [workspaceId, categoryId]);
    if (items.rows[0].count) throw new ConflictException(`${items.rows[0].count} items are in this category. Move them or merge the category instead.`);
    await client.query(`DELETE FROM catalog_categories WHERE workspace_id = $1 AND id = $2`, [workspaceId, categoryId]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "catalog.category_deleted", entityType: "catalog_category", entityId: categoryId,
      before: { catalogId, name: before.name, parentId: before.parentId } });
    return { id: categoryId, deleted: true };
  }

  createAttribute(actor: RequestActor, workspaceId: string, catalogId: string, input: { label: string; code?: string; categoryId?: string | null; valueType: AttributeType; unitCode?: string | null; required?: boolean; choices?: string[] }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => this.insertAttribute(client, workspaceId, catalogId, input, user.userId));
  }

  /** The create-attribute command inside a caller's transaction (a linked sheet's extra columns). */
  async insertAttribute(client: PoolClient, workspaceId: string, catalogId: string, input: { label: string; code?: string; categoryId?: string | null; valueType: AttributeType; unitCode?: string | null; required?: boolean; choices?: string[] }, userId: string) {
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
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "catalog.attribute_created", entityType: "catalog", entityId: catalogId, after: { ...input, code } });
    return { id: created.rows[0].id };
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

  /**
   * Items in every active catalog whose name, code, description, category or attribute values hold every word
   * searched (Woddy's product questions). Each with its size, drawing link and attributes, and its selling price
   * only when a price is live (otherwise whether one waits in draft or review). Cost only for cost viewers.
   */
  findItems(actor: RequestActor, workspaceId: string, query: { search: string; limit?: number }) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      const terms = searchTerms(query.search);
      if (!terms.length) throw new UnprocessableEntityException("Say what to look for");
      const canViewCosts = (await Promise.all(COST_PERMISSIONS.map((code) => this.access.hasPermission(client, workspaceId, user.userId, code)))).some(Boolean);
      const values: unknown[] = [workspaceId, likePattern(query.search.trim())];
      const where = terms.map((term) => {
        values.push(term);
        const at = `$${values.length}`;
        return `(item.name ILIKE ${at} OR item.code ILIKE ${at} OR coalesce(item.description, '') ILIKE ${at} OR coalesce(category.name, '') ILIKE ${at}
          OR EXISTS (SELECT 1 FROM catalog_item_values value WHERE value.workspace_id = item.workspace_id AND value.item_id = item.id AND value.value ILIKE ${at}))`;
      });
      values.push(Math.min(Math.max(query.limit ?? 8, 1), 20));
      const rows = (await client.query<FoundItem & { live: LivePrice | null; pending: "draft" | "reviewed" | "not_live" | null; supplierCost: { cost: string; currency: string | null; supplier: string } | null }>(
        `SELECT item.id, item.catalog_id AS "catalogId", catalog.name AS "catalogName", item.code, item.name, item.item_type AS "itemType", item.unit_code AS "unitCode",
                category.name AS "categoryName", item.description, item.technical_drawing_url AS "technicalDrawingUrl", item.production_days AS "productionDays",
                (SELECT jsonb_build_object('width', size.width::text, 'depth', size.depth::text, 'height', size.height::text, 'unit', size.unit)
                   FROM catalog_item_dimensions size WHERE size.workspace_id = item.workspace_id AND size.item_id = item.id) AS size,
                coalesce((SELECT jsonb_agg(jsonb_build_object('label', attribute.label, 'value', value.value) ORDER BY attribute.sort_order, attribute.label)
                   FROM catalog_item_values value JOIN catalog_attributes attribute ON attribute.workspace_id = value.workspace_id AND attribute.id = value.attribute_id
                  WHERE value.workspace_id = item.workspace_id AND value.item_id = item.id), '[]'::jsonb) AS attributes,
                (SELECT jsonb_build_object('id', entry.id, 'method', entry.method, 'price', entry.price::text, 'rate', entry.rate::text, 'minimumCharge', entry.minimum_charge::text,
                                           'cost', entry.cost::text, 'markupPercent', entry.markup_percent::text, 'currency', book.currency)
                   FROM price_entries entry JOIN price_books book ON book.workspace_id = entry.workspace_id AND book.id = entry.price_book_id
                  WHERE entry.workspace_id = item.workspace_id AND entry.item_id = item.id AND entry.variant_id IS NULL AND entry.status = 'active' AND book.status = 'active'
                  ORDER BY book.effective_from DESC LIMIT 1) AS live,
                -- Without a live price: the newest one waiting (a draft, a reviewed one, or an approved one whose price book isn't in use).
                (SELECT CASE WHEN entry.status = 'active' THEN 'not_live' ELSE entry.status END FROM price_entries entry
                  WHERE entry.workspace_id = item.workspace_id AND entry.item_id = item.id AND entry.status IN ('draft', 'reviewed', 'active') ORDER BY entry.updated_at DESC LIMIT 1) AS pending,
                (SELECT jsonb_build_object('cost', link.cost::text, 'currency', link.currency, 'supplier', vendor.display_name)
                   FROM catalog_supplier_links link JOIN workspace_vendors vendor ON vendor.workspace_id = link.workspace_id AND vendor.id = link.vendor_id
                  WHERE link.workspace_id = item.workspace_id AND link.item_id = item.id AND link.cost IS NOT NULL ORDER BY link.preferred DESC, link.created_at LIMIT 1) AS "supplierCost"
           FROM catalog_items item
           JOIN catalogs catalog ON catalog.workspace_id = item.workspace_id AND catalog.id = item.catalog_id AND catalog.status = 'active'
           LEFT JOIN catalog_categories category ON category.workspace_id = item.workspace_id AND category.id = item.category_id
          WHERE item.workspace_id = $1 AND item.status <> 'archived' AND ${where.join(" AND ")}
          ORDER BY (item.name ILIKE $2) DESC, item.name, item.code LIMIT $${values.length}`, values)).rows;
      const tiers = new Map<string, Array<{ fromQuantity: string; price: string }>>();
      const tiered = rows.filter((row) => row.live?.method === "tiered").map((row) => row.live!.id);
      if (tiered.length) {
        const found = await client.query<{ entryId: string; fromQuantity: string; price: string }>(
          `SELECT price_entry_id AS "entryId", from_quantity::text AS "fromQuantity", price::text AS price FROM price_entry_tiers
            WHERE workspace_id = $1 AND price_entry_id = ANY($2::uuid[]) ORDER BY from_quantity`, [workspaceId, tiered]);
        for (const tier of found.rows) tiers.set(tier.entryId, [...(tiers.get(tier.entryId) ?? []), { fromQuantity: tier.fromQuantity, price: tier.price }]);
      }
      return {
        canViewCosts,
        items: rows.map(({ live, pending, supplierCost, ...item }): FoundItem => ({
          ...item,
          price: live ? livePrice(live, item.unitCode, tiers.get(live.id) ?? []) : { status: pending ?? "none" },
          ...(canViewCosts ? { cost: live?.cost ? { amount: moneyText(live.cost, live.currency), currency: live.currency, supplier: null }
            : supplierCost ? { amount: moneyText(supplierCost.cost, supplierCost.currency), currency: supplierCost.currency, supplier: supplierCost.supplier } : null } : {}),
        })),
      };
    });
  }

  createItem(actor: RequestActor, workspaceId: string, catalogId: string, input: ItemInput) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const itemId = await this.insertItem(client, workspaceId, catalogId, input, user.userId);
      return this.itemDetail(client, workspaceId, catalogId, itemId, await this.canViewCosts(actor, workspaceId));
    });
  }

  /** The create-item command inside a caller's transaction (the product clipper saves through it). */
  async insertItem(client: PoolClient, workspaceId: string, catalogId: string, input: ItemInput, userId: string) {
    await this.catalog(client, workspaceId, catalogId);
    const clean = await this.cleanItem(client, workspaceId, catalogId, input);
    const created = await this.unique(() => client.query<{ id: string }>(
      `INSERT INTO catalog_items (workspace_id, catalog_id, category_id, code, name, item_type, unit_code, description, waste_percent, purchase_round_to, created_by, updated_by, production_days,
         technical_drawing_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::numeric, $11, $11, $12, $13) RETURNING id`,
      [workspaceId, catalogId, clean.categoryId, clean.code, clean.name, clean.itemType, clean.unitCode, clean.description, clean.wastePercent, clean.purchaseRoundTo, userId, clean.productionDays ?? null,
        clean.technicalDrawingUrl ?? null]),
      `Code ${clean.code} is already used in this catalog`);
    const itemId = created.rows[0].id;
    await this.writeValues(client, workspaceId, itemId, clean.values);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "catalog.item_created", entityType: "catalog_item", entityId: itemId, after: clean });
    return itemId;
  }

  updateItem(actor: RequestActor, workspaceId: string, catalogId: string, itemId: string, input: ItemInput) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      await this.reviseItem(client, workspaceId, catalogId, itemId, input, user.userId);
      return this.itemDetail(client, workspaceId, catalogId, itemId, await this.canViewCosts(actor, workspaceId));
    });
  }

  /** The update-item command inside a caller's transaction (version-checked; a linked sheet revises through it). */
  async reviseItem(client: PoolClient, workspaceId: string, catalogId: string, itemId: string, input: ItemInput, userId: string) {
    const before = await this.lockItem(client, workspaceId, catalogId, itemId);
    if (input.version !== before.version) throw new ConflictException("This item changed; reload and try again");
    const clean = await this.cleanItem(client, workspaceId, catalogId, input);
    await this.unique(() => client.query(
      `UPDATE catalog_items SET category_id = $3, code = $4, name = $5, item_type = $6, unit_code = $7, description = $8, waste_percent = $9::numeric,
         purchase_round_to = $10::numeric, updated_by = $11, version = version + 1, updated_at = now(),
         production_days = CASE WHEN $12::boolean THEN $13::integer ELSE production_days END,
         technical_drawing_url = CASE WHEN $14::boolean THEN $15::varchar ELSE technical_drawing_url END WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, itemId, clean.categoryId, clean.code, clean.name, clean.itemType, clean.unitCode, clean.description, clean.wastePercent, clean.purchaseRoundTo, userId,
        clean.productionDays !== undefined, clean.productionDays ?? null, clean.technicalDrawingUrl !== undefined, clean.technicalDrawingUrl ?? null]),
      `Code ${clean.code} is already used in this catalog`);
    await client.query(`DELETE FROM catalog_item_values WHERE workspace_id = $1 AND item_id = $2`, [workspaceId, itemId]);
    await this.writeValues(client, workspaceId, itemId, clean.values);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "catalog.item_updated", entityType: "catalog_item", entityId: itemId, before, after: clean });
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
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => this.insertPriceBook(client, workspaceId, catalogId, input, user.userId));
  }

  /** The create-price-book command inside a caller's transaction. */
  async insertPriceBook(client: PoolClient, workspaceId: string, catalogId: string, input: { name: string; currency: string; legalEntityId?: string | null; segment?: string | null; effectiveFrom?: string; effectiveTo?: string | null }, userId: string) {
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
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "catalog.price_book_created", entityType: "catalog", entityId: catalogId, after: input });
    return { id: created.rows[0].id };
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
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => this.draftPrice(client, workspaceId, bookId, itemId, input, user.userId));
  }

  /**
   * The save-price command inside a caller's transaction: the price goes back to draft until reviewed. With an
   * approval (an approved list price, by a member who may approve prices) it goes live at once instead; either way
   * the entry it replaces is kept as history.
   */
  async draftPrice(client: PoolClient, workspaceId: string, bookId: string, itemId: string, input: PriceEntryInput, userId: string, approval?: PriceApproval) {
    if (approval && !(await this.canApprovePrices(client, workspaceId, userId))) throw new ForbiddenException("Only someone who reviews and approves prices can approve a list price");
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
        `INSERT INTO price_entries (workspace_id, price_book_id, item_id, variant_id, method, price, cost, markup_percent, rate, minimum_charge, labour, margin_percent, created_by, updated_by,
                                    status, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12::numeric, $13, $13,
                 CASE WHEN $14::boolean THEN 'active' ELSE 'draft' END, CASE WHEN $14::boolean THEN $13::uuid END, CASE WHEN $14::boolean THEN now() END) RETURNING id`,
        [workspaceId, bookId, itemId, input.variantId ?? null, input.method, numbers.price, numbers.cost, numbers.markupPercent, numbers.rate, numbers.minimumCharge, numbers.labour, numbers.marginPercent, userId,
          Boolean(approval)]);
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
    if (approval) {
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "catalog.price_approved_list", entityType: "catalog_item", entityId: itemId,
        after: { bookId, entryId, ...input, source: approval.source } });
      return { id: entryId, status: "active" as const };
    }
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "catalog.price_drafted", entityType: "catalog_item", entityId: itemId, after: { bookId, ...input } });
    return { id: entryId, status: "draft" as const };
  }

  /** Whether a member may approve a list price outright (both the QS review and making prices live). */
  async canApprovePrices(client: PoolClient, workspaceId: string, userId: string) {
    for (const code of APPROVE_PRICE_PERMISSIONS) if (!(await this.access.hasPermission(client, workspaceId, userId, code))) return false;
    return true;
  }

  /**
   * A draft (or reviewed) price approved as it is, as a list price: it goes live without a new entry. A price that's
   * already live is left as it is (false). Version-checked against the status the caller planned on.
   */
  async approveDraftPrice(client: PoolClient, workspaceId: string, entryId: string, userId: string, expected: { status: string }, approval: PriceApproval) {
    if (!(await this.canApprovePrices(client, workspaceId, userId))) throw new ForbiddenException("Only someone who reviews and approves prices can approve a list price");
    const entry = (await client.query<{ status: string; itemId: string; bookId: string }>(
      `SELECT status, item_id AS "itemId", price_book_id AS "bookId" FROM price_entries WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, entryId])).rows[0];
    if (!entry) throw new NotFoundException("Price not found");
    if (entry.status === "active") return false;
    if (entry.status !== expected.status) throw new ConflictException("This price changed since the preview. Review it again.");
    await client.query(
      `UPDATE price_entries SET status = 'active', reviewed_by = coalesce(reviewed_by, $3), reviewed_at = coalesce(reviewed_at, now()), updated_by = $3, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, entryId, userId]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "catalog.price_approved_list", entityType: "catalog_item", entityId: entry.itemId,
      before: { status: entry.status }, after: { bookId: entry.bookId, entryId, status: "active", source: approval.source } });
    return true;
  }

  /** A draft price book put in use (so its live prices are quoted), by a member who may approve prices. False when it already is. */
  async activatePriceBook(client: PoolClient, workspaceId: string, bookId: string, userId: string, approval: PriceApproval) {
    if (!(await this.canApprovePrices(client, workspaceId, userId))) throw new ForbiddenException("Only someone who reviews and approves prices can put a price book in use");
    const book = (await client.query<{ status: string }>(`SELECT status FROM price_books WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, bookId])).rows[0];
    if (!book) throw new NotFoundException("Price book not found");
    if (book.status === "active") return false;
    if (book.status === "expired") throw new UnprocessableEntityException("This price book has expired");
    await client.query(`UPDATE price_books SET status = 'active', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, bookId]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "catalog.price_book_active", entityType: "price_book", entityId: bookId, before: { status: book.status }, after: { status: "active", source: approval.source } });
    return true;
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
      // A file's category is the catalog's of the same name however it's written; a new one is named in Title Case.
      const existing = (await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM catalog_categories WHERE workspace_id = $1 AND catalog_id = $2 AND status = 'active' ORDER BY parent_id NULLS FIRST, sort_order`, [workspaceId, catalogId])).rows;
      const byKey = new Map([...existing].reverse().map((row) => [categoryKey(row.name), row.id]));
      for (const name of plan.summary.newCategories) {
        const title = categoryTitle(name);
        const id = byKey.get(categoryKey(name)) ?? (await client.query<{ id: string }>(
          `INSERT INTO catalog_categories (workspace_id, catalog_id, code, name, sort_order) VALUES ($1, $2, $3, $4, (SELECT coalesce(max(sort_order), 0) + 1 FROM catalog_categories WHERE catalog_id = $2))
           ON CONFLICT (catalog_id, code) DO UPDATE SET status = 'active' RETURNING id`, [workspaceId, catalogId, slug(title).replace(/_/g, "-") || "category", title])).rows[0].id;
        byKey.set(categoryKey(name), id);
        categoryIds.set(name, id);
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
    const item = await client.query<{ id: string; code: string; name: string; itemType: string; unitCode: string; categoryId: string | null; description: string | null; wastePercent: string | null; purchaseRoundTo: string | null; productionDays: number | null; technicalDrawingUrl: string | null; status: string; version: number }>(
      `SELECT id, code, name, item_type AS "itemType", unit_code AS "unitCode", category_id AS "categoryId", description,
              waste_percent::text AS "wastePercent", purchase_round_to::text AS "purchaseRoundTo", production_days AS "productionDays",
              technical_drawing_url AS "technicalDrawingUrl", status, version
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
      productionDays: this.productionDays(input.productionDays),
      technicalDrawingUrl: this.drawingUrl(input.technicalDrawingUrl),
      values,
    };
  }

  /** An http(s) link to the technical drawing (a PDF in Drive, the supplier's page…); empty clears it, left out keeps it. */
  private drawingUrl(value: string | null | undefined) {
    if (value === undefined) return undefined;
    const url = typeof value === "string" ? value.trim() : "";
    if (!url) return null;
    if (url.length > 2000 || !/^https?:\/\/\S+$/i.test(url)) throw new UnprocessableEntityException("Paste the technical drawing's link (http or https)");
    return url;
  }

  private productionDays(value: number | null | undefined) {
    if (value === undefined || value === null) return value;
    if (!Number.isInteger(value) || value < 0 || value > 3650) throw new UnprocessableEntityException("Production time is whole days, up to 3650");
    return value;
  }

  private async writeValues(client: PoolClient, workspaceId: string, itemId: string, values: Array<{ attributeId: string; value: string }>) {
    for (const value of values) {
      await client.query(`INSERT INTO catalog_item_values (workspace_id, item_id, attribute_id, value) VALUES ($1, $2, $3, $4)`, [workspaceId, itemId, value.attributeId, value.value]);
    }
  }

  /** Attributes that apply to a category: catalog-wide ones plus those on the category and its ancestors. */
  async attributes(client: PoolClient, workspaceId: string, catalogId: string, categoryId: string | null, all: boolean): Promise<Array<AttributeDefinition & { categoryId: string | null }>> {
    const rows = await client.query<AttributeDefinition & { categoryId: string | null }>(
      `WITH RECURSIVE ancestors AS (SELECT id, parent_id FROM catalog_categories WHERE id = $3
         UNION ALL SELECT parent.id, parent.parent_id FROM catalog_categories parent JOIN ancestors ON ancestors.parent_id = parent.id)
       SELECT id, code, label, value_type AS "valueType", required, choices, unit_code AS "unitCode", category_id AS "categoryId"
       FROM catalog_attributes WHERE workspace_id = $1 AND catalog_id = $2 AND status = 'active'
         AND ($4 OR category_id IS NULL OR category_id IN (SELECT id FROM ancestors)) ORDER BY sort_order, label`,
      [workspaceId, catalogId, categoryId, all]);
    return rows.rows;
  }

  async units(client: PoolClient, workspaceId: string): Promise<Unit[]> {
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

  private async lockCategory(client: PoolClient, workspaceId: string, catalogId: string, categoryId: string) {
    const found = await client.query<{ id: string; name: string; parentId: string | null; version: number }>(
      `SELECT id, name, parent_id AS "parentId", version FROM catalog_categories WHERE workspace_id = $1 AND catalog_id = $2 AND id = $3 AND status = 'active' FOR UPDATE`,
      [workspaceId, catalogId, categoryId]);
    if (!found.rowCount) throw new NotFoundException("Category not found");
    return found.rows[0];
  }

  /** Every category below this one. */
  private async descendants(client: PoolClient, workspaceId: string, categoryId: string) {
    return (await client.query<{ id: string }>(
      `WITH RECURSIVE tree AS (SELECT id FROM catalog_categories WHERE workspace_id = $1 AND parent_id = $2
         UNION SELECT child.id FROM catalog_categories child JOIN tree ON child.parent_id = tree.id WHERE child.workspace_id = $1) SELECT id FROM tree`,
      [workspaceId, categoryId])).rows.map((row) => row.id);
  }

  /** Two categories side by side never share a name, however it's written ("Chairs" and "CHAIR"). */
  private async uniqueSibling(client: PoolClient, workspaceId: string, catalogId: string, categoryId: string | null, parentId: string | null, name: string) {
    const siblings = await client.query<{ name: string }>(
      `SELECT name FROM catalog_categories WHERE workspace_id = $1 AND catalog_id = $2 AND id IS DISTINCT FROM $3::uuid AND parent_id IS NOT DISTINCT FROM $4::uuid AND status = 'active'`,
      [workspaceId, catalogId, categoryId, parentId]);
    const same = siblings.rows.find((row) => categoryKey(row.name) === categoryKey(name));
    if (same) throw new ConflictException(`${same.name} is already here. Merge the two instead.`);
  }

  /** A category command already done (the category is gone): its audit event. */
  private async priorCategoryCommand(client: PoolClient, workspaceId: string, categoryId: string, action: string) {
    const exists = await client.query(`SELECT 1 FROM catalog_categories WHERE workspace_id = $1 AND id = $2`, [workspaceId, categoryId]);
    if (exists.rowCount) return null;
    return (await client.query<{ after: unknown }>(
      `SELECT after FROM audit_events WHERE workspace_id = $1 AND entity_type = 'catalog_category' AND entity_id = $2 AND action = $3 ORDER BY occurred_at DESC LIMIT 1`,
      [workspaceId, categoryId, action])).rows[0] ?? null;
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

/** A live price as found: the entry's numbers in its book's currency. */
type LivePrice = { id: string; method: string; price: string | null; rate: string | null; minimumCharge: string | null; cost: string | null; markupPercent: string | null; currency: string };
export type ItemPrice =
  | { status: "active"; method: string; amount: string | null; currency: string; per: string; minimumCharge?: string; tiers?: Array<{ fromQuantity: string; price: string }>; note?: string }
  | { status: "draft" | "reviewed" | "not_live" | "none" };
export type FoundItem = {
  id: string; catalogId: string; catalogName: string; code: string; name: string; itemType: string; unitCode: string; categoryName: string | null; description: string | null;
  technicalDrawingUrl: string | null; productionDays: number | null;
  size: { width: string | null; depth: string | null; height: string | null; unit: string } | null;
  attributes: Array<{ label: string; value: string }>;
  price: ItemPrice;
  /** Only for people who may see costs. */
  cost?: { amount: string; currency: string | null; supplier: string | null } | null;
};

/** What one unit sells for under a live price, as the customer sees it (never how cost and margin build it). */
export function livePrice(entry: LivePrice, unitCode: string, tiers: Array<{ fromQuantity: string; price: string }>): ItemPrice {
  const money = (value: string | null) => (value === null ? null : moneyText(value, entry.currency));
  const base = { status: "active" as const, method: entry.method, currency: entry.currency, per: unitCode };
  switch (entry.method) {
    case "fixed": return { ...base, amount: money(entry.price) };
    case "attribute_surcharge": return { ...base, amount: money(entry.price), note: "Base price; some options cost more" };
    case "per_measure": return { ...base, amount: money(entry.rate), ...(entry.minimumCharge ? { minimumCharge: money(entry.minimumCharge)! } : {}) };
    case "tiered": {
      const steps = tiers.map((tier) => ({ fromQuantity: Dec.of(tier.fromQuantity).toString(), price: money(tier.price)! }));
      return { ...base, amount: steps[0]?.price ?? null, tiers: steps, note: "The price per unit depends on the quantity" };
    }
    case "cost_plus":
      return { ...base, amount: entry.cost && entry.markupPercent ? money(Dec.of(entry.cost).mul(Dec.ONE.add(Dec.of(entry.markupPercent).div(100))).toString()) : null };
    default: return { ...base, amount: null, note: "Worked out from its parts in a quotation" };
  }
}

/** An amount at its currency's precision ("4200.00", "135.000" in KWD). */
export function moneyText(value: string, currency: string | null) {
  return Dec.of(value).toFixed(currencyDecimals(currency ?? ""));
}
