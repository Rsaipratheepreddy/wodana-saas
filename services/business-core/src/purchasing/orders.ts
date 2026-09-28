import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { clientChoicesSignedOff } from "../project-core/project-materials";

type Db = Pick<PoolClient, "query">;

export const ORDER_STATUSES = ["draft", "pending_approval", "approved", "sent", "confirmed", "partly_received", "received", "closed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const DELIVER_TO = ["site", "factory", "warehouse", "pickup", "other"] as const;
/** Orders that count as placed: approved or further. Drafts and orders waiting for approval are "in draft". */
export const PLACED: OrderStatus[] = ["approved", "sent", "confirmed", "partly_received", "received", "closed"];

/** Minor units of a currency (AED 2, JPY 0, KWD 3). */
export function currencyDecimals(currency: string) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
}

/**
 * A line's amounts, exactly: net = quantity × price less the discount, tax on the net, each rounded to
 * the currency's minor units (half away from zero); the total is net + tax, so lines always add up.
 */
export function priceLine(input: { quantity: string; unitPrice: string; discountPercent: string; taxRate: string }, decimals: number) {
  const gross = Dec.of(input.quantity).mul(input.unitPrice);
  const net = gross.mul(Dec.of(100).sub(input.discountPercent)).div(100).round(decimals);
  const discount = gross.round(decimals).sub(net);
  const tax = net.mul(input.taxRate).div(100).round(decimals);
  return { gross: gross.round(decimals).toFixed(decimals), discount: discount.toFixed(decimals), net: net.toFixed(decimals), tax: tax.toFixed(decimals), total: net.add(tax).toFixed(decimals) };
}

/** The order's totals from its lines' own rounded amounts. */
export function orderTotals(lines: Array<ReturnType<typeof priceLine>>, decimals: number) {
  const sum = (key: "gross" | "discount" | "net" | "tax" | "total") => lines.reduce((total, line) => total.add(line[key]), Dec.ZERO).toFixed(decimals);
  return { subtotal: sum("gross"), discountTotal: sum("discount"), net: sum("net"), taxTotal: sum("tax"), total: sum("total") };
}

export type Need = {
  key: string; source: "material" | "line"; sourceId: string; projectId: string; projectReference: string; projectName: string;
  title: string; detail: string; unit: string; required: string | null; placed: string; drafted: string; received: string; remaining: string | null;
  catalogItemId: string | null; supplierHint: string; packageName: string | null; supply: string | null;
  /** A material the client chooses (it waits for their sign-off); scope lines never do. */
  clientChoice: boolean;
  /** Why it can't be ordered yet, if it can't. */
  blocked: "material_signoff" | null;
  /**
   * When it must be there: the earliest start of open work in its package that needs the materials (for
   * a material used nowhere in particular, the project's earliest). Ordered its lead time before that:
   * the supplier's when the catalog knows it, else the workspace's.
   */
  neededBy: string | null; leadDays: number; orderBy: string | null;
  /** Given from free stock: reserved for the project or issued to it, less what went back. It counts before orders. */
  fromStock: string;
  /** The packages whose work uses it (none: used anywhere in the project). */
  packageIds: string[];
  /** For a material, the scope lines it's bought for (those lines aren't listed on their own). */
  scopeLines: string[];
  /** The project is running, or on hold (nothing is ordered for it without the buyer saying why). */
  projectStatus: "active" | "on_hold";
  /** The latest variation that reduced or removed what it's for (VO-2), when there was one. */
  changedBy: string | null;
};

/** When each order line's goods are needed on its project, from the plan (lines with no date are left out). */
export async function linesNeededBy(db: Db, workspaceId: string, lines: Array<{ id: string; projectId: string | null; materialItemId: string | null; boqLineId: string | null }>) {
  const dates: Record<string, string> = {};
  for (const projectId of new Set(lines.map((line) => line.projectId).filter((id): id is string => Boolean(id)))) {
    const needs = new Map((await readNeeds(db, workspaceId, false, projectId)).map((need) => [need.key, need.neededBy]));
    for (const line of lines.filter((item) => item.projectId === projectId)) {
      const date = line.materialItemId ? needs.get(`material:${line.materialItemId}`) : line.boqLineId ? needs.get(`line:${line.boqLineId}`) : null;
      if (date) dates[line.id] = date;
    }
  }
  return dates;
}

/**
 * What projects still need to order, across every running project: the materials on each material list
 * and the scope lines of packages that are bought (ready-made, bought materials) or subcontracted. For
 * each, how much is needed, how much is on placed orders and in draft, and what's left.
 */
