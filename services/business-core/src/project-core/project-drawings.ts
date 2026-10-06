import { BadRequestException, ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DRAWING_CHECKS, type StageCheck } from "./project-checks";

type Db = Pick<PoolClient, "query">;

/**
 * A project's technical drawings (PLM-057 … PLM-060), one revision at a time: uploaded by the technical team,
 * checked on site (OK, or changes needed), sent to the client, then approved (the day, the client's name, the
 * signed file) or sent back. Only the latest revision counts; a revision sent back opens the next one. What the
 * route asks for decides the order: a route with a site check sends only drawings that passed it.
 */
export const DRAWING_STATUSES = ["uploaded", "checked", "changes_needed", "sent", "approved", "changes_requested"] as const;
export type DrawingStatus = (typeof DRAWING_STATUSES)[number];

/** Up to this many drawing files on one revision, and this many signed approval files. */
export const MAX_DRAWING_FILES = 30;
export const MAX_APPROVAL_FILES = 5;

export type DrawingFile = { id: string; kind: "drawing" | "approval"; name: string; mimeType: string; byteSize: number; hasPreview: boolean; byName: string; at: string };
export type DrawingRevision = {
  id: string; number: number; status: DrawingStatus; note: string; createdByName: string; createdAt: string;
  siteCheck: "ok" | "changes" | null; siteCheckNote: string; siteCheckedByName: string | null; siteCheckedAt: string | null;
  sentByName: string | null; sentAt: string | null;
  decidedOn: string | null; decidedByName: string | null; decisionNote: string; decisionVia: "recorded" | "portal" | null; decisionRecordedByName: string | null;
  files: DrawingFile[];
};

/** The facts the stage checks read, from the latest revision. */
export function drawingFacts(latest: Pick<DrawingRevision, "status" | "siteCheck"> & { drawingFiles: number } | null) {
  if (!latest) return { uploaded: false, siteChecked: false, approved: false };
  const sentBack = latest.status === "changes_needed" || latest.status === "changes_requested";
  return {
    uploaded: latest.drawingFiles > 0 && !sentBack,
    siteChecked: latest.siteCheck === "ok" && ["checked", "sent", "approved"].includes(latest.status),
    approved: latest.status === "approved",
  };
}

/** A new revision can start when there is none yet, or the latest one is decided (sent back, or approved and now revised). */
export function canStartRevision(latest: Pick<DrawingRevision, "status"> | null) {
  return !latest || latest.status === "changes_needed" || latest.status === "changes_requested" || latest.status === "approved";
}

/** Stages that still apply (not skipped) and hold one of these check kinds. */
export function routeHolds(stages: Array<{ status: string; checks: StageCheck[] }>, kinds: readonly string[]) {
  return stages.some((stage) => stage.status !== "skipped" && stage.checks.some((check) => kinds.includes(check.kind)));
}

/** What sending a revision to the client needs: drawing files, and a passed site check when the route asks for one. */
export function assertSendable(revision: Pick<DrawingRevision, "status" | "number"> & { drawingFiles: number }, needsSiteCheck: boolean) {
  if (revision.status === "sent") throw new ConflictException(`Drawings R${revision.number} are already with the client.`);
  if (!revision.drawingFiles) throw new ConflictException("Upload the drawings first.");
  if (needsSiteCheck ? revision.status !== "checked" : !["uploaded", "checked"].includes(revision.status))
    throw new ConflictException(needsSiteCheck && revision.status === "uploaded" ? "Record the technical site check first." : `Drawings R${revision.number} can't be sent now.`);
}

/** The client's decision is recorded only on the revision they were sent, for a day between sending and today. */
export function assertDecidable(revision: Pick<DrawingRevision, "status" | "number"> & { sentOn: string | null }, decidedOn: string, today: string) {
  if (revision.status !== "sent") throw new ConflictException(`Drawings R${revision.number} aren't waiting for the client.`);
  if (decidedOn > today) throw new BadRequestException("The client's decision can't be in the future.");
  if (revision.sentOn && decidedOn < revision.sentOn) throw new BadRequestException("The client's decision can't be before the drawings were sent.");
}

