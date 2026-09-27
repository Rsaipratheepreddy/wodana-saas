"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import type { WorkOrderStatus } from "@/lib/factory/types";
import styles from "./factory.module.css";

/** "WO-0007". */
export const orderNumber = (number: number) => `WO-${String(number).padStart(4, "0")}`;

/** A work order's state as a dot and a word. */
export function WorkOrderStatusLabel({ status }: { status: WorkOrderStatus }) {
  const t = useT();
  const labels: Record<WorkOrderStatus, string> = {
    planned: t("Planned"), released: t("Released"), in_production: t("In production"), ready: t("Ready"), on_hold: t("On hold"), cancelled: t("Cancelled"), short_closed: t("Closed short"),
  };
  const tone = status === "ready" ? "success" : status === "in_production" || status === "released" ? "info" : status === "on_hold" ? "warning" : status === "cancelled" ? "danger" : "neutral";
  return <span className={styles.status} data-tone={tone}>{labels[status]}</span>;
}
