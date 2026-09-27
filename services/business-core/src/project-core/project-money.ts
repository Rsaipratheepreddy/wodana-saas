import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { paymentHasFinanceVerifiedReceipt } from "../commercial/finance-ledger";
import { inWorkspaceCurrency } from "../inventory/stock";
import { notifyUserInApp } from "../notifications/default-templates";
import { claimNumber } from "../petty-cash/petty-cash";
import { currencyDecimals } from "../purchasing/orders";
import { orderUnitPrice } from "../purchasing/payables";
import { labourCost, rateOn, readTradeRates, readWorkcenterRates, tradeKey } from "./labour-rates";

type Db = Pick<PoolClient, "query">;

export type CostSource = "stock" | "service" | "price_difference" | "charge" | "labour" | "petty_cash";
/** One cost the project carries, in the workspace's currency, from the record that caused it. */
export type CostEntry = {
  key: string; on: string; source: CostSource; description: string; reference: string | null; packageId: string | null; packageName: string | null; amount: string;
};

/**
 * How stock changes what a project carries. Goods count when they become the project's and stop counting
 * when they leave it: received for it, allocated to it, issued to it from general (or another project's)
 * stock, adjusted in its stock; released, returned to general stock, sent back to the supplier or a
 * reversed delivery take them off. Issuing its own stock to its own work, moves inside its stock and what
 * the factory makes from materials already counted change nothing.
 */
export function stockEffect(movement: { kind: string; projectId: string | null; forProjectId: string | null; quantity: string }, projectId: string) {
  if (movement.kind === "produce") return Dec.ZERO;
  if (movement.kind === "issue" || movement.kind === "return") {
    if (movement.projectId === movement.forProjectId) return Dec.ZERO;
    // Issue takes from the owner's stock (a negative quantity) and gives to the consumer; a return the opposite.
    let effect = Dec.ZERO;
    if (movement.projectId === projectId) effect = effect.add(movement.quantity);
    if (movement.forProjectId === projectId) effect = effect.sub(movement.quantity);
    return effect;
  }
  return movement.projectId === projectId ? Dec.of(movement.quantity) : Dec.ZERO;
}

/** The package a purchase order line belongs to: its scope line's, its work order's (outside work), or its material's first scope line's. */
const LINE_PACKAGE = `coalesce(scope.package_id,
     (SELECT outside.package_id FROM work_orders outside WHERE outside.workspace_id = ordered.workspace_id AND outside.id = ordered.work_order_id),
     (SELECT first.package_id FROM project_boq_lines first WHERE first.workspace_id = ordered.workspace_id AND first.id = material.boq_line_ids[1]))`;

/**
 * Everything the project has cost so far, entry by entry: stock at its moving-average cost when it moved,
 * services and outside work as they were received at the order's price, the difference when a supplier's
 * approved invoice priced order lines differently, approved charges not on an order, labour (site and
 * factory) at the rate of its day, and approved petty cash. Amounts in other currencies are converted at
 * the rate of their day; `uncosted` counts entries with no cost, labour rate or exchange rate.
 */
