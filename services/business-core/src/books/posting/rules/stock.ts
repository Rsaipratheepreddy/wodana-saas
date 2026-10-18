import { Dec } from "../../../catalog-core/decimal";
import { orderUnitPrice } from "../../../purchasing/payables";
import type { AccountRole } from "../../books-contract";
import type { Db, JournalDraft, PendingEvent, PostingIssueResult } from "../../ledger/ledger";
import {
  isIssue, issue, journalExists, Lines, localDay, pendingRows, projectCompany, role, type RuleAdapter, settingsFor, SINGLE_ENABLED, startOf, undo,
} from "../support";

/**
 * Deliveries and stock (P9 to P11).
 * - Services and outside work, once received and inspected: subcontract cost against goods received not invoiced,
 *   at the order line's net price (what the project's Money tab counts). A reversed delivery reverses it.
 * - Stock, one journal per movement batch at quantity × unit cost (the workspace currency): the owner's account
 *   (inventory for free stock, project materials for a project's stock) against the counterpart of the movement's
 *   kind. Allocations and releases pair within their batch; what the factory produces posts nothing (its materials
 *   were counted when issued). The same rule as project-money.ts `stockEffect`, so project cost reconciles.
 */

const source = (event: PendingEvent) => ({ type: event.sourceType, id: event.sourceId, event: event.sourceEvent, label: event.label, href: event.href });

/** Delivery lines bought as a service: a scope line whose package is subcontracted or site work, or outside work on a work order. */
const SERVICE_FROM = `FROM goods_receipt_lines got
  JOIN purchase_order_lines ordered ON ordered.workspace_id = got.workspace_id AND ordered.id = got.order_line_id
  LEFT JOIN project_boq_lines scope ON scope.workspace_id = ordered.workspace_id AND scope.id = ordered.boq_line_id
  LEFT JOIN project_packages bought ON bought.workspace_id = scope.workspace_id AND bought.id = scope.package_id
 WHERE (bought.supply IN ('subcontract', 'site_work') OR ordered.work_order_id IS NOT NULL)`;
const SERVICE_LINES = `${SERVICE_FROM} AND got.workspace_id = receipt.workspace_id AND got.receipt_id = receipt.id`;
const RECEIPT_LABEL = `purchase.number || ' · ' || receipt.number::text`;
const RECEIPT_HREF = `'/workspace/purchasing/deliveries?receipt=' || receipt.id::text`;

/** P9: what a delivery of services and outside work cost. */
async function serviceDraft(db: Db, workspaceId: string, receiptId: string, source?: JournalDraft["source"]): Promise<JournalDraft | PostingIssueResult> {
  const receipt = (await db.query<{ id: string; entityId: string; receivedOn: string; currency: string; label: string }>(
    `SELECT receipt.id, purchase.legal_entity_id AS "entityId", receipt.received_on::text AS "receivedOn", btrim(purchase.currency) AS currency, ${RECEIPT_LABEL} AS label
       FROM goods_receipts receipt JOIN purchase_orders purchase ON purchase.workspace_id = receipt.workspace_id AND purchase.id = receipt.order_id
      WHERE receipt.workspace_id = $1 AND receipt.id = $2`, [workspaceId, receiptId])).rows[0];
  if (!receipt) return issue("no_entity", "The delivery is no longer there.");
  const settings = await settingsFor(db, workspaceId, receipt.entityId);
  if (isIssue(settings)) return settings;
  const items = (await db.query<{ description: string; accepted: string; unitPrice: string; discountPercent: string; projectId: string | null }>(
    `SELECT ordered.description, got.accepted::text AS accepted, ordered.unit_price::text AS "unitPrice", ordered.discount_percent::text AS "discountPercent",
            ordered.project_id AS "projectId"
       ${SERVICE_FROM} AND got.accepted > 0 AND got.workspace_id = $1 AND got.receipt_id = $2 ORDER BY ordered.position, got.id`,
    [workspaceId, receiptId])).rows;
  const lines = new Lines(receipt.currency);
  for (const item of items) {
    const amount = Dec.of(item.accepted).mul(orderUnitPrice(item)).round(lines.places);
    const detail = { projectId: item.projectId, description: `${item.description} ${Dec.of(item.accepted).toString()}` };
    lines.debit(role("cost_subcontract"), amount, detail).credit(role("grni"), amount, detail);
  }
  if (lines.lines.length < 2) return issue("no_cost", "Nothing on this delivery has a price.");
  return {
    legalEntityId: settings.legalEntityId, eventDate: receipt.receivedOn, currency: receipt.currency, description: receipt.label, lines: lines.lines,
    source: source ?? { type: "goods_receipt", id: receipt.id, event: "received", label: receipt.label, href: `/workspace/purchasing/deliveries?receipt=${receipt.id}` },
  };
}

