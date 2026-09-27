"use client";

import { useMemo } from "react";
import { CircleAlert, CircleCheck, CircleDashed, CircleDot, CircleSlash, CircleUser, Hammer, OctagonAlert, SquareCheck, type LucideIcon } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Severity, SnagSource, WorkPriority, WorkStatus, WorkType } from "@/lib/project-core/types";
import styles from "./work.module.css";

export const BOARD_STATUSES: WorkStatus[] = ["todo", "in_progress", "in_review", "done"];
export const ALL_STATUSES: WorkStatus[] = [...BOARD_STATUSES, "cancelled"];
export const PRIORITIES: WorkPriority[] = ["urgent", "high", "normal", "low"];
export const isOpen = (status: WorkStatus) => status !== "done" && status !== "cancelled";

const TYPE_ICONS: Record<WorkType, LucideIcon> = { task: SquareCheck, blocker: OctagonAlert, client_request: CircleUser, snag: Hammer };
const STATUS_ICONS: Record<WorkStatus, LucideIcon> = { todo: CircleDashed, in_progress: CircleDot, in_review: CircleAlert, done: CircleCheck, cancelled: CircleSlash };

/** The words for work types, statuses and priorities. */
export function useWorkLabels() {
  const t = useT();
  return useMemo(() => ({
    type: { task: t("Task"), blocker: t("Blocker"), client_request: t("Client request"), snag: t("Snag") } satisfies Record<WorkType, string>,
    status: { todo: t("To do"), in_progress: t("In progress"), in_review: t("In review"), done: t("Done"), cancelled: t("Cancelled") } satisfies Record<WorkStatus, string>,
    priority: { urgent: t("Urgent"), high: t("High"), normal: t("Normal"), low: t("Low") } satisfies Record<WorkPriority, string>,
    severity: { minor: t("Minor"), major: t("Major"), critical: t("Critical") } satisfies Record<Severity, string>,
    source: { internal: t("Found by the team"), inspection: t("Inspection"), delivery: t("Delivery"), client: t("Client"), warranty: t("Warranty") } satisfies Record<SnagSource, string>,
  }), [t]);
}

export function TypeIcon({ type, label }: { type: WorkType; label?: string }) {
  const Icon = TYPE_ICONS[type];
  return <Icon className={styles.typeIcon} data-type={type} size={14} aria-hidden={label ? undefined : true} aria-label={label} role={label ? "img" : undefined} />;
}

export function StatusIcon({ status }: { status: WorkStatus }) {
  const Icon = STATUS_ICONS[status];
  return <Icon className={styles.statusIcon} data-status={status} size={14} aria-hidden="true" />;
}

/** A status with its icon, as one label. */
export function StatusLabel({ status }: { status: WorkStatus }) {
  const labels = useWorkLabels();
  return <span className={styles.statusLabel}><StatusIcon status={status} />{labels.status[status]}</span>;
}
