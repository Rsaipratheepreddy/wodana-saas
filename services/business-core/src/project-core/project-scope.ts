import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";

type Db = Pick<PoolClient, "query">;

export const SUPPLY = ["make", "buy", "ready_made", "subcontract", "client", "site_work"] as const;
export type Supply = (typeof SUPPLY)[number];

export type SealedLine = {
  id: string; position: number; kind: string; areaId: string | null; workPackageId: string | null; title: string; description: string; unit: string;
  quantity: string; rate: string; net: string; catalogItemId: string | null; catalogImageId: string | null; imageAssetId: string | null;
};

/** The live BOQ starts as the sealed baseline: one line per accepted quotation line, each with its "agreed" history entry. */
export async function seedBoq(db: Db, workspaceId: string, projectId: string, seal: { id: string; revisionLabel: string }, lines: SealedLine[], actorUserId: string) {
  for (const line of lines) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO project_boq_lines (id, workspace_id, project_id, position, origin_seal_id, source_line_id, kind, area_id, work_package_id, title, description, unit,
         quantity, rate, net, catalog_item_id, catalog_image_id, image_asset_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [id, workspaceId, projectId, line.position, seal.id, line.id, line.kind, line.areaId, line.workPackageId, line.title, line.description ?? "", line.unit ?? "",
        line.quantity, line.rate, line.net, line.catalogItemId, line.catalogImageId, line.imageAssetId]);
    await event(db, workspaceId, projectId, id, "agreed", { revision: seal.revisionLabel, quantity: line.quantity }, seal.id, actorUserId);
  }
}

