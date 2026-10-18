import { BadRequestException, ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { priceHolds } from "../purchasing/price-hold";
import { readTeam } from "./project-core.store";
import { tellItemPeople } from "./project-item-notices";
import { readItemDrawingRecords, readProjectItems } from "./project-item-proof";

type Db = Pick<PoolClient, "query">;

export type ItemSupplies = { method: "ordered" | "from_stock"; note: string; signedByName: string | null; signedAt: string };

/** Each item's supplies sign-off on a project, by line. */
export async function readItemSupplies(db: Db, workspaceId: string, projectId: string) {
  return new Map((await db.query<ItemSupplies & { lineId: string }>(
    `SELECT supplies.line_id AS "lineId", supplies.method, supplies.note, coalesce(person.display_name, person.primary_email) AS "signedByName", supplies.signed_at AS "signedAt"
       FROM project_item_supplies supplies LEFT JOIN users person ON person.id = supplies.signed_by
      WHERE supplies.workspace_id = $1 AND supplies.project_id = $2`, [workspaceId, projectId])).rows.map(({ lineId, ...rest }) => [lineId, rest]));
}

/** Whether procurement signed off the supplies of one item (the release check). */
export async function suppliesSignedOff(db: Db, workspaceId: string, lineId: string) {
  return Boolean((await db.query(`SELECT 1 FROM project_item_supplies WHERE workspace_id = $1 AND line_id = $2`, [workspaceId, lineId])).rowCount);
}

/**
 * Guide steps 17–21, the gate per item before its supplies are signed off: its materials are on the material list with
 * every detail, its shop drawing is signed by the client (where it needs one), and nothing holds its price (the QS check).
 * Returns what's still missing, in plain words.
 */
export async function suppliesBlockers(db: Db, workspaceId: string, projectId: string, lineId: string) {
  const missing: string[] = [];
  const materials = (await db.query<{ name: string; gaps: string[] }>(
    `SELECT name, array_remove(ARRAY[
              CASE WHEN btrim(coalesce(brand, '')) = '' THEN 'brand' END, CASE WHEN btrim(code) = '' THEN 'code' END,
              CASE WHEN btrim(coalesce(colour, '')) = '' THEN 'colour' END, CASE WHEN btrim(coalesce(size, '')) = '' THEN 'size' END,
              CASE WHEN btrim(coalesce(finish, '')) = '' THEN 'finish' END, CASE WHEN btrim(supplier) = '' THEN 'supplier' END,
              CASE WHEN sample_photo_asset_id IS NULL THEN 'sample photo' END], NULL) AS gaps
       FROM project_material_items WHERE workspace_id = $1 AND project_id = $2 AND $3::uuid = ANY(boq_line_ids) ORDER BY position`, [workspaceId, projectId, lineId])).rows;
  if (!materials.length) missing.push("its materials aren't on the material list");
  for (const material of materials.filter((row) => row.gaps.length)) missing.push(`${material.name} needs its ${material.gaps.join(", ")}`);
  const item = (await readProjectItems(db, workspaceId, projectId)).find((candidate) => candidate.lineId === lineId);
  if (item?.needed) {
    const drawing = (await readItemDrawingRecords(db, workspaceId, projectId)).rows.find((row) => row.lineId === lineId);
    if (drawing?.status !== "signed") missing.push("the client hasn't signed its shop drawing");
  }
  const hold = (await priceHolds(db, workspaceId, { lineIds: [lineId] })).get(lineId);
  if (hold) missing.push(hold);
  return missing;
}

/**
 * Procurement ordered the item's materials or checked the factory's stock, and signs off its supplies (once): the
 * project manager and the factory lead hear that production is about to start.
 */
export async function signOffSupplies(db: Db, input: { workspaceId: string; projectId: string; lineId: string; title: string; method: unknown; note: unknown; userId: string }) {
  const { workspaceId, projectId, lineId } = input;
  if (input.method !== "ordered" && input.method !== "from_stock") throw new BadRequestException("Say whether the materials were ordered or taken from stock.");
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 1000) throw new BadRequestException("Keep the note under 1000 characters.");
  if (await suppliesSignedOff(db, workspaceId, lineId)) throw new ConflictException("Its supplies are already signed off.");
  const missing = await suppliesBlockers(db, workspaceId, projectId, lineId);
  if (missing.length) throw new ConflictException(`Before its supplies are signed off: ${missing.join("; ")}.`);
  await db.query(`INSERT INTO project_item_supplies (workspace_id, project_id, line_id, method, note, signed_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [workspaceId, projectId, lineId, input.method, note, input.userId]);
  await recordAudit(db, { workspaceId, actorUserId: input.userId, action: "project.item_supplies_signed", entityType: "project", entityId: projectId, after: { lineId, method: input.method, note } });
  const team = (await readTeam(db, workspaceId, [projectId])).get(projectId) ?? [];
  await tellItemPeople(db, { workspaceId, projectId, key: `supplies:${lineId}`, actorUserId: input.userId, code: "project.item_supplies_signed",
    memberships: team.filter((member) => member.lead || member.roles.includes("factory_lead")).map((member) => member.membershipId), item: input.title, note });
}
