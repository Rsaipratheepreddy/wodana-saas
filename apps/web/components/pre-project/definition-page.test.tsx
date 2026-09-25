import { render, screen, waitFor } from "@testing-library/react";
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
    const expected = new Date(openedAt).toISOString();
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => ({ok:true,json:async()=> options?.method === "POST" ? {} : String(_url).includes("readiness") ? initial.readiness : initial.definition}) as Response);
    await userEvent.type(screen.getByRole("textbox", {name:"Client name"}), "Sample client");
    await userEvent.type(screen.getByRole("textbox", {name:"Evidence reference"}), "Test meeting record");
    await userEvent.click(screen.getByRole("button", {name:"Save decision"}));
    await waitFor(() => expect(request).toHaveBeenCalled());
    const call=request.mock.calls.find(([,options])=>options?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({decidedAt:expected,decisionBy:"Sample client",evidence:"Test meeting record"});
  });
  it('shows a plain-language diff when the requirements changed after publication',()=>{
    const changed=structuredClone(initial);if('error' in changed)throw new Error('fixture');changed.definition.current!.current=false;changed.definition.draft.changes={briefChanged:true,rooms:{added:['Study'],changed:['Bedroom → Primary bedroom'],removed:['Nursery']},items:{added:['Desk'],changed:['Wardrobe'],removed:[]},total:6};
    render(<DesignSystemProvider><DefinitionPage initial={changed}/></DesignSystemProvider>);
    expect(screen.getByRole('region',{name:'Changes since published scope'})).toHaveTextContent('Rooms updated · Bedroom → Primary bedroom');
    expect(screen.getByRole('region',{name:'Changes since published scope'})).toHaveTextContent('Scope added · Desk');
  });
  it('shows captured words in the published scope without requiring rewritten specifications',()=>{
    const value=structuredClone(initial);
    value.definition.current!.snapshot.definition.items=[{id:'item',title:'Wardrobe',roomName:null,scopeStatus:'included',quantity:null,unit:'nos',requirement:'Keep the existing doors.',specification:null}];
    render(<DesignSystemProvider><DefinitionPage initial={value}/></DesignSystemProvider>);
    expect(screen.getByRole('region',{name:'Published scope'})).toHaveTextContent('Keep the existing doors.');
    expect(screen.queryByRole('region',{name:'Quotation readiness'})).not.toBeInTheDocument();
  });
  it('keeps the client decision draft after a rejected save',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:false,json:async()=>({message:'This scope changed. Refresh before recording a decision.'})} as Response);
    render(<DesignSystemProvider><DefinitionPage initial={initial}/></DesignSystemProvider>);
    const user=userEvent.setup();
    await user.click(screen.getByRole('button',{name:'Record offline decision'}));
    await user.type(screen.getByRole('textbox',{name:'Client name'}),'Sample client');
    await user.type(screen.getByRole('textbox',{name:'Evidence reference'}),'Meeting record');
    await user.click(screen.getByRole('button',{name:'Save decision'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('This scope changed');
    expect(screen.getByRole('textbox',{name:'Client name'})).toHaveValue('Sample client');
    expect(screen.getByRole('textbox',{name:'Evidence reference'})).toHaveValue('Meeting record');
  });
  it('does not expose publishing or decision controls to viewers',()=>{
    render(<DesignSystemProvider><DefinitionPage initial={{...initial,definition:{...initial.definition,canPublish:false,canRecordClientDecision:false}}}/></DesignSystemProvider>);
    expect(screen.queryByRole('button',{name:'Send for confirmation'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Record offline decision'})).not.toBeInTheDocument();
  });

});