export async function event(db: Db, workspaceId: string, projectId: string, lineId: string, kind: string, detail: Record<string, unknown>, sealId: string | null, actorUserId: string | null) {
  await db.query(`INSERT INTO project_boq_events (id, workspace_id, project_id, line_id, kind, detail, seal_id, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [randomUUID(), workspaceId, projectId, lineId, kind, JSON.stringify(detail), sealId, actorUserId]);
}

/** How a line is most likely delivered, from its kind and its catalog item's type. People change it per package. */
export function suggestedSupply(kind: string, itemType: string | null): Supply {
  if (kind === "client_supplied") return "client";
  if (["service", "relocate", "dismantle", "remove_store", "dispose"].includes(kind)) return "site_work";
  if (itemType === "assembly" || itemType === "package") return "make";
  if (itemType === "ready_made" || itemType === "product") return "ready_made";
  if (itemType === "service") return "site_work";
  return "buy";
}

/**
 * Groups the lines not yet in a package into packages: one per area, trade and way of delivery
 * ("Kitchen · Joinery", made in the factory). Returns how many packages were created.
 */
export async function proposePackages(db: Db, workspaceId: string, projectId: string, actorUserId: string) {
  const lines = (await db.query<{ id: string; kind: string; areaId: string | null; areaName: string | null; tradeName: string | null; itemType: string | null }>(
    `SELECT line.id, line.kind, line.area_id AS "areaId", room.name AS "areaName", trade.name AS "tradeName", item.item_type AS "itemType"
       FROM project_boq_lines line
       LEFT JOIN project_scope_seals seal ON seal.workspace_id = line.workspace_id AND seal.id = line.origin_seal_id
       LEFT JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
       LEFT JOIN workspace_work_packages trade ON trade.workspace_id = line.workspace_id AND trade.id = line.work_package_id
       LEFT JOIN catalog_items item ON item.workspace_id = line.workspace_id AND item.id = line.catalog_item_id
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active' AND line.package_id IS NULL
      ORDER BY room.name NULLS LAST, line.position`, [workspaceId, projectId])).rows;
  const groups = new Map<string, { name: string; areaId: string | null; supply: Supply; lines: string[] }>();
  for (const line of lines) {
    const supply = suggestedSupply(line.kind, line.itemType);
    const key = `${line.areaId ?? ""}|${line.tradeName ?? ""}|${supply}`;
    const name = [line.areaName ?? "General", line.tradeName].filter(Boolean).join(" · ");
    const group = groups.get(key) ?? { name, areaId: line.areaId, supply, lines: [] };
    group.lines.push(line.id);
    groups.set(key, group);
  }
  let position = (await db.query<{ next: number }>(`SELECT coalesce(max(position) + 1, 0)::int AS next FROM project_packages WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0].next;
  // The same name with two ways of delivery gets a hint so the two can be told apart.
  const names = [...groups.values()].map((group) => group.name);
  for (const group of groups.values()) {
    const id = randomUUID();
    const name = names.filter((value) => value === group.name).length > 1 ? `${group.name} (${SUPPLY_NAMES[group.supply]})` : group.name;
    await db.query(`INSERT INTO project_packages (id, workspace_id, project_id, name, area_id, supply, position) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, workspaceId, projectId, name.slice(0, 200), group.areaId, group.supply, position++]);
    await db.query(`UPDATE project_boq_lines SET package_id = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = ANY($2::uuid[])`, [workspaceId, group.lines, id]);
    for (const lineId of group.lines) await event(db, workspaceId, projectId, lineId, "packaged", { package: name }, null, actorUserId);
  }
  return groups.size;
}

const SUPPLY_NAMES: Record<Supply, string> = { make: "made", buy: "bought", ready_made: "ready-made", subcontract: "subcontracted", client: "by the client", site_work: "site work" };

/** Creates or updates a package. A package with lines keeps its lines when renamed or re-supplied. */
export async function savePackage(db: Db, workspaceId: string, projectId: string, input: Record<string, unknown>) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 200) throw new BadRequestException("Name the package.");
  if (!SUPPLY.includes(input.supply as Supply)) throw new BadRequestException("Choose how the package is delivered.");
  const owner = input.ownerMembershipId ? String(input.ownerMembershipId) : null;
  if (owner && !(await db.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, owner])).rowCount)
    throw new BadRequestException("Choose someone from your team.");
  const due = input.dueDate ? String(input.dueDate) : null;
  if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`)))) throw new BadRequestException("Due date must be a date.");
  if (typeof input.id === "string") {
    const updated = await db.query(
      `UPDATE project_packages SET name = $4, supply = $5, owner_membership_id = $6, due_date = $7, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, input.id, name, input.supply, owner, due]);
    if (!updated.rowCount) throw new NotFoundException("Package not found.");
    return input.id;
  }
  const id = randomUUID();
  const position = (await db.query<{ next: number }>(`SELECT coalesce(max(position) + 1, 0)::int AS next FROM project_packages WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0].next;
  await db.query(`INSERT INTO project_packages (id, workspace_id, project_id, name, supply, owner_membership_id, due_date, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, workspaceId, projectId, name, input.supply, owner, due, position]);
  return id;
}

/** Removes an empty package. A package that still holds lines can't be removed; move its lines first. */
export async function deletePackage(db: Db, workspaceId: string, projectId: string, packageId: string) {
  if ((await db.query(`SELECT 1 FROM project_boq_lines WHERE workspace_id = $1 AND package_id = $2 LIMIT 1`, [workspaceId, packageId])).rowCount)
    throw new ConflictException("Move this package's items to another package first.");
  const removed = await db.query(`DELETE FROM project_packages WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, packageId]);
  if (!removed.rowCount) throw new NotFoundException("Package not found.");
}

