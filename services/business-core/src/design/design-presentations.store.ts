import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { caseTeam, caseTitle, tellClients, tellStaff } from "../client-portal/portal-notices";
import { DECISION_SOURCES, optionProblem, roundChargeable, STAGE_LABELS, stageRevisions, type DecisionSource, type JourneyStage } from "./design-journey.domain";
import { completeStage, salesAdminMembership } from "./design-journey.store";
import { isDeliverableStage, siteMeasureDone, syncDesignStages } from "./design-stage-sync";

type Db = Pick<PoolClient, "query">;

export type PresentationOption = {
  id: string; position: number; title: string; note: string; linkUrl: string | null; designId: string | null; designTitle: string | null;
  /** The latest revision of an uploaded option: what the client sees. */
  versionId: string | null; versionNumber: number | null; mimeType: string | null; hasPreview: boolean;
};
export type Presentation = {
  id: string; stage: JourneyStage; round: number; status: "draft" | "presented" | "chosen" | "changes_requested" | "withdrawn"; chargeable: boolean;
  presentedAt: string | null; presentedByName: string | null; chosenOptionId: string | null; decidedAt: string | null; decidedByName: string | null;
  decisionSource: string | null; decisionNote: string | null; fromPortal: boolean; version: number; options: PresentationOption[];
  /** PLM-145: the reviewer's approval before the client sees it, on a reviewed package. */
  reviewedAt: string | null; reviewedByName: string | null;
};

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

/** Every presentation of a case (newest round first per stage) with its options. */
export async function readPresentations(db: Db, workspaceId: string, caseId: string, stage?: string): Promise<Presentation[]> {
  const rows = (await db.query<Omit<Presentation, "options">>(
    `SELECT presentation.id, presentation.stage, presentation.round, presentation.status, presentation.chargeable, presentation.presented_at AS "presentedAt",
            presenter.display_name AS "presentedByName", presentation.chosen_option_id AS "chosenOptionId", presentation.decided_at AS "decidedAt",
            presentation.decided_by_name AS "decidedByName", presentation.decision_source AS "decisionSource", presentation.decision_note AS "decisionNote",
            presentation.decided_by_grant_id IS NOT NULL AS "fromPortal", presentation.version, presentation.reviewed_at AS "reviewedAt", reviewer.display_name AS "reviewedByName"
       FROM design_presentations presentation LEFT JOIN users presenter ON presenter.id = presentation.presented_by LEFT JOIN users reviewer ON reviewer.id = presentation.reviewed_by
      WHERE presentation.workspace_id = $1 AND presentation.case_id = $2 AND ($3::text IS NULL OR presentation.stage = $3)
      ORDER BY presentation.stage, presentation.round DESC`, [workspaceId, caseId, stage ?? null])).rows;
  const options = rows.length ? (await db.query<PresentationOption & { presentationId: string }>(
    `SELECT option.id, option.presentation_id AS "presentationId", option.position, option.title, option.note, option.link_url AS "linkUrl", option.design_id AS "designId",
            design.title AS "designTitle", latest.id AS "versionId", latest.number AS "versionNumber", asset.mime_type AS "mimeType",
            (asset.preview_key IS NOT NULL OR asset.mime_type LIKE 'image/%') AS "hasPreview"
       FROM design_presentation_options option
       LEFT JOIN pre_project_designs design ON design.workspace_id = option.workspace_id AND design.id = option.design_id
       LEFT JOIN LATERAL (SELECT version.id, version.number, version.asset_id FROM pre_project_design_versions version
                           WHERE version.workspace_id = option.workspace_id AND version.design_id = option.design_id ORDER BY version.number DESC LIMIT 1) latest ON true
       LEFT JOIN pre_project_brief_assets asset ON asset.workspace_id = option.workspace_id AND asset.id = latest.asset_id
      WHERE option.workspace_id = $1 AND option.presentation_id = ANY($2::uuid[]) ORDER BY option.position, option.created_at`,
    [workspaceId, rows.map((row) => row.id)])).rows : [];
  return rows.map((row) => ({
    ...row, presentedAt: iso(row.presentedAt), decidedAt: iso(row.decidedAt), reviewedAt: iso(row.reviewedAt),
    options: options.filter((option) => option.presentationId === row.id).map(({ presentationId: _id, ...option }) => option),
  }));
}

