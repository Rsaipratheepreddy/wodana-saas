import type { PoolClient } from "pg";
import { decimalText } from "../project-core/project-item-proof";

type Db = Pick<PoolClient, "query">;
const OPEN = ["active", "on_hold"];

/**
 * The shop drawings of each item, as the client sees them in the portal: only versions the lead designer approved
 * (waiting for the client's signature, signed, or sent back with the client's own note), never the team's notes, a
 * version still being checked or one the lead designer returned. The decision-maker signs one or several at once with a
 * one-time code bound to exactly those versions, or asks for changes to one.
 */
export async function readPortalItemDrawings(db: Db, workspaceId: string, projectId: string, approver: boolean, projectStatus: string) {
  const rows = (await db.query<{
    lineId: string; versionId: string; title: string; area: string | null; number: number; status: "with_client" | "changes_asked" | "signed"; name: string; mimeType: string; hasPreview: boolean;
    quantity: string; unit: string; width: string | null; height: string | null; depth: string | null; dimensionUnit: string; decidedAt: string | null; clientNote: string; current: boolean;
    signedBy: string | null; signedAt: string | null;
  }>(
    `SELECT DISTINCT ON (version.line_id) version.line_id AS "lineId", version.id AS "versionId", line.title, room.name AS area, version.number, version.status,
            version.original_name AS name, version.mime_type AS "mimeType", version.preview_key IS NOT NULL AS "hasPreview", version.quantity::text AS quantity, version.unit,
            version.width::text AS width, version.height::text AS height, version.depth::text AS depth, version.dimension_unit AS "dimensionUnit",
            version.client_decided_at AS "decidedAt", version.client_note AS "clientNote", item.current_version_id = version.id AS current,
            signature.signer_name AS "signedBy", signature.signed_at AS "signedAt"
       FROM project_item_drawing_versions version
       JOIN project_item_drawings item ON item.workspace_id = version.workspace_id AND item.id = version.item_drawing_id
       JOIN project_boq_lines line ON line.workspace_id = version.workspace_id AND line.id = version.line_id
       JOIN delivery_projects project ON project.workspace_id = version.workspace_id AND project.id = version.project_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
       LEFT JOIN project_item_drawing_signatures signature ON signature.workspace_id = version.workspace_id AND signature.version_id = version.id
      WHERE version.workspace_id = $1 AND version.project_id = $2 AND version.status IN ('with_client', 'changes_asked', 'signed')
      ORDER BY version.line_id, version.number DESC`, [workspaceId, projectId])).rows;
  const open = OPEN.includes(projectStatus);
  const items = rows.map((row) => ({
    lineId: row.lineId, versionId: row.versionId, title: row.title, area: row.area, number: row.number, status: row.status, name: row.name, mimeType: row.mimeType,
    hasPreview: row.hasPreview, quantity: decimalText(row.quantity)!, unit: row.unit, width: decimalText(row.width), height: decimalText(row.height), depth: decimalText(row.depth),
    dimensionUnit: row.dimensionUnit, decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : null, note: row.status === "changes_asked" ? row.clientNote : "",
    signedBy: row.signedBy, signedAt: row.signedAt ? new Date(row.signedAt).toISOString() : null,
    canSign: approver && open && row.current && row.status === "with_client",
  })).sort((a, b) => Number(b.canSign) - Number(a.canSign) || (a.area ?? "").localeCompare(b.area ?? "") || a.title.localeCompare(b.title));
  return { items, canSign: items.some((item) => item.canSign) };
}