export async function readProjectCosts(db: Db, workspaceId: string, projectId: string) {
  const entries: CostEntry[] = [];
  let uncosted = 0;
  const places = (currency: string) => currencyDecimals(currency);
  const home = (await db.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].currency;
  const convert = async (amount: Dec, currency: string, on: string) => (await inWorkspaceCurrency(db, workspaceId, amount, currency, on))?.amount ?? null;

  // Stock: every movement into or out of the project's ownership.
  const moves = (await db.query<{ id: string; on: string; kind: string; projectId: string | null; forProjectId: string | null; quantity: string; unitCost: string | null;
    transferId: string | null; item: string; unit: string; packageId: string | null; packageName: string | null; orderNumber: string | null }>(
    `SELECT movement.id, movement.moved_on::text AS on, movement.kind, movement.project_id AS "projectId", movement.for_project_id AS "forProjectId", movement.quantity::text AS quantity,
            movement.unit_cost::text AS "unitCost", movement.transfer_id AS "transferId", item.name AS item, item.unit, package.id AS "packageId", package.name AS "packageName",
            purchase.number AS "orderNumber"
       FROM stock_movements movement
       JOIN stock_items item ON item.workspace_id = movement.workspace_id AND item.id = movement.item_id
       LEFT JOIN goods_receipt_lines got ON got.workspace_id = movement.workspace_id AND got.id = movement.receipt_line_id
       LEFT JOIN work_order_materials used ON used.workspace_id = movement.workspace_id AND used.id = movement.work_order_material_id
       LEFT JOIN work_orders work ON work.workspace_id = movement.workspace_id AND work.id = coalesce(movement.work_order_id, used.work_order_id)
       LEFT JOIN purchase_order_lines ordered ON ordered.workspace_id = movement.workspace_id AND ordered.id = got.order_line_id
       LEFT JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
       LEFT JOIN project_material_items material ON material.workspace_id = ordered.workspace_id AND material.id = ordered.material_item_id
       LEFT JOIN project_boq_lines scope ON scope.workspace_id = movement.workspace_id AND scope.id = coalesce(ordered.boq_line_id, work.boq_line_id)
       LEFT JOIN project_packages package ON package.workspace_id = movement.workspace_id AND package.id = coalesce(work.package_id, ${LINE_PACKAGE.replace(/ordered\.workspace_id/g, "movement.workspace_id")})
      WHERE movement.workspace_id = $1 AND (movement.project_id = $2 OR movement.for_project_id = $2)
      ORDER BY movement.moved_on, movement.seq`, [workspaceId, projectId])).rows;
  // A transfer between two places of the project's own stock changes nothing.
  const transfers = new Map<string, Dec>();
  for (const move of moves) if (move.transferId) transfers.set(move.transferId, (transfers.get(move.transferId) ?? Dec.ZERO).add(stockEffect(move, projectId)));
  const words: Record<string, string> = { receive: "Received", allocate: "Allocated from stock", release: "Released to stock", issue: "Issued from stock", return: "Returned to stock",
    adjust: "Stock correction", supplier_return: "Sent back to the supplier", reverse: "Delivery reversed", transfer_in: "Moved in", transfer_out: "Moved out" };
  for (const move of moves) {
    if (move.transferId && transfers.get(move.transferId)!.isZero()) continue;
    const quantity = stockEffect(move, projectId);
    if (quantity.isZero()) continue;
    if (move.unitCost === null) { uncosted += 1; continue; }
    entries.push({ key: `stock:${move.id}`, on: move.on, source: "stock", description: `${words[move.kind] ?? move.kind}: ${move.item} ${quantity.toString()} ${move.unit}`.trim(),
      reference: move.orderNumber, packageId: move.packageId, packageName: move.packageName, amount: quantity.mul(move.unitCost).round(places(home)).toFixed(4) });
  }

  // Services and outside work: what was accepted, at the order line's net price.
  const services = (await db.query<{ id: string; on: string; description: string; accepted: string; unitPrice: string; discountPercent: string; currency: string; orderNumber: string;
    packageId: string | null; packageName: string | null }>(
    `SELECT got.id, receipt.received_on::text AS on, ordered.description, got.accepted::text AS accepted, ordered.unit_price::text AS "unitPrice",
            ordered.discount_percent::text AS "discountPercent", purchase.currency, purchase.number AS "orderNumber", package.id AS "packageId", package.name AS "packageName"
       FROM goods_receipt_lines got
       JOIN goods_receipts receipt ON receipt.workspace_id = got.workspace_id AND receipt.id = got.receipt_id AND receipt.reversed_at IS NULL
       JOIN purchase_order_lines ordered ON ordered.workspace_id = got.workspace_id AND ordered.id = got.order_line_id
       JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
       LEFT JOIN project_material_items material ON material.workspace_id = ordered.workspace_id AND material.id = ordered.material_item_id
       LEFT JOIN project_boq_lines scope ON scope.workspace_id = ordered.workspace_id AND scope.id = ordered.boq_line_id
       LEFT JOIN project_packages package ON package.workspace_id = ordered.workspace_id AND package.id = ${LINE_PACKAGE}
       -- Exactly what deliveries keep out of stock: a scope line whose package is bought as a service, or outside work on a work order.
       LEFT JOIN project_packages bought ON bought.workspace_id = scope.workspace_id AND bought.id = scope.package_id
      WHERE got.workspace_id = $1 AND ordered.project_id = $2 AND got.accepted > 0
        AND (bought.supply IN ('subcontract', 'site_work') OR ordered.work_order_id IS NOT NULL)
      ORDER BY receipt.received_on, got.id`, [workspaceId, projectId])).rows;
  for (const service of services) {
    const amount = await convert(Dec.of(service.accepted).mul(orderUnitPrice(service)).round(places(service.currency)), service.currency, service.on);
    if (amount === null) { uncosted += 1; continue; }
    entries.push({ key: `service:${service.id}`, on: service.on, source: "service", description: `${service.description} ${Dec.of(service.accepted).toString()}`, reference: service.orderNumber,
      packageId: service.packageId, packageName: service.packageName, amount: amount.round(places(home)).toFixed(4) });
  }

  // Suppliers' approved invoices: a different price on order lines, and charges not on an order.
  const billed = (await db.query<{ id: string; on: string; number: string; supplier: string; description: string; quantity: string; net: string; currency: string; orderLineId: string | null;
    unitPrice: string | null; discountPercent: string | null; packageId: string | null; packageName: string | null }>(
    `SELECT line.id, bill.invoice_date::text AS on, bill.number, vendor.display_name AS supplier, line.description, line.quantity::text AS quantity, line.net::text AS net, bill.currency,
            line.order_line_id AS "orderLineId", ordered.unit_price::text AS "unitPrice", ordered.discount_percent::text AS "discountPercent", package.id AS "packageId", package.name AS "packageName"
       FROM supplier_invoice_lines line
       JOIN supplier_invoices bill ON bill.workspace_id = line.workspace_id AND bill.id = line.invoice_id AND bill.status = 'approved'
       JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id AND vendor.id = bill.vendor_id
       LEFT JOIN purchase_order_lines ordered ON ordered.workspace_id = line.workspace_id AND ordered.id = line.order_line_id
       LEFT JOIN project_material_items material ON material.workspace_id = ordered.workspace_id AND material.id = ordered.material_item_id
       LEFT JOIN project_boq_lines scope ON scope.workspace_id = ordered.workspace_id AND scope.id = ordered.boq_line_id
       LEFT JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = ${LINE_PACKAGE}
      WHERE line.workspace_id = $1 AND coalesce(ordered.project_id, line.project_id) = $2
      ORDER BY bill.invoice_date, line.id`, [workspaceId, projectId])).rows;
  for (const line of billed) {
    const places_ = places(line.currency);
    const difference = line.orderLineId
      ? Dec.of(line.net).sub(Dec.of(line.quantity).mul(orderUnitPrice({ unitPrice: line.unitPrice!, discountPercent: line.discountPercent! })).round(places_))
      : Dec.of(line.net);
    if (difference.isZero()) continue;
    const amount = await convert(difference, line.currency, line.on);
    if (amount === null) { uncosted += 1; continue; }
    entries.push({ key: `bill:${line.id}`, on: line.on, source: line.orderLineId ? "price_difference" : "charge",
      description: line.orderLineId ? `${line.description}: invoiced at a different price` : line.description, reference: `${line.supplier} ${line.number}`,
      packageId: line.packageId, packageName: line.packageName, amount: amount.round(places(home)).toFixed(4) });
  }

  // Site labour: the people per trade on each approved report, at the trade's day rate on the report's day.
  // Site reports belong to the project, not to a package.
  const tradeRates = await readTradeRates(db, workspaceId);
  const crews = (await db.query<{ id: string; on: string; trade: string; people: number; author: string }>(
    `SELECT workforce.id, report.report_date::text AS on, workforce.trade, workforce.people, author.display_name AS author
       FROM site_report_workforce workforce
       JOIN site_reports report ON report.workspace_id = workforce.workspace_id AND report.id = workforce.report_id AND report.status = 'approved'
       JOIN users author ON author.id = report.author_id
      WHERE workforce.workspace_id = $1 AND report.project_id = $2
      ORDER BY report.report_date, workforce.id`, [workspaceId, projectId])).rows;
  for (const crew of crews) {
    const rate = rateOn(tradeRates, tradeKey(crew.trade), crew.on);
    const amount = rate ? await convert(labourCost(crew.people, rate.rate, rate.currency), rate.currency, crew.on) : null;
    if (amount === null) { uncosted += 1; continue; }
    if (amount.isZero()) continue;
    entries.push({ key: `labour:${crew.id}`, on: crew.on, source: "labour", description: `Site labour: ${crew.trade}, ${crew.people} ${crew.people === 1 ? "person" : "people"}`,
      reference: crew.author, packageId: null, packageName: null, amount: amount.round(places(home)).toFixed(4) });
  }

  // Factory labour: the hours reported with approved output, at its workcenter's hourly rate on the day it was reported.
  const workcenterRates = await readWorkcenterRates(db, workspaceId);
  const hours = (await db.query<{ id: string; on: string; hours: string; workcenterId: string | null; workcenter: string | null; number: number; packageId: string | null;
    packageName: string | null }>(
    `SELECT report.id, (report.reported_at AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS on, report.hours::text AS hours,
            report.workcenter_id AS "workcenterId", center.name AS workcenter, wo.number, package.id AS "packageId", package.name AS "packageName"
       FROM work_order_reports report
       JOIN workspaces workspace ON workspace.id = report.workspace_id
       JOIN work_orders wo ON wo.workspace_id = report.workspace_id AND wo.id = report.work_order_id
       LEFT JOIN workcenters center ON center.workspace_id = report.workspace_id AND center.id = report.workcenter_id
       LEFT JOIN project_packages package ON package.workspace_id = wo.workspace_id AND package.id = wo.package_id
      WHERE report.workspace_id = $1 AND wo.project_id = $2 AND report.status = 'approved' AND report.hours IS NOT NULL
      ORDER BY report.reported_at, report.id`, [workspaceId, projectId])).rows;
  for (const row of hours) {
    const rate = row.workcenterId ? rateOn(workcenterRates, row.workcenterId, row.on) : null;
    const amount = rate ? await convert(labourCost(row.hours, rate.rate, rate.currency), rate.currency, row.on) : null;
    if (amount === null) { uncosted += 1; continue; }
    if (amount.isZero()) continue;
    entries.push({ key: `labour:${row.id}`, on: row.on, source: "labour", description: `Factory labour: ${row.workcenter}, ${Dec.of(row.hours).toString()} hours`,
      reference: `WO-${String(row.number).padStart(4, "0")}`, packageId: row.packageId, packageName: row.packageName, amount: amount.round(places(home)).toFixed(4) });
  }

  // Petty cash: claims once approved (and after they're reimbursed), on the day the money was spent.
  const claims = (await db.query<{ id: string; on: string; number: number; description: string; amount: string; currency: string; packageId: string | null; packageName: string | null }>(
    `SELECT claim.id, claim.spent_on::text AS on, claim.number, claim.description, claim.amount::text AS amount, claim.currency, package.id AS "packageId", package.name AS "packageName"
       FROM petty_cash_claims claim
       LEFT JOIN project_packages package ON package.workspace_id = claim.workspace_id AND package.id = claim.package_id
      WHERE claim.workspace_id = $1 AND claim.project_id = $2 AND claim.status IN ('approved', 'reimbursed')
      ORDER BY claim.spent_on, claim.id`, [workspaceId, projectId])).rows;
  for (const claim of claims) {
    const amount = await convert(Dec.of(claim.amount), claim.currency, claim.on);
    if (amount === null) { uncosted += 1; continue; }
    entries.push({ key: `petty_cash:${claim.id}`, on: claim.on, source: "petty_cash", description: claim.description, reference: claimNumber(claim.number),
      packageId: claim.packageId, packageName: claim.packageName, amount: amount.round(places(home)).toFixed(4) });
  }
  entries.sort((a, b) => a.on.localeCompare(b.on) || a.key.localeCompare(b.key));
  return { currency: home, entries, uncosted, total: entries.reduce((sum, entry) => sum.add(entry.amount), Dec.ZERO).toFixed(4) };
}

