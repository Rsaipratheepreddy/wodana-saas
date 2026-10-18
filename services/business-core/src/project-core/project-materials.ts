import { randomUUID } from "node:crypto";
import { bindEvidence, evidenceFor, evidenceIds } from "../evidence/decision-evidence";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { canonicalHash } from "../crm/shared/crm-types";
import { event } from "./project-scope";

type Db = Pick<PoolClient, "query">;

export type MaterialItem = {
  id: string; position: number; catalogItemId: string | null; name: string; code: string; specification: string; supplier: string;
  quantity: string | null; unit: string; note: string; boqLineIds: string[]; version: number;
  /** Guide step 17: what the Material Coordinator fills in for each material, with its sample photo (a case file). */
  brand?: string; colour?: string; size?: string; finish?: string; samplePhotoAssetId?: string | null;
  /** False for materials the client doesn't choose (cement, screws): they don't wait for the client's sign-off. */
  clientChoice: boolean;
  /** PLM-055: product details for the technical team, with who added them and when. Internal: not part of what the client signs. */
  teamNote?: string; teamNoteByName?: string | null; teamNoteAt?: string | null;
};
type Revision = {
  id: string; number: number; status: "sent" | "signed_off" | "changes_requested"; contentHash: string; sentAt: string; sentByName: string | null;
  decidedAt: string | null; decidedBy: string | null; method: string | null; note: string;
};

const METHODS = ["signed_document", "email", "in_person", "phone", "message"] as const;

async function readItems(db: Db, workspaceId: string, projectId: string): Promise<MaterialItem[]> {
  return (await db.query<MaterialItem>(
    `SELECT item.id, item.position, item.catalog_item_id AS "catalogItemId", item.name, item.code, item.specification, item.supplier, item.quantity::text AS quantity, item.unit, item.note,
            item.boq_line_ids AS "boqLineIds", item.version, item.client_choice AS "clientChoice",
            item.brand, item.colour, item.size, item.finish, item.sample_photo_asset_id AS "samplePhotoAssetId",
            item.team_note AS "teamNote", writer.display_name AS "teamNoteByName", item.team_note_at AS "teamNoteAt"
       FROM project_material_items item LEFT JOIN users writer ON writer.id = item.team_note_by
      WHERE item.workspace_id = $1 AND item.project_id = $2 ORDER BY item.position, lower(item.name)`, [workspaceId, projectId])).rows;
}

/** What the client signs: the materials they choose, in a stable shape (so its fingerprint only changes when the list does). */
function signable(items: MaterialItem[]) {
  return items.filter((item) => item.clientChoice).map((item) => ({ id: item.id, name: item.name, code: item.code, specification: item.specification, supplier: item.supplier,
    quantity: item.quantity, unit: item.unit, note: item.note, catalogItemId: item.catalogItemId, boqLineIds: [...item.boqLineIds].sort() }));
}

/** The whole list in a stable shape, for the QS's confirmation (PLM-159): its fingerprint changes only when the list does. */
function listFingerprint(items: MaterialItem[]) {
  return canonicalHash(items.map((item) => ({ id: item.id, name: item.name, code: item.code, specification: item.specification, supplier: item.supplier,
    quantity: item.quantity, unit: item.unit, catalogItemId: item.catalogItemId, boqLineIds: [...item.boqLineIds].sort() })));
}

export type MaterialListConfirmation = { confirmedAt: string; confirmedByName: string | null; current: boolean };

