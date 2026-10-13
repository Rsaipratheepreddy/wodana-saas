import { addDays } from "../../booking/booking.domain";
import { paymentDueItem, recordPaymentReminder } from "../../crm/conversations/crm-payment-reminders.service";
import { readInvoices, withBalances } from "../../receivables/receivables";
import { deliverClientDefault } from "../delivery/client-router";
import { membershipsOfUsers, readPermissionHolders } from "../delivery/people";
import { localDate, type DueItem, type ReminderSource } from "../engine/engine";
import { daysBetween } from "../engine/text";
import { dayStart, encode, idsOf, keysOf, managersByProject, money, readCases, UUID } from "./support";

const paymentKey = (caseId: string, paymentId: string) => `payment:${caseId}:${paymentId}`;
function parsePaymentKey(key: string) {
  const [prefix, caseId, ...rest] = key.split(":");
  const paymentId = rest.join(":");
  return prefix === "payment" && UUID.test(caseId ?? "") && paymentId ? { caseId, paymentId } : null;
}

/**
 * A money reminder's title: the record's reference and whom it is with ("FAC-INV-2026-00003 · Reem Al Marzouqi",
 * "INV-1 · Gulf Timber"), so every subject reads "reference · client or supplier · when" in the app, push, email and
 * digest. The context leads with the same party and the amount; My day names the party once.
 */
export function moneyTitle(reference: string | null | undefined, party: string | null | undefined): string {
  return [reference, party].map((part) => (part ?? "").trim()).filter(Boolean).join(" · ");
}

