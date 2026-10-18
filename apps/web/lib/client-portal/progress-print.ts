import { printPhoto } from "@/lib/site/progress-print";
import type { CardPhoto, ProgressPrintData } from "@/lib/site/types";
import type { PortalSite, PortalView } from "./types";

const brandOf = (site: PortalSite) => ({ name: site.brand.name, logoUrl: site.brand.logoUrl });
const projectOf = (project: PortalView["projects"][number]) => ({ name: project.title, reference: project.reference });

/**
 * A day the team sent, from the client's own portal view (already only what the client may read), printed field
 * by field: the tenant's brand, the project, the day's stage and percent, the words, the lists and the photos.
 */
export function portalDayPrint(view: PortalView, site: PortalSite, reportId: string): ProgressPrintData | null {
  for (const project of view.projects) {
    const card = project.progress?.cards?.find((item) => item.id === reportId);
    if (!card) continue;
    return {
      brand: brandOf(site), project: projectOf(project), date: card.date,
      stage: card.stage ? { number: card.stage.number, total: card.stage.total, name: card.stage.name } : null,
      percent: card.percent ?? null,
      summary: card.summary, noWork: card.noWork,
      photos: [card.hero, ...card.photos].filter((photo): photo is CardPhoto => Boolean(photo)).map(printPhoto),
      completed: [...card.completed], advanced: card.advanced.map((item) => ({ title: item.title, progress: item.progress })), next: [...card.next], notes: [...card.notes],
    };
  }
  return null;
}

/** A week's roll-up from the client's portal view: the brand, the project, the week's last day and its digest. */
export function portalWeekPrint(view: PortalView, site: PortalSite, weekId: string): ProgressPrintData | null {
  for (const project of view.projects) {
    const week = project.progress?.weeks?.find((item) => item.id === weekId);
    if (!week) continue;
    return { brand: brandOf(site), project: projectOf(project), date: week.weekEnding, stage: null, percent: null, summary: week.digest, noWork: false,
      photos: [], completed: [], advanced: [], next: [], notes: [] };
  }
  return null;
}

/** The client's print pages of a day and of a week. */
export const portalDayPrintHref = (slug: string, reportId: string) => `/portal/${encodeURIComponent(slug)}/print/daily/${encodeURIComponent(reportId)}`;
export const portalWeekPrintHref = (slug: string, weekId: string) => `/portal/${encodeURIComponent(slug)}/print/week/${encodeURIComponent(weekId)}`;
