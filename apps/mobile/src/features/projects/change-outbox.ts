import type { OutboxHandler } from '../../core/outbox-send';

/** A change raised on site (plan §6.20): created with its own id, then its photos (each photo id sent once). */
export type ChangePayload = { projectId: string; change: { id: string; title: string; reason: string; description: string }; photoIds: string[] };

/**
 * Sends a queued change: raises it once on the project (the same id again returns the change already raised), then
 * uploads each photo after the last one sent, recording each step so a retry never repeats one.
 */
export const sendChange: OutboxHandler = async ({ api, item, withFile, step }) => {
  const payload = item.payload as unknown as ChangePayload;
  const base = `project-changes/${payload.projectId}`;
  if (item.step < 1) { await api.send(base, 'POST', payload.change); step(1); }
  for (let index = Math.max(0, item.step - 1); index < payload.photoIds.length; index += 1) {
    const photoId = payload.photoIds[index];
    await withFile(photoId, (file) => api.upload(`${base}/${payload.change.id}/files/${photoId}`, 'POST', 'file', file));
    step(index + 2);
  }
  return [['projects', api.workspaceId, payload.projectId, 'work']];
};
