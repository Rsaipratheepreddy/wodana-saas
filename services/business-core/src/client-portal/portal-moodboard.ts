import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { startInspirationTimer } from "../design/design-journey.store";
import type { Grant } from "./portal-auth";
import { grantFor, type DecisionContext } from "./portal-decisions";
import { contactId, ownUploads, type FilePresence } from "./portal-files";
import { caseTeam, caseTitle, tellClients, tellStaff } from "./portal-notices";
import { effectiveSections, readPortalSettings, readProjectAccess } from "./portal-settings";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The moodboard as the client sees it and works with it: the concept and material boards the team shared with
 * them, the inspiration pins the team chose to show, and the client's own. The client likes or dislikes each,
 * comments on it, and adds their own photos and links. Everything is the team's too, on the case's moodboard.
 */

/** Boards are the design files of the concept and material stages (the product's document types for them). */
const BOARD_TYPES = ["Concept / mood board", "Material / finish board"];
const BOARD_STAGES = ["concepts", "material_selection"];
const SHARED = ["client_review", "approved", "changes_requested", "rejected"];

export type BoardTarget = "pin" | "design";

/** A project takes the client's ideas while it's being planned or built. */
export function takesIdeas(row: { caseStatus: string; projectStatus: string | null }) {
  return row.projectStatus ? ["active", "on_hold"].includes(row.projectStatus) : row.caseStatus === "active";
}
type Comment = { id: string; targetKind: BoardTarget; targetId: string; text: string; at: string; grantId: string | null; author: string | null };

async function comments(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<Comment>(
    `SELECT comment.id, comment.target_kind AS "targetKind", comment.target_id AS "targetId", comment.body AS text, comment.created_at AS at, comment.grant_id AS "grantId",
            coalesce(grant_row.confirmed_name, grant_row.name) AS author
       FROM client_portal_board_comments comment
       LEFT JOIN client_portal_grants grant_row ON grant_row.workspace_id = comment.workspace_id AND grant_row.id = comment.grant_id
      WHERE comment.workspace_id = $1 AND comment.case_id = $2 ORDER BY comment.created_at, comment.id`, [workspaceId, caseId])).rows
    .map((row) => ({ ...row, at: new Date(row.at).toISOString() }));
}

/** The latest shared version of each board on the case. */
async function sharedBoards(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ id: string; designId: string; title: string; room: string | null; number: number; status: string; mimeType: string; objectKey: string;
    previewKey: string | null; sharedAt: string }>(
    `SELECT version.id, design.id AS "designId", design.title, room.name AS room, version.number,
            CASE WHEN version.status = 'client_review' AND version.client_review_expires_at <= now() THEN 'expired' ELSE version.status END AS status,
            asset.mime_type AS "mimeType", asset.object_key AS "objectKey", asset.preview_key AS "previewKey", version.created_at AS "sharedAt"
       FROM pre_project_design_versions version
       JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.id = version.design_id AND design.archived_at IS NULL
       JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.id = version.asset_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = design.workspace_id AND room.case_id = design.case_id AND room.id = design.room_id
      WHERE version.workspace_id = $1 AND version.case_id = $2 AND version.status = ANY($3::text[])
        AND (design.stage = ANY($4::text[]) OR design.document_type = ANY($5::text[]))
        AND version.number = (SELECT max(latest.number) FROM pre_project_design_versions latest
                               WHERE latest.workspace_id = design.workspace_id AND latest.design_id = design.id AND latest.status = ANY($3::text[]))
      ORDER BY version.created_at DESC, design.title`, [workspaceId, caseId, SHARED, BOARD_STAGES, BOARD_TYPES])).rows;
}

