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
});
