import { useEffect, useState } from 'react';
import { readProtectedOfflineText, writeProtectedOfflineText } from '../../core/protected-storage';
import { useSession } from '../../core/session';
import { parseRoomsSnapshot, roomsSnapshot, type RoomsSnapshot } from '../capture/capture-model';
import { useBrief } from './api';

const storageKey = (userId: string, workspaceId: string, caseId: string) => `wodana.case-rooms.v1.${userId}.${workspaceId}.${caseId}`;

/**
 * A case's rooms and their items for choosing where photos go: from the brief when there is a connection, kept on the
 * phone (sealed, like the outbox) so the last ones known can be chosen without one.
 */
export function useCaseRooms(caseId: string | null) {
  const { userId, workspaceId } = useSession();
  const brief = useBrief(caseId ?? '');
  const [kept, setKept] = useState<RoomsSnapshot | null>(null);
  const key = caseId ? storageKey(userId, workspaceId, caseId) : null;
  useEffect(() => {
    setKept(null);
    if (!key) return;
    let alive = true;
    readProtectedOfflineText(key).then((text) => { if (alive) setKept(parseRoomsSnapshot(text)); }).catch(() => undefined);
    return () => { alive = false; };
  }, [key]);
  useEffect(() => {
    if (key && brief.data) void writeProtectedOfflineText(key, JSON.stringify(roomsSnapshot(brief.data))).catch(() => undefined);
  }, [key, brief.data]);
  const snapshot = brief.data ? roomsSnapshot(brief.data) : kept;
  return { snapshot, loading: brief.isLoading && !kept, canAddRoom: brief.data?.canEdit !== false && !!brief.data };
}