export async function readNeeds(db: Db, workspaceId: string, requireSignoff: boolean, projectId: string | null = null): Promise<Need[]> {
  const rows = (await db.query<Omit<Need, "blocked" | "remaining" | "orderBy" | "fromStock"> & { remaining: string | null }>(
    `WITH projects AS (
       SELECT project.id, project.reference, project.name, project.status FROM delivery_projects project
        WHERE project.workspace_id = $1 AND project.started_at IS NOT NULL AND project.status IN ('active', 'on_hold') AND ($2::uuid IS NULL OR project.id = $2)
     ), accepted AS (
       -- What each order line has: accepted (less what went back after acceptance) and what the supplier credited instead of sending.
       SELECT line.id AS order_line_id,
              coalesce((SELECT sum(received.accepted) FROM goods_receipt_lines received JOIN goods_receipts receipt ON receipt.workspace_id = received.workspace_id AND receipt.id = received.receipt_id
                         WHERE received.workspace_id = line.workspace_id AND received.order_line_id = line.id AND receipt.reversed_at IS NULL), 0)
            - coalesce((SELECT sum(back.quantity) FROM supplier_return_lines back JOIN supplier_returns sent ON sent.workspace_id = back.workspace_id AND sent.id = back.return_id
                         WHERE back.workspace_id = line.workspace_id AND back.order_line_id = line.id AND back.source = 'accepted' AND sent.status = 'sent'), 0) AS accepted,
              coalesce((SELECT sum(back.quantity) FROM supplier_return_lines back JOIN supplier_returns sent ON sent.workspace_id = back.workspace_id AND sent.id = back.return_id
                         WHERE back.workspace_id = line.workspace_id AND back.order_line_id = line.id AND sent.outcome = 'credit'
                           AND (sent.status = 'sent' OR (sent.status = 'open' AND back.source = 'rejected'))), 0) AS credited
         FROM purchase_order_lines line WHERE line.workspace_id = $1
     ), ordered AS (
       -- A closed (short-closed) order counts only what was accepted, and credited goods won't come: the rest goes back to be ordered.
       SELECT line.material_item_id, line.boq_line_id,
              sum(CASE WHEN purchase.status = 'closed' THEN coalesce(accepted.accepted, 0) ELSE line.quantity - coalesce(accepted.credited, 0) - line.cancelled_quantity END)
                FILTER (WHERE purchase.status IN ('approved', 'sent', 'confirmed', 'partly_received', 'received', 'closed')) AS placed,
              sum(line.quantity) FILTER (WHERE purchase.status IN ('draft', 'pending_approval')) AS drafted,
              sum(coalesce(accepted.accepted, 0)) AS received
         FROM purchase_order_lines line JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
         LEFT JOIN accepted ON accepted.order_line_id = line.id
        WHERE line.workspace_id = $1 AND purchase.status <> 'cancelled' AND line.source IN ('material', 'line')
        GROUP BY line.material_item_id, line.boq_line_id
     ), needed AS (
       -- The earliest open work that needs the materials, per package and per project.
       SELECT work.project_id, work.package_id, GROUPING(work.package_id) = 1 AS whole, min(coalesce(work.start_date, work.due_date)) AS needed_by
         FROM work_items work JOIN projects ON projects.id = work.project_id
        WHERE work.workspace_id = $1 AND work.needs_materials AND work.status NOT IN ('done', 'cancelled') AND coalesce(work.start_date, work.due_date) IS NOT NULL
        GROUP BY GROUPING SETS ((work.project_id, work.package_id), (work.project_id))
     ), needs AS (
       SELECT 'material:' || item.id AS key, 'material' AS source, item.id AS "sourceId", projects.id AS "projectId", projects.reference AS "projectReference", projects.name AS "projectName",
              item.name AS title, concat_ws(' · ', nullif(item.code, ''), nullif(item.specification, '')) AS detail, item.unit, item.quantity AS required,
              item.catalog_item_id AS "catalogItemId", item.supplier AS "supplierHint", NULL::text AS "packageName", NULL::text AS supply, item.position AS sort,
              item.client_choice AS "clientChoice",
              ARRAY(SELECT DISTINCT line.package_id FROM project_boq_lines line WHERE line.workspace_id = item.workspace_id AND line.id = ANY(item.boq_line_ids) AND line.package_id IS NOT NULL) AS "packageIds",
              ARRAY(SELECT line.title FROM project_boq_lines line WHERE line.workspace_id = item.workspace_id AND line.id = ANY(item.boq_line_ids) AND line.status = 'active' ORDER BY line.position) AS "scopeLines",
              coalesce((SELECT min(needed.needed_by) FROM project_boq_lines line JOIN needed ON NOT needed.whole AND needed.package_id = line.package_id
                         WHERE line.workspace_id = item.workspace_id AND line.id = ANY(item.boq_line_ids)),
                       (SELECT needed.needed_by FROM needed WHERE needed.project_id = item.project_id AND needed.whole
                           AND NOT EXISTS (SELECT 1 FROM project_boq_lines line WHERE line.workspace_id = item.workspace_id AND line.id = ANY(item.boq_line_ids) AND line.package_id IS NOT NULL))) AS "neededBy"
         FROM project_material_items item JOIN projects ON projects.id = item.project_id
        WHERE item.workspace_id = $1
       UNION ALL
       SELECT 'line:' || line.id, 'line', line.id, projects.id, projects.reference, projects.name, line.title, line.description, line.unit, line.quantity,
              line.catalog_item_id, '', package.name, package.supply, 100000 + line.position, false, ARRAY[package.id], ARRAY[]::text[],
              (SELECT needed.needed_by FROM needed WHERE NOT needed.whole AND needed.package_id = package.id)
         FROM project_boq_lines line JOIN projects ON projects.id = line.project_id
         JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = line.package_id
        WHERE line.workspace_id = $1 AND line.status = 'active' AND package.supply IN ('buy', 'ready_made', 'subcontract')
          -- One line per thing to buy: a scope line whose materials are on the material list is bought through those materials.
          AND NOT EXISTS (SELECT 1 FROM project_material_items item WHERE item.workspace_id = line.workspace_id AND item.project_id = line.project_id AND line.id = ANY(item.boq_line_ids))
     )
     SELECT needs.key, needs.source, needs."sourceId", needs."projectId", needs."projectReference", needs."projectName", needs.title, needs.detail, needs.unit,
            needs.required::text AS required, coalesce(ordered.placed, 0)::text AS placed, coalesce(ordered.drafted, 0)::text AS drafted, coalesce(ordered.received, 0)::text AS received,
            (needs.required - coalesce(ordered.placed, 0) - coalesce(ordered.drafted, 0))::text AS remaining,
            needs."catalogItemId", needs."supplierHint", needs."packageName", needs.supply, needs."clientChoice", needs."neededBy"::text AS "neededBy", needs."packageIds", needs."scopeLines",
            (SELECT status FROM projects WHERE projects.id = needs."projectId") AS "projectStatus",
            -- The latest variation that reduced or removed the scope it's bought for.
            (SELECT change.detail->>'variation' FROM project_boq_events change
              WHERE change.workspace_id = $1 AND change.kind IN ('reduced', 'omitted') AND change.detail ? 'variation'
                AND (change.line_id = needs."sourceId" OR (needs.source = 'material' AND change.line_id = ANY(
                     SELECT unnest(item.boq_line_ids) FROM project_material_items item WHERE item.workspace_id = $1 AND item.id = needs."sourceId")))
              ORDER BY change.at DESC LIMIT 1) AS "changedBy",
            -- The supplier's lead time when the catalog knows it (the preferred supplier's, else the longest), else the workspace's.
            coalesce((SELECT link.lead_time_days FROM catalog_supplier_links link WHERE link.workspace_id = $1 AND link.item_id = needs."catalogItemId" AND link.lead_time_days IS NOT NULL
                       ORDER BY link.preferred DESC, link.lead_time_days DESC LIMIT 1),
                     (SELECT settings.order_ahead_days FROM workspace_purchasing_settings settings WHERE settings.workspace_id = $1), 14) AS "leadDays"
       FROM needs LEFT JOIN ordered ON (needs.source = 'material' AND ordered.material_item_id = needs."sourceId") OR (needs.source = 'line' AND ordered.boq_line_id = needs."sourceId")
      ORDER BY needs."projectReference", needs.sort`, [workspaceId, projectId])).rows;
  // Only materials the client chooses wait for their sign-off; bought scope lines were agreed in the quotation.
  const signed = new Map<string, boolean>();
  if (requireSignoff) for (const projectId of new Set(rows.filter((row) => row.clientChoice).map((row) => row.projectId))) signed.set(projectId, await clientChoicesSignedOff(db, workspaceId, projectId));
  const fromStock = await givenFromStock(db, workspaceId, rows);
  const orderBy = (neededBy: string | null, days: number) => (neededBy ? new Date(Date.parse(`${neededBy}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10) : null);
  return rows.map((row) => {
    const stock = fromStock.get(row.key) ?? Dec.ZERO;
    return { ...row, fromStock: stock.toString(), remaining: row.remaining === null ? null : Dec.of(row.remaining).sub(stock).toFixed(4), orderBy: orderBy(row.neededBy, row.leadDays),
      blocked: requireSignoff && row.clientChoice && !signed.get(row.projectId) ? "material_signoff" as const : null };
  });
}

/**
 * The needs a package's work is still waiting for: not in yet (received on orders or given from stock,
 * short of what's needed). A need used nowhere in particular counts for every package.
 */
export function needsNotIn(needs: Need[], packageId: string | null) {
  return needs.filter((need) => need.required !== null && Dec.of(need.received).add(need.fromStock).cmp(need.required) < 0
    && (!packageId || !need.packageIds.length || need.packageIds.includes(packageId)));
}

/**
 * What free stock has given each need: reserved for its project (less released) or issued to it straight
 * from free stock (less what came back). Stock matches a need by its catalog item in the same unit, else
 * by name and unit; when two needs match the same stock, the first in the list takes what it needs first.
 */
async function givenFromStock(db: Db, workspaceId: string, needs: Array<{ key: string; projectId: string; title: string; unit: string; required: string | null; catalogItemId: string | null }>) {
  const given = new Map<string, Dec>();
  const projects = [...new Set(needs.map((need) => need.projectId))];
  if (!projects.length) return given;
  const supplies = (await db.query<{ projectId: string; catalogItemId: string | null; normalKey: string; unit: string; quantity: string }>(
    `SELECT coalesce(movement.project_id, movement.for_project_id) AS "projectId", item.catalog_item_id AS "catalogItemId", item.normal_key AS "normalKey", item.unit,
            sum(CASE WHEN movement.kind IN ('allocate', 'release') THEN movement.quantity ELSE -movement.quantity END)::text AS quantity
       FROM stock_movements movement JOIN stock_items item ON item.workspace_id = movement.workspace_id AND item.id = movement.item_id
      WHERE movement.workspace_id = $1
        AND ((movement.kind IN ('allocate', 'release') AND movement.project_id = ANY($2::uuid[]))
          OR (movement.kind IN ('issue', 'return') AND movement.project_id IS NULL AND movement.for_project_id = ANY($2::uuid[])))
      GROUP BY 1, item.id, item.catalog_item_id, item.normal_key, item.unit`, [workspaceId, projects])).rows;
  const key = (name: string, unit: string) => `${name.trim().toLocaleLowerCase().replace(/\s+/g, " ")}|${unit.trim().toLocaleLowerCase()}`.slice(0, 300);
  for (const supply of supplies) {
    let left = Dec.of(supply.quantity);
    for (const need of needs) {
      if (left.cmp(0) <= 0) break;
      if (need.projectId !== supply.projectId || need.required === null) continue;
      const sameUnit = !need.unit.trim() || need.unit.trim().toLocaleLowerCase() === supply.unit.trim().toLocaleLowerCase();
      if (!((need.catalogItemId && need.catalogItemId === supply.catalogItemId && sameUnit) || key(need.title, need.unit) === supply.normalKey)) continue;
      const already = given.get(need.key) ?? Dec.ZERO;
      const take = Dec.of(need.required).sub(already);
      if (take.cmp(0) <= 0) continue;
      const share = take.cmp(left) < 0 ? take : left;
      given.set(need.key, already.add(share));
      left = left.sub(share);
    }
  }
  return given;
}

export type OrderRow = {
  id: string; number: string; status: OrderStatus; vendorId: string; supplierName: string; legalEntityId: string; companyCode: string; currency: string;
  total: string; expectedDate: string | null; promisedDate: string | null; createdAt: string; createdByName: string;
  /** The projects its lines are for, and whether each is running or on hold. */
  projects: Array<{ id: string; reference: string; status: string }>; lines: number;
  revision: number; version: number; createdBy: string; submittedBy: string | null;
  /**
   * What's still to come, as the order counts it (ordered less cancelled, credited, accepted and waiting for
   * inspection): how many lines, and when the first of them is due (its promise, else the order's promise,
   * else when it's needed). Deliveries waiting for someone to inspect them.
   */
  linesLeft: number; due: string | null; inspecting: boolean;
  /** The latest shipment the buyer is following, if any. */
  shipment: { status: ShipmentStatus; eta: string | null; carrier: string } | null;
};

export const SHIPMENT_STATUSES = ["booked", "in_transit", "delayed", "arrived", "cancelled"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** What each line of an order (aliased `line`) has received, rejected, has waiting and was credited, as the order counts it. */
export const LINE_RECEIVED = `
  LEFT JOIN LATERAL (SELECT sum(got.accepted) AS accepted, sum(got.rejected) AS rejected, sum(got.pending) AS pending
                       FROM goods_receipt_lines got JOIN goods_receipts receipt ON receipt.workspace_id = got.workspace_id AND receipt.id = got.receipt_id
                      WHERE got.workspace_id = line.workspace_id AND got.order_line_id = line.id AND receipt.reversed_at IS NULL) received ON true
  LEFT JOIN LATERAL (SELECT sum(item.quantity) FILTER (WHERE item.source = 'accepted' AND sent.status = 'sent') AS "returnedAccepted",
                            sum(item.quantity) FILTER (WHERE sent.status = 'sent') AS returned,
                            sum(item.quantity) FILTER (WHERE sent.outcome = 'credit' AND (sent.status = 'sent' OR (sent.status = 'open' AND item.source = 'rejected'))) AS credited
                       FROM supplier_return_lines item JOIN supplier_returns sent ON sent.workspace_id = item.workspace_id AND sent.id = item.return_id
                      WHERE item.workspace_id = line.workspace_id AND item.order_line_id = line.id) back ON true`;

const ORDER_SELECT = `SELECT purchase.id, purchase.number, purchase.status, purchase.vendor_id AS "vendorId", vendor.display_name AS "supplierName", purchase.legal_entity_id AS "legalEntityId",
  entity.code AS "companyCode", purchase.currency, purchase.total::text AS total, purchase.expected_date::text AS "expectedDate", purchase.promised_date::text AS "promisedDate",
  purchase.created_at AS "createdAt", creator.display_name AS "createdByName", purchase.revision, purchase.version, purchase.created_by AS "createdBy", purchase.submitted_by AS "submittedBy",
  coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('id', project.id, 'reference', project.reference, 'status', project.status)) FROM purchase_order_lines line
             JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
            WHERE line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id), '[]'::jsonb) AS projects,
  (SELECT count(*)::int FROM purchase_order_lines line WHERE line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id) AS lines,
  coalesce(progress."linesLeft", 0) AS "linesLeft", progress.due::text AS due, coalesce(progress.inspecting, false) AS inspecting,
  CASE WHEN shipment.status IS NULL THEN NULL ELSE jsonb_build_object('status', shipment.status, 'eta', shipment.eta::text, 'carrier', shipment.carrier) END AS shipment
  FROM purchase_orders purchase
  JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
  JOIN legal_entities entity ON entity.workspace_id = purchase.workspace_id AND entity.id = purchase.legal_entity_id
  JOIN users creator ON creator.id = purchase.created_by
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE owed.left > 0)::int AS "linesLeft", min(owed.due) FILTER (WHERE owed.left > 0) AS due, bool_or(owed.pending > 0) AS inspecting
      FROM (SELECT line.quantity - line.cancelled_quantity - coalesce(back.credited, 0) - (coalesce(received.accepted, 0) - coalesce(back."returnedAccepted", 0)) - coalesce(received.pending, 0) AS left,
                   coalesce(line.promised_date, purchase.promised_date, purchase.expected_date) AS due, coalesce(received.pending, 0) AS pending
              FROM purchase_order_lines line ${LINE_RECEIVED}
             WHERE line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id) owed) progress ON true
  LEFT JOIN LATERAL (SELECT tracked.status, tracked.eta, tracked.carrier FROM purchase_order_shipments tracked
                      WHERE tracked.workspace_id = purchase.workspace_id AND tracked.order_id = purchase.id AND tracked.status <> 'cancelled'
                      ORDER BY tracked.updated_at DESC, tracked.id LIMIT 1) shipment ON true`;

export async function readOrders(db: Db, workspaceId: string): Promise<OrderRow[]> {
  return (await db.query<OrderRow>(`${ORDER_SELECT} WHERE purchase.workspace_id = $1 ORDER BY purchase.created_at DESC LIMIT 1000`, [workspaceId])).rows;
}

export type OrderLine = {
  id: string; position: number; projectId: string | null; projectReference: string | null; source: "material" | "line" | "free"; materialItemId: string | null; boqLineId: string | null;
  description: string; specification: string; quantity: string; unit: string; unitPrice: string; discountPercent: string; taxRate: string; net: string; tax: string; total: string;
  /** What has arrived for the line: accepted (less what went back after acceptance), rejected and still waiting for inspection. */
  accepted: string; rejected: string; pending: string;
  /**
   * Credited by the supplier instead of sent again (rejected goods from when the return is raised,
   * accepted goods once they've gone back), and what went back to the supplier.
   */
  credited: string; returned: string;
  /** What the supplier confirmed for the line, and by when. */
  promisedDate: string | null; confirmedQuantity: string | null;
  /** When the line is due: its own promise, else the order's promise, else when it's needed. */
  due: string | null;
  /** The rest of the line that won't come (with why), and the line on another order this one replaces. */
  cancelled: string; cancelReason: string | null; replacesLineId: string | null; replacesOrderNumber: string | null;
  /** The supplier's alternative for the line, if they offered one, and what was ordered first once one was taken. */
  alternateStatus: "offered" | "accepted" | "rejected" | null; alternateDescription: string | null; alternateSpecification: string; alternateUnitPrice: string | null;
  alternateNote: string; alternateOfferedBy: string | null; originalDescription: string | null; originalSpecification: string | null;
  /** The stock item a restock line refills (free lines for no project only). */
  stockItemId: string | null;
};

export type OrderDetail = OrderRow & {
  paymentTerms: string; advancePercent: string | null; creditDays: number | null; termsNote: string;
  /** The share of each invoice held back until the project's handover (the supplier's by default). */
  retentionPercent: string; deliverTo: string; deliveryAddress: string; supplierReference: string; notes: string;
  subtotal: string; discountTotal: string; taxTotal: string; createdBy: string; submittedBy: string | null; approvedByName: string | null; approvedAt: string | null;
  sentAt: string | null; sentTo: string | null; confirmedAt: string | null; cancelledAt: string | null; cancelReason: string | null; closedAt: string | null; closeReason: string | null; overReason: string | null; companyName: string;
  /** When the supplier went on hold, who said this order continues anyway, and why. */
  continuedAt: string | null; continuedNote: string | null; continuedByName: string | null;
  /** Who let the order go ahead beyond its project's money in hand, and why (cleared when its lines change). */
  fundsOverrideAt: string | null; fundsOverrideReason: string | null; fundsOverrideByName: string | null;
  /** Who said it goes ahead while one of its projects is on hold, and why. */
  holdOverrideAt: string | null; holdOverrideReason: string | null; holdOverrideByName: string | null;
};

export async function readOrder(db: Db, workspaceId: string, orderId: string, lock = false): Promise<OrderDetail | undefined> {
  if (lock) await db.query(`SELECT 1 FROM purchase_orders WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, orderId]);
  return (await db.query<OrderDetail>(
    `SELECT listed.*, purchase.payment_terms AS "paymentTerms", purchase.advance_percent::text AS "advancePercent", purchase.credit_days AS "creditDays", purchase.terms_note AS "termsNote",
            purchase.retention_percent::text AS "retentionPercent", purchase.deliver_to AS "deliverTo", purchase.delivery_address AS "deliveryAddress", purchase.supplier_reference AS "supplierReference", purchase.notes,
            purchase.subtotal::text AS subtotal, purchase.discount_total::text AS "discountTotal", purchase.tax_total::text AS "taxTotal",
            approver.display_name AS "approvedByName", purchase.approved_at AS "approvedAt", purchase.sent_at AS "sentAt", purchase.sent_to AS "sentTo",
            purchase.confirmed_at AS "confirmedAt", purchase.cancelled_at AS "cancelledAt", purchase.cancel_reason AS "cancelReason",
            purchase.closed_at AS "closedAt", purchase.close_reason AS "closeReason", purchase.over_reason AS "overReason",
            purchase.continue_on_hold_at AS "continuedAt", purchase.continue_on_hold_note AS "continuedNote", continuer.display_name AS "continuedByName", entity.display_name AS "companyName",
            purchase.funds_override_at AS "fundsOverrideAt", purchase.funds_override_reason AS "fundsOverrideReason", overrider.display_name AS "fundsOverrideByName",
            purchase.hold_override_at AS "holdOverrideAt", purchase.hold_override_reason AS "holdOverrideReason", holder.display_name AS "holdOverrideByName"
       FROM (${ORDER_SELECT} WHERE purchase.workspace_id = $1 AND purchase.id = $2) listed
       JOIN purchase_orders purchase ON purchase.workspace_id = $1 AND purchase.id = listed.id
       JOIN legal_entities entity ON entity.workspace_id = $1 AND entity.id = purchase.legal_entity_id
       LEFT JOIN users approver ON approver.id = purchase.approved_by
       LEFT JOIN users continuer ON continuer.id = purchase.continue_on_hold_by
       LEFT JOIN users overrider ON overrider.id = purchase.funds_override_by
       LEFT JOIN users holder ON holder.id = purchase.hold_override_by`, [workspaceId, orderId])).rows[0];
}

