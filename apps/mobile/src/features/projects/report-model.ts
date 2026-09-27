import type { Outlook, Safety, SiteReport } from '../../../../web/lib/site/types';

/** A daily report being written on the phone. Pure: shared by the screen and its tests. */
export type Installed = { boqLineId: string; installed: string; note: string };
export type Draft = {
  weather: string; safety: Safety; safetyNote: string; forecast: Outlook; impact: string; recoveryOwnerId: string | null; recoveryOn: string;
  noWork: boolean; noWorkReason: string; notes: string; workforce: Array<{ trade: string; people: number }>; lines: Installed[];
};
export const empty = (): Draft => ({ weather: '', safety: 'none', safetyNote: '', forecast: 'none', impact: '', recoveryOwnerId: null, recoveryOn: '', noWork: false, noWorkReason: '', notes: '', workforce: [], lines: [] });
export const fromReport = (report: SiteReport): Draft => ({
  weather: report.weather, safety: report.safety, safetyNote: report.safetyNote, forecast: report.forecast, impact: report.impact, recoveryOwnerId: report.recoveryOwnerId,
  recoveryOn: report.recoveryOn ?? '', noWork: !!report.noWorkReason, noWorkReason: report.noWorkReason, notes: report.notes, workforce: report.workforce,
  lines: report.lines.map((line) => ({ boqLineId: line.boqLineId, installed: line.installed, note: line.note })),
});

/** What's wrong with a report before it can be sent (the server's rules, checked on the phone). */
export function reportProblems(draft: Draft, photos: number, submit: boolean, t: (text: string) => string) {
  const problems: string[] = [];
  if (draft.safety !== 'none' && !draft.safetyNote.trim()) problems.push(t('Say what happened on safety.'));
  if (draft.forecast !== 'none' && (!draft.impact.trim() || !draft.recoveryOwnerId || !draft.recoveryOn)) problems.push(t('An outlook at risk needs what, who recovers it and by when.'));
  if (draft.lines.some((line) => !Number(line.installed))) problems.push(t('Enter a quantity for each installed line.'));
  if (draft.lines.some((line) => Number(line.installed) < 0 && !line.note.trim())) problems.push(t('A correction needs a note.'));
  if (submit && !photos && !(draft.noWork && draft.noWorkReason.trim())) problems.push(t('Add a photo, or say why no work was done.'));
  return problems;
}

