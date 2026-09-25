import { describe, expect, it, vi } from "vitest";
import { ClientPortalService } from "./client-portal.service";

function setup({ published = false, authorized = true, selected = true, progress = true } = {}) {
  const content = {
    clientSections: { progress },
    files: [{ id: "photo", recordId: "original", mimeType: "image/png" }],
    reports: [
      { id: "original", status: "approved", publishedAt: "2026-09-20", clientFileIds: selected ? ["photo"] : [] },
      { id: "correction", status: "approved", supersedes: "original", publishedAt: published ? "2026-09-22" : undefined },
    ],
  };
  const query = vi.fn().mockResolvedValue({ rows: [{ case_id: "case", content }] });
  const read = vi.fn().mockResolvedValue({ body: Buffer.from("synthetic image") });
  // Isolate file authorization from session/branding infrastructure without
  // bypassing the actual project grant and publication checks under test.
  const service = Object.assign(Object.create(ClientPortalService.prototype), {
    db: { tenantTransaction: async (_workspace: string, _actor: string, work: (client: { query: typeof query }) => unknown) => work({ query }) },
    storage: { read },
    branding: vi.fn().mockResolvedValue({ workspaceId: "workspace" }),
    session: vi.fn().mockResolvedValue({ grants: [{ caseId: authorized ? "case" : "other-case" }] }),
  }) as ClientPortalService;
  return { read, query, get: () => service.projectFile("portal", "token", "project", "photo") };
}

describe("published project file authorization", () => {
  it("keeps the published report photo available until its correction is published", async () => {
    const { get, read, query } = setup();
    await expect(get()).resolves.toMatchObject({ mimeType: "image/png" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("p.workspace_id=$1 AND p.id=$2"), ["workspace", "project"]);
    expect(read).toHaveBeenCalledWith("projects/workspace/project/photo");
  });

  it.each([
    { published: true },
    { authorized: false },
    { selected: false },
    { progress: false },
  ])("denies superseded, unauthorized or unselected files: %j", async (options) => {
    const { get, read } = setup(options);
    await expect(get()).rejects.toThrow("Shared file not available.");
    expect(read).not.toHaveBeenCalled();
  });
});