export async function readOrderLines(db: Db, workspaceId: string, orderId: string): Promise<OrderLine[]> {
  return (await db.query<OrderLine>(
    `SELECT line.id, line.position, line.project_id AS "projectId", project.reference AS "projectReference", line.source, line.material_item_id AS "materialItemId", line.boq_line_id AS "boqLineId",
            line.description, line.specification, line.quantity::text AS quantity, line.unit, line.unit_price::text AS "unitPrice", line.discount_percent::text AS "discountPercent",
            line.tax_rate::text AS "taxRate", line.net::text AS net, line.tax::text AS tax, line.total::text AS total,
            (coalesce(received.accepted, 0) - coalesce(back."returnedAccepted", 0))::numeric(18, 4)::text AS accepted, coalesce(received.rejected, 0)::numeric(18, 4)::text AS rejected,
            coalesce(received.pending, 0)::numeric(18, 4)::text AS pending, coalesce(back.credited, 0)::numeric(18, 4)::text AS credited,
            coalesce(back.returned, 0)::numeric(18, 4)::text AS returned,
            line.promised_date::text AS "promisedDate", line.confirmed_quantity::text AS "confirmedQuantity",
            coalesce(line.promised_date, purchase.promised_date, purchase.expected_date)::text AS due,
            line.cancelled_quantity::text AS cancelled, line.cancel_reason AS "cancelReason", line.replaces_line_id AS "replacesLineId", replaced.number AS "replacesOrderNumber",
            line.alternate_status AS "alternateStatus", line.alternate_description AS "alternateDescription", line.alternate_specification AS "alternateSpecification",
            line.alternate_unit_price::text AS "alternateUnitPrice", line.alternate_note AS "alternateNote", line.alternate_offered_by AS "alternateOfferedBy",
            line.original_description AS "originalDescription", line.original_specification AS "originalSpecification", line.stock_item_id AS "stockItemId"
       FROM purchase_order_lines line
       JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
       LEFT JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       LEFT JOIN purchase_order_lines previous ON previous.workspace_id = line.workspace_id AND previous.id = line.replaces_line_id
       LEFT JOIN purchase_orders replaced ON replaced.workspace_id = previous.workspace_id AND replaced.id = previous.order_id
       ${LINE_RECEIVED}
      WHERE line.workspace_id = $1 AND line.order_id = $2 ORDER BY line.position, line.id`, [workspaceId, orderId])).rows;
}

