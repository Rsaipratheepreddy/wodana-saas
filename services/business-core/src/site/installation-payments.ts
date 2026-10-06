import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { readMilestones, type Milestone } from "../project-core/project-milestones";
import { currencyDecimals } from "../common/currency";

type Db = Pick<PoolClient, "query">;

/** One payment stage the client owes before installation is signed off. */
export type OwedStage = { id: string; title: string; amount: string; currency: string; state: Milestone["state"] };
/** What the client still owes before installation, per currency (a project's stages normally share one). */
export type InstallationOwed = { stages: OwedStage[]; totals: Array<{ currency: string; amount: string }> };

/**
 * PLM-065 / PLM-067: the payment stages due before installation, read from the payment terms' own flags (never their
 * words): the advance before the work is released, the payment before production, and the stage a factory work order
 * names as falling due when it is ready (the balance before installation). The ones Finance hasn't verified are owed.
 */
export function owedBeforeInstallation(milestones: Milestone[], readyStageIds: Set<string>): InstallationOwed {
  const stages = milestones
    .filter((milestone) => milestone.requiredForRelease || milestone.requiredForProduction || readyStageIds.has(milestone.id))
    .filter((milestone) => milestone.state !== "verified")
    .map(({ id, title, amount, currency, state }) => ({ id, title, amount, currency, state }));
  const totals = new Map<string, Dec>();
  for (const stage of stages) totals.set(stage.currency, (totals.get(stage.currency) ?? Dec.ZERO).add(stage.amount));
  return { stages, totals: [...totals].map(([currency, amount]) => ({ currency, amount: amount.toFixed(currencyDecimals(currency)) })) };
}

/** The words for what is owed: "AED 25000.00 (Balance before installation)". */
export function owedText(owed: InstallationOwed) {
  const totals = owed.totals.map((total) => `${total.currency} ${total.amount}`).join(" and ");
  return `${totals} (${owed.stages.map((stage) => stage.title).join(", ")})`;
}

/** What the project's client still owes before its installation is signed off. */
export async function readInstallationOwed(db: Db, workspaceId: string, project: { id: string; caseId: string; currency: string }) {
  const { milestones } = await readMilestones(db, workspaceId, project);
  const ready = (await db.query<{ paymentId: string }>(
    `SELECT DISTINCT ready_payment_id AS "paymentId" FROM work_orders WHERE workspace_id = $1 AND project_id = $2 AND ready_payment_id IS NOT NULL AND status <> 'cancelled'`,
    [workspaceId, project.id])).rows.map((row) => row.paymentId);
  return owedBeforeInstallation(milestones, new Set(ready));
}
