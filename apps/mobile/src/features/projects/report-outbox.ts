import type { SiteState } from '../../../../web/lib/site/types';
import { ApiError } from '../../auth/client';
import type { OutboxHandler } from '../../core/outbox-send';

/**
 * A daily site report: the whole report, its new photos (with their room, before/after and pair), the snags, change
 * requests and material requests to raise from its issues, and whether to submit it.
 */
export type ReportPayload = {
  projectId: string; reportId: string; report: Record<string, unknown>; photoIds: string[]; submit: boolean;
  photoTags?: Record<string, { areaId: string | null; phase: string | null; pairId: string | null }>;
  raise?: Array<{ issueId: string; kind: 'snag' | 'material' | 'change_request' }>;
};

/** A photo's tags as the upload's query (only what's set). */
const tagQuery = (tags?: { areaId: string | null; phase: string | null; pairId: string | null }) => {
  const query = [tags?.areaId ? `area=${tags.areaId}` : '', tags?.phase ? `phase=${tags.phase}` : '', tags?.pairId ? `pair=${tags.pairId}` : ''].filter(Boolean).join('&');
  return query ? `?${query}` : '';
};

/**
 * Sends the day's report. It reads the site first so a repeat is safe: an existing report is saved with its current
 * version, a report already submitted is left alone, and each photo id is sent once. A report written offline for a
 * day that already has my report (started on the web, or on another phone) goes into that one instead of failing.
 */
export const sendSiteReport: OutboxHandler = async ({ api, item, withFile, step }) => {
  const payload = item.payload as unknown as ReportPayload;
  const base = `site/projects/${payload.projectId}`;
  let state = await api.get<SiteState>(base);
  const reportDate = typeof payload.report.reportDate === 'string' ? payload.report.reportDate : state.today;
  // The same person's report for the same day under another id (an offline duplicate): that report is the one.
  const twin = state.reports.find((entry) => entry.id !== payload.reportId && entry.authorId === state.me && entry.reportDate === reportDate);
  const reportId = state.reports.some((entry) => entry.id === payload.reportId) ? payload.reportId : twin?.id ?? payload.reportId;
  let report = state.reports.find((entry) => entry.id === reportId);
  if (report && (report.status === 'submitted' || report.status === 'approved')) return [['projects', api.workspaceId, payload.projectId, 'site']];
  if (item.step < 1) {
    state = await api.send<SiteState>(base, 'POST', { action: 'save_report', ...payload.report, id: reportId, ...(report ? { version: report.version } : {}) });
    step(1);
  }
  const have = new Set((state.reports.find((entry) => entry.id === reportId)?.photos ?? []).map((photo) => photo.id));
  for (const photoId of payload.photoIds) {
    if (have.has(photoId)) continue;
    try { state = await withFile(photoId, (file) => api.upload<SiteState>(`${base}/reports/${reportId}/photos/${photoId}${tagQuery(payload.photoTags?.[photoId])}`, 'POST', 'file', file)); }
    catch (error) { if (!(error instanceof ApiError && error.status === 409)) throw error; }
  }
  // A snag, change request or material request from an issue: raised once (a retry finds it raised).
  for (const entry of payload.raise ?? []) state = await api.send<SiteState>(base, 'POST', { action: 'raise_issue', issueId: entry.issueId, kind: entry.kind });
  if (payload.submit) {
    report = state.reports.find((entry) => entry.id === reportId);
    if (report && (report.status === 'draft' || report.status === 'returned')) await api.send(base, 'POST', { action: 'submit', reportId, version: report.version });
  }
  return [['projects', api.workspaceId, payload.projectId, 'site']];
};