export type Shipment = {
  id: string; carrier: string; trackingRef: string; trackingUrl: string; status: ShipmentStatus; shippedOn: string | null; eta: string | null; note: string;
  updatedAt: string; updatedByName: string; version: number;
};

/** The shipments a buyer follows on an order: the open ones first, then by when they're expected. */
export async function readShipments(db: Db, workspaceId: string, orderId: string): Promise<Shipment[]> {
  return (await db.query<Shipment>(
    `SELECT shipment.id, shipment.carrier, shipment.tracking_ref AS "trackingRef", shipment.tracking_url AS "trackingUrl", shipment.status, shipment.shipped_on::text AS "shippedOn",
            shipment.eta::text AS eta, shipment.note, shipment.updated_at AS "updatedAt", person.display_name AS "updatedByName", shipment.version
       FROM purchase_order_shipments shipment JOIN users person ON person.id = shipment.updated_by
      WHERE shipment.workspace_id = $1 AND shipment.order_id = $2
      ORDER BY shipment.status IN ('arrived', 'cancelled'), shipment.eta NULLS LAST, shipment.created_at`, [workspaceId, orderId])).rows;
}

export async function orderEvent(db: Db, workspaceId: string, orderId: string, kind: string, detail: Record<string, unknown>, actorId: string | null) {
  await db.query(`INSERT INTO purchase_order_events (workspace_id, order_id, kind, detail, actor_id) VALUES ($1, $2, $3, $4::jsonb, $5)`, [workspaceId, orderId, kind, JSON.stringify(detail), actorId]);
}

