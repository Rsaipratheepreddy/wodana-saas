import { canonicalHash } from "../crm/shared/crm-types";

export type TreeRoomSource = {
  id: string;
  version: number;
  name: string;
  catalogRecordId: string | null;
  catalogSnapshot: Record<string, unknown> | null;
};

export type TreeItemSource = {
  id: string;
  version: number;
  title: string;
  roomId: string | null;
  category: string;
  priority: string;
  scopeStatus: string;
  reviewStatus: string;
  quantity: string | null;
  unit: string;
  archivedAt: Date | string | null;
};

export type TreeCandidate = {
  id: string;
  kind: "room" | "item";
  parentId: string;
  sourceType: "room" | "brief_entry";
  sourceVersion: number;
  status: "active" | "archived";
  label: string;
  snapshot: Record<string, unknown>;
  sourceHash: string;
};

export function treeCandidates(
  siteId: string,
  rooms: TreeRoomSource[],
  items: TreeItemSource[],
  existingItemIds: ReadonlySet<string> = new Set(),
  existingRooms: ReadonlyMap<string,{label:string;sourceVersion:number;snapshot:Record<string,unknown>}> = new Map(),
): TreeCandidate[] {
  const roomIds = new Set(rooms.map((room) => room.id));
  const roomNodes = rooms.map((room): TreeCandidate => {
    const snapshot = {
      name: room.name,
      catalogRecordId: room.catalogRecordId,
      catalogSnapshot: room.catalogSnapshot,
    };
    return {
      id: room.id,
      kind: "room",
      parentId: siteId,
      sourceType: "room",
      sourceVersion: room.version,
      status: "active",
      label: room.name,
      snapshot,
      sourceHash: canonicalHash(snapshot),
    };
  });
  const removedRoomNodes=[...existingRooms].filter(([id])=>!roomIds.has(id)).map(([id,previous]):TreeCandidate=>{
    const snapshot={...previous.snapshot,removed:true};
    return {id,kind:'room',parentId:siteId,sourceType:'room',sourceVersion:previous.sourceVersion,status:'archived',label:previous.label,snapshot,sourceHash:canonicalHash(snapshot)};
  });
  const itemNodes = items
    .filter((item) => item.scopeStatus === "included" || existingItemIds.has(item.id))
    .map((item): TreeCandidate => {
      const active = item.scopeStatus === "included" && !item.archivedAt;
      const snapshot = {
        title: item.title,
        category: item.category,
        priority: item.priority,
        scopeStatus: item.scopeStatus,
        reviewStatus: item.reviewStatus,
        quantity: item.quantity === null ? null : Number(item.quantity),
        unit: item.unit,
        roomId: item.roomId,
      };
      return {
        id: item.id,
        kind: "item",
        parentId: item.roomId && roomIds.has(item.roomId) ? item.roomId : siteId,
        sourceType: "brief_entry",
        sourceVersion: item.version,
        status: active ? "active" : "archived",
        label: item.title,
        snapshot,
        sourceHash: canonicalHash(snapshot),
      };
    });
  return [...roomNodes, ...removedRoomNodes, ...itemNodes];
}
