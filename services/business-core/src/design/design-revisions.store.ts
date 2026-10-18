import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { createChange } from "../change-requests/change-request.store";
import { changeReference, type ChangeStatus } from "../change-requests/change-request.domain";
import { projectForChanges, raiseProjectChange } from "../change-requests/project-changes.store";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { financeGatePaymentsReady } from "../commercial/release-integrity";
import { postJobEvent } from "../jobs/job-thread";
import { STAGE_LABELS, type JourneyStage } from "./design-journey.domain";
import { caseFacts, leadDesigner, tellMembers } from "./design-journey.store";
import {
  changesAsked, extraRevisionClosed, extraRevisionTitle, includedRevisions, stepRevisions, WAITING_FOR_EXTRA_REVISION, type ExtraChange, type StepRevisions,
} from "./design-revisions.domain";
import { DELIVERABLE_STAGES, isDeliverableStage, type DeliverableStage } from "./design-stage-sync";

type Db = Pick<PoolClient, "query">;

/**
 * Free design revisions, then a chargeable change (PLM-049/051), on the records: the client's "changes requested" on a
 * step's presentation rounds and on its files (from the portal, or recorded by the team with where the client said it)
 * are counted per step; the ask beyond the package's free revisions drafts a change request in the change module, linked
 * to the step (design_extra_revisions), and the step's next revision waits until that change is approved and paid.
 */

/** Changes the client asked for per step: the most on any one of its deliverables (presentation rounds, or one file). */
export async function changesAskedByStage(db: Db, workspaceId: string, caseId: string): Promise<Map<string, number>> {
  const rounds = (await db.query<{ stage: string; asked: number }>(
    `SELECT stage, count(*)::int AS asked FROM design_presentations WHERE workspace_id = $1 AND case_id = $2 AND status = 'changes_requested' GROUP BY stage`,
    [workspaceId, caseId])).rows;
  // A client decision on a file: from the portal (its grant), or recorded by the team with where the client gave it. An
  // internal reviewer sending a file back is not the client's ask.
  const files = (await db.query<{ stage: string; asked: number }>(
    `SELECT design.stage, per_file.asked::int AS asked
       FROM (SELECT activity.design_id, count(*) AS asked FROM pre_project_design_activity activity
              WHERE activity.workspace_id = $1 AND activity.case_id = $2 AND activity.action = 'changes_requested'
                AND (activity.client_grant_id IS NOT NULL OR activity.decision_source IS NOT NULL)
              GROUP BY activity.design_id) per_file
       JOIN pre_project_designs design ON design.workspace_id = $1 AND design.id = per_file.design_id
      WHERE design.stage IS NOT NULL`, [workspaceId, caseId])).rows;
  const asked = new Map<string, number>();
  for (const stage of DELIVERABLE_STAGES)
    asked.set(stage, changesAsked({ presentations: rounds.find((row) => row.stage === stage)?.asked ?? 0, files: files.filter((row) => row.stage === stage).map((row) => row.asked) }));
  return asked;
}

type LinkRow = { stage: string; revision: number; changeRequestId: string; number: number; status: ChangeStatus; projectId: string | null; quoteId: string | null; caseId: string };

/** The current extra-revision change of each step (the latest revision linked), with its change's status. */
async function currentLinks(db: Db, workspaceId: string, caseId: string, stage?: string) {
  return (await db.query<LinkRow>(
    `SELECT DISTINCT ON (link.stage) link.stage, link.revision, link.change_request_id AS "changeRequestId", change.number, change.status, change.project_id AS "projectId",
            change.quote_id AS "quoteId", change.case_id AS "caseId"
       FROM design_extra_revisions link
       JOIN change_requests change ON change.workspace_id = link.workspace_id AND change.id = link.change_request_id
      WHERE link.workspace_id = $1 AND link.case_id = $2 AND link.replaced_at IS NULL AND ($3::text IS NULL OR link.stage = $3)
      ORDER BY link.stage, link.revision DESC`, [workspaceId, caseId, stage ?? null])).rows;
}

/**
 * Whether the payment the firm asks for before a change's work is in. A change on a planning record has no payment of
 * its own (approval is the agreement); on a started project, where the firm requires the variation paid before its
 * work, the variation's payments marked "before the work" must be finance-verified. Worked out from the records.
 */
