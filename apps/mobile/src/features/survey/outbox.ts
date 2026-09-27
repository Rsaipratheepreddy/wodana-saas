import type { SiteData } from '../../../../web/lib/pre-project/site';
import { ApiError, type Api } from '../../core/api';
import { registerOutboxHandler, type OutboxContext } from '../../core/outbox';
import type { Brief } from './api';
import { surveyKeys } from './api';

/** A measurement set from site: its photos, then the set itself saved with the current versions. */
export type MeasurementPayload = { caseId: string; record: { id: string; title: string; note: string; roomId: string | null; entryId: string | null; dimensions: unknown[] }; photoIds: string[] };
/** A photo note on a case (an observation with its photos). */
export type ObservationPayload = { caseId: string; record: { id: string; title: string; note: string; roomId: string | null; category: string }; photoIds: string[] };

async function uploadAssets({ api, item, withFile, step }: OutboxContext, caseId: string, photoIds: string[]) {
  for (let index = item.step; index < photoIds.length; index += 1) {
    const photoId = photoIds[index];
    try { await withFile(photoId, (file) => api.upload(`pre-projects/${caseId}/assets/${photoId}`, 'POST', 'file', file)); }
    catch (error) { if (!(error instanceof ApiError && error.status === 409)) throw error; }
    step(index + 1);
  }
}
const existing = async (api: Api, caseId: string, id: string) => (await api.get<SiteData>(`pre-projects/${caseId}/site`)).items.find((record) => record.id === id);

registerOutboxHandler('survey.measurement', async (context) => {
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
  return [surveyKeys.site(api.workspaceId, payload.caseId), surveyKeys.brief(api.workspaceId, payload.caseId)];
});

registerOutboxHandler('survey.photo', async (context) => {
  const { api, item } = context;
  const payload = item.payload as unknown as ObservationPayload;
  await uploadAssets(context, payload.caseId, payload.photoIds);
  const record = await existing(api, payload.caseId, payload.record.id);
  const assetIds = [...new Set([...(record?.assetIds ?? []), ...payload.photoIds])].slice(0, 20);
  await api.send(`pre-projects/${payload.caseId}/site/observations`, 'PUT', {
    id: payload.record.id, version: record?.version ?? 0, title: payload.record.title, note: payload.record.note, assetIds,
    roomId: payload.record.roomId, entryId: null, visitId: null, category: payload.record.category, status: record?.status ?? 'open', resolution: record?.resolution ?? '',
  });
  return [surveyKeys.site(api.workspaceId, payload.caseId)];
});
