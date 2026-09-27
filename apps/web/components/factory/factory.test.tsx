import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { FactorySettingsState, FactoryState, WorkOrderState } from "@/lib/factory/types";
import type { FactorySection } from "@/lib/factory/sections";
import { FactoryPage } from "./factory-page";
import { FactorySettingsPage } from "./factory-settings";

const nav = vi.hoisted(() => ({ replace: vi.fn(), query: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }), usePathname: () => "/workspace/factory", useSearchParams: () => new URLSearchParams(nav.query) }));

const settings = { requireDrawing: true, requirePayment: true, requireMaterials: true, requireCheck: true, version: 1 };
const joinery = { id: "c1", name: "Joinery", hoursPerDay: "8.00", active: true };
const line = { lineId: "l1", projectId: "p1", projectReference: "PRJ-0007", projectName: "Villa 12", packageId: "k1", packageName: "Kitchen joinery", title: "Kitchen cabinets",
  specification: "Oak veneer", unit: "m", quantity: "4.5000", planned: "3.0000", left: "1.5000", suggestedStart: "2099-10-05", suggestedEnd: "2099-10-16" };
const row = (patch: Partial<WorkOrderState["order"]> = {}): WorkOrderState["order"] => ({
  id: "w1", number: 7, projectId: "p1", projectReference: "PRJ-0007", projectName: "Villa 12", packageId: "k1", packageName: "Kitchen joinery", boqLineId: "l1", title: "Kitchen cabinets",
  specification: "", quantity: "3.0000", unit: "m", status: "planned", workcenterId: "c1", workcenterName: "Joinery", plannedStart: "2099-10-05", plannedEnd: "2099-10-16", notes: "", version: 2,
  made: "0", pending: "0", passed: "0", toCheck: "0", left: "3.0000", scrapped: "0", drawingRef: "", drawingApprovedAt: null, drawingApprovedByName: null, holdReason: null,
  closeReason: null, closedAt: null, releasedAt: null, readyAt: null, ...patch,
});
const factory = (patch: Partial<FactoryState> = {}): FactoryState => ({ toMake: [line], orders: [row()], workcenters: [joinery], canManage: true, canReport: true, canApprove: true, ...patch });
const order = (patch: Partial<WorkOrderState["order"]> = {}, extra: Partial<WorkOrderState> = {}): WorkOrderState => ({
  order: row(patch), reports: [], checks: [], events: [], settings, workcenters: [joinery], canManage: true, canReport: true, canApprove: true, me: "u1",
  releaseChecks: patch.status && patch.status !== "planned" ? [] : [
    { key: "running", passed: true, missing: "" }, { key: "drawing", passed: false, missing: "the drawing isn't approved" }, { key: "payment", passed: true, missing: "" },
    { key: "materials", passed: false, missing: "materials aren't in: Oak veneer", detail: ["Oak veneer"] }, { key: "schedule", passed: true, missing: "" }],
  ...extra,
});
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method && init.method !== "GET").map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) }));
const page = (section: FactorySection = "to-make") => render(<DesignSystemProvider><FactoryPage workspaceId="w" section={section} /></DesignSystemProvider>);

describe("factory", () => {
  afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); nav.query = ""; });

  it("lists what's left to make by project and plans a work order for part of a line", async () => {
    const fetcher = mount((url, body) => (body ? order({ id: "new" }) : factory()));
    page();
    const table = await screen.findByRole("table", { name: "To make" }).catch(() => screen.findByRole("grid", { name: "To make" }));
    expect(table).toHaveTextContent("PRJ-0007 · Villa 12");
    expect(table).toHaveTextContent("1.5 m");
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
    expect(nav.replace).toHaveBeenLastCalledWith("/workspace/factory/orders?order=new", { scroll: false });
  });

  it("releases a work order only when its checks pass, and records the drawing approval", async () => {
    nav.query = "order=w1";
    let current = order();
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
    expect(within(sheet).getByRole("button", { name: "Release" })).toBeDisabled();
    await userEvent.click(within(sheet).getByRole("button", { name: "Record approval" }));
    const dialog = await screen.findByRole("dialog", { name: "Drawing approval" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Approved drawing/ }), "K-01 rev B");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "approve_drawing", reference: "K-01 rev B", version: 2 }));
    expect(await within(sheet).findByText(/K-01 rev B, approved by Omar/)).toBeInTheDocument();
  });

  it("reports output with why anything was scrapped, and lets someone else approve it", async () => {
    nav.query = "order=w1";
    const producing = { status: "in_production" as const, releasedAt: "2026-09-27T09:00:00Z" };
    const reports: WorkOrderState["reports"] = [
      { id: "r1", good: "2.0000", scrap: "0.5000", scrapReason: "Chipped edge", note: "", status: "pending", reportedBy: "u2", reportedByName: "Faisal", reportedAt: "2026-09-27T11:00:00Z", decidedByName: null, decisionNote: "" },
      { id: "r2", good: "0.5000", scrap: "0", scrapReason: "", note: "", status: "pending", reportedBy: "u1", reportedByName: "Me", reportedAt: "2026-09-27T12:00:00Z", decidedByName: null, decisionNote: "" }];
    const fetcher = mount((url) => (url.includes("/orders/w1") ? order({ ...producing, pending: "2.5000", left: "0.5000" }, { reports }) : factory()));
    page("orders");
    const sheet = await screen.findByRole("dialog", { name: "WO-0007 · Kitchen cabinets" });
    const output = await within(sheet).findByRole("region", { name: "Output" });
    expect(within(output).getByText("2 m made · 0.5 m scrapped: Chipped edge")).toBeInTheDocument();
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
    await userEvent.click(within(dialog).getByRole("button", { name: "Report output" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "report", good: "0.5", scrap: "0.25", scrapReason: "Split", id: expect.any(String) }));
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
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toMatchObject({ action: "check", passed: "1.5", failed: "0.5", failReason: "Veneer lifting" }));
  });

  it("sets what a work order needs before release and adds a workcenter", async () => {
    let data: FactorySettingsState = { settings, workcenters: [], canManage: true };
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
});