export async function readOrderEvents(db: Db, workspaceId: string, orderId: string) {
  return (await db.query<{ id: string; kind: string; detail: Record<string, unknown>; byName: string | null; at: string }>(
    `SELECT event.id, event.kind, event.detail, person.display_name AS "byName", event.at FROM purchase_order_events event LEFT JOIN users person ON person.id = event.actor_id
      WHERE event.workspace_id = $1 AND event.order_id = $2 ORDER BY event.at, event.id`, [workspaceId, orderId])).rows;
}

export type PurchasingSettings = {
  approvalThreshold: string | null; requireMaterialSignoff: boolean; requireApprovedSupplier: boolean; requireInspection: boolean; receiveTolerancePercent: string;
  /** A delivery received at a project's site shows as missing its photo until one is added. */
  requireSitePhoto: boolean;
  /** Stock corrections worth more than this (in the workspace's currency) wait for a second person; none when empty. */
  stockAdjustApprovalValue: string | null;
  /** How many days before it's needed something is ordered, when the supplier's lead time isn't known. */
  orderAheadDays: number;
  /** How far above the ordered price (in percent) a supplier's invoice may be before it's held. */
  invoiceTolerancePercent: string;
  /** Orders beyond a project's money in hand: let through, let through with a warning, or stopped until someone who may override approves. */
  spendingGuard: "off" | "warn" | "strict";
  /** Invoices are paid only through a payment run someone else approved; advances on orders are still recorded directly. */
  paymentRunsRequired: boolean; version: number;
};

