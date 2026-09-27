import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { currencyDecimals, ensurePurchasingSettings, readNeeds, readOrderLines } from "./orders";
import { readBillsDue } from "./payables";
import { outstanding } from "./receiving";

type Db = Pick<PoolClient, "query">;

/**
 * The daily chase, run inside one workspace's tenant transaction.
 * - Late orders: something still to come was due before today (its line's promise, else the order's
 *   promise, else when it was needed). The buyer hears the first day it's late and then every week while
 *   it stays late, in the app and by email.
 * - Late to order: a project still needs something that should have been ordered by now to arrive when
 *   its work starts. The people who buy hear once per project, then every week while it stays so.
 * Keys make each reminder once only; a missed day catches up.
 */
export async function processPurchasingDeadlines(db: Db, workspaceId: string) {
  const today = (await db.query<{ today: string; locale: string }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today, coalesce(default_locale, 'en') AS locale FROM workspaces WHERE id = $1`,
    [workspaceId])).rows[0];
  if (!today) return { sent: 0 };
  const orders = (await db.query<{ id: string; number: string; supplier: string; currency: string; total: string; buyer: string; submitter: string | null }>(
    `SELECT purchase.id, purchase.number, vendor.display_name AS supplier, purchase.currency, purchase.total::text AS total, purchase.created_by AS buyer, purchase.submitted_by AS submitter
       FROM purchase_orders purchase JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
      WHERE purchase.workspace_id = $1 AND purchase.status IN ('sent', 'confirmed', 'partly_received')
        AND EXISTS (SELECT 1 FROM purchase_order_lines line WHERE line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id
                     AND coalesce(line.promised_date, purchase.promised_date, purchase.expected_date) < $2::date)`, [workspaceId, today.today])).rows;
  let sent = 0;
  for (const order of orders) {
    const late = (await readOrderLines(db, workspaceId, order.id)).filter((line) => line.due && line.due < today.today && outstanding(line).cmp(0) > 0);
    if (!late.length) continue;
    const due = late.map((line) => line.due!).sort()[0];
    const days = Math.round((Date.parse(`${today.today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
    const week = Math.floor((days - 1) / 7);
    const day = (() => { try { return new Intl.DateTimeFormat(today.locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${due}T00:00:00Z`)); } catch { return due; } })();
    const items = late.slice(0, 5).map((line) => `${line.description} ${outstanding(line).toString()} ${line.unit}`.trim()).join(", ");
    const note = `due ${day}, ${days === 1 ? "1 day" : `${days} days`} late: ${items}${late.length > 5 ? ` and ${late.length - 5} more` : ""}.`;
    const variables = { order: order.number, supplier: order.supplier, amount: `${order.currency} ${Dec.of(order.total).toFixed(currencyDecimals(order.currency))}`, actor: "", note };
    for (const userId of new Set([order.buyer, order.submitter].filter((value): value is string => Boolean(value)))) {
      const message = { workspaceId, recipientUserId: userId, code: "purchasing.late", eventType: "purchasing.late", variables, deepLink: `/workspace/purchasing/orders?order=${order.id}` };
      const key = `purchasing.late:${order.id}:${due}:${week}:${userId}`;
      const result = await notifyUserInApp(db, { ...message, idempotencyKey: key });
      await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
      if (result.queued) sent += 1;
    }
  }
  return { sent: sent + await chaseOrdering(db, workspaceId, today.today, today.locale) };
}

async function chaseOrdering(db: Db, workspaceId: string, today: string, locale: string) {
  const settings = await ensurePurchasingSettings(db, workspaceId);
  const late = (await readNeeds(db, workspaceId, settings.requireMaterialSignoff))
    .filter((need) => !need.blocked && need.orderBy && need.orderBy < today && need.remaining !== null && Dec.of(need.remaining).cmp(0) > 0);
  if (!late.length) return 0;
  const buyers = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'purchasing.manage'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
  const day = (value: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00Z`)); } catch { return value; } };
  let sent = 0;
  for (const projectId of new Set(late.map((need) => need.projectId))) {
    const mine = late.filter((need) => need.projectId === projectId).sort((a, b) => a.neededBy!.localeCompare(b.neededBy!));
    const since = mine.map((need) => need.orderBy!).sort()[0];
    const week = Math.floor((Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000) - 1) / 7);
    const items = mine.slice(0, 5).map((need) => `${need.title} ${Dec.of(need.remaining!).toString()} ${need.unit}`.trim() + ` (needed ${day(need.neededBy!)})`).join(", ");
    const note = `${items}${mine.length > 5 ? ` and ${mine.length - 5} more` : ""}.`;
    const project = `${mine[0].projectReference} · ${mine[0].projectName}`;
    for (const userId of buyers) {
      const message = { workspaceId, recipientUserId: userId, code: "purchasing.order_late", eventType: "purchasing.order_late", variables: { project, note }, deepLink: "/workspace/purchasing" };
      const key = `purchasing.order_late:${projectId}:${since}:${week}:${userId}`;
      const result = await notifyUserInApp(db, { ...message, idempotencyKey: key });
      await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
      if (result.queued) sent += 1;
    }
  }
  return sent;
}

/**
 * Supplier invoices falling due: the people who pay suppliers hear once per supplier when invoices are
 * due within three days, and again when one of them goes overdue. The key is the set of invoices and
 * their state, so nothing repeats until something changes.
 */
export async function processPayablesDue(db: Db, workspaceId: string) {
  const due = await readBillsDue(db, workspaceId, 3);
  if (!due.length) return { sent: 0 };
  const payers = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'payables.manage'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
  let sent = 0;
  for (const vendorId of new Set(due.map((bill) => bill.vendorId))) {
    const bills = due.filter((bill) => bill.vendorId === vendorId);
    const key = createHash("sha256").update(bills.map((bill) => `${bill.id}:${bill.overdue ? "late" : "due"}`).join(",")).digest("hex").slice(0, 24);
    const note = bills.map((bill) => `${bill.number}: ${bill.currency} ${Dec.of(bill.balance).toFixed(currencyDecimals(bill.currency))} ${bill.overdue ? "overdue since" : "due"} ${bill.dueDate}`)
      .join("; ").slice(0, 480);
    const totals = new Map<string, Dec>();
    for (const bill of bills) totals.set(bill.currency, (totals.get(bill.currency) ?? Dec.ZERO).add(bill.balance));
    const amount = [...totals].map(([currency, total]) => `${currency} ${total.toFixed(currencyDecimals(currency))}`).join(" + ");
    for (const userId of payers) {
      const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "payables.due", eventType: "payables.due",
        variables: { supplier: bills[0].supplierName, invoice: bills.map((bill) => bill.number).join(", ").slice(0, 200), amount, actor: "", note },
        deepLink: `/workspace/finance/suppliers/${vendorId}`, idempotencyKey: `payables.due:${vendorId}:${key}:${userId}` });
      if (result.queued) sent += 1;
    }
  }
  return { sent };
}
