import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { OpportunityDiscovery, type DiscoveryView } from "./opportunity-discovery";

afterEach(() => vi.unstubAllGlobals());
const packages = { minimumDeposit: null, version: 1, packages: [
  { id: "p1", code: "bespoke", name: "Bespoke Interior Design", pricingMethod: "per_area", rate: "40.00", currency: "AED", areaUnit: "sqft", includedRevisions: 2, includesSpacePlanning: true, includesRenders: true, requiredRoleCode: null, inclusions: null, position: 1, status: "active", version: 1 },
] };
const view = (over: Partial<DiscoveryView> = {}): DiscoveryView => ({
  facts: { area: null, areaUnit: null, spaces: null, propertyLocation: null, clientEmail: "client@example.com", floorPlanAssetId: null, designPackageId: null },
  designFee: null, package: null, enquiryType: "full_home", clientType: "homeowner",
  questions: [{ key: "budget", label: "Budget range", required: true }], answers: {},
  files: [{ id: "f1", name: "plan.pdf", mimeType: "application/pdf" }],
  missing: [{ key: "floorPlan", label: "Floor plan" }, { key: "area", label: "Area" }, { key: "question:budget", label: "Budget range" }], version: 0, ...over,
});

function stub(discovery: DiscoveryView) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/design/settings")) return { ok: true, json: async () => packages };
    if (url.includes("/quote")) return { ok: true, json: async () => ({ fee: "4000.00", currency: "AED" }) };
    return { ok: true, json: async () => discovery };
  }));
  return calls;
}

describe("opportunity discovery (PLM-040)", () => {
  it("shows the facts without a separate list of what is missing (the Now card says it)", async () => {
    stub(view());
    render(<DesignSystemProvider><OpportunityDiscovery workspaceId="ws" opportunityId="o1" locale="en-GB" /></DesignSystemProvider>);
    expect(await screen.findByRole("textbox", { name: "Client email" })).toBeInTheDocument();
    expect(screen.queryByText(/Needed for Design Quote/)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Client email" })).toHaveValue("client@example.com");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves the facts with the version it loaded", async () => {
    const calls = stub(view());
    render(<DesignSystemProvider><OpportunityDiscovery workspaceId="ws" opportunityId="o1" locale="en-GB" /></DesignSystemProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "Area" }), { target: { value: "100" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Budget range" }), { target: { value: "200k" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.url).toContain("opportunities/o1/discovery");
    expect(put.body).toMatchObject({ version: 0, area: "100", areaUnit: "sqft", clientEmail: "client@example.com", answers: { budget: "200k" } });
  });

  it("shows the priced fee", async () => {
    stub(view({ missing: [], designFee: { amount: "4000.00", currency: "AED" }, facts: { area: "100", areaUnit: "sqft", spaces: null, propertyLocation: "Marina", clientEmail: "c@example.com", floorPlanAssetId: "f1", designPackageId: "p1" } }));
    render(<DesignSystemProvider><OpportunityDiscovery workspaceId="ws" opportunityId="o1" locale="en-GB" /></DesignSystemProvider>);
    expect(await screen.findByText(/4,000\.00/)).toBeInTheDocument();
  });
});
