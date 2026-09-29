"use client";

import { ActivityFeed, type ActivityItem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { WorkOrderState } from "@/lib/factory/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";

/** The work order's timeline: who did what, newest first, in plain words. */
export function WorkOrderHistory({ state }: { state: WorkOrderState }) {
  const t = useT();
  const format = useProjectFormat();
  const unit = (value: unknown) => `${quantityText(typeof value === "string" ? value : String(value ?? "0")) || "0"} ${state.order.unit}`.trim();
  const text = (kind: string, detail: Record<string, unknown>) => {
    const value = (key: string) => (typeof detail[key] === "string" ? detail[key] as string : "");
    switch (kind) {
      case "planned": return t("planned {quantity}", { quantity: unit(detail.quantity) });
      case "update": return t("changed where and when");
      case "set_quantity": return t("changed the quantity to {quantity}", { quantity: unit(detail.to) });
      case "approve_drawing": return t("recorded the approved drawing {reference}", { reference: value("reference") });
      case "revise_drawing": return detail.held ? t("changed the drawing to {reference} and put it on hold: {note}", { reference: value("reference"), note: value("note") })
        : t("changed the drawing to {reference}: {note}", { reference: value("reference"), note: value("note") });
      case "drawing_stale": return t("noticed a newer drawing (R{number})", { number: String(detail.newer ?? "") });
      case "release": return t("released it");
      case "start": return t("started it");
      case "report": return [Number(detail.good) ? t("reported {quantity} made", { quantity: unit(detail.good) }) : "",
        Number(detail.scrap) ? t("{quantity} scrapped: {reason}", { quantity: unit(detail.scrap), reason: value("scrapReason") }) : ""].filter(Boolean).join(", ") || t("reported output");
      case "decide_report": return detail.decision === "approved" ? t("approved a report") : t("refused a report: {note}", { note: value("note") });
      case "check": return [Number(detail.passed) ? t("passed {quantity}", { quantity: unit(detail.passed) }) : "",
        Number(detail.failed) ? t("failed {quantity}: {reason}", { quantity: unit(detail.failed), reason: value("failReason") }) : ""].filter(Boolean).join(", ");
      case "hold": return t("put it on hold: {reason}", { reason: value("reason") });
      case "resume": return t("let it go on");
      case "cancel": return t("cancelled it: {reason}", { reason: value("reason") });
      case "short_close": return t("closed it short: {reason}", { reason: value("reason") });
      case "send_out": return t("sent {step} out ({order})", { step: value("name"), order: value("number") });
      case "dispatch": return t("sent {quantity} to site", { quantity: unit(detail.quantity) });
      case "reworked": return t("took back {quantity} from site to make again: {reason}", { quantity: unit(detail.quantity), reason: value("reason") });
      case "add_material": case "suggest_materials": return t("added materials");
      case "set_material": case "remove_material": return t("changed the materials");
      case "issue_material": return t("issued material");
      case "return_material": return t("took material back");
      case "substitute": return t("asked to swap a material: {reason}", { reason: value("reason") });
      case "decide_substitution": return detail.decision === "approved" ? t("approved a material swap") : t("refused a material swap: {note}", { note: value("note") });
      default: return t("changed it");
    }
  };
  const items: ActivityItem[] = [...state.events].reverse().map((entry) => ({ id: entry.id, actor: entry.byName || t("Someone"), action: text(entry.kind, entry.detail), occurredAt: format.when(entry.at), kind: "change" }));
  return <ActivityFeed items={items} />;
}
