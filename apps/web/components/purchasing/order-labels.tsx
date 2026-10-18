"use client";

import { useMemo } from "react";
import { Badge } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { DeliverTo, LineStatus, OrderStatus, RejectKind, ShipmentStatus } from "@/lib/purchasing/types";

/** "12.0000" → "12": a stored quantity as people write it. */
export const quantityText = (value: string | null) => (value === null ? "" : value.includes(".") ? value.replace(/\.?0+$/, "") : value);
/** A decimal kept as text, handed to a number field ("" is an empty field). */
export const fieldNumber = (text: string) => (text === "" ? Number.NaN : Number(text));
/** What a number field gives back, as the text the form keeps ("" when it's emptied). */
export const fieldText = (value: number) => (Number.isFinite(value) ? String(value) : "");

export const OPEN_ORDERS: OrderStatus[] = ["draft", "pending_approval", "approved", "sent", "confirmed", "partly_received", "received"];

export function useOrderLabels() {
  const t = useT();
  return useMemo(() => ({
    status: { draft: t("Draft"), pending_approval: t("Waiting for approval"), approved: t("Approved"), sent: t("Sent"), confirmed: t("Confirmed"), partly_received: t("Partly received"), received: t("Received"), closed: t("Closed"), cancelled: t("Cancelled") } satisfies Record<OrderStatus, string>,
    deliverTo: { site: t("Project site"), factory: t("Our factory"), warehouse: t("Our warehouse"), pickup: t("We collect"), other: t("Another address") } satisfies Record<DeliverTo, string>,
    rejectKind: { damaged: t("Damaged"), defective: t("Defective"), wrong_item: t("Wrong item"), wrong_spec: t("Not to spec (colour, finish, size)"), other: t("Other") } satisfies Record<RejectKind, string>,
    shipment: { booked: t("Booked"), in_transit: t("In transit"), delayed: t("Delayed"), arrived: t("Arrived"), cancelled: t("Cancelled") } satisfies Record<ShipmentStatus, string>,
    line: { required: t("Required"), ordered: t("Ordered"), received: t("Received"), installed: t("Installed") } satisfies Record<LineStatus, string>,
  }), [t]);
}

/** The tone each order status reads in: waiting on someone (warning), moving (info), done (success), called off (danger). */
export const ORDER_TONE: Record<OrderStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral", pending_approval: "warning", approved: "info", sent: "info", confirmed: "info", partly_received: "info", received: "success", closed: "neutral", cancelled: "danger",
};

/** An order's status as a word in its tone. */
export function OrderStatusLabel({ status }: { status: OrderStatus }) {
  const labels = useOrderLabels();
  return <Badge tone={ORDER_TONE[status]}>{labels.status[status]}</Badge>;
}

/** A material line's status reads waiting (required), moving (ordered), in (received) and done (installed). */
export const LINE_TONE: Record<LineStatus, "neutral" | "info" | "warning" | "success" | "danger"> = { required: "warning", ordered: "info", received: "success", installed: "neutral" };

/** A material line's status as a word in its tone. */
export function LineStatusLabel({ status }: { status: LineStatus }) {
  const labels = useOrderLabels();
  return <Badge tone={LINE_TONE[status]}>{labels.line[status]}</Badge>;
}
