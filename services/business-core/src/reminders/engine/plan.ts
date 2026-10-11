import { createHash } from "node:crypto";
import { ENGINE_REMINDER_KINDS, type EngineReminderKind } from "../reminders-contract";
import type { EngineContext } from "./context";
import { planSteps, type Db, type PlannedStep, type ReminderRule } from "./engine";

/** A subject first seen late sends its latest missed reminder only when it was due within this long. */
export const CATCH_UP_MS = 7 * 86_400_000;
/** At most this many subjects are (re)planned per pass. */
export const PLAN_LIMIT = 500;

/** What a subject's steps were planned for: its due revision and the rule's cadence. A change plans again. */
export function planKeyOf(revision: number, rule: Pick<ReminderRule, "enabled" | "offsets" | "unit" | "workingDays" | "version">) {
  const cadence = createHash("sha1").update(`${rule.enabled ? 1 : 0}|${rule.unit}|${rule.workingDays ? 1 : 0}|${rule.offsets.join(",")}|${rule.version}`).digest("hex").slice(0, 16);
  return `${revision}:${cadence}`;
}

/**
 * Which planned steps to write. The first plan of a due revision writes the future steps and the latest missed one
 * (when it was due within the catch-up window), so a subject first seen late never sends its whole history. A plan
 * again on the same revision (the rule changed) writes only future steps.
 */
export function stepsToWrite(steps: readonly PlannedStep[], now: Date, firstPlan: boolean): PlannedStep[] {
  const at = now.getTime();
  if (!firstPlan) return steps.filter((step) => step.fireAt.getTime() > at);
  return steps.filter((step) => !step.stale && step.fireAt.getTime() >= at - CATCH_UP_MS);
}

type PlanRow = { id: string; kind: EngineReminderKind; dueAt: Date; dueRevision: number; planKey: string | null };

export type PlanResult = { planned: number; steps: number };

/**
 * Plans the steps of open subjects whose due moment or rule changed since their last plan (plan §6.24a "Plan"):
 * steps of an earlier revision that haven't fired are cancelled, steps the rule no longer has are cancelled, and the
 * rule's offsets are written once (UNIQUE subject, revision, step key). A kind switched off skips what is planned.
 * Escalation steps are planned later, by the fire step, once enough reminders went unanswered.
 */
export async function planSubjects(db: Db, ctx: EngineContext, options: { limit?: number } = {}): Promise<PlanResult> {
  const result: PlanResult = { planned: 0, steps: 0 };
  const rows = (await db.query<PlanRow>(
    `SELECT id, kind, due_at AS "dueAt", due_revision AS "dueRevision", plan_key AS "planKey" FROM reminder_subjects
      WHERE workspace_id = $1 AND status IN ('open', 'snoozed') AND due_at IS NOT NULL AND kind = ANY($2::text[])
      ORDER BY due_at, id`, [ctx.workspaceId, [...ENGINE_REMINDER_KINDS].filter((kind) => ctx.sources.has(kind))])).rows;
  const limit = options.limit ?? PLAN_LIMIT;
  for (const row of rows) {
    if (result.planned >= limit) break;
    const rule = ctx.rules.get(row.kind);
    if (!rule) continue;
    const revision = Number(row.dueRevision);
    const key = planKeyOf(revision, rule);
    if (row.planKey === key) continue;
    const firstPlan = !row.planKey || row.planKey.split(":")[0] !== String(revision);
    await db.query(
      `UPDATE reminder_steps SET state = 'cancelled', hold_reason = NULL, held_until = NULL, version = version + 1, updated_at = $4
        WHERE workspace_id = $1 AND subject_id = $2 AND due_revision < $3 AND state IN ('planned', 'held')`, [ctx.workspaceId, row.id, revision, ctx.now]);
    if (!rule.enabled) {
      await db.query(
        `UPDATE reminder_steps SET state = 'skipped', skip_reason = 'disabled', hold_reason = NULL, held_until = NULL, version = version + 1, updated_at = $4
          WHERE workspace_id = $1 AND subject_id = $2 AND due_revision = $3 AND state IN ('planned', 'held') AND kind = 'remind'`, [ctx.workspaceId, row.id, revision, ctx.now]);
    } else {
      const plan = planSteps(rule, new Date(row.dueAt), ctx.clock, { now: ctx.now });
      await db.query(
        `UPDATE reminder_steps SET state = 'cancelled', hold_reason = NULL, held_until = NULL, version = version + 1, updated_at = $5
          WHERE workspace_id = $1 AND subject_id = $2 AND due_revision = $3 AND kind = 'remind' AND state IN ('planned', 'held') AND NOT (step_key = ANY($4::text[]))`,
        [ctx.workspaceId, row.id, revision, plan.steps.map((step) => step.stepKey), ctx.now]);
      for (const step of stepsToWrite(plan.steps, ctx.now, firstPlan)) {
        const written = await db.query(
          `INSERT INTO reminder_steps (workspace_id, subject_id, due_revision, step_key, kind, level, fire_at, state, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'remind', 0, $5, 'planned', $6, $6)
           ON CONFLICT (workspace_id, subject_id, due_revision, step_key) DO UPDATE SET state = 'planned', fire_at = EXCLUDED.fire_at, skip_reason = NULL,
             hold_reason = NULL, held_until = NULL, version = reminder_steps.version + 1, updated_at = EXCLUDED.updated_at
           WHERE reminder_steps.state = 'cancelled' OR (reminder_steps.state = 'planned' AND reminder_steps.fire_at <> EXCLUDED.fire_at)`,
          [ctx.workspaceId, row.id, revision, step.stepKey, step.fireAt, ctx.now]);
        result.steps += written.rowCount ?? 0;
      }
    }
    await db.query(`UPDATE reminder_subjects SET plan_key = $3 WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, row.id, key]);
    result.planned += 1;
  }
  return result;
}
