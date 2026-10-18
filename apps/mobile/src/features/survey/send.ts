import type { SiteData } from '../../../../web/lib/pre-project/site';
import { ApiError } from '../../auth/client';
import type { Api } from '../../core/api';
import type { OutboxContext } from '../../core/outbox-send';
import type { Brief } from './api';
import { answerVersion, type DesignJourneyView, type SiteAnswer } from './questions-model';

/**
 * How the survey's queued captures are sent, apart from React and storage so node tests can run them: photos first
 * (a photo already up answers 409 and counts as sent), then the record with the versions it has now.
 */

/** A measurement set from site: its photos, then the set itself saved with the current versions. */
export type MeasurementPayload = { caseId: string; record: { id: string; title: string; note: string; roomId: string | null; entryId: string | null; dimensions: unknown[] }; photoIds: string[] };
/** A photo note on a case (an observation with its photos), filed to a room and, when chosen, one of its items. */
export type ObservationPayload = { caseId: string; record: { id: string; title: string; note: string; roomId: string | null; entryId?: string | null; category: string }; photoIds: string[] };
/** Answers to the site visit's questions, by question key (a checklist line with its status). */
export type SiteAnswersPayload = { caseId: string; answers: SiteAnswer[] };

const siteKey = (workspaceId: string, caseId: string) => ['survey', workspaceId, 'site', caseId] as const;
const briefKey = (workspaceId: string, caseId: string) => ['survey', workspaceId, 'brief', caseId] as const;
const journeyKey = (workspaceId: string, caseId: string) => ['survey', workspaceId, 'design-journey', caseId] as const;

/** Uploads the photos not yet up, from where a retry left off. */
export async function uploadAssets({ api, item, withFile, step }: OutboxContext, caseId: string, photoIds: string[]) {
  for (let index = item.step; index < photoIds.length; index += 1) {
    const photoId = photoIds[index];
    try { await withFile(photoId, (file) => api.upload(`pre-projects/${caseId}/assets/${photoId}`, 'POST', 'file', file)); }
    catch (error) { if (!(error instanceof ApiError && error.status === 409)) throw error; }
    step(index + 1);
  }
}
const existing = async (api: Api, caseId: string, id: string) => (await api.get<SiteData>(`pre-projects/${caseId}/site`)).items.find((record) => record.id === id);

export async function sendMeasurement(context: OutboxContext) {
  const { api, item } = context;
  const payload = item.payload as unknown as MeasurementPayload;
  await uploadAssets(context, payload.caseId, payload.photoIds);
  const record = await existing(api, payload.caseId, payload.record.id);
  let specificationVersion = 0;
  if (payload.record.entryId) {
    const brief = await api.get<Brief>(`pre-projects/${payload.caseId}/brief`);
    specificationVersion = brief.entries.find((entry) => entry.id === payload.record.entryId)?.specification?.version ?? 0;
  }
  const assetIds = [...new Set([...(record?.assetIds ?? []), ...payload.photoIds])].slice(0, 20);
  await api.send(`pre-projects/${payload.caseId}/site/measurements`, 'PUT', {
    id: payload.record.id, version: record?.version ?? 0, title: payload.record.title, note: payload.record.note, assetIds,
    roomId: payload.record.roomId, entryId: payload.record.entryId, visitId: record?.visitId ?? null, specificationVersion, dimensions: payload.record.dimensions,
  });
  return [siteKey(api.workspaceId, payload.caseId), briefKey(api.workspaceId, payload.caseId)];
}

export async function sendObservation(context: OutboxContext) {
  const { api, item } = context;
  const payload = item.payload as unknown as ObservationPayload;
  await uploadAssets(context, payload.caseId, payload.photoIds);
  const record = await existing(api, payload.caseId, payload.record.id);
  const assetIds = [...new Set([...(record?.assetIds ?? []), ...payload.photoIds])].slice(0, 20);
  await api.send(`pre-projects/${payload.caseId}/site/observations`, 'PUT', {
    id: payload.record.id, version: record?.version ?? 0, title: payload.record.title, note: payload.record.note, assetIds,
    roomId: payload.record.roomId, entryId: payload.record.entryId ?? null, visitId: null, category: payload.record.category, status: record?.status ?? 'open', resolution: record?.resolution ?? '',
  });
  return [siteKey(api.workspaceId, payload.caseId)];
}

/**
 * The site visit's answers, against the visit as it is when the phone is back online: the kick-off's version while the
 * kick-off is the current step (its answers are recorded there), otherwise the site visit's. A visit that is closed is
 * refused by the server and waits for the person.
 */
export async function sendSiteAnswers(context: OutboxContext) {
  const { api, item } = context;
  const payload = item.payload as unknown as SiteAnswersPayload;
  const view = await api.get<DesignJourneyView>(`pre-projects/${payload.caseId}/design-journey`);
  await api.send(`pre-projects/${payload.caseId}/design-journey/site-visit/answers`, 'PUT', { version: answerVersion(view) ?? 1, answers: payload.answers });
  return [journeyKey(api.workspaceId, payload.caseId)];
}
