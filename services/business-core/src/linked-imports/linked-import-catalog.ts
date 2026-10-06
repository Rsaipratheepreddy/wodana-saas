import { createHash } from "node:crypto";
import { ConflictException, HttpException } from "@nestjs/common";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import type { AttributeDefinition } from "../catalog-core/attributes";
import { AttributeValueError, normalizeAttributeValues } from "../catalog-core/attributes";
import { normalizeUnit, PACK_UNITS } from "../catalog-core/catalog-import";
import type { CatalogV2Service, ItemInput } from "../catalog-core/catalog-v2.service";
import { categoryKey, categoryTitle } from "../catalog-core/category-names";
import { recordKey, type ImportContext, type Step, type TargetAdapter } from "./linked-import-run";
import { linkOf, sameNumber, sheetNumber, SourceError } from "./linked-import-source";

const ITEM_TYPES = ["product", "material", "assembly", "service", "package", "ready_made"] as const;
type ItemType = (typeof ITEM_TYPES)[number];
type Item = { id: string; code: string; name: string; itemType: ItemType; unitCode: string; categoryId: string | null; description: string | null; wastePercent: string | null;
  purchaseRoundTo: string | null; productionDays: number | null; technicalDrawingUrl: string | null; status: string; version: number; values: Record<string, string>;
  size: Size | null };
type SizeUnit = "mm" | "cm" | "m" | "in" | "ft";
type SizeField = "width" | "depth" | "height";
type Size = { width: string | null; depth: string | null; height: string | null; unit: SizeUnit; version: number };
type Definition = AttributeDefinition & { categoryId: string | null };
type Price = { id: string; method: string; price: string | null; cost: string | null; status: string };

/**
 * What a row does to its item's price: nothing; a new entry (drafted for review, or live at once as an approved list
 * price), superseding the current one; or, for approved list prices, the current draft approved as it is.
 */
export type PriceAction = { kind: "none" } | { kind: "draft" | "approve"; price: string; cost: string | null; change: string } | { kind: "activate"; change: string };
export function priceAction(current: Pick<Price, "method" | "price" | "cost" | "status"> | undefined, next: { price: string; cost: string | null } | null, approved: boolean): PriceAction {
  if (!next) return { kind: "none" };
  const same = current?.method === "fixed" && sameNumber(current.price, next.price) && sameNumber(current.cost, next.cost);
  if (same) return approved && current.status !== "active" ? { kind: "activate", change: `Price ${shown(next.price)} approved` } : { kind: "none" };
  const change = `Price ${shown(current?.price)} → ${shown(next.price)}${sameNumber(next.cost, current?.cost) ? "" : `, cost ${shown(current?.cost)} → ${shown(next.cost)}`}`;
  return approved ? { kind: "approve", ...next, change } : { kind: "draft", ...next, change: `${change} (draft until reviewed)` };
}

const lower = (text: string) => text.trim().toLocaleLowerCase();
const shown = (value: string | null | undefined) => (value === null || value === undefined || value === "" ? "—" : Dec.of(value).toString());
/** An attribute's code from its column heading, as the catalog's importer makes it. */
export function attributeCode(heading: string) {
  const code = heading.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  if (!code) return `a_${createHash("sha256").update(heading.trim()).digest("hex").slice(0, 10)}`;
  return /^[a-z]/.test(code) ? code : `a_${code}`.slice(0, 60);
}
/** A new item's code from its name ("Aria Sofa – 3 seater" → ARIA-SOFA-3-SEATER), unique in the catalog. */
export function codeFromName(name: string, taken: Set<string>) {
  const base = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "") || "ITEM";
  let code = base;
  for (let next = 2; taken.has(code.toLowerCase()); next++) code = `${base.slice(0, 80 - String(next).length - 1).replace(/-+$/, "")}-${next}`;
  taken.add(code.toLowerCase());
  return code;
}

