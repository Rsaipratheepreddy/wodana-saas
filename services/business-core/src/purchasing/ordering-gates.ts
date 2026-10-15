import type { PoolClient } from "pg";
import { boqApproved } from "../project-core/project-boq-state";
import { projectNeedsDrawings } from "../project-core/project-drawing-needs";
import { readDrawingFacts } from "../project-core/project-drawings";
import { materialListConfirmed } from "../project-core/project-materials";
import { priceHolds } from "./price-hold";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-159: the ordering gate's optional checks, each a purchasing setting (off by default, so other firms are unchanged):
 *   drawings_verified        the project's technical drawings (or data sheets) passed their check, where any item needs them;
 *   boq_approved             the project BOQ is QS-approved or locked (PLM-163);
 *   price_approved           no line of the order is held for a price the client hasn't approved (PLM-169);
 *   qs_signoff               the QS signed off the draft order;
 *   material_list_confirmed  the QS confirmed the project's material list as it is now.
 * Someone who approves orders may mark any check "Not applicable" on one order, with a reason: recorded, shown and audited.
 */
export const GATE_KEYS = ["drawings_verified", "boq_approved", "price_approved", "qs_signoff", "material_list_confirmed"] as const;
export type GateKey = (typeof GATE_KEYS)[number];
export type GateWaiver = { reason: string; byName: string | null; at: string };
export type GateCheck = { key: GateKey; required: boolean; passed: boolean; missing: string; waiver: GateWaiver | null };
export type GateSettings = { requireDrawingsVerified: boolean; requireBoqApproved: boolean; requirePriceApproval: boolean; requireQsSignoff: boolean; requireMaterialListConfirmed: boolean };

/** The first check that stops the order: required, not passed, not marked "Not applicable". Pure. */
export function gateBlocks(checks: GateCheck[]): GateCheck | null {
  return checks.find((check) => check.required && !check.passed && !check.waiver) ?? null;
}

/** One check's row from the facts: which setting makes it required, and what's missing in plain words. Pure. */
export function gateCheck(key: GateKey, settings: GateSettings, facts: { passed: boolean; missing: string; waiver: GateWaiver | null; applies?: boolean }): GateCheck {
  const required = (key === "drawings_verified" ? settings.requireDrawingsVerified : key === "boq_approved" ? settings.requireBoqApproved : key === "price_approved" ? settings.requirePriceApproval
    : key === "qs_signoff" ? settings.requireQsSignoff : settings.requireMaterialListConfirmed) && facts.applies !== false;
  return { key, required, passed: facts.passed, missing: facts.passed ? "" : facts.missing, waiver: facts.waiver };
}

/** The checks on one order, from the records: the projects on its lines, the BOQ, the drawings, the price holds and the sign-offs. */
export async function readGate(db: Db, workspaceId: string, order: { id: string; qsSignedOffAt: string | null }, settings: GateSettings): Promise<GateCheck[]> {
  const waivers = new Map((await db.query<{ key: GateKey; reason: string; byName: string | null; at: string }>(
    `SELECT waiver.check_key AS key, waiver.reason, person.display_name AS "byName", waiver.waived_at AS at FROM purchase_order_gate_waivers waiver LEFT JOIN users person ON person.id = waiver.waived_by
      WHERE waiver.workspace_id = $1 AND waiver.order_id = $2`, [workspaceId, order.id])).rows.map((row) => [row.key, { reason: row.reason, byName: row.byName, at: row.at } as GateWaiver]));
  const waiver = (key: GateKey) => waivers.get(key) ?? null;
  const projects = (await db.query<{ id: string; reference: string }>(
    `SELECT DISTINCT project.id, project.reference FROM purchase_order_lines line JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
      WHERE line.workspace_id = $1 AND line.order_id = $2 AND line.source IN ('material', 'line') ORDER BY project.reference`, [workspaceId, order.id])).rows;
  const forProjects = Boolean(projects.length);
  const checks: GateCheck[] = [];
  // Drawings: each project whose items need technical drawings has its latest revision checked (on site or against the design) or approved.
  const drawingsMissing: string[] = [];
  if (settings.requireDrawingsVerified) for (const project of projects) {
    if (!(await projectNeedsDrawings(db, workspaceId, project.id))) continue;
    const facts = await readDrawingFacts(db, workspaceId, project.id);
    if (!(facts.approved || facts.siteChecked || facts.designChecked)) drawingsMissing.push(project.reference);
  }
  checks.push(gateCheck("drawings_verified", settings, { applies: forProjects, passed: !drawingsMissing.length, waiver: waiver("drawings_verified"),
    missing: `The technical drawings of ${drawingsMissing.join(", ")} aren't verified yet.` }));
  const boqMissing: string[] = [];
  if (settings.requireBoqApproved) for (const project of projects) if (!(await boqApproved(db, workspaceId, project.id))) boqMissing.push(project.reference);
  checks.push(gateCheck("boq_approved", settings, { applies: forProjects, passed: !boqMissing.length, waiver: waiver("boq_approved"),
    missing: `The BOQ of ${boqMissing.join(", ")} isn't approved by the QS yet.` }));
  const holds = settings.requirePriceApproval && forProjects ? [...(await priceHolds(db, workspaceId, { orderId: order.id })).values()] : [];
  checks.push(gateCheck("price_approved", settings, { applies: forProjects, passed: !holds.length, waiver: waiver("price_approved"),
    missing: `${holds.slice(0, 3).join("; ")}${holds.length > 3 ? ` and ${holds.length - 3} more` : ""}.` }));
  checks.push(gateCheck("qs_signoff", settings, { passed: Boolean(order.qsSignedOffAt), waiver: waiver("qs_signoff"), missing: "The QS hasn't signed off this order yet." }));
  const listMissing: string[] = [];
  if (settings.requireMaterialListConfirmed) for (const project of projects) if (!(await materialListConfirmed(db, workspaceId, project.id))) listMissing.push(project.reference);
  checks.push(gateCheck("material_list_confirmed", settings, { applies: forProjects, passed: !listMissing.length, waiver: waiver("material_list_confirmed"),
    missing: `The QS hasn't confirmed the material list of ${listMissing.join(", ")} yet.` }));
  return checks;
}

/** Marks a check "Not applicable" on one order with the reason (replacing an earlier mark). */
export async function waiveGateCheck(db: Db, workspaceId: string, orderId: string, key: GateKey, reason: string, userId: string) {
  await db.query(
    `INSERT INTO purchase_order_gate_waivers (workspace_id, order_id, check_key, reason, waived_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, order_id, check_key) DO UPDATE SET reason = EXCLUDED.reason, waived_by = EXCLUDED.waived_by, waived_at = now()`, [workspaceId, orderId, key, reason, userId]);
}

/** Takes a "Not applicable" mark off; false when there was none. */
export async function clearGateWaiver(db: Db, workspaceId: string, orderId: string, key: GateKey) {
  return Boolean((await db.query(`DELETE FROM purchase_order_gate_waivers WHERE workspace_id = $1 AND order_id = $2 AND check_key = $3`, [workspaceId, orderId, key])).rowCount);
}
