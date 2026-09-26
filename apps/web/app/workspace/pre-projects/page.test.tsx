import { beforeEach, describe, expect, it, vi } from "vitest";

const getPreProjects = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pre-project/server", () => ({ getPreProjects }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
const loadProjectsBoard = vi.hoisted(() => vi.fn());
vi.mock("@/lib/projects/board.server", () => ({ loadProjectsBoard }));

import Page from "./page";

const caseId = "00000000-0000-4000-8000-000000000001";
const data = { workspaceId: "workspace", items: [], total: 0, canCreate: false };

describe("Planning entry and saved selectors", () => {
  beforeEach(() => { getPreProjects.mockReset().mockResolvedValue(data); });

  it("opens the Planning board by default", async () => {
    loadProjectsBoard.mockResolvedValue({ projects: [], planning: data, palmFlowEnabled: false });
    const element = await Page({ searchParams: Promise.resolve({}) });
    expect(element.props.mode).toBe("planning");
    expect(element.props.planning).toBe(data);
  });

  it("opens a saved section in the case selector", async () => {
    const element = await Page({ searchParams: Promise.resolve({ section: "inspiration", search: "Villa" }) });
    expect(element.props.search).toBe("search=Villa&section=inspiration");
    expect(element.props.initialData).toBe(data);
    expect(getPreProjects).toHaveBeenCalledWith(new URLSearchParams("search=Villa&section=inspiration"));
  });

  it("opens a valid saved case directly in its requested section", async () => {
    await expect(Page({ searchParams: Promise.resolve({ section: "inspiration", record: caseId }) }))
      .rejects.toThrow(`redirect:/workspace/pre-projects/cases/${caseId}/inspiration?section=inspiration`);
    expect(getPreProjects).not.toHaveBeenCalled();
  });

  it("does not navigate to an unvalidated case identifier", async () => {
    const element = await Page({ searchParams: Promise.resolve({ section: "requirements", record: "not-a-case" }) });
    expect(element.props.search).toBe("section=requirements");
  });
});