/** Inspiration pins the client may see: shared by the team, or added by someone on the client's side. */
async function visiblePins(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ id: string; title: string; note: string; link: string; room: string | null; grantId: string | null; feeling: string | null; addedAt: string;
    shared: boolean; author: string | null }>(
    `SELECT entry.id, entry.title, entry.note, entry.reference_url AS link, room.name AS room, entry.client_grant_id AS "grantId", pin.sentiment AS feeling,
            coalesce(share.shared_at, entry.created_at) AS "addedAt", share.entry_id IS NOT NULL AS shared, coalesce(grant_row.confirmed_name, grant_row.name) AS author
       FROM pre_project_brief_entries entry
       LEFT JOIN pre_project_rooms room ON room.workspace_id = entry.workspace_id AND room.case_id = entry.case_id AND room.id = entry.room_id
       LEFT JOIN pre_project_moodboard_shares share ON share.workspace_id = entry.workspace_id AND share.entry_id = entry.id
       LEFT JOIN pre_project_moodboard_pins pin ON pin.workspace_id = entry.workspace_id AND pin.entry_id = entry.id
       LEFT JOIN client_portal_grants grant_row ON grant_row.workspace_id = entry.workspace_id AND grant_row.id = entry.client_grant_id
      WHERE entry.workspace_id = $1 AND entry.case_id = $2 AND entry.kind = 'inspiration' AND entry.archived_at IS NULL
        AND (share.entry_id IS NOT NULL OR entry.client_grant_id IS NOT NULL)
      ORDER BY 8 DESC, entry.id`, [workspaceId, caseId])).rows.map((row) => ({ ...row, addedAt: new Date(row.addedAt).toISOString() }));
}

async function pinPhotos(db: Db, workspaceId: string, caseId: string, entryIds: string[]) {
  if (!entryIds.length) return [];
  return (await db.query<{ entryId: string; id: string; objectKey: string; previewKey: string | null }>(
    `SELECT link.entry_id AS "entryId", asset.id, asset.object_key AS "objectKey", asset.preview_key AS "previewKey"
       FROM pre_project_entry_assets link JOIN pre_project_brief_assets asset ON asset.workspace_id = link.workspace_id AND asset.id = link.asset_id
      WHERE link.workspace_id = $1 AND link.case_id = $2 AND link.entry_id = ANY($3::uuid[]) AND asset.mime_type LIKE 'image/%' ORDER BY asset.created_at, asset.id`,
    [workspaceId, caseId, entryIds])).rows;
}

/** The client's moodboard for a project. `household` are the grants of everyone on the client's side of this case. */
export async function readMoodboard(db: Db, workspaceId: string, grant: Grant, caseId: string, caseActive: boolean, files: FilePresence) {
  const [boards, pins, notes] = [await sharedBoards(db, workspaceId, caseId), await visiblePins(db, workspaceId, caseId), await comments(db, workspaceId, caseId)];
  const photos = await files.present(await pinPhotos(db, workspaceId, caseId, pins.map((pin) => pin.id)));
  const mine = new Map((await db.query<{ key: string; reaction: "like" | "dislike" }>(
    `SELECT target_kind || ':' || target_id AS key, reaction FROM client_portal_reactions WHERE workspace_id = $1 AND grant_id = $2`, [workspaceId, contactId(grant)])).rows
    .map((row) => [row.key, row.reaction]));
  const thread = (kind: BoardTarget, id: string) => notes.filter((note) => note.targetKind === kind && note.targetId === id).map((note) => ({
    id: note.id, text: note.text, at: note.at, fromClient: Boolean(note.grantId), mine: note.grantId === grant.id,
    // The client's side by name; the team is "your design team", never a staff name.
    author: note.grantId ? note.author : null,
  }));
  const boardList = [];
  for (const board of boards) boardList.push({
    id: board.id, title: board.title, room: board.room, number: board.number, status: board.status, mimeType: board.mimeType, sharedAt: new Date(board.sharedAt).toISOString(),
    hasImage: board.mimeType.startsWith("image/") && ((await files.has(board.previewKey)) || (await files.has(board.objectKey))),
    reaction: mine.get(`design:${board.id}`) ?? null, comments: thread("design", board.id),
  });
  return {
    boards: boardList,
    pins: pins.map((pin) => ({
      id: pin.id, title: pin.title, note: pin.note, link: /^https?:\/\//i.test(pin.link) ? pin.link : null, room: pin.room, addedAt: pin.addedAt,
      feeling: (pin.feeling === "avoid" ? "avoid" : "love") as "love" | "avoid",
      fromClient: Boolean(pin.grantId), mine: pin.grantId === grant.id, author: pin.grantId ? pin.author : null,
      photos: photos.filter((photo) => photo.entryId === pin.id).map((photo) => ({ id: photo.id })),
      reaction: mine.get(`pin:${pin.id}`) ?? null, comments: thread("pin", pin.id),
    })),
    canAdd: caseActive,
  };
}

