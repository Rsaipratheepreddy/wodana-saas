import { roleAvatarPath, type AvatarRole } from "@wodana/contracts/brand";
import { tKey, type MessageKey } from "../i18n/keys";
import type { TourActor } from "./types";

/**
 * The people a tour follows. Each has a role name, the switch line shown when they take over, their brand role
 * avatar, a cursor colour (a design token, so dark mode and tenant themes follow) and the parts of the workspace
 * they work in: the demo-only "view as" presentation keeps those in focus and quietens the rest. Nothing here
 * changes a real permission.
 */
export type TourPersona = {
  id: TourActor;
  label: MessageKey;
  /** "Now as Finance": said on screen when this person takes over. */
  switchLine: MessageKey;
  avatar: AvatarRole;
  /** A colour token for the cursor and the name chip. */
  color: string;
  /** Sidebar destinations (`nav-<id>`) this person works in. Empty: the client, who never sees the staff workspace. */
  navigation: string[];
};

export const TOUR_PERSONAS: Record<TourActor, TourPersona> = {
  sales: { id: "sales", label: tKey("Sales"), switchLine: tKey("Now as Sales"), avatar: "sales", color: "var(--wd-color-module-sales)",
    navigation: ["home", "daily-follow-ups", "inbox", "sales", "clients", "planning"] },
  designer: { id: "designer", label: tKey("Designer"), switchLine: tKey("Now as the designer"), avatar: "designer", color: "var(--wd-color-viz-2)",
    navigation: ["home", "daily-follow-ups", "planning", "resources", "gallery"] },
  estimator: { id: "estimator", label: tKey("Estimator"), switchLine: tKey("Now as the estimator"), avatar: "estimator", color: "var(--wd-color-viz-4)",
    navigation: ["home", "planning", "resources", "purchasing"] },
  approver: { id: "approver", label: tKey("Manager"), switchLine: tKey("Now as the manager who approves"), avatar: "owner", color: "var(--wd-color-viz-5)",
    navigation: ["home", "sales", "planning", "projects", "finance"] },
  finance: { id: "finance", label: tKey("Finance"), switchLine: tKey("Now as Finance"), avatar: "finance", color: "var(--wd-color-viz-3)",
    navigation: ["home", "finance", "projects", "purchasing"] },
  buyer: { id: "buyer", label: tKey("Buyer"), switchLine: tKey("Now as the buyer"), avatar: "purchasing", color: "var(--wd-color-viz-6)",
    navigation: ["home", "purchasing", "inventory", "projects"] },
  factory: { id: "factory", label: tKey("Factory"), switchLine: tKey("Now as the factory"), avatar: "factory", color: "var(--wd-color-module-resources)",
    navigation: ["home", "factory", "inventory"] },
  site: { id: "site", label: tKey("Site supervisor"), switchLine: tKey("Now as the site supervisor"), avatar: "site_supervisor", color: "var(--wd-color-viz-1)",
    navigation: ["home", "daily-follow-ups", "projects"] },
  client: { id: "client", label: tKey("Client"), switchLine: tKey("Now as the client"), avatar: "client", color: "var(--wd-color-module-clients)",
    navigation: [] },
};

/** The brand role picture for a persona; seeded by the persona, so a demo always shows the same person. */
export function personaAvatar(persona: TourPersona): string {
  return roleAvatarPath(persona.avatar, `tour-${persona.id}`);
}

/** Whether a sidebar destination is part of this persona's work (`true` when no persona is shown). */
export function inPersonaView(actor: TourActor | null | undefined, destination: string): boolean {
  if (!actor) return true;
  return TOUR_PERSONAS[actor].navigation.includes(destination);
}