/** Moves lines into a package (or out of any), recording it in each line's history. */
export async function assignLines(db: Db, workspaceId: string, projectId: string, lineIds: unknown, packageId: unknown, actorUserId: string) {
  if (!Array.isArray(lineIds) || !lineIds.length || lineIds.length > 500 || lineIds.some((id) => typeof id !== "string")) throw new BadRequestException("Choose the items to move.");
  const target = packageId ? (await db.query<{ name: string }>(`SELECT name FROM project_packages WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, packageId])).rows[0] : null;
  if (packageId && !target) throw new NotFoundException("Package not found.");
  const moved = (await db.query<{ id: string }>(
    `UPDATE project_boq_lines SET package_id = $4, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND project_id = $2 AND id = ANY($3::uuid[]) AND package_id IS DISTINCT FROM $4::uuid RETURNING id`,
    [workspaceId, projectId, lineIds, packageId || null])).rows;
  for (const line of moved) await event(db, workspaceId, projectId, line.id, "packaged", { package: target?.name ?? null }, null, actorUserId);
  return moved.length;
}

export type ScopeLine = {
  id: string; position: number; kind: string; areaId: string | null; areaName: string | null; workPackageId: string | null; tradeName: string | null;
  title: string; description: string; unit: string; quantity: string; rate: string; net: string; status: "active" | "omitted"; packageId: string | null;
  origin: string; catalogImageId: string | null; imageAssetId: string | null;
};

/** The live BOQ with packages and the sealed documents it comes from. */
export async function readScope(db: Db, workspaceId: string, projectId: string) {
  const lines = (await db.query<ScopeLine>(
    `SELECT line.id, line.position, line.kind, line.area_id AS "areaId", room.name AS "areaName", line.work_package_id AS "workPackageId", trade.name AS "tradeName",
            line.title, line.description, line.unit, line.quantity::text AS quantity, line.rate::text AS rate, line.net::text AS net, line.status,
            line.package_id AS "packageId", seal.revision_label AS origin, line.catalog_image_id AS "catalogImageId", line.image_asset_id AS "imageAssetId"
       FROM project_boq_lines line
       JOIN project_scope_seals seal ON seal.workspace_id = line.workspace_id AND seal.id = line.origin_seal_id
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
       LEFT JOIN workspace_work_packages trade ON trade.workspace_id = line.workspace_id AND trade.id = line.work_package_id
      WHERE line.workspace_id = $1 AND line.project_id = $2
      ORDER BY seal.kind <> 'baseline', seal.sealed_at, line.position`, [workspaceId, projectId])).rows;
  const packages = (await db.query<{ id: string; name: string; supply: Supply; ownerMembershipId: string | null; ownerName: string | null; dueDate: string | null; version: number }>(
    `SELECT package.id, package.name, package.supply, package.owner_membership_id AS "ownerMembershipId", person.display_name AS "ownerName",
            package.due_date::text AS "dueDate", package.version
       FROM project_packages package
       LEFT JOIN workspace_memberships membership ON membership.workspace_id = package.workspace_id AND membership.id = package.owner_membership_id
       LEFT JOIN users person ON person.id = membership.user_id
      WHERE package.workspace_id = $1 AND package.project_id = $2 ORDER BY package.position, lower(package.name)`, [workspaceId, projectId])).rows;
  const seals = (await db.query<{ id: string; kind: "baseline" | "variation"; revisionLabel: string; quoteNumber: number; total: string; currency: string; acceptedAt: string; acceptedBy: string }>(
    `SELECT id, kind, revision_label AS "revisionLabel", quote_number AS "quoteNumber", total::text AS total, currency, accepted_at AS "acceptedAt", accepted_by_name AS "acceptedBy"
       FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2 ORDER BY kind <> 'baseline', sealed_at, revision_label`, [workspaceId, projectId])).rows;
  // The case's variations (drafts, sent, accepted) and what each became once applied.
  const variations = (await db.query<{ id: string; number: number; title: string; status: string; total: string; appliedAs: string | null }>(
    `SELECT quote.id, quote.number, quote.title, quote.status, quote.total::text AS total, seal.revision_label AS "appliedAs"
       FROM commercial_quotes quote
       JOIN delivery_projects project ON project.workspace_id = quote.workspace_id AND project.case_id = quote.case_id
       LEFT JOIN project_scope_seals seal ON seal.workspace_id = quote.workspace_id AND seal.project_id = project.id AND seal.quote_id = quote.id
      WHERE quote.workspace_id = $1 AND project.id = $2 AND quote.kind = 'variation' AND quote.status NOT IN ('superseded', 'withdrawn')
      ORDER BY quote.number DESC`, [workspaceId, projectId])).rows;
  return { lines, packages, seals, variations };
}

export async function lineHistory(db: Db, workspaceId: string, projectId: string, lineId: string) {
  const exists = (await db.query(`SELECT 1 FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, projectId, lineId])).rowCount;
  if (!exists) throw new NotFoundException("Item not found.");
  return (await db.query<{ id: string; kind: string; detail: Record<string, unknown>; byName: string | null; at: string }>(
    `SELECT event.id, event.kind, event.detail, person.display_name AS "byName", event.at
       FROM project_boq_events event LEFT JOIN users person ON person.id = event.actor_user_id
      WHERE event.workspace_id = $1 AND event.line_id = $2 ORDER BY event.at, event.id`, [workspaceId, lineId])).rows;
}