export async function ensurePurchasingSettings(db: Db, workspaceId: string): Promise<PurchasingSettings> {
  await db.query(`INSERT INTO workspace_purchasing_settings (workspace_id) VALUES ($1) ON CONFLICT (workspace_id) DO NOTHING`, [workspaceId]);
  return (await db.query<PurchasingSettings>(
    `SELECT approval_threshold::text AS "approvalThreshold", require_material_signoff AS "requireMaterialSignoff", require_approved_supplier AS "requireApprovedSupplier",
            require_inspection AS "requireInspection", receive_tolerance_percent::text AS "receiveTolerancePercent", require_site_photo AS "requireSitePhoto", stock_adjust_approval_value::text AS "stockAdjustApprovalValue",
            order_ahead_days AS "orderAheadDays", invoice_tolerance_percent::text AS "invoiceTolerancePercent", spending_guard AS "spendingGuard",
            payment_runs_required AS "paymentRunsRequired", version
       FROM workspace_purchasing_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
}

/** The buying company's default tax rate today, as a percentage string ("5.0000"), or "0". */
export async function defaultTaxRate(db: Db, workspaceId: string, legalEntityId: string) {
  return (await db.query<{ rate: string }>(
    `SELECT rate.rate::text AS rate FROM tax_rates rate JOIN tax_profiles profile ON profile.id = rate.tax_profile_id
      WHERE rate.workspace_id = $1 AND profile.legal_entity_id = $2 AND profile.effective_to IS NULL AND rate.effective_to IS NULL AND rate.is_default LIMIT 1`,
    [workspaceId, legalEntityId])).rows[0]?.rate ?? "0";
}

/** Allocates the buying company's next purchase order number, creating its numbering the first time. */
export async function nextOrderNumber(db: Db, workspaceId: string, legalEntityId: string) {
  await db.query(
    `INSERT INTO document_sequences (workspace_id, legal_entity_id, document_type, prefix, padding, reset_policy, next_number)
     SELECT $1, entity.id, 'PURCHASE_ORDER', entity.code || '-PO-{YYYY}-', 5, 'annual', 1 FROM legal_entities entity
      WHERE entity.workspace_id = $1 AND entity.id = $2
     ON CONFLICT (legal_entity_id, document_type) DO NOTHING`, [workspaceId, legalEntityId]);
  return (await db.query<{ number: string }>(`SELECT allocate_document_number($1, $2, 'PURCHASE_ORDER') AS number`, [workspaceId, legalEntityId])).rows[0].number;
}

/**
 * Everything the project needs to order is on placed orders (approved, sent, confirmed or closed): each
 * material and bought scope line with a quantity is fully covered, and one without a quantity has at
 * least one placed order. A project with nothing to order passes.
 */
export async function everythingOrdered(db: Db, workspaceId: string, projectId: string) {
  const needs = await readNeeds(db, workspaceId, false, projectId);
  return needs.every((need) => (need.required === null ? Dec.of(need.placed).cmp(0) > 0 : Dec.of(need.placed).cmp(need.required) >= 0));
}

/**
 * Records a purchasing command by its id the first time it runs; false when it already ran (or is running
 * in another request, which this waits for), so a retry returns the result instead of acting twice.
 */
export async function firstTime(db: Db, workspaceId: string, commandId: string, entityId: string, action: string, actorId: string) {
  return Boolean((await db.query(
    `INSERT INTO purchasing_commands (workspace_id, id, entity_id, action, actor_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace_id, id) DO NOTHING`,
    [workspaceId, commandId, entityId, action.slice(0, 24), actorId])).rowCount);
}

/**
 * What to order when a supplier sells in packs and has a minimum: at least the minimum, rounded up to
 * whole packs. The same quantity when it already fits, or when there's no pack rule.
 */
export function packQuantity(quantity: string, packSize: string | null, minimum: string | null) {
  let result = Dec.of(quantity);
  if (minimum && Dec.of(minimum).cmp(result) > 0) result = Dec.of(minimum);
  if (packSize && Dec.of(packSize).cmp(0) > 0) {
    const packs = result.div(packSize).ceil(0);
    result = packs.mul(packSize);
  }
  return result.toString();
}