/** The QS's confirmation of the material list: when, by whom, and whether the list is still as confirmed. Null when never confirmed. */
export async function readMaterialListConfirmation(db: Db, workspaceId: string, projectId: string): Promise<MaterialListConfirmation | null> {
  const row = (await db.query<{ confirmedAt: string | null; confirmedByName: string | null; hash: string | null }>(
    `SELECT project.material_list_confirmed_at AS "confirmedAt", person.display_name AS "confirmedByName", project.material_list_confirmed_hash AS hash
       FROM delivery_projects project LEFT JOIN users person ON person.id = project.material_list_confirmed_by WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0];
  if (!row?.confirmedAt) return null;
  return { confirmedAt: row.confirmedAt, confirmedByName: row.confirmedByName, current: row.hash === listFingerprint(await readItems(db, workspaceId, projectId)) };
}

/** Whether the QS confirmed the material list as it is now (a project with no list has nothing to confirm: false, so the gate asks). */
export async function materialListConfirmed(db: Db, workspaceId: string, projectId: string) {
  return (await readMaterialListConfirmation(db, workspaceId, projectId))?.current ?? false;
}

/** The QS confirms the list as it is now; confirming an unchanged list again changes nothing. */
export async function confirmMaterialList(db: Db, workspaceId: string, projectId: string, actorUserId: string) {
  const items = await readItems(db, workspaceId, projectId);
  if (!items.length) throw new ConflictException("Add the materials before confirming the list.");
  const hash = listFingerprint(items);
  await db.query(`UPDATE delivery_projects SET material_list_confirmed_by = $3, material_list_confirmed_at = now(), material_list_confirmed_hash = $4 WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, projectId, actorUserId, hash]);
  return { items: items.length, hash };
}

async function latestRevision(db: Db, workspaceId: string, projectId: string, lock = false): Promise<Revision | undefined> {
  return (await db.query<Revision>(
    `SELECT revision.id, revision.number, revision.status, revision.content_hash AS "contentHash", revision.sent_at AS "sentAt", sender.display_name AS "sentByName",
            revision.decided_at AS "decidedAt", revision.decided_by_name AS "decidedBy", revision.decision_method AS method, revision.decision_note AS note
       FROM project_material_revisions revision LEFT JOIN users sender ON sender.id = revision.sent_by
      WHERE revision.workspace_id = $1 AND revision.project_id = $2 ORDER BY revision.number DESC LIMIT 1 ${lock ? "FOR UPDATE OF revision" : ""}`,
    [workspaceId, projectId])).rows[0];
}

/**
 * True when the list is agreed: it has materials, and the ones the client chooses were approved in the
 * latest revision without changing since (a list of materials the client doesn't choose needs nothing).
 */
export async function materialsSignedOff(db: Db, workspaceId: string, projectId: string) {
  const items = await readItems(db, workspaceId, projectId);
  return items.length > 0 && await choicesSignedOff(db, workspaceId, projectId, items);
}

/** True when nothing the client chooses is waiting for their sign-off; what gates ordering a project's client-chosen materials. */
export async function clientChoicesSignedOff(db: Db, workspaceId: string, projectId: string) {
  return choicesSignedOff(db, workspaceId, projectId, await readItems(db, workspaceId, projectId));
}

async function choicesSignedOff(db: Db, workspaceId: string, projectId: string, items: MaterialItem[]) {
  const choices = signable(items);
  if (!choices.length) return true;
  const revision = await latestRevision(db, workspaceId, projectId);
  if (!revision || revision.status !== "signed_off") return false;
  return canonicalHash(choices) === revision.contentHash;
}