/** P9 services and outside work received (once nothing on the delivery waits for inspection). */
export const servicesReceived: RuleAdapter = {
  rule: "P9",
  sourceType: "goods_receipt",
  pending: (db, workspaceId, _settings, limit) => pendingRows(db, workspaceId, "goods_receipt", limit,
    `SELECT receipt.id::text AS source_id, 'received' AS source_event, purchase.legal_entity_id AS entity_id, receipt.received_on AS event_date, receipt.created_at AS at,
            ${RECEIPT_LABEL} AS label, ${RECEIPT_HREF} AS href
       FROM goods_receipts receipt JOIN purchase_orders purchase ON purchase.workspace_id = receipt.workspace_id AND purchase.id = receipt.order_id
      WHERE receipt.workspace_id = $1 AND EXISTS (SELECT 1 ${SERVICE_LINES} AND got.accepted > 0)
        AND NOT EXISTS (SELECT 1 ${SERVICE_LINES} AND got.pending > 0)`),
  build: (db, workspaceId, event) => serviceDraft(db, workspaceId, event.sourceId, source(event)),
};

/** P10 delivery reversed. */
export const deliveryReversed: RuleAdapter = {
  rule: "P10",
  sourceType: "goods_receipt",
  pending: (db, workspaceId, _settings, limit) => pendingRows(db, workspaceId, "goods_receipt", limit,
    `SELECT receipt.id::text AS source_id, 'reversed' AS source_event, purchase.legal_entity_id AS entity_id, ${localDay("receipt.reversed_at")} AS event_date,
            receipt.reversed_at AS at, ${RECEIPT_LABEL} AS label, ${RECEIPT_HREF} AS href
       FROM goods_receipts receipt JOIN purchase_orders purchase ON purchase.workspace_id = receipt.workspace_id AND purchase.id = receipt.order_id
      WHERE receipt.workspace_id = $1 AND receipt.reversed_at IS NOT NULL
        AND (${journalExists("goods_receipt", "receipt.id::text", "received")} OR receipt.received_on < ${startOf("purchase.legal_entity_id")})`),
  build: (db, workspaceId, event) => undo(db, workspaceId, { type: "goods_receipt", id: event.sourceId, event: "received" },
    { eventDate: event.eventDate, source: source(event) }, () => serviceDraft(db, workspaceId, event.sourceId)),
};

/** The account a movement's counterpart posts to by kind (null: paired within the batch, or nothing). */
const COUNTERPART: Record<string, AccountRole | "consumer" | null> = {
  receive: "grni", supplier_return: "grni", reverse: "grni",
  issue: "consumer", return: "consumer",
  transfer_out: "stock_in_transit", transfer_in: "stock_in_transit",
  allocate: null, release: null,
  adjust: "stock_adjustments",
  sale: "cogs_goods", sale_return: "cogs_goods",
  produce: null,
};

const KIND_WORDS = `CASE first.kind WHEN 'receive' THEN 'Stock received' WHEN 'issue' THEN 'Stock issued' WHEN 'return' THEN 'Stock returned'
  WHEN 'transfer_out' THEN 'Stock moved out' WHEN 'transfer_in' THEN 'Stock moved in' WHEN 'allocate' THEN 'Stock allocated' WHEN 'release' THEN 'Stock released'
  WHEN 'adjust' THEN 'Stock corrected' WHEN 'supplier_return' THEN 'Stock sent back' WHEN 'reverse' THEN 'Delivery reversed' WHEN 'sale' THEN 'Stock sold'
  WHEN 'sale_return' THEN 'Sale returned' ELSE 'Stock' END`;

