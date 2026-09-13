import { describe, expect, it } from "vitest";
import { caseHref, caseRoute, listSearch } from "./types";
const id = "00000000-0000-4000-8000-000000000001";
describe("case-scoped navigation", () => {
  it("recognizes only valid case/section URLs", () => {
    expect(caseRoute(`/workspace/pre-projects/cases/${id}/approvals`)).toEqual({ id, section: "approvals" });
    expect(caseRoute(`/workspace/pre-projects/cases/${id}`)?.section).toBe("overview");
    expect(caseRoute(`/workspace/pre-projects/cases/${id}/unknown`)).toBeNull();
    expect(caseRoute("/workspace/pre-projects/cases/not-an-id/site")).toBeNull();
    expect(caseRoute("/workspace/pre-projects/site")).toBeNull();
  });
  it("preserves search and page without accepting obsolete views or arbitrary return URLs", () => {
    const query = new URLSearchParams("search=Amira&view=table&status=active&page=2&returnTo=https://attacker.test&workspaceId=other");
    expect(caseHref(id, query, "site")).toBe(`/workspace/pre-projects/cases/${id}/site?search=Amira&page=2`);
    expect(listSearch(new URLSearchParams("view=cards")).size).toBe(0);
  });
  it("drops retired status filters when opening and returning from a case", () => {
    expect(caseHref(id, new URLSearchParams("status=qualified&search=villa"))).toBe(`/workspace/pre-projects/cases/${id}/requirements?search=villa`);
  });
  it("normalizes unsupported selector state", () => {
    expect(listSearch(new URLSearchParams("view=bogus&page=-1&status=deleted&section=unknown")).size).toBe(0);
  });
});
