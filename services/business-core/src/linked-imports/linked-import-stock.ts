import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import type { InventoryService } from "../inventory/inventory.service";
import { normalKey, stockItemFor } from "../inventory/stock";
import { processStockLevels } from "../inventory/stock-levels";
import { readLocations, type StockLocation } from "../purchasing/receiving";
import { recordKey, type Applied, type ImportContext, type Step, type TargetAdapter } from "./linked-import-run";
import { sameNumber, sheetNumber, SourceError, type SourceRow } from "./linked-import-source";

/** Every stock change a linked sheet makes carries this reason in the ledger. */
export const IMPORT_REASON = "Linked sheet import";

type Item = { id: string; name: string; unit: string; code: string; catalogItemId: string | null };
const lower = (text: string) => text.trim().toLocaleLowerCase();
const quantityText = (value: string) => Dec.of(value).toString();

/**
 * A stock list: each row is an item (by its code) and, when the sheet sets quantities, how much of it is
 * free stock at a place. A new code becomes a new stock item; a known one takes the sheet's name and unit.
 * A quantity is applied only when the sheet's number changed since the last import and differs from what
 * Wodana holds, as a count (an adjustment with the reason "Linked sheet import", or a correction waiting
 * for approval above the workspace's limit), so stock issued in Wodana isn't put back until the sheet changes.
 */
