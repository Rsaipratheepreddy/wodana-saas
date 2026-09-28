import "server-only";

import { existsSync } from "node:fs";
import { join } from "node:path";
import { tKey, type MessageKey } from "@/lib/i18n/keys";

/** Product screenshots on the landing page (public/landing), with their pixel size so nothing shifts. */
export type Shot = { src: string; width: number; height: number; alt: MessageKey };

const desktop = (name: string, alt: MessageKey, height = 1500): Shot => ({ src: `/landing/${name}.webp`, width: 2400, height, alt });
const phone = (name: string, alt: MessageKey): Shot => ({ src: `/landing/${name}.webp`, width: 1170, height: 2532, alt });

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

const ready = new Set<string>();

/** A screenshot shows only once its file is in public/landing, so the page never shows a broken image. */
export function shotReady(shot: Shot) {
  if (!ready.has(shot.src) && existsSync(join(process.cwd(), "public", shot.src))) ready.add(shot.src);
  return ready.has(shot.src);
}
