import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { FactorySettingsState, FactoryState, WorkOrderState } from "@/lib/factory/types";
import type { FactorySection } from "@/lib/factory/sections";
import { FactoryPage } from "./factory-page";
import { FactorySettingsPage } from "./factory-settings";

const nav = vi.hoisted(() => ({ replace: vi.fn(), query: "" }));
vi.spyOn(window.history, "replaceState");
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }), usePathname: () => "/workspace/factory", useSearchParams: () => new URLSearchParams(nav.query) }));

const settings = { requireDrawing: true, requirePayment: true, requireMaterials: true, requireCheck: true, version: 1 };
const joinery = { id: "c1", name: "Joinery", hoursPerDay: "8.00", active: true };
const line = { lineId: "l1", projectId: "p1", projectReference: "PRJ-0007", projectName: "Villa 12", packageId: "k1", packageName: "Kitchen joinery", title: "Kitchen cabinets",
  specification: "Oak veneer", unit: "m", quantity: "4.5000", planned: "3.0000", left: "1.5000", suggestedStart: "2099-10-05", suggestedEnd: "2099-10-16" };
const row = (patch: Partial<WorkOrderState["order"]> = {}): WorkOrderState["order"] => ({
  id: "w1", number: 7, projectId: "p1", projectReference: "PRJ-0007", projectName: "Villa 12", packageId: "k1", packageName: "Kitchen joinery", boqLineId: "l1", title: "Kitchen cabinets",
  specification: "", quantity: "3.0000", unit: "m", status: "planned", workcenterId: "c1", workcenterName: "Joinery", plannedStart: "2099-10-05", plannedEnd: "2099-10-16", notes: "", version: 2,
  made: "0", pending: "0", passed: "0", toCheck: "0", left: "3.0000", scrapped: "0", drawingRef: "", drawingApprovedAt: null, drawingApprovedByName: null, holdReason: null,
  closeReason: null, closedAt: null, releasedAt: null, readyAt: null, lineStatus: "active", lineQuantity: "4.5000", scopeOver: "0", holdKind: null,
  plannedHours: null, batchId: null, batchNumber: null, batchName: null, ...patch,
});
const factory = (patch: Partial<FactoryState> = {}): FactoryState => ({ toMake: [line], orders: [row()], workcenters: [joinery], batches: [], canManage: true, canReport: true, canApprove: true,
  canIssue: true, ...patch });
const order = (patch: Partial<WorkOrderState["order"]> = {}, extra: Partial<WorkOrderState> = {}): WorkOrderState => ({
  order: row(patch), reports: [], checks: [], events: [], settings, workcenters: [joinery], canManage: true, canReport: true, canApprove: true, canIssue: true, me: "u1",
  materials: [], materialCost: "0.0000", currency: "AED", projectMaterials: [{ id: "pm1", name: "Oak veneer", unit: "sheets" }], canSuggest: false,
  places: [{ id: "f1", kind: "factory", name: "Factory", projectId: null, projectReference: null, address: "", isDefault: true, active: true }],
  operations: [], suppliers: [{ id: "s1", name: "Nile Marble", approved: true }], dispatches: [], atFactory: "0",
  releaseChecks: patch.status && patch.status !== "planned" ? [] : [
    { key: "running", passed: true, missing: "" }, { key: "drawing", passed: false, missing: "the drawing isn't approved" }, { key: "payment", passed: true, missing: "" },
    { key: "materials", passed: false, missing: "materials aren't in: Oak veneer", detail: ["Oak veneer"] }, { key: "schedule", passed: true, missing: "" }],
  ...extra,
});
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    // The delivery vehicles and the permit warning under Settings → Factory (none set up here).
    if (url.startsWith("/api/logistics/vehicles")) return { ok: true, status: 200, json: async () => ({ vehicles: [], permitWarningDays: 3, settingsVersion: 0, canManage: true }) };
    const value = respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method && init.method !== "GET" && typeof init.body === "string")
  .map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) }));
const uploads = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.body instanceof FormData).map(([url, init]) => ({ url: String(url), file: (init!.body as FormData).get("file") }));
const page = (section: FactorySection = "to-make") => render(<DesignSystemProvider><FactoryPage workspaceId="w" section={section} /></DesignSystemProvider>);

