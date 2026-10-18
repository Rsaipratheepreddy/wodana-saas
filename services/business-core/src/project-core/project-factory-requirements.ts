import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { COMPONENT_TYPES, type BomComponent, type ComponentType } from "../catalog-core/bom";
import { Dec } from "../catalog-core/decimal";
import { lineMeasurements, recipeRequirements, type LineRequirements } from "../catalog-core/recipe";
import { suggestedSupply, type Supply } from "./project-scope";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-166: what each scope line made in the factory needs in materials and labour, from one of two sources and never
 * guessed: the catalogue item's verified recipe (exploded for the line's quantity and sizes), or a factory requirement
 * record the Factory Lead confirms for a custom line. A made line with neither reads "Needs factory requirements".
 */
export const REQUIREMENT_ITEM_TYPES = COMPONENT_TYPES.filter((type) => type !== "labour");
export type RequirementItemType = Exclude<ComponentType, "labour">;

export type RequirementItem = { id: string; componentType: RequirementItemType; name: string; quantity: string; unit: string; catalogItemId: string | null; note: string };
export type FactoryRequirement = {
  id: string; lineId: string; status: "pending" | "confirmed"; labourHours: string | null; notes: string; items: RequirementItem[];
  confirmedByName: string | null; confirmedAt: string | null; updatedByName: string | null; updatedAt: string; version: number;
};

/** The one word for a made line's requirements. */
export type RequirementState = "verified" | "confirmed" | "pending" | "needs_requirements" | "not_needed";

export type LineRequirementRow = {
  lineId: string; title: string; quantity: string; unit: string; areaName: string | null; catalogItemId: string | null; catalogId: string | null; code: string | null;
  /** The quotation line's size, as text ("180 × 60 × 240 cm"), when it has one. */
  size: string | null;
  /** Made in the factory (its package's way, or the likely way from its kind). */
  made: boolean;
  recipe: LineRequirements;
  factory: FactoryRequirement | null;
  state: RequirementState;
};

/** Where a made line's requirements stand: a verified recipe first, then the factory's record (confirmed or waiting), else nothing yet. */
export function requirementState(input: { made: boolean; recipe: LineRequirements; factory: Pick<FactoryRequirement, "status"> | null }): RequirementState {
  if (!input.made) return "not_needed";
  if (input.recipe.state === "verified") return "verified";
  if (input.factory?.status === "confirmed") return "confirmed";
  if (input.factory) return "pending";
  return "needs_requirements";
}

/** A line's size in words from the quotation's measurements, in the order length × width × height. */
export function sizeText(line: { length: string | null; width: string | null; height: string | null; dimensionUnit: string | null }) {
  const parts = [line.length, line.width, line.height].filter((value): value is string => Boolean(value)).map((value) => Dec.of(value).toString());
  return parts.length ? `${parts.join(" × ")}${line.dimensionUnit ? ` ${line.dimensionUnit}` : ""}` : null;
}

const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;

export type RequirementInput = { items: Array<Omit<RequirementItem, "id">>; labourHours: string | null; notes: string };

/** Validates what is saved on a factory requirement: items by kind with a quantity and unit, the labour hours and notes. */
export function parseRequirementInput(body: Record<string, unknown>): RequirementInput {
  if (!Array.isArray(body.items) || body.items.length > 100) throw new BadRequestException("List the materials (up to 100).");
  const items = body.items.map((raw, index): Omit<RequirementItem, "id"> => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name || name.length > 300) throw new BadRequestException(`Material ${index + 1}: name it.`);
    if (!REQUIREMENT_ITEM_TYPES.includes(row.componentType as RequirementItemType)) throw new BadRequestException(`${name}: choose board, fabric, foam, hardware or other.`);
    const quantity = typeof row.quantity === "number" ? String(row.quantity) : typeof row.quantity === "string" ? row.quantity.trim() : "";
    if (!NUMBER.test(quantity)) throw new BadRequestException(`${name}: enter the quantity as a number.`);
    const unit = typeof row.unit === "string" ? row.unit.trim() : "";
    if (unit.length > 40) throw new BadRequestException(`${name}: the unit is too long.`);
    const note = typeof row.note === "string" ? row.note.trim() : "";
    if (note.length > 500) throw new BadRequestException(`${name}: keep the note under 500 characters.`);
    const catalogItemId = typeof row.catalogItemId === "string" && row.catalogItemId ? row.catalogItemId : null;
    return { componentType: row.componentType as RequirementItemType, name, quantity: Dec.of(quantity).toString(), unit, catalogItemId, note };
  });
  const hours = body.labourHours === null || body.labourHours === undefined || body.labourHours === "" ? null : String(body.labourHours).trim();
  if (hours !== null && !NUMBER.test(hours)) throw new BadRequestException("Enter the labour hours as a number.");
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > 4000) throw new BadRequestException("Keep the notes under 4000 characters.");
  return { items, labourHours: hours === null ? null : Dec.of(hours).toString(), notes };
}

