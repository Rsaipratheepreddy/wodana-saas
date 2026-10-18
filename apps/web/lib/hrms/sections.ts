/**
 * The tabs of People, one thing each: my attendance (the default, at /workspace/hrms), my hours, my leave,
 * documents, my team, everyone's HR record, the crews without logins and the month's payroll.
 */
export const HRMS_SECTIONS = ["attendance", "time", "leave", "documents", "team", "people", "crews", "payroll"] as const;
export type HrmsSection = (typeof HRMS_SECTIONS)[number];

/** Old addresses, each to where it lives now. */
export const MOVED_HRMS_PATHS: Record<string, string> = {
  attendance: "/workspace/hrms",
  "time-summary": "/workspace/hrms",
  "site-attendance": "/workspace/hrms",
  settings: "/workspace/settings/attendance",
  workplaces: "/workspace/settings/attendance?tab=workplaces",
  "leave-settings": "/workspace/settings/attendance?tab=leave-types",
};

/** A People tab's address, with what it opens. */
export function hrmsHref(section: HrmsSection, open: Record<string, string | null | undefined> = {}) {
  const query = new URLSearchParams(Object.entries(open).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return `/workspace/hrms${section === "attendance" ? "" : `/${section}`}${query.size ? `?${query}` : ""}`;
}

/** The tabs of Settings → Attendance & leave. */
export const HRMS_SETTINGS_TABS = ["calendars", "leave-types", "workplaces", "rules"] as const;
export type HrmsSettingsTab = (typeof HRMS_SETTINGS_TABS)[number];