export type PortalMoodboard = Awaited<ReturnType<typeof readMoodboard>>;

/** A board or pin this client may react to or comment on, with its name for the team's notice. */
async function visibleTarget(db: Db, workspaceId: string, caseId: string, kind: unknown, id: unknown): Promise<{ kind: BoardTarget; id: string; title: string; designId: string | null }> {
  if (kind !== "pin" && kind !== "design") throw new BadRequestException("Choose a board or an inspiration.");
  if (typeof id !== "string" || !UUID.test(id)) throw new BadRequestException("Choose a board or an inspiration.");
  if (kind === "design") {
    const board = (await sharedBoards(db, workspaceId, caseId)).find((item) => item.id === id);
    if (!board) throw new NotFoundException("This board isn't shared with you any more.");
    return { kind, id, title: `${board.title} · V${board.number}`, designId: board.designId };
  }
  const pin = (await visiblePins(db, workspaceId, caseId)).find((item) => item.id === id);
  if (!pin) throw new NotFoundException("This inspiration isn't shared with you any more.");
  return { kind, id, title: pin.title, designId: null };
}

function words(value: unknown, max: number, message: string, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new BadRequestException(message);
  if (text.length > max) throw new BadRequestException(`Keep it under ${max} characters.`);
  return text;
}

const moodboardLink = (caseId: string, target?: { kind: BoardTarget; id: string; designId: string | null }) => target?.kind === "design" && target.designId
  ? `/workspace/pre-projects/cases/${caseId}/designs?file=${target.designId}` : `/workspace/pre-projects/cases/${caseId}/inspiration${target ? `?pin=${target.id}` : ""}`;

/** Like, dislike, or take the reaction back. The design team hears a like or dislike once. */
export async function react(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "moodboard");
  const target = await visibleTarget(ctx.db, ctx.workspaceId, row.caseId, body.targetKind, body.targetId);
  const reaction = body.reaction === "like" || body.reaction === "dislike" ? body.reaction : body.reaction === null ? null : undefined;
  if (reaction === undefined) throw new BadRequestException("Choose like or dislike.");
  if (reaction === null)
    await ctx.db.query(`DELETE FROM client_portal_reactions WHERE workspace_id = $1 AND grant_id = $2 AND target_kind = $3 AND target_id = $4`,
      [ctx.workspaceId, grant.id, target.kind, target.id]);
  else {
    await ctx.db.query(
      `INSERT INTO client_portal_reactions (workspace_id, case_id, grant_id, target_kind, target_id, reaction) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, grant_id, target_kind, target_id) DO UPDATE SET reaction = EXCLUDED.reaction, updated_at = now()`,
      [ctx.workspaceId, row.caseId, grant.id, target.kind, target.id, reaction]);
    const facts = await caseTitle(ctx.db, ctx.workspaceId, row.caseId);
    await tellStaff(ctx.db, { workspaceId: ctx.workspaceId, recipients: await caseTeam(ctx.db, ctx.workspaceId, row.caseId, ["design"]), code: "moodboard.client_reacted",
      variables: { title: facts.title, clientName: facts.clientName, actor: grant.name, item: target.title, reaction: reaction === "like" ? "liked" : "disliked", note: "" },
      deepLink: moodboardLink(row.caseId, target), key: `${grant.id}:${target.kind}:${target.id}:${reaction}` });
  }
  return { ok: true, reaction, entity: { type: "pre_project_case", id: row.caseId }, audit: { targetKind: target.kind, targetId: target.id, reaction } };
}

