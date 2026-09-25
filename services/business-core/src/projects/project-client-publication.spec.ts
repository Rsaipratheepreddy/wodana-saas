import { describe, expect, it } from "vitest";
import { applyExecution, emptyProject, publicProject, type ExecutionActor } from "./execution.domain";
import { applyClientPublication, projectClientSections } from "./project-client-publication";
import type { ProjectData } from "./execution.types";

const author: ExecutionActor = { id: "author", name: "Foreman", manage: false, review: false, report: true, buy: false, memberIds: ["author", "reviewer"], resourceIds: [], now: "2026-09-22T10:00:00Z", released: true };
const reviewer: ExecutionActor = { ...author, id: "reviewer", name: "Reviewer", manage: true, review: true };
const message = { title: "Site update", summary: "The team will confirm the next visit tomorrow.", kind: "general" };
function draft(data = emptyProject()) {
  const id = applyExecution(data, "client_update_save", { update: message }, author);
  return { data, id };
}

describe("project client publication", () => {
  it("requires submission and an independent reviewer; exposes only approved wording", () => {
    const { data, id } = draft();
    expect(publicProject("project", "Villa", data).clientUpdates).toEqual([]);
    expect(() => applyExecution(data, "client_update_publish", { id }, reviewer)).toThrow(/Submit/);
    applyExecution(data, "client_update_submit", { id }, author);
    expect(() => applyExecution(data, "client_update_publish", { id }, { ...author, review: true })).toThrow(/Another reviewer/);
    applyExecution(data, "client_update_publish", { id }, reviewer);
    expect(publicProject("project", "Villa", data).clientUpdates).toEqual([{ id, ...message, status: "published", publishedAt: reviewer.now, revision: 1 }]);
    expect(data.clientUpdates?.[0].reviewerId).toBe("reviewer");
    expect(data.audit.at(-1)).toMatchObject({ action: "client_update_publish", recordId: id });
    expect(() => applyExecution(data, "client_update_save", { update: { ...message, id } }, author)).toThrow(/Withdraw/);
    applyExecution(data, "client_update_withdraw", { id }, reviewer);
    expect(publicProject("project", "Villa", data).clientUpdates).toEqual([]);
    applyExecution(data, "client_update_save", { update: { ...message, id, summary: "A revised visit is planned." } }, author);
    expect(data.clientUpdateHistory).toEqual([expect.objectContaining({
      id, summary: message.summary, status: "withdrawn", publishedAt: reviewer.now, reviewerId: reviewer.id,
      revision: 1, archivedBy: author.id, archivedAt: author.now,
    })]);
    expect(data.clientUpdates?.[0].summary).toBe("A revised visit is planned.");
    expect(publicProject("project", "Villa", data)).not.toHaveProperty("clientUpdateHistory");
  });

  it("makes a manager's edited wording require another reviewer", () => {
    const { data, id } = draft();
    applyExecution(data, "client_update_submit", { id }, author);
    applyExecution(data, "client_update_save", { update: { ...message, id, summary: "Revised wording" } }, reviewer);
    expect(data.clientUpdates?.[0]).toMatchObject({ status: "draft", authorId: reviewer.id, revision: 2 });
    applyExecution(data, "client_update_submit", { id }, reviewer);
    expect(() => applyExecution(data, "client_update_publish", { id }, reviewer)).toThrow(/Another reviewer/);
  });

  it.each(["task", "report", "order", "dispatch", "snag"] as const)("validates linked %s at save and publication", sourceType => {
    const data = emptyProject();
    const collection = { task: "tasks", report: "reports", order: "orders", dispatch: "dispatches", snag: "snags" }[sourceType];
    const input = { ...message, kind: "delay", sourceType, sourceId: "source" };
    expect(() => applyClientPublication(data, "client_update_save", { update: input }, author)).toThrow(/this project/);
    (data as unknown as Record<string, unknown>)[collection] = [{ id: "source" }];
    const id = applyClientPublication(data, "client_update_save", { update: input }, author)!;
    applyClientPublication(data, "client_update_submit", { id }, author);
    (data as unknown as Record<string, unknown>)[collection] = [];
    expect(() => applyClientPublication(data, "client_update_publish", { id }, reviewer)).toThrow(/this project/);
    expect(data.clientUpdates?.[0].status).toBe("submitted");
  });

  it("rejects mismatched links, unsupported sources and unprivileged changes", () => {
    const data = emptyProject();
    for (const update of [{ ...message, kind: "issue" }, { ...message, sourceId: "other" }, { ...message, sourceType: "employee", sourceId: "employee" }])
      expect(() => applyClientPublication(data, "client_update_save", { update }, author)).toThrow();
    expect(() => applyClientPublication(data, "client_update_save", { update: message }, { ...author, report: false })).toThrow(/permission/);
    const id = applyClientPublication(data, "client_update_save", { update: message }, author)!;
    expect(() => applyClientPublication(data, "client_update_submit", { id }, { ...author, id: "other" })).toThrow(/Only the author/);
    expect(() => applyClientPublication(data, "client_update_withdraw", { id }, author)).toThrow(/reviewer/);
  });

  it("defaults legacy visibility on, requires review and validates all visibility fields", () => {
    const data = emptyProject();
    const sections = { progress: false, documents: false, handover: false, updates: false };
    expect(projectClientSections(data)).toEqual({ progress: true, documents: true, handover: true, updates: true });
    expect(() => applyExecution(data, "client_sections_save", { sections }, author)).toThrow(/reviewer/);
    expect(() => applyExecution(data, "client_sections_save", { sections: { progress: false } }, reviewer)).toThrow(/every/);
    applyExecution(data, "client_sections_save", { sections }, reviewer);
    expect(publicProject("p", "Villa", data).clientSections).toEqual(sections);
  });

  it("hides data on the server including packet duplicates and allows aftercare publication", () => {
    const { data, id } = draft();
    applyExecution(data, "client_update_submit", { id }, author);
    data.phase = "completed";
    applyExecution(data, "client_update_publish", { id }, reviewer);
    const recordData = { ...data, clientSections: { progress: false, documents: false, handover: false, updates: false },
      documents: [{ id: "private-document", published: true, status: "approved" }],
      handovers: [{ id: "h", published: true, outstandingItems: [], packet: { id: "pack", version: 1, tasks: [{ id: "private-task" }], documents: [{ id: "private-document" }] } }],
      snags: [{ id: "claim", handoverId: "h" }], milestones: [{ id: "m", visibleToClient: true, dueDate: "2026-09-01", taskIds: [] }],
    } as unknown as ProjectData;
    const hidden = publicProject("p", "Villa", recordData);
    expect(hidden).toMatchObject({ progress: 0, tasks: [], reports: [], documents: [], handovers: [], warrantyClaims: [], milestones: [], clientUpdates: [], alerts: [] });
    recordData.clientSections!.handover = true;
    const packet = publicProject("p", "Villa", recordData).handovers[0].packet;
    expect(packet).toEqual({ id: "pack", version: 1, tasks: [], documents: [] });
  });
});