/** Rounds shown to the client per stage (drafts and withdrawn rounds don't count). */
export async function presentedRounds(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ stage: JourneyStage; rounds: number }>(
    `SELECT stage, count(*)::int AS rounds FROM design_presentations WHERE workspace_id = $1 AND case_id = $2 AND status NOT IN ('draft', 'withdrawn') GROUP BY stage`,
    [workspaceId, caseId])).rows;
}

type OptionInput = { id: string; title: string; note?: string | null; designId?: string | null; linkUrl?: string | null };

/**
 * A new round for a stage, prepared before it is shown: options as uploaded designs of that stage or links. One
 * open round per stage; the next round is a revision once the client asked for changes or chose.
 */
export async function createPresentation(db: Db, workspaceId: string, caseId: string, input: { id: string; stage: string; options: OptionInput[] }, userId: string) {
  if (!isDeliverableStage(input.stage)) throw new BadRequestException("Choose a design stage.");
  const existing = (await db.query<{ caseId: string; stage: string }>(`SELECT case_id AS "caseId", stage FROM design_presentations WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.id])).rows[0];
  if (existing) {
    if (existing.caseId !== caseId || existing.stage !== input.stage) throw new ConflictException("This presentation ID is already in use.");
    return false;
  }
  if (!input.options.length) throw new UnprocessableEntityException("Add at least one option");
  if (input.options.length > 12) throw new UnprocessableEntityException("Show at most 12 options in one presentation");
  // PLM-142: the firm's number of concept options (Palm: 1 or 2), frozen on the journey.
  const most = input.stage === "concepts" ? (await db.query<{ most: number | null }>(`SELECT concept_options_max AS most FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`,
    [workspaceId, caseId])).rows[0]?.most ?? null : null;
  if (most && input.options.length > most) throw new UnprocessableEntityException(most === 1 ? "Show one concept option" : `Show at most ${most} concept options`);
  for (const option of input.options) {
    const problem = optionProblem(option);
    if (problem) throw new UnprocessableEntityException(problem);
  }
  const designIds = input.options.map((option) => option.designId).filter((id): id is string => Boolean(id));
  if (designIds.length) {
    const found = (await db.query<{ id: string }>(
      `SELECT design.id FROM pre_project_designs design WHERE design.workspace_id = $1 AND design.case_id = $2 AND design.id = ANY($3::uuid[]) AND design.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM pre_project_design_versions version WHERE version.workspace_id = design.workspace_id AND version.design_id = design.id)`,
      [workspaceId, caseId, designIds])).rows;
    if (found.length !== new Set(designIds).size) throw new BadRequestException("Choose designs of this project with a file.");
  }
  const open = (await db.query<{ round: number; status: string }>(
    `SELECT round, status FROM design_presentations WHERE workspace_id = $1 AND case_id = $2 AND stage = $3 ORDER BY round DESC LIMIT 1 FOR UPDATE`, [workspaceId, caseId, input.stage])).rows[0];
  if (open && ["draft", "presented"].includes(open.status)) throw new ConflictException(open.status === "draft" ? "Finish or discard the draft presentation first." : "The client hasn't decided on the last presentation yet.");
  await db.query(`INSERT INTO design_presentations (id, workspace_id, case_id, stage, round, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.id, workspaceId, caseId, input.stage, (open?.round ?? 0) + 1, userId]);
  for (const [position, option] of input.options.entries())
    await db.query(
      `INSERT INTO design_presentation_options (id, workspace_id, case_id, presentation_id, position, title, note, design_id, link_url, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [option.id, workspaceId, caseId, input.id, position, option.title.trim().slice(0, 240), (option.note ?? "").trim().slice(0, 2000), option.designId ?? null, option.linkUrl?.trim() ?? null, userId]);
  return true;
}

async function lockPresentation(db: Db, workspaceId: string, caseId: string, id: string) {
  const row = (await db.query<{ stage: JourneyStage; round: number; status: string; version: number }>(
    `SELECT stage, round, status, version FROM design_presentations WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, caseId, id])).rows[0];
  if (!row) throw new NotFoundException("This presentation isn't on the project.");
  return row;
}

/**
 * Shows a round to the client: it waits in their portal. A round beyond the package's included revisions is
 * chargeable: Sales (the Account Manager and the Sales Admin) are told so the fee is agreed before the work.
 */
