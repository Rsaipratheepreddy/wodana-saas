import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { paymentHasFinanceVerifiedReceipt } from "../commercial/finance-ledger";
import { currencyDecimals } from "../purchasing/orders";

type Db = Pick<PoolClient, "query">;

/** Where a milestone's money is: not invoiced, invoiced, reported received (waiting for Finance), or verified. */
export type MilestoneState = "to_invoice" | "invoiced" | "reported" | "verified";

/** One payment milestone of the project's sealed quotations (baseline and variations), with its invoice and receipt. */
export type Milestone = {
  id: string; title: string; trigger: string; amount: string; currency: string; dueDate: string | null; quoteId: string | null;
  requiredForProduction: boolean; state: MilestoneState; reference: string;
  invoice: { id: string; number: string; total: string; dueDate: string } | null;
  receipt: { status: string; reportedBy: string; reportedAt: string; verifiedBy: string | null; verifiedAt: string | null } | null;
};

/**
 * The project's payment milestones, read from the deal (the commercial case) for the quotations sealed on the
 * project, with the tax invoice issued for each and its receipt. Amounts are exact to the currency's minor
 * units. `caseRevision` is the deal's version, for the receipt commands that change it.
 */
export async function readMilestones(db: Db, workspaceId: string, project: { id: string; caseId: string; currency: string }) {
  const quotes = new Set((await db.query<{ quoteId: string | null }>(
    `SELECT quote_id AS "quoteId" FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, project.id])).rows
    .flatMap((row) => (row.quoteId ? [row.quoteId] : [])));
  const loaded = await commercialRepository.load(db as PoolClient, workspaceId, project.caseId);
  const data = loaded ? ({ ...(loaded.content as CommercialData), revision: loaded.revision }) : null;
  const invoices = (await db.query<{ id: string; paymentId: string | null; number: string; total: string; dueDate: string }>(
    `SELECT id, payment_id AS "paymentId", number, total::text AS total, due_date::text AS "dueDate" FROM client_invoices
      WHERE workspace_id = $1 AND (project_id = $2 OR case_id = $3) AND status = 'issued'`, [workspaceId, project.id, project.caseId])).rows;
  const places = currencyDecimals(project.currency);
  const milestones: Milestone[] = (data?.payments ?? []).filter((payment) => payment.sourceQuoteId && quotes.has(payment.sourceQuoteId)).map((payment) => {
    const invoice = invoices.find((row) => row.paymentId === payment.id) ?? null;
    const receipt = [...(data?.receipts ?? [])].reverse().find((row) => row.paymentId === payment.id && row.status !== "rejected") ?? null;
    const verified = data ? paymentHasFinanceVerifiedReceipt(data, payment) : false;
    const state: MilestoneState = verified ? "verified" : receipt || payment.status === "proof_submitted" ? "reported" : invoice ? "invoiced" : "to_invoice";
    return {
      id: payment.id, title: payment.title, trigger: payment.trigger ?? "", amount: Dec.of(payment.amount).round(places).toFixed(places), currency: payment.currency ?? project.currency,
      dueDate: payment.dueDate || null, quoteId: payment.sourceQuoteId ?? null, requiredForProduction: payment.requiredForProduction === true, state, reference: payment.reference ?? "",
      invoice: invoice ? { id: invoice.id, number: invoice.number, total: invoice.total, dueDate: invoice.dueDate } : null,
      receipt: receipt ? { status: receipt.status, reportedBy: receipt.reportedBy, reportedAt: receipt.reportedAt, verifiedBy: receipt.verifiedBy ?? null, verifiedAt: receipt.verifiedAt ?? null } : null,
    };
  }).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  return { milestones, caseRevision: data?.revision ?? null };
}

/** What the client still owes on the project: agreed (baseline and variations) less verified receipts, in the project's currency. */
export async function projectBalance(db: Db, workspaceId: string, project: { id: string; caseId: string; currency: string }) {
  const agreed = (await db.query<{ total: string | null }>(
    `SELECT sum(total)::text AS total FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, project.id])).rows[0]?.total ?? "0";
  const { milestones } = await readMilestones(db, workspaceId, project);
  const received = milestones.filter((milestone) => milestone.state === "verified").reduce((sum, milestone) => sum.add(milestone.amount), Dec.ZERO);
  const places = currencyDecimals(project.currency);
  const due = Dec.of(agreed).sub(received);
  return {
    currency: project.currency, agreed: Dec.of(agreed).toFixed(places), received: received.toFixed(places),
    due: due.cmp(0) > 0 ? due.toFixed(places) : Dec.ZERO.toFixed(places),
    /** Milestones not invoiced yet (the plan's payment schedule still to bill). */
    toInvoice: milestones.filter((milestone) => milestone.state === "to_invoice"),
    /** Invoiced or reported, and not verified yet. */
    unpaid: milestones.filter((milestone) => milestone.state === "invoiced" || milestone.state === "reported"),
  };
}
