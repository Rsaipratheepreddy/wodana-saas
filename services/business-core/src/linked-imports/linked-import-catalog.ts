import { createHash } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { Dec } from "../catalog-core/decimal";
import type { AttributeDefinition } from "../catalog-core/attributes";
import { AttributeValueError, normalizeAttributeValues } from "../catalog-core/attributes";
import { normalizeUnit, PACK_UNITS } from "../catalog-core/catalog-import";
import type { CatalogV2Service, ItemInput } from "../catalog-core/catalog-v2.service";
import { recordKey, type ImportContext, type Step, type TargetAdapter } from "./linked-import-run";
import { sameNumber, sheetNumber, SourceError } from "./linked-import-source";

const ITEM_TYPES = ["product", "material", "assembly", "service", "package", "ready_made"] as const;
type ItemType = (typeof ITEM_TYPES)[number];
type Item = { id: string; code: string; name: string; itemType: ItemType; unitCode: string; categoryId: string | null; description: string | null; wastePercent: string | null;
  purchaseRoundTo: string | null; productionDays: number | null; status: string; version: number; values: Record<string, string> };
type Definition = AttributeDefinition & { categoryId: string | null };
type Price = { method: string; price: string | null; cost: string | null };

const lower = (text: string) => text.trim().toLocaleLowerCase();
const shown = (value: string | null | undefined) => (value === null || value === undefined || value === "" ? "—" : Dec.of(value).toString());
/** An attribute's code from its column heading, as the catalog's importer makes it. */
export function attributeCode(heading: string) {
  const code = heading.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  if (!code) return `a_${createHash("sha256").update(heading.trim()).digest("hex").slice(0, 10)}`;
  return /^[a-z]/.test(code) ? code : `a_${code}`.slice(0, 60);
}
function itemType(written: string): ItemType | null {
  const key = written.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((ITEM_TYPES as readonly string[]).includes(key)) return key as ItemType;
  return ({ readymade: "ready_made", products: "product", materials: "material", services: "service", kit: "package" } as Record<string, ItemType>)[key.replace(/_/g, "")] ?? null;
}

/**
 * A product list: each row is a catalog item (by its code) in the link's catalog. New codes are created and
 * known ones revised through the catalog's own item commands (so its validation applies); the selling price
 * and cost become a fixed price in the catalog's price book in the workspace's currency, drafted for review
 * like any price change; production time is the item's. Extra columns are kept as attributes.
 */
