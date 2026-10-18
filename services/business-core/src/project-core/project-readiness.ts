import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import {
  catalogRows, missingCount, readCatalogFacts, type CatalogColumn, type ReadinessCell, type ReadinessColumn, type ReadinessSettings,
} from "../catalog-core/item-readiness";
import { readOrderInspections, type OrderInspection } from "../factory/factory-inspections";
import { readNeeds, type LineStatus } from "../purchasing/orders";
import { readDrawingItems, type DrawingItem } from "./project-drawing-needs";
import { readLatestRevision, type LatestRevision } from "./project-drawings";
import { readMaterials } from "./project-materials";
import { suggestedSupply, type Supply } from "./project-scope";

type Db = Pick<PoolClient, "query">;

/** A project's line has the catalogue columns but price (agreed on the quotation), then the columns of its delivery. */
export const PROJECT_COLUMNS = ["picture", "size", "drawing", "materials", "labour", "selection", "purchase", "production", "delivery"] as const satisfies readonly ReadinessColumn[];
export type ProjectColumn = (typeof PROJECT_COLUMNS)[number];

/** Which delivery areas the project shows (an area its path doesn't use has no column). */
export type Areas = { production: boolean; supply: boolean; delivery: boolean };

export type LineFacts = {
  id: string; kind: string; title: string; quantity: string; unit: string; areaName: string | null;
  catalogItemId: string | null; catalogId: string | null; code: string | null; itemType: string | null;
  catalogImageId: string | null; imageAssetId: string | null;
  /** How the line is delivered: its package's way, or the likely way from its kind and item type. */
  supply: Supply; packaged: boolean;
  /** The quotation line's own size and material text. */
  lineSized: boolean; lineMaterial: string;
  installed: string;
};

export type MaterialFact = { id: string; boqLineIds: string[]; clientChoice: boolean; decision: "approved" | "rejected" | null };
/**
 * A work order of the line, and (PLM-150) the design inspection it waits on: with the design team (`due`), snags the
 * factory fixes (`snags`), or not asked for yet (`waiting`, after finishing only). Null when it waits on none.
 */
export type OrderFact = { status: string; quantity: string; inspection?: "due" | "snags" | "waiting" | null };
export type DrawingFact = Pick<DrawingItem, "needed" | "catalogDrawingUrl">;

export type ProjectFacts = {
  catalog: Partial<Record<CatalogColumn, ReadinessCell>> | null;
  drawing: DrawingFact | null;
  latestDrawing: Pick<LatestRevision, "status" | "drawingFiles"> & { checkKind?: LatestRevision["checkKind"] } | null;
  materials: MaterialFact[];
  /** Where the material list stands as a whole (draft, sent, signed off, changes requested, changed since). */
  materialsState: string;
  needs: LineStatus[];
  orders: OrderFact[];
};

const done = (note?: string, detail?: string): ReadinessCell => ({ state: "done", ...(note ? { note } : {}), ...(detail ? { detail } : {}) });
const missing = (note?: string): ReadinessCell => ({ state: "missing", ...(note ? { note } : {}) });
const waiting = (note: string, detail?: string): ReadinessCell => ({ state: "waiting", note, ...(detail ? { detail } : {}) });
const notNeeded: ReadinessCell = { state: "not_needed" };

const RANK = ["required", "ordered", "received", "installed"] as const;

