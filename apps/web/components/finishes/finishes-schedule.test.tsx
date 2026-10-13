import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { FinishEntry, ScheduleView } from "@/lib/pre-project/finishes";
import { DesignLedger } from "../pre-project/design-ledger";
import { FactorySharedFinishes } from "./factory-finishes";
import { FinishesSchedule } from "./finishes-schedule";

afterEach(() => vi.unstubAllGlobals());
const json = (value: unknown, ok = true) => ({ ok, json: async () => value });
const body = (fetcher: ReturnType<typeof vi.fn>, match: string) => JSON.parse(((fetcher.mock.calls as Array<[string, RequestInit | undefined]>).find(([url, init]) => String(url).includes(match) && init?.method === "POST") ?? ["", { body: "null" }])[1]!.body as string);

const entry = (over: Partial<FinishEntry> = {}): FinishEntry => ({
  id: "e1", title: "Calacatta marble", roomId: "r1", roomName: "Kitchen", categoryKey: "hard_finishes", categoryLabel: "Hard finishes", location: "Floor", installNote: "Book-matched",
  position: 0, version: 2,
  current: { id: "v1", number: 1, specification: "Honed, 2 cm", supplier: "Own stock", quantity: "30", unit: "m²", catalogItemId: null, origin: "own_stock", outsourced: false, signOff: null,
    status: "confirmed", sampleId: "s1", sampleName: "Calacatta Gold", samplePhotoAssetId: null, samplePhotoName: null, note: "", confirmedAt: null, confirmedByName: null },
  locked: null, status: "approved", snapshots: [], signature: { required: false, signed: false, last: null }, sentToQs: true, changedSinceSent: false, priced: { lines: 1, stale: 0 }, ...over,
});
const view = (over: Partial<ScheduleView> = {}): ScheduleView => ({
  caseId: "c1", categories: [{ key: "hard_finishes", label: "Hard finishes", clientSignature: false }, { key: "sanitary_ware", label: "Sanitary ware", clientSignature: true }],
  entries: [entry(), entry({ id: "e2", title: "Wall-hung WC", roomId: "r2", roomName: "Master bathroom", categoryKey: "sanitary_ware", categoryLabel: "Sanitary ware", location: "",
    status: "in_process", signature: { required: true, signed: false, last: null }, sentToQs: false, changedSinceSent: true, priced: { lines: 1, stale: 1 } })],
  removed: [], currency: "EUR",
  specification: { gate: true, samplesStep: true, samplesApproved: true, final: false, problem: "Wall-hung WC changed after the finishes went to QS. The designer sends them to QS again.", changed: ["Wall-hung WC"],
    handoff: { number: 1, sentAt: "2026-10-10T09:00:00Z", sentByName: "Lina Lead", note: "", finishes: 2 } },
  share: null, project: { id: "p1", reference: "PRJ-0001", name: "Villa", started: true },
  procurement: { payment: true, materials: true, signatures: { missing: ["Wall-hung WC"], exempt: false, required: 1 }, cleared: false },
  drawings: { designs: [{ id: "d1", title: "Kitchen elevations", stage: "renders", roomName: "Kitchen", revision: 3, status: "approved", updatedAt: "2026-10-09T09:00:00Z" }],
    shop: [{ id: "x1", number: 2, status: "sent", sentAt: "2026-10-11T09:00:00Z", decidedOn: null, files: [{ id: "f1", name: "Kitchen shop drawing.pdf" }] }] },
  canEdit: true, canManageMaterials: true, canSendToQs: true, canRecordSignature: true, canShare: true, ...over,
});

