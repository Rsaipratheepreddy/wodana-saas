import type { Outlook, PhotoPhase, Safety, Severity, SiteReport, SiteState } from '../../../../web/lib/site/types';

/** A daily report being written on the phone. Pure: shared by the screen and its tests. */
export type Installed = { boqLineId: string; installed: string; note: string };
export type Crew = { trade: string; people: number; hours?: number | null };
/** An issue or blocker: how serious, what, whether the client may read it, who owns it by when, and what to raise from it. */
export type Issue = { id: string; severity: Severity; description: string; internal: boolean; raise?: 'snag' | 'material' | 'change_request' | null;
  ownerId?: string | null; dueOn?: string | null };
export type PhotoTags = { areaId: string | null; phase: PhotoPhase | null; pairId: string | null };
/** A material received on site or used that day; `delivery` is "order:<id>" or "transfer:<id>" when it came on one. */
export type Material = { direction: 'received' | 'used'; description: string; quantity: string; unit: string; delivery: string };
export type Draft = {
  weather: string; safety: Safety; safetyNote: string; forecast: Outlook; impact: string; recoveryOwnerId: string | null; recoveryOn: string;
  noWork: boolean; noWorkReason: string; notes: string; workforce: Crew[]; lines: Installed[];
  /** Today's planned work and how far each got (0–100; "Started" is 10). */
  tasks: Record<string, { progress: number; note: string }>;
  /** Tomorrow's plan: the plan's work, or a line of text. */
  next: Array<{ workItemId: string | null; title: string }>;
  issues: Issue[];
  materials: Material[];
  /** Each photo's room, before/after and the photo it pairs with. */
  photos: Record<string, PhotoTags>;
};

/** The quick steps for a task's progress; "Started" is recorded as 10. */
export const STEPS = [10, 25, 50, 75, 100] as const;
/** The step a recorded progress reads as (a 30 set on the plan reads as 25). */
export const stepOf = (progress: number) => (progress >= 100 ? 100 : [...STEPS].reverse().find((step) => step <= progress) ?? 10);

export const empty = (): Draft => ({ weather: '', safety: 'none', safetyNote: '', forecast: 'none', impact: '', recoveryOwnerId: null, recoveryOn: '', noWork: false, noWorkReason: '', notes: '',
  workforce: [], lines: [], tasks: {}, next: [], issues: [], materials: [], photos: {} });

/** A new day starts from the plan: yesterday's crew, and tomorrow's work from the plan. */
export const fromPlan = (state: Pick<SiteState, 'crew' | 'plan'>): Draft => ({
  ...empty(),
  workforce: (state.crew ?? []).map((row) => ({ trade: row.trade, people: row.people, hours: row.hours ? Number(row.hours) : null })),
  next: (state.plan?.tomorrow.tasks ?? []).map((task) => ({ workItemId: task.id, title: task.title })),
});

export const fromReport = (report: SiteReport): Draft => ({
  weather: report.weather, safety: report.safety, safetyNote: report.safetyNote, forecast: report.forecast, impact: report.impact, recoveryOwnerId: report.recoveryOwnerId,
  recoveryOn: report.recoveryOn ?? '', noWork: !!report.noWorkReason, noWorkReason: report.noWorkReason, notes: report.notes,
  workforce: report.workforce.map((row) => ({ trade: row.trade, people: row.people, hours: row.hours ? Number(row.hours) : null })),
  lines: report.lines.map((line) => ({ boqLineId: line.boqLineId, installed: line.installed, note: line.note })),
  tasks: Object.fromEntries((report.tasks ?? []).map((task) => [task.workItemId, { progress: task.progress, note: task.note }])),
  next: (report.next ?? []).map((item) => ({ workItemId: item.workItemId, title: item.title })),
  issues: (report.issues ?? []).map((issue) => ({ id: issue.id, severity: issue.severity, description: issue.description, internal: issue.internal, raise: null,
    ownerId: issue.ownerId ?? null, dueOn: issue.dueOn ?? null })),
  materials: (report.materials ?? []).map((item) => ({ direction: item.direction, description: item.description, quantity: item.quantity ? String(Number(item.quantity)) : '', unit: item.unit,
    delivery: item.purchaseOrderId ? `order:${item.purchaseOrderId}` : item.stockTransferId ? `transfer:${item.stockTransferId}` : '' })),
  photos: Object.fromEntries(report.photos.map((photo) => [photo.id, { areaId: photo.areaId ?? null, phase: photo.phase ?? null, pairId: photo.pairId ?? null }])),
});