/** The cells of one project line, from its records. */
export function lineCells(line: LineFacts, facts: ProjectFacts): Record<ProjectColumn, ReadinessCell> {
  const item = line.kind === "item";
  const made = line.supply === "make";
  const catalog = facts.catalog;
  const fromCatalog = (column: CatalogColumn, needed: boolean): ReadinessCell => {
    const cell = catalog?.[column];
    if (cell && cell.state !== "missing" && cell.state !== "not_needed") return cell;
    return needed ? missing() : notNeeded;
  };

  const picture = line.imageAssetId || line.catalogImageId ? done() : fromCatalog("picture", item);
  const size = line.lineSized ? done() : fromCatalog("size", item && (!line.catalogItemId || catalog?.size?.state === "missing"));

  // Drawings are the project's (one revision at a time): a line that needs them waits for that revision.
  let drawing: ReadinessCell = notNeeded;
  if (facts.drawing && !facts.drawing.needed) drawing = facts.drawing.catalogDrawingUrl ? done("catalogue_drawing") : notNeeded;
  else if (facts.drawing?.needed) {
    const latest = facts.latestDrawing;
    const sentBack = latest && (latest.status === "changes_needed" || latest.status === "changes_requested");
    drawing = latest?.status === "approved" ? done("approved")
      : latest && latest.drawingFiles > 0 && !sentBack ? waiting(latest.status === "uploaded" ? "uploaded" : latest.status === "checked" ? (latest.checkKind === "design" ? "design_checked" : "site_checked") : "sent")
        : missing(sentBack ? "changes_requested" : undefined);
  }

  const mine = facts.materials.filter((material) => material.boqLineIds.includes(line.id));
  const catalogMaterials = fromCatalog("materials", false);
  const materials = mine.length ? done("material_list")
    : catalogMaterials.state !== "not_needed" ? catalogMaterials
      : line.lineMaterial.trim() ? done("from_quote", line.lineMaterial.trim())
        : item && made ? missing() : notNeeded;
  const labour = fromCatalog("labour", item && made);

  const choices = mine.filter((material) => material.clientChoice);
  const selection = !choices.length ? notNeeded
    : facts.materialsState === "signed_off" && choices.every((material) => material.decision === "approved") ? done("signed_off")
      : facts.materialsState === "sent" ? waiting("sent")
        : missing(facts.materialsState === "changes_requested" ? "changes_requested" : undefined);

  // Bought: every need for the line (its own purchase, or its materials') by where the least advanced one has got to.
  let purchase: ReadinessCell = notNeeded;
  if (facts.needs.length) {
    const least = facts.needs.reduce((low, next) => (RANK.indexOf(next) < RANK.indexOf(low) ? next : low));
    purchase = least === "required" ? missing("required") : least === "ordered" ? waiting("ordered") : done(least);
  }

  // Made in the factory: its work orders (none yet is missing), by the least advanced one.
  let production: ReadinessCell = notNeeded;
  if (made && item) {
    const live = facts.orders.filter((order) => order.status !== "cancelled");
    const planned = live.reduce((sum, order) => sum.add(order.quantity), Dec.of(0));
    if (!live.length) production = missing();
    else {
      // PLM-150: an item at a design inspection (or with its snags) reads as that, after production and before ready.
      const steps = live.map((order) => order.inspection ? "inspection" : order.status === "ready" || order.status === "short_closed" ? "ready"
        : order.status === "in_production" ? "in_production" : order.status === "on_hold" ? "on_hold" : "scheduled");
      const order = ["on_hold", "scheduled", "in_production", "inspection", "ready"];
      const least = steps.reduce((low, next) => (order.indexOf(next) < order.indexOf(low) ? next : low));
      production = least === "ready" && planned.cmp(line.quantity) >= 0 ? done("ready")
        : least === "inspection" ? waiting(live.some((entry) => entry.inspection === "snags") ? "inspection_snags" : "inspection_due")
          : waiting(least === "ready" ? "in_production" : least);
    }
  }

  // Installed on site: what approved site reports installed against the line.
  const installed = Dec.of(line.installed);
  const delivery = installed.cmp(0) <= 0 ? (item || line.kind === "client_supplied" ? waiting("not_installed") : notNeeded)
    : installed.cmp(line.quantity) >= 0 ? done("installed") : waiting("part_installed");

  return { picture, size, drawing, materials, labour, selection, purchase, production, delivery };
}

/** The design inspection a work order waits on (PLM-150): Inspection 1 while it's made, the last one once it's made and checked. */
export function inspectionWait(status: string, state: Pick<OrderInspection, "raw" | "final"> | undefined): OrderFact["inspection"] {
  if (!state) return null;
  const as = (step: OrderInspection["raw"]) => step === "due" ? "due" as const : step === "snags" ? "snags" as const : null;
  if (status === "in_production") return as(state.raw);
  if (status === "ready" || status === "short_closed") return as(state.final) ?? (state.final === "to_request" ? "waiting" : null);
  return null;
}

/** The columns a project shows: the workspace's chosen columns, less the delivery areas its path doesn't use. */
export function projectColumns(settings: Pick<ReadinessSettings, "columns">, areas: Areas): ProjectColumn[] {
  return PROJECT_COLUMNS.filter((column) => settings.columns.includes(column)
    && !(column === "purchase" && !areas.supply) && !(column === "production" && !areas.production) && !(column === "delivery" && !areas.delivery));
}

export type ProjectReadinessRow = Omit<LineFacts, "supply" | "packaged" | "lineSized" | "lineMaterial" | "installed" | "kind" | "itemType"> & {
  cells: Record<ProjectColumn, ReadinessCell>; missing: number;
};