export async function presentRound(db: Db, workspaceId: string, caseId: string, id: string, version: number, userId: string, options: { reviewedBy?: string | null } = {}) {
  const row = await lockPresentation(db, workspaceId, caseId, id);
  if (row.version !== version) throw new ConflictException("This presentation changed in another window. Reload and try again.");
  if (row.status !== "draft") throw new ConflictException("This presentation was already shown to the client.");
  const included = (await db.query<{ included: number }>(`SELECT included_revisions AS included FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0]?.included ?? 0;
  const chargeable = roundChargeable(row.round, included);
  // A reviewer who shows a round themselves approves it as they do (PLM-145).
  await db.query(`UPDATE design_presentations SET status = 'presented', presented_at = clock_timestamp(), presented_by = $3, chargeable = $4,
                         reviewed_by = COALESCE(reviewed_by, $5::uuid), reviewed_at = CASE WHEN reviewed_by IS NULL AND $5::uuid IS NOT NULL THEN clock_timestamp() ELSE reviewed_at END,
                         version = version + 1 WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, userId, chargeable, options.reviewedBy ?? null]);
  const label = STAGE_LABELS[row.stage];
  await tellClients(db, { workspaceId, caseId, event: "decision_waiting", recordId: `presentation:${id}`, title: row.round > 1 ? `${label} · revision ${row.round - 1}` : label });
  if (chargeable) {
    const facts = await caseTitle(db, workspaceId, caseId);
    const members = [(await db.query<{ owner: string | null }>(
      `SELECT opportunity.owner_membership_id AS owner FROM pre_project_cases pre_case JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
        WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0]?.owner, await salesAdminMembership(db, workspaceId, caseId)].filter((member): member is string => Boolean(member));
    const recipients = (await db.query<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [workspaceId, members])).rows.map((item) => item.userId);
    await tellStaff(db, { workspaceId, recipients, code: "design.extra_revision", email: true, except: userId,
      variables: { stage: label, clientName: facts.clientName, round: String(row.round - 1), included: String(included), title: label },
      deepLink: `/workspace/pre-projects/cases/${caseId}/designs?stage=${row.stage}`, key: id });
  }
  return { chargeable, round: row.round };
}

/** A draft that won't be shown is withdrawn (kept, never counted). */
export async function withdrawRound(db: Db, workspaceId: string, caseId: string, id: string, version: number) {
  const row = await lockPresentation(db, workspaceId, caseId, id);
  if (row.version !== version) throw new ConflictException("This presentation changed in another window. Reload and try again.");
  if (row.status !== "draft") throw new ConflictException("Only a draft can be discarded.");
  await db.query(`UPDATE design_presentations SET status = 'withdrawn', version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
}

/**
 * The client's decision on a round: the option they chose, or changes (the next round is a revision). From the
 * portal the contact is recorded; from staff, the source and who decided (E5-2). Choosing a concept completes the
 * Concepts stage when it is the current one.
 */
export async function decideRound(db: Db, workspaceId: string, caseId: string, id: string, input: {
  version: number; decision: "chosen" | "changes_requested"; optionId?: string | null; source: string; decidedBy: string; note?: string | null;
  grantId?: string | null; userId?: string | null;
}) {
  const row = await lockPresentation(db, workspaceId, caseId, id);
  if (row.status === input.decision && input.grantId) {
    const same = (await db.query(`SELECT 1 FROM design_presentations WHERE workspace_id = $1 AND id = $2 AND decided_by_grant_id = $3 AND chosen_option_id IS NOT DISTINCT FROM $4::uuid`,
      [workspaceId, id, input.grantId, input.optionId ?? null])).rowCount;
    if (same) return { replayed: true, stage: row.stage };
  }
  if (row.version !== input.version) throw new ConflictException("This presentation changed. Reload to see the latest.");
  if (row.status !== "presented") throw new ConflictException(row.status === "draft" ? "Show the presentation to the client first." : "The client already decided on this presentation.");
  if (!DECISION_SOURCES.includes(input.source as DecisionSource)) throw new BadRequestException("Say where the client decided.");
  const name = input.decidedBy.trim();
  if (!name || name.length > 200) throw new BadRequestException("Say who decided.");
  const note = input.note?.trim() || null;
  if (input.decision === "changes_requested" && !note) throw new BadRequestException("Say what the client wants changed.");
  if (input.decision === "chosen") {
    if (!input.optionId) throw new BadRequestException("Choose an option.");
    const option = (await db.query(`SELECT 1 FROM design_presentation_options WHERE workspace_id = $1 AND presentation_id = $2 AND id = $3`, [workspaceId, id, input.optionId])).rowCount;
    if (!option) throw new NotFoundException("That option isn't in this presentation.");
  }
  await db.query(
    `UPDATE design_presentations SET status = $3, chosen_option_id = $4, decided_at = clock_timestamp(), decided_by_user_id = $5, decided_by_grant_id = $6, decided_by_name = $7,
            decision_source = $8, decision_note = $9, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, input.decision, input.decision === "chosen" ? input.optionId : null, input.userId ?? null, input.grantId ?? null, name, input.source, note]);
  const facts = await caseTitle(db, workspaceId, caseId);
  const chosen = input.decision === "chosen" ? (await db.query<{ title: string }>(`SELECT title FROM design_presentation_options WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.optionId])).rows[0]?.title ?? "" : "";
  if (input.decision === "chosen")
    await settleOptionDesigns(db, workspaceId, caseId, { presentationId: id, chosenOptionId: input.optionId!, chosenTitle: chosen, stage: row.stage, round: row.round, decidedBy: name,
      source: input.source, note, userId: input.userId ?? null, grantId: input.grantId ?? null });
  // The design team hears the client's answer: "<client> chose <option>", or "<client> wants changes to <stage>" with what (the
  // client-changes notice every design answer uses), never "chose changes".
  await tellStaff(db, { workspaceId, recipients: await caseTeam(db, workspaceId, caseId, ["design"]), code: input.decision === "chosen" ? "design.concept_chosen" : "design.client_changes",
    except: input.userId ?? null,
    variables: input.decision === "chosen" ? { clientName: facts.clientName, title: chosen, stage: STAGE_LABELS[row.stage], note: note ?? "Chosen." }
      : { clientName: facts.clientName, title: STAGE_LABELS[row.stage], actor: name, note: note ?? "" },
    deepLink: `/workspace/pre-projects/cases/${caseId}/designs?stage=${row.stage}`, key: `${id}:${input.decision}` });
  let completed = false;
  if (input.decision === "chosen" && row.stage === "concepts") {
    // PLM-141: the choice is recorded; the concept step itself waits for the design site measure.
    const active = (await db.query(`SELECT 1 FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = 'concepts' AND status = 'active' FOR UPDATE`, [workspaceId, caseId])).rowCount;
    if (active && await siteMeasureDone(db, workspaceId, caseId)) { await completeStage(db, workspaceId, caseId, "concepts", input.userId ?? null, `Client's choice: ${chosen}`, "chosen"); completed = true; }
  }
  return { replayed: false, stage: row.stage, completed };
}

/**
 * The client's choice settles the uploaded options the way a design file is approved (its latest revision's status and
 * a history line saying who decided and where): the chosen option's design is approved, and the options the client
 * passed over are retired (archived, with the reason in their history). The stage and the main quotation's design gate
 * then see one approved design instead of a draft and a shared one. Idempotent: a design already settled is left alone.
 */
async function settleOptionDesigns(db: Db, workspaceId: string, caseId: string, input: {
  presentationId: string; chosenOptionId: string; chosenTitle: string; stage: JourneyStage; round: number; decidedBy: string; source: string; note: string | null;
  userId: string | null; grantId: string | null;
}) {
  const options = (await db.query<{ id: string; designId: string }>(
    `SELECT id, design_id AS "designId" FROM design_presentation_options WHERE workspace_id = $1 AND presentation_id = $2 AND design_id IS NOT NULL ORDER BY position, created_at`,
    [workspaceId, input.presentationId])).rows;
  if (!options.length) return;
  // The history names the client through their portal, or the staff member who recorded the client's decision and where it was given.
  const actor = input.grantId ? { createdBy: null, grantId: input.grantId, source: "client_portal" } : { createdBy: input.userId, grantId: null, source: input.source };
  const round = `${STAGE_LABELS[input.stage]}${input.round > 1 ? ` · revision ${input.round - 1}` : ""}`;
  let approved = false;
  for (const option of options) {
    const design = (await db.query<{ archivedAt: Date | null; versionId: string | null; status: string | null }>(
      `SELECT design.archived_at AS "archivedAt", latest.id AS "versionId", latest.status
         FROM pre_project_designs design
         LEFT JOIN LATERAL (SELECT version.id, version.status FROM pre_project_design_versions version
                             WHERE version.workspace_id = design.workspace_id AND version.design_id = design.id ORDER BY version.number DESC LIMIT 1) latest ON true
        WHERE design.workspace_id = $1 AND design.case_id = $2 AND design.id = $3 FOR UPDATE OF design`, [workspaceId, caseId, option.designId])).rows[0];
    if (!design?.versionId) continue;
    const history = (action: string, note: string) => db.query(
      `INSERT INTO pre_project_design_activity (id, workspace_id, case_id, design_id, version_id, action, note, decision_by, created_by, client_grant_id, decision_source, decision_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, clock_timestamp())`,
      [randomUUID(), workspaceId, caseId, option.designId, design.versionId, action, note, input.decidedBy, actor.createdBy, actor.grantId, actor.source]);
    if (option.id === input.chosenOptionId) {
      if (design.status === "approved") continue;
      await db.query(`UPDATE pre_project_design_versions SET status = 'approved' WHERE workspace_id = $1 AND id = $2`, [workspaceId, design.versionId]);
      await history("approved", `Chosen by the client from ${round}.${input.note ? ` ${input.note}` : ""}`);
      approved = true;
    } else {
      if (design.archivedAt) continue;
      await db.query(`UPDATE pre_project_designs SET archived_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, option.designId]);
      await history("comment", `Not chosen: the client chose ${input.chosenTitle} (${round}).`);
    }
    await db.query(`UPDATE pre_project_designs SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, option.designId]);
  }
  // Concepts complete through the choice itself (decideRound, with the site measure); another stage completes as any approved file would.
  if (approved && input.stage !== "concepts") await syncDesignStages(db, workspaceId, caseId, input.userId);
}

/** The role that reviews this journey's rounds before the client sees them (PLM-145), when its package has one. */
export async function journeyReviewRole(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ role: string | null }>(`SELECT reviewer_role_code AS role FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0]?.role ?? null;
}

/** PLM-145: the reviewer approves a draft round; it can then be shown to the client. Idempotent. */
export async function reviewRound(db: Db, workspaceId: string, caseId: string, id: string, version: number, userId: string) {
  const row = await lockPresentation(db, workspaceId, caseId, id);
  const reviewed = (await db.query<{ by: string | null; createdBy: string }>(`SELECT reviewed_by AS by, created_by AS "createdBy" FROM design_presentations WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
  if (reviewed.by) return { replayed: true, stage: row.stage };
  if (row.version !== version) throw new ConflictException("This presentation changed in another window. Reload and try again.");
  if (row.status !== "draft") throw new ConflictException("This presentation was already shown to the client.");
  await db.query(`UPDATE design_presentations SET reviewed_by = $3, reviewed_at = clock_timestamp(), version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, userId]);
  const facts = await caseTitle(db, workspaceId, caseId);
  const actor = (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "";
  await tellStaff(db, { workspaceId, recipients: [reviewed.createdBy], code: "design.presentation_reviewed", except: userId,
    variables: { stage: STAGE_LABELS[row.stage], clientName: facts.clientName, actor }, deepLink: `/workspace/pre-projects/cases/${caseId}/designs?stage=${row.stage}`, key: `${id}:reviewed` });
  return { replayed: false, stage: row.stage };
}

/** Whether a draft round was approved by the reviewer. */
export async function roundReviewed(db: Db, workspaceId: string, id: string) {
  return Boolean((await db.query(`SELECT 1 FROM design_presentations WHERE workspace_id = $1 AND id = $2 AND reviewed_by IS NOT NULL`, [workspaceId, id])).rowCount);
}

/** A stage's revision counter from its presented rounds and the package's included revisions. */
export function revisionsFor(rounds: Array<{ stage: string; rounds: number }>, stage: string, includedRevisions: number) {
  return stageRevisions(rounds.find((item) => item.stage === stage)?.rounds ?? 0, includedRevisions);
}
