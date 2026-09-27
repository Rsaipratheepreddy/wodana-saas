"use client";

import { useMemo } from "react";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalSection } from "@/lib/client-portal/types";
import styles from "./portal.module.css";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

/** The words the portal uses for sections and states, in the client's language. */
export function usePortalLabels() {
  const t = useT();
  return useMemo(() => {
    const sections: Record<"home" | PortalSection, string> = {
      home: t("Home"), progress: t("Progress"), decisions: t("Decisions"), payments: t("Payments"), documents: t("Documents"), warranty: t("Warranty"), messages: t("Messages"),
    };
    const states: Record<string, [string, Tone]> = {
      issued: [t("Waiting for you"), "warning"], client_review: [t("Waiting for you"), "warning"], sent: [t("Waiting for you"), "warning"],
      awaiting_confirmation: [t("Waiting for you"), "warning"], awaiting_decision: [t("Waiting for you"), "warning"],
      accepted: [t("Accepted"), "success"], approved: [t("Approved"), "success"], signed_off: [t("Signed off"), "success"], confirmed: [t("Confirmed"), "success"],
      changes_requested: [t("Changes asked"), "info"], declined: [t("Declined"), "neutral"], rejected: [t("Declined"), "neutral"], refused: [t("Not accepted"), "info"],
      expired: [t("Expired"), "neutral"], superseded: [t("Replaced"), "neutral"], withdrawn: [t("Withdrawn"), "neutral"],
      paid: [t("Paid"), "success"], part_paid: [t("Part paid"), "info"], due: [t("Due"), "warning"], overdue: [t("Overdue"), "danger"], upcoming: [t("Upcoming"), "neutral"],
      credited: [t("Cancelled"), "neutral"],
      open: [t("Open"), "info"], under_review: [t("With the team"), "info"], resolved: [t("Done"), "success"],
      covered: [t("Covered"), "success"], not_covered: [t("Not covered"), "neutral"], chargeable: [t("Chargeable"), "warning"],
      done: [t("Done"), "success"], current: [t("Now"), "info"],
    };
    const projectStates: Record<string, string> = {
      planning: t("Planning"), active: t("In progress"), on_hold: t("On hold"), completed: t("Complete"), cancelled: t("Cancelled"),
    };
    return { sections, states, projectStates };
  }, [t]);
}

/** A one-word state with its tone. */
export function StateLabel({ state }: { state: string }) {
  const { states } = usePortalLabels();
  const [label, tone] = states[state] ?? [state, "neutral" as Tone];
  return <span className={styles.state} data-tone={tone}>{label}</span>;
}
