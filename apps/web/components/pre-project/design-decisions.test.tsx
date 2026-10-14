import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CaseDesign } from "@/lib/pre-project/content";
import { lineTotal, revisionDetail, signedAmount, type LedgerEntry, type LedgerVersion, type LedgerView, type PresentationsView } from "@/lib/pre-project/design-decisions";
import { openSiteVisit, type JourneyStageView, type JourneyView } from "@/lib/pre-project/design-workspace";
import { DesignLedger } from "./design-ledger";
import { DesignPresentations } from "./design-presentations";
import { SiteVisitFlow, siteVisitProgress, type SiteVisitAccess } from "./site-visit-flow";

afterEach(() => vi.unstubAllGlobals());
const json = (value: unknown) => ({ ok: true, json: async () => value });
const body = (fetcher: ReturnType<typeof vi.fn>, match: string) => JSON.parse(((fetcher.mock.calls as Array<[string, RequestInit | undefined]>).find(([url, init]) => String(url).includes(match) && init?.method === "POST") ?? ["", { body: "null" }])[1]!.body as string);

describe("money and counters on the design flow", () => {
  it("multiplies quantity by price exactly and signs impacts", () => {
    expect(lineTotal("0.1", "0.2")).toBe("0.02");
    expect(lineTotal("12.5", "95.50")).toBe("1193.75");
    expect(lineTotal("3", "19.99")).toBe("59.97");
    expect(lineTotal(null, "10")).toBeNull();
    expect(signedAmount("193.75")).toBe("+193.75");
    expect(signedAmount("-200.00")).toBe("-200.00");
    expect(signedAmount("0.00")).toBeNull();
    expect(revisionDetail({ used: 1, included: 2, chargeable: false })).toEqual({ key: "Revision {used} of {included}", values: { used: 1, included: 2 } });
    expect(revisionDetail({ used: 3, included: 2, chargeable: true })).toEqual({ key: "Revision {used} · chargeable", values: { used: 3 } });
    expect(revisionDetail({ used: 0, included: 2, chargeable: false })).toBeNull();
  });
});