/** The list, where each material is used, and its revisions with the client's decisions. */
export async function readMaterials(db: Db, workspaceId: string, projectId: string) {
  const items = await readItems(db, workspaceId, projectId);
  const lines = new Map((await db.query<{ id: string; title: string; areaName: string | null }>(
    `SELECT line.id, line.title, room.name AS "areaName" FROM project_boq_lines line
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active'`, [workspaceId, projectId])).rows.map((row) => [row.id, row]));
  const revisions = (await db.query<Revision>(
    `SELECT revision.id, revision.number, revision.status, revision.content_hash AS "contentHash", revision.sent_at AS "sentAt", sender.display_name AS "sentByName",
            revision.decided_at AS "decidedAt", revision.decided_by_name AS "decidedBy", revision.decision_method AS method, revision.decision_note AS note
       FROM project_material_revisions revision LEFT JOIN users sender ON sender.id = revision.sent_by
      WHERE revision.workspace_id = $1 AND revision.project_id = $2 ORDER BY revision.number DESC`, [workspaceId, projectId])).rows;
  const latest = revisions[0];
  const decisions = latest ? (await db.query<{ itemId: string; decision: "approved" | "rejected"; note: string }>(
    `SELECT item_id AS "itemId", decision, note FROM project_material_decisions WHERE workspace_id = $1 AND revision_id = $2`, [workspaceId, latest.id])).rows : [];
  const changed = Boolean(latest) && canonicalHash(signable(items)) !== latest.contentHash;
  // One word for where the list stands.
  const state = !latest ? "draft" : latest.status === "sent" ? "sent" : changed ? "changed" : latest.status;
  const caseId = (await db.query<{ caseId: string | null }>(`SELECT case_id AS "caseId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0]?.caseId ?? null;
  return {
    caseId, missingForTechnical: await materialListMissing(db, workspaceId, projectId),
    state, revisions: await withDecisionFiles(db, workspaceId, revisions.map(({ contentHash, ...revision }) => { void contentHash; return revision; })),
    items: items.map((item) => ({ ...item, usedIn: item.boqLineIds.map((id) => lines.get(id)).filter(Boolean),
      decision: latest && latest.status !== "sent" && !changed ? decisions.find((entry) => entry.itemId === item.id) ?? null : null })),
  };
}

/**
 * Adds the materials the scope already names: a catalog material or finished product on a BOQ line, or
 * the materials an assembly on a line is made of. One row per catalog item, tied to every line that uses it.
 */
export async function suggestMaterials(db: Db, workspaceId: string, projectId: string) {
  await assertEditable(db, workspaceId, projectId);
  const found = (await db.query<{ lineId: string; itemId: string; name: string; code: string; description: string; unit: string }>(
    `SELECT line.id AS "lineId", item.id AS "itemId", item.name, item.code, item.description, item.unit_code AS unit
       FROM project_boq_lines line
       JOIN catalog_items item ON item.workspace_id = line.workspace_id AND item.id = line.catalog_item_id
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active' AND item.item_type IN ('material', 'product', 'ready_made')
     UNION ALL
     SELECT line.id, part.id, part.name, part.code, part.description, part.unit_code
       FROM project_boq_lines line
       JOIN catalog_items parent ON parent.workspace_id = line.workspace_id AND parent.id = line.catalog_item_id AND parent.item_type IN ('assembly', 'package')
       JOIN catalog_components component ON component.workspace_id = line.workspace_id AND component.parent_item_id = parent.id
       JOIN catalog_items part ON part.workspace_id = component.workspace_id AND part.id = component.component_item_id AND part.item_type = 'material'
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active'`, [workspaceId, projectId])).rows;
  const existing = new Map((await readItems(db, workspaceId, projectId)).filter((item) => item.catalogItemId).map((item) => [item.catalogItemId!, item]));
  let position = (await db.query<{ next: number }>(`SELECT coalesce(max(position) + 1, 0)::int AS next FROM project_material_items WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0].next;
  let added = 0;
  for (const row of found) {
    const item = existing.get(row.itemId);
    if (item) {
      if (item.boqLineIds.includes(row.lineId)) continue;
      item.boqLineIds.push(row.lineId);
      await db.query(`UPDATE project_material_items SET boq_line_ids = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, item.id, item.boqLineIds]);
    } else {
      const id = randomUUID();
      await db.query(
        `INSERT INTO project_material_items (id, workspace_id, project_id, position, catalog_item_id, name, code, specification, unit, boq_line_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, workspaceId, projectId, position++, row.itemId, row.name.slice(0, 240), row.code.slice(0, 80), (row.description ?? "").slice(0, 1000), row.unit ?? "", [row.lineId]]);
      existing.set(row.itemId, { id, position, catalogItemId: row.itemId, name: row.name, code: row.code, specification: row.description, supplier: "", quantity: null, unit: row.unit, note: "", boqLineIds: [row.lineId], version: 1, clientChoice: true });
      added += 1;
    }
  }
  return added + await suggestNamedMaterials(db, workspaceId, projectId, position);
}

/**
 * Lines priced by hand carry no catalog item, but the estimator often names the material on the line
 * ("MR MDF", "Engineered oak"). Those names, as sealed, become materials too: one per name, tied to every
 * line that names it, and a name already on the list only gains the lines.
 */
async function suggestNamedMaterials(db: Db, workspaceId: string, projectId: string, start: number) {
  const named = (await db.query<{ lineId: string; material: string }>(
    `SELECT line.id AS "lineId", btrim(sealed->>'material') AS material
       FROM project_boq_lines line
       JOIN project_scope_seals seal ON seal.workspace_id = line.workspace_id AND seal.id = line.origin_seal_id
       CROSS JOIN LATERAL jsonb_array_elements(coalesce(seal.snapshot->'lines', '[]'::jsonb)) sealed
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active' AND line.catalog_item_id IS NULL
        AND sealed->>'id' = line.source_line_id AND coalesce(btrim(sealed->>'material'), '') <> ''
      ORDER BY line.position`, [workspaceId, projectId])).rows;
  const key = (name: string) => name.trim().toLocaleLowerCase();
  const byName = new Map((await readItems(db, workspaceId, projectId)).filter((item) => !item.catalogItemId).map((item) => [key(item.name), item]));
  let position = start;
  let added = 0;
  for (const row of named) {
    const item = byName.get(key(row.material));
    if (item) {
      if (item.boqLineIds.includes(row.lineId)) continue;
      item.boqLineIds.push(row.lineId);
      await db.query(`UPDATE project_material_items SET boq_line_ids = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, item.id, item.boqLineIds]);
    } else {
      const id = randomUUID();
      await db.query(
        `INSERT INTO project_material_items (id, workspace_id, project_id, position, name, code, specification, unit, boq_line_ids) VALUES ($1, $2, $3, $4, $5, '', '', '', $6)`,
        [id, workspaceId, projectId, position++, row.material.slice(0, 240), [row.lineId]]);
      byName.set(key(row.material), { id, position, catalogItemId: null, name: row.material, code: "", specification: "", supplier: "", quantity: null, unit: "", note: "", boqLineIds: [row.lineId], version: 1, clientChoice: true });
      added += 1;
    }
  }
  return added;
}