/**
 * What the project has ordered and not yet got: the rest of each line on a placed, open order (and what
 * arrived but isn't inspected yet), at the order's net price, in the workspace's currency today.
 */
export async function readProjectCommitted(db: Db, workspaceId: string, projectId: string) {
  const today = (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
    [workspaceId])).rows[0].today;
  const lines = (await db.query<{ id: string; quantity: string; cancelled: string; credited: string; accepted: string; unitPrice: string; discountPercent: string; currency: string;
    packageId: string | null }>(
    `SELECT ordered.id, ordered.quantity::text AS quantity, ordered.cancelled_quantity::text AS cancelled, ordered.unit_price::text AS "unitPrice",
            ordered.discount_percent::text AS "discountPercent", purchase.currency, package.id AS "packageId",
            coalesce(back.credited, 0)::text AS credited, (coalesce(got.accepted, 0) - coalesce(back.returned_accepted, 0))::text AS accepted
       FROM purchase_order_lines ordered
       JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
       LEFT JOIN project_material_items material ON material.workspace_id = ordered.workspace_id AND material.id = ordered.material_item_id
       LEFT JOIN project_boq_lines scope ON scope.workspace_id = ordered.workspace_id AND scope.id = ordered.boq_line_id
       LEFT JOIN project_packages package ON package.workspace_id = ordered.workspace_id AND package.id = ${LINE_PACKAGE}
       LEFT JOIN LATERAL (SELECT sum(item.accepted) AS accepted FROM goods_receipt_lines item
                            JOIN goods_receipts receipt ON receipt.workspace_id = item.workspace_id AND receipt.id = item.receipt_id AND receipt.reversed_at IS NULL
                           WHERE item.workspace_id = ordered.workspace_id AND item.order_line_id = ordered.id) got ON true
       LEFT JOIN LATERAL (SELECT sum(item.quantity) FILTER (WHERE item.source = 'accepted' AND sent.status = 'sent') AS returned_accepted,
                                 sum(item.quantity) FILTER (WHERE sent.outcome = 'credit' AND (sent.status = 'sent' OR (sent.status = 'open' AND item.source = 'rejected'))) AS credited
                            FROM supplier_return_lines item JOIN supplier_returns sent ON sent.workspace_id = item.workspace_id AND sent.id = item.return_id
                           WHERE item.workspace_id = ordered.workspace_id AND item.order_line_id = ordered.id) back ON true
      WHERE ordered.workspace_id = $1 AND ordered.project_id = $2 AND purchase.status IN ('approved', 'sent', 'confirmed', 'partly_received')`, [workspaceId, projectId])).rows;
  const byPackage = new Map<string | null, Dec>();
  let total = Dec.ZERO, unconverted = 0;
  for (const line of lines) {
    const left = Dec.of(line.quantity).sub(line.cancelled).sub(line.credited).sub(line.accepted);
    if (left.cmp(0) <= 0) continue;
    const value = await inWorkspaceCurrency(db, workspaceId, left.mul(orderUnitPrice(line)).round(currencyDecimals(line.currency)), line.currency, today);
    if (!value) { unconverted += 1; continue; }
    total = total.add(value.amount);
    byPackage.set(line.packageId, (byPackage.get(line.packageId) ?? Dec.ZERO).add(value.amount));
  }
  return { total: total.toFixed(4), byPackage, unconverted };
}

