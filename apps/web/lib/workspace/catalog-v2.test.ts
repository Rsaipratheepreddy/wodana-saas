import { describe, expect, it } from "vitest";
import { catalogApiUrl } from "./catalog-v2";

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
