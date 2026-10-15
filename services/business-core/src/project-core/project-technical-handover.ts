import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { ReadinessCell, ReadinessSettings } from "../catalog-core/item-readiness";
import { readDrawingItems, type DrawingReason } from "./project-drawing-needs";
import { readLineRequirements, type LineRequirementRow, type RequirementState } from "./project-factory-requirements";
import { readProjectReadiness, type Areas } from "./project-readiness";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-165: the technical handover pack. Sales or design hands the project's lines over to the technical team with
 * everything they need to draw and make them; the technical team accepts it. Each line carries its drawing need, where
 * its requirements stand (verified recipe, or the factory's record), its selections and sizes, and a checklist of what
 * is still missing, read from item readiness. The pack can't be accepted while a required item is missing, unless the
 * item is marked "Not applicable" on that line with a reason.
 */
/** The checklist per line: what sales and design provide for the technical team (read from item readiness). */
export const HANDOVER_ITEMS = ["picture", "size", "materials", "selection"] as const;
export type HandoverItem = (typeof HANDOVER_ITEMS)[number];

export type HandoverStatus = "draft" | "handed_over" | "accepted";

export type Waiver = { reason: string; byName: string | null; at: string };

export type HandoverRow = {
  lineId: string; title: string; code: string | null; quantity: string; unit: string; areaName: string | null; catalogItemId: string | null; catalogId: string | null;
  catalogImageId: string | null; imageAssetId: string | null;
  size: string | null;
  /** Whether the line needs technical drawings and why (null: the line isn't drawn at all). */
  drawing: { needed: boolean; reason: DrawingReason; overridden: boolean } | null;
  /** Where the line's material and labour requirements stand (PLM-166). */
  requirements: RequirementState;
  cells: Record<HandoverItem, ReadinessCell>;
  waivers: Partial<Record<HandoverItem, Waiver>>;
  /** Checklist items still missing on this line, after waivers. */
  missing: HandoverItem[];
};

export type HandoverRecord = {
  status: HandoverStatus; version: number;
  handedOver: { byName: string | null; at: string; note: string } | null;
  accepted: { byName: string | null; at: string } | null;
};

export type HandoverPack = HandoverRecord & { items: readonly HandoverItem[]; rows: HandoverRow[]; missing: number; requirements: LineRequirementRow[] };

/** A line's checklist: the items missing, less those marked not applicable. */
export function missingItems(cells: Partial<Record<HandoverItem, ReadinessCell>>, waived: Iterable<string>): HandoverItem[] {
  const skip = new Set(waived);
  return HANDOVER_ITEMS.filter((item) => cells[item]?.state === "missing" && !skip.has(item));
}

/** Whether the pack can be accepted now: it was handed over, and nothing required is missing. */
export function acceptable(pack: { status: HandoverStatus; missing: number }): { ok: true } | { ok: false; reason: "not_handed_over" | "already_accepted" | "missing" } {
  if (pack.status === "accepted") return { ok: false, reason: "already_accepted" };
  if (pack.status !== "handed_over") return { ok: false, reason: "not_handed_over" };
  if (pack.missing > 0) return { ok: false, reason: "missing" };
  return { ok: true };
}

/** The pack's record (draft when the project has none yet). */
export async function readHandoverRecord(db: Db, workspaceId: string, projectId: string): Promise<HandoverRecord> {
  const row = (await db.query<{ status: HandoverStatus; version: number; handedBy: string | null; handedAt: Date | null; note: string; acceptedBy: string | null; acceptedAt: Date | null }>(
    `SELECT handover.status, handover.version, hander.display_name AS "handedBy", handover.handed_over_at AS "handedAt", handover.handed_over_note AS note,
            acceptor.display_name AS "acceptedBy", handover.accepted_at AS "acceptedAt"
       FROM project_technical_handovers handover
       LEFT JOIN users hander ON hander.id = handover.handed_over_by
       LEFT JOIN users acceptor ON acceptor.id = handover.accepted_by
      WHERE handover.workspace_id = $1 AND handover.project_id = $2`, [workspaceId, projectId])).rows[0];
  if (!row) return { status: "draft", version: 0, handedOver: null, accepted: null };
  return {
    status: row.status, version: row.version,
    handedOver: row.handedAt ? { byName: row.handedBy, at: row.handedAt.toISOString(), note: row.note } : null,
    accepted: row.acceptedAt ? { byName: row.acceptedBy, at: row.acceptedAt.toISOString() } : null,
  };
}

/** The pack: its record, every line with its checklist, drawing need, requirements and waivers, and the missing count. */
export async function readTechnicalHandover(db: Db, workspaceId: string, projectId: string, settings: ReadinessSettings, areas: Areas): Promise<HandoverPack> {
  const record = await readHandoverRecord(db, workspaceId, projectId);
  const readiness = await readProjectReadiness(db, workspaceId, projectId, settings, areas);
  const drawings = new Map((await readDrawingItems(db, workspaceId, projectId)).map((item) => [item.lineId, item]));
  const requirements = await readLineRequirements(db, workspaceId, projectId);
  const byLine = new Map(requirements.map((row) => [row.lineId, row]));
  const waivers = (await db.query<{ lineId: string; item: HandoverItem; reason: string; byName: string | null; at: Date }>(
    `SELECT waiver.boq_line_id AS "lineId", waiver.item, waiver.reason, setter.display_name AS "byName", waiver.set_at AS at
       FROM project_technical_handover_waivers waiver LEFT JOIN users setter ON setter.id = waiver.set_by WHERE waiver.workspace_id = $1 AND waiver.project_id = $2`, [workspaceId, projectId])).rows;
  const rows = readiness.rows.map((row): HandoverRow => {
    const cells = Object.fromEntries(HANDOVER_ITEMS.map((item) => [item, row.cells[item] ?? { state: "not_needed" }])) as Record<HandoverItem, ReadinessCell>;
    const mine = waivers.filter((waiver) => waiver.lineId === row.id);
    const drawing = drawings.get(row.id);
    const requirement = byLine.get(row.id);
    return {
      lineId: row.id, title: row.title, code: row.code, quantity: row.quantity, unit: row.unit, areaName: row.areaName, catalogItemId: row.catalogItemId, catalogId: row.catalogId,
      catalogImageId: row.catalogImageId, imageAssetId: row.imageAssetId, size: requirement?.size ?? null,
      drawing: drawing ? { needed: drawing.needed, reason: drawing.rule.reason, overridden: drawing.override !== null } : null,
      requirements: requirement?.state ?? "not_needed",
      cells,
      waivers: Object.fromEntries(mine.map((waiver) => [waiver.item, { reason: waiver.reason, byName: waiver.byName, at: waiver.at.toISOString() }])),
      missing: missingItems(cells, mine.map((waiver) => waiver.item)),
    };
  });
  return { ...record, items: HANDOVER_ITEMS, rows, missing: rows.reduce((sum, row) => sum + row.missing.length, 0), requirements };
}

/** True once the technical team accepted the pack (PLM-174's first path E check). */
export async function technicalHandoverAccepted(db: Db, workspaceId: string, projectId: string) {
  return Boolean((await db.query(`SELECT 1 FROM project_technical_handovers WHERE workspace_id = $1 AND project_id = $2 AND status = 'accepted'`, [workspaceId, projectId])).rowCount);
}

async function lockRecord(db: Db, workspaceId: string, projectId: string) {
  await db.query(`INSERT INTO project_technical_handovers (workspace_id, project_id) VALUES ($1, $2) ON CONFLICT (workspace_id, project_id) DO NOTHING`, [workspaceId, projectId]);
  return (await db.query<{ status: HandoverStatus; version: number }>(
    `SELECT status, version FROM project_technical_handovers WHERE workspace_id = $1 AND project_id = $2 FOR UPDATE`, [workspaceId, projectId])).rows[0];
}

/** Sales or design hands the pack over (again, after changes, while it isn't accepted). The note travels with the notice. */
export async function handOverTechnical(db: Db, input: { workspaceId: string; projectId: string; userId: string; note: unknown; version: unknown }) {
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 2000) throw new BadRequestException("Keep the note under 2000 characters.");
  const record = await lockRecord(db, input.workspaceId, input.projectId);
  if (input.version !== undefined && input.version !== record.version) throw new ConflictException("Someone else changed the handover. Reload to see their changes.");
  if (record.status === "accepted") throw new ConflictException("The technical team accepted this handover already.");
  await db.query(`UPDATE project_technical_handovers SET status = 'handed_over', handed_over_by = $3, handed_over_at = now(), handed_over_note = $4, version = version + 1, updated_at = now()
    WHERE workspace_id = $1 AND project_id = $2`, [input.workspaceId, input.projectId, input.userId, note]);
  return { note, again: record.status === "handed_over" };
}