/**
 * The client side: what was agreed (the sealed baseline and every sealed variation, before tax and in
 * total) and the payments requested and finance-verified on those quotations, in the project's currency.
 */
export async function readProjectIncome(db: Db, workspaceId: string, project: { id: string; caseId: string; currency: string }) {
  const seals = (await db.query<{ quoteId: string | null; total: string; net: string | null }>(
    `SELECT quote_id AS "quoteId", total::text AS total, (snapshot->'pricing'->>'net') AS net FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2`,
    [workspaceId, project.id])).rows;
  const agreed = seals.reduce((sum, seal) => sum.add(seal.total), Dec.ZERO);
  const agreedNet = seals.reduce((sum, seal) => sum.add(seal.net ?? seal.total), Dec.ZERO);
  const quotes = new Set(seals.flatMap((seal) => (seal.quoteId ? [seal.quoteId] : [])));
  const loaded = await commercialRepository.load(db as PoolClient, workspaceId, project.caseId);
  const data = loaded ? { ...(loaded.content as CommercialData), revision: loaded.revision } : null;
  const payments = (data?.payments ?? []).filter((payment) => payment.sourceQuoteId && quotes.has(payment.sourceQuoteId));
  // Client payments are kept with the deal as numbers; read them exactly to the currency's minor units.
  const exact = (value: number) => Dec.of(value).round(currencyDecimals(project.currency));
  const requested = payments.reduce((sum, payment) => sum.add(exact(payment.amount)), Dec.ZERO);
  const received = payments.filter((payment) => data && paymentHasFinanceVerifiedReceipt(data, payment)).reduce((sum, payment) => sum.add(exact(payment.amount)), Dec.ZERO);
  // Tax invoices issued and not credited.
  const invoiced = (await db.query<{ total: string }>(
    `SELECT coalesce(sum(total), 0)::text AS total FROM client_invoices WHERE workspace_id = $1 AND project_id = $2 AND status = 'issued'`, [workspaceId, project.id])).rows[0].total;
  return { currency: project.currency, agreed: agreed.toFixed(4), agreedNet: agreedNet.toFixed(4), requested: requested.toFixed(4), invoiced: Dec.of(invoiced).toFixed(4),
    received: received.toFixed(4) };
}

