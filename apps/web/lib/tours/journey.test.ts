import { describe, expect, it, vi } from "vitest";
import { loadJourney, pickJourney } from "./journey";

describe("the job a walkthrough follows", () => {
  it("follows the job that has gone furthest, else the first real planning case", () => {
    const cases = [
      { id: "lead", status: "qualified", qualifiedLead: true },
      { id: "new-case", status: "active" },
      { id: "procuring", status: "released", projectId: "p1" },
      { id: "finished", status: "released", projectId: "p2" },
      { id: "dropped", status: "released", projectId: "p3" },
    ];
    const projects = [
      { id: "p1", status: "active", stage: { position: 3, count: 8 } },
      { id: "p2", status: "completed", stage: { position: 8, count: 8 } },
      { id: "p3", status: "cancelled", stage: { position: 7, count: 8 } },
    ];
    expect(pickJourney(cases, projects)).toEqual({ case: "finished", project: "p2" });
    expect(pickJourney(cases, projects.slice(0, 1))).toEqual({ case: "procuring", project: "p1" });
    // No released project yet: the first real case (never a lead that has no case).
    expect(pickJourney(cases.slice(0, 2), [])).toEqual({ case: "new-case" });
    expect(pickJourney([], [])).toEqual({});
  });

  it("only reads, and copes with a workspace it can't read", async () => {
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      return url.includes("pre-projects") ? Response.json({ items: [{ id: "c1", status: "active", projectId: "p1" }] }) : Response.json({ projects: [{ id: "p1", status: "active", stage: null }] });
    });
    expect(await loadJourney("w1", "furthest-job", request)).toEqual({ case: "c1", project: "p1" });
    expect(request).toHaveBeenCalledWith("/api/workspace/pre-projects?workspaceId=w1", { cache: "no-store" });
    expect(await loadJourney("w1", "furthest-job", async () => new Response("", { status: 403 }))).toEqual({});
    expect(await loadJourney("", "furthest-job", request)).toEqual({});
  });

  it("finds a quote still being prepared for the quoting tour, among cases not yet released", async () => {
    const quotes: Record<string, unknown[]> = {
      empty: [],
      fee: [{ status: "accepted", kind: "quotation", round: "design", lines: [{}] }],
      fitout: [{ status: "draft", kind: "quotation", round: "main", lines: [{}, {}] }],
    };
    const request = vi.fn(async (url: string) => {
      if (url.includes("pre-projects")) return Response.json({ items: [{ id: "empty", status: "active" }, { id: "fee", status: "active" }, { id: "fitout", status: "active" }, { id: "released", status: "released", projectId: "p1" }] });
      const id = /cases\/([^?]+)/.exec(url)?.[1] ?? "";
      return Response.json({ data: { quotes: quotes[id] ?? [] } });
    });
    expect(await loadJourney("w1", "quote-in-progress", request)).toEqual({ case: "fitout" });
    expect(request).not.toHaveBeenCalledWith(expect.stringContaining("/cases/released"), expect.anything());
  });
});
