import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
import { NextResponse } from "next/server";

vi.mock("@/lib/workspace/workspace-api", () => ({
  UUID: /^[0-9a-f-]{36}$/i,
  isSameOrigin: (request: Request) => request.headers.get("origin") === "http://localhost",
  invalidRequest: (message: string) => NextResponse.json({ message }, { status: 400 }),
  workspaceJsonResponse: vi.fn(),
}));
import { workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const body = { workspaceId, requestId, rowIndex: 2, filename: "enquiries.csv", source: "company", channel: "website", serviceType: "design", party: { displayName: "Asha Rao", mobile: "+971501234567" }, details: { emirate: "dubai", area: "marina" } };
const request = (value: unknown, origin = "http://localhost") => new Request("http://localhost/api/workspace/crm/import", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value) });

beforeEach(() => { vi.clearAllMocks(); vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({ status: "ready" })); });

it("keeps source, channel and import method separate with a stable per-row request key", async () => {
  expect((await POST(request(body))).status).toBe(200);
  expect(workspaceJsonResponse).toHaveBeenCalledWith(`/workspaces/${workspaceId}/crm/intake-events`, expect.objectContaining({
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": `lead-import:${requestId}:2` },
    body: JSON.stringify({ party: body.party, details: body.details, source: "company", channel: "website", serviceType: "design", title: "", intakeMethod: "import", assignment: { mode: "automatic" }, originalPayload: { origin: "crm_csv_import", filename: "enquiries.csv", rowIndex: 2 } }),
  }), expect.any(String));
});

it("rejects missing core fields and cross-origin imports", async () => {
  expect((await POST(request({ ...body, serviceType: "" }))).status).toBe(400);
  expect((await POST(request(body, "https://elsewhere.example"))).status).toBe(403);
  expect(workspaceJsonResponse).not.toHaveBeenCalled();
});