describe("factory", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(window.history.replaceState).mockClear(); nav.query = ""; });

  it("lists what's left to make by project and plans a work order for part of a line", async () => {
    const fetcher = mount((url, body) => (body ? order({ id: "new" }) : factory()));
    page();
    const table = await screen.findByRole("table", { name: "To make" }).catch(() => screen.findByRole("grid", { name: "To make" }));
    expect(table).toHaveTextContent("PRJ-0007 · Villa 12");
    expect(table).toHaveTextContent("1.5 m");
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Factory"]);
    expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("data-tour"))).toEqual(["factory-tab-to-make", "factory-tab-orders", "factory-tab-schedule", "factory-tab-calendar", "factory-tab-batches", "factory-tab-samples"]);
    await userEvent.click(within(table).getByText("Kitchen cabinets"));
    const dialog = await screen.findByRole("dialog", { name: "Plan work order" });
    const quantity = within(dialog).getByRole("textbox", { name: "Quantity" });
    expect(quantity).toHaveValue("1.5");
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "2");
    expect(within(dialog).getByText("Only 1.5 m left.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Plan work order" })).toBeDisabled();
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Plan work order" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ lineId: "l1", quantity: "1", workcenterId: "c1", plannedStart: "2099-10-05", plannedEnd: "2099-10-16" }));
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/workspace/factory/orders?order=new");
  });

  it("releases a work order only when its checks pass, and records the drawing approval", async () => {
    nav.query = "order=w1";
    let current = order({}, { next: "fix" });
    const fetcher = mount((url, body) => {
      if (url.includes("/orders/w1")) {
        if (body?.action === "approve_drawing") current = order({ drawingRef: String(body.reference), drawingApprovedAt: "2026-09-27T10:00:00Z", drawingApprovedByName: "Omar", version: 3 });
        return current;
      }
      return factory();
    });
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    const checks = await within(sheet).findByRole("region", { name: "Before it's released" });
    expect(within(checks).getByText("Not in: Oak veneer")).toBeInTheDocument();
    // What's missing says where to fix it; nothing offers to release it yet.
    expect(within(sheet).getByRole("status", { name: "Next step" })).toHaveTextContent("Can't be released yet");
    expect(within(checks).getByRole("link", { name: "Order materials" })).toHaveAttribute("href", "/workspace/purchasing?project=p1");
    expect(within(sheet).queryByRole("button", { name: "Release" })).toBeNull();
    await userEvent.click(within(checks).getByRole("button", { name: "Record approval" }));
    const dialog = await screen.findByRole("dialog", { name: "Drawing approval" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Approved drawing/ }), "K-01 rev B");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "approve_drawing", reference: "K-01 rev B", version: 2 }));
    expect(await within(sheet).findByText(/K-01 rev B, approved by Omar/)).toBeInTheDocument();
  });

  it("shows the project's client-approved drawings as the work order's drawing, and sends drawings waiting for the client to Scope › Drawings", async () => {
    nav.query = "order=w1";
    const project = { number: 1, status: "approved", decidedOn: "2026-10-01", decidedByName: "Maya Client" };
    mount((url) => url.includes("/orders/w1") ? order({}, { drawing: { source: "project", approved: true, project }, releaseChecks: [{ key: "drawing", passed: true, missing: "" }] }) : factory());
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    expect(await within(sheet).findByText(/Drawings R1, approved by Maya Client on/)).toBeInTheDocument();
    expect(within(sheet).queryByText("Not approved yet")).toBeNull();
  });

  it("links a drawing check waiting for the client to the project's drawings", async () => {
    nav.query = "order=w1";
    const project = { number: 2, status: "sent", decidedOn: null, decidedByName: null };
    mount((url) => url.includes("/orders/w1") ? order({}, { next: "fix", drawing: { source: null, approved: false, project },
      releaseChecks: [{ key: "drawing", passed: false, missing: "the client hasn't approved drawings R2" }] }) : factory());
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    const checks = await within(sheet).findByRole("region", { name: "Before it's released" });
    expect(within(checks).getByRole("link", { name: "Open the drawings" })).toHaveAttribute("href", "/workspace/projects/p1/scope?view=drawings");
  });

  it("changes where and when in place with the work order's version", async () => {
    nav.query = "order=w1";
    let current = order();
    const fetcher = mount((url, body) => {
      if (url.includes("/orders/w1")) {
        if (body?.action === "update") current = order({ ...body, version: 3 } as Partial<WorkOrderState["order"]>);
        return current;
      }
      return factory();
    });
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    await userEvent.click(await within(sheet).findByRole("button", { name: "Edit Hours it takes" }));
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Hours it takes" }), "7.5{Enter}");
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "update", plannedHours: "7.5", version: 2 }));
    await userEvent.click(await within(sheet).findByRole("button", { name: "Edit Notes" }));
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Notes" }), "Veneer from the new batch");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "update", notes: "Veneer from the new batch", version: 3 }));
  });

  it("shows where and when as plain text once production has started", async () => {
    nav.query = "order=w1";
    mount((url) => url.includes("/orders/w1") ? order({ status: "in_production", releasedAt: "2026-09-27T09:00:00Z", notes: "Rush" }) : factory());
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    expect(await within(sheet).findByText("Rush")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Edit Notes" })).toBeNull();
    expect(within(sheet).getByText("Joinery")).toBeInTheDocument();
  });

  it("reports output with why anything was scrapped, and lets someone else approve it", async () => {
    nav.query = "order=w1";
    const producing = { status: "in_production" as const, releasedAt: "2026-09-27T09:00:00Z" };
    const reports: WorkOrderState["reports"] = [
      { id: "r1", good: "2.0000", scrap: "0.5000", scrapReason: "Chipped edge", note: "", status: "pending", reportedBy: "u2", reportedByName: "Faisal", reportedAt: "2026-09-27T11:00:00Z", decidedByName: null, decisionNote: "",
        hours: "6.50" },
      { id: "r2", good: "0.5000", scrap: "0", scrapReason: "", note: "", status: "pending", reportedBy: "u1", reportedByName: "Me", reportedAt: "2026-09-27T12:00:00Z", decidedByName: null, decisionNote: "",
        hours: null }];
    const fetcher = mount((url) => (url.includes("/orders/w1") ? order({ ...producing, pending: "2.5000", left: "0.5000" }, { reports }) : factory()));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    await userEvent.click(await within(sheet).findByRole("tab", { name: /Output/ }));
    const output = await within(sheet).findByRole("region", { name: "Reports" });
    expect(within(output).getByText("2 m made · 0.5 m scrapped: Chipped edge · 6.5 hours")).toBeInTheDocument();
    // My own report waits for someone else; theirs I can approve.
    expect(within(output).getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    expect(within(output).getByText("Waiting for approval")).toBeInTheDocument();
    await userEvent.click(within(output).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "decide_report", reportId: "r1", decision: "approve", version: 2 }));

    await userEvent.click(within(sheet).getByRole("button", { name: "Report output" }));
    const dialog = await screen.findByRole("dialog", { name: "Report output" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Made" }), "1");
    expect(within(dialog).getByText("Only 0.5 m is still to make.")).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Made" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Made" }), "0.5");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Scrapped" }), "0.25");
    expect(within(dialog).getByRole("button", { name: "Report output" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it was scrapped/ }), "Split");
    // The hours it took are optional; more than 1,000 on one report isn't taken.
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Hours worked" }), "1000.5");
    expect(within(dialog).getByText("More than 0 and at most 1000, with up to 2 decimals.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Report output" })).toBeDisabled();
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Hours worked" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Hours worked" }), "4.5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Report output" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "report", good: "0.5", scrap: "0.25", scrapReason: "Split", hours: "4.5", id: expect.any(String) }));
  });

  it("checks quality: what failed needs why", async () => {
    nav.query = "order=w1";
    const fetcher = mount((url) => (url.includes("/orders/w1") ? order({ status: "in_production", releasedAt: "2026-09-27T09:00:00Z", made: "2.0000", toCheck: "2.0000", left: "1.0000" }) : factory()));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    await userEvent.click(await within(sheet).findByRole("button", { name: "Check quality" }));
    const dialog = await screen.findByRole("dialog", { name: "Check quality" });
    const passed = within(dialog).getByRole("textbox", { name: "Passed" });
    expect(passed).toHaveValue("2");
    await userEvent.clear(passed);
    await userEvent.type(passed, "1.5");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Failed" }), "0.5");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it failed/ }), "Veneer lifting");
    // A note and one photo go with the check; the photo follows the saved check, by its id.
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Note" }), "Two doors to redo");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => undefined }));
    await userEvent.upload(within(dialog).getByLabelText("Add a photo"), new File(["x"], "check.jpg", { type: "image/jpeg" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(uploads(fetcher)).toHaveLength(1));
    const check = posts(fetcher).at(-1)!.body;
    expect(check).toMatchObject({ action: "check", passed: "1.5", failed: "0.5", failReason: "Veneer lifting", note: "Two doors to redo" });
    expect(uploads(fetcher)[0]).toMatchObject({ url: expect.stringContaining(`/api/factory/orders/w1/checks/${check.id}/photos/`), file: expect.objectContaining({ name: "check.jpg" }) });
  });

  it("ties a work order to the payment stage due when it's ready, shows the ready date and the reminder it sent (PLM-064, PLM-067)", async () => {
    nav.query = "order=w1";
    const payments: WorkOrderState["payments"] = [{ id: "p1", title: "Advance", status: "verified" }, { id: "p2", title: "Joinery balance", status: "pending" }];
    const ready = { status: "ready" as const, releasedAt: "2026-09-27T09:00:00Z", made: "3.0000", passed: "3.0000", left: "0", readyAt: "2026-10-06T08:00:00Z", readyOn: "2026-10-06" };
    let current = order(ready, { payments, checks: [{ id: "c1", passed: "3.0000", failed: "0.0000", failReason: "", note: "Doors aligned", checkedByName: "Quinn", checkedAt: "2026-10-06T08:00:00Z", photoId: "f1" }] });
    const fetcher = mount((url, body) => {
      if (url.includes("/orders/w1")) {
        if (body?.action === "link_payment") current = { ...current, order: { ...current.order, readyPaymentId: String(body.paymentId), version: 3 },
          readyReminder: { readyOn: "2026-10-06", outcome: "sent", channel: "email", at: "2026-10-06T08:00:00Z", on: "2026-10-06" } };
        if (body?.action === "set_ready_date") current = { ...current, order: { ...current.order, readyOn: String(body.readyOn), version: 4 } };
        return current;
      }
      return factory();
    });
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    await userEvent.click(await within(sheet).findByRole("button", { name: "Edit Payment due when ready" }));
    await userEvent.click(await screen.findByRole("option", { name: "Joinery balance" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "link_payment", paymentId: "p2", version: 2 }));
    expect(await within(sheet).findByText(/Sent to the client on/)).toBeInTheDocument();
    // The check's note and photo, and the ready date, on the output.
    await userEvent.click(within(sheet).getByRole("tab", { name: /Output/ }));
    expect(await within(sheet).findByText(/Doors aligned/)).toBeInTheDocument();
    expect(within(sheet).getByRole("img", { name: "Check photo" })).toHaveAttribute("src", expect.stringContaining("/api/factory/photos/f1?"));
    expect(within(sheet).getByRole("button", { name: "Edit Ready on" })).toBeInTheDocument();
  });

  it("shows the design checklists the work order is made to, its pending lines counted on the tab", async () => {
    nav.query = "order=w1";
    const checklists: WorkOrderState["checklists"] = { pending: 1, groups: [{ scope: "Kitchens and islands", section: null, pending: 1, items: [
      { key: "kitchen.03", question: "Record appliance brand, model and supplier.", kind: "check", answer: "Hob model from the client", status: "pending", answeredByName: "Dana", answeredAt: "2026-10-14T09:00:00Z" }] },
      { scope: "Factory release", section: null, everyJob: true, pending: 0, items: [
        { key: "release.01", question: "Site verified dimensions and finished levels recorded", kind: "check", answer: null, status: "confirmed", answeredByName: "Tara", answeredAt: "2026-10-14T09:00:00Z" }] }] };
    mount((url) => (url.includes("/orders/w1") ? order({ status: "released", releasedAt: "2026-09-27T09:00:00Z" }, { checklists }) : factory()));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    await userEvent.click(await within(sheet).findByRole("tab", { name: /Checklists/ }));
    expect(await within(sheet).findByRole("region", { name: "Kitchens and islands" })).toBeInTheDocument();
    expect(within(sheet).getByText("Hob model from the client").closest("[data-pending]")).not.toBeNull();
    expect(within(sheet).getByRole("region", { name: "Factory release" })).toBeInTheDocument();
  });

  it("issues a material to the work order and asks why when it's more than it needs; a swap waits for someone else", async () => {
    nav.query = "order=w1";
    const oak = { id: "m1", itemId: "i1", itemName: "Oak veneer", unit: "sheets", materialItemId: "pm1", quantity: "13.3334", status: "active" as const, replacesId: null, replacesName: null,
      reason: "", requestedBy: "u1", requestedByName: "Me", decidedByName: null, decisionNote: "", issued: "11.0000", issuedValue: "550.0000", projectOnHand: "0", freeOnHand: "9.0000" };
    const swap = { ...oak, id: "m2", itemId: "i2", itemName: "Walnut veneer", status: "pending" as const, replacesId: "m1", replacesName: "Oak veneer", reason: "Client changed the finish",
      requestedBy: "u2", requestedByName: "Faisal", issued: "0", issuedValue: "0", freeOnHand: "0" };
    const fetcher = mount((url) => (url.includes("/orders/w1") ? order({ status: "released", releasedAt: "2026-09-27T09:00:00Z" }, { materials: [oak, swap], materialCost: "550.0000" }) : factory()));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    const materials = await within(sheet).findByRole("region", { name: "Materials" });
    expect(within(materials).getByText("11 of 13.3334 sheets issued · 9 sheets free")).toBeInTheDocument();
    expect(within(materials).getByText(/Issued worth .*550/)).toBeInTheDocument();
    expect(within(materials).getByText("Instead of Oak veneer: Client changed the finish (Faisal)")).toBeInTheDocument();
    await userEvent.click(within(materials).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "decide_substitution", materialId: "m2", decision: "approve", version: 2 }));

    await userEvent.click(within(materials).getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Issue" }));
    const dialog = await screen.findByRole("dialog", { name: "Issue Oak veneer" });
    const quantity = within(dialog).getByRole("textbox", { name: "Quantity" });
    expect(quantity).toHaveValue("2.3334");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Free stock" }));
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "3");
    expect(within(dialog).getByRole("button", { name: "Issue" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why more/ }), "Offcuts too short");
    await userEvent.click(within(dialog).getByRole("button", { name: "Issue" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "issue_material", materialId: "m1", locationId: "f1", quantity: "3", from: "free", reason: "Offcuts too short" }));
  });

  it("adds materials from the project's list with how much: the ones for this item alone come ticked with its share, any other can be ticked", async () => {
    nav.query = "order=w1";
    const glue = { id: "m3", itemId: "i3", itemName: "Wood glue", unit: "nos", materialItemId: "pm3", quantity: "2.0000", status: "active" as const, replacesId: null, replacesName: null,
      reason: "", requestedBy: "u1", requestedByName: "Me", decidedByName: null, decisionNote: "", issued: "0", issuedValue: "0", projectOnHand: "0", freeOnHand: "0" };
    const listed = { canSuggest: true, materials: [glue], projectMaterials: [{ id: "pm1", name: "Oak veneer", unit: "sheets", suggested: "13.3334" },
      { id: "pm2", name: "Calacatta marble slab", unit: "slab", suggested: null }, { id: "pm3", name: "Wood glue", unit: "nos", suggested: null }] };
    const fetcher = mount((url, body) => url.includes("/orders/w1") ? order(body ? { version: 3 } : {}, body ? { ...listed, canSuggest: false } : listed) : factory());
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    const materials = await within(sheet).findByRole("region", { name: "Materials" });
    await userEvent.click(within(materials).getByRole("button", { name: "Add from the material list" }));
    const dialog = await screen.findByRole("dialog", { name: "Add from the material list" });
    // What's on the work order already isn't offered again.
    expect(within(dialog).getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual(["Oak veneer (sheets)", "Calacatta marble slab (slab)"]);
    expect(within(dialog).getByRole("checkbox", { name: "Oak veneer (sheets)" })).toBeChecked();
    expect(within(dialog).getByRole("textbox", { name: "Quantity of Oak veneer" })).toHaveValue("13.3334");
    expect(within(dialog).getByRole("checkbox", { name: "Calacatta marble slab (slab)" })).not.toBeChecked();
    expect(within(dialog).queryByRole("textbox", { name: "Quantity of Calacatta marble slab" })).toBeNull();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Calacatta marble slab (slab)" }));
    expect(within(dialog).getByRole("button", { name: "Add materials" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Quantity of Calacatta marble slab" }), "1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add materials" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "suggest_materials", version: 2,
      items: [{ materialItemId: "pm1", quantity: "13.3334" }, { materialItemId: "pm2", quantity: "1" }] }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add from the material list" })).toBeNull());
    expect(within(materials).queryByRole("button", { name: "Add from the material list" })).toBeNull();
  });

  it("asks for the material when one is added by hand, without calling it optional", async () => {
    nav.query = "order=w1";
    mount((url) => url.includes("/orders/w1") ? order() : factory());
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    const materials = await within(sheet).findByRole("region", { name: "Materials" });
    await userEvent.click(within(materials).getByRole("button", { name: "Add material" }));
    const dialog = await screen.findByRole("dialog", { name: "Add material" });
    const label = within(dialog).getAllByText("Material").find((node) => node.classList.contains("wd-field-label"))!;
    expect(label).not.toHaveAttribute("data-optional");
    expect(within(dialog).getByText("Quantity")).not.toHaveAttribute("data-optional");
  });

  it("stops a work order whose scope a variation reduced, and lets someone else go on after a drawing change", async () => {
    nav.query = "order=w1";
    let current = order({ status: "planned", scopeOver: "1.0000" });
    const fetcher = mount((url, body) => {
      if (url.includes("/orders/w1")) {
        if (body?.action === "set_quantity") current = order({ quantity: String(body.quantity), version: 3 });
        return current;
      }
      return factory();
    });
    const { unmount } = page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    expect(await within(sheet).findByText("A variation reduced its scope line: 1 m more are on work orders than it needs.")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "More" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Change quantity" }));
    const dialog = await screen.findByRole("dialog", { name: "Change quantity" });
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Quantity" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Quantity" }), "2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "set_quantity", quantity: "2", version: 2 }));
    unmount();

    mount((url) => (url.includes("/orders/w1") ? order({ status: "on_hold", holdKind: "drawing", holdReason: "Drawing changed to K-01 rev C: Handles moved", releasedAt: "2026-09-27T09:00:00Z" },
      { next: "decide_drawing" }) : factory()));
    page("orders");
    const held = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    expect(await within(held).findByText("Drawing changed to K-01 rev C: Handles moved")).toBeInTheDocument();
    expect(within(held).getByRole("button", { name: "Go on with the new drawing" })).toBeInTheDocument();
  });

  it("opens on what needs me: releases in place, says why others are blocked, and releases several at once (D-22, D-45)", async () => {
    const ready = { ...row({ id: "w1" }), next: "release" as const, mine: true, blocked: [] };
    const stuck = { ...row({ id: "w2", number: 8, title: "Wardrobes" }), next: "fix" as const, mine: true, blocked: [{ key: "materials" as const, missing: "materials aren't in" }] };
    const vanity = { ...row({ id: "w3", number: 9, title: "Vanity" }), next: "release" as const, mine: true, blocked: [] };
    const making = { ...row({ id: "w4", number: 10, title: "Doors", status: "in_production", pending: "1.0000" }), next: "approve" as const, mine: false };
    const fetcher = mount((url, body) => (body ? order({ status: "released" }) : factory({ orders: [ready, stuck, vanity, making] })));
    page("orders");
    const grid = await screen.findByRole("grid", { name: "Work orders" }).catch(() => screen.findByRole("table", { name: "Work orders" }));
    await within(grid).findByText("Wardrobes");
    expect(screen.getByRole("button", { name: /^Needs me\s*3$/ })).toHaveAttribute("aria-pressed", "true");
    // Someone else approves the doors' output: not mine.
    expect(grid).not.toHaveTextContent("Doors");
    expect(within(grid).getByText("Materials not in")).toBeInTheDocument();
    await userEvent.click(within(grid).getByRole("button", { name: "Release WO-0007" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ url: expect.stringContaining("/orders/w1"), body: { action: "release", version: 2 } }));
    expect(await screen.findByText("Released 1.")).toBeInTheDocument();

    // Only the ones that can go are released together.
    for (const box of within(grid).getAllByRole("checkbox", { name: /Select row/ })) await userEvent.click(box);
    await userEvent.click(await screen.findByRole("button", { name: "Release (2)" }));
    await waitFor(() => expect(posts(fetcher).filter((call) => call.body.action === "release").map((call) => call.url.split("?")[0])).toEqual(
      ["/api/factory/orders/w1", "/api/factory/orders/w1", "/api/factory/orders/w3"]));
    await userEvent.click(screen.getByRole("button", { name: /^Blocked\s*1$/ }));
    expect(grid).toHaveTextContent("Wardrobes");
    expect(grid).not.toHaveTextContent("Vanity");
  });

  it("keeps work orders to six tabs, with the design inspections as a filter on any tab (PLM-150)", async () => {
    const tooMany = vi.spyOn(console, "error");
    const asked = { ...row({ id: "w1", title: "Wardrobes", status: "in_production" }), next: "request_inspection" as const, mine: true };
    const snagged = { ...row({ id: "w2", number: 8, title: "Vanity", status: "ready" }), next: "snags" as const, mine: true,
      inspection: { raw: "passed" as const, final: "snags" as const, dueId: null, dueStage: null, dueOn: null, latestId: "i3", openSnags: 1 } };
    const doors = { ...row({ id: "w3", number: 9, title: "Doors", status: "in_production" }), next: "report" as const, mine: true };
    mount(() => factory({ orders: [asked, snagged, doors] }));
    page("orders");
    const grid = await screen.findByRole("grid", { name: "Work orders" }).catch(() => screen.findByRole("table", { name: "Work orders" }));
    await within(grid).findByText("Doors");
    const tabs = screen.getByRole("group", { name: "Work orders" });
    expect(within(tabs).getAllByRole("button").map((tab) => tab.textContent?.replace(/\d+$/, ""))).toEqual(["Needs me", "Blocked", "In production", "To send", "Open", "All"]);
    expect(tooMany.mock.calls.some((call) => String(call[0]).includes("tabs; at most"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    await userEvent.click(await screen.findByRole("button", { name: /Filter by design inspection/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Snags to fix" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(grid).not.toHaveTextContent("Doors"));
    expect(grid).toHaveTextContent("Vanity");
    expect(grid).not.toHaveTextContent("Wardrobes");
    await userEvent.click(screen.getByRole("button", { name: "Remove filter Design inspection" }));
    expect(await within(grid).findByText("Doors")).toBeInTheDocument();
    tooMany.mockRestore();
  });

  it("plans a work order for each selected line, for all that's left, when its work needs it (D-22)", async () => {
    const second = { ...line, lineId: "l2", title: "Wardrobes", left: "2.0000", planned: "0", quantity: "2.0000", suggestedStart: "2099-10-10", suggestedEnd: "2099-10-20" };
    const held = { ...line, lineId: "l3", projectId: "p2", projectReference: "PRJ-0008", projectName: "Villa 14", title: "Vanity", projectStatus: "on_hold" as const };
    const fetcher = mount((url, body) => (body ? order({ id: String(body.id) }) : factory({ toMake: [line, second, held] })));
    page();
    const table = await screen.findByRole("table", { name: "To make" }).catch(() => screen.findByRole("grid", { name: "To make" }));
    // A project on hold waits in its own list.
    expect(table).not.toHaveTextContent("Vanity");
    expect(screen.getByRole("button", { name: /^On hold\s*1$/ })).toBeInTheDocument();
    await userEvent.click(within(table).getByRole("checkbox", { name: "Select PRJ-0007 Kitchen cabinets" }));
    await userEvent.click(within(table).getByRole("checkbox", { name: "Select PRJ-0007 Wardrobes" }));
    await userEvent.click(screen.getByRole("button", { name: "Plan work orders (2)" }));
    const dialog = await screen.findByRole("dialog", { name: "Plan work orders (2)" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Plan work orders (2)" }));
    await waitFor(() => expect(posts(fetcher).map((call) => call.body)).toEqual([
      expect.objectContaining({ lineId: "l1", quantity: "1.5000", workcenterId: "c1", plannedStart: "2099-10-05", plannedEnd: "2099-10-16" }),
      expect.objectContaining({ lineId: "l2", quantity: "2.0000", workcenterId: "c1", plannedStart: "2099-10-10", plannedEnd: "2099-10-20" }),
    ]));
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/workspace/factory/orders");
  });

  it("holds work when a newer drawing comes in: the manager records it from the project's designs, someone else lets it go on (D-26)", async () => {
    nav.query = "order=w1";
    const stale = order({ status: "on_hold", holdKind: "drawing", holdReason: "The drawing Kitchen R1 has a newer revision (R2).", releasedAt: "2026-09-27T09:00:00Z",
      drawingRef: "Kitchen R1", drawingApprovedAt: "2026-09-20T09:00:00Z", drawingApprovedByName: "Omar", drawingNewer: 2 },
    { next: "decide_drawing", designs: [{ designId: "d1", versionId: "v2", title: "Kitchen", number: 2, documentType: "drawing" }] });
    const fetcher = mount((url) => (url.includes("/orders/w1") ? stale : factory()));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    expect(await within(sheet).findByRole("status", { name: "Next step" })).toHaveTextContent("A newer drawing (R2) is in");
    await userEvent.click(within(sheet).getByRole("button", { name: "Use the new drawing" }));
    const dialog = await screen.findByRole("dialog", { name: "Drawing changed" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What changed/ }), "Handles moved");
    await userEvent.click(within(dialog).getByRole("button", { name: "Put on hold" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "revise_drawing", versionId: "v2", note: "Handles moved", version: 2 }));
  });

  it("shows goods the site refused, the trip bringing them back, and what's made again", async () => {
    nav.query = "order=w1";
    mount((url) => (url.includes("/orders/w1") ? order({ status: "in_production", releasedAt: "2026-09-27T09:00:00Z", passed: "2.0000", left: "1.0000", reworked: "1.0000" }, {
      dispatches: [{ id: "t1", number: 5, status: "received", sentOn: "2099-10-08", quantity: "3.0000", received: "3.0000", short: false, rejected: "1.0000", rejectReason: "Scratched door",
        returnId: "t2", returnNumber: 6, returnStatus: "in_transit" }],
      reworks: [{ id: "rw1", quantity: "1.0000", reason: "Scratched door", source: "site", at: "2099-10-09T10:00:00Z", byName: "Sami Site" }] }) : factory()));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    await userEvent.click(await within(sheet).findByRole("tab", { name: /To site/ }));
    const trips = await within(sheet).findByRole("region", { name: "Trips to site" });
    expect(within(trips).getByText(/1 m refused: Scratched door/)).toBeInTheDocument();
    expect(within(trips).getByRole("link", { name: "Coming back on move 6" })).toHaveAttribute("href", "/workspace/inventory/moves?move=t2");
    expect(within(trips).getByText("Partly refused")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("tab", { name: /Output/ }));
    const again = await within(sheet).findByRole("region", { name: "Made again" });
    expect(within(again).getByText("1 m sent back from site")).toBeInTheDocument();
  });

  it("shows each workcenter's weeks and the days booked over capacity", async () => {
    const busy = row({ id: "w1", plannedStart: "2099-10-05", plannedEnd: "2099-10-07", plannedHours: "24.00" });
    const other = row({ id: "w2", number: 8, title: "Wardrobes", plannedStart: "2099-10-06", plannedEnd: "2099-10-06", plannedHours: "8.00" });
    mount((url) => (url.includes("/schedule") ? { from: "2099-10-05", to: "2099-10-18", days: ["2099-10-05", "2099-10-06", "2099-10-07", "2099-10-08", "2099-10-09"], workcenters: [joinery],
      orders: [busy, other], load: { c1: { "2099-10-05": 8, "2099-10-06": 16, "2099-10-07": 8 } },
      conflicts: [{ workcenterId: "c1", workcenterName: "Joinery", date: "2099-10-06", hours: 16, capacity: 8, orders: ["w1", "w2"] }] } : factory()));
    page("schedule");
    // The schedule opens by project (PLM-063); the workcenters' weeks are the other view.
    await userEvent.click(await screen.findByRole("radio", { name: "Workcenters" }));
    const over = await screen.findByRole("region", { name: "Over capacity" });
    expect(within(over).getByText("Joinery · Oct 6, 2099")).toBeInTheDocument();
    expect(within(over).getByText("WO-0007, WO-0008")).toBeInTheDocument();
    expect(within(over).getByText("16 of 8 hours")).toBeInTheDocument();
    const schedule = screen.getByRole("region", { name: "Schedule" });
    expect(within(schedule).getByRole("region", { name: "Joinery · 8 h a day" })).toBeInTheDocument();
    await userEvent.click(within(schedule).getByRole("button", { name: "WO-0008 Wardrobes, on a day over capacity" }));
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/workspace/factory/orders?order=w2");
  });

  it("shows production project by project, planned against actual, and opens a project's work orders (PLM-063)", async () => {
    const steps = [{ kind: "scheduled", label: "" }, { kind: "in_production", label: "" }, { kind: "quality_check", label: "" }, { kind: "ready", label: "" }];
    mount((url) => (url.includes("/production") ? { steps, targetWeeks: 8, today: "2099-10-10", projects: [
      { projectId: "p1", reference: "PRJ-0007", name: "Villa 12", clientName: "Maya Client", projectStatus: "active", step: { kind: "quality_check", label: "" },
        planned: { start: "2099-10-01", end: "2099-10-08", days: 8 }, actual: { start: "2099-10-02", end: null, days: 9 }, late: true, overTarget: false, orders: 2, ready: 1, held: false },
      { projectId: "p2", reference: "PRJ-0008", name: "Marina", clientName: "Omar Client", projectStatus: "active", step: null,
        planned: { start: "2099-11-01", end: null, days: null }, actual: { start: null, end: null, days: null }, late: false, overTarget: false, orders: 0, ready: 0, held: false },
    ] } : factory()));
    page("schedule");
    const grid = await screen.findByRole("grid", { name: "Production by project" }).catch(() => screen.findByRole("table", { name: "Production by project" }));
    expect(await within(grid).findByText("Quality check")).toBeInTheDocument();
    expect(grid).toHaveTextContent("1 of 2 work orders ready");
    expect(grid).toHaveTextContent("9 days · Late");
    expect(grid).toHaveTextContent("Not scheduled");
    expect(grid).toHaveTextContent("No work orders yet");
    await userEvent.click(within(grid).getByText("PRJ-0007 · Villa 12"));
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", "/workspace/factory/orders?project=p1");
  });

  it("lists the samples the design team asked for and marks one ready with a note (PLM-061)", async () => {
    const sample = { id: "s1", number: 1, caseId: "c1", caseReference: "O-12", clientName: "Maya Client", projectId: null, projectReference: null, title: "Veneer control sample · Walnut",
      note: "Two panels", dueOn: "2099-10-13", status: "requested", requestedBy: "u2", requestedByName: "Dana Designer", requestedAt: "2099-10-01T09:00:00Z", readyNote: "", readyByName: null as string | null,
      readyAt: null as string | null, cancelReason: "", version: 1, appointmentOn: "2099-10-14" };
    let state = { samples: [sample], today: "2099-10-10", appointmentOn: null, suggestedDueOn: "2099-10-17", me: "u1", canRequest: false, canMake: true, canWithdrawAny: true };
    const fetcher = mount((url, body) => {
      if (!url.includes("/samples")) return factory();
      if (body) state = { ...state, samples: [{ ...sample, status: "ready", readyNote: String(body.note), readyByName: "Faris Factory", readyAt: "2099-10-10T09:00:00Z", version: 2 }] };
      return state;
    });
    page("samples");
    const grid = await screen.findByRole("grid", { name: "Samples" }).catch(() => screen.findByRole("table", { name: "Samples" }));
    expect(await within(grid).findByText("Veneer control sample · Walnut")).toBeInTheDocument();
    expect(grid).toHaveTextContent("Material selection Oct 14");
    expect(within(grid).getByRole("link", { name: "O-12" })).toHaveAttribute("href", "/workspace/pre-projects/cases/c1/overview");
    await userEvent.click(within(grid).getByRole("button", { name: "Mark ready SR-0001" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark SR-0001 ready" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Note" }), "At the showroom desk");
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark ready" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ url: expect.stringContaining("/api/factory/samples/s1"), body: { action: "ready", note: "At the showroom desk", version: 1 } }));
    expect(await screen.findByText("No samples to make")).toBeInTheDocument();
  });

  it("runs work orders from several projects together as a batch and starts it", async () => {
    const other = row({ id: "w2", number: 8, title: "Wardrobes", projectId: "p2", projectReference: "PRJ-0008", status: "released", releasedAt: "2026-09-27T09:00:00Z" });
    const batch = { id: "b1", number: 1, name: "Oak cutting run", workcenterId: "c1", workcenterName: "Joinery", plannedOn: "2099-10-05", status: "open" as const, orders: 2, projects: ["PRJ-0007", "PRJ-0008"], version: 1 };
    const fetcher = mount((url, body) => (url.includes("/batches") ? { batches: [batch], orders: [] } : body ? {} : factory({ orders: [row(), other] })));
    const { unmount } = page("orders");
    const grid = await screen.findByRole("grid", { name: "Work orders" }).catch(() => screen.findByRole("table", { name: "Work orders" }));
    for (const box of within(grid).getAllByRole("checkbox", { name: /Select row/ })) await userEvent.click(box);
    await userEvent.click(await screen.findByRole("button", { name: "Run together (2)" }));
    const dialog = await screen.findByRole("dialog", { name: "Run together" });
    expect(within(dialog).getByText("WO-0007 · PRJ-0007, WO-0008 · PRJ-0008")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Oak cutting run");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create batch" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ name: "Oak cutting run", workcenterId: "c1", plannedOn: "2099-10-05", orderIds: ["w1", "w2"] }));
    const created = String(posts(fetcher).at(-1)!.body.id);
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, "", `/workspace/factory/batches?batch=${created}`);
    unmount();

    nav.query = "batch=b1";
    mount((url) => (url.includes("/batches") ? { batches: [batch], orders: [] } : factory({ orders: [{ ...row(), batchId: "b1", batchNumber: 1, batchName: "Oak cutting run" },
      { ...other, batchId: "b1", batchNumber: 1, batchName: "Oak cutting run" }], batches: [batch] })));
    page("batches");
    const sheet = await screen.findByRole("dialog", { name: "Oak cutting run" });
    expect(within(sheet).getByText("WO-0008 · Wardrobes")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Start batch" }));
    await waitFor(() => expect(posts(vi.mocked(fetch) as never).at(-1)!.body).toEqual({ id: "b1", action: "start", version: 1 }));
  });

  it("sends a step out to a supplier, waits for the goods to come back, and sends made goods to site", async () => {
    nav.query = "order=w1";
    const producing = { status: "in_production" as const, releasedAt: "2026-09-27T09:00:00Z", made: "3.0000", toCheck: "3.0000" };
    const fetcher = mount((url) => (url.includes("/orders/w1") ? order(producing, {
      operations: [{ id: "op1", name: "Polishing", supplierName: "Nile Marble", orderId: "po1", orderNumber: "FAC-PO-2026-00004", orderStatus: "sent", orderLineId: "l1", quantity: "3.0000", back: "1.0000", out: true }],
      dispatches: [{ id: "t1", number: 5, status: "received", sentOn: "2099-10-08", quantity: "1.0000", received: "0.5000", short: true }], atFactory: "2.0000" }) : factory()));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    const outside = await within(sheet).findByRole("region", { name: "Done outside" });
    expect(within(outside).getByText("Polishing at Nile Marble")).toBeInTheDocument();
    expect(within(outside).getByText("1 of 3 m back")).toBeInTheDocument();
    expect(within(outside).getByRole("link", { name: "FAC-PO-2026-00004" })).toHaveAttribute("href", "/workspace/purchasing/orders?order=po1");
    await userEvent.click(within(sheet).getByRole("tab", { name: /To site/ }));
    const trips = await within(sheet).findByRole("region", { name: "Trips to site" });
    expect(within(trips).getByText("Arrived short: 0.5 m")).toBeInTheDocument();
    await userEvent.click(within(within(sheet).getByRole("region", { name: "At the factory" })).getByRole("button", { name: "Send to site" }));
    const dialog = await screen.findByRole("dialog", { name: "Send to site" });
    expect(within(dialog).getByRole("textbox", { name: "Quantity" })).toHaveValue("2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send to site" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "dispatch", quantity: "2", id: expect.any(String) }));

    await userEvent.click(within(sheet).getByRole("button", { name: "More" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Send a step out" }));
    const out = await screen.findByRole("dialog", { name: "Send a step out" });
    await userEvent.type(within(out).getByRole("textbox", { name: /What the supplier does/ }), "Upholstery");
    await userEvent.type(within(out).getByRole("textbox", { name: "Price each" }), "120");
    await userEvent.click(within(out).getByRole("button", { name: "Create service order" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "send_out", name: "Upholstery", vendorId: "s1", quantity: "3", unitPrice: "120" }));
  });

  it("sets what a work order needs before release and adds a workcenter", async () => {
    let data: FactorySettingsState = { settings, workcenters: [], canManage: true, canSeeRates: true, rates: [], currency: "AED", today: "2026-09-27" };
    const fetcher = mount((url, body) => {
      if (body && url.includes("/settings")) data = { ...data, settings: { ...data.settings, requirePayment: body.requirePayment === true, version: 2 } };
      if (body && url.includes("/workcenters")) data = { ...data, workcenters: [{ id: String(body.id), name: String(body.name), hoursPerDay: String(body.hoursPerDay), active: true }] };
      return data;
    });
    render(<DesignSystemProvider><FactorySettingsPage workspaceId="w" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("switch", { name: "Payment before production verified" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ version: 1, requirePayment: false }));
    await userEvent.click(screen.getByRole("button", { name: "Add workcenter" }));
    const dialog = await screen.findByRole("dialog", { name: "Add workcenter" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Name/ }), "Paint shop");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Hours a day" }), "7.5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ name: "Paint shop", hoursPerDay: "7.5", active: true }));
    expect(await screen.findByText("Paint shop")).toBeInTheDocument();
  });

  it("prices a workcenter's hours from a date: a new rate adds to its history, and an unchanged one changes nothing", async () => {
    const paint = { id: "c2", name: "Paint shop", hoursPerDay: "7.50", active: true };
    let data: FactorySettingsState = { settings, workcenters: [joinery, paint], canManage: true, canSeeRates: true, currency: "AED", today: "2026-09-27", rates: [
      { id: "r1", workcenterId: "c1", from: "2026-01-01", rate: "45.5000", currency: "AED", version: 1 }, { id: "r2", workcenterId: "c1", from: "2026-10-01", rate: "50.0000", currency: "AED", version: 1 }] };
    const fetcher = mount((url, body) => {
      if (body) data = { ...data, rates: [...data.rates, { id: "r3", workcenterId: String(body.id), from: String(body.rateFrom), rate: String(body.hourlyRate), currency: "AED", version: 1 }] };
      return data;
    });
    render(<DesignSystemProvider><FactorySettingsPage workspaceId="w" /></DesignSystemProvider>);
    expect(await screen.findByText(/8 hours a day · AED\s?45\.50 an hour · AED\s?50\.00 an hour from/)).toBeInTheDocument();
    expect(screen.getByText("7.5 hours a day · No hourly rate")).toBeInTheDocument();

    // The paint shop's first rate, from today.
    await userEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]);
    let dialog = await screen.findByRole("dialog", { name: "Paint shop" });
    expect(within(dialog).queryByText("From")).toBeNull();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Hourly rate" }), "38");
    expect(within(dialog).getByText("From")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ id: "c2", hourlyRate: "38", rateFrom: "2026-09-27", rateVersion: 0 }));
    expect(await screen.findByText(/7\.5 hours a day · AED\s?38\.00 an hour/)).toBeInTheDocument();

    // The joinery's rate in force shows; it can't be cleared, only changed.
    await userEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    dialog = await screen.findByRole("dialog", { name: "Joinery" });
    const rate = within(dialog).getByRole("textbox", { name: "Hourly rate" });
    expect(rate).toHaveValue("45.5");
    await userEvent.clear(rate);
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps the production steps the firm uses, in its own words, and its target (PLM-063)", async () => {
    const steps = [{ kind: "scheduled", label: "" }, { kind: "in_production", label: "" }, { kind: "quality_check", label: "" }, { kind: "ready", label: "" }];
    const data: FactorySettingsState = { settings: { ...settings, productionSteps: steps as never, productionWeeks: null }, workcenters: [joinery], canManage: true, canSeeRates: false,
      currency: "AED", today: "2026-09-27", rates: [] };
    const fetcher = mount(() => data);
    render(<DesignSystemProvider><FactorySettingsPage workspaceId="w" /></DesignSystemProvider>);
    expect(await screen.findByText("Scheduled → In production → Quality check → Ready")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit production status" }));
    const dialog = await screen.findByRole("dialog", { name: "Production status" });
    expect(within(dialog).getByRole("switch", { name: "Ready" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("switch", { name: "Quality check" }));
    await userEvent.type(within(dialog).getAllByRole("textbox", { name: "Name it" })[1], "Making");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Production target in weeks" }), "8");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ version: 1, productionWeeks: 8,
      productionSteps: [{ kind: "scheduled", label: "" }, { kind: "in_production", label: "Making" }, { kind: "ready", label: "" }] }));
  });

  it("marks an item ready for Inspection 1 before finishing, then waits on the design team (PLM-150)", async () => {
    nav.query = "order=w1";
    const making = { status: "in_production" as const, releasedAt: "2026-10-01T08:00:00Z", left: "3.0000" };
    let current = order(making, { next: "request_inspection", inspection: { raw: "to_request", final: "to_request", dueId: null, dueStage: null, dueOn: null, latestId: null, openSnags: 0 } });
    const fetcher = mount((url, body) => {
      if (url.includes("/orders/w1")) {
        if (body?.action === "request_inspection") current = order({ ...making, version: 3 }, { next: "inspection", inspection: { raw: "due", final: "to_request", dueId: "i1", dueStage: "raw",
          dueOn: "2099-10-08", latestId: "i1", inspectorName: "Dana Designer", openSnags: 0 },
          inspections: [{ id: "i1", stage: "raw", round: 1, status: "due", dueOn: "2099-10-08", resultAt: null, resultByName: null, inspectorName: "Dana Designer", comments: "", openSnags: 0, snags: 0 }] });
        return current;
      }
      return factory();
    });
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    expect(within(sheet).getByRole("status", { name: "Next step" })).toHaveTextContent("Mark it ready for Inspection 1");
    // Finished output waits for Inspection 1.
    expect(within(sheet).queryByRole("button", { name: "Report output" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: "Ready for Inspection 1" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "request_inspection", stage: "raw", version: 2 }));
    const step = await within(sheet).findByRole("status", { name: "Next step" });
    await waitFor(() => expect(step).toHaveTextContent("Inspection 1 is with the design team"));
    expect(step).toHaveTextContent("Dana Designer");
    expect(within(step).getByRole("link", { name: "Open the inspection" })).toHaveAttribute("href", "/workspace/inspections/i1");
  });

  it("doesn't offer to send an item to site until its last inspection passed, and lists every round (PLM-150)", async () => {
    nav.query = "order=w1";
    const ready = { status: "ready" as const, releasedAt: "2026-10-01T08:00:00Z", passed: "3.0000", left: "0" };
    mount((url) => url.includes("/orders/w1") ? order(ready, { next: "snags", atFactory: "3.0000",
      inspection: { raw: "passed", final: "snags", dueId: null, dueStage: null, dueOn: null, latestId: "i3", openSnags: 2 },
      settings: { ...settings, inspectionStages: [{ kind: "raw", label: "" }, { kind: "final", label: "Before dispatch" }] },
      inspections: [
        { id: "i1", stage: "raw", round: 1, status: "passed", dueOn: "2099-10-08", resultAt: "2026-10-08T09:00:00Z", resultByName: "Dana Designer", comments: "", openSnags: 0, snags: 0 },
        { id: "i3", stage: "final", round: 1, status: "failed", dueOn: "2099-10-20", resultAt: "2026-10-20T09:00:00Z", resultByName: "Dana Designer", comments: "Veneer lifting", openSnags: 2, snags: 2 },
      ] }) : factory());
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    expect(within(sheet).getByRole("status", { name: "Next step" })).toHaveTextContent("2 snags to fix");
    expect(within(sheet).queryByRole("button", { name: "Send to site" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("tab", { name: /Output/ }));
    const rounds = await within(sheet).findByRole("region", { name: "Design inspections" });
    expect(within(rounds).getByRole("link", { name: "Inspection 1" })).toHaveAttribute("href", "/workspace/inspections/i1");
    expect(within(rounds).getByRole("link", { name: "Before dispatch" })).toHaveAttribute("href", "/workspace/inspections/i3");
    expect(rounds).toHaveTextContent("2 of 2 snags to fix");
  });

  it("lists the snags to fix on the work order, each marked fixed by the factory there (PLM-150)", async () => {
    nav.query = "order=w1";
    const ready = { status: "ready" as const, releasedAt: "2026-10-01T08:00:00Z", passed: "3.0000", left: "0" };
    const snag = (id: string, number: number, status: string, canFix: boolean) => ({ id, number, title: `Snag ${number}`, severity: "major" as const, status, dueDate: "2099-10-22", inspectionId: "i3",
      version: 2, canFix });
    let fixed = false;
    const fetcher = mount((url, body) => {
      if (url.includes("/inspections/i3") && body?.action === "fix_snag") { fixed = true; return {}; }
      return url.includes("/orders/w1") ? order(ready, { next: "snags", atFactory: "3.0000", inspection: { raw: "passed", final: "snags", dueId: null, dueStage: null, dueOn: null, latestId: "i3", openSnags: fixed ? 1 : 2 },
        snags: [snag("s1", 12, fixed ? "in_review" : "todo", !fixed), snag("s2", 13, "todo", true)] }) : factory();
    });
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    expect(within(sheet).getByRole("status", { name: "Next step" })).toHaveTextContent("Mark each one fixed: it then goes back for inspection.");
    const snags = within(sheet).getByRole("region", { name: "Snags" });
    await userEvent.click(within(within(snags).getByText("#12 Snag 12").closest("li")!).getByRole("button", { name: "Mark fixed" }));
    await waitFor(() => expect(posts(fetcher).find((call) => call.url.includes("/inspections/i3"))?.body).toEqual({ action: "fix_snag", snagId: "s1", version: 2 }));
    expect(await within(within(snags).getByText("#12 Snag 12").closest("li")!).findByText("Fixed")).toBeInTheDocument();
    expect(within(sheet).getByRole("status", { name: "Next step" })).toHaveTextContent("1 snag to fix");
  });

  it("turns design inspections on and keeps only the one after finishing, for the trades and roles chosen (PLM-150)", async () => {
    let data: FactorySettingsState = { settings: { ...settings, inspectionsEnabled: false, inspectionStages: [{ kind: "raw", label: "" }, { kind: "final", label: "" }], inspectionWorkPackages: [],
      inspectorRole: "designer", directorRole: null, directorPackages: [], inspectionDays: 2 }, workcenters: [joinery], canManage: true, canSeeRates: false, currency: "AED",
      today: "2026-09-27", rates: [], inspectionChoices: { roles: [{ key: "designer", label: "Lead Interior Designer" }, { key: "creative_director", label: "Creative Director" }],
        workPackages: [{ id: "wp1", name: "Joinery" }, { id: "wp2", name: "Glass" }], designPackages: [{ code: "creative_director", name: "Designed by the Creative Director" }] } };
    const fetcher = mount((url, body) => {
      if (body) data = { ...data, settings: { ...data.settings, ...body, version: data.settings.version + 1 } as never };
      return data;
    });
    render(<DesignSystemProvider><FactorySettingsPage workspaceId="w" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("switch", { name: "Design inspections" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ version: 1, inspectionsEnabled: true }));
    expect(await screen.findByText("Inspection 1 → Inspection 2")).toBeInTheDocument();
    expect(screen.getByText("Every made item")).toBeInTheDocument();
    expect(screen.getByText("Lead Interior Designer")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit design inspections" }));
    const dialog = await screen.findByRole("dialog", { name: "Design inspections" });
    await userEvent.click(within(dialog).getByRole("switch", { name: "Before the final finish" }));
    await userEvent.type(within(dialog).getAllByRole("textbox", { name: "Name it" })[1], "Before dispatch");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Joinery" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ version: 2, inspectionStages: [{ kind: "final", label: "Before dispatch" }], inspectionWorkPackages: ["wp1"],
      inspectorRole: "designer", directorRole: null, directorPackages: [] }));
    expect(await screen.findByText("Before dispatch")).toBeInTheDocument();
    // Only the joinery trade's items now (the workcenter is also called Joinery).
    expect(screen.queryByText("Every made item")).toBeNull();
    expect(screen.getAllByText("Joinery")).toHaveLength(2);
  });
});
