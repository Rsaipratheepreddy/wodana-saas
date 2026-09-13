import type {CaseContent, DesignFolder} from './content';

export type FolderKind = 'room' | 'item' | 'room-item';

export function folderSelection(data: CaseContent, kind: FolderKind, roomId: string | null, itemId: string | null) {
  const item = kind === 'room' ? undefined : data.entries.find(entry => entry.id === itemId && entry.kind === 'requirement' && !entry.archivedAt);
  const room = data.rooms.find(room => room.id === (kind === 'item' ? item?.roomId : roomId));
  const valid = kind === 'room' ? Boolean(room) : kind === 'item' ? Boolean(item) : Boolean(room && item && item.roomId === room.id);
  return {
    valid,
    name: (kind === 'room' ? room?.name ?? '' : kind === 'item' ? item?.title ?? '' : room && item ? `${room.name} + ${item.title}` : '').slice(0, 160),
    roomId: room?.id ?? null,
    scopeEntryId: item?.id ?? null,
  };
}

export function matchingFolder(folders: DesignFolder[], selection: {name: string; roomId: string | null; scopeEntryId: string | null}, exceptId?: string) {
  return folders.find(folder => folder.id !== exceptId && (
    folder.name.trim().toLocaleLowerCase() === selection.name.trim().toLocaleLowerCase() ||
    (selection.scopeEntryId ? folder.scopeEntryId === selection.scopeEntryId : Boolean(selection.roomId && folder.roomId === selection.roomId && !folder.scopeEntryId))
  ));
}