export function catalogAdapter(catalogs: CatalogV2Service): TargetAdapter {
  return {
    async plan(context, rows) {
      const { client, workspaceId, link, userId } = context;
      const catalogId = link.catalogId!;
      const items = (await client.query<Item>(
        `SELECT item.id, item.code, item.name, item.item_type AS "itemType", item.unit_code AS "unitCode", item.category_id AS "categoryId", item.description,
                item.waste_percent::text AS "wastePercent", item.purchase_round_to::text AS "purchaseRoundTo", item.production_days AS "productionDays", item.status, item.version,
                coalesce((SELECT jsonb_object_agg(attribute.code, value.value) FROM catalog_item_values value JOIN catalog_attributes attribute ON attribute.id = value.attribute_id
                  WHERE value.workspace_id = item.workspace_id AND value.item_id = item.id), '{}'::jsonb) AS "values"
           FROM catalog_items item WHERE item.workspace_id = $1 AND item.catalog_id = $2`, [workspaceId, catalogId])).rows;
      const byCode = new Map(items.map((item) => [lower(item.code), item]));
      const categories = new Map((await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM catalog_categories WHERE workspace_id = $1 AND catalog_id = $2 AND status = 'active' ORDER BY parent_id NULLS FIRST, sort_order`,
        [workspaceId, catalogId])).rows.reverse().map((row) => [lower(row.name), row.id]));
      const definitions: Definition[] = await catalogs.attributes(client, workspaceId, catalogId, null, true);
      const units = await catalogs.units(client, workspaceId);
      const currency = (await client.query<{ currency: string | null }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? null;
      const book = currency ? (await client.query<{ id: string }>(
        `SELECT id FROM price_books WHERE workspace_id = $1 AND catalog_id = $2 AND currency = $3 AND status <> 'expired'
          ORDER BY status = 'active' DESC, (legal_entity_id IS NULL AND segment IS NULL) DESC, effective_from DESC LIMIT 1`, [workspaceId, catalogId, currency])).rows[0]?.id ?? null : null;
      const prices = new Map(book ? (await client.query<Price & { itemId: string }>(
        `SELECT item_id AS "itemId", method, price::text AS price, cost::text AS cost FROM price_entries
          WHERE workspace_id = $1 AND price_book_id = $2 AND variant_id IS NULL AND status <> 'expired'`, [workspaceId, book])).rows.map((row) => [row.itemId, row]) : []);
      // What applying creates once and every later row reuses: units, categories, attributes and the price book.
      const made = { categories: new Map<string, string>(), attributes: new Map<string, string>(), book: book as string | null };
      const ancestors = new Map<string, Definition[]>();
      const applicable = async (categoryId: string | null) => {
        if (!categoryId) return definitions.filter((definition) => !definition.categoryId);
        if (!ancestors.has(categoryId)) ancestors.set(categoryId, await catalogs.attributes(client, workspaceId, catalogId, categoryId, false));
        return ancestors.get(categoryId)!;
      };
      const seen = new Set<string>();
      const steps: Step[] = [];

      for (const row of rows) {
        const code = row.key.trim();
        const item = byCode.get(lower(code));
        const name = (row.values.name ?? "").trim();
        const base = { sheet: row.sheet, line: row.line, key: code, name: name || item?.name || code, changes: [] as string[], message: "", recordKey: code ? recordKey(code, null) : null, locationId: null };
        const fail = (message: string): Step => ({ ...base, outcome: "error", message });
        try {
          if (!code) { steps.push(fail("No item code.")); continue; }
          if (code.length > 80) { steps.push(fail("The code is longer than 80 characters.")); continue; }
          if (seen.has(lower(code))) { steps.push(fail(`Code ${code} is on another row.`)); continue; }
          seen.add(lower(code));
          if (name.length > 200) { steps.push(fail("The name is longer than 200 characters.")); continue; }
          if (!item && !name) { steps.push(fail("Name the item: it's new to the catalog.")); continue; }
          if (item?.status === "archived") { steps.push(fail(`${item.name} is archived in the catalog. Restore it to import it.`)); continue; }
          const messages: string[] = [];

          // Unit: the catalog's code for it as written; an unknown unit is refused, a pack unit is added on first use.
          let unitCode = item?.unitCode ?? "pcs";
          const writtenUnit = (row.values.unit ?? "").trim();
          if (writtenUnit) {
            const known = units.find((unit) => lower(unit.code) === lower(writtenUnit) || lower(unit.label) === lower(writtenUnit));
            const normal = known?.code ?? normalizeUnit(writtenUnit).unit;
            if (!normal || (!units.some((unit) => unit.code === normal) && !PACK_UNITS[normal])) { steps.push(fail(`Wodana doesn't know the unit "${writtenUnit}".`)); continue; }
            unitCode = normal;
          } else if (!item) messages.push("No unit: set to pieces.");
          const writtenType = (row.values.type ?? "").trim();
          const type = writtenType ? itemType(writtenType) : (item?.itemType ?? ((link.itemType as ItemType | null) ?? "product"));
          if (!type) { steps.push(fail(`"${writtenType}" isn't a kind of item Wodana knows.`)); continue; }
          const categoryName = (row.values.category ?? "").trim();
          if (categoryName.length > 160) { steps.push(fail("The category is longer than 160 characters.")); continue; }
          const categoryId = categoryName ? categories.get(lower(categoryName)) ?? null : item?.categoryId ?? null;
          const newCategory = categoryName && !categories.has(lower(categoryName)) ? categoryName : null;
          const description = (row.values.description ?? "").trim() || (item?.description ?? null);
          if (description && description.length > 4000) { steps.push(fail("The description is longer than 4000 characters.")); continue; }
          const productionDays = row.values.productionDays === undefined ? undefined : sheetNumber(row.values.productionDays, "Production time", { places: 0, whole: true, max: "3650" });
          const price = row.values.price === undefined ? null : sheetNumber(row.values.price, "Selling price", { places: 6, max: "999999999999" });
          const cost = row.values.cost === undefined ? null : sheetNumber(row.values.cost, "Cost", { places: 6, max: "999999999999" });

          // Attributes: the sheet's extra columns over what the item already has; a new heading becomes a text attribute.
          const values: Record<string, string> = { ...(item?.values ?? {}) };
          const newAttributes: string[] = [];
          for (const [heading, raw] of Object.entries(row.attributes)) {
            const definition = definitions.find((entry) => lower(entry.label) === lower(heading) || entry.code === attributeCode(heading));
            if (!definition) { newAttributes.push(heading); values[attributeCode(heading)] = raw.slice(0, 500); continue; }
            const choice = definition.choices.find((option) => lower(option.label) === lower(raw) || lower(option.value) === lower(raw));
            values[definition.code] = definition.valueType === "multi_choice"
              ? raw.split(",").map((part) => definition.choices.find((option) => lower(option.label) === lower(part) || lower(option.value) === lower(part))?.value ?? part.trim()).join(",")
              : definition.valueType === "boolean" ? (/^(yes|y|true|1)$/i.test(raw) ? "true" : /^(no|n|false|0)$/i.test(raw) ? "false" : raw) : choice?.value ?? raw;
          }
          try {
            const known = [...(await applicable(categoryId)), ...newAttributes.map((heading): Definition => ({ id: heading, code: attributeCode(heading), label: heading, valueType: "text", required: false, choices: [], unitCode: null, categoryId: null }))];
            const knownCodes = new Set(known.map((definition) => definition.code));
            normalizeAttributeValues(known, Object.fromEntries(Object.entries(values).filter(([code]) => knownCodes.has(code))));
          } catch (error) { if (error instanceof AttributeValueError) { steps.push(fail(error.message)); continue; } throw error; }

          // The price: a fixed selling price (with its cost) in the book; the cost alone needs a price already there.
          const current = item ? prices.get(item.id) : undefined;
          let nextPrice: { price: string; cost: string | null } | null = null;
          if (price !== null) nextPrice = { price, cost: cost ?? current?.cost ?? null };
          else if (cost !== null && current?.method === "fixed" && current.price) nextPrice = { price: current.price, cost };
          else if (cost !== null) messages.push("The cost is kept with a selling price.");
          if (nextPrice && !currency) { steps.push(fail("Set the workspace's currency first.")); continue; }
          const priceChanges = nextPrice !== null && !(current?.method === "fixed" && sameNumber(current.price, nextPrice.price) && sameNumber(current.cost, nextPrice.cost));

          const input: ItemInput = {
            version: item?.version, code: item?.code ?? code, name: name || item!.name, itemType: type, unitCode, categoryId, description,
            wastePercent: item?.wastePercent ?? null, purchaseRoundTo: item?.purchaseRoundTo ?? null, values,
            ...(productionDays === undefined || productionDays === null ? {} : { productionDays: Number(productionDays) }),
          };
          if (item) {
            if (name && name !== item.name) base.changes.push(`Name ${item.name} → ${name}`);
            if (unitCode !== item.unitCode) base.changes.push(`Unit ${item.unitCode} → ${unitCode}`);
            if (type !== item.itemType) base.changes.push(`Kind ${item.itemType} → ${type}`);
            if (categoryId !== item.categoryId || newCategory) base.changes.push(`Category → ${categoryName}`);
            if ((description ?? null) !== (item.description ?? null)) base.changes.push("Description");
            if (input.productionDays !== undefined && input.productionDays !== item.productionDays) base.changes.push(`Production time ${item.productionDays ?? "—"} → ${input.productionDays} days`);
            const before = item.values;
            const changedValues = Object.keys(values).filter((code) => (before[code] ?? "") !== values[code]);
            if (changedValues.length) base.changes.push(...changedValues.map((code) => definitions.find((definition) => definition.code === code)?.label ?? newAttributes.find((heading) => attributeCode(heading) === code) ?? code));
          }
          const detailsChange = !item || base.changes.length > 0;
          if (priceChanges) base.changes.push(`Price ${shown(current?.price)} → ${shown(nextPrice!.price)}${sameNumber(nextPrice!.cost, current?.cost) ? "" : `, cost ${shown(current?.cost)} → ${shown(nextPrice!.cost)}`} (draft until reviewed)`);
          base.message = messages.join(" ");
          if (item && !base.changes.length) { steps.push({ ...base, outcome: "unchanged", keep: { recordId: item.id, locationId: null, quantity: null } }); continue; }

          steps.push({ ...base, outcome: item ? "changed" : "added", apply: async () => {
            // A row that fails is rolled back with what it created, so later rows don't reuse it.
            const before = { made: new Map(made.categories), categories: new Map(categories), attributes: new Map(made.attributes), book: made.book, definitions: definitions.length, units: units.length };
            try { return await applyRow(); }
            catch (error) {
              made.categories = before.made; made.attributes = before.attributes; made.book = before.book;
              categories.clear(); for (const [name, id] of before.categories) categories.set(name, id);
              definitions.splice(before.definitions); units.splice(before.units);
              throw error;
            }
          } });
          async function applyRow() {
            if (!units.some((unit) => unit.code === unitCode) && PACK_UNITS[unitCode]) {
              await client.query(`INSERT INTO catalog_units (workspace_id, code, label, kind, to_base) VALUES ($1, $2, $3, 'count', 1) ON CONFLICT DO NOTHING`, [workspaceId, unitCode, PACK_UNITS[unitCode]]);
              units.push({ code: unitCode, label: PACK_UNITS[unitCode], kind: "count", toBase: "1" });
            }
            let category = categoryId;
            if (newCategory) {
              category = made.categories.get(lower(newCategory)) ?? (await catalogs.insertCategory(client, workspaceId, catalogId, { name: newCategory }, userId)).id;
              made.categories.set(lower(newCategory), category);
              categories.set(lower(newCategory), category);
            }
            for (const heading of newAttributes) {
              const code = attributeCode(heading);
              if (made.attributes.has(code) || definitions.some((definition) => definition.code === code)) continue;
              const created = await catalogs.insertAttribute(client, workspaceId, catalogId, { label: heading.slice(0, 120), code, valueType: "text" }, userId);
              made.attributes.set(code, created.id);
              definitions.push({ id: created.id, code, label: heading, valueType: "text", required: false, choices: [], unitCode: null, categoryId: null });
            }
            // Only the attributes that apply to the item's category are kept (the catalog refuses others).
            const allowed = new Set((await catalogs.attributes(client, workspaceId, catalogId, category, false)).map((definition) => definition.code));
            const kept = Object.fromEntries(Object.entries(values).filter(([code]) => allowed.has(code)));
            let itemId = item?.id;
            if (!item) itemId = await catalogs.insertItem(client, workspaceId, catalogId, { ...input, categoryId: category, values: kept }, userId);
            else if (detailsChange) await catalogs.reviseItem(client, workspaceId, catalogId, item.id, { ...input, categoryId: category, values: kept }, userId);
            if (priceChanges) {
              made.book ??= (await catalogs.insertPriceBook(client, workspaceId, catalogId, { name: `${currency} prices`, currency: currency! }, userId)).id;
              await catalogs.draftPrice(client, workspaceId, made.book, itemId!, { method: "fixed", price: nextPrice!.price, cost: nextPrice!.cost }, userId);
            }
            return { recordId: itemId!, locationId: null, quantity: null };
          }
        } catch (error) {
          if (error instanceof SourceError || error instanceof HttpException) steps.push(fail(error.message));
          else throw error;
        }
      }
      return steps;
    },

    async names(context, recordIds) {
      if (!recordIds.length) return new Map();
      return new Map((await context.client.query<{ id: string; name: string }>(`SELECT id, name FROM catalog_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
        [context.workspaceId, recordIds])).rows.map((row) => [row.id, row.name]));
    },
  };
}