/** The technical team accepts the pack: only once it was handed over and nothing required is missing. */
export async function acceptTechnicalHandover(db: Db, input: { workspaceId: string; projectId: string; userId: string; version: unknown; missing: number }) {
  const record = await lockRecord(db, input.workspaceId, input.projectId);
  if (input.version !== undefined && input.version !== record.version) throw new ConflictException("Someone else changed the handover. Reload to see their changes.");
  const check = acceptable({ status: record.status, missing: input.missing });
  if (!check.ok) {
    if (check.reason === "already_accepted") return false;
    if (check.reason === "not_handed_over") throw new ConflictException("The pack hasn't been handed over yet.");
    throw new ConflictException(input.missing === 1 ? "1 item is still missing. Fill it, or mark it not applicable with a reason." : `${input.missing} items are still missing. Fill them, or mark them not applicable with a reason.`);
  }
  await db.query(`UPDATE project_technical_handovers SET status = 'accepted', accepted_by = $3, accepted_at = now(), version = version + 1, updated_at = now() WHERE workspace_id = $1 AND project_id = $2`,
    [input.workspaceId, input.projectId, input.userId]);
  return true;
}

/** Marks a checklist item not applicable on one line, with the reason (null clears it). Who and when are kept. */
export async function waiveHandoverItem(db: Db, input: { workspaceId: string; projectId: string; lineId: unknown; item: unknown; reason: unknown; userId: string }) {
  if (!HANDOVER_ITEMS.includes(input.item as HandoverItem)) throw new BadRequestException("Choose a checklist item.");
  const line = (await db.query<{ title: string }>(`SELECT title FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND status = 'active'`,
    [input.workspaceId, input.projectId, typeof input.lineId === "string" ? input.lineId : null])).rows[0];
  if (!line) throw new NotFoundException("Item not found.");
  if (input.reason === null) {
    await db.query(`DELETE FROM project_technical_handover_waivers WHERE workspace_id = $1 AND boq_line_id = $2 AND item = $3`, [input.workspaceId, input.lineId, input.item]);
    return { title: line.title, item: input.item as HandoverItem, reason: null };
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) throw new BadRequestException("Say why it doesn't apply.");
  if (reason.length > 500) throw new BadRequestException("Keep the reason under 500 characters.");
  await db.query(`INSERT INTO project_technical_handover_waivers (workspace_id, project_id, boq_line_id, item, reason, set_by) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (workspace_id, boq_line_id, item) DO UPDATE SET reason = excluded.reason, set_by = excluded.set_by, set_at = now()`,
    [input.workspaceId, input.projectId, input.lineId, input.item, reason, input.userId]);
  return { title: line.title, item: input.item as HandoverItem, reason };
}