describe("the guided site visit (PLM-048/128)", () => {
  const stage: JourneyStageView = { stage: "site_visit", label: "Site visit", status: "active", ownerName: "Dana", dueAt: "2031-04-03T10:00:00Z", completedAt: null, overdue: false, version: 5,
    scheduledAt: "2031-04-02T09:00:00Z", scheduledEnd: null, scheduledTimezone: "Europe/London", scheduledLocation: { address: "Villa 12" } };
  const view = (over: Partial<JourneyView> = {}): JourneyView => ({ journey: { packageName: "Bespoke", includedRevisions: 2 }, timezone: "Europe/London", stages: [stage],
    measurements: [{ title: "Living", status: "measured", files: 2, roomId: "r1" }, { title: "Kitchen", status: "incomplete", files: 0, roomId: "r2" }],
    checklist: [{ key: "access", question: "How do we get in?", answer: "Service lift", answeredByName: "Dana", answeredAt: null }, { key: "services", question: "Where are the services?", answer: null, answeredByName: null, answeredAt: null }],
    siteEvidenceProblem: "Finish the measurements for Kitchen", siteChecklistProblem: "Answer the last site visit question", ...over });

  it("works out which steps are done from the visit's facts", () => {
    expect(siteVisitProgress(view())).toEqual({ visit: true, measurements: false, photos: false, questions: false, finish: false });
    expect(siteVisitProgress(view({ measurements: [{ title: "Living", status: "verified", files: 1 }], checklist: [] }))).toMatchObject({ measurements: true, photos: true, questions: true });
  });

  it("walks visit → measurements → photos → questions → complete, saving answers and blocking completion until everything is in", async () => {
    const onMeasure = vi.fn(), onAddPhotos = vi.fn(), onSaveAnswers = vi.fn(async () => undefined), onComplete = vi.fn(async () => undefined);
    render(<DesignSystemProvider><SiteVisitFlow view={view()} stage={stage} onClose={vi.fn()} onBook={vi.fn()} onMeasure={onMeasure} onAddPhotos={onAddPhotos} onSaveAnswers={onSaveAnswers} onComplete={onComplete} /></DesignSystemProvider>);
    const steps = await screen.findByRole("navigation", { name: "Site visit steps" });
    // It opens on the first step that isn't done.
    expect(within(steps).getByRole("button", { name: /Measurements/ })).toHaveAttribute("aria-current", "step");
    expect(within(steps).getByRole("button", { name: /Visit/ })).toHaveAttribute("data-done", "true");
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(onMeasure).toHaveBeenCalledWith("r2");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "0 photos" }));
    expect(onAddPhotos).toHaveBeenCalledWith("r2");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("1 of 2 answered")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Where are the services?" }), { target: { value: "Two DBs in the corridor" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(onSaveAnswers).toHaveBeenCalledWith([{ key: "services", answer: "Two DBs in the corridor" }]));
    expect(await screen.findByText("Finish the measurements for Kitchen")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /What was found on site/ }), { target: { value: "All measured" } });
    expect(screen.getByRole("button", { name: "Complete site visit" })).toBeDisabled();
  });

  it("completes the visit when every wall is measured and photographed and every question answered", async () => {
    const onComplete = vi.fn(async () => undefined);
    const ready = view({ measurements: [{ title: "Living", status: "measured", files: 2, roomId: "r1" }], checklist: [{ key: "access", question: "How do we get in?", answer: "Lift", answeredByName: "Dana", answeredAt: null }],
      siteEvidenceProblem: null, siteChecklistProblem: null });
    render(<DesignSystemProvider><SiteVisitFlow view={ready} stage={stage} onClose={vi.fn()} onBook={vi.fn()} onMeasure={vi.fn()} onAddPhotos={vi.fn()} onSaveAnswers={vi.fn()} onComplete={onComplete} /></DesignSystemProvider>);
    expect(await screen.findByText("Everything is in.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /What was found on site/ }), { target: { value: "All walls measured" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete site visit" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("All walls measured"));
  });

  it("asks the questions by scope, the job's scopes first, and doesn't wait for a scope the job doesn't have (PLM-154)", async () => {
    const scoped = view({
      checklist: [
        { key: "access", question: "How do we get in?", answer: "Lift", answeredByName: "Dana", answeredAt: null, required: true },
        { key: "family", question: "How big is the family?", scope: "Kitchen", answer: "Five", answeredByName: "Dana", answeredAt: null, required: true },
        { key: "beds", question: "Bed sizes?", scope: "Bedrooms", answer: null, answeredByName: null, answeredAt: null, required: false },
      ],
      checklistGroups: [{ scope: null, matches: true, required: true, keys: ["access"] }, { scope: "Kitchen", matches: true, required: true, keys: ["family"] },
        { scope: "Bedrooms", matches: false, required: false, keys: ["beds"] }],
    });
    expect(siteVisitProgress(scoped).questions).toBe(true);
    render(<DesignSystemProvider><SiteVisitFlow view={scoped} stage={stage} onClose={vi.fn()} onBook={vi.fn()} onMeasure={vi.fn()} onAddPhotos={vi.fn()} onSaveAnswers={vi.fn()} onComplete={vi.fn()} /></DesignSystemProvider>);
    fireEvent.click(within(await screen.findByRole("navigation", { name: "Site visit steps" })).getByRole("button", { name: /Questions/ }));
    expect(screen.getByText("2 of 2 answered")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual(["General", "Kitchen", "Bedrooms"]);
    expect(within(screen.getByRole("region", { name: "Kitchen" })).getByRole("textbox", { name: "How big is the family?" })).toBeInTheDocument();
    // A scope the job doesn't have isn't asked: its name only.
    expect(within(screen.getByRole("region", { name: "Bedrooms" })).getByText("Not for this job")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Bed sizes?" })).toBeNull();
  });

  it("asks general questions by section and marks checklist lines with a status and a note; a checklist is switched on for the job", async () => {
    const onSaveAnswers = vi.fn().mockResolvedValue(undefined);
    const onApplies = vi.fn().mockResolvedValue(undefined);
    const listed = view({
      checklist: [
        { key: "core.01", question: "What type of property is this?", section: "Project overview", kind: "answer", answer: "Villa", answeredByName: "Dana", answeredAt: null, required: true },
        { key: "kitchen.01", question: "Record appliance brand and model.", scope: "Kitchens and islands", kind: "check", answer: null, status: null, answeredByName: null, answeredAt: null, required: true },
        { key: "media.01", question: "Confirm TV size.", scope: "TV and media walls", kind: "check", answer: null, status: null, answeredByName: null, answeredAt: null, required: false },
      ],
      checklistGroups: [{ scope: null, section: "Project overview", matches: true, applies: true, required: true, keys: ["core.01"] },
        { scope: "Kitchens and islands", matches: true, applies: true, chosen: null, required: true, choiceVersion: 0, pending: 0, keys: ["kitchen.01"] },
        { scope: "TV and media walls", matches: false, applies: false, chosen: null, required: false, choiceVersion: 0, pending: 0, keys: ["media.01"] }],
    });
    // The checklist line isn't marked yet.
    expect(siteVisitProgress(listed).questions).toBe(false);
    render(<DesignSystemProvider><SiteVisitFlow view={listed} stage={stage} onClose={vi.fn()} onBook={vi.fn()} onMeasure={vi.fn()} onAddPhotos={vi.fn()}
      onSaveAnswers={onSaveAnswers} onApplies={onApplies} onComplete={vi.fn()} /></DesignSystemProvider>);
    fireEvent.click(within(await screen.findByRole("navigation", { name: "Site visit steps" })).getByRole("button", { name: /Questions/ }));
    expect(screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual(["Project overview", "Kitchens and islands", "TV and media walls"]);
    const kitchen = within(screen.getByRole("region", { name: "Kitchens and islands" }));
    fireEvent.click(kitchen.getByRole("radio", { name: "Pending" }));
    fireEvent.change(kitchen.getByRole("textbox", { name: "Requirement or reference" }), { target: { value: "Client sends the hob model" } });
    // "Applies to this job" on the TV wall checklist.
    fireEvent.click(within(screen.getByRole("region", { name: "TV and media walls" })).getByRole("switch", { name: "Applies to this job" }));
    expect(onApplies).toHaveBeenCalledWith(expect.objectContaining({ scope: "TV and media walls" }), true);
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await vi.waitFor(() => expect(onSaveAnswers).toHaveBeenCalledWith([{ key: "kitchen.01", answer: "Client sends the hob model", status: "pending" }]));
    expect(siteVisitProgress({ ...listed, checklist: listed.checklist!.map((item) => item.key === "kitchen.01" ? { ...item, status: "pending" as const } : item) }).questions).toBe(true);
  });

  it("opens the design site measure inside the concept as the visit to run (PLM-141)", () => {
    const measure: JourneyView = { journey: { packageName: "Bespoke", includedRevisions: 2, flowVersion: 2 }, timezone: "Europe/London",
      stages: [{ ...stage, stage: "concepts", label: "Concepts", version: 3 }],
      siteVisit: { within: "task", open: true, done: false, version: 7, dueAt: "2031-04-05T10:00:00Z", ownerName: "Lina", scheduledAt: null, completedAt: null, overdue: false } };
    expect(openSiteVisit(measure)).toMatchObject({ stage: "site_visit", status: "active", version: 7, dueAt: "2031-04-05T10:00:00Z", ownerName: "Lina" });
    expect(openSiteVisit({ ...measure, siteVisit: { ...measure.siteVisit!, open: false, done: true } })).toBeNull();
    expect(openSiteVisit(view())).toMatchObject({ stage: "site_visit", version: 5 });
  });
});

describe("the site visit's access step (R5 fit check)", () => {
  const stage: JourneyStageView = { stage: "site_visit", label: "Site visit", status: "active", ownerName: "Dana", dueAt: null, completedAt: null, overdue: false, version: 5,
    scheduledAt: "2031-04-02T09:00:00Z", scheduledEnd: null, scheduledTimezone: "Europe/London", scheduledLocation: null };
  const ready: JourneyView = { journey: { packageName: null, includedRevisions: null, kind: "site_and_materials" }, timezone: "Europe/London", stages: [stage],
    measurements: [{ title: "Living", status: "measured", files: 1, roomId: "r1" }], checklist: [], siteEvidenceProblem: null, siteChecklistProblem: null };
  const access = (over: Partial<SiteVisitAccess> = {}): SiteVisitAccess => ({ workspaceId: "w", caseId: "c1", canEdit: true, count: 0, nudge: true, onChanged: vi.fn(), ...over });
  const flow = (view: JourneyView, accessProps: SiteVisitAccess, onComplete = vi.fn(async () => undefined)) => render(<DesignSystemProvider>
    <SiteVisitFlow view={view} stage={stage} access={accessProps} onClose={vi.fn()} onBook={vi.fn()} onMeasure={vi.fn()} onAddPhotos={vi.fn()} onSaveAnswers={vi.fn()} onComplete={onComplete} />
  </DesignSystemProvider>);

  it("on a furniture job opens on Access, nudges for the way in and records a door in the region's unit", async () => {
    let saved = false;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") { saved = true; return json({ id: "p1" }); }
      return json({ points: saved ? [{ id: "p1", route: "Main", position: 0, kind: "door", label: "Front door", unit: "in", width: "36.00", height: "80.00", turnWidth: null, cabinWidth: null, cabinDepth: null, cabinHeight: null, siteRecordId: null, note: "", version: 1 }] : [], defaultUnit: "in" });
    });
    vi.stubGlobal("fetch", fetcher);
    const props = access();
    flow(ready, props);
    const steps = await screen.findByRole("navigation", { name: "Site visit steps" });
    expect(within(steps).getByRole("button", { name: /Access/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/Furniture and joinery have to get through/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Add access point" }));
    const dialog = (await screen.findAllByRole("dialog")).at(-1)!;
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Name/ }), { target: { value: "Front door" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Clear width" }), { target: { value: "36" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Clear height" }), { target: { value: "80" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
    const [url, init] = (fetcher.mock.calls as Array<[string, RequestInit | undefined]>).find(([, request]) => request?.method === "PUT")!;
    expect(url).toMatch(/\/api\/workspace\/product-sourcing\/cases\/c1\/access-points\/[0-9a-f-]{36}\?/);
    expect(JSON.parse(init!.body as string)).toMatchObject({ version: 0, route: "Main", position: 0, kind: "door", label: "Front door", unit: "in", width: "36", height: "80", cabinWidth: null });
    expect(await screen.findByText("Front door")).toBeInTheDocument();
  });

  it("never needs access points to complete the visit; without them it only says so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ points: [], defaultUnit: "cm" })));
    const onComplete = vi.fn(async () => undefined);
    flow(ready, access(), onComplete);
    const steps = await screen.findByRole("navigation", { name: "Site visit steps" });
    fireEvent.click(within(steps).getByRole("button", { name: /Complete/ }));
    expect(screen.getByText("No access measured. Items can't be checked against the way in.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /What was found on site/ }), { target: { value: "All measured" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete site visit" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("All measured"));
  });

  it("on a design job the step is optional: the flow skips it and doesn't nudge", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ points: [], defaultUnit: "cm" })));
    flow({ ...ready, journey: { packageName: "Bespoke", includedRevisions: 2, kind: "design" } }, access({ nudge: false }));
    const steps = await screen.findByRole("navigation", { name: "Site visit steps" });
    expect(within(steps).getByRole("button", { name: /Complete/ })).toHaveAttribute("aria-current", "step");
    expect(screen.queryByText(/No access measured/)).not.toBeInTheDocument();
    expect(within(steps).getByRole("button", { name: /Access/ })).not.toHaveAttribute("data-done");
  });
});

