import type { BuilderLine, LineKind, QuoteView } from "./types";
import { GENERAL, NO_TRADE } from "./types";

/** Money for display only; the numbers themselves stay decimal strings from the server. */
export function money(value: string | number | null | undefined, currency: string, decimals: number, locale: string) {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(value));
}
export function plain(value: string | number | null | undefined, locale: string, decimals = 4) {
  if (value === null || value === undefined || value === "") return "";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(Number(value));
}

/** Translation keys for the line kinds (English text is the key). */
export const LINE_KIND_LABEL: Record<LineKind, string> = {
  item: "Item", service: "Service", allowance: "Allowance", client_supplied: "Client-supplied",
  relocate: "Move", dismantle: "Dismantle", remove_store: "Remove & store", dispose: "Dispose",
};
export const VIEW_LABEL: Record<QuoteView, string> = { area: "By area", trade: "By trade", area_trade: "Area → trade" };

export type LineGroup = { key: string; name: string; lines: BuilderLine[]; children?: LineGroup[] };

/** Lines grouped for a view: areas in the project's order (General last) or trades in the firm's order (no trade last). */
export function groupLines(lines: BuilderLine[], view: QuoteView, areas: Array<{ id: string; name: string }>, trades: Array<{ id: string; name: string }>, names: { general: string; noTrade: string }): LineGroup[] {
  const byArea = (subset: BuilderLine[]) => {
    const groups = areas.map((area) => ({ key: area.id, name: area.name, lines: subset.filter((line) => line.areaId === area.id) }));
    groups.push({ key: GENERAL, name: names.general, lines: subset.filter((line) => !line.areaId || !areas.some((area) => area.id === line.areaId)) });
    return groups;
  };
  const byTrade = (subset: BuilderLine[]) => {
    const groups = trades.map((trade) => ({ key: trade.id, name: trade.name, lines: subset.filter((line) => line.workPackageId === trade.id) }));
    groups.push({ key: NO_TRADE, name: names.noTrade, lines: subset.filter((line) => !line.workPackageId || !trades.some((trade) => trade.id === line.workPackageId)) });
    return groups;
  };
  const sorted = [...lines].sort((a, b) => a.position - b.position);
  if (view === "trade") return byTrade(sorted);
  const groups = byArea(sorted);
  if (view === "area_trade") return groups.map((group) => ({ ...group, children: byTrade(group.lines).filter((child) => child.lines.length) }));
  return groups;
}

/** A quote's state in words, and the tone it's shown in. */
export const QUOTE_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" }, internal_review: { label: "In review", tone: "info" }, internal_approved: { label: "Approved internally", tone: "info" },
  issued: { label: "Sent", tone: "info" }, accepted: { label: "Accepted", tone: "success" }, changes_requested: { label: "Changes requested", tone: "warning" },
  declined: { label: "Declined", tone: "danger" }, superseded: { label: "Replaced", tone: "neutral" }, withdrawn: { label: "Withdrawn", tone: "neutral" }, expired: { label: "Expired", tone: "warning" },
};