export type BudgetRow = { id: string; packageId: string | null; amount: string; currency: string; note: string; version: number; updatedByName: string; updatedAt: string };

export async function readBudgets(db: Db, workspaceId: string, projectId: string): Promise<BudgetRow[]> {
  return (await db.query<BudgetRow>(
    `SELECT budget.id, budget.package_id AS "packageId", budget.amount::text AS amount, budget.currency, budget.note, budget.version, person.display_name AS "updatedByName",
            budget.updated_at AS "updatedAt"
       FROM project_budgets budget JOIN users person ON person.id = budget.updated_by WHERE budget.workspace_id = $1 AND budget.project_id = $2`, [workspaceId, projectId])).rows;
}

/** Each package's budget against what's spent and still committed (and the costs not in a package, when there are any). */
export async function readPackageMoney(db: Db, workspaceId: string, projectId: string, costs: Awaited<ReturnType<typeof readProjectCosts>>,
  committed: Awaited<ReturnType<typeof readProjectCommitted>>, budgets: BudgetRow[]) {
  const packages = (await db.query<{ id: string; name: string }>(`SELECT id, name FROM project_packages WHERE workspace_id = $1 AND project_id = $2 ORDER BY position, name`,
    [workspaceId, projectId])).rows;
  const spentBy = new Map<string | null, Dec>();
  for (const entry of costs.entries) spentBy.set(entry.packageId, (spentBy.get(entry.packageId) ?? Dec.ZERO).add(entry.amount));
  const row = (id: string | null, name: string | null) => {
    const budget = budgets.find((item) => item.packageId === id) ?? null;
    const spent = spentBy.get(id) ?? Dec.ZERO, open = committed.byPackage.get(id) ?? Dec.ZERO;
    const forecast = spent.add(open);
    return { id, name, budget: budget?.amount ?? null, budgetVersion: budget?.version ?? 0, budgetNote: budget?.note ?? "", spent: spent.toFixed(4), committed: open.toFixed(4),
      forecast: forecast.toFixed(4), over: budget ? forecast.cmp(budget.amount) > 0 : false };
  };
  const rows = packages.map((item) => row(item.id, item.name));
  const loose = row(null, null);
  if (loose.budget !== null || Dec.of(loose.forecast).cmp(0) !== 0) rows.push(loose);
  return rows;
}

