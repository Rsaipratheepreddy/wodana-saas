import { describe, expect, it, vi } from "vitest";
import { createGridDefaultsSource } from "./grid-settings";

const WORKSPACE = "7a1f8a54-4c11-4a7e-9a40-2f3c1f0d9b11";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("list defaults client", () => {
  it("reads through the workspace proxy once, and a save replaces the cached answer", async () => {
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT"
      ? json({ gridKey: "crm.enquiries", hiddenColumns: ["owner"], version: 2, canManage: true })
      : json({ gridKey: "crm.enquiries", hiddenColumns: ["source"], version: 1, canManage: true }));
    const source = createGridDefaultsSource(WORKSPACE, request as typeof fetch);
    expect(await source.load("crm.enquiries")).toEqual({ hiddenColumns: ["source"], version: 1, canManage: true });
    await source.load("crm.enquiries");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(`/api/workspace/grid-settings/crm.enquiries?workspaceId=${WORKSPACE}`);
    await source.save("crm.enquiries", { hiddenColumns: ["owner"], version: 1, requestId: "r" });
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ hiddenColumns: ["owner"], version: 1, requestId: "r" });
    expect(await source.load("crm.enquiries")).toMatchObject({ hiddenColumns: ["owner"], version: 2 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("surfaces the server's message and retries a failed read next time", async () => {
    const request = vi.fn(async () => json({ message: "Permissions required: crm.settings.manage" }, 403));
    const source = createGridDefaultsSource(WORKSPACE, request as unknown as typeof fetch);
    await expect(source.save("crm.enquiries", { hiddenColumns: [], version: 0, requestId: "r" })).rejects.toThrow("Permissions required");
    await expect(source.load("crm.enquiries")).rejects.toThrow();
    await expect(source.load("crm.enquiries")).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(3);
  });
});