/** While a revision waits for the client, the list can't change; record their decision first. */
async function assertEditable(db: Db, workspaceId: string, projectId: string) {
  const revision = await latestRevision(db, workspaceId, projectId);
  if (revision?.status === "sent") throw new ConflictException(`R${revision.number} is with the client. Record their decision before changing the list.`);
}

export async function saveMaterial(db: Db, workspaceId: string, projectId: string, input: Record<string, unknown>) {
  await assertEditable(db, workspaceId, projectId);
  const text = (key: string, label: string, max: number, required = false) => {
    const value = typeof input[key] === "string" ? (input[key] as string).trim() : "";
    if (required && !value) throw new BadRequestException(`${label} is required.`);
    if (value.length > max) throw new BadRequestException(`${label} is too long.`);
    return value;
  };
  const name = text("name", "Name", 240, true);
  const quantity = input.quantity === null || input.quantity === undefined || input.quantity === "" ? null : String(input.quantity);
  if (quantity !== null && (!/^\d+(\.\d{1,4})?$/.test(quantity) || Number(quantity) <= 0)) throw new BadRequestException("Quantity must be a number above zero.");
  const lineIds = Array.isArray(input.boqLineIds) ? [...new Set(input.boqLineIds.map(String))] : [];
  if (lineIds.length) {
    const known = (await db.query(`SELECT 1 FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2 AND id = ANY($3::uuid[])`, [workspaceId, projectId, lineIds])).rowCount;
    if (known !== lineIds.length) throw new BadRequestException("Choose items from the project's scope.");
  }
  const unit = text("unit", "Unit", 40);
  const fields = [name, text("code", "Code", 80), text("specification", "Finish or specification", 1000), text("supplier", "Supplier", 200), quantity, unit, text("note", "Note", 2000), lineIds];
  // Guide step 17: the details the Material Coordinator fills in, and the sample photo (a file of the project's case).
  const details = [text("brand", "Brand", 160), text("colour", "Colour", 80), text("size", "Size", 80), text("finish", "Finish", 120)];
  const photo = typeof input.samplePhotoAssetId === "string" && input.samplePhotoAssetId ? input.samplePhotoAssetId : null;
  if (photo && !(await db.query(`SELECT 1 FROM pre_project_brief_assets asset JOIN delivery_projects project ON project.workspace_id = asset.workspace_id AND project.case_id = asset.case_id
      WHERE asset.workspace_id = $1 AND project.id = $2 AND asset.id = $3::uuid`, [workspaceId, projectId, photo])).rowCount)
    throw new BadRequestException("Choose a photo from this project's files.");
  if (typeof input.id === "string") {
    const current = (await db.query<{ unit: string; clientChoice: boolean }>(`SELECT unit, client_choice AS "clientChoice" FROM project_material_items WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
      [workspaceId, projectId, input.id])).rows[0];
    if (!current) throw new NotFoundException("Material not found.");
    // Once it's on an order, its unit stays: quantities in two units can't be added up.
    if (unit.toLocaleLowerCase() !== current.unit.toLocaleLowerCase() && await onOrders(db, workspaceId, input.id))
      throw new ConflictException(`${name} is already ordered in ${current.unit || "its unit"}; keep that unit.`);
    const clientChoice = typeof input.clientChoice === "boolean" ? input.clientChoice : current.clientChoice;
    await db.query(
      `UPDATE project_material_items SET name = $4, code = $5, specification = $6, supplier = $7, quantity = $8, unit = $9, note = $10, boq_line_ids = $11, client_choice = $12,
              brand = $13, colour = $14, size = $15, finish = $16, sample_photo_asset_id = CASE WHEN $18::boolean THEN $17::uuid ELSE sample_photo_asset_id END,
              version = version + 1, updated_at = now() WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
      [workspaceId, projectId, input.id, ...fields, clientChoice, ...details, photo, input.samplePhotoAssetId !== undefined]);
    return input.id;
  }
  const id = randomUUID();
  const position = (await db.query<{ next: number }>(`SELECT coalesce(max(position) + 1, 0)::int AS next FROM project_material_items WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0].next;
  await db.query(
    `INSERT INTO project_material_items (id, workspace_id, project_id, position, name, code, specification, supplier, quantity, unit, note, boq_line_ids, client_choice,
       brand, colour, size, finish, sample_photo_asset_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`, [id, workspaceId, projectId, position, ...fields, input.clientChoice !== false, ...details, photo]);
  return id;
}

/**
 * PLM-055: product details a material carries for the technical team (the designer's notes on hardware, edges,
 * grain…). Internal to the team: it never changes what the client signed, so it can be added at any time.
 * Returns the material's name and whether anything changed.
 */
export async function setMaterialDetails(db: Db, workspaceId: string, projectId: string, input: { itemId: unknown; note: unknown; userId: string }) {
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 2000) throw new BadRequestException("Keep the details under 2000 characters.");
  const item = (await db.query<{ name: string; note: string }>(`SELECT name, team_note AS note FROM project_material_items WHERE workspace_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`,
    [workspaceId, projectId, typeof input.itemId === "string" && /^[0-9a-f-]{36}$/i.test(input.itemId) ? input.itemId : null])).rows[0];
  if (!item) throw new NotFoundException("Material not found.");
  if (item.note === note) return { name: item.name, changed: false, before: item.note, note };
  await db.query(`UPDATE project_material_items SET team_note = $4::varchar, team_note_by = CASE WHEN $4::varchar = '' THEN NULL ELSE $5::uuid END,
    team_note_at = CASE WHEN $4::varchar = '' THEN NULL ELSE now() END,
    updated_at = now() WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, input.itemId, note, input.userId]);
  return { name: item.name, changed: true, before: item.note, note };
}

/** The orders and price requests a material is on (not cancelled), by number. */
async function onOrders(db: Db, workspaceId: string, itemId: string) {
  const rows = (await db.query<{ number: string }>(
    `SELECT purchase.number FROM purchase_order_lines line JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
      WHERE line.workspace_id = $1 AND line.material_item_id = $2 AND purchase.status <> 'cancelled'
     UNION ALL
     SELECT 'price request ' || request.number FROM price_request_lines line JOIN price_requests request ON request.workspace_id = line.workspace_id AND request.id = line.request_id
      WHERE line.workspace_id = $1 AND line.material_item_id = $2 AND request.status <> 'cancelled'`, [workspaceId, itemId])).rows;
  return rows.map((row) => row.number)[0] ?? null;
}

export async function deleteMaterial(db: Db, workspaceId: string, projectId: string, itemId: string) {
  await assertEditable(db, workspaceId, projectId);
  const used = await onOrders(db, workspaceId, itemId);
  if (used) throw new ConflictException(`This material is on ${used}. Cancel that first, or change the quantity instead.`);
  const removed = await db.query(`DELETE FROM project_material_items WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, itemId]);
  if (!removed.rowCount) throw new NotFoundException("Material not found.");
}

/** Freezes the list as the next revision and sends it for the client's decision. */
export async function sendMaterials(db: Db, workspaceId: string, projectId: string, actorUserId: string) {
  const latest = await latestRevision(db, workspaceId, projectId, true);
  if (latest?.status === "sent") throw new ConflictException(`R${latest.number} is already with the client.`);
  const items = await readItems(db, workspaceId, projectId);
  if (!items.length) throw new BadRequestException("Add the materials first.");
  const snapshot = signable(items);
  if (!snapshot.length) throw new BadRequestException("Nothing on the list is the client's choice, so there's nothing to sign off.");
  const hash = canonicalHash(snapshot);
  if (latest?.status === "signed_off" && latest.contentHash === hash) throw new ConflictException(`Nothing changed since R${latest.number} was signed off.`);
  const number = (latest?.number ?? 0) + 1;
  await db.query(`INSERT INTO project_material_revisions (id, workspace_id, project_id, number, snapshot, content_hash, sent_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [randomUUID(), workspaceId, projectId, number, JSON.stringify(snapshot), hash, actorUserId]);
  return number;
}

/**
 * Records the client's decision on the revision they have: each material approved or rejected (with a
 * reason). All approved → the list is signed off and every line it covers records it.
 */
export async function recordMaterialDecision(db: Db, workspaceId: string, projectId: string, input: Record<string, unknown>, actorUserId: string | null,
  portal?: { grantId: string; name: string; revisionId: string }) {
  const revision = await latestRevision(db, workspaceId, projectId, true);
  if (!revision || revision.status !== "sent") throw new ConflictException(portal ? "This material list isn't waiting for your decision any more." : "Send the material list to the client first.");
  // The client decides on the exact revision they were shown.
  if (portal && revision.id !== portal.revisionId) throw new ConflictException("A newer material list was sent. Reload to see it.");
  const decidedBy = portal ? portal.name : typeof input.decidedBy === "string" ? input.decidedBy.trim() : "";
  if (!decidedBy || decidedBy.length > 200) throw new BadRequestException("Say who decided.");
  if (!portal && !METHODS.includes(input.method as (typeof METHODS)[number])) throw new BadRequestException("Say how the client decided.");
  if (!portal && !actorUserId) throw new BadRequestException("Say who recorded the decision.");
  const snapshot = (await db.query<{ snapshot: Array<{ id: string; boqLineIds: string[] }> }>(`SELECT snapshot FROM project_material_revisions WHERE workspace_id = $1 AND id = $2`, [workspaceId, revision.id])).rows[0].snapshot;
  const given = new Map((Array.isArray(input.decisions) ? input.decisions : []).map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return [String(row.itemId), { decision: row.decision === "rejected" ? "rejected" as const : row.decision === "approved" ? "approved" as const : null, note: typeof row.note === "string" ? row.note.trim().slice(0, 1000) : "" }];
  }));
  const decisions = snapshot.map((item) => ({ item, ...(given.get(item.id) ?? { decision: null, note: "" }) }));
  if (decisions.some((entry) => !entry.decision)) throw new BadRequestException("Record a decision for every material.");
  if (decisions.some((entry) => entry.decision === "rejected" && !entry.note)) throw new BadRequestException("Say what the client wants instead of each rejected material.");
  for (const entry of decisions)
    await db.query(`INSERT INTO project_material_decisions (workspace_id, revision_id, item_id, decision, note) VALUES ($1, $2, $3, $4, $5)`,
      [workspaceId, revision.id, entry.item.id, entry.decision, entry.note]);
  const signedOff = decisions.every((entry) => entry.decision === "approved");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 2000) : "";
  await db.query(
    `UPDATE project_material_revisions SET status = $3, decided_at = clock_timestamp(), decided_by_name = $4, decision_method = $5, recorded_by = $6, decision_note = $7,
            decided_by_grant_id = $8
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, revision.id, signedOff ? "signed_off" : "changes_requested", decidedBy, portal ? "portal" : input.method, portal ? null : actorUserId, note, portal?.grantId ?? null]);
  // §0.3 P0: a decision staff take down comes with what it came in (the signed list, an email).
  if (!portal && actorUserId) await bindEvidence(db, workspaceId, actorUserId, "material_decision", revision.id, evidenceIds(input.evidenceFileIds));
  if (signedOff)
    for (const lineId of new Set(snapshot.flatMap((item) => item.boqLineIds)))
      await event(db, workspaceId, projectId, lineId, "signed_off", { revision: `R${revision.number}`, by: decidedBy }, null, actorUserId);
  return { number: revision.number, signedOff, note: signedOff ? note : decisions.filter((entry) => entry.decision === "rejected").map((entry) => entry.note).join("; ") };
}

/** Each revision with the file its client decision came in, when staff recorded it. */
async function withDecisionFiles<T extends { id: string }>(db: Db, workspaceId: string, revisions: T[]) {
  const files = await evidenceFor(db, workspaceId, "material_decision", revisions.map((revision) => revision.id));
  return revisions.map((revision) => ({ ...revision, decisionFiles: files.get(revision.id) ?? [] }));
}

/**
 * Guide step 17 / N: technical work can't start until the Material List is complete: every material has its brand,
 * code, colour, size, finish, supplier and sample photo. Returns what is missing, per material (empty when complete).
 */
export async function materialListMissing(db: Db, workspaceId: string, projectId: string) {
  const items = await readItems(db, workspaceId, projectId);
  if (!items.length) return ["the material list"];
  const missing: string[] = [];
  for (const item of items) {
    const gaps = [!item.brand?.trim() && "brand", !item.code.trim() && "code", !item.colour?.trim() && "colour", !item.size?.trim() && "size",
      !item.finish?.trim() && "finish", !item.supplier.trim() && "supplier", !item.samplePhotoAssetId && "sample photo"].filter(Boolean);
    if (gaps.length) missing.push(`${item.name} (${gaps.join(", ")})`);
  }
  return missing;
}