/** A comment on a board or pin; the design team hears it in the app and by email. */
export async function boardComment(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "moodboard");
  const target = await visibleTarget(ctx.db, ctx.workspaceId, row.caseId, body.targetKind, body.targetId);
  const text = words(body.text, 2000, "Write your comment.", true);
  const id = randomUUID();
  await ctx.db.query(`INSERT INTO client_portal_board_comments (workspace_id, id, case_id, target_kind, target_id, grant_id, body) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ctx.workspaceId, id, row.caseId, target.kind, target.id, grant.id, text]);
  const facts = await caseTitle(ctx.db, ctx.workspaceId, row.caseId);
  await tellStaff(ctx.db, { workspaceId: ctx.workspaceId, recipients: await caseTeam(ctx.db, ctx.workspaceId, row.caseId, ["design"]), code: "moodboard.client_commented",
    variables: { title: facts.title, clientName: facts.clientName, actor: grant.name, item: target.title, reaction: "", note: text.slice(0, 480) },
    deepLink: moodboardLink(row.caseId, target), key: id, email: true });
  return { ok: true, commentId: id, entity: { type: "pre_project_case", id: row.caseId }, audit: { targetKind: target.kind, targetId: target.id, commentId: id } };
}

const PLATFORMS: Array<[RegExp, string]> = [[/(^|\.)instagram\.com$/, "Instagram"], [/(^|\.)pinterest\.[a-z.]+$|(^|\.)pin\.it$/, "Pinterest"], [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, "YouTube"],
  [/(^|\.)tiktok\.com$/, "TikTok"], [/(^|\.)houzz\.[a-z.]+$/, "Houzz"], [/(^|\.)behance\.net$/, "Behance"]];

/** The client adds their own inspiration: photos, a link (Instagram, Pinterest, any site), or a note; the design team hears it. */
export async function addInspiration(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "moodboard");
  if (!takesIdeas(row)) throw new ConflictException("This project isn't taking new ideas any more.");
  const note = words(body.note, 3000, "");
  const raw = words(body.link, 2000, "");
  let link = "";
  let host = "";
  if (raw) {
    try { const url = new URL(raw); if (!/^https?:$/.test(url.protocol)) throw new Error("scheme"); link = url.toString(); host = url.hostname.replace(/^www\./, ""); }
    catch { throw new BadRequestException("Paste a full link starting with https://"); }
  }
  const files = await ownUploads(ctx.db, ctx.workspaceId, ctx.contact, row.caseId, body.uploadIds);
  if (files.some((file) => !file.mimeType.startsWith("image/"))) throw new BadRequestException("Add photos here; send PDFs in a message.");
  if (!files.length && !link && !note) throw new BadRequestException("Add a photo, a link or a note.");
  const roomId = body.roomId ? String(body.roomId) : null;
  if (roomId && (!UUID.test(roomId) || !(await ctx.db.query(`SELECT 1 FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [ctx.workspaceId, row.caseId, roomId])).rowCount))
    throw new BadRequestException("Choose a room of this project.");
  const platform = host ? PLATFORMS.find(([pattern]) => pattern.test(host))?.[1] ?? host : "";
  const title = (words(body.title, 240, "") || platform || note.split(/\s+/).slice(0, 8).join(" ") || files[0]?.name.replace(/\.[^.]+$/, "") || "Inspiration").slice(0, 240);
  const id = randomUUID();
  await ctx.db.query(
    `INSERT INTO pre_project_brief_entries (workspace_id, case_id, id, kind, title, room_id, note, category, source, reference_url, created_by, updated_by, client_grant_id)
     VALUES ($1, $2, $3, 'inspiration', $4, $5, $6, 'Inspiration', 'client', $7, NULL, NULL, $8)`,
    [ctx.workspaceId, row.caseId, id, title, roomId, note, link, grant.id]);
  for (const file of files)
    await ctx.db.query(`INSERT INTO pre_project_entry_assets (workspace_id, case_id, entry_id, asset_id) VALUES ($1, $2, $3, $4)`, [ctx.workspaceId, row.caseId, id, file.id]);
  // The inspiration week starts with the first inspiration on the case, whoever adds it.
  await startInspirationTimer(ctx.db, ctx.workspaceId, row.caseId);
  const facts = await caseTitle(ctx.db, ctx.workspaceId, row.caseId);
  await tellStaff(ctx.db, { workspaceId: ctx.workspaceId, recipients: await caseTeam(ctx.db, ctx.workspaceId, row.caseId, ["design"]), code: "moodboard.client_added",
    variables: { title: facts.title, clientName: facts.clientName, actor: grant.name, item: title, reaction: "", note: note.slice(0, 280) },
    deepLink: moodboardLink(row.caseId, { kind: "pin", id, designId: null }), key: id });
  return { ok: true, pinId: id, entity: { type: "pre_project_case", id: row.caseId }, audit: { pinId: id, photos: files.length, link: Boolean(link) } };
}

