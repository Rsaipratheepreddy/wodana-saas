import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { deviceLabel } from "../documents/document-sends";
import { itemsLabel, leadDesigners, membershipOfUser, projectManagers, tellItemPeople } from "./project-item-notices";
import { assertSignable, type VersionStatus } from "./project-item-proof";

type Db = Pick<PoolClient, "query">;

type LockedVersion = { id: string; lineId: string; itemId: string; status: VersionStatus; current: boolean; sha256: string; title: string; createdBy: string; number: number };

/** The versions asked for, with their item rows, locked (only this project's). */
export async function lockVersions(db: Db, workspaceId: string, projectId: string, versionIds: string[]): Promise<LockedVersion[]> {
  return (await db.query<LockedVersion>(
    `SELECT version.id, version.line_id AS "lineId", item.id AS "itemId", version.status, item.current_version_id = version.id AS current, version.sha256, line.title,
            version.created_by AS "createdBy", version.number
       FROM project_item_drawing_versions version
       JOIN project_item_drawings item ON item.workspace_id = version.workspace_id AND item.id = version.item_drawing_id
       JOIN project_boq_lines line ON line.workspace_id = version.workspace_id AND line.id = version.line_id
      WHERE version.workspace_id = $1 AND version.project_id = $2 AND version.id = ANY($3::uuid[])
      ORDER BY line.position, line.id
      FOR UPDATE OF version, item`, [workspaceId, projectId, versionIds])).rows;
}

/** Whether any of the project's items has a drawing waiting for the client's signature (or this one version, when named). */
export async function itemDrawingsWaiting(db: Db, workspaceId: string, projectId: string, versionId?: string) {
  return Boolean((await db.query(
    `SELECT 1 FROM project_item_drawing_versions version
       JOIN project_item_drawings item ON item.workspace_id = version.workspace_id AND item.id = version.item_drawing_id AND item.current_version_id = version.id
      WHERE version.workspace_id = $1 AND version.project_id = $2 AND version.status = 'with_client' AND ($3::uuid IS NULL OR version.id = $3::uuid) LIMIT 1`,
    [workspaceId, projectId, versionId ?? null])).rowCount);
}

/**
 * The client signs one or several items' shop drawings in the portal, confirmed with a one-time code (checked by the
 * caller). Each version is signed, its item locked to the version's quantity and sizes, and the signature kept like
 * every other: who, when, the code, the device and the fingerprint of the signed file. The project manager hears.
 */
