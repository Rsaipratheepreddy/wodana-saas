import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { DefinitionPageData } from "@/lib/pre-project/definition";
import { DefinitionPage } from "./definition-page";

const initial: DefinitionPageData = { workspaceId: "workspace", caseId: "case", definition: {
  caseStatus: "active", draft: { sourceHash: "hash", readyToPublish: true, issues: [] },
  current: { id: "baseline", number: 1, status: "awaiting_confirmation", current: true, message: "",
    publishedAt: "2026-09-17T12:15:30.500Z", publishedBy: "Owner", decision: null,
    snapshot: { definition: { brief: {}, rooms: [], items: [] } } },
  history: [], confirmed: false, nextAction: "REQUEST_DEFINITION_CONFIRMATION", canPublish: true, canRecordClientDecision: true,
}, readiness: { ready: false, summary: { includedItemCount: 1, readyItemCount: 0, blockerCount: 1, warningCount: 0 }, blockers: [] } };

afterEach(() => vi.restoreAllMocks());

describe("scope confirmation", () => {
  it("defaults an offline decision to the time the dialog opens, not page load", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-17T12:15:00Z").getTime());
    render(<DesignSystemProvider><DefinitionPage initial={initial} /></DesignSystemProvider>);
    const openedAt = new Date("2026-09-17T12:15:31Z").getTime();
    clock.mockReturnValue(openedAt);
    await userEvent.click(screen.getByRole("button", { name: "Record offline decision" }));
    const expected = new Date(openedAt - new Date().getTimezoneOffset() * 60_000 + 999).toISOString().slice(0, 19);
    expect((screen.getByLabelText("When received") as HTMLInputElement).value).toContain(expected);
    expect(screen.getByLabelText("When received")).toHaveAttribute("step", "1");
  });
  it('shows a plain-language diff when the requirements changed after publication',()=>{
    const changed=structuredClone(initial);if('error' in changed)throw new Error('fixture');changed.definition.current!.current=false;changed.definition.draft.changes={briefChanged:true,rooms:{added:['Study'],changed:['Bedroom → Primary bedroom'],removed:['Nursery']},items:{added:['Desk'],changed:['Wardrobe'],removed:[]},total:6};
    render(<DesignSystemProvider><DefinitionPage initial={changed}/></DesignSystemProvider>);
    expect(screen.getByRole('region',{name:'Changes since published scope'})).toHaveTextContent('Rooms updated · Bedroom → Primary bedroom');
    expect(screen.getByRole('region',{name:'Changes since published scope'})).toHaveTextContent('Scope added · Desk');
  });
});