export function stockAdapter(inventory: InventoryService): TargetAdapter {
  return {
    async plan(context, rows) {
      const { client, workspaceId, link } = context;
      const items = (await client.query<Item>(
        `SELECT id, name, unit, code, catalog_item_id AS "catalogItemId" FROM stock_items WHERE workspace_id = $1`, [workspaceId])).rows;
      const byId = new Map(items.map((item) => [item.id, item]));
      const byCode = new Map<string, Item[]>();
      for (const item of items) if (item.code.trim()) byCode.set(lower(item.code), [...(byCode.get(lower(item.code)) ?? []), item]);
      const byName = new Map(items.filter((item) => !item.catalogItemId).map((item) => [normalKey(item.name, item.unit), item]));
      const places = (await readLocations(client, workspaceId)).filter((place) => place.kind !== "site");
      const home = places.find((place) => place.id === link.locationId);
      const free = new Map((await client.query<{ itemId: string; locationId: string; onHand: string }>(
        `SELECT item_id AS "itemId", location_id AS "locationId", on_hand::text AS "onHand" FROM stock_balances WHERE workspace_id = $1 AND project_id IS NULL`,
        [workspaceId])).rows.map((row) => [`${row.itemId}@${row.locationId}`, row.onHand]));
      const waiting = new Map((await client.query<{ itemId: string; locationId: string; counted: string }>(
        `SELECT item_id AS "itemId", location_id AS "locationId", counted::text AS counted FROM stock_adjustment_requests
          WHERE workspace_id = $1 AND status = 'pending' AND project_id IS NULL`, [workspaceId])).rows.map((row) => [`${row.itemId}@${row.locationId}`, row.counted]));
      const moved = async (itemId: string) => Boolean((await client.query(`SELECT 1 FROM stock_movements WHERE workspace_id = $1 AND item_id = $2 LIMIT 1`, [workspaceId, itemId])).rowCount);
      // New items made earlier in this run, by code, so a code on two rows (two places) is one item.
      const made = new Map<string, string>();
      const seen = new Set<string>();
      const steps: Step[] = [];

      const codeMapped = Object.values(link.mapping?.columns ?? {}).includes("code");
      for (const row of rows) {
        // Matched by the code; a row without one by its name, size and colour (the item's name in Wodana carries the size and colour).
        const key = row.key.trim();
        const code = (row.values.code ?? "").trim();
        const variant = [row.values.size, row.values.colour].map((part) => (part ?? "").trim()).filter(Boolean).join(", ");
        const written = (row.values.name ?? "").trim();
        const name = written && variant ? `${written} (${variant})` : written;
        const unit = (row.values.unit ?? "").trim();
        const base = { sheet: row.sheet, line: row.line, key, name: name || key, changes: [] as string[], message: "", recordKey: null as string | null, locationId: null as string | null };
        const fail = (message: string): Step => ({ ...base, outcome: "error", message });
        try {
          if (!key) { steps.push(fail(codeMapped ? "No item code or name." : "No item name.")); continue; }
          if (code.length > 80) { steps.push(fail("The code is longer than 80 characters.")); continue; }
          if (name.length > 240) { steps.push(fail("The name is longer than 240 characters.")); continue; }
          if (unit.length > 40) { steps.push(fail("The unit is longer than 40 characters.")); continue; }
          const place = placeFor(row, places, home);
          base.locationId = place.id;
          base.recordKey = recordKey(key, place.id);
          if (seen.has(base.recordKey)) { steps.push(fail(code ? `Code ${code} is on another row for ${place.name}.` : `${key} is on another row for ${place.name}.`)); continue; }
          seen.add(base.recordKey);
          const received = row.values.quantity === undefined ? null : sheetNumber(row.values.quantity, "Quantity", { places: 4, max: "99999999999999" });
          // A sheet that keeps what came in and what was used: what's left is on hand.
          const used = row.values.usedQuantity === undefined ? null : sheetNumber(row.values.usedQuantity, "Used quantity", { places: 4, max: "99999999999999" });
          if (used !== null && Dec.of(used).cmp(received ?? "0") > 0) { steps.push(fail(`${quantityText(used)} used is more than the ${quantityText(received ?? "0")} received.`)); continue; }
          const quantity = used === null ? received : Dec.of(received ?? "0").sub(used).toString();
          const cost = row.values.cost === undefined ? null : sheetNumber(row.values.cost, "Cost", { places: 4, max: "99999999999999" });

          const known = context.records.get(base.recordKey) ?? [...context.records.values()].find((record) => lower(record.key) === lower(key));
          let item = known ? byId.get(known.recordId) : undefined;
          if (!item && !code && name) item = byName.get(normalKey(name, unit));
          if (!item && code) {
            const matches = byCode.get(lower(code)) ?? [];
            if (matches.length > 1) { steps.push(fail(`${matches.length} stock items have code ${code}. Keep one code per item.`)); continue; }
            item = matches[0];
          }
          let adopt: Item | null = null;
          if (!item) {
            if (!name) { steps.push(fail("Name the item: it's new to Wodana.")); continue; }
            const same = byName.get(normalKey(name, unit));
            if (same?.code.trim() && code && lower(same.code) !== lower(code)) { steps.push(fail(`${name} is already item ${same.code}.`)); continue; }
            adopt = same ?? null;
          }
          const target = item ?? adopt;
          // A catalog item names its stock item; the sheet's name and unit apply to items of its own.
          const rename = Boolean(target && !target.catalogItemId && name && name !== target.name);
          const reunit = Boolean(target && !target.catalogItemId && unit && unit !== target.unit);
          if (reunit && (await moved(target!.id))) { steps.push(fail(`The unit is ${target!.unit || "not set"} in Wodana and this item has stock history. Change it there first.`)); continue; }
          const clash = target && (rename || reunit) ? byName.get(normalKey(rename ? name : target.name, reunit ? unit : target.unit)) : undefined;
          if (clash && clash.id !== target!.id) { steps.push(fail(`Another item is already called ${clash.name}${clash.unit ? ` (${clash.unit})` : ""}.`)); continue; }
          if (target?.catalogItemId && name && name !== target.name) base.message = "The catalog names this item.";
          if (rename) base.changes.push(`Name ${target!.name} → ${name}`);
          if (reunit) base.changes.push(`Unit ${target!.unit || "—"} → ${unit || "—"}`);
          if (adopt && code && lower(adopt.code) !== lower(code)) base.changes.push(`Code → ${code}`);

          // The quantity: only when the sheet's number moved since the last import and Wodana holds something else.
          let count: string | null = null;
          if (link.setsStock && quantity !== null) {
            const have = target ? free.get(`${target.id}@${place.id}`) ?? "0" : "0";
            const last = known && known.locationId === place.id ? known.lastQuantity : null;
            if ((last === null || !sameNumber(last, quantity)) && !sameNumber(have, quantity)) {
              const pending = target ? waiting.get(`${target.id}@${place.id}`) : undefined;
              if (pending !== undefined && sameNumber(pending, quantity)) base.message = "The count is waiting for approval.";
              else if (pending !== undefined) { steps.push(fail("A stock correction for this item is waiting for approval. Approve or refuse it first.")); continue; }
              else { count = quantity; base.changes.push(`${place.name}: ${quantityText(have)} → ${quantityText(quantity)}${unit || target?.unit ? ` ${unit || target?.unit}` : ""}`); }
            }
          }
          const keepQuantity = link.setsStock ? quantity : null;
          if (!target) {
            steps.push({ ...base, outcome: "added", apply: async () => {
              const earlier = made.get(lower(code || key));
              const itemId = earlier ?? await stockItemFor(client, workspaceId, { catalogItemId: null, name, unit, code });
              await client.query(`UPDATE stock_items SET code = $3 WHERE workspace_id = $1 AND id = $2 AND code = ''`, [workspaceId, itemId, code]);
              if (count !== null) await countTo(itemId, place, count, cost);
              // Kept only once the row is saved: a failed row is rolled back with the item it made.
              if (!earlier) made.set(lower(code || key), itemId);
              return { recordId: itemId, locationId: place.id, quantity: keepQuantity };
            } });
            continue;
          }
          if (!base.changes.length) { steps.push({ ...base, outcome: "unchanged", keep: { recordId: target.id, locationId: place.id, quantity: keepQuantity } }); continue; }
          steps.push({ ...base, outcome: "changed", apply: async () => {
            if (adopt || rename || reunit) {
              const nextName = rename ? name : target.name, nextUnit = reunit ? unit : target.unit;
              await client.query(`UPDATE stock_items SET name = $3, unit = $4, normal_key = $5, code = CASE WHEN $6::boolean THEN $7 ELSE code END WHERE workspace_id = $1 AND id = $2`,
                [workspaceId, target.id, nextName, nextUnit, normalKey(nextName, nextUnit), Boolean(adopt && code), code]);
              await recordAudit(client, { workspaceId, actorUserId: context.userId, action: "stock.item_changed", entityType: "stock_item", entityId: target.id,
                before: { name: target.name, unit: target.unit, code: target.code }, after: { name: nextName, unit: nextUnit, code: adopt && code ? code : target.code, reason: IMPORT_REASON } });
            }
            if (count !== null) await countTo(target.id, place, count, cost);
            return { recordId: target.id, locationId: place.id, quantity: keepQuantity };
          } });
        } catch (error) {
          if (error instanceof SourceError || error instanceof HttpException) steps.push(fail(error.message));
          else throw error;
        }
      }
      return steps;

      async function countTo(itemId: string, place: StockLocation, counted: string, cost: string | null) {
        const batchId = randomUUID();
        const movedOn = await inventory.todayIn(client, workspaceId);
        const result = await inventory.countWith(client, workspaceId, context.userId, {
          batchId, itemId, location: place, owner: null, counted, reason: IMPORT_REASON, movementReason: IMPORT_REASON, movedOn, unitCost: cost, costOut: true,
        });
        await recordAudit(client, { workspaceId, actorUserId: context.userId, action: "stock.count", entityType: "stock_item", entityId: itemId,
          after: { batchId, location: place.id, counted, was: result.was, difference: result.difference, owner: null, reason: IMPORT_REASON, pending: result.pending, linkId: link.id } });
      }
    },

    async names(context, recordIds) {
      if (!recordIds.length) return new Map();
      return new Map((await context.client.query<{ id: string; name: string }>(`SELECT id, name FROM stock_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
        [context.workspaceId, recordIds])).rows.map((row) => [row.id, row.name]));
    },

    async finish(context, applied: Applied[]) {
      // Free stock taken below its reorder point tells the people who keep and buy it, as any count does.
      const itemIds = [...new Set(applied.map((entry) => entry.recordId))];
      if (itemIds.length) await processStockLevels(context.client, context.workspaceId, itemIds);
    },
  };
}

function placeFor(row: SourceRow, places: StockLocation[], home: StockLocation | undefined) {
  const written = (row.values.location ?? "").trim();
  if (written) {
    const place = places.find((entry) => lower(entry.name) === lower(written));
    if (!place) throw new SourceError(`There's no place called ${written}. Add it under Inventory places, or fix the sheet.`);
    return place;
  }
  if (!home) throw new SourceError("The import's place is closed. Choose another place for it.");
  return home;
}