/** A factory requirement can be confirmed once it says something: at least one material, or the labour hours. */
export function confirmable(requirement: Pick<FactoryRequirement, "status" | "items" | "labourHours">) {
  if (requirement.status === "confirmed") return { ok: false as const, reason: "already_confirmed" as const };
  if (!requirement.items.length && requirement.labourHours === null) return { ok: false as const, reason: "empty" as const };
  return { ok: true as const };
}

/** The project's factory requirement records, by scope line, with their items. */
export async function readFactoryRequirements(db: Db, workspaceId: string, projectId: string): Promise<Map<string, FactoryRequirement>> {
  const rows = (await db.query<Omit<FactoryRequirement, "items" | "confirmedAt" | "updatedAt"> & { confirmedAt: Date | null; updatedAt: Date }>(
    `SELECT requirement.id, requirement.boq_line_id AS "lineId", requirement.status, requirement.labour_hours::text AS "labourHours", requirement.notes,
            confirmer.display_name AS "confirmedByName", requirement.confirmed_at AS "confirmedAt", updater.display_name AS "updatedByName", requirement.updated_at AS "updatedAt", requirement.version
       FROM project_factory_requirements requirement
       LEFT JOIN users confirmer ON confirmer.id = requirement.confirmed_by
       LEFT JOIN users updater ON updater.id = requirement.updated_by
      WHERE requirement.workspace_id = $1 AND requirement.project_id = $2`, [workspaceId, projectId])).rows;
  if (!rows.length) return new Map();
  const items = (await db.query<RequirementItem & { requirementId: string }>(
    `SELECT item.id, item.requirement_id AS "requirementId", item.component_type AS "componentType", item.name, item.quantity::text AS quantity, item.unit, item.catalog_item_id AS "catalogItemId", item.note
       FROM project_factory_requirement_items item WHERE item.workspace_id = $1 AND item.requirement_id = ANY($2::uuid[]) ORDER BY item.position, item.name`,
    [workspaceId, rows.map((row) => row.id)])).rows;
  // Quantities read as plain numbers ("3", not "3.0000").
  return new Map(rows.map((row) => [row.lineId, {
    ...row, labourHours: row.labourHours === null ? null : Dec.of(row.labourHours).toString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null, updatedAt: row.updatedAt.toISOString(),
    items: items.filter((item) => item.requirementId === row.id).map(({ requirementId, ...item }) => { void requirementId; return { ...item, quantity: Dec.of(item.quantity).toString() }; }),
  }]));
}

type LineRow = {
  lineId: string; title: string; kind: string; quantity: string; unit: string; areaName: string | null; catalogItemId: string | null; catalogId: string | null; code: string | null;
  itemType: string | null; packageSupply: Supply | null; length: string | null; width: string | null; height: string | null; dimensionUnit: string | null;
  verifiedAt: Date | null; verifiedBy: string | null; components: BomComponent[];
};

/**
 * Every active scope line of the project with its requirements: the catalogue recipe (exploded for the line's quantity
 * and the quotation line's sizes, only when verified) and the factory's own record. One line (`lineId`) when asked.
 */