describe("the finishes schedule (PLM-156, PLM-146, PLM-148)", () => {
  it("lists the finishes by room with where they come from, their status, the client's signature and what QS has; sends the changes to QS", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => json(init?.method === "POST" && url.includes("finishes/send-to-qs")
      ? view({ specification: { ...view().specification, final: true, problem: null, changed: [], handoff: { number: 2, sentAt: "2026-10-13T09:00:00Z", sentByName: "Lina Lead", note: "", finishes: 2 } } })
      : view()));
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><FinishesSchedule source={{ kind: "case", workspaceId: "w", caseId: "c1" }} rooms={[]} /></DesignSystemProvider>);
    const table = await screen.findByRole("grid", { name: "Finishes schedule" }).catch(() => screen.findByRole("table", { name: "Finishes schedule" }));
    expect(within(table).getByText("Kitchen")).toBeInTheDocument();
    expect(within(table).getByText("Master bathroom")).toBeInTheDocument();
    expect(within(table).getAllByText("Own stock").length).toBeGreaterThan(0);
    expect(within(table).getByText("Approved")).toBeInTheDocument();
    expect(within(table).getByText("Client to sign")).toBeInTheDocument();
    expect(within(table).getByText("Price to check")).toBeInTheDocument();
    expect(screen.getByText("Ordering waits for the client's signed samples or data sheets: Wall-hung WC")).toBeInTheDocument();
    expect(screen.getByText("Specification not final")).toBeInTheDocument();
    // The installation view: where each one goes and the note for whoever installs it.
    fireEvent.click(screen.getByRole("radio", { name: "Installation" }));
    expect((await screen.findAllByText("Book-matched")).length).toBeGreaterThan(0);
    // The drawings schedule, read from the design files and the shop drawings.
    fireEvent.click(screen.getByRole("radio", { name: "Drawings" }));
    expect(await screen.findByText("Kitchen elevations")).toBeInTheDocument();
    expect(screen.getByText("Kitchen shop drawing.pdf")).toBeInTheDocument();
    // Send the changed finishes to QS (one primary action).
    fireEvent.click(screen.getByRole("button", { name: "Send changes to QS" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Note" }), { target: { value: "The WC changed to rimless" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to QS" }));
    await waitFor(() => expect(body(fetcher, "finishes/send-to-qs")).toEqual({ note: "The WC changed to rimless" }));
    expect(await screen.findByText("Sent to QS.")).toBeInTheDocument();
  });

  it("records the client's signed sample or data sheet with the photo, the day and who signed", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => json(init?.method === "POST" && url.includes("/finishes/assets/")
      ? { id: "a1", name: "signed.jpg", mimeType: "image/jpeg", byteSize: 10, hasPreview: true } : view()));
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><FinishesSchedule source={{ kind: "case", workspaceId: "w", caseId: "c1" }} rooms={[]} /></DesignSystemProvider>);
    fireEvent.click(await screen.findByText("Wall-hung WC"));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Record the client's signature" }));
    const dialog = (await screen.findAllByRole("dialog")).at(-1)!;
    const user = userEvent.setup();
    await user.upload(within(dialog).getByLabelText("Photo of the signed sample or data sheet"), new File(["x"], "signed.jpg", { type: "image/jpeg" }));
    expect(await within(dialog).findByText("Photo: signed.jpg")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Who signed/ }), { target: { value: "Maya Client" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body(fetcher, "finishes/entries/e2/signatures")).toMatchObject({ versionId: "v1", signer: "Maya Client", assetId: "a1" }));
  });

  it("reads a shared sample log from the Factory without any of the designers' actions", async () => {
    const fetcher = vi.fn(async (url: string) => json(url.includes("/api/factory/finishes/c1")
      ? view({ canEdit: false, canManageMaterials: false, canSendToQs: false, canRecordSignature: false, canShare: false })
      : { shares: [{ caseId: "c1", number: 1, sharedAt: "2026-10-12T09:00:00Z", sharedByName: "Lina Lead", note: "Vanity unit", clientName: "Maya Client", projectId: "p1", project: "PRJ-0001 · Villa" }] }));
    vi.stubGlobal("fetch", fetcher);
    const open = vi.fn();
    const { rerender } = render(<DesignSystemProvider><FactorySharedFinishes workspaceId="w" caseId={null} onOpen={open} /></DesignSystemProvider>);
    fireEvent.click(await screen.findByText("PRJ-0001 · Villa"));
    expect(open).toHaveBeenCalledWith("c1");
    rerender(<DesignSystemProvider><FactorySharedFinishes workspaceId="w" caseId="c1" onOpen={open} /></DesignSystemProvider>);
    expect(await screen.findByText("Calacatta marble")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share with the factory" })).not.toBeInTheDocument();
  });

  it("starts empty with the next action", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(view({ entries: [], procurement: null }))));
    const add = vi.fn();
    render(<DesignSystemProvider><FinishesSchedule source={{ kind: "case", workspaceId: "w", caseId: "c1" }} rooms={[]} onAddMaterials={add} /></DesignSystemProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Add the materials" }));
    expect(add).toHaveBeenCalled();
  });
});

describe("choosing a material from the sample library (PLM-157)", () => {
  it("offers the samples first and fills in where it comes from", async () => {
    const empty = { state: "empty", lockProblem: null, currency: "EUR", lock: null, entries: [], canEdit: false, canRecordClient: false, canApprove: false, canManageMaterials: true };
    const sample = { id: "33333333-3333-4333-8333-333333333333", name: "Calacatta Gold", code: "MB-01", origin: "own_stock", supplier: "Showroom stock", categoryKey: "hard_finishes", catalogItemId: null,
      priceBandLabel: "Premium", inStock: true, hasPhoto: false, location: "Rack B" };
    const fetcher = vi.fn(async (url: string) => json(url.includes("/fit-checks") ? { items: [] } : url.includes("design-ledger/catalog") ? { items: [], samples: [sample] }
      : url.includes("/api/workspace/finishes/settings") ? { settings: { categories: [{ key: "hard_finishes", label: "Hard finishes", clientSignature: false }] }, bands: [], currency: "EUR", canManage: false } : empty));
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><DesignLedger workspaceId="w" caseId="c1" rooms={[]} /></DesignSystemProvider>);
    // The Material Coordinator adds materials only (no design choices).
    fireEvent.click((await screen.findAllByRole("button", { name: "Add material" }))[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("radio", { name: "Design" })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("combobox", { name: "Sample or catalog item" }));
    await user.click(await screen.findByRole("option", { name: /Calacatta Gold/ }));
    expect(within(dialog).getByRole("textbox", { name: /^Name/ })).toHaveValue("Calacatta Gold");
    expect(within(dialog).getByRole("radio", { name: "Own stock" })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body(fetcher, "design-ledger/entries")).toMatchObject({ kind: "material", sampleId: sample.id, origin: "own_stock", outsourced: false, supplier: "Showroom stock",
      categoryKey: "hard_finishes" }));
  });
});
