import type { CardPhoto, ClientView, ProgressPrintData } from "./types";

/** A photo as printed: where it was taken and its before/after, nothing else. */
export function printPhoto(photo: CardPhoto): CardPhoto {
  return { id: photo.id, area: photo.area ?? null, phase: photo.phase ?? null, pairId: photo.pairId ?? null };
}

/** The printed day from the client's card (as it went, or as it would go): named fields only. */
export function clientViewPrint(view: ClientView): ProgressPrintData {
  const { project } = view;
  return {
    brand: { name: view.brand.name, logoUrl: view.brand.logoUrl },
    project: { name: project.name, reference: project.reference },
    date: view.date,
    stage: project.stageNumber && project.stageCount ? { number: project.stageNumber, total: project.stageCount, name: project.stage } : null,
    percent: project.progress,
    summary: view.summary, noWork: view.noWork,
    photos: [view.hero, ...view.photos].filter((photo): photo is CardPhoto => Boolean(photo)).map(printPhoto),
    completed: [...view.completed], advanced: view.advanced.map((item) => ({ title: item.title, progress: item.progress })), next: [...view.next], notes: [...view.notes],
  };
}
