import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
import { NextResponse } from "next/server";
vi.mock("@/lib/workspace/workspace-api", () => ({
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  invalidRequest: (message: string) => NextResponse.json({ message }, { status: 400 }),
  isSameOrigin: (request: Request) => request.headers.get("origin") !== "https://evil.example",
  workspaceJsonResponse: vi.fn(),
}));
import { workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { GET } from "./route";
import { GET as assignees, POST } from "./[subjectId]/[action]/route";
import { DELETE, PUT } from "../reminders/rules/[kind]/route";

const ws = "11111111-1111-4111-8111-111111111111";
const subject = "22222222-2222-4222-8222-222222222222";
const post = (action: string, body: unknown, origin = "http://localhost") => POST(
  new Request(`http://localhost/api/workspace/my-day/${subject}/${action}?workspaceId=${ws}`, { method: "POST", headers: { origin, host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ subjectId: subject, action }) },
);

beforeEach(() => { vi.clearAllMocks(); vi.mocked(workspaceJsonResponse).mockResolvedValue(NextResponse.json({ item: null })); });

describe("My day BFF", () => {
  it("forwards only known filters for the person's workspace", async () => {
    expect((await GET(new Request("http://localhost/api/workspace/my-day?workspaceId=../x"))).status).toBe(400);
    await GET(new Request(`http://localhost/api/workspace/my-day?workspaceId=${ws}&scope=team&urgency=overdue&module=finance&limit=50&evil=1`));
    expect(workspaceJsonResponse).toHaveBeenCalledWith(`/workspaces/${ws}/my-day?scope=team&urgency=overdue&module=finance&limit=50`, { method: "GET" }, expect.any(String));
    await GET(new Request(`http://localhost/api/workspace/my-day?workspaceId=${ws}&scope=all&urgency=later&module=hr&limit=-3`));
    expect(workspaceJsonResponse).toHaveBeenLastCalledWith(`/workspaces/${ws}/my-day`, { method: "GET" }, expect.any(String));
  });

  it("sends a snooze with its reason and version, and refuses one without a reason", async () => {
    expect((await post("snooze", { until: "2026-10-12T09:00:00.000Z", reason: "  ", version: 2 })).status).toBe(400);
    expect((await post("snooze", { until: "tomorrow", reason: "Waiting", version: 2 })).status).toBe(400);
    expect((await post("snooze", { until: "2026-10-12T09:00:00.000Z", reason: "x".repeat(301), version: 2 })).status).toBe(400);
    expect(workspaceJsonResponse).not.toHaveBeenCalled();
    await post("snooze", { until: "2026-10-12T09:00:00.000Z", reason: " Waiting for the supplier ", version: 2, extra: true });
    expect(workspaceJsonResponse).toHaveBeenCalledWith(`/workspaces/${ws}/my-day/${subject}/snooze`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ until: "2026-10-12T09:00:00.000Z", reason: "Waiting for the supplier", version: 2 }) }), expect.any(String));
  });

  it("completes, wakes and reassigns with the version; anything else is refused", async () => {
    await post("complete", { version: 4 });
    expect(workspaceJsonResponse).toHaveBeenLastCalledWith(`/workspaces/${ws}/my-day/${subject}/complete`, expect.objectContaining({ body: JSON.stringify({ version: 4 }) }), expect.any(String));
    await post("unsnooze", { version: 5 });
    expect(workspaceJsonResponse).toHaveBeenLastCalledWith(`/workspaces/${ws}/my-day/${subject}/unsnooze`, expect.objectContaining({ body: JSON.stringify({ version: 5 }) }), expect.any(String));
    expect((await post("reassign", { membershipId: "nobody", version: 1 })).status).toBe(400);
    await post("reassign", { membershipId: subject, version: 1 });
    expect(workspaceJsonResponse).toHaveBeenLastCalledWith(`/workspaces/${ws}/my-day/${subject}/reassign`, expect.objectContaining({ body: JSON.stringify({ membershipId: subject, version: 1 }) }), expect.any(String));
    expect((await post("delete", { version: 1 })).status).toBe(404);
    expect((await post("complete", { version: 1 }, "https://evil.example")).status).toBe(403);
    await assignees(new Request(`http://localhost/api/workspace/my-day/${subject}/assignees?workspaceId=${ws}`), { params: Promise.resolve({ subjectId: subject, action: "assignees" }) });
    expect(workspaceJsonResponse).toHaveBeenLastCalledWith(`/workspaces/${ws}/my-day/${subject}/assignees`, { method: "GET" }, expect.any(String));
  });
});

describe("Reminder rules BFF", () => {
  const rule = { enabled: true, offsets: [-1, 0, 2], unit: "day", workingDays: false, escalateAfter: 2, chain: ["manager", "owner"], channels: ["in_app", "email"], digest: false, quietHours: null, version: 0 };
  const put = (kind: string, body: unknown) => PUT(new Request(`http://localhost/api/workspace/reminders/rules/${kind}?workspaceId=${ws}`, { method: "PUT", headers: { origin: "http://localhost", host: "localhost" }, body: JSON.stringify(body) }), { params: Promise.resolve({ kind }) });

  it("forwards a well-formed rule for an engine kind and puts one back to its default with the version", async () => {
    await put("work.due", { ...rule, kind: "ignored" });
    expect(workspaceJsonResponse).toHaveBeenCalledWith(`/workspaces/${ws}/reminders/rules/work.due`, expect.objectContaining({ method: "PUT", body: JSON.stringify(rule) }), expect.any(String));
    expect((await put("crm.unowned", rule)).status).toBe(400);
    expect((await put("work.due", { ...rule, chain: ["manager", "owner", "finance", "purchasing"] })).status).toBe(400);
    expect((await put("work.due", { ...rule, channels: [] })).status).toBe(400);
    await DELETE(new Request(`http://localhost/api/workspace/reminders/rules/work.due?workspaceId=${ws}&version=3`, { method: "DELETE", headers: { origin: "http://localhost", host: "localhost" } }), { params: Promise.resolve({ kind: "work.due" }) });
    expect(workspaceJsonResponse).toHaveBeenLastCalledWith(`/workspaces/${ws}/reminders/rules/work.due?version=3`, { method: "DELETE" }, expect.any(String));
  });
});
