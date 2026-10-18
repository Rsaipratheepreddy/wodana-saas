import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { WarrantyClaim, WarrantyState } from "@/lib/site/types";
import { ProjectWarranty, WarrantySettingsSection } from "./project-warranty";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/workspace/projects/p1/handover", useSearchParams: () => new URLSearchParams() }));

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const claim = (patch: Partial<WarrantyClaim> = {}): WarrantyClaim => ({
  id: "c1", number: 1, raisedOn: "2026-12-01", raisedByName: "Maya Rahman", channel: "phone", description: "Drawer runner broken", areaId: null, lineId: "l1", lineTitle: "Kitchen cabinets",
  status: "open", decisionNote: "", decidedByName: null, snagId: null, snagNumber: null, snagStatus: null, version: 1, ...patch,
});
const state = (patch: Partial<WarrantyState> = {}): WarrantyState => ({
  items: [{ lineId: "l1", title: "Kitchen cabinets", areaName: "Kitchen", supply: "make", months: 12, startsOn: "2026-09-26", endsOn: "2027-09-25", note: "", active: true },
    { lineId: "l2", title: "Under-cabinet lights", areaName: null, supply: "buy", months: 6, startsOn: "2026-09-26", endsOn: "2027-03-25", note: "", active: false }],
  claims: [claim()], lines: [{ id: "l1", title: "Kitchen cabinets" }, { id: "l2", title: "Under-cabinet lights" }], areas: [{ id: "a1", name: "Kitchen" }], today: "2027-06-01",
  canRecord: true, canManage: true, ...patch,
});
const mount = (respond: (url: string, init?: RequestInit) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => respond(url, init) }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const sent = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method && init.method !== "GET").map(([, init]) => JSON.parse(String(init!.body)));

describe("warranty", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows each item's cover and decides a claim as covered, becoming a warranty snag", async () => {
    const fetcher = mount(() => state());
    render(<DesignSystemProvider><ProjectWarranty workspaceId="w" projectId={PID} /></DesignSystemProvider>);
    const cover = await screen.findByRole("region", { name: "Cover" });
    expect(within(cover).getByText("Until Sep 25, 2027")).toBeInTheDocument();
    expect(within(cover).getByText("Ended Mar 25, 2027")).toBeInTheDocument();
    const claims = screen.getByRole("region", { name: "Claims" });
    expect(within(claims).getByText("Drawer runner broken")).toBeInTheDocument();
    await userEvent.click(within(claims).getByRole("button", { name: "Decide" }));
    const dialog = await screen.findByRole("dialog", { name: "Claim 1" });
    expect(within(dialog).getByText("Kitchen cabinets is covered from Sep 26, 2026 to Sep 25, 2027.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent(fetcher).at(-1)).toEqual({ action: "decide_claim", claimId: "c1", version: 1, decision: "covered", note: "", severity: "major" }));
  });

  it("asks why for a claim outside cover, and records a new claim", async () => {
    const fetcher = mount(() => state({ claims: [claim({ lineId: "l2", lineTitle: "Under-cabinet lights", raisedOn: "2027-06-01" })] }));
    render(<DesignSystemProvider><ProjectWarranty workspaceId="w" projectId={PID} /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Decide" }));
    const dialog = await screen.findByRole("dialog", { name: "Claim 1" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Chargeable" }));
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What the client will be charged for/ }), "Replace the driver at cost");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent(fetcher).at(-1)).toMatchObject({ decision: "chargeable", note: "Replace the driver at cost" }));

    await userEvent.click(screen.getByRole("button", { name: "Record a claim" }));
    const form = await screen.findByRole("dialog", { name: "Record a claim" });
    await userEvent.type(within(form).getByRole("textbox", { name: /Who raised it/ }), "Maya Rahman");
    await userEvent.type(within(form).getByRole("textbox", { name: /What's wrong/ }), "Door hinge loose");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent(fetcher).at(-1)).toMatchObject({ action: "record_claim", raisedOn: "2027-06-01", raisedByName: "Maya Rahman", channel: "phone", description: "Door hinge loose" }));
  });

  it("turns a chargeable claim into a variation of the project and opens it", async () => {
    const chargeable = claim({ status: "chargeable", decisionNote: "Misuse", version: 2 });
    const fetcher = mount((url, init) => {
      if (url.startsWith("/api/commercial/cases/")) return { data: { revision: 7, quotes: [{ id: "q1", number: 1, kind: "quotation" }, { id: "v9", number: 3, kind: "variation" }] } };
      if (init?.method === "POST") return state({ claims: [{ ...chargeable, variationId: "v9", variationNumber: 3, variationStatus: "draft", variationApplied: null }], caseId: "case1", baselineQuoteId: "q1" });
      return state({ claims: [chargeable], caseId: "case1", baselineQuoteId: "q1" });
    });
    render(<DesignSystemProvider><ProjectWarranty workspaceId="w" projectId={PID} /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Start variation" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/workspace/projects/${PID}/changes/v9`));
    expect(sent(fetcher)).toEqual([{ action: "variation", revision: 7, quoteId: "q1" }, { action: "link_variation", claimId: "c1", quoteId: "v9", version: 2 }]);
    expect(await screen.findByRole("link", { name: "Variation V3 · Draft" })).toHaveAttribute("href", `/workspace/projects/${PID}/changes/v9`);
  });

  it("sets the months of warranty for each way of delivering a package", async () => {
    const fetcher = mount(() => ({ months: { make: 12, buy: 12, ready_made: 12, subcontract: 12, client: 0, site_work: 12 }, canManage: true }));
    render(<DesignSystemProvider><WarrantySettingsSection workspaceId="w" supplies={{ make: "Made in our factory", buy: "Bought materials", ready_made: "Bought ready-made", subcontract: "Subcontracted",
      client: "Supplied by the client", site_work: "Site work" }} /></DesignSystemProvider>);
    const made = await screen.findByRole("textbox", { name: "Made in our factory" });
    await userEvent.clear(made);
    await userEvent.type(made, "24");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent(fetcher).at(-1)).toEqual({ months: { make: 24, buy: 12, ready_made: 12, subcontract: 12, client: 0, site_work: 12 } }));
  });
});
