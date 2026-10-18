import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
import { NextResponse } from "next/server";

vi.mock("@/lib/auth/server", () => ({ ACTIVE_WORKSPACE_COOKIE: "wodana_workspace", authCookieOptions: { httpOnly: true, path: "/", sameSite: "lax" } }));
vi.mock("@/lib/workspace/workspace-api", () => ({ UUID: /^[0-9a-f-]{36}$/, isSameOrigin: vi.fn(), invalidRequest: (message: string) => NextResponse.json({ message }, { status: 400 }), workspaceJsonResponse: vi.fn() }));
import { isSameOrigin, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { POST } from "./route";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const request = () => new Request("http://localhost/api/workspace/active", { method: "POST", body: JSON.stringify({ workspaceId }) });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(isSameOrigin).mockReturnValue(true); });
describe("Active workspace boundary", () => {
  it("rejects cross-origin switches before reading the account", async () => { vi.mocked(isSameOrigin).mockReturnValue(false); expect((await POST(request())).status).toBe(403); expect(workspaceJsonResponse).not.toHaveBeenCalled(); });
  it("cannot select a workspace outside the authenticated memberships", async () => { vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({ memberships: [] })); const response = await POST(request()); expect(response.status).toBe(403); expect(response.cookies.get("wodana_workspace")).toBeUndefined(); });
  it("preserves authentication failures", async () => { vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({ message: "Sign in" }, { status: 401 })); expect((await POST(request())).status).toBe(401); });
  it("stores an authorized selection with a protected cookie and preserves refreshed tokens", async () => {
    const upstream = NextResponse.json({ memberships: [{ workspaceId }] });
    upstream.cookies.set("test_refresh", "rotated", { httpOnly: true });
    vi.mocked(workspaceJsonResponse).mockResolvedValue(upstream);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.cookies.get("wodana_workspace")).toMatchObject({ value: workspaceId, httpOnly: true, sameSite: "lax" });
    expect(response.cookies.get("test_refresh")?.value).toBe("rotated");
  });
});
