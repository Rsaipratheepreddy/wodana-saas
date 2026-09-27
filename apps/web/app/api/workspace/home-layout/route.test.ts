import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
import { NextResponse } from "next/server";
vi.mock("@/lib/workspace/workspace-api", () => ({ UUID: /^[0-9a-f-]{36}$/, isSameOrigin: vi.fn(), invalidRequest: (message: string) => NextResponse.json({ message }, { status: 400 }), workspaceJsonResponse: vi.fn() }));
import { isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { GET, PUT } from "./route";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const request = (body: unknown) => new Request("http://localhost/api/workspace/home-layout", { method: "PUT", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(isSameOrigin).mockReturnValue(true); vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({ version: 1 })); });
it("rejects cross-origin writes before forwarding", async () => {
  vi.mocked(isSameOrigin).mockReturnValue(false);
  expect((await PUT(request({ workspaceId }))).status).toBe(403);
  expect(workspaceJsonResponse).not.toHaveBeenCalled();
});
it("rejects invalid workspace paths", async () => {
  expect((await GET(new Request("http://localhost/api/workspace/home-layout?workspaceId=../other"))).status).toBe(400);
  expect(workspaceJsonResponse).not.toHaveBeenCalled();
});
it("forwards only layout fields, never a supplied actor identity", async () => {
  await PUT(request({ workspaceId, userId: "another-user", version: 0, widgets: [] }));
  expect(workspaceJsonResponse).toHaveBeenCalledWith(`/workspaces/${workspaceId}/home-layout`, expect.objectContaining({ body: JSON.stringify({ version: 0, widgets: [] }) }), expect.any(String));
});
it("preserves upstream conflict responses", async () => {
  vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({ message: "Reload" }, { status: 409 }));
  expect((await PUT(request({ workspaceId, version: 0, widgets: [] }))).status).toBe(409);
});
