import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../common/currency";

type Db = Pick<PoolClient, "query">;

/** One live scope line as read from the project, before the client's projection. */
export type BoqSourceLine = { id: string; roomId: string | null; room: string | null; title: string; description: string; quantity: string; unit: string; rate: string; amount: string };

/**
 * PLM-170: the client's bill of quantities, field by field: the room, the item, its description, quantity, unit, selling
 * rate and amount, with a total per room and overall. The latest revision is the live scope (the sealed quotation with every
 * applied variation), active lines only. Cost, margin, packages, suppliers, orders and the team's notes never leave.
 */
export function portalBoq(lines: readonly BoqSourceLine[], currency: string | null, revision: string | null) {
  const places = currency ? currencyDecimals(currency) : 2;
  const money = (value: Dec) => value.toFixed(places);
  const rooms = new Map<string, { id: string | null; name: string | null; lines: Array<{ id: string; title: string; description: string; quantity: string; unit: string; rate: string; amount: string }>; total: Dec }>();
  let total = Dec.ZERO;
  for (const line of lines) {
    const key = line.roomId ?? "";
    const room = rooms.get(key) ?? { id: line.roomId, name: line.room, lines: [], total: Dec.ZERO };
    const amount = Dec.of(line.amount);
    room.lines.push({ id: line.id, title: line.title, description: line.description, quantity: Dec.of(line.quantity).toString(), unit: line.unit, rate: money(Dec.of(line.rate)), amount: money(amount) });
    room.total = room.total.add(amount);
    total = total.add(amount);
    rooms.set(key, room);
  }
  return { currency, revision, rooms: [...rooms.values()].map((room) => ({ id: room.id, name: room.name, lines: room.lines, total: money(room.total) })), total: money(total) };
}

export type PortalBoq = ReturnType<typeof portalBoq>;

/** The project's live BOQ for its client: active lines by room in the quotation's order, labelled with the latest sealed revision. */
export async function readPortalBoq(db: Db, workspaceId: string, projectId: string, currency: string | null): Promise<PortalBoq> {
  const lines = (await db.query<BoqSourceLine>(
    `SELECT line.id, line.area_id AS "roomId", room.name AS room, line.title, line.description, line.quantity::text AS quantity, line.unit, line.rate::text AS rate, line.net::text AS amount
       FROM project_boq_lines line
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
      WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active'
      ORDER BY room.name NULLS LAST, line.position`, [workspaceId, projectId])).rows;
  const revision = (await db.query<{ label: string }>(
    `SELECT revision_label AS label FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2 ORDER BY sealed_at DESC LIMIT 1`, [workspaceId, projectId])).rows[0]?.label ?? null;
  return portalBoq(lines, currency, revision);
}
