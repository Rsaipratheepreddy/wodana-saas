import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ChecklistGroupRead } from "@/lib/pre-project/design-workspace";
import { ProjectBrief } from "../project-core/project-brief";
import { changedAnswers, ChecklistAnswers } from "./site-checklist";

afterEach(() => vi.unstubAllGlobals());

const groups: ChecklistGroupRead[] = [
  { scope: null, section: "Project overview", pending: 0, items: [
    { key: "core.01", question: "What type of property is this?", kind: "answer", answer: "Villa", status: null, answeredByName: "Dana", answeredAt: "2026-10-14T09:00:00Z" },
    { key: "core.02", question: "Which rooms?", kind: "answer", answer: null, status: null, answeredByName: null, answeredAt: null }] },
  { scope: "Kitchens and islands", section: null, pending: 1, items: [
    { key: "kitchen.01", question: "Record appliance brand and model.", kind: "check", answer: "Client sends the hob model", status: "pending", answeredByName: "Dana", answeredAt: "2026-10-14T09:00:00Z" },
    { key: "kitchen.02", question: "Confirm worktop material.", kind: "check", answer: null, status: "confirmed", answeredByName: "Dana", answeredAt: "2026-10-14T09:00:00Z" },
    { key: "kitchen.03", question: "Confirm sink model.", kind: "check", answer: null, status: null, answeredByName: null, answeredAt: null }] },
];

describe("design checklists, read on the project and the factory", () => {
  it("shows the answers grouped as asked, with pending lines standing out", () => {
    render(<DesignSystemProvider><ChecklistAnswers groups={groups} /></DesignSystemProvider>);
    expect(screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual(["Project overview", "Kitchens and islands"]);
    const kitchen = within(screen.getByRole("region", { name: "Kitchens and islands" }));
    expect(kitchen.getByText("1 pending")).toBeInTheDocument();
    expect(kitchen.getByText("Record appliance brand and model.").closest("[data-pending]")).not.toBeNull();
    expect(kitchen.getByText("Client sends the hob model")).toBeInTheDocument();
    expect(kitchen.getByText("Confirmed")).toBeInTheDocument();
    expect(kitchen.getByText("Not marked")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Project overview" })).getByText("Not answered")).toBeInTheDocument();
  });

  it("loads the project's brief, with its empty state before design recorded any", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ groups, pending: 1, caseId: "c" }) }));
    const { unmount } = render(<DesignSystemProvider><ProjectBrief workspaceId="ws" projectId="p" version={1} /></DesignSystemProvider>);
    expect(await screen.findByRole("region", { name: "Kitchens and islands" })).toBeInTheDocument();
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("projects/p/brief");
    unmount();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ groups: [], pending: 0, caseId: null }) }));
    render(<DesignSystemProvider><ProjectBrief workspaceId="ws" projectId="p" version={1} /></DesignSystemProvider>);
    expect(await screen.findByText("No brief recorded")).toBeInTheDocument();
  });

  it("saves only what changed: a question's words, a line's status and note", () => {
    const checklist = [
      { key: "core.01", question: "Q", kind: "answer" as const, answer: "Villa", answeredByName: null, answeredAt: null },
      { key: "kitchen.01", question: "C", kind: "check" as const, answer: null, status: null, answeredByName: null, answeredAt: null },
    ];
    expect(changedAnswers(checklist, { "core.01": { answer: " Villa ", status: null }, "kitchen.01": { answer: "", status: "not_applicable" } }))
      .toEqual([{ key: "kitchen.01", answer: "", status: "not_applicable" }]);
  });
});