async function extraPaid(db: Db, workspaceId: string, link: LinkRow) {
  if (!link.projectId || !link.quoteId || !["approved", "applied"].includes(link.status)) return true;
  const required = (await db.query<{ on: boolean }>(`SELECT require_variation_payment AS on FROM workspace_project_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.on ?? false;
  if (!required) return true;
  const loaded = await commercialRepository.load(db, workspaceId, link.caseId);
  if (!loaded) return false;
  const data = { ...(loaded.content as CommercialData), payments: (loaded.content as CommercialData).payments ?? [] } as CommercialData;
  // Billed with the next milestone (or a credit): nothing is due before the work.
  if (!data.payments.some((payment) => payment.sourceQuoteId === link.quoteId && payment.requiredForRelease)) return true;
  return financeGatePaymentsReady(data, "release", link.quoteId);
}

async function linkChange(db: Db, workspaceId: string, link: LinkRow): Promise<ExtraChange> {
  return { status: link.status, paid: await extraPaid(db, workspaceId, link) };
}

/** The revision state of every design step of a case, from its records; null without a design journey. */
export async function readStepRevisions(db: Db, workspaceId: string, caseId: string): Promise<Record<DeliverableStage, StepRevisions> | null> {
  const journey = (await db.query<{ included: number | null }>(`SELECT included_revisions AS included FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`,
    [workspaceId, caseId])).rows[0];
  if (!journey) return null;
  const included = includedRevisions(journey.included);
  const asked = await changesAskedByStage(db, workspaceId, caseId);
  const links = await currentLinks(db, workspaceId, caseId);
  const out = {} as Record<DeliverableStage, StepRevisions>;
  for (const stage of DELIVERABLE_STAGES) {
    const link = links.find((row) => row.stage === stage);
    out[stage] = stepRevisions(asked.get(stage) ?? 0, included, link ? { revision: link.revision, changeRequestId: link.changeRequestId, reference: changeReference(link.number),
      projectId: link.projectId, change: await linkChange(db, workspaceId, link) } : null);
  }
  return out;
}

/** The revision state of one step (null without a journey, or for a step without deliverables). */
export async function readStepRevision(db: Db, workspaceId: string, caseId: string, stage: string | null | undefined) {
  if (!isDeliverableStage(stage)) return null;
  return (await readStepRevisions(db, workspaceId, caseId))?.[stage] ?? null;
}

/** The next revision of a step starts only once its extra revision is agreed: refused while the step waits for it. */
export async function assertRevisionCanStart(db: Db, workspaceId: string, caseId: string, stage: string | null | undefined) {
  const state = await readStepRevision(db, workspaceId, caseId, stage);
  if (state?.waiting) throw new ConflictException(WAITING_FOR_EXTRA_REVISION);
}

/** Whether a step's revision `revision` has its extra-revision change (the fee is agreed through the change, not by a notice). */
export async function extraRevisionLinked(db: Db, workspaceId: string, caseId: string, stage: string, revision: number) {
  return Boolean((await db.query(`SELECT 1 FROM design_extra_revisions WHERE workspace_id = $1 AND case_id = $2 AND stage = $3 AND revision = $4 AND replaced_at IS NULL`,
    [workspaceId, caseId, stage, revision])).rowCount);
}

/** Who asked: a team member (who recorded the client's ask, or drafted it), or the client's contact in the portal. */
export type ChangesAsker = { userId: string; name?: string | null } | { grantId: string; name: string };

/** The staff member a drafted change is raised by: the team member who acted, else the Account Manager, the lead designer, then the case's creator. */
async function raiser(db: Db, workspaceId: string, caseId: string, asker: ChangesAsker) {
  if ("userId" in asker) return asker.userId;
  const facts = await caseFacts(db, workspaceId, caseId);
  for (const membership of [facts?.accountManagerId, await leadDesigner(db, workspaceId, caseId)]) {
    if (!membership) continue;
    const user = (await db.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, membership])).rows[0];
    if (user) return user.userId;
  }
  return (await db.query<{ userId: string }>(`SELECT created_by AS "userId" FROM pre_project_cases WHERE workspace_id = $1 AND id = $2`, [workspaceId, caseId])).rows[0].userId;
}

export type AskOutcome =
  | { kind: "none" }
  | { kind: "free"; revision: number; included: number }
  | { kind: "extra"; revision: number; included: number; changeRequestId: string; reference: string; drafted: boolean };

/**
 * After the client asked for changes on a step (or when the team drafts the extra revision itself): within the free
 * revisions nothing more happens; beyond them the extra revision's change request is drafted once (no price: the team
 * prices it), linked to the case or its project and the step, the lead designer and the Account Manager hear it in the
 * app and the job's team thread gets a line. Asking again for the same revision returns the same draft. `redraft`
 * (the team's command) drafts a fresh one when the last was declined or withdrawn.
 */
export async function askedForChanges(db: Db, workspaceId: string, caseId: string, stage: string | null | undefined,
  asker: ChangesAsker, options: { note?: string | null; source?: string | null; redraft?: boolean } = {}): Promise<AskOutcome> {
  if (!isDeliverableStage(stage)) return { kind: "none" };
  // The case, then its journey: one ask at a time per case (the same order the case's other commands lock in).
  await db.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, caseId]);
  const journey = (await db.query<{ included: number | null }>(`SELECT included_revisions AS included FROM design_journeys WHERE workspace_id = $1 AND case_id = $2 FOR UPDATE`,
    [workspaceId, caseId])).rows[0];
  if (!journey) return { kind: "none" };
  const included = includedRevisions(journey.included);
  const revision = (await changesAskedByStage(db, workspaceId, caseId)).get(stage) ?? 0;
  if (revision <= included) return { kind: "free", revision, included };
  const existing = (await currentLinks(db, workspaceId, caseId, stage)).find((row) => row.revision === revision);
  if (existing && !(options.redraft && extraRevisionClosed({ status: existing.status, paid: true })))
    return { kind: "extra", revision, included, changeRequestId: existing.changeRequestId, reference: changeReference(existing.number), drafted: false };

  const label = STAGE_LABELS[stage as JourneyStage];
  const raisedBy = await raiser(db, workspaceId, caseId, asker);
  const changeId = randomUUID();
  const note = (options.note ?? "").trim().slice(0, 4000);
  const projectId = await projectForChanges(db, workspaceId, caseId);
  const draft = { id: changeId, title: extraRevisionTitle(label), description: note };
  const { change } = projectId
    ? await raiseProjectChange(db, workspaceId, projectId, { ...draft, reason: "client_request" }, { userId: raisedBy })
    : await createChange(db, workspaceId, caseId, { ...draft, kind: "addition", designImpact: `Revision ${revision} of ${label}; the package includes ${included}.` }, { userId: raisedBy });
  if (existing) await db.query(`UPDATE design_extra_revisions SET replaced_at = now() WHERE workspace_id = $1 AND case_id = $2 AND stage = $3 AND revision = $4 AND replaced_at IS NULL`,
    [workspaceId, caseId, stage, revision]);
  await db.query(
    `INSERT INTO design_extra_revisions (workspace_id, id, case_id, stage, revision, included, change_request_id, asked_by_user_id, asked_by_grant_id, source_ref, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [workspaceId, randomUUID(), caseId, stage, revision, included, changeId, "userId" in asker ? asker.userId : null, "grantId" in asker ? asker.grantId : null,
      options.source?.slice(0, 80) ?? null, note]);
  await recordAudit(db, { workspaceId, actorUserId: "userId" in asker ? asker.userId : null, source: "grantId" in asker ? "client_portal" : "user",
    action: "design.extra_revision_raised.v1", entityType: "pre_project_case", entityId: caseId,
    after: { stage, revision, included, changeRequestId: changeId, reference: change.reference, projectId, source: options.source ?? null, replaced: existing?.changeRequestId ?? null,
      grantId: "grantId" in asker ? asker.grantId : null } });
  // The lead designer and the Account Manager hear it in the app, with a link to the draft to price.
  const facts = await caseFacts(db, workspaceId, caseId);
  await tellMembers(db, workspaceId, [await leadDesigner(db, workspaceId, caseId), facts?.accountManagerId], "design.extra_revision",
    { stage: label, clientName: facts?.clientName ?? "", round: String(revision), included: String(included), title: label },
    projectId ? `/workspace/projects/${projectId}/changes/${changeId}` : `/workspace/pre-projects/cases/${caseId}/variations?change=${changeId}`,
    `design.extra_revision:change:${changeId}`, false, "userId" in asker ? asker.userId : null);
  await postJobEvent(db, workspaceId, { record: { type: "case", id: caseId }, code: "design_extra_revision", ref: changeId,
    body: `${change.reference} drafted: extra revision on ${label} (revision ${revision}, ${included} included)` });
  return { kind: "extra", revision, included, changeRequestId: changeId, reference: change.reference, drafted: true };
}