/**
 * Packages going over budget: when what's spent and still committed passes a package's budget, the
 * project's managers and the people who manage costs hear once for that budget (again if it's changed
 * and still passed).
 */
export async function processProjectBudgets(db: Db, workspaceId: string) {
  const projects = (await db.query<{ id: string; title: string }>(
    `SELECT project.id, project.reference || ' · ' || project.name AS title FROM delivery_projects project
      WHERE project.workspace_id = $1 AND project.status IN ('active', 'on_hold')
        AND EXISTS (SELECT 1 FROM project_budgets budget WHERE budget.workspace_id = project.workspace_id AND budget.project_id = project.id)`, [workspaceId])).rows;
  let sent = 0;
  for (const project of projects) {
    const budgets = await readBudgets(db, workspaceId, project.id);
    const rows = await readPackageMoney(db, workspaceId, project.id, await readProjectCosts(db, workspaceId, project.id), await readProjectCommitted(db, workspaceId, project.id), budgets);
    const over = rows.filter((row) => row.over);
    if (!over.length) continue;
    const currency = budgets[0].currency;
    const people = (await db.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
        WHERE membership.workspace_id = $1 AND membership.status = 'active' AND (
          EXISTS (SELECT 1 FROM project_assignments assignment WHERE assignment.workspace_id = membership.workspace_id AND assignment.membership_id = membership.id
                   AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager)
          OR EXISTS (SELECT 1 FROM effective_member_roles effective_role JOIN role_permissions granted ON granted.role_id = effective_role.role_id
                      JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'commercial.costs.manage'
                     WHERE effective_role.membership_id = membership.id))`, [workspaceId, project.id])).rows.map((row) => row.userId);
    for (const row of over) {
      const places = currencyDecimals(currency);
      const note = `${row.name ?? "Not in a package"}: ${currency} ${Dec.of(row.forecast).toFixed(places)} spent and committed against a budget of ${currency} ${Dec.of(row.budget!).toFixed(places)}.`;
      for (const userId of people) {
        const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "project.over_budget", eventType: "project.over_budget",
          variables: { title: project.title, clientName: "", actor: "", note }, deepLink: `/workspace/projects/${project.id}/money`,
          idempotencyKey: `project.over_budget:${project.id}:${row.id ?? "none"}:${row.budgetVersion}:${userId}` });
        if (result.queued) sent += 1;
      }
    }
  }
  return { sent };
}