/** Sets a task's progress; finished today, it leaves tomorrow's plan. */
export function chooseProgress(draft: Draft, workItemId: string, progress: number | null): Draft {
  const tasks = { ...draft.tasks };
  if (progress === null) delete tasks[workItemId];
  else tasks[workItemId] = { progress, note: tasks[workItemId]?.note ?? '' };
  return { ...draft, tasks, next: progress === 100 ? draft.next.filter((item) => item.workItemId !== workItemId) : draft.next };
}

/** Pairs two photos (both ways, the other taking the opposite phase and the same room), or unpairs one. */
export function tagPhoto(draft: Draft, id: string, patch: Partial<PhotoTags>): Draft {
  const none: PhotoTags = { areaId: null, phase: null, pairId: null };
  const photos = { ...draft.photos, [id]: { ...none, ...draft.photos[id], ...patch } };
  if (patch.pairId !== undefined) {
    for (const [other, tags] of Object.entries(photos)) if (other !== id && tags.pairId === id) photos[other] = { ...tags, pairId: null };
    if (patch.pairId) {
      const mine = photos[id];
      const theirs = photos[patch.pairId] ?? { areaId: null, phase: null, pairId: null };
      photos[patch.pairId] = { areaId: theirs.areaId ?? mine.areaId, phase: theirs.phase ?? (mine.phase === 'before' ? 'after' : mine.phase === 'after' ? 'before' : null), pairId: id };
    }
  }
  return { ...draft, photos };
}

/** What the server saves (a part still being filled in stays on the phone until it's complete). */
export function reportBody(draft: Draft, reportDate: string) {
  return {
    reportDate, weather: draft.weather.trim().slice(0, 120), safety: draft.safety, safetyNote: draft.safety === 'none' ? '' : draft.safetyNote.trim(),
    forecast: draft.forecast, impact: draft.forecast === 'none' ? '' : draft.impact.trim(),
    ...(draft.forecast !== 'none' ? { recoveryOwnerId: draft.recoveryOwnerId, recoveryOn: draft.recoveryOn } : {}),
    noWorkReason: draft.noWork ? draft.noWorkReason.trim() : '', notes: draft.notes.trim(),
    workforce: draft.workforce.filter((entry) => entry.trade.trim() && entry.people > 0).map((entry) => ({ trade: entry.trade, people: entry.people, hours: entry.hours ?? null })),
    lines: draft.lines.map((line) => ({ boqLineId: line.boqLineId, installed: line.installed, note: line.note.trim() })),
    tasks: Object.entries(draft.tasks).map(([workItemId, entry]) => ({ workItemId, progress: entry.progress, note: entry.note.trim() })),
    next: draft.next.filter((item) => item.title.trim()).map((item) => ({ workItemId: item.workItemId, title: item.title.trim() })),
    issues: draft.issues.filter((issue) => issue.description.trim()).map((issue) => ({ id: issue.id, severity: issue.severity, description: issue.description.trim(), internal: issue.internal,
      ownerId: issue.ownerId ?? null, dueOn: issue.dueOn || null })),
    materials: (draft.materials ?? []).filter((item) => item.description.trim()).map((item) => ({ direction: item.direction, description: item.description.trim(), quantity: item.quantity || null,
      unit: item.unit.trim(), purchaseOrderId: item.delivery.startsWith('order:') ? item.delivery.slice(6) : null, stockTransferId: item.delivery.startsWith('transfer:') ? item.delivery.slice(9) : null })),
    photos: Object.entries(draft.photos).map(([id, tags]) => ({ id, ...tags })),
  };
}

/** What's wrong with a report before it can be sent (the server's rules, checked on the phone). */
export function reportProblems(draft: Draft, photos: number, submit: boolean, t: (text: string) => string) {
  const problems: string[] = [];
  if (draft.safety !== 'none' && !draft.safetyNote.trim()) problems.push(t('Say what happened on safety.'));
  if (draft.forecast !== 'none' && (!draft.impact.trim() || !draft.recoveryOwnerId || !draft.recoveryOn)) problems.push(t('An outlook at risk needs what, who recovers it and by when.'));
  if (draft.lines.some((line) => !Number(line.installed))) problems.push(t('Enter a quantity for each installed line.'));
  if (draft.lines.some((line) => Number(line.installed) < 0 && !line.note.trim())) problems.push(t('A correction needs a note.'));
  if (draft.issues.some((issue) => !issue.description.trim())) problems.push(t('Say what each issue is.'));
  if (submit && !photos && !(draft.noWork && draft.noWorkReason.trim())) problems.push(t('Add a photo, or say why no work was done.'));
  return problems;
}