export async function readLineRequirements(db: Db, workspaceId: string, projectId: string, lineId: string | null = null): Promise<LineRequirementRow[]> {
  const rows = (await db.query<LineRow>(
    `SELECT line.id AS "lineId", line.title, line.kind, line.quantity::text AS quantity, line.unit, room.name AS "areaName",
            line.catalog_item_id AS "catalogItemId", item.catalog_id AS "catalogId", item.code, item.item_type AS "itemType", package.supply AS "packageSupply",
            quote_line.length::text AS length, quote_line.width::text AS width, quote_line.height::text AS height, quote_line.dimension_unit AS "dimensionUnit",
            item.recipe_verified_at AS "verifiedAt", verifier.display_name AS "verifiedBy",
            coalesce((SELECT jsonb_agg(jsonb_build_object('componentItemId', component.component_item_id, 'label', child.name, 'quantityFormula', component.quantity_formula,
                        'unitCode', component.unit_code, 'wastePercent', child.waste_percent::text, 'purchaseRoundTo', child.purchase_round_to::text, 'componentType', component.component_type,
                        'quantityBasis', component.quantity_basis, 'batchSize', component.batch_size::text, 'labourHours', component.labour_hours::text) ORDER BY component.sort_order)
                        FROM catalog_components component JOIN catalog_items child ON child.workspace_id = component.workspace_id AND child.id = component.component_item_id
                       WHERE component.workspace_id = item.workspace_id AND component.parent_item_id = item.id), '[]'::jsonb) AS components
       FROM project_boq_lines line
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       JOIN project_scope_seals seal ON seal.workspace_id = line.workspace_id AND seal.id = line.origin_seal_id
       LEFT JOIN commercial_quote_lines quote_line ON quote_line.workspace_id = line.workspace_id AND quote_line.case_id = project.case_id
             AND quote_line.quote_id = seal.quote_id AND quote_line.id = line.source_line_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
       LEFT JOIN catalog_items item ON item.workspace_id = line.workspace_id AND item.id = line.catalog_item_id
       LEFT JOIN users verifier ON verifier.id = item.recipe_verified_by
       LEFT JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = line.package_id
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active' AND ($3::uuid IS NULL OR line.id = $3)
      ORDER BY seal.kind <> 'baseline', seal.sealed_at, line.position, line.id`, [workspaceId, projectId, lineId])).rows;
  const factory = await readFactoryRequirements(db, workspaceId, projectId);
  return rows.map((row) => {
    const made = row.kind === "item" && (row.packageSupply ?? suggestedSupply(row.kind, row.itemType)) === "make";
    const recipe = recipeRequirements(row.catalogItemId ? { components: row.components, verified: row.verifiedAt ? { at: row.verifiedAt.toISOString(), byName: row.verifiedBy } : null } : null,
      row.quantity, lineMeasurements(row));
    const record = factory.get(row.lineId) ?? null;
    return {
      lineId: row.lineId, title: row.title, quantity: row.quantity, unit: row.unit, areaName: row.areaName, catalogItemId: row.catalogItemId, catalogId: row.catalogId, code: row.code,
      size: sizeText(row), made, recipe, factory: record, state: requirementState({ made, recipe, factory: record }),
    };
  });
}

/** Every made line has its requirements settled (a verified recipe or a confirmed factory record); true with no made lines. */
export async function factoryRequirementsConfirmed(db: Db, workspaceId: string, projectId: string) {
  return (await readLineRequirements(db, workspaceId, projectId)).every((row) => ["verified", "confirmed", "not_needed"].includes(row.state));
}

async function lockRequirement(db: Db, workspaceId: string, lineId: string) {
  return (await db.query<{ id: string; status: "pending" | "confirmed"; version: number; labourHours: string | null; items: number }>(
    `SELECT requirement.id, requirement.status, requirement.version, requirement.labour_hours::text AS "labourHours",
            (SELECT count(*)::int FROM project_factory_requirement_items item WHERE item.workspace_id = requirement.workspace_id AND item.requirement_id = requirement.id) AS items
       FROM project_factory_requirements requirement WHERE requirement.workspace_id = $1 AND requirement.boq_line_id = $2 FOR UPDATE`, [workspaceId, lineId])).rows[0];
}

