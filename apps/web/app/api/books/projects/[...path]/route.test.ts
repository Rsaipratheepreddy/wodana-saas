import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
const forward = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workspace/workspace-api", () => ({ UUID: /^[0-9a-f-]{36}$/, workspaceJsonResponse: forward }));
import { GET } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const project = "22222222-2222-4222-8222-222222222222";
const entity = "33333333-3333-4333-8333-333333333333";
const call = (path: string[], query = "") => GET(new Request(`http://localhost/api/books/projects/${path.join("/")}?workspaceId=${workspaceId}${query}`), { params: Promise.resolve({ path }) });

describe("Ledger project profit proxy", () => {
  beforeEach(() => { forward.mockReset(); forward.mockResolvedValue(new Response("{}")); });

  it("reads one project's P&L and the Projects profit grid, forwarding only a company and valid dates", async () => {
    await call([project, "pnl"]);
    expect(forward).toHaveBeenLastCalledWith(`/workspaces/${workspaceId}/books/projects/${project}/pnl`, { method: "GET" }, expect.any(String));
    await call(["profit"], `&entity=${entity}&from=2026-10-01&to=bad&extra=1`);
    expect(forward).toHaveBeenLastCalledWith(`/workspaces/${workspaceId}/books/projects-profit?entity=${entity}&from=2026-10-01`, { method: "GET" }, expect.any(String));
  });

  it("refuses anything else", async () => {
    for (const path of [["pnl"], ["not-a-uuid", "pnl"], [project, "journals"], ["profit", "x"]]) expect((await call(path)).status).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });
});
