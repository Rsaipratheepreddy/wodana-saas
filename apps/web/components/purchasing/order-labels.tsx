"use client";

import { useMemo } from "react";
import { useT } from "@/lib/i18n/i18n-provider";
import type { DeliverTo, OrderStatus, RejectKind } from "@/lib/purchasing/types";
import styles from "./purchasing.module.css";

/** "12.0000" → "12": a stored quantity as people write it. */
export const quantityText = (value: string | null) => (value === null ? "" : value.includes(".") ? value.replace(/\.?0+$/, "") : value);

export const OPEN_ORDERS: OrderStatus[] = ["draft", "pending_approval", "approved", "sent", "confirmed", "partly_received", "received"];

export function useOrderLabels() {
  const t = useT();
  return useMemo(() => ({
    status: { draft: t("Draft"), pending_approval: t("Waiting for approval"), approved: t("Approved"), sent: t("Sent"), confirmed: t("Confirmed"), partly_received: t("Partly received"), received: t("Received"), closed: t("Closed"), cancelled: t("Cancelled") } satisfies Record<OrderStatus, string>,
    deliverTo: { site: t("Project site"), factory: t("Our factory"), warehouse: t("Our warehouse"), pickup: t("We collect"), other: t("Another address") } satisfies Record<DeliverTo, string>,
    rejectKind: { damaged: t("Damaged"), defective: t("Defective"), wrong_item: t("Wrong item"), wrong_spec: t("Not to spec (colour, finish, size)"), other: t("Other") } satisfies Record<RejectKind, string>,
  }), [t]);
}

/** An order's status as a dot and a word. */
export function OrderStatusLabel({ status }: { status: OrderStatus }) {
  const labels = useOrderLabels();
  return <span className={styles.orderStatus} data-status={status}>{labels.status[status]}</span>;
}
