import type { ReactNode } from "react";

export type ModuleIconTone = "home" | "projects" | "clients" | "sales" | "calendar" | "resources" | "team" | "planning" | "activity" | "integrations" | "settings" | "follow-ups";

/** Token-driven icon tile used by navigation and compact product summaries. */
export function ModuleIcon({ children, className, tone }: { children: ReactNode; className?: string; tone?: ModuleIconTone }) {
  return <span aria-hidden="true" className={["wd-module-icon", className].filter(Boolean).join(" ")} data-tone={tone}>{children}</span>;
}
