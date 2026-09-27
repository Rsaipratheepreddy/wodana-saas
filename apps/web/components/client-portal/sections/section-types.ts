import type { PortalApi } from "@/lib/client-portal/client";
import type { PortalProject, PortalSection, PortalSite } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";

/** What opens in a dialog over the section: a decision, a thread, a form. */
export type PortalTarget =
  | { kind: "quote" | "design" | "definition" | "materials" | "handover" | "request"; id: string }
  | { kind: "thread"; id: string }
  | { kind: "new-message" }
  | { kind: "claim" };

export type SectionProps = {
  project: PortalProject;
  site: PortalSite;
  api: PortalApi;
  format: PortalFormat;
  open: (target: PortalTarget) => void;
  go: (section: "home" | PortalSection) => void;
};
