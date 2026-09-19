import { describe, expect, it } from "vitest";
import { treeCandidates } from "./one-tree";

const siteId = "00000000-0000-4000-8000-000000000001";
const roomId = "00000000-0000-4000-8000-000000000002";
const itemId = "00000000-0000-4000-8000-000000000003";

describe("One Tree identity candidates", () => {
  it("preserves room and included scope UUIDs without inventing zones", () => {
    const candidates = treeCandidates(
      siteId,
      [{ id: roomId, version: 2, name: "Kitchen", catalogRecordId: null, catalogSnapshot: null }],
      [{ id: itemId, version: 4, title: "Base cabinets", roomId, category: "Joinery", priority: "must_have", scopeStatus: "included", reviewStatus: "reviewed", quantity: "5", unit: "m", archivedAt: null }],
    );
    expect(candidates.map((candidate) => [candidate.kind, candidate.id, candidate.parentId])).toEqual([
      ["room", roomId, siteId],
      ["item", itemId, roomId],
    ]);
    expect(candidates.some((candidate) => (candidate.kind as string) === "zone")).toBe(false);
  });

  it("does not mint an identity for excluded draft scope", () => {
    expect(treeCandidates(siteId, [], [{ id: itemId, version: 1, title: "Pool", roomId: null, category: "External", priority: "optional", scopeStatus: "excluded", reviewStatus: "reviewed", quantity: null, unit: "nos", archivedAt: null }])).toEqual([]);
  });

  it("archives an existing identity when scope is excluded and retains its UUID", () => {
    const [candidate] = treeCandidates(siteId, [], [{ id: itemId, version: 5, title: "Pool", roomId: null, category: "External", priority: "optional", scopeStatus: "excluded", reviewStatus: "reviewed", quantity: null, unit: "nos", archivedAt: null }], new Set([itemId]));
    expect(candidate).toMatchObject({ id: itemId, status: "archived", parentId: siteId });
  });

  it("falls back to the site when an item references a missing room", () => {
    const [candidate] = treeCandidates(siteId, [], [{ id: itemId, version: 1, title: "Survey item", roomId, category: "General", priority: "preferred", scopeStatus: "included", reviewStatus: "captured", quantity: "1", unit: "nos", archivedAt: null }]);
    expect(candidate.parentId).toBe(siteId);
  });

  it('revises renamed rooms and archives a deleted room without changing either UUID',()=>{
    const renamed=treeCandidates(siteId,[{id:roomId,version:3,name:'Primary kitchen',catalogRecordId:null,catalogSnapshot:null}],[],new Set(),new Map([[roomId,{label:'Kitchen',sourceVersion:2,snapshot:{name:'Kitchen'}}]]))[0];
    expect(renamed).toMatchObject({id:roomId,label:'Primary kitchen',sourceVersion:3,status:'active'});
    const [removed]=treeCandidates(siteId,[],[],new Set(),new Map([[roomId,{label:'Kitchen',sourceVersion:2,snapshot:{name:'Kitchen'}}]]));
    expect(removed).toMatchObject({id:roomId,label:'Kitchen',sourceVersion:2,status:'archived',snapshot:{name:'Kitchen',removed:true}});
  });
});
