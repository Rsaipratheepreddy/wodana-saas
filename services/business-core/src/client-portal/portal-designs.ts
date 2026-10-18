import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Grant } from "./portal-auth";
import { grantFor, type DecisionContext } from "./portal-decisions";
import { clientThreads, SHARED_DESIGN_STATUSES, tellDesignTeam } from "./portal-design";
import type { FilePresence } from "./portal-files";
import { takesIdeas } from "./portal-moodboard";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PLM-153: the client's Designs, one folder per project of every design file the team shared with them: the revisions
 * sent for their review (and what came of it: approved, changes asked, declined, earlier rounds) and the options of a
 * presentation shown to them. It reads the design files as they are (nothing is copied); a file the team archives, or
 * a presentation it withdraws, leaves the folder; a file never shared (a draft, one in internal review) never shows.
 * The client comments on any file, in review or approved, on the team's own design threads; the team answers there.
 */
export const DESIGN_GROUPS = ["concepts", "layouts", "materials", "renders", "drawings"] as const;
export type DesignGroup = (typeof DESIGN_GROUPS)[number];

const LAYOUT_TYPES = ["Space plan / furniture layout", "2D floor plan", "2D layout / space plan", "Furniture / FF&E plan"];
const MATERIAL_TYPES = ["Material / finish board", "Material / finish specification", "Material / finish selection"];
const RENDER_TYPES = ["3D render / visualization", "3D render", "3D model"];

/** The folder a design belongs in: its design stage, else what kind of file it is. */
export function designGroup(stage: string | null, type: string): DesignGroup {
  if (stage === "concepts" || type === "Concept / mood board") return "concepts";
  if (stage === "space_planning" || LAYOUT_TYPES.includes(type)) return "layouts";
  if (stage === "material_selection" || MATERIAL_TYPES.includes(type)) return "materials";
  if (stage === "renders" || RENDER_TYPES.includes(type)) return "renders";
  return "drawings";
}

type FileRow = {
  versionId: string; designId: string; title: string; type: string; stage: string | null; number: number; status: string; room: string | null;
  mimeType: string; objectKey: string; previewKey: string | null; sharedAt: string;
};

/**
 * Every shared design file of the case: revisions shown for the client's review (their status as it stands, an expired
 * review reading "expired") and, for designs shown only as a presentation's options, their latest revision ("presented",
 * "chosen", or "shown" once another option was chosen or changes were asked).
 */
export async function sharedDesignFiles(db: Db, workspaceId: string, caseId: string): Promise<FileRow[]> {
  const reviewed = (await db.query<FileRow>(
    `SELECT version.id AS "versionId", design.id AS "designId", design.title, design.document_type AS type, design.stage, version.number,
            CASE WHEN version.status = 'client_review' AND version.client_review_expires_at <= now() THEN 'expired' ELSE version.status END AS status,
            room.name AS room, asset.mime_type AS "mimeType", asset.object_key AS "objectKey", asset.preview_key AS "previewKey",
            coalesce((SELECT max(activity.created_at) FROM pre_project_design_activity activity
                       WHERE activity.workspace_id = version.workspace_id AND activity.version_id = version.id AND activity.action = 'client_review'), version.created_at) AS "sharedAt"
       FROM pre_project_design_versions version
       JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.id = version.design_id AND design.archived_at IS NULL
       JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.id = version.asset_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = design.workspace_id AND room.case_id = design.case_id AND room.id = design.room_id
      WHERE version.workspace_id = $1 AND version.case_id = $2 AND version.status = ANY($3::text[])`, [workspaceId, caseId, SHARED_DESIGN_STATUSES])).rows;
  const presented = (await db.query<FileRow>(
    `SELECT DISTINCT ON (version.id) version.id AS "versionId", design.id AS "designId", design.title, design.document_type AS type, design.stage, version.number,
            CASE WHEN presentation.status = 'presented' THEN 'presented' WHEN presentation.chosen_option_id = option.id THEN 'chosen' ELSE 'shown' END AS status,
            room.name AS room, asset.mime_type AS "mimeType", asset.object_key AS "objectKey", asset.preview_key AS "previewKey", presentation.presented_at AS "sharedAt"
       FROM design_presentation_options option
       JOIN design_presentations presentation ON presentation.workspace_id = option.workspace_id AND presentation.id = option.presentation_id
        AND presentation.status IN ('presented', 'chosen', 'changes_requested') AND presentation.presented_at IS NOT NULL
       JOIN pre_project_designs design ON design.workspace_id = option.workspace_id AND design.id = option.design_id AND design.archived_at IS NULL
       JOIN pre_project_design_versions version ON version.workspace_id = design.workspace_id AND version.design_id = design.id
        AND version.number = (SELECT max(latest.number) FROM pre_project_design_versions latest WHERE latest.workspace_id = design.workspace_id AND latest.design_id = design.id)
       JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.id = version.asset_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = design.workspace_id AND room.case_id = design.case_id AND room.id = design.room_id
      WHERE option.workspace_id = $1 AND option.case_id = $2
      ORDER BY version.id, presentation.presented_at DESC`, [workspaceId, caseId])).rows;
  const seen = new Set(reviewed.map((row) => row.versionId));
  return [...reviewed, ...presented.filter((row) => !seen.has(row.versionId))]
    .map((row) => ({ ...row, number: Number(row.number), sharedAt: new Date(row.sharedAt).toISOString() }));
}