describe("concept presentations (PLM-049/051)", () => {
  const designs = [{ id: "d1", title: "Living board", stage: "concepts", archivedAt: null, versions: [{ id: "v1", number: 1, asset: { id: "a1", name: "living.png", mimeType: "image/png", byteSize: 1, hasPreview: true } }] }] as unknown as CaseDesign[];
  const presented: PresentationsView = { revisions: { concepts: { used: 3, included: 2, chargeable: true } }, presentations: [{ id: "p4", stage: "concepts", round: 4, status: "presented", chargeable: true, presentedAt: "2031-04-01T10:00:00Z",
    presentedByName: "Dana", chosenOptionId: null, decidedAt: null, decidedByName: null, decisionSource: null, decisionNote: null, fromPortal: false, version: 2,
    options: [{ id: "o1", position: 0, title: "Warm minimal", note: "", linkUrl: "https://www.canva.com/design/warm", designId: null, designTitle: null, versionId: null, versionNumber: null, mimeType: null, hasPreview: false },
      { id: "o2", position: 1, title: "Living board", note: "", linkUrl: null, designId: "d1", designTitle: "Living board", versionId: "v1", versionNumber: 1, mimeType: "image/png", hasPreview: true }] }] };

  it("shows each option as a card, flags the chargeable revision and records the client's choice with where it was made", async () => {
    const fetcher = vi.fn(async (url: string) => json(url.includes("/decision") ? { ...presented, presentations: [{ ...presented.presentations[0], status: "chosen", chosenOptionId: "o2" }] } : presented));
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><DesignPresentations workspaceId="w" caseId="c1" stage="concepts" designs={designs} canEdit canRecordClient clientName="Maya" /></DesignSystemProvider>);
    expect(await screen.findByText("Revision 3 · chargeable")).toBeInTheDocument();
    expect(screen.getByText("Chargeable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open in Canva/ })).toHaveAttribute("href", "https://www.canva.com/design/warm");
    expect(screen.queryByRole("button", { name: "New revision" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record client's decision" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body(fetcher, "/decision")).toMatchObject({ version: 2, decision: "chosen", optionId: "o1", source: "meeting", decidedBy: "Maya" }));
    expect(await screen.findByText("Client's choice")).toBeInTheDocument();
  });

  it("prepares a new presentation from Canva links, with stable ids for a safe retry", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => json(init?.method === "POST" ? { ...presented, presentations: [] } : { presentations: [], revisions: { concepts: { used: 0, included: 2, chargeable: false } } }));
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><DesignPresentations workspaceId="w" caseId="c1" stage="concepts" designs={[]} canEdit canRecordClient /></DesignSystemProvider>);
    fireEvent.click((await screen.findAllByRole("button", { name: "New presentation" }))[0]);
    const dialog = await screen.findByRole("dialog");
    const titles = within(dialog).getAllByRole("textbox", { name: /Option \d/ });
    fireEvent.change(titles[0], { target: { value: "Warm minimal" } });
    fireEvent.change(titles[1], { target: { value: "Coastal" } });
    const links = within(dialog).getAllByRole("textbox", { name: "Link" });
    fireEvent.change(links[0], { target: { value: "https://www.canva.com/design/warm" } });
    fireEvent.change(links[1], { target: { value: "https://www.canva.com/design/coastal" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body(fetcher, "design-presentations")).toMatchObject({ stage: "concepts", options: [{ title: "Warm minimal", linkUrl: "https://www.canva.com/design/warm", designId: null }, { title: "Coastal" }] }));
    expect(body(fetcher, "design-presentations").id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("the materials and decisions ledger (PLM-054, E5-1/E5-2)", () => {
  const version = (over: Partial<LedgerVersion>): LedgerVersion => ({ id: "v1", entryId: "e1", number: 1, title: "Oak veneer", specification: "Natural, matt", catalogItemId: null, supplier: "", quantity: "12.5", unit: "sqm",
    unitPrice: "80.00", currency: "AED", priceImpact: "1000.00", timeImpactDays: 0, source: "showroom", saidAt: "2031-04-01T10:00:00Z", evidenceAssetId: null, evidenceName: "board.jpg", evidenceNote: "Showroom board",
    note: "", afterLock: false, status: "confirmed", confirmedAt: "2031-04-02T10:00:00Z", confirmationMethod: "portal", confirmedByName: "Maya Client", fromPortal: false, recordedByName: "Dana", recordedAt: "2031-04-01T10:00:00Z", ...over });
  const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({ id: "e1", kind: "material", roomId: null, roomName: "Living", position: 0, currentNumber: 1, archivedAt: null, archivedAfterLock: false, version: 2, title: "Oak veneer",
    current: version({}), locked: null, versions: [version({})], ...over });
  const changed: LedgerView = { state: "changes_pending", lockProblem: "Waiting for the client's confirmation: Smoked oak", currency: "AED", lock: { number: 1, reason: "design_sign_off", lockedAt: "2031-04-05T10:00:00Z", lockedByName: "Omar", note: null },
    canEdit: true, canRecordClient: true, canApprove: true,
    entries: [entry({ currentNumber: 2, title: "Smoked oak", current: version({ id: "v2", number: 2, title: "Smoked oak", unitPrice: "100.00", priceImpact: "250.00", timeImpactDays: 4, afterLock: true, status: "proposed", confirmedAt: null, confirmationMethod: null, confirmedByName: null, source: "whatsapp" }),
      locked: { id: "v1", number: 1 }, versions: [version({ id: "v2", number: 2, title: "Smoked oak", afterLock: true, status: "proposed", priceImpact: "250.00", timeImpactDays: 4, confirmedAt: null, confirmedByName: null, confirmationMethod: null, source: "whatsapp" }), version({})] })] };

  it("shows a change after sign-off with its impact, the version procurement keeps, and the full history behind each choice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(changed)));
    render(<DesignSystemProvider><DesignLedger workspaceId="w" caseId="c1" rooms={[]} /></DesignSystemProvider>);
    expect(await screen.findByText("Changes waiting")).toBeInTheDocument();
    expect(screen.getByText(/Procurement keeps the signed-off versions/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve changes" })).toBeDisabled();
    const table = screen.getByRole("table");
    // Amounts in the workspace currency and locale (where the symbol goes, its decimals), never "250.00 AED".
    expect(table).toHaveTextContent("+AED 250.00 · +4 days");
    expect(table).toHaveTextContent("AED 1,250.00");
    expect(within(table).getByText("After sign-off")).toBeInTheDocument();
    expect(within(table).getByText("Waiting for the client")).toBeInTheDocument();
    expect(within(table).getByText("V1")).toBeInTheDocument();
    fireEvent.click(within(table).getByText("Smoked oak"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(/^Maya Client · Client portal · /)).toBeInTheDocument();
    expect(within(sheet).getAllByText("board.jpg · Showroom board")).toHaveLength(2);
    expect(within(sheet).getByText("Signed off")).toBeInTheDocument();
  });

  it("warns at approval when a chosen item doesn't get through the site's access, without blocking the decision (E5-6)", async () => {
    const sofa = entry({ id: "e9", title: "Halden sofa", current: version({ id: "v9", entryId: "e9", title: "Halden sofa", catalogItemId: "11111111-1111-4111-8111-111111111111", status: "proposed", confirmedAt: null, confirmationMethod: null, confirmedByName: null }), versions: [] });
    const view: LedgerView = { state: "open", lockProblem: null, currency: "AED", lock: null, entries: [sofa, entry({})], canEdit: true, canRecordClient: true, canApprove: false };
    const fit = { itemId: "11111111-1111-4111-8111-111111111111", name: "Halden sofa", size: null, inputsHash: "a".repeat(64), blocksOrdering: true, override: null,
      result: { status: "does_not_fit", reason: null, clearanceMm: 20, routes: [] } };
    const fetcher = vi.fn(async (url: string) => json(url.includes("/fit-checks") ? { items: [fit] } : view));
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><DesignLedger workspaceId="w" caseId="c1" rooms={[]} /></DesignSystemProvider>);
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("Doesn't fit")).toBeInTheDocument();
    expect(within(table).getAllByText("Doesn't fit")).toHaveLength(1); // only the item that has a catalog size
    expect(body(fetcher, "/fit-checks")).toEqual({ itemIds: ["11111111-1111-4111-8111-111111111111"] });
    fireEvent.click(within(table).getByText("Halden sofa"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Doesn't get through the measured access. Ordering waits for an override.")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Record client's decision" })).toBeEnabled();
  });

  it("ties a new choice to a catalog item, fills it in, and warns when the item doesn't get through the site's access (E5-6)", async () => {
    const empty: LedgerView = { state: "empty", lockProblem: "Add the materials and choices first", currency: "AED", lock: null, entries: [], canEdit: true, canRecordClient: true, canApprove: false };
    const itemId = "22222222-2222-4222-8222-222222222222";
    const hit = { id: itemId, code: "SOFA-3", name: "Halden sofa", categoryName: "Seating", description: "Three-seat, boucle", unitCode: "nos", rate: "7200.00", hasBuildUp: false, imageId: null, itemType: "product", supplier: "Nordic Living" };
    const fit = { itemId, name: "Halden sofa", size: null, inputsHash: "a".repeat(64), blocksOrdering: true, override: null, result: { status: "does_not_fit", reason: null, clearanceMm: 20, routes: [] } };
    const fetcher = vi.fn(async (url: string) => json(url.includes("/fit-checks") ? { items: [fit] } : url.includes("design-ledger/catalog") ? { items: [hit] } : empty));
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><DesignLedger workspaceId="w" caseId="c1" rooms={[]} /></DesignSystemProvider>);
    fireEvent.click((await screen.findAllByRole("button", { name: "Add choice" }))[0]);
    const dialog = await screen.findByRole("dialog");
    const picker = within(dialog).getByRole("combobox", { name: "Sample or catalog item" });
    // The catalog's first items load with the form, so the list opens on focus.
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("design-ledger/catalog?q=&"))).toBe(true));
    const user = userEvent.setup();
    await user.click(picker);
    expect(await screen.findByRole("option", { name: /Halden sofa/ })).toBeInTheDocument();
    await user.type(picker, "hal");
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("design-ledger/catalog?q=hal"))).toBe(true));
    await user.click(await screen.findByRole("option", { name: /Halden sofa/ }));
    expect(await within(dialog).findByText("Doesn't get through the measured access. Ordering waits for an override.")).toBeInTheDocument();
    expect(body(fetcher, "/fit-checks")).toEqual({ itemIds: [itemId] });
    expect(within(dialog).getByRole("textbox", { name: /^Name/ })).toHaveValue("Halden sofa");
    expect(within(dialog).getByRole("textbox", { name: "Supplier" })).toHaveValue("Nordic Living");
    // Filled from the catalog, still editable.
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Name/ }), { target: { value: "Halden sofa, sage" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body(fetcher, "design-ledger/entries")).toMatchObject({ catalogItemId: itemId, title: "Halden sofa, sage", specification: "Three-seat, boucle", supplier: "Nordic Living" }));
  });

  it("adds a choice with its source and day, and records the client's confirmation given in person", async () => {
    const empty: LedgerView = { state: "empty", lockProblem: "Add the materials and choices first", currency: "AED", lock: null, entries: [], canEdit: true, canRecordClient: true, canApprove: false };
    const open: LedgerView = { ...empty, state: "open", lockProblem: "Waiting for the client's confirmation: Oak veneer", entries: [entry({ current: version({ status: "proposed", confirmedAt: null, confirmationMethod: null, confirmedByName: null }), versions: [] })] };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => json(init?.method === "POST" ? open : empty));
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><DesignLedger workspaceId="w" caseId="c1" rooms={[]} clientName="Maya Client" /></DesignSystemProvider>);
    fireEvent.click((await screen.findAllByRole("button", { name: "Add choice" }))[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Name/ }), { target: { value: "Oak veneer" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Quantity" }), { target: { value: "12.5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body(fetcher, "design-ledger/entries")).toMatchObject({ kind: "material", title: "Oak veneer", quantity: "12.5", source: "showroom" }));
    const sent = body(fetcher, "design-ledger/entries");
    expect(sent.id).not.toEqual(sent.versionId);
    expect(Date.parse(sent.saidAt)).toBeLessThanOrEqual(Date.now());
    fireEvent.click(await screen.findByText("Oak veneer"));
    fireEvent.click(await screen.findByRole("button", { name: "Record client's decision" }));
    const decision = (await screen.findAllByRole("dialog")).at(-1)!;
    expect(within(decision).getByRole("textbox", { name: /Who decided/ })).toHaveValue("Maya Client");
    fireEvent.click(within(decision).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body(fetcher, "/decision")).toEqual({ decision: "confirmed", method: "in_person", decidedBy: "Maya Client", note: null }));
  });
});
