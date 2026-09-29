import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("where sign-in continues", () => {
  it("continues to workspace pages, internal pages and an AI app's consent screen", () => {
    expect(safeNextPath("/workspace/approvals")).toBe("/workspace/approvals");
    expect(safeNextPath("/internal/accounts")).toBe("/internal/accounts");
    const consent = "/oauth/authorize?response_type=code&client_id=c-1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s1";
    expect(safeNextPath(consent)).toBe(consent);
    expect(safeNextPath("/oauth/authorize")).toBe("/oauth/authorize");
  });

  it("opens the workspace for anything else", () => {
    for (const next of [undefined, null, "", "//evil.example", "https://evil.example/oauth/authorize?x=1", "/oauth/authorizeX", "/oauth/token", "/oauth/authorize/../../evil", `/oauth/authorize?${"x".repeat(5_000)}`]) {
      expect(safeNextPath(next), String(next)).toBe("/workspace");
    }
  });
});