const REVISION_SELECT = `SELECT revision.id, revision.number, revision.status, revision.note, creator.display_name AS "createdByName", revision.created_at AS "createdAt",
  revision.site_check AS "siteCheck", revision.site_check_note AS "siteCheckNote", checker.display_name AS "siteCheckedByName", revision.site_checked_at AS "siteCheckedAt",
  sender.display_name AS "sentByName", revision.sent_at AS "sentAt", revision.decided_on::text AS "decidedOn", revision.decided_by_name AS "decidedByName",
  revision.decision_note AS "decisionNote", revision.decision_via AS "decisionVia", recorder.display_name AS "decisionRecordedByName",
  coalesce((SELECT jsonb_agg(jsonb_build_object('id', file.id, 'kind', file.kind, 'name', file.original_name, 'mimeType', file.mime_type, 'byteSize', file.byte_size,
      'hasPreview', file.preview_key IS NOT NULL, 'byName', uploader.display_name, 'at', file.created_at)
      ORDER BY CASE file.kind WHEN 'drawing' THEN 0 ELSE 1 END, file.created_at, file.original_name, file.id)
    FROM project_drawing_files file JOIN users uploader ON uploader.id = file.created_by
   WHERE file.workspace_id = revision.workspace_id AND file.revision_id = revision.id), '[]'::jsonb) AS files
  FROM project_drawing_revisions revision
  JOIN users creator ON creator.id = revision.created_by
  LEFT JOIN users checker ON checker.id = revision.site_checked_by
  LEFT JOIN users sender ON sender.id = revision.sent_by
  LEFT JOIN users recorder ON recorder.id = revision.decision_recorded_by`;

/** Every revision, newest first. */
export async function readDrawingRevisions(db: Db, workspaceId: string, projectId: string): Promise<DrawingRevision[]> {
  return (await db.query<DrawingRevision>(`${REVISION_SELECT} WHERE revision.workspace_id = $1 AND revision.project_id = $2 ORDER BY revision.number DESC`, [workspaceId, projectId])).rows;
}

export type LatestRevision = { id: string; number: number; status: DrawingStatus; siteCheck: "ok" | "changes" | null; drawingFiles: number; approvalFiles: number; sentOn: string | null; createdBy: string };

/** The latest revision with its file counts (locked when asked). */
export async function readLatestRevision(db: Db, workspaceId: string, projectId: string, lock = false): Promise<LatestRevision | null> {
  return (await db.query<LatestRevision>(
    `SELECT revision.id, revision.number, revision.status, revision.site_check AS "siteCheck", revision.created_by AS "createdBy",
            (SELECT count(*)::int FROM project_drawing_files file WHERE file.workspace_id = revision.workspace_id AND file.revision_id = revision.id AND file.kind = 'drawing') AS "drawingFiles",
            (SELECT count(*)::int FROM project_drawing_files file WHERE file.workspace_id = revision.workspace_id AND file.revision_id = revision.id AND file.kind = 'approval') AS "approvalFiles",
            (revision.sent_at AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS "sentOn"
       FROM project_drawing_revisions revision JOIN workspaces workspace ON workspace.id = revision.workspace_id
      WHERE revision.workspace_id = $1 AND revision.project_id = $2 ORDER BY revision.number DESC LIMIT 1 ${lock ? "FOR UPDATE OF revision" : ""}`,
    [workspaceId, projectId])).rows[0] ?? null;
}

/** The stage-check facts for one project. */
export async function readDrawingFacts(db: Db, workspaceId: string, projectId: string) {
  return drawingFacts(await readLatestRevision(db, workspaceId, projectId));
}

/** The project's stages with their checks (to read what its route asks for). */
async function routeStages(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ status: string; checks: StageCheck[] }>(`SELECT status, checks FROM project_stages WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows;
}

/**
 * Whether production must wait for the client's drawing approval, and whether it has it (PLM-059): only when the
 * project's route holds the approval check on a stage that wasn't skipped (standard furniture skips it).
 */
export async function drawingsGate(db: Db, workspaceId: string, projectId: string) {
  const required = routeHolds(await routeStages(db, workspaceId, projectId), ["drawings_client_approved"]);
  return { required, approved: required ? (await readDrawingFacts(db, workspaceId, projectId)).approved : true };
}

/** Whether the route asks for drawings at all, for a site check before they go to the client, and for a factory slot. */
export async function drawingRoute(db: Db, workspaceId: string, projectId: string) {
  const stages = await routeStages(db, workspaceId, projectId);
  return { inRoute: routeHolds(stages, DRAWING_CHECKS), needsSiteCheck: routeHolds(stages, ["drawings_site_checked"]), factorySlot: routeHolds(stages, ["factory_slot_booked"]) };
}

/** The project's production release: its latest drawings are approved by the client (PLM-060 / PLM-062). */
export async function productionReleased(db: Db, workspaceId: string, projectId: string) {
  return (await readDrawingFacts(db, workspaceId, projectId)).approved;
}
