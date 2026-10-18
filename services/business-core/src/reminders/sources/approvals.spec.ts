import { describe, expect, it } from "vitest";
import { jobLinks } from "./approvals";

const project = "11111111-1111-4111-8111-111111111111";
const designCase = "22222222-2222-4222-8222-222222222222";
const fakeDb = { query: async (sql: string) => ({ rows: sql.includes("delivery_projects") ? [{ id: project }] : sql.includes("pre_project_cases") ? [{ id: designCase }] : [] }) };

describe("approval reminders link only to what exists", () => {
  it("a design review's planning case is a case, never a project (the reminder's project link would fail)", async () => {
    const rows = [{ project: { id: project, reference: "PRJ-1", name: "Villa" } }, { project: { id: designCase, reference: "D-12", name: "Majlis" } }, { project: null }];
    const links = await jobLinks(fakeDb as never, "w", rows as never);
    expect([...links.projects]).toEqual([project]);
    expect([...links.cases]).toEqual([designCase]);
  });
});
