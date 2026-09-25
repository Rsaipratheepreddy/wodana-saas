import { afterEach, expect, it, vi } from "vitest";
import { loadProjectPlanning } from "./planning";

const context = { workspaceId: "workspace", caseId: "linked-case" };
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

it("loads the linked case requirements and preserves server permissions", async () => {
  const content = { caseId: "linked-case", workspaceId: "workspace", canEdit: false, entries: [{ id: "requirement" }] };
  const fetcher = vi.fn().mockResolvedValue(Response.json(content));
  vi.stubGlobal("fetch", fetcher);
  expect(await loadProjectPlanning(context, "requirements", signal())).toEqual({ section: "requirements", content });
  expect(fetcher).toHaveBeenCalledWith("/api/workspace/pre-projects/linked-case/brief?workspaceId=workspace", expect.objectContaining({ cache: "no-store" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("loads designs and review options from the same linked case", async () => {
  const content = { entries: [], canEdit: true };
  const listing = { items: [{ id: "drawing" }], folders: [{ id: "folder" }], canReview: false };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("/designs?") ? listing : content)));
  expect(await loadProjectPlanning(context, "design", signal())).toEqual({ section: "design", content, designs: listing.items, options: listing });
});

it.each(["quotations", "change-requests"] as const)("loads %s from the existing commercial record", async section => {
  const record = { id: "linked-case" }, commercial = { caseId: "linked-case", canEdit: false, data: { quotes: [], requests: [] } };
  const fetcher = vi.fn(async (url: string) => Response.json(url.startsWith("/api/commercial/") ? commercial : record));
  vi.stubGlobal("fetch", fetcher);
  expect(await loadProjectPlanning(context, section, signal())).toEqual({ section, record, commercial });
  expect(fetcher).toHaveBeenCalledWith("/api/commercial/cases/linked-case?workspaceId=workspace", expect.anything());
});

it("does not replace permission errors with an empty list", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: 403 })));
  await expect(loadProjectPlanning(context, "requirements", signal())).rejects.toThrow("permission");
});

it("does not fabricate a planning case when a project has no link", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(loadProjectPlanning({ ...context, caseId: null }, "requirements", signal())).rejects.toThrow("no linked planning record");
  expect(fetcher).not.toHaveBeenCalled();
});

it("passes cancellation to every request", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn(async () => Response.json({}));
  vi.stubGlobal("fetch", fetcher);
  await loadProjectPlanning(context, "quotations", controller.signal);
  for (const call of vi.mocked(fetch).mock.calls) expect(call[1]?.signal).toBe(controller.signal);
});
