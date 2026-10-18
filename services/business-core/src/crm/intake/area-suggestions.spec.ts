import { describe, expect, it, vi } from "vitest";
import { loadAreaSuggestions } from "./area-suggestions";

const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
const regions = [{ id: "north", label: "North" }, { id: "south", label: "South" }, { id: "other", label: "Other" }];

function client(used: Array<{ region: string; area: string; uses: string }>, levels: unknown = null) {
  return { query: vi.fn(async (sql: string) => sql.includes("FROM crm_enquiries") ? { rows: used } : sql.includes("tenant_setup_profiles") ? { rows: levels ? [{ levels }] : [] } : { rows: [] }) };
}

describe("area / city suggestions", () => {
  it("offers the areas already used in a region, most used first, scoped to the workspace", async () => {
    const db = client([
      { region: "north", area: "Harbour", uses: "4" },
      { region: "north", area: "Old Town", uses: "6" },
      { region: "south", area: "Lakeside", uses: "1" },
    ]);
    const result = await loadAreaSuggestions(db as never, workspaceId, regions, {});
    expect(result).toEqual({ north: ["Old Town", "Harbour"], south: ["Lakeside"] });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("enquiry.workspace_id = $1");
    expect(params).toEqual([workspaceId]);
  });

  it("names a listed area by its label, counts it with the same area typed by hand, then adds the rest of the list", async () => {
    const listed = { north: [{ id: "harbour", label: "Harbour" }, { id: "hills", label: "Hills" }] };
    const db = client([
      { region: "north", area: "Old Town", uses: "3" },
      { region: "north", area: "harbour", uses: "2" },
      { region: "north", area: "HARBOUR", uses: "2" },
    ]);
    expect((await loadAreaSuggestions(db as never, workspaceId, regions, listed)).north).toEqual(["Harbour", "Old Town", "Hills"]);
  });

  it("adds the areas the region pack lists for each region, after the used ones", async () => {
    const levels = [{ key: "region", options: ["North", "South"] }, { key: "locality", options: { North: ["Harbour", "Bay"], South: ["Lakeside"], Elsewhere: ["Nowhere"] } }];
    const db = client([{ region: "north", area: "Bay", uses: "1" }], levels);
    expect(await loadAreaSuggestions(db as never, workspaceId, regions, {})).toEqual({ north: ["Bay", "Harbour"], south: ["Lakeside"] });
  });

  it("keeps a workspace without regions under the empty region, and ignores a pack without areas", async () => {
    const db = client([{ region: "", area: "Riverside", uses: "2" }], [{ key: "region", options: ["North"] }, { key: "locality" }]);
    expect(await loadAreaSuggestions(db as never, workspaceId, [], {})).toEqual({ "": ["Riverside"] });
  });
});
