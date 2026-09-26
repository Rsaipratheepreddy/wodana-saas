import { UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { checkFormula } from "./quote-quantity";

type Db = Pick<PoolClient, "query">;
const KINDS = ["item", "service", "allowance", "client_supplied", "relocate", "dismantle", "remove_store", "dispose"] as const;

export type QuoteAiContext = {
  currency: string;
  areas: Array<{ id: string; name: string }>;
  trades: Array<{ id: string; name: string }>;
  catalog: Array<{ id: string; code: string; name: string; type: string; unit: string; category: string | null; priced: boolean }>;
  requirements: Array<{ room: string | null; kind: string; title: string; note: string; quantity: string | null; unit: string | null; avoid: string | null }>;
  measurements: Array<{ room: string | null; title: string; detail: string }>;
  designs: Array<{ room: string | null; title: string; stage: string | null; status: string | null }>;
  lines: Array<{ id: string; title: string; area: string | null; trade: string | null; quantity: string; unit: string; kind: string; version: number }>;
};

/** Everything the assistant may read for one quote: the planning record, the catalog and the quote's lines. Rates are never sent. */
export async function quoteAiContext(db: Db, workspaceId: string, caseId: string, quoteId: string, currency: string): Promise<QuoteAiContext> {
  const areas = (await db.query<{ id: string; name: string }>(`SELECT id, name FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2 ORDER BY lower(name)`, [workspaceId, caseId])).rows;
  const trades = (await db.query<{ id: string; name: string }>(`SELECT id, name FROM workspace_work_packages WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY position, name`, [workspaceId])).rows;
  const catalog = (await db.query<QuoteAiContext["catalog"][number]>(
    `SELECT item.id, item.code, item.name, item.item_type AS type, item.unit_code AS unit, category.name AS category,
            EXISTS (SELECT 1 FROM price_entries entry JOIN price_books book ON book.id = entry.price_book_id
                     WHERE entry.item_id = item.id AND entry.status IN ('active', 'reviewed') AND book.status = 'active' AND book.currency = $2) AS priced
       FROM catalog_items item LEFT JOIN catalog_categories category ON category.id = item.category_id
      WHERE item.workspace_id = $1 AND item.status = 'active' AND item.item_type <> 'package'
      ORDER BY category.name NULLS LAST, item.name LIMIT 500`, [workspaceId, currency])).rows;
  const requirements = (await db.query<QuoteAiContext["requirements"][number]>(
    `SELECT room.name AS room, entry.kind, entry.title, coalesce(entry.note, '') AS note, entry.quantity::text AS quantity, entry.unit, entry.avoid
       FROM pre_project_brief_entries entry LEFT JOIN pre_project_rooms room ON room.workspace_id = entry.workspace_id AND room.id = entry.room_id
      WHERE entry.workspace_id = $1 AND entry.case_id = $2 AND entry.archived_at IS NULL AND coalesce(entry.scope_status, '') <> 'excluded'
      ORDER BY room.name NULLS LAST, entry.created_at LIMIT 200`, [workspaceId, caseId])).rows;
  const measurements = (await db.query<{ room: string | null; title: string; content: unknown }>(
    `SELECT room.name AS room, record.title, record.content
       FROM pre_project_site_records record LEFT JOIN pre_project_rooms room ON room.workspace_id = record.workspace_id AND room.id = record.room_id
      WHERE record.workspace_id = $1 AND record.case_id = $2 AND record.kind = 'measurement' LIMIT 100`, [workspaceId, caseId])).rows
    .map((row) => ({ room: row.room, title: row.title, detail: JSON.stringify(row.content ?? {}).slice(0, 600) }));
  const designs = (await db.query<QuoteAiContext["designs"][number]>(
    `SELECT room.name AS room, design.title, design.stage,
            (SELECT version.status FROM pre_project_design_versions version WHERE version.workspace_id = design.workspace_id AND version.design_id = design.id ORDER BY number DESC LIMIT 1) AS status
       FROM pre_project_designs design LEFT JOIN pre_project_rooms room ON room.workspace_id = design.workspace_id AND room.id = design.room_id
      WHERE design.workspace_id = $1 AND design.case_id = $2 AND design.archived_at IS NULL LIMIT 100`, [workspaceId, caseId])).rows;
  const lines = (await db.query<QuoteAiContext["lines"][number]>(
    `SELECT line.id, line.title, room.name AS area, trade.name AS trade, line.quantity::text AS quantity, line.unit, line.kind, line.version
       FROM commercial_quote_lines line
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.id = line.area_id
       LEFT JOIN workspace_work_packages trade ON trade.workspace_id = line.workspace_id AND trade.id = line.work_package_id
      WHERE line.workspace_id = $1 AND line.case_id = $2 AND line.quote_id = $3 ORDER BY line.sort_order LIMIT 300`, [workspaceId, caseId, quoteId])).rows;
  return { currency, areas, trades, catalog, requirements, measurements, designs, lines };
}

export const QUOTE_DRAFT_SYSTEM = `You prepare a first quotation for an interior fit-out project from its planning record.
Use the firm's catalog items (by code) wherever one fits; otherwise describe a custom line. Never state prices.
Put each line in one of the given areas (or null for general work) and one of the given work packages (or null).
Give a quantity with its unit; when measurements allow, add a formula over length, width, height, count, area, perimeter or wall.
Cover what the client asked for, and the work it needs (demolition, electrical points, painting, disposal) when the brief implies it.
Respect things the client wants to avoid. Keep to what the record supports; don't invent rooms.
Output: {"summary": string, "changes": [{"action": "add", "code": string|null, "title": string, "area": string|null, "trade": string|null, "kind": "item"|"service"|"allowance"|"client_supplied"|"relocate"|"dismantle"|"remove_store"|"dispose", "quantity": number, "unit": string, "formula": string|null, "length": number|null, "width": number|null, "height": number|null, "count": number|null, "fromArea": string|null, "why": string}]}`;

export const QUOTE_PROMPT_SYSTEM = `You change an interior fit-out quotation as the estimator asks.
You may add lines (prefer catalog items by code), update a line's quantity, unit, formula, measurements, area or work package, move a line to another area, or remove a line.
Refer to existing lines by their id. Never state or change prices. Use only the given areas and work packages (or null).
If the request is unclear or not about this quote, return no changes and explain in the summary.
Output: {"summary": string, "changes": [{"action": "add"|"update"|"move"|"remove", "lineId": string|null, "code": string|null, "title": string|null, "area": string|null, "trade": string|null, "kind": string|null, "quantity": number|null, "unit": string|null, "formula": string|null, "length": number|null, "width": number|null, "height": number|null, "count": number|null, "fromArea": string|null, "why": string}]}`;

export function draftPrompt(context: QuoteAiContext) {
  return JSON.stringify({
    task: "Draft the quotation lines.",
    areas: context.areas.map((area) => area.name), workPackages: context.trades.map((trade) => trade.name),
    catalog: context.catalog.map((item) => ({ code: item.code, name: item.name, type: item.type, unit: item.unit, category: item.category })),
    requirements: context.requirements, measurements: context.measurements,
    designs: context.designs.filter((design) => design.status === "approved" || design.status === "client_review"),
    alreadyInQuote: context.lines.map((line) => ({ title: line.title, area: line.area, quantity: line.quantity, unit: line.unit })),
  });
}

export function editPrompt(context: QuoteAiContext, request: string) {
  return JSON.stringify({
    request, areas: context.areas.map((area) => area.name), workPackages: context.trades.map((trade) => trade.name),
    lines: context.lines.map(({ version: _version, ...line }) => line),
    catalog: context.catalog.map((item) => ({ code: item.code, name: item.name, type: item.type, unit: item.unit, category: item.category })),
  });
}

export type AiChange = {
  key: string; action: "add" | "update" | "move" | "remove"; lineId: string | null; lineVersion: number | null; lineTitle: string | null;
  catalogItemId: string | null; catalogName: string | null; priced: boolean;
  fields: { title?: string; areaId?: string | null; fromAreaId?: string | null; workPackageId?: string | null; kind?: string; quantity?: string; unit?: string; formula?: string | null; length?: string | null; width?: string | null; height?: string | null; count?: string | null };
  areaName: string | null; unknownArea: string | null; why: string;
};
export type AiProposal = { summary: string; changes: AiChange[] };

/**
 * Checks the model's answer against this quote: catalog codes must exist, areas and work packages
 * must be the project's own (an unknown area is reported, the line goes to General), formulas must
 * parse, quantities must be sane, and referenced lines must exist. Anything else is dropped.
 */
export function validateProposal(value: unknown, context: QuoteAiContext, allowed: Array<AiChange["action"]>): AiProposal {
  if (!value || typeof value !== "object" || !Array.isArray((value as { changes?: unknown }).changes)) throw new UnprocessableEntityException("The AI answer did not fit. Try again.");
  const input = value as { summary?: unknown; changes: unknown[] };
  const byCode = new Map(context.catalog.map((item) => [item.code.toLowerCase(), item]));
  const areaByName = new Map(context.areas.map((area) => [area.name.trim().toLowerCase(), area]));
  const tradeByName = new Map(context.trades.map((trade) => [trade.name.trim().toLowerCase(), trade]));
  const lineById = new Map(context.lines.map((line) => [line.id, line]));
  const str = (raw: unknown, max: number) => (typeof raw === "string" ? raw.trim().slice(0, max) : "");
  const num = (raw: unknown) => (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1_000_000 ? String(Math.round(raw * 10000) / 10000) : null);
  const changes: AiChange[] = [];
  for (const raw of input.changes.slice(0, 150)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const action = str(item.action, 10) as AiChange["action"];
    if (!allowed.includes(action)) continue;
    const line = typeof item.lineId === "string" ? lineById.get(item.lineId) : undefined;
    if (action !== "add" && !line) continue;
    const catalog = typeof item.code === "string" ? byCode.get(item.code.trim().toLowerCase()) : undefined;
    const fields: AiChange["fields"] = {};
    let unknownArea: string | null = null, areaName: string | null = null;
    if (item.area !== undefined && (action !== "update" || item.area !== null)) {
      const name = str(item.area, 120);
      const area = name ? areaByName.get(name.toLowerCase()) : undefined;
      if (name && !area) unknownArea = name;
      fields.areaId = area?.id ?? null; areaName = area?.name ?? null;
    }
    if (typeof item.fromArea === "string") fields.fromAreaId = areaByName.get(item.fromArea.trim().toLowerCase())?.id ?? null;
    if (item.trade !== undefined && (action !== "update" || item.trade !== null)) {
      const trade = typeof item.trade === "string" ? tradeByName.get(item.trade.trim().toLowerCase()) : undefined;
      fields.workPackageId = trade?.id ?? null;
    }
    if (action === "add" || action === "update") {
      const title = str(item.title, 240);
      if (title && !catalog) fields.title = title;
      if (typeof item.kind === "string" && (KINDS as readonly string[]).includes(item.kind)) fields.kind = item.kind;
      const quantity = num(item.quantity);
      if (quantity !== null) fields.quantity = quantity;
      const unit = str(item.unit, 20);
      if (unit && !catalog) fields.unit = unit;
      for (const key of ["length", "width", "height", "count"] as const) { const value = num(item[key]); if (value !== null) fields[key] = value; }
      const formula = str(item.formula, 200);
      if (formula) { try { checkFormula(formula); fields.formula = formula; } catch { /* a formula that doesn't parse is left out; the quantity stands */ } }
      if (fields.kind === "relocate" && !fields.fromAreaId) fields.kind = "service";
    }
    if (action === "add" && !catalog && !fields.title) continue;
    if (action === "update" && !Object.keys(fields).length) continue;
    changes.push({
      key: `${changes.length}`, action, lineId: line?.id ?? null, lineVersion: line?.version ?? null, lineTitle: line?.title ?? null,
      catalogItemId: catalog?.id ?? null, catalogName: catalog?.name ?? null, priced: catalog?.priced ?? false,
      fields, areaName, unknownArea, why: str(item.why, 300),
    });
  }
  return { summary: str(input.summary, 600), changes };
}