const MM_PER: Record<SizeUnit, string> = { mm: "1", cm: "10", m: "1000", in: "25.4", ft: "304.8" };
const UNIT_WORDS: Array<[RegExp, SizeUnit]> = [[/^(mm|millimet(er|re)s?)$/i, "mm"], [/^(cm|centimet(er|re)s?)$/i, "cm"], [/^(m|met(er|re)s?)$/i, "m"],
  [/^(in|inch|inches|")$/i, "in"], [/^(ft|feet|foot|')$/i, "ft"]];
const unitWord = (text: string) => UNIT_WORDS.find(([pattern]) => pattern.test(text.trim()))?.[1] ?? null;
/** The unit a heading names ("HEIGHT (CM)", "Width mm"), if any. */
export function headingUnit(heading: string): SizeUnit | null {
  const bracket = /\(([^)]*)\)/.exec(heading)?.[1];
  if (bracket && unitWord(bracket)) return unitWord(bracket);
  const last = heading.trim().split(/\s+/).at(-1) ?? "";
  return heading.trim().split(/\s+/).length > 1 ? unitWord(last) : null;
}
/**
 * One size as a cell writes it: a plain number with an optional unit ("300 cm", "120", "1,200 mm"). The unit is
 * the cell's, else the heading's, else the workspace's. Anything else ("Total H 108 cm – seat 53 cm") is null.
 */
export function sizeCell(text: string, heading: string, fallback: SizeUnit): { value: string; unit: SizeUnit } | null {
  const match = /^([\d.,\s]*\d)\s*([a-z"']*)\.?$/i.exec(text.trim());
  if (!match) return null;
  const unit = match[2] ? unitWord(match[2]) : headingUnit(heading) ?? fallback;
  if (!unit) return null;
  const digits = match[1].replace(/\s+/g, "");
  const number = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(digits) ? digits.replace(/,/g, "") : /^\d+([.,]\d+)?$/.test(digits) ? digits.replace(",", ".") : null;
  if (!number) return null;
  const value = Dec.of(number).round(2);
  if (value.cmp(0) <= 0 || value.cmp("9999999999.99") > 0) return null;
  return { value: value.toString(), unit };
}
const inUnit = (value: string, from: SizeUnit, to: SizeUnit) => (from === to ? Dec.of(value) : Dec.of(value).mul(MM_PER[from]).div(MM_PER[to])).round(2).toString();
const SIZE_LABEL: Record<SizeField, string> = { height: "Height", width: "Width", depth: "Depth" };
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
 * A link whose prices are approved list prices (run by a member who may approve prices) puts them live instead, in
 * the catalog's default price book (put in use if it isn't), and approves the drafts of prices the sheet repeats.
 */
export function catalogAdapter(catalogs: CatalogV2Service): TargetAdapter {
  return {
    async plan(context, rows) {
      const { client, workspaceId, link, userId } = context;
      const catalogId = link.catalogId!;
      const approved = context.approvedPrices === true;
      const approval = { source: { via: "linked_import", linkId: link.id, runId: context.runId ?? null } };
      const items = (await client.query<Item>(
        `SELECT item.id, item.code, item.name, item.item_type AS "itemType", item.unit_code AS "unitCode", item.category_id AS "categoryId", item.description,
                item.waste_percent::text AS "wastePercent", item.purchase_round_to::text AS "purchaseRoundTo", item.production_days AS "productionDays",
                item.technical_drawing_url AS "technicalDrawingUrl", item.status, item.version,
                (SELECT jsonb_build_object('width', size.width::text, 'depth', size.depth::text, 'height', size.height::text, 'unit', size.unit, 'version', size.version)
                   FROM catalog_item_dimensions size WHERE size.workspace_id = item.workspace_id AND size.item_id = item.id) AS size,
                coalesce((SELECT jsonb_object_agg(attribute.code, value.value) FROM catalog_item_values value JOIN catalog_attributes attribute ON attribute.id = value.attribute_id
                  WHERE value.workspace_id = item.workspace_id AND value.item_id = item.id), '{}'::jsonb) AS "values"
           FROM catalog_items item WHERE item.workspace_id = $1 AND item.catalog_id = $2`, [workspaceId, catalogId])).rows;
      const byId = new Map(items.map((item) => [item.id, item]));
      const byCode = new Map(items.map((item) => [lower(item.code), item]));
      const byName = new Map<string, Item[]>();
      for (const item of items) byName.set(lower(item.name), [...(byName.get(lower(item.name)) ?? []), item]);
      const taken = new Set(items.map((item) => lower(item.code)));
      const codeMapped = Object.values(link.mapping?.columns ?? {}).includes("code");
      const unitSystem = (await client.query<{ unitSystem: string }>(`SELECT unit_system::text AS "unitSystem" FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.unitSystem;
      const defaultUnit: SizeUnit = unitSystem === "imperial" ? "in" : "cm";
      // A sheet's category is the catalog's of the same name however it's written ("BED & MATTRESS" is "Beds & Mattress");
      // of two such, the top-level and earlier one.
      const categoryRows = (await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM catalog_categories WHERE workspace_id = $1 AND catalog_id = $2 AND status = 'active' ORDER BY parent_id NULLS FIRST, sort_order`,
        [workspaceId, catalogId])).rows;
      const categories = new Map([...categoryRows].reverse().map((row) => [categoryKey(row.name), row.id]));
      const categoryNames = new Map(categoryRows.map((row) => [row.id, row.name]));
      const definitions: Definition[] = await catalogs.attributes(client, workspaceId, catalogId, null, true);
      const units = await catalogs.units(client, workspaceId);
      const currency = (await client.query<{ currency: string | null }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? null;
      // Approved list prices go to the catalog's default book (for no one company or segment); drafts to the book in use.
      const found = currency ? (await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM price_books WHERE workspace_id = $1 AND catalog_id = $2 AND currency = $3 AND status <> 'expired'
            AND (NOT $4::boolean OR (legal_entity_id IS NULL AND segment IS NULL))
          ORDER BY status = 'active' DESC, (legal_entity_id IS NULL AND segment IS NULL) DESC, effective_from DESC LIMIT 1`, [workspaceId, catalogId, currency, approved])).rows[0] ?? null : null;
      const book = found?.id ?? null;
      const prices = new Map(book ? (await client.query<Price & { itemId: string }>(
        `SELECT id, item_id AS "itemId", method, price::text AS price, cost::text AS cost, status FROM price_entries
          WHERE workspace_id = $1 AND price_book_id = $2 AND variant_id IS NULL AND status <> 'expired'`, [workspaceId, book])).rows.map((row) => [row.itemId, row]) : []);
      // What applying creates once and every later row reuses: units, categories, attributes and the price book (in use, for approved prices).
      const made = { categories: new Map<string, string>(), attributes: new Map<string, string>(), book: book as string | null, bookInUse: found?.status === "active" };
      const ancestors = new Map<string, Definition[]>();
      const applicable = async (categoryId: string | null) => {
        if (!categoryId) return definitions.filter((definition) => !definition.categoryId);
        if (!ancestors.has(categoryId)) ancestors.set(categoryId, await catalogs.attributes(client, workspaceId, catalogId, categoryId, false));
        return ancestors.get(categoryId)!;
      };
      const seen = new Set<string>();
      const claimed = new Set<string>();
      const steps: Step[] = [];

      for (const row of rows) {
        const key = row.key.trim();
        const written = (row.values.code ?? "").trim();
        const name = (row.values.name ?? "").trim();
        const base = { sheet: row.sheet, line: row.line, key, name: name || key, changes: [] as string[], message: "", recordKey: key ? recordKey(key, null) : null, locationId: null };
        const fail = (message: string): Step => ({ ...base, outcome: "error", message });
        try {
          if (!key) { steps.push(fail(codeMapped ? "No item code or name." : "No item name.")); continue; }
          if (written.length > 80) { steps.push(fail("The code is longer than 80 characters.")); continue; }
          if (seen.has(lower(key))) { steps.push(fail(written ? `Code ${written} is on another row.` : `${key} is on another row.`)); continue; }
          seen.add(lower(key));
          if (name.length > 200) { steps.push(fail("The name is longer than 200 characters.")); continue; }
          // The item: the one this key named before, else by its code, else (no code) the one item of that name in the row's category.
          const known = context.records.get(recordKey(key, null));
          let item = known ? byId.get(known.recordId) : undefined;
          if (!item && written) item = byCode.get(lower(written));
          if (!item && !written) {
            const categoryName = (row.values.category ?? "").trim();
            const inCategory = categoryName ? categories.get(categoryKey(categoryName)) ?? null : undefined;
            const same = (byName.get(lower(name)) ?? []).filter((candidate) => inCategory === undefined || (inCategory !== null && candidate.categoryId === inCategory));
            if (same.length > 1) { steps.push(fail(`${same.length} items are called ${name}. Add a code column to tell them apart.`)); continue; }
            item = same[0];
          }
          if (item && claimed.has(item.id)) { steps.push(fail(`Another row is already ${item.name}.`)); continue; }
          if (item) claimed.add(item.id);
          if (item) base.name = name || item.name;
          if (!item && !name) { steps.push(fail("Name the item: it's new to the catalog.")); continue; }
          if (item?.status === "archived") { steps.push(fail(`${item.name} is archived in the catalog. Restore it to import it.`)); continue; }
          const code = item?.code ?? (written || codeFromName(name, taken));
          if (!item && written) taken.add(lower(written));
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
          const categoryId = categoryName ? categories.get(categoryKey(categoryName)) ?? null : item?.categoryId ?? null;
          // A new category is named in Title Case, never in the sheet's capitals.
          const newCategory = categoryName && !categories.has(categoryKey(categoryName)) ? categoryTitle(categoryName) : null;
          const description = (row.values.description ?? "").trim() || (item?.description ?? null);
          if (description && description.length > 4000) { steps.push(fail("The description is longer than 4000 characters.")); continue; }
          const productionDays = row.values.productionDays === undefined ? undefined : sheetNumber(row.values.productionDays, "Production time", { places: 0, whole: true, max: "3650" });
          // A price in words ("ENQUIRE", "N/A") is on request: the item has none. Nought is none too.
          const priceText = (row.values.price ?? "").trim();
          let price = priceText && !/\d/.test(priceText) ? null : sheetNumber(row.values.price, "Selling price", { places: 6, max: "999999999999" });
          if (priceText && !/\d/.test(priceText)) messages.push(`No selling price: ${priceText}.`);
          if (price !== null && Dec.of(price).cmp(0) === 0) price = null;
          const cost = row.values.cost === undefined ? null : sheetNumber(row.values.cost, "Cost", { places: 6, max: "999999999999" });

          // The technical drawing: the cell's link, or the cell itself when it's a link; anything else leaves the item's as it is.
          let drawing: string | undefined;
          const drawingText = (row.values.technicalDrawing ?? "").trim();
          if (row.values.technicalDrawing !== undefined) {
            const url = row.links?.technicalDrawing ?? linkOf(drawingText);
            if (url) drawing = url;
            else if (drawingText) messages.push(`No link to a technical drawing in ${drawingText}.`);
          }

          // The size: a cell with one number fills it; any other text is kept as an attribute under its heading.
          const sheetSizes: Partial<Record<SizeField, { value: string; unit: SizeUnit }>> = {};
          const sizeTexts: Record<string, string> = {};
          for (const field of ["height", "width", "depth"] as SizeField[]) {
            const text = (row.values[field] ?? "").trim();
            if (!text) continue;
            const heading = row.headings?.[field] ?? SIZE_LABEL[field];
            const read = sizeCell(text, heading, defaultUnit);
            if (read) sheetSizes[field] = read;
            else { sizeTexts[heading] = text; messages.push(`${heading} isn't one number, so it's kept as text.`); }
          }
          const currentSize = item?.size ?? null;
          const sizeFields = Object.keys(sheetSizes) as SizeField[];
          let nextSize: Omit<Size, "version"> | null = null;
          const sizeChanges: string[] = [];
          if (sizeFields.length) {
            // The item keeps the unit it's measured in; a new size takes the sheet's.
            const unit = currentSize?.unit ?? sheetSizes[sizeFields[0]]!.unit;
            nextSize = { unit, width: null, depth: null, height: null };
            for (const field of ["width", "depth", "height"] as SizeField[]) {
              const fromSheet = sheetSizes[field];
              const before = currentSize?.[field] ? inUnit(currentSize[field]!, currentSize.unit, unit) : null;
              nextSize[field] = fromSheet ? inUnit(fromSheet.value, fromSheet.unit, unit) : before;
              if (fromSheet && !sameNumber(before, nextSize[field])) sizeChanges.push(`${SIZE_LABEL[field]} ${before ?? "—"} → ${nextSize[field]} ${unit}`);
            }
            if (!sizeChanges.length) nextSize = null;
          }

          // Attributes: the sheet's extra columns over what the item already has; a new heading becomes a text attribute.
          const values: Record<string, string> = { ...(item?.values ?? {}) };
          const newAttributes: string[] = [];
          for (const [heading, raw] of Object.entries({ ...row.attributes, ...sizeTexts })) {
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
          const pricing = priceAction(current, nextPrice, approved);

          const input: ItemInput = {
            version: item?.version, code, name: name || item!.name, itemType: type, unitCode, categoryId, description,
            wastePercent: item?.wastePercent ?? null, purchaseRoundTo: item?.purchaseRoundTo ?? null, values,
            ...(productionDays === undefined || productionDays === null ? {} : { productionDays: Number(productionDays) }),
            ...(drawing === undefined ? {} : { technicalDrawingUrl: drawing }),
          };
          if (item) {
            if (name && name !== item.name) base.changes.push(`Name ${item.name} → ${name}`);
            if (unitCode !== item.unitCode) base.changes.push(`Unit ${item.unitCode} → ${unitCode}`);
            if (type !== item.itemType) base.changes.push(`Kind ${item.itemType} → ${type}`);
            if (categoryId !== item.categoryId || newCategory) base.changes.push(`Category → ${newCategory ?? (categoryId ? categoryNames.get(categoryId) : null) ?? categoryName}`);
            if ((description ?? null) !== (item.description ?? null)) base.changes.push("Description");
            if (input.productionDays !== undefined && input.productionDays !== item.productionDays) base.changes.push(`Production time ${item.productionDays ?? "—"} → ${input.productionDays} days`);
            const before = item.values;
            const changedValues = Object.keys(values).filter((code) => (before[code] ?? "") !== values[code]);
            if (changedValues.length) base.changes.push(...changedValues.map((code) => definitions.find((definition) => definition.code === code)?.label ?? newAttributes.find((heading) => attributeCode(heading) === code) ?? code));
            if (drawing !== undefined && drawing !== item.technicalDrawingUrl) base.changes.push("Technical drawing");
          }
          const detailsChange = !item || base.changes.length > 0;
          if (item) base.changes.push(...sizeChanges);
          if (pricing.kind !== "none") base.changes.push(pricing.change);
          base.message = messages.join(" ");
          if (item && !base.changes.length) { steps.push({ ...base, outcome: "unchanged", keep: { recordId: item.id, locationId: null, quantity: null } }); continue; }

          steps.push({ ...base, outcome: item ? "changed" : "added", apply: async () => {
            // A row that fails is rolled back with what it created, so later rows don't reuse it.
            const before = { made: new Map(made.categories), categories: new Map(categories), attributes: new Map(made.attributes), book: made.book, bookInUse: made.bookInUse,
              definitions: definitions.length, units: units.length };
            try { return await applyRow(); }
            catch (error) {
              made.categories = before.made; made.attributes = before.attributes; made.book = before.book; made.bookInUse = before.bookInUse;
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
              category = made.categories.get(categoryKey(newCategory)) ?? (await catalogs.insertCategory(client, workspaceId, catalogId, { name: newCategory }, userId)).id;
              made.categories.set(categoryKey(newCategory), category);
              categories.set(categoryKey(newCategory), category);
              categoryNames.set(category, newCategory);
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
            if (nextSize) {
              // Version-checked against what the preview read: a size someone changed since isn't overwritten.
              const now = (await client.query<{ version: number }>(`SELECT version FROM catalog_item_dimensions WHERE workspace_id = $1 AND item_id = $2 FOR UPDATE`, [workspaceId, itemId])).rows[0];
              if ((now?.version ?? 0) !== (currentSize?.version ?? 0)) throw new ConflictException("The item's size changed since the preview. Review it again.");
              await client.query(
                `INSERT INTO catalog_item_dimensions (workspace_id, item_id, width, depth, height, unit, source, updated_by) VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6, 'import', $7)
                 ON CONFLICT (workspace_id, item_id) DO UPDATE SET width = EXCLUDED.width, depth = EXCLUDED.depth, height = EXCLUDED.height, unit = EXCLUDED.unit,
                   source = 'import', clip_id = NULL, updated_by = EXCLUDED.updated_by, updated_at = now(), version = catalog_item_dimensions.version + 1`,
                [workspaceId, itemId, nextSize.width, nextSize.depth, nextSize.height, nextSize.unit, userId]);
              await recordAudit(client, { workspaceId, actorUserId: userId, action: "catalog.item_size_saved.v1", entityType: "catalog_item", entityId: itemId!,
                before: currentSize ? { width: currentSize.width, depth: currentSize.depth, height: currentSize.height, unit: currentSize.unit } : null, after: { ...nextSize, source: "import", linkId: link.id } });
            }
            if (pricing.kind !== "none") {
              made.book ??= (await catalogs.insertPriceBook(client, workspaceId, catalogId, { name: `${currency} prices`, currency: currency! }, userId)).id;
              // Approved prices are quoted only from a book in use.
              if (approved && !made.bookInUse) { await catalogs.activatePriceBook(client, workspaceId, made.book, userId, approval); made.bookInUse = true; }
              if (pricing.kind === "activate") await catalogs.approveDraftPrice(client, workspaceId, current!.id, userId, { status: current!.status }, approval);
              else await catalogs.draftPrice(client, workspaceId, made.book, itemId!, { method: "fixed", price: pricing.price, cost: pricing.cost }, userId, approved ? approval : undefined);
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
