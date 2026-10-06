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
    const sections: Record<"overview" | PortalSection, string> = {
      overview: t("Overview"), progress: t("Progress"), moodboard: t("Moodboard"), decisions: t("Decisions"), payments: t("Payments"), documents: t("Documents"), warranty: t("Warranty"),
      messages: t("Messages"),
    };
    const states: Record<string, [string, Tone]> = {
      issued: [t("Waiting for you"), "warning"], client_review: [t("Waiting for you"), "warning"], sent: [t("Waiting for you"), "warning"],
      awaiting_confirmation: [t("Waiting for you"), "warning"], awaiting_decision: [t("Waiting for you"), "warning"],
      accepted: [t("Accepted"), "success"], approved: [t("Approved"), "success"], signed_off: [t("Signed off"), "success"], confirmed: [t("Confirmed"), "success"],
      changes_requested: [t("Changes asked"), "info"], declined: [t("Declined"), "neutral"], rejected: [t("Declined"), "neutral"], refused: [t("Not accepted"), "info"],
      expired: [t("Expired"), "neutral"], superseded: [t("Replaced"), "neutral"], withdrawn: [t("Withdrawn"), "neutral"],
      paid: [t("Paid"), "success"], part_paid: [t("Part paid"), "info"], due: [t("Due"), "warning"], overdue: [t("Overdue"), "danger"], upcoming: [t("Upcoming"), "neutral"],
      credited: [t("Cancelled"), "neutral"], received: [t("Received"), "success"], checking: [t("Being checked"), "info"],
      issue_to_triage: [t("With the team"), "info"], issue_accepted: [t("Being fixed"), "info"], issue_declined: [t("Not taken up"), "neutral"], issue_fixed: [t("Fixed"), "success"],
      open: [t("Open"), "info"], under_review: [t("With the team"), "info"], resolved: [t("Done"), "success"],
      covered: [t("Covered"), "success"], not_covered: [t("Not covered"), "neutral"], chargeable: [t("Chargeable"), "warning"],
      done: [t("Done"), "success"], current: [t("Now"), "info"],
      // Change requests, choices and presentations (P4).
      waiting: [t("Waiting for you"), "warning"], with_team: [t("With the team"), "info"], changed: [t("Changed"), "warning"], presented: [t("Waiting for you"), "warning"],
      chosen: [t("Chosen"), "success"], proposed: [t("Waiting for you"), "warning"],
    };
    const projectStates: Record<string, string> = {
      planning: t("Planning"), active: t("In progress"), on_hold: t("On hold"), completed: t("Completed"), cancelled: t("Cancelled"),
    };
    return { sections, states, projectStates };
  }, [t]);
}

const WAITING_STATES = new Set(["issued", "client_review", "sent", "awaiting_confirmation", "awaiting_decision"]);

/**
 * A one-word state with its tone. `canDecide` false on something still waiting means someone else decides it
 * (the named decision-maker), so it doesn't say "Waiting for you" to a person who has nothing to do.
 */
export function StateLabel({ state, canDecide }: { state: string; canDecide?: boolean }) {
  const t = useT();
  const { states } = usePortalLabels();
  const [label, tone] = canDecide === false && WAITING_STATES.has(state) ? [t("Waiting for a decision"), "info" as Tone] : states[state] ?? [state, "neutral" as Tone];
  return <span className={styles.state} data-tone={tone}>{label}</span>;
}
