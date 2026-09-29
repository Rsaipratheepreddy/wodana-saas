import type { PortalApi } from "@/lib/client-portal/client";
import type { PortalProject, PortalSection, PortalSite } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";

/** What opens in a dialog over the section: a decision, a thread, a board or idea, or a form. */
export type PortalTarget =
  | { kind: "quote" | "design" | "definition" | "materials" | "handover" | "request" | "site_access"; id: string }
  | { kind: "thread"; id: string }
  | { kind: "new-message" }
  | { kind: "claim"; areaId?: string | null }
  | { kind: "board" | "pin"; id: string }
  | { kind: "idea" }
  | { kind: "paid"; id: string }
  | { kind: "issue" }
  /** A question about one of the team's days (the report's id). */
  | { kind: "question"; id: string };

export type SectionProps = {
  project: PortalProject;
  site: PortalSite;
  api: PortalApi;
  format: PortalFormat;
  /** The tenant's today (YYYY-MM-DD). */
  today: string;
  open: (target: PortalTarget) => void;
  go: (section: "overview" | PortalSection) => void;
  reload: () => Promise<void>;
  /** A wide screen: the project's profile is in the side column (a narrow one shows it in the Overview). */
  wide?: boolean;
};
