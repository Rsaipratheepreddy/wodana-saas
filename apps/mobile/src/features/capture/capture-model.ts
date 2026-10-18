import type { ObservationPayload } from '../survey/send';

/**
 * Photo first, then the room (pure; node tests import it). The camera opens straight away; the person then says which
 * room, and optionally which item in it, the photos show. The rooms come from the case's brief and are kept on the phone
 * so a room can be chosen without a connection; the capture itself is queued and sent when the phone is back online.
 */
export type RoomChoice = { id: string; name: string };
export type ItemChoice = { id: string; title: string; roomId: string | null };
export type RoomsSnapshot = { rooms: RoomChoice[]; items: ItemChoice[] };

type BriefLike = { rooms: Array<{ id: string; name: string }>; entries: Array<{ id: string; title: string; kind: string; roomId?: string | null; archivedAt?: string | null }> };

/** The rooms and the items in them (requirements not archived), as kept on the phone. */
export function roomsSnapshot(brief: BriefLike): RoomsSnapshot {
  return {
    rooms: brief.rooms.map((room) => ({ id: room.id, name: room.name })),
    items: brief.entries.filter((entry) => entry.kind === 'requirement' && !entry.archivedAt).map((entry) => ({ id: entry.id, title: entry.title, roomId: entry.roomId ?? null })),
  };
}

/** A kept snapshot read back; anything malformed reads as nothing kept. */
export function parseRoomsSnapshot(text: string | null | undefined): RoomsSnapshot | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<RoomsSnapshot>;
    const rooms = Array.isArray(value.rooms) ? value.rooms.filter((room): room is RoomChoice => typeof room?.id === 'string' && typeof room?.name === 'string') : [];
    const items = Array.isArray(value.items) ? value.items.filter((item): item is ItemChoice => typeof item?.id === 'string' && typeof item?.title === 'string')
      .map((item) => ({ id: item.id, title: item.title, roomId: typeof item.roomId === 'string' ? item.roomId : null })) : [];
    return { rooms, items };
  } catch { return null; }
}

/** The items to offer once a room is chosen: that room's. */
export const itemsIn = (snapshot: RoomsSnapshot | null, roomId: string | null) => (roomId ? (snapshot?.items ?? []).filter((item) => item.roomId === roomId) : []);

export type CapturedPhoto = { id: string; uri: string; name: string; type: string };

/**
 * The queued photo note: one operation id (the server deduplicates on it and on the record id), the photos as its
 * files, filed to the room (and item) chosen. Its title says where it goes in the list of what waits to send.
 */
export function photoNoteCapture(input: {
  operationId: string; recordId: string; caseId: string; photos: CapturedPhoto[]; title: string; note: string; roomId: string | null; entryId: string | null; listTitle: string;
}) {
  const payload: ObservationPayload = {
    caseId: input.caseId, photoIds: input.photos.map((photo) => photo.id),
    record: { id: input.recordId, title: input.title.trim().slice(0, 240), note: input.note.slice(0, 6000), roomId: input.roomId, entryId: input.roomId ? input.entryId : null, category: 'condition' },
  };
  return {
    item: { id: input.operationId, kind: 'survey.photo', title: input.listTitle, scope: `case:${input.caseId}`, payload: payload as unknown as Record<string, unknown> },
    files: input.photos.map((photo) => ({ key: photo.id, uri: photo.uri, name: photo.name, type: photo.type })),
  };
}