/** P11 stock movements, one journal per batch. */
export const stockMoved: RuleAdapter = {
  rule: "P11",
  sourceType: "stock_batch",
  pending: (db, workspaceId, _settings, limit) => pendingRows(db, workspaceId, "stock_batch", limit,
    `WITH batches AS (
       SELECT coalesce(movement.batch_id, movement.id) AS batch, min(movement.moved_on) AS moved_on, min(movement.created_at) AS at,
              (array_agg(purchase.legal_entity_id) FILTER (WHERE purchase.legal_entity_id IS NOT NULL))[1] AS order_entity,
              (array_agg(coalesce(movement.for_project_id, movement.project_id) ORDER BY movement.seq)
                 FILTER (WHERE coalesce(movement.for_project_id, movement.project_id) IS NOT NULL))[1] AS project_id,
              min(movement.seq) AS first_seq
         FROM stock_movements movement
         LEFT JOIN goods_receipt_lines got ON got.workspace_id = movement.workspace_id AND got.id = movement.receipt_line_id
         LEFT JOIN purchase_order_lines ordered ON ordered.workspace_id = got.workspace_id AND ordered.id = got.order_line_id
         LEFT JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
        WHERE movement.workspace_id = $1 AND movement.moved_on >= (SELECT min(start_date) FROM enabled)
          AND NOT ${journalExists("stock_batch", "coalesce(movement.batch_id, movement.id)::text", "moved")}
        GROUP BY coalesce(movement.batch_id, movement.id)
       HAVING bool_or(movement.kind <> 'produce' AND (movement.unit_cost IS NULL OR movement.unit_cost <> 0)))
     SELECT batches.batch::text AS source_id, 'moved' AS source_event,
            coalesce(batches.order_entity, ${projectCompany("batches.project_id")}, ${SINGLE_ENABLED}) AS entity_id,
            batches.moved_on AS event_date, batches.at, ${KIND_WORDS} || ': ' || item.name AS label,
            CASE WHEN batches.project_id IS NOT NULL THEN '/workspace/projects/' || batches.project_id::text || '/money' ELSE '/workspace/inventory' END AS href
       FROM batches
       JOIN stock_movements first ON first.workspace_id = $1 AND first.seq = batches.first_seq
       JOIN stock_items item ON item.workspace_id = first.workspace_id AND item.id = first.item_id`),
  build: async (db, workspaceId, event) => {
    const settings = await settingsFor(db, workspaceId, event.legalEntityId);
    if (isIssue(settings)) return settings;
    const moves = (await db.query<{ kind: string; projectId: string | null; forProjectId: string | null; quantity: string; unitCost: string | null; currency: string | null;
      item: string; unit: string }>(
      `SELECT movement.kind, movement.project_id AS "projectId", movement.for_project_id AS "forProjectId", movement.quantity::text AS quantity,
              movement.unit_cost::text AS "unitCost", btrim(movement.currency) AS currency, item.name AS item, item.unit
         FROM stock_movements movement JOIN stock_items item ON item.workspace_id = movement.workspace_id AND item.id = movement.item_id
        WHERE movement.workspace_id = $1 AND coalesce(movement.batch_id, movement.id) = $2::uuid ORDER BY movement.seq`, [workspaceId, event.sourceId])).rows;
    const currency = settings.functionalCurrency;
    const lines = new Lines(currency);
    for (const move of moves) {
      if (move.kind === "produce") continue;
      if (move.unitCost === null) return issue("no_cost", `${move.item} has no cost yet: record its cost on the stock item or the order.`);
      if (move.currency !== currency) return issue("currency_mismatch", `Stock is valued in ${move.currency}; this company keeps its books in ${currency}.`);
      const value = Dec.of(move.quantity).mul(move.unitCost).round(lines.places);
      const description = `${move.item} ${Dec.of(move.quantity).toString()} ${move.unit}`.trim();
      lines.debit(role(move.projectId ? "cost_materials" : "inventory"), value, { projectId: move.projectId, description });
      const counterpart = COUNTERPART[move.kind];
      if (counterpart === "consumer") lines.credit(role("cost_materials"), value, { projectId: move.forProjectId, description });
      else if (counterpart) lines.credit(role(counterpart), value, { projectId: counterpart === "grni" ? move.projectId : null, description });
    }
    // Allocations pair within their batch; whatever doesn't (a different cost on each side) is a stock adjustment.
    lines.credit(role("stock_adjustments"), lines.balance(), { description: "Unpaired in the batch" });
    if (lines.lines.length < 2) return issue("no_cost", "Nothing in this stock movement has a value.");
    return { legalEntityId: settings.legalEntityId, eventDate: event.eventDate, currency, description: event.label, lines: lines.lines, source: source(event) };
  },
};
