import "server-only";

import { existsSync } from "node:fs";
import { join } from "node:path";
import { tKey, type MessageKey } from "@/lib/i18n/keys";

/**
 * Product screenshots on the public pages (public/landing): real screens of a demo workspace, each in the
 * light theme and, when captured, the dark one (`<name>-dark.webp`). The pixel size is known so nothing shifts.
 */
export type Shot = { src: string; dark: string; width: number; height: number; alt: MessageKey };

const desktop = (name: string, alt: MessageKey): Shot =>
  ({ src: `/landing/${name}.webp`, dark: `/landing/${name}-dark.webp`, width: 2880, height: 1800, alt });
const phone = (name: string, alt: MessageKey): Shot =>
  ({ src: `/landing/${name}.webp`, dark: `/landing/${name}-dark.webp`, width: 1170, height: 2532, alt });

export const SHOTS = {
  home: desktop("home", tKey("Wodana home with the day's work across sales and projects")),
  pipeline: desktop("pipeline", tKey("Enquiries on a sales board, by stage")),
  quotation: desktop("quotation", tKey("A priced quotation with rooms and items")),
  plan: desktop("project-plan", tKey("A project plan with tasks on a timeline")),
  purchasing: desktop("purchasing", tKey("Purchase orders with suppliers and delivery")),
  factory: desktop("factory", tKey("Factory work orders by project")),
  portal: desktop("client-portal", tKey("The client portal for one project")),
  mobileTasks: phone("mobile-tasks", tKey("The mobile app: today's tasks")),
  mobileReport: phone("mobile-daily-report", tKey("The mobile app: daily site report")),
  mobileMe: phone("mobile-me", tKey("The mobile app: profile and attendance")),
} satisfies Record<string, Shot>;

const present = new Map<string, boolean>();
const exists = (src: string) => {
  if (!present.has(src)) present.set(src, existsSync(join(process.cwd(), "public", src)));
  return present.get(src) === true;
};

/** A screenshot shows only once its file is in public/landing, so the page never shows a broken image. */
export function shotReady(shot: Shot) {
  return exists(shot.src);
}

/** The dark variant, when it was captured. */
export function darkReady(shot: Shot) {
  return exists(shot.dark);
}
