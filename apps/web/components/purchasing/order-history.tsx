"use client";

import { ActivityFeed, type ActivityItem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { OrderState } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText, useOrderLabels } from "./order-labels";

/** The order's timeline: who did what, newest first, in plain words. */
export function OrderHistory({ state }: { state: OrderState }) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useOrderLabels();
  const text = (kind: string, detail: Record<string, unknown>) => {
    const value = (key: string) => (typeof detail[key] === "string" ? detail[key] as string : "");
    switch (kind) {
      case "created": return value("replaces") ? t("raised it to replace a line on {order}", { order: value("replaces") }) : t("raised it");
      case "submitted": return t("sent it for approval");
      case "approved": return detail.policy === "under_threshold" ? t("placed it (no approval needed at this amount)") : t("approved it");
      case "returned": return t("sent it back: {note}", { note: value("note") });
      case "sent": return value("to") ? t("sent it to {email}", { email: value("to") }) : t("marked it as sent");
      case "emailed": return t("emailed it to {email}", { email: value("to") });
      case "email_not_sent": return t("couldn't email it to {email}", { email: value("to") });
      case "confirmed": return value("promisedDate") ? t("recorded the supplier's confirmation, promised for {date}", { date: format.day(value("promisedDate")) }) : t("recorded the supplier's confirmation");
      case "changing": return t("reopened it to change: {reason}", { reason: value("reason") });
      case "cancelled": return t("cancelled it: {reason}", { reason: value("reason") });
      case "chased": return value("promisedDate") ? t("chased it: {note} (new date {date})", { note: value("note"), date: format.day(value("promisedDate")) }) : t("chased it: {note}", { note: value("note") });
      case "alternate_offered": return t("recorded the supplier's alternative: {item} instead of {original}", { item: value("alternative"), original: value("item") });
      case "alternate_accepted": return t("took the supplier's alternative: {item}", { item: value("alternative") });
      case "alternate_rejected": return t("refused the supplier's alternative: {note}", { note: value("note") });
      case "continued_on_hold": return t("let it continue while the supplier is on hold: {note}", { note: value("note") });
      case "hold_override": return t("let it go ahead while its project is on hold: {reason}", { reason: value("reason") });
      case "funds_override": return t("let it go ahead beyond the money in hand: {reason}", { reason: value("reason") });
      case "funds_asked": return t("asked to go ahead beyond the money in hand");
      case "over_funds": return t("placed it beyond the money in hand");
      case "shipment_added": case "shipment_updated": {
        const status = labels.shipment[value("status") as keyof typeof labels.shipment] ?? value("status");
        const what = [value("carrier"), value("trackingRef")].filter(Boolean).join(" ");
        return [what ? t("followed shipment {reference}: {status}", { reference: what, status }) : t("followed the shipment: {status}", { status }),
          value("eta") ? t("expected {date}", { date: format.day(value("eta")) }) : ""].filter(Boolean).join(", ");
      }
      case "line_cancelled": return t("cancelled {quantity} of {item}: {reason}", { quantity: `${quantityText(value("quantity"))} ${value("unit")}`.trim(), item: value("description"), reason: value("reason") });
      case "received": return t("received delivery {number} at {place}", { number: String(detail.receipt ?? ""), place: value("location") });
      case "inspected": return t("inspected delivery {number}", { number: String(detail.receipt ?? "") });
      case "closed": return value("reason") ? t("closed it: {reason}", { reason: value("reason") }) : t("closed it");
      case "receipt_reversed": return t("reversed delivery {number}: {reason}", { number: String(detail.receipt ?? ""), reason: value("reason") });
      case "return_raised": return detail.outcome === "credit" ? t("raised return {number} for a credit", { number: String(detail.return ?? "") })
        : t("raised return {number} to be replaced", { number: String(detail.return ?? "") });
      case "return_emailed": return t("emailed the return note to {email}", { email: value("to") });
      case "return_email_not_sent": return t("couldn't email the return note to {email}", { email: value("to") });
      case "return_sent": return t("recorded the supplier collecting return {number}", { number: String(detail.return ?? "") });
      case "return_cancelled": return t("cancelled return {number}: {reason}", { number: String(detail.return ?? ""), reason: value("reason") });
      default: return t("changed it");
    }
  };
  const items: ActivityItem[] = [...state.events].reverse().map((entry) => ({ id: entry.id, actor: entry.byName ?? t("Someone"), action: text(entry.kind, entry.detail), occurredAt: format.when(entry.at), kind: "change" }));
  return <ActivityFeed items={items} />;
}
