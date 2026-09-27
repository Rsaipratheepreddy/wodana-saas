"use client";

import type { AttendanceDay, WorkMode } from "@wodana/contracts";
import { Badge, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";

export type DayState = "checked_in" | "checked_out" | "missing_checkout" | "needs_review" | "on_leave" | "leave_requested" | "day_off" | "not_checked_in";

/** Where a person's day stands, most pressing first: still in, a forgotten check-out, a review, worked, leave, a day off. */
export function dayState(day: AttendanceDay): DayState {
  if (day.status === "missing_checkout") return "missing_checkout";
  if (day.status === "checked_in" || day.open) return "checked_in";
  if (day.status === "needs_review") return "needs_review";
  if (day.elapsedMinutes > 0 || day.status === "complete") return "checked_out";
  if (day.leaveDays > 0 || day.status === "on_leave") return "on_leave";
  if (day.leaveStatus === "pending") return "leave_requested";
  if (day.scheduled === false) return "day_off";
  return "not_checked_in";
}

const DAY_TONES: Record<DayState, StatusTone> = {
  checked_in: "success", checked_out: "neutral", missing_checkout: "danger", needs_review: "warning", on_leave: "info", leave_requested: "neutral", day_off: "neutral",
  not_checked_in: "neutral",
};

export function DayStatus({ state }: { state: DayState }) {
  const t = useT();
  const labels: Record<DayState, string> = {
    checked_in: t("Checked in"), checked_out: t("Checked out"), missing_checkout: t("Missing check-out"), needs_review: t("Needs review"), on_leave: t("On leave"),
    leave_requested: t("Leave requested"), day_off: t("Day off"), not_checked_in: t("Not checked in"),
  };
  return <Badge tone={DAY_TONES[state]}>{labels[state]}</Badge>;
}

const LEAVE_TONES: Record<string, StatusTone> = { pending: "warning", approved: "success", rejected: "danger", withdrawn: "neutral", cancellation_pending: "warning", cancelled: "neutral" };

export function LeaveStatus({ status }: { status: string }) {
  const t = useT();
  const labels: Record<string, string> = {
    pending: t("Pending"), approved: t("Approved"), rejected: t("Rejected"), withdrawn: t("Withdrawn"), cancellation_pending: t("Cancellation pending"), cancelled: t("Cancelled"),
  };
  return <Badge tone={LEAVE_TONES[status] ?? "neutral"}>{labels[status] ?? status}</Badge>;
}

export function ReviewStatus({ status }: { status: string }) {
  const t = useT();
  const labels: Record<string, string> = { pending: t("Pending"), approved: t("Approved"), rejected: t("Rejected") };
  return <Badge tone={status === "approved" ? "success" : status === "rejected" ? "danger" : "warning"}>{labels[status] ?? status}</Badge>;
}

/** Names for the ways of working, what an event or review is, where a capture was, and the evidence issues the server finds. */
export function useHrmsLabels() {
  const t = useT();
  const modes: Record<WorkMode, string> = { office: t("Office"), site: t("Site"), field: t("Field"), remote: t("Remote") };
  const events: Record<string, string> = { check_in: t("Check-in"), check_out: t("Check-out"), switch: t("Switched place") };
  const reviews: Record<string, string> = { exception: t("Attendance exception"), correction: t("Time correction"), missing_checkout: t("Missing check-out") };
  const locations: Record<string, string> = {
    inside: t("At the workplace"), outside: t("Outside the workplace"), uncertain: t("Location uncertain"), captured: t("Location captured"), missing: t("No location"),
  };
  const parts: Record<string, string> = { full: t("Full day"), first_half: t("First half"), second_half: t("Second half") };
  const issues: Record<string, string> = {
    "Photo was not captured": t("No photo"),
    "Photo capture was delayed": t("The photo was sent late"),
    "Device action was delayed; recorded time uses server receipt": t("Sent late; the time it arrived is recorded"),
    "Location missing": t("No location"),
    "Location outside": t("Outside the workplace"),
    "Location uncertain": t("Location uncertain"),
    "Workplace boundary is not configured": t("The workplace has no location set"),
    "Departure from the previous site is unverified": t("Leaving the last place isn't confirmed"),
    "Attendance overlaps approved leave": t("On approved leave"),
  };
  return {
    mode: (mode: string) => modes[mode as WorkMode] ?? mode,
    event: (kind: string) => events[kind] ?? kind,
    review: (kind: string) => reviews[kind] ?? kind,
    location: (status: string | null | undefined) => (status ? locations[status] ?? status : ""),
    part: (part: string) => parts[part] ?? part,
    issue: (issue: string) => issues[issue] ?? issue,
  };
}