/** The client takes back an inspiration someone on their side added. */
export async function removeInspiration(ctx: DecisionContext, body: Record<string, unknown>) {
  const { row } = await grantFor(ctx, body.caseId, "moodboard");
  const pinId = typeof body.pinId === "string" && UUID.test(body.pinId) ? body.pinId : "";
  if (!pinId) throw new BadRequestException("Choose an inspiration.");
  const household = ctx.contact.grants.filter((item) => item.caseId === row.caseId).map((item) => item.id);
  const pin = (await ctx.db.query<{ grantId: string | null; archived: boolean }>(
    `SELECT client_grant_id AS "grantId", archived_at IS NOT NULL AS archived FROM pre_project_brief_entries WHERE workspace_id = $1 AND case_id = $2 AND id = $3 AND kind = 'inspiration'`,
    [ctx.workspaceId, row.caseId, pinId])).rows[0];
  if (!pin) throw new NotFoundException("This inspiration isn't there any more.");
  if (!pin.grantId || !household.includes(pin.grantId)) throw new ForbiddenException("You can remove only the ideas you added.");
  if (!pin.archived)
    await ctx.db.query(`UPDATE pre_project_brief_entries SET archived_at = now(), version = version + 1, updated_by = NULL, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
      [ctx.workspaceId, pinId]);
  return { ok: true, entity: { type: "pre_project_case", id: row.caseId }, audit: { pinId } };
}

// ---------- the team's side ----------

/** What the client did on the case's moodboard, for the team: what's shared, the client's reactions and the comments. */
export async function readStaffBoard(db: Db, workspaceId: string, caseId: string) {
  const shared = (await db.query<{ entryId: string; sharedAt: string }>(
    `SELECT entry_id AS "entryId", shared_at AS "sharedAt" FROM pre_project_moodboard_shares WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows;
  const reactions = (await db.query<{ targetKind: BoardTarget; targetId: string; reaction: "like" | "dislike"; by: string; at: string }>(
    `SELECT reaction.target_kind AS "targetKind", reaction.target_id AS "targetId", reaction.reaction, coalesce(grant_row.confirmed_name, grant_row.name) AS by, reaction.updated_at AS at
       FROM client_portal_reactions reaction JOIN client_portal_grants grant_row ON grant_row.workspace_id = reaction.workspace_id AND grant_row.id = reaction.grant_id
      WHERE reaction.workspace_id = $1 AND reaction.case_id = $2 ORDER BY reaction.updated_at DESC`, [workspaceId, caseId])).rows;
  const notes = (await db.query<{ id: string; targetKind: BoardTarget; targetId: string; text: string; at: string; fromClient: boolean; author: string }>(
    `SELECT comment.id, comment.target_kind AS "targetKind", comment.target_id AS "targetId", comment.body AS text, comment.created_at AS at, comment.grant_id IS NOT NULL AS "fromClient",
            coalesce(grant_row.confirmed_name, grant_row.name, person.display_name, '') AS author
       FROM client_portal_board_comments comment
       LEFT JOIN client_portal_grants grant_row ON grant_row.workspace_id = comment.workspace_id AND grant_row.id = comment.grant_id
       LEFT JOIN users person ON person.id = comment.author_user_id
      WHERE comment.workspace_id = $1 AND comment.case_id = $2 ORDER BY comment.created_at, comment.id`, [workspaceId, caseId])).rows;
  const boards = (await sharedBoards(db, workspaceId, caseId)).map((board) => ({ id: board.id, designId: board.designId, title: board.title, number: board.number, room: board.room }));
  // Whether the client can see the moodboard at all: the portal is on and its moodboard is shown for this project.
  const settings = await readPortalSettings(db, workspaceId);
  const projectId = (await db.query<{ id: string }>(`SELECT id FROM delivery_projects WHERE workspace_id = $1 AND case_id = $2 AND started_at IS NOT NULL ORDER BY started_at DESC LIMIT 1`,
    [workspaceId, caseId])).rows[0]?.id;
  const access = projectId ? await readProjectAccess(db, workspaceId, projectId) : null;
  return {
    portalOpen: settings.enabled && !access?.paused && effectiveSections(settings, access).moodboard,
    shared: shared.map((item) => item.entryId),
    sharedAt: Object.fromEntries(shared.map((item) => [item.entryId, new Date(item.sharedAt).toISOString()])),
    reactions: reactions.map((item) => ({ ...item, at: new Date(item.at).toISOString() })),
    comments: notes.map((item) => ({ ...item, at: new Date(item.at).toISOString() })),
    boards,
  };
}

/** Shows or hides moodboard pins in the client's portal (set-based, so a retry changes nothing). Returns the pins that changed. */
export async function shareBoard(db: Db, workspaceId: string, caseId: string, userId: string, body: Record<string, unknown>) {
  const ids = Array.isArray(body.entryIds) ? [...new Set(body.entryIds.filter((id): id is string => typeof id === "string" && UUID.test(id)))] : [];
  if (!ids.length || ids.length > 500 || typeof body.shared !== "boolean") throw new BadRequestException("Choose the pins to show or hide.");
  const found = (await db.query<{ id: string }>(
    `SELECT id FROM pre_project_brief_entries WHERE workspace_id = $1 AND case_id = $2 AND kind = 'inspiration' AND archived_at IS NULL AND id = ANY($3::uuid[])`,
    [workspaceId, caseId, ids])).rows;
  if (found.length !== ids.length) throw new BadRequestException("Choose moodboard pins of this project.");
  const changed = body.shared
    ? (await db.query<{ id: string }>(
      `INSERT INTO pre_project_moodboard_shares (workspace_id, case_id, entry_id, shared_by) SELECT $1, $2, id, $4 FROM unnest($3::uuid[]) AS id
       ON CONFLICT (workspace_id, entry_id) DO NOTHING RETURNING entry_id AS id`, [workspaceId, caseId, ids, userId])).rows
    : (await db.query<{ id: string }>(`DELETE FROM pre_project_moodboard_shares WHERE workspace_id = $1 AND case_id = $2 AND entry_id = ANY($3::uuid[]) RETURNING entry_id AS id`,
      [workspaceId, caseId, ids])).rows;
  return changed.map((row) => row.id);
}

/** The design team answers a client's comment on a board or pin; the client is told by email. The id makes a retry safe. */
export async function replyBoard(db: Db, workspaceId: string, caseId: string, userId: string, body: Record<string, unknown>) {
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : "";
  if (!id) throw new BadRequestException("Try that again.");
  const text = words(body.text, 2000, "Write your reply.", true);
  const kind = body.targetKind;
  const targetId = typeof body.targetId === "string" && UUID.test(body.targetId) ? body.targetId : "";
  if ((kind !== "pin" && kind !== "design") || !targetId) throw new BadRequestException("Choose a board or pin.");
  const existing = (await db.query<{ body: string; author: string | null }>(`SELECT body, author_user_id AS author FROM client_portal_board_comments WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id])).rows[0];
  if (existing) {
    if (existing.body !== text || existing.author !== userId) throw new ConflictException("This reply was already sent with other words. Reload.");
    return { id, replayed: true };
  }
  const target = await visibleTarget(db, workspaceId, caseId, kind, targetId).catch(() => null);
  if (!target) throw new NotFoundException("The client can't see this any more. Share it again to reply.");
  await db.query(`INSERT INTO client_portal_board_comments (workspace_id, id, case_id, target_kind, target_id, author_user_id, body) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [workspaceId, id, caseId, kind, targetId, userId, text]);
  await tellClients(db, { workspaceId, caseId, event: "team_replied", recordId: `board:${id}`, title: target.title, note: `${target.title}: ${text}` });
  return { id, replayed: false };
}