async function workspaceToday(db: Parameters<ReminderSource["open"]>[0], workspaceId: string, at: Date) {
  const zone = (await db.query<{ zone: string | null }>(`SELECT nullif(default_timezone, '') AS zone FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.zone ?? "UTC";
  return localDate(at, zone);
}

/**
 * payment.due (critical, priority 1; replaces the automatic schedule of payment reminders): a client payment stage
 * still owed. The client hears 3 days before, on the day, and 3 and 7 days after (the firm's payment reminder days,
 * copied into its rule) on WhatsApp ("Payment reminder", with the amount still due) or by branded email; each send is
 * logged on the payment like "Send reminder". Done when nothing is owed, or the client reported it paid or Finance
 * verified it.
 */
export const paymentDueSource: ReminderSource = {
  kind: "payment.due", module: "finance", audience: "client", critical: true, notify: "engine",
  viewPermission: "receivables.view", template: { code: "reminders.payment.due" },
  async open(db, workspaceId, { clock, limit }) {
    const rows = (await db.query<{ caseId: string; paymentId: string }>(
      `SELECT payment.case_id AS "caseId", payment.id AS "paymentId" FROM commercial_payments payment
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = payment.workspace_id AND pre_case.id = payment.case_id AND pre_case.status <> 'cancelled'
        WHERE payment.workspace_id = $1 AND payment.status = 'pending' AND payment.amount > 0 AND payment.due_date BETWEEN $2::date AND $3::date
        ORDER BY payment.due_date, payment.case_id, payment.id LIMIT $4`, [workspaceId, addDays(clock.today, -30), addDays(clock.today, 30), limit])).rows;
    const cases = await readCases(db, workspaceId, rows.map((row) => row.caseId));
    const items: DueItem[] = [];
    for (const row of rows) {
      const item = await paymentDueItem(db, workspaceId, row.caseId, row.paymentId, clock.today);
      const facts = cases.get(row.caseId);
      if (!item || item.status !== "pending" || !item.dueDate || !facts) continue;
      const owner = facts.ownerMembershipId ?? facts.accountMembershipId;
      items.push({
        key: paymentKey(row.caseId, row.paymentId), sourceType: "commercial_payment", sourceId: `${row.caseId}:${row.paymentId}`,
        jobSource: { type: "case", id: row.caseId }, projectId: facts.projectId, caseId: row.caseId, partyId: facts.partyId, ownerMembershipId: owner,
        ccMembershipIds: facts.accountMembershipId && facts.accountMembershipId !== owner ? [facts.accountMembershipId] : [],
        dueAt: dayStart(item.dueDate, clock), title: item.title, context: `${facts.client} · ${money(item.currency, item.amount)}`,
        href: item.invoiceId ? `/workspace/finance/client-invoices?invoice=${encode(item.invoiceId)}` : `/workspace/pre-projects/cases/${encode(row.caseId)}/payment-plan`,
        variables: { client: facts.client, clientContext: `${facts.title} · ${money(item.currency, item.amount)}` },
      });
    }
    return items;
  },
  async stillOpen(db, workspaceId, keys, at) {
    const today = at?.today ?? await workspaceToday(db, workspaceId, new Date());
    const open = new Set<string>();
    for (const key of keys) {
      const parsed = parsePaymentKey(key);
      if (!parsed) continue;
      const item = await paymentDueItem(db, workspaceId, parsed.caseId, parsed.paymentId, today);
      if (item?.status === "pending" && item.dueDate && item.dueDate <= addDays(today, 30)) open.add(key);
    }
    return open;
  },
  async deliverClient(db, workspaceId, delivery) {
    const parsed = parsePaymentKey(delivery.subject.sourceKey);
    const today = await workspaceToday(db, workspaceId, delivery.now);
    const item = parsed ? await paymentDueItem(db, workspaceId, parsed.caseId, parsed.paymentId, today) : null;
    if (!item || item.status !== "pending") return { status: "skipped", channel: null, notificationIds: [], reason: "disabled" };
    const result = await deliverClientDefault(db, workspaceId, { ...delivery, variables: { ...delivery.variables, context: delivery.variables.clientContext ?? "" } }, {
      whatsappEvent: "payments.reminder", section: "payments", approversOnly: false,
      record: { paymentId: item.paymentId, invoiceId: item.invoiceId, amountDue: { amount: item.amount, currency: item.currency } },
    });
    if (result.status === "queued" && result.channel) {
      const messageId = result.channel === "whatsapp" ? (await db.query<{ messageId: string }>(
        `SELECT substring(idempotency_key FROM 9) AS "messageId" FROM notifications WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND idempotency_key LIKE 'message:%' LIMIT 1`,
        [workspaceId, result.notificationIds])).rows[0]?.messageId ?? null : null;
      await recordPaymentReminder(db, workspaceId, item, today, item.dueDate ? daysBetween(item.dueDate, today) : null, result.channel, messageId, null);
    }
    return result;
  },
};

/**
 * invoice.overdue (critical; replaces processReceivablesOverdue): an issued client invoice past its due date with a
 * balance. The project manager and Finance (receivables.manage) hear 1, 7 and 14 days after, then Finance and the
 * owner. Done when the balance is nothing, or it was credited.
 */
export const invoiceOverdueSource: ReminderSource = {
  kind: "invoice.overdue", module: "finance", audience: "staff", critical: true, notify: "engine",
  viewPermission: "receivables.view", template: { code: "reminders.invoice.overdue" },
  async open(db, workspaceId, { clock, limit }) {
    const issued = (await readInvoices(db, workspaceId)).filter((invoice) => invoice.status === "issued" && invoice.dueDate < clock.today && invoice.dueDate >= addDays(clock.today, -120));
    const overdue = (await withBalances(db, workspaceId, issued, clock.today)).filter((invoice) => invoice.overdue).slice(0, limit);
    const finance = await readPermissionHolders(db, workspaceId, ["receivables.manage"]);
    const managers = await managersByProject(db, workspaceId, overdue.map((invoice) => invoice.projectId));
    return overdue.map((invoice): DueItem => {
      const owner = managers.get(invoice.projectId)?.[0] ?? finance[0] ?? null;
      return {
        key: `invoice:${invoice.id}`, sourceType: "client_invoice", sourceId: invoice.id, jobSource: { type: "project", id: invoice.projectId },
        projectId: invoice.projectId, caseId: invoice.caseId, partyId: null, ownerMembershipId: owner, ccMembershipIds: finance.filter((id) => id !== owner),
        dueAt: dayStart(invoice.dueDate, clock), title: moneyTitle(invoice.number, invoice.customerName),
        context: [invoice.customerName, money(invoice.currency, invoice.balance)].filter(Boolean).join(" · "),
        href: `/workspace/finance/client-invoices?invoice=${encode(invoice.id)}`, variables: { client: invoice.customerName },
      };
    });
  },
  async stillOpen(db, workspaceId, keys, at) {
    const ids = new Set(idsOf(keys, "invoice"));
    if (!ids.size) return new Set();
    const today = at?.today ?? await workspaceToday(db, workspaceId, new Date());
    const invoices = (await readInvoices(db, workspaceId)).filter((invoice) => ids.has(invoice.id));
    return keysOf("invoice", (await withBalances(db, workspaceId, invoices, today)).filter((invoice) => invoice.overdue).map((invoice) => invoice.id));
  },
};

/**
 * payables.due (critical; replaces processPayablesDue): an approved supplier bill with something left to pay. The people
 * who pay suppliers (payables.manage) hear 3 days before, on the day and 3 days after, then Finance and the owner.
 * Done when it is paid, or no longer approved (cancelled or held).
 */
export const payablesDueSource: ReminderSource = {
  kind: "payables.due", module: "finance", audience: "staff", critical: true, notify: "engine",
  viewPermission: "payables.manage", template: { code: "reminders.payables.due" },
  async open(db, workspaceId, { clock, limit }) {
    const rows = (await db.query<{ id: string; vendorId: string; supplier: string; number: string; dueDate: string; currency: string; balance: string; projectId: string | null }>(
      `SELECT bill.id, bill.vendor_id AS "vendorId", vendor.display_name AS supplier, bill.number, bill.due_date::text AS "dueDate", bill.currency,
              (bill.total - coalesce(paid.amount, 0) - coalesce(kept.amount, 0) + coalesce(freed.amount, 0))::numeric(18, 4)::text AS balance, NULL::uuid AS "projectId"
         FROM supplier_invoices bill
         JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id AND vendor.id = bill.vendor_id
         LEFT JOIN LATERAL (SELECT sum(allocation.amount) AS amount FROM supplier_payment_allocations allocation
                              JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id AND payment.id = allocation.payment_id AND payment.status = 'recorded'
                             WHERE allocation.workspace_id = bill.workspace_id AND allocation.invoice_id = bill.id) paid ON true
         LEFT JOIN LATERAL (SELECT sum(amount) AS amount FROM supplier_invoice_retentions WHERE workspace_id = bill.workspace_id AND invoice_id = bill.id) kept ON true
         LEFT JOIN LATERAL (SELECT sum(amount) AS amount FROM supplier_retention_releases WHERE workspace_id = bill.workspace_id AND invoice_id = bill.id) freed ON true
        WHERE bill.workspace_id = $1 AND bill.status = 'approved' AND bill.due_date BETWEEN $2::date AND $3::date
          AND bill.total - coalesce(kept.amount, 0) + coalesce(freed.amount, 0) > coalesce(paid.amount, 0)
        ORDER BY bill.due_date, vendor.display_name, bill.number LIMIT $4`, [workspaceId, addDays(clock.today, -60), addDays(clock.today, 14), limit])).rows;
    const payers = await readPermissionHolders(db, workspaceId, ["payables.manage"]);
    return rows.map((row): DueItem => ({
      key: `bill:${row.id}`, sourceType: "supplier_invoice", sourceId: row.id, jobSource: null, projectId: row.projectId, caseId: null, partyId: null,
      ownerMembershipId: null, ccMembershipIds: payers, dueAt: dayStart(row.dueDate, clock), title: moneyTitle(row.number, row.supplier),
      context: `${row.supplier} · ${money(row.currency, row.balance)}`, href: `/workspace/finance/suppliers/${encode(row.vendorId)}`, variables: { supplier: row.supplier },
    }));
  },
  async stillOpen(db, workspaceId, keys, at) {
    const ids = idsOf(keys, "bill");
    if (!ids.length) return new Set();
    return keysOf("bill", (await db.query<{ id: string }>(
      `SELECT bill.id FROM supplier_invoices bill
         LEFT JOIN LATERAL (SELECT sum(allocation.amount) AS amount FROM supplier_payment_allocations allocation
                              JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id AND payment.id = allocation.payment_id AND payment.status = 'recorded'
                             WHERE allocation.workspace_id = bill.workspace_id AND allocation.invoice_id = bill.id) paid ON true
         LEFT JOIN LATERAL (SELECT sum(amount) AS amount FROM supplier_invoice_retentions WHERE workspace_id = bill.workspace_id AND invoice_id = bill.id) kept ON true
         LEFT JOIN LATERAL (SELECT sum(amount) AS amount FROM supplier_retention_releases WHERE workspace_id = bill.workspace_id AND invoice_id = bill.id) freed ON true
        WHERE bill.workspace_id = $1 AND bill.id = ANY($2::uuid[]) AND bill.status = 'approved' AND bill.due_date IS NOT NULL
          AND ($3::date IS NULL OR bill.due_date <= $3::date + 14)
          AND bill.total - coalesce(kept.amount, 0) + coalesce(freed.amount, 0) > coalesce(paid.amount, 0)`, [workspaceId, ids, at?.today ?? null])).rows.map((row) => row.id));
  },
};

/**
 * finance_request.waiting (new): a request to Finance (an invoice, a refund, a supplier payment) nobody has picked up.
 * Its handler, else everyone who works the Finance requests board, hears 1 and 3 days after it was raised, then
 * Finance and the owner. Done when its status changes.
 */
export const financeRequestSource: ReminderSource = {
  kind: "finance_request.waiting", module: "finance", audience: "staff", critical: false, notify: "engine",
  viewPermission: "finance_requests.manage", template: { code: "reminders.finance_request.waiting" },
  async open(db, workspaceId, { now, limit }) {
    const rows = (await db.query<{ id: string; number: number; kind: string; createdAt: Date; handledBy: string | null; requester: string; who: string; projectId: string | null; caseId: string | null; opportunityId: string | null; currency: string; total: string }>(
      `SELECT request.id, request.number, request.kind, request.created_at AS "createdAt", request.handled_by AS "handledBy", request.requested_by AS requester,
              coalesce(party.display_name, vendor.display_name, '') AS who, request.project_id AS "projectId", request.case_id AS "caseId",
              request.opportunity_id AS "opportunityId", request.currency, request.total_amount::text AS total
         FROM finance_requests request
         LEFT JOIN crm_parties party ON party.workspace_id = request.workspace_id AND party.id = request.party_id
         LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = request.workspace_id AND vendor.id = request.vendor_id
        WHERE request.workspace_id = $1 AND request.status = 'new' AND request.created_at >= $2::timestamptz - interval '90 days'
        ORDER BY request.created_at DESC LIMIT $3`, [workspaceId, now, limit])).rows;
    const handlers = await membershipsOfUsers(db, workspaceId, rows.map((row) => row.handledBy));
    const finance = await readPermissionHolders(db, workspaceId, ["finance_requests.manage"]);
    const label: Record<string, string> = { invoice: "Invoice request", refund: "Refund request", payable: "Supplier payment request" };
    return rows.map((row): DueItem => {
      const owner = row.handledBy ? handlers.get(row.handledBy) ?? null : null;
      return {
        key: `finance_request:${row.id}`, sourceType: "finance_request", sourceId: row.id,
        jobSource: row.projectId ? { type: "project", id: row.projectId } : row.opportunityId ? { type: "opportunity", id: row.opportunityId } : null,
        projectId: row.projectId, caseId: UUID.test(row.caseId ?? "") ? row.caseId : null, partyId: null, ownerMembershipId: owner, ccMembershipIds: owner ? [] : finance,
        dueAt: new Date(row.createdAt), title: `${label[row.kind] ?? "Finance request"} ${row.number}`, context: [row.who, money(row.currency, row.total)].filter(Boolean).join(" · "),
        href: `/workspace/finance/requests?request=${encode(row.id)}`, variables: {},
      };
    });
  },
  async stillOpen(db, workspaceId, keys) {
    const ids = idsOf(keys, "finance_request");
    if (!ids.length) return new Set();
    return keysOf("finance_request", (await db.query<{ id: string }>(
      `SELECT id FROM finance_requests WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'new'`, [workspaceId, ids])).rows.map((row) => row.id));
  },
};