/** Every active line of the project's scope (the accepted quotation and accepted variations), with its readiness. */
export async function readProjectReadiness(db: Db, workspaceId: string, projectId: string, settings: ReadinessSettings, areas: Areas) {
  const lines = (await db.query<Omit<LineFacts, "supply" | "packaged"> & { packageSupply: Supply | null }>(
    `SELECT line.id, line.kind, line.title, line.quantity::text AS quantity, line.unit, room.name AS "areaName",
            line.catalog_item_id AS "catalogItemId", item.catalog_id AS "catalogId", item.code, item.item_type AS "itemType",
            line.catalog_image_id AS "catalogImageId", line.image_asset_id AS "imageAssetId", package.supply AS "packageSupply",
            coalesce(quote_line.length IS NOT NULL OR quote_line.width IS NOT NULL OR quote_line.height IS NOT NULL, false) AS "lineSized",
            coalesce(quote_line.material, '') AS "lineMaterial",
            coalesce((SELECT sum(entry.installed) FROM site_report_lines entry
                        JOIN site_reports report ON report.workspace_id = entry.workspace_id AND report.id = entry.report_id
                       WHERE entry.workspace_id = line.workspace_id AND entry.boq_line_id = line.id AND report.status = 'approved'), 0)::text AS installed
       FROM project_boq_lines line
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       JOIN project_scope_seals seal ON seal.workspace_id = line.workspace_id AND seal.id = line.origin_seal_id
       LEFT JOIN commercial_quote_lines quote_line ON quote_line.workspace_id = line.workspace_id AND quote_line.case_id = project.case_id
             AND quote_line.quote_id = seal.quote_id AND quote_line.id = line.source_line_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
       LEFT JOIN catalog_items item ON item.workspace_id = line.workspace_id AND item.id = line.catalog_item_id
       LEFT JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = line.package_id
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active'
      ORDER BY seal.kind <> 'baseline', seal.sealed_at, line.position, line.id`, [workspaceId, projectId])).rows;
  const columns = projectColumns(settings, areas);
  if (!lines.length) return { columns, rows: [] as ProjectReadinessRow[] };

  const itemIds = [...new Set(lines.map((line) => line.catalogItemId).filter((id): id is string => Boolean(id)))];
  const catalog = new Map(catalogRows(await readCatalogFacts(db, workspaceId, { itemIds }), settings).map((row) => [row.id, row.cells]));
  const drawings = new Map((await readDrawingItems(db, workspaceId, projectId)).map((entry) => [entry.lineId, entry]));
  const latestDrawing = await readLatestRevision(db, workspaceId, projectId);
  const materialList = await readMaterials(db, workspaceId, projectId);
  const materials: MaterialFact[] = materialList.items.map((entry) => ({ id: entry.id, boqLineIds: entry.boqLineIds, clientChoice: entry.clientChoice, decision: entry.decision?.decision ?? null }));
  const needs = await readNeeds(db, workspaceId, false, projectId);
  const inspections = await readOrderInspections(db, workspaceId, { projectId });
  const orders = (await db.query<OrderFact & { lineId: string; id: string }>(
    `SELECT id, boq_line_id AS "lineId", status, quantity::text AS quantity FROM work_orders WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows
    .map((order) => ({ ...order, inspection: inspectionWait(order.status, inspections.get(order.id)) }));

  const rows = lines.map(({ packageSupply, ...line }): ProjectReadinessRow => {
    const facts: LineFacts = { ...line, supply: packageSupply ?? suggestedSupply(line.kind, line.itemType), packaged: Boolean(packageSupply) };
    const mine = materials.filter((material) => material.boqLineIds.includes(line.id)).map((material) => material.id);
    const cells = lineCells(facts, {
      catalog: line.catalogItemId ? catalog.get(line.catalogItemId) ?? null : null,
      drawing: drawings.get(line.id) ?? null, latestDrawing,
      materials, materialsState: materialList.state,
      needs: needs.filter((need) => (need.source === "line" && need.sourceId === line.id) || (need.source === "material" && mine.includes(need.sourceId))).map((need) => need.status),
      orders: orders.filter((order) => order.lineId === line.id),
    });
    const { kind, itemType, lineSized, lineMaterial, installed, ...shown } = line;
    void kind; void itemType; void lineSized; void lineMaterial; void installed;
    return { ...shown, cells, missing: missingCount(cells, columns) };
  });
  return { columns, rows };
}