export type VariationLine = SealedLine & { changeOp: "add" | "omit" | "move" | null; boqLineId: string | null; fromAreaId?: string | null };

/**
 * Applies a sealed variation to the live BOQ, line by line: a removal reduces (or removes) its BOQ
 * line by exactly what it credits; a move sends the line to its new area (and adds the labour, if
 * priced); anything else is new scope. Every change goes into the line's history.
 */
export async function applyVariation(db: Db, workspaceId: string, projectId: string, seal: { id: string; label: string }, lines: VariationLine[], actorUserId: string) {
  const areaNames = new Map((await db.query<{ id: string; name: string }>(
    `SELECT room.id, room.name FROM pre_project_rooms room JOIN delivery_projects project ON project.workspace_id = room.workspace_id AND project.case_id = room.case_id
      WHERE room.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows.map((row) => [row.id, row.name]));
  const areaName = (id: string | null) => (id ? areaNames.get(id) ?? null : null);
  const boqLine = async (id: string | null, title: string) => {
    const row = id ? (await db.query<{ id: string; quantity: string; net: string; status: string; areaId: string | null }>(
      `SELECT id, quantity::text AS quantity, net::text AS net, status, area_id AS "areaId" FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`,
      [workspaceId, projectId, id])).rows[0] : undefined;
    if (!row || row.status !== "active") throw new ConflictException(`${title} is no longer in the project's scope. Revise the variation.`);
    return row;
  };
  let position = (await db.query<{ next: number }>(`SELECT coalesce(max(position) + 1, 0)::int AS next FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0].next;
  const addLine = async (line: VariationLine) => {
    const id = randomUUID();
    const itemType = line.catalogItemId ? (await db.query<{ type: string }>(`SELECT item_type AS type FROM catalog_items WHERE workspace_id = $1 AND id = $2`, [workspaceId, line.catalogItemId])).rows[0]?.type ?? null : null;
    const packageId = (await db.query<{ id: string }>(
      `SELECT id FROM project_packages WHERE workspace_id = $1 AND project_id = $2 AND area_id IS NOT DISTINCT FROM $3::uuid AND supply = $4 ORDER BY position LIMIT 1`,
      [workspaceId, projectId, line.areaId, suggestedSupply(line.kind, itemType)])).rows[0]?.id ?? null;
    await db.query(
      `INSERT INTO project_boq_lines (id, workspace_id, project_id, position, origin_seal_id, source_line_id, kind, area_id, work_package_id, title, description, unit,
         quantity, rate, net, catalog_item_id, catalog_image_id, image_asset_id, package_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [id, workspaceId, projectId, position++, seal.id, line.id, line.kind, line.areaId, line.workPackageId, line.title, line.description ?? "", line.unit ?? "",
        line.quantity, line.rate, line.net, line.catalogItemId, line.catalogImageId, line.imageAssetId, packageId]);
    await event(db, workspaceId, projectId, id, "added", { variation: seal.label, quantity: line.quantity }, seal.id, actorUserId);
  };
  for (const line of [...lines].sort((a, b) => a.position - b.position)) {
    if (line.changeOp === "omit") {
      const current = await boqLine(line.boqLineId, line.title);
      const left = Dec.of(current.quantity).sub(line.quantity);
      if (left.isNegative()) throw new ConflictException(`${line.title}: the variation removes more than is left. Revise the variation.`);
      const net = Dec.of(current.net).add(line.net);
      await db.query(`UPDATE project_boq_lines SET quantity = $3, net = $4, status = $5, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, current.id, left.toString(), left.isZero() ? "0" : net.toString(), left.isZero() ? "omitted" : "active"]);
      await event(db, workspaceId, projectId, current.id, left.isZero() ? "omitted" : "reduced", { variation: seal.label, quantity: line.quantity, left: left.toString() }, seal.id, actorUserId);
    } else if (line.changeOp === "move") {
      const current = await boqLine(line.boqLineId, line.title);
      await db.query(`UPDATE project_boq_lines SET area_id = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, current.id, line.areaId]);
      await event(db, workspaceId, projectId, current.id, "moved", { variation: seal.label, from: areaName(current.areaId), to: areaName(line.areaId) }, seal.id, actorUserId);
      if (!Dec.of(line.net).isZero()) await addLine(line);
    } else {
      await addLine(line);
    }
  }
}
