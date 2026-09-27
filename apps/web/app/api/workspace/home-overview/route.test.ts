import { expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
import { NextResponse } from "next/server";
vi.mock("@/lib/workspace/workspace-api", () => ({ UUID: /^[0-9a-f-]{36}$/, invalidRequest: (message: string) => NextResponse.json({message},{status:400}), workspaceJsonResponse: vi.fn().mockResolvedValue(NextResponse.json({sections:{}})) }));
import { workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { GET } from "./route";

it("rejects malformed workspace IDs without forwarding", async () => {
  expect((await GET(new Request("http://localhost/api/workspace/home-overview?workspaceId=../other"))).status).toBe(400);
  expect(workspaceJsonResponse).not.toHaveBeenCalled();
});
it("forwards only the workspace scoped overview request", async () => {
  await GET(new Request("http://localhost/api/workspace/home-overview?workspaceId=00000000-0000-4000-8000-000000000001"));
  expect(workspaceJsonResponse).toHaveBeenCalledWith("/workspaces/00000000-0000-4000-8000-000000000001/home-overview", {method:"GET"}, expect.any(String));
});