/**
 * Writes a custom line's factory requirements: the materials by kind, the labour hours and notes. A new record waits
 * for the Factory Lead; a confirmed one edited is open again (`reopened`), so quantities never come from a changed
 * record nobody checked. Version-checked when the record exists.
 */
export async function saveFactoryRequirement(db: Db, input: { workspaceId: string; projectId: string; lineId: string; body: Record<string, unknown>; userId: string }) {
  const line = (await db.query<{ title: string; status: string }>(`SELECT title, status FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
    [input.workspaceId, input.projectId, input.lineId])).rows[0];
  if (!line) throw new NotFoundException("Item not found.");
  if (line.status !== "active") throw new ConflictException("A variation removed this item.");
  const parsed = parseRequirementInput(input.body);
  const existing = await lockRequirement(db, input.workspaceId, input.lineId);
  if (existing && input.body.requirementVersion !== undefined && input.body.requirementVersion !== existing.version) throw new ConflictException("Someone else changed these requirements. Reload to see their changes.");
  const id = existing?.id ?? randomUUID();
  if (existing) {
    await db.query(`UPDATE project_factory_requirements SET status = 'pending', confirmed_by = NULL, confirmed_at = NULL, labour_hours = $3, notes = $4, updated_by = $5, updated_at = now(), version = version + 1
      WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, id, parsed.labourHours, parsed.notes, input.userId]);
    await db.query(`DELETE FROM project_factory_requirement_items WHERE workspace_id = $1 AND requirement_id = $2`, [input.workspaceId, id]);
  } else {
    await db.query(`INSERT INTO project_factory_requirements (id, workspace_id, project_id, boq_line_id, status, labour_hours, notes, created_by, updated_by) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $7)`,
      [id, input.workspaceId, input.projectId, input.lineId, parsed.labourHours, parsed.notes, input.userId]);
  }
  for (const [position, item] of parsed.items.entries()) {
    await db.query(`INSERT INTO project_factory_requirement_items (id, workspace_id, requirement_id, position, component_type, name, quantity, unit, catalog_item_id, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [randomUUID(), input.workspaceId, id, position, item.componentType, item.name, item.quantity, item.unit, item.catalogItemId, item.note]);
  }
  return { requirementId: id, title: line.title, created: !existing, reopened: existing?.status === "confirmed", items: parsed.items.length, labourHours: parsed.labourHours };
}

/** The Factory Lead confirms a line's requirements: from then on they are the line's quantities. Version-checked. */
export async function confirmFactoryRequirement(db: Db, input: { workspaceId: string; projectId: string; lineId: string; version: unknown; userId: string }) {
  const line = (await db.query<{ title: string }>(`SELECT title FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND status = 'active'`,
    [input.workspaceId, input.projectId, input.lineId])).rows[0];
  if (!line) throw new NotFoundException("Item not found.");
  const existing = await lockRequirement(db, input.workspaceId, input.lineId);
  if (!existing) throw new ConflictException("Record the requirements before confirming them.");
  if (input.version !== undefined && input.version !== existing.version) throw new ConflictException("Someone else changed these requirements. Reload to see their changes.");
  const check = confirmable({ status: existing.status, items: new Array(existing.items).fill(null) as unknown as RequirementItem[], labourHours: existing.labourHours });
  if (!check.ok) {
    if (check.reason === "already_confirmed") return { requirementId: existing.id, title: line.title, changed: false };
    throw new ConflictException("Add at least one material or the labour hours before confirming.");
  }
  await db.query(`UPDATE project_factory_requirements SET status = 'confirmed', confirmed_by = $3, confirmed_at = now(), updated_by = $3, updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
    [input.workspaceId, existing.id, input.userId]);
  return { requirementId: existing.id, title: line.title, changed: true };
}
