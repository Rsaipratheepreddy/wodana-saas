"use client";

import { useMemo } from "react";
import { Badge } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ProductionStep, ProductionStepKind, ReleaseCheck, WorkOrderNext, WorkOrderStatus } from "@/lib/factory/types";

/** "WO-0007". */
export const orderNumber = (number: number) => `WO-${String(number).padStart(4, "0")}`;

export const WORK_ORDER_TONE: Record<WorkOrderStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  planned: "neutral", released: "info", in_production: "info", ready: "success", on_hold: "warning", cancelled: "danger", short_closed: "neutral",
};

/** The words of a work order's states, its next steps and its release checks. */
export function useFactoryLabels() {
  const t = useT();
  return useMemo(() => ({
    status: {
      planned: t("Planned"), released: t("Released"), in_production: t("In production"), ready: t("Ready"), on_hold: t("On hold"), cancelled: t("Cancelled"), short_closed: t("Closed short"),
    } satisfies Record<WorkOrderStatus, string>,
    /** The one next action, as the button says it. */
    next: {
      fix: t("Fix what's missing"), release: t("Release"), start: t("Start"), approve: t("Approve output"), check: t("Check quality"), report: t("Report output"),
      send: t("Send to site"), resume: t("Resume"), decide_drawing: t("Go on with the new drawing"),
    } satisfies Record<Exclude<WorkOrderNext, null>, string>,
    check: {
      running: t("Project running"), scope: t("Scope unchanged"), client_drawings: t("Client approved the drawings"), drawing: t("Drawing approved"), payment: t("Payment before production verified"), materials: t("Materials in"),
      schedule: t("Workcenter and dates"),
    } satisfies Record<ReleaseCheck["key"], string>,
    /** What's missing, in a few words, for a list. */
    blocked: {
      running: t("Project on hold"), scope: t("Scope changed"), client_drawings: t("Client hasn't approved the drawings"), drawing: t("Drawing not approved"), payment: t("Payment not in"), materials: t("Materials not in"),
      schedule: t("No workcenter or dates"),
    } satisfies Record<ReleaseCheck["key"], string>,
  }), [t]);
}

/** A work order's state as a word in its tone. */
export function WorkOrderStatusLabel({ status }: { status: WorkOrderStatus }) {
  const labels = useFactoryLabels();
  return <Badge tone={WORK_ORDER_TONE[status]}>{labels.status[status]}</Badge>;
}

/** PLM-063: a production step in the firm's own word, or the standard one; and its tone. */
export function useProductionStepLabel() {
  const t = useT();
  return useMemo(() => {
    const standard: Record<ProductionStepKind, string> = { scheduled: t("Scheduled"), in_production: t("In production"), quality_check: t("Quality check"), ready: t("Ready") };
    return (step: ProductionStep) => step.label || standard[step.kind];
  }, [t]);
}

export const PRODUCTION_TONE: Record<ProductionStepKind, "neutral" | "info" | "warning" | "success"> = { scheduled: "neutral", in_production: "info", quality_check: "warning", ready: "success" };
