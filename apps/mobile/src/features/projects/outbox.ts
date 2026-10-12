import type { SiteState } from '../../../../web/lib/site/types';
import { ApiError } from '../../core/api';
import { registerOutboxHandler } from '../../core/outbox';
import { projectKeys } from './api';
import { sendChange } from './change-outbox';
import { sendSiteReport } from './report-outbox';
export type { ChangePayload } from './change-outbox';

/** A snag raised on site: created with its own id, then its "before" photos (each photo id sent once). */
export type SnagPayload = { projectId: string; create: Record<string, unknown>; photoIds: string[] };
/** Photos added to an existing snag (before or after). */
export type WorkPhotosPayload = { projectId: string; itemId: string; kind: 'before' | 'after'; photoIds: string[] };
export type { ReportPayload } from './report-outbox';

const uploadAll = async (ids: string[], done: number, step: (n: number) => void, send: (id: string, index: number) => Promise<unknown>) => {
  for (let index = done; index < ids.length; index += 1) {
    await send(ids[index], index);
    step(index + 1);
  }
};

registerOutboxHandler('project.snag', async ({ api, item, withFile, step }) => {
  const payload = item.payload as unknown as SnagPayload;
  const base = `project-core/projects/${payload.projectId}/work`;
  if (item.step < 1) { await api.send(base, 'POST', { action: 'create', ...payload.create }); step(1); }
  const itemId = String(payload.create.id);
  await uploadAll(payload.photoIds, Math.max(0, item.step - 1), (n) => step(n + 1), (photoId) =>
    withFile(photoId, (file) => api.upload(`${base}/${itemId}/photos/${photoId}?kind=before`, 'POST', 'file', file)));
  return [projectKeys.board(api.workspaceId, payload.projectId), ['projects', api.workspaceId, 'open-work']];
});

registerOutboxHandler('project.change', sendChange);

registerOutboxHandler('project.work-photos', async ({ api, item, withFile, step }) => {
  const payload = item.payload as unknown as WorkPhotosPayload;
  const base = `project-core/projects/${payload.projectId}/work/${payload.itemId}`;
  await uploadAll(payload.photoIds, item.step, step, (photoId) =>
    withFile(photoId, (file) => api.upload(`${base}/photos/${photoId}?kind=${payload.kind}`, 'POST', 'file', file)));
  return [projectKeys.board(api.workspaceId, payload.projectId), projectKeys.item(api.workspaceId, payload.projectId, payload.itemId)];
});

/** The daily report (report-outbox.ts): safe to repeat, and an offline duplicate of the day goes into my report for it. */
registerOutboxHandler('site.report', sendSiteReport);

/** Site photos from the capture flow, added to my report for today (started if there isn't one yet). */
export type ReportPhotosPayload = { projectId: string; newReportId: string; photoIds: string[] };

registerOutboxHandler('site.report-photos', async ({ api, item, withFile }) => {
  const payload = item.payload as unknown as ReportPhotosPayload;
  const base = `site/projects/${payload.projectId}`;
  let state = await api.get<SiteState>(base);
  let report = state.reports.find((entry) => entry.authorId === state.me && entry.reportDate === state.today);
  if (report && report.status !== 'draft' && report.status !== 'returned') {
    throw new ApiError('Today’s report is already sent. Add these photos to a snag or tomorrow’s report.', 409);
  }
  if (!report) {
    state = await api.send<SiteState>(base, 'POST', { action: 'save_report', id: payload.newReportId, reportDate: state.today, workforce: [], lines: [] });
    report = state.reports.find((entry) => entry.id === payload.newReportId);
  }
  if (!report) throw new ApiError('The report could not be started.', 409);
  const have = new Set(report.photos.map((photo) => photo.id));
  for (const photoId of payload.photoIds) {
    if (have.has(photoId)) continue;
    try { await withFile(photoId, (file) => api.upload(`${base}/reports/${report!.id}/photos/${photoId}`, 'POST', 'file', file)); }
    catch (error) { if (!(error instanceof ApiError && error.status === 409)) throw error; }
  }
  return [projectKeys.site(api.workspaceId, payload.projectId)];
});
