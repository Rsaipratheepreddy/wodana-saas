import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { parsePaymentTerms } from "./commercial.domain";
import type { PaymentTerm } from "./commercial.types";

type Db = Pick<PoolClient, "query">;

export type DefaultPaymentPlan = { id: string; version: number; name: string; milestones: PaymentTerm[] };

/**
 * The firm's default payment plan (Q-34): the active payment template chosen in Settings → Quotations, or set
 * up from the firm kit. A new quote starts with its milestones (fresh ids, so editing one quote never touches
 * another); people change them on the quote as before. Null when the firm chose none.
 */
export async function readDefaultPaymentPlan(db: Db, workspaceId: string): Promise<DefaultPaymentPlan | null> {
  const row = (await db.query<{ id: string; version: number; name: string; milestones: unknown }>(
    `SELECT template.id, template.version, template.name, template.milestones
       FROM workspace_quotation_settings settings
       JOIN commercial_payment_templates template ON template.workspace_id = settings.workspace_id AND template.id = settings.default_payment_template_id
      WHERE settings.workspace_id = $1 AND template.status = 'active'`, [workspaceId])).rows[0];
  if (!row) return null;
  try { return { id: row.id, version: Number(row.version), name: row.name, milestones: parsePaymentTerms(row.milestones) }; }
  catch { return null; }
}

/** A new quote's own copy of the plan's milestones. */
export function startingMilestones(plan: DefaultPaymentPlan | null): { paymentTerms: PaymentTerm[]; paymentTemplate?: { id: string; version: number; name: string } } {
  if (!plan?.milestones.length) return { paymentTerms: [] };
  return { paymentTerms: plan.milestones.map((term) => ({ ...term, id: randomUUID() })), paymentTemplate: { id: plan.id, version: plan.version, name: plan.name } };
}

/**
 * A firm kit's payment plan (`configuration.paymentTemplate: { name, milestones }`), made the new workspace's
 * first payment template and its default. A kit without one leaves the workspace without a default.
 */
export async function seedKitPaymentPlan(db: Db, workspaceId: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kit = value as { name?: unknown; milestones?: unknown };
  const name = typeof kit.name === "string" && kit.name.trim() ? kit.name.trim().slice(0, 160) : "Standard";
  let milestones: PaymentTerm[];
  try { milestones = parsePaymentTerms(Array.isArray(kit.milestones) ? kit.milestones.map((term, index) => ({ id: `m${index + 1}`, ...(term as object) })) : [], true); }
  catch { return null; }
  const id = randomUUID();
  await db.query(`INSERT INTO commercial_payment_templates (id, workspace_id, name, version, milestones) VALUES ($1, $2, $3, 1, $4::jsonb)`,
    [id, workspaceId, name, JSON.stringify(milestones)]);
  await db.query(
    `INSERT INTO workspace_quotation_settings (workspace_id, default_payment_template_id) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET default_payment_template_id = excluded.default_payment_template_id`, [workspaceId, id]);
  return id;
}
