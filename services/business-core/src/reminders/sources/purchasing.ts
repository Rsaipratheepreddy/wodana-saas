import { readOrderLines } from "../../purchasing/orders";
import { outstanding } from "../../purchasing/receiving";
import { membershipsOfUsers } from "../delivery/people";
import type { Db, DueItem, ReminderSource } from "../engine/engine";
import { dayStart, encode, idsOf, keysOf } from "./support";

type Order = { id: string; number: string; supplier: string; buyer: string | null; submitter: string | null };

/** An order's lines still to come that were due before today (the line's promise, else the order's, else when needed), earliest first. */
async function lateLines(db: Db, workspaceId: string, orderId: string, today: string) {
  return (await readOrderLines(db, workspaceId, orderId)).filter((line) => line.due && line.due < today && outstanding(line).cmp(0) > 0)
    .sort((left, right) => left.due!.localeCompare(right.due!));
}

async function lateOrders(db: Db, workspaceId: string, today: string, ids: string[] | null, limit: number): Promise<Order[]> {
  return (await db.query<Order>(
    `SELECT purchase.id, purchase.number, vendor.display_name AS supplier, purchase.created_by AS buyer, purchase.submitted_by AS submitter
       FROM purchase_orders purchase JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
      WHERE purchase.workspace_id = $1 AND purchase.status IN ('sent', 'confirmed', 'partly_received') AND ($3::uuid[] IS NULL OR purchase.id = ANY($3::uuid[]))
        AND EXISTS (SELECT 1 FROM purchase_order_lines line WHERE line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id
                     AND coalesce(line.promised_date, purchase.promised_date, purchase.expected_date) < $2::date)
      ORDER BY purchase.id LIMIT $4`, [workspaceId, today, ids, limit])).rows;
}

/**
 * purchase.order_late (replaces the late-orders notice of processPurchasingDeadlines; its blockers, stock levels and
 * "late to order" chase stay there): something still to come on a sent order is past its date. The buyer (and whoever
 * submitted it) hears 1, 7 and 14 days after, then the purchasing approvers and the owner. Done when it arrived, was
 * cancelled, or its date moved (a later date is a new due revision, or not late at all).
 */
export const orderLateSource: ReminderSource = {
  kind: "purchase.order_late", module: "purchasing", audience: "staff", critical: false, notify: "engine",
  viewPermission: "purchasing.view", template: { code: "reminders.purchase.order_late" },
  async open(db, workspaceId, { clock, limit }) {
    const orders = await lateOrders(db, workspaceId, clock.today, null, limit);
    const people = await membershipsOfUsers(db, workspaceId, orders.flatMap((order) => [order.buyer, order.submitter]));
    const items: DueItem[] = [];
    for (const order of orders) {
      const late = await lateLines(db, workspaceId, order.id, clock.today);
      if (!late.length) continue;
      const owner = (order.buyer && people.get(order.buyer)) || (order.submitter && people.get(order.submitter)) || null;
      const submitter = order.submitter ? people.get(order.submitter) ?? null : null;
      const projects = [...new Set(late.map((line) => line.projectId).filter((id): id is string => Boolean(id)))];
      const what = late.slice(0, 3).map((line) => `${line.description} ${outstanding(line).toString()} ${line.unit}`.trim()).join(", ");
      items.push({
        key: `po:${order.id}`, sourceType: "purchase_order", sourceId: order.id, jobSource: projects.length === 1 ? { type: "project", id: projects[0] } : null,
        projectId: projects.length === 1 ? projects[0] : null, caseId: null, partyId: null, ownerMembershipId: owner,
        ccMembershipIds: submitter && submitter !== owner ? [submitter] : [], dueAt: dayStart(late[0].due!, clock), title: `${order.number} · ${order.supplier}`,
        context: `${what}${late.length > 3 ? ` +${late.length - 3}` : ""}`, href: `/workspace/purchasing/orders?order=${encode(order.id)}`, variables: { supplier: order.supplier },
      });
    }
    return items;
  },
  async stillOpen(db, workspaceId, keys, at) {
    const ids = idsOf(keys, "po");
    if (!ids.length) return new Set();
    const today = at?.today ?? new Date().toISOString().slice(0, 10);
    const open: string[] = [];
    for (const order of await lateOrders(db, workspaceId, today, ids, ids.length)) if ((await lateLines(db, workspaceId, order.id, today)).length) open.push(order.id);
    return keysOf("po", open);
  },
};
