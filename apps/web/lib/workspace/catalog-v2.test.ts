import { describe, expect, it } from "vitest";
import { catalogApiUrl, readableCode } from "./catalog-v2";

const ws = "00000000-0000-4000-8000-000000000001";

describe("catalogApiUrl", () => {
  it("calls the catalog root without a trailing slash", () => {
    expect(catalogApiUrl(ws, "")).toBe(`/api/workspace/catalogs?workspaceId=${ws}`);
    expect(catalogApiUrl(ws, "?purpose=sell")).toBe(`/api/workspace/catalogs?purpose=sell&workspaceId=${ws}`);
  });

  it("keeps nested paths and their query", () => {
    expect(catalogApiUrl(ws, "abc/items")).toBe(`/api/workspace/catalogs/abc/items?workspaceId=${ws}`);
    expect(catalogApiUrl(ws, "abc/items?q=oak")).toBe(`/api/workspace/catalogs/abc/items?q=oak&workspaceId=${ws}`);
  });
});

describe("readableCode", () => {
  it("hides the codes the system made up on import and keeps the ones a person set", () => {
    expect(readableCode("PLM_CHAIRS_ADAM_LOUNGE_CHAIR_C71F28A2")).toBeNull();
    expect(readableCode("PLM_TABLE_ALEXANDRA_CALACATTA_120_E47C55EA")).toBeNull();
    expect(readableCode("PLY-18-MR")).toBe("PLY-18-MR");
    expect(readableCode("SOFA_01")).toBe("SOFA_01");
    expect(readableCode("")).toBeNull();
  });
});
