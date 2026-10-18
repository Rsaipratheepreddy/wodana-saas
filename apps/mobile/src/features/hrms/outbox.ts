import type { AttendanceAction, CapturePosition, CrewDay, CrewDayInput } from '../../../../../packages/contracts/src/hrms';
import { ApiError } from '../../core/api';
import { registerOutboxHandler } from '../../core/outbox';
import { hrmsKeys } from './api';

export type AttendancePayload = { action: Omit<AttendanceAction, 'exceptionReason'>; exceptionReason?: string };
export type CrewDayPayload = { dayId: string; input: Omit<CrewDayInput, 'version'>; captureId: string | null; position: CapturePosition | null; exceptionReason?: string; projectReference?: string };

/**
 * Check in / out / switch: a capture, its photo, then the action — always with the same ids, so a
 * repeat after a lost answer is recognised as the same action.
 */
registerOutboxHandler('hrms.attendance', async ({ api, item, withFile, step }) => {
  const payload = item.payload as unknown as AttendancePayload;
  const { captureId } = payload.action;
  if (item.step < 1) { await api.send('hrms/captures', 'POST', { id: captureId }); step(1); }
  if (item.step < 2 && item.files.some((file) => file.key === 'photo')) {
    await withFile('photo', (file) => api.upload(`hrms/captures/${captureId}/photo`, 'PUT', 'photo', file));
    step(2);
  }
  await api.send('hrms/attendance/actions', 'POST', { ...payload.action, exceptionReason: payload.exceptionReason ?? '' });
  return [hrmsKeys.all(api.workspaceId)];
});

/**
 * A crew day: saved with the latest version, its group photo, then submitted. Reading it first makes a
 * repeat safe: a day already submitted is left alone.
 */
registerOutboxHandler('hrms.crew-day', async ({ api, item, withFile, step }) => {
  const payload = item.payload as unknown as CrewDayPayload;
  let day: CrewDay | null = null;
  try { day = await api.get<CrewDay>(`hrms/crew-days/${payload.dayId}`); }
  catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
  if (day && (day.status === 'submitted' || day.status === 'approved')) return [hrmsKeys.all(api.workspaceId)];
  day = await api.send<CrewDay>(`hrms/crew-days/${payload.dayId}`, 'PUT', { ...payload.input, version: day?.version ?? 0 });
  if (payload.captureId) {
    if (item.step < 1) { await api.send('hrms/captures', 'POST', { id: payload.captureId }); step(1); }
    if (item.step < 2 && item.files.some((file) => file.key === 'photo')) {
      await withFile('photo', (file) => api.upload(`hrms/captures/${payload.captureId}/photo`, 'PUT', 'photo', file));
      step(2);
    }
  }
  await api.send(`hrms/crew-days/${payload.dayId}/submit`, 'POST', {
    version: day.version, captureId: payload.captureId, position: payload.position, exceptionReason: payload.exceptionReason ?? '',
  });
  return [hrmsKeys.all(api.workspaceId)];
});