export async function signItemDrawings(db: Db, input: {
  workspaceId: string; projectId: string; caseId: string; versionIds: string[]; batchId: string; grant: { id: string; name: string }; challengeId: string; commandId: string;
  userAgent: string | null; versions?: LockedVersion[];
}) {
  const { workspaceId, projectId } = input;
  const versions = input.versions ?? await lockVersions(db, workspaceId, projectId, input.versionIds);
  assertSignable(input.versionIds, versions);
  const device = deviceLabel(input.userAgent)?.slice(0, 120) ?? null;
  const toCheck: string[] = [];
  for (const version of versions) {
    // Guide step 19: the signed drawing's quantity becomes the item's; its own materials follow it (before is what it was).
    toCheck.push(...await followSignedQuantity(db, workspaceId, projectId, version));
    await db.query(`UPDATE project_item_drawing_versions SET status = 'signed', client_decided_at = now(), client_grant_id = $3 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, version.id, input.grant.id]);
    await db.query(
      `UPDATE project_item_drawings item SET status = 'signed', locked_at = now(), locked_version_id = version.id, locked_quantity = version.quantity, locked_unit = version.unit,
              locked_width = version.width, locked_height = version.height, locked_depth = version.depth, locked_dimension_unit = version.dimension_unit,
              version = item.version + 1, updated_at = now()
         FROM project_item_drawing_versions version
        WHERE item.workspace_id = $1 AND item.id = $2 AND version.workspace_id = item.workspace_id AND version.id = $3`, [workspaceId, version.itemId, version.id]);
    await db.query(
      `INSERT INTO project_item_drawing_signatures (workspace_id, id, project_id, case_id, line_id, version_id, batch_id, grant_id, signer_name, challenge_id, signer_user_agent, signer_device,
         file_sha256, command_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [workspaceId, randomUUID(), projectId, input.caseId, version.lineId, version.id, input.batchId, input.grant.id, input.grant.name.slice(0, 200), input.challengeId,
        input.userAgent, device, version.sha256, input.commandId]);
  }
  await tellItemPeople(db, { workspaceId, projectId, key: `signed:${input.batchId}`, actorUserId: null, actorName: input.grant.name, code: "project.item_drawings_signed",
    memberships: await projectManagers(db, workspaceId, projectId), item: itemsLabel(versions.map((version) => version.title)),
    note: toCheck.length ? `Check the quantities of materials shared with other items: ${[...new Set(toCheck)].join(", ")}`.slice(0, 500) : "" });
  return { signed: versions.length, lines: versions.map((version) => version.lineId) };
}

/**
 * The item's quantity moves to the signed drawing's: the materials used only by this item scale with it (exact to
 * 4 decimals); materials it shares with other items are named for the project manager to check. Returns those names.
 */
async function followSignedQuantity(db: Db, workspaceId: string, projectId: string, version: LockedVersion) {
  const row = (await db.query<{ before: string; after: string; same: boolean }>(
    `SELECT coalesce(CASE WHEN item.locked_unit IS NULL OR item.locked_unit = line.unit THEN item.locked_quantity END, line.quantity)::text AS before,
            signed.quantity::text AS after, coalesce(signed.unit, line.unit) = line.unit AS same
       FROM project_item_drawings item
       JOIN project_boq_lines line ON line.workspace_id = item.workspace_id AND line.id = item.line_id
       JOIN project_item_drawing_versions signed ON signed.workspace_id = item.workspace_id AND signed.id = $3
      WHERE item.workspace_id = $1 AND item.id = $2`, [workspaceId, version.itemId, version.id])).rows[0];
  if (!row?.same || !row.after || Number(row.before) <= 0 || row.before === row.after) return [];
  await db.query(
    `UPDATE project_material_items SET quantity = round(quantity * $4::numeric / $5::numeric, 4), version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND project_id = $2 AND boq_line_ids = ARRAY[$3::uuid]`, [workspaceId, projectId, version.lineId, row.after, row.before]);
  return (await db.query<{ name: string }>(
    `SELECT name FROM project_material_items WHERE workspace_id = $1 AND project_id = $2 AND $3::uuid = ANY(boq_line_ids) AND cardinality(boq_line_ids) > 1 ORDER BY position`,
    [workspaceId, projectId, version.lineId])).rows.map((material) => material.name);
}

/** The client asks for changes to one item's drawing (with what to change); whoever uploaded it and the lead designer hear. */
export async function askItemDrawingChanges(db: Db, input: { workspaceId: string; projectId: string; version: LockedVersion; grant: { id: string; name: string }; note: string }) {
  const { workspaceId, projectId, version } = input;
  await db.query(`UPDATE project_item_drawing_versions SET status = 'changes_asked', client_decided_at = now(), client_grant_id = $3, client_note = $4 WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, version.id, input.grant.id, input.note]);
  await db.query(`UPDATE project_item_drawings SET status = 'changes_asked', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, version.itemId]);
  const uploader = await membershipOfUser(db, workspaceId, version.createdBy);
  await tellItemPeople(db, { workspaceId, projectId, key: `client-changes:${version.id}`, actorUserId: null, actorName: input.grant.name, code: "project.item_drawing_returned",
    memberships: [...(uploader ? [uploader] : []), ...(await leadDesigners(db, workspaceId, projectId))], item: `${version.title} · V${version.number}`, note: input.note });
}