/** The client's Designs: the folders in their order, each design newest share first with its revisions newest first, and the conversation on each. */
export async function readDesignFolder(db: Db, workspaceId: string, grant: Grant, row: { caseId: string; caseStatus: string; projectStatus: string | null }, files: FilePresence) {
  const shared = await sharedDesignFiles(db, workspaceId, row.caseId);
  const { threads, messages } = shared.length ? await clientThreads(db, workspaceId, row.caseId) : { threads: [], messages: [] };
  const open = takesIdeas(row);
  const designs = new Map<string, { id: string; title: string; group: DesignGroup; room: string | null; sharedAt: string; files: Array<Record<string, unknown> & { number: number }> }>();
  for (const file of shared) {
    const design = designs.get(file.designId) ?? { id: file.designId, title: file.title, group: designGroup(file.stage, file.type), room: file.room, sharedAt: file.sharedAt, files: [] };
    const versionThreads = new Set(threads.filter((thread) => thread.versionId === file.versionId).map((thread) => thread.id));
    design.files.push({
      id: file.versionId, number: file.number, status: file.status, sharedAt: file.sharedAt, mimeType: file.mimeType,
      hasPreview: (await files.has(file.previewKey)) || (file.mimeType.startsWith("image/") && (await files.has(file.objectKey))),
      canComment: open,
      // The conversation on the file, oldest first: the client's side by name, the team as one team.
      // A comment pinned on the picture carries its point (0–1 across and down), the same pins the team places.
      comments: messages.filter((message) => versionThreads.has(message.threadId)).map((message) => {
        const anchor = pinOf(threads.find((thread) => thread.id === message.threadId)?.anchor);
        return { id: message.id, threadId: message.threadId, at: new Date(message.createdAt).toISOString(), text: message.body, fromClient: Boolean(message.grantId),
          mine: message.grantId === grant.id, author: message.grantId ? message.author : null, ...(anchor && message.id === message.threadId ? { anchor } : {}) };
      }),
    });
    if (file.sharedAt > design.sharedAt) design.sharedAt = file.sharedAt;
    designs.set(file.designId, design);
  }
  const ordered = [...designs.values()].sort((a, b) => (a.sharedAt < b.sharedAt ? 1 : a.sharedAt > b.sharedAt ? -1 : a.title.localeCompare(b.title)));
  for (const design of ordered) design.files.sort((a, b) => b.number - a.number);
  return {
    groups: DESIGN_GROUPS.map((key) => ({ key, designs: ordered.filter((design) => design.group === key).map(({ group: _group, ...design }) => design) }))
      .filter((group) => group.designs.length),
  };
}

export type PortalDesignFolder = Awaited<ReturnType<typeof readDesignFolder>>;

/** The client's comment on any design file shared with them (in review or approved, the latest or an earlier round); the file's designer hears it. */
export async function designFileComment(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "designs");
  if (!takesIdeas(row)) throw new ConflictException("This project isn't taking design comments any more.");
  if (typeof body.versionId !== "string" || !UUID.test(body.versionId)) throw new BadRequestException("Choose a design.");
  const file = (await sharedDesignFiles(ctx.db, ctx.workspaceId, row.caseId)).find((item) => item.versionId === body.versionId);
  if (!file) throw new NotFoundException("This design isn't shared with you any more.");
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new BadRequestException("Write your comment.");
  if (text.length > 5000) throw new BadRequestException("Keep it under 5000 characters.");
  const threadId = typeof body.commentId === "string" && UUID.test(body.commentId) ? body.commentId : null;
  if (!threadId) throw new BadRequestException("Try that again.");
  // §0.3: a comment may be pinned on the design (a point 0–1 across and down the picture or page preview).
  const anchor = body.anchor === undefined || body.anchor === null ? null : pinOf(body.anchor);
  if (body.anchor !== undefined && body.anchor !== null && !anchor) throw new BadRequestException("Place the pin on the design.");
  // A comment on the whole file: a design thread the team sees in the case's Design tab, with the client's words as its first message.
  await ctx.db.query(
    `INSERT INTO pre_project_design_threads (id, workspace_id, case_id, design_id, version_id, title, blocking, created_by, client_grant_id, client_visible, anchor)
     VALUES ($1, $2, $3, $4, $5, $6, false, NULL, $7, true, $8::jsonb)`,
    [threadId, ctx.workspaceId, row.caseId, file.designId, file.versionId, text.slice(0, 240), grant.id, anchor ? JSON.stringify(anchor) : null]);
  await ctx.db.query(`INSERT INTO pre_project_design_messages (id, workspace_id, case_id, design_id, thread_id, body, created_by, client_grant_id) VALUES ($1, $2, $3, $4, $1, $5, NULL, $6)`,
    [threadId, ctx.workspaceId, row.caseId, file.designId, text, grant.id]);
  await ctx.db.query(`UPDATE pre_project_designs SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [ctx.workspaceId, row.caseId, file.designId]);
  await tellDesignTeam(ctx, grant, row.caseId, { id: file.versionId, designId: file.designId, title: file.title, number: file.number }, threadId, threadId, text, true);
  return { ok: true, threadId, entity: { type: "pre_project_design", id: file.designId }, audit: { versionId: file.versionId, threadId, pinned: Boolean(anchor) } };
}

/** A pin's point as stored: x and y each between 0 and 1 (rounded to 4 places), or null for anything else. */
function pinOf(value: unknown): { x: number; y: number } | null {
  const point = value && typeof value === "object" ? value as { x?: unknown; y?: unknown } : null;
  const x = Number(point?.x), y = Number(point?.y);
  if (!point || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: Math.round(x * 10_000) / 10_000, y: Math.round(y * 10_000) / 10_000 };
}
