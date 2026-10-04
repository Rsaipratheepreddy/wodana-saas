import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { DiscoverySheet, useDiscovery, type DiscoveryGroup, type DiscoveryView } from "./opportunity-discovery";

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));

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
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    if (url.includes("/assets/")) return { ok: true, json: async () => ({ id: "asset-1", name: "plan.pdf", mimeType: "application/pdf", byteSize: 4, hasPreview: false }) };
    if (url.includes("requirement-notes") && method === "PUT") return { ok: true, json: async () => ({ items: [{ ...JSON.parse(String(init!.body)), version: 1 }], canEdit: true }) };
    if (url.includes("/design/settings")) return { ok: true, json: async () => packages };
    if (url.includes("/quote")) return { ok: true, json: async () => ({ fee: "4000.00", currency: "AED" }) };
    return { ok: true, json: async () => discovery };
  }));
  return calls;
}

function Sheet({ group, onClose = vi.fn(), leadId = "l1" }: { group: DiscoveryGroup; onClose?: () => void; leadId?: string | null }) {
  const discovery = useDiscovery("ws", "o1");
  return discovery.view ? <DiscoverySheet workspaceId="ws" opportunityId="o1" leadId={leadId} group={group} discovery={discovery} locale="en-GB" onClose={onClose} /> : null;
}
const renderSheet = (props: Parameters<typeof Sheet>[0]) => render(<DesignSystemProvider><Sheet {...props} /></DesignSystemProvider>);

describe("opportunity discovery sheets (PLM-040)", () => {
  it("edits only the property details and saves them with the version it loaded, then closes", async () => {
    const calls = stub(view());
    const onClose = vi.fn();
    renderSheet({ group: "property", onClose });
    const sheet = await screen.findByRole("dialog", { name: "Property details" });
    expect(screen.getByRole("textbox", { name: "Client email" })).toHaveValue("client@example.com");
    expect(screen.queryByRole("textbox", { name: "Budget range" })).not.toBeInTheDocument();
    expect(sheet.querySelector("[data-variant=primary]")).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Area" }), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.url).toContain("opportunities/o1/discovery");
    expect(put.body).toMatchObject({ version: 0, area: "100", areaUnit: "sqft", clientEmail: "client@example.com" });
  });

  it("answers the intro questions in their own sheet", async () => {
    const calls = stub(view());
    renderSheet({ group: "questions" });
    fireEvent.change(await screen.findByRole("textbox", { name: "Budget range" }), { target: { value: "200k" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    expect(calls.find((call) => call.method === "PUT")!.body).toMatchObject({ answers: { budget: "200k" } });
  });

  it("uploads the floor plan into the enquiry's files and chooses it", async () => {
    const calls = stub(view({ files: [] }));
    renderSheet({ group: "property" });
    await screen.findByRole("dialog", { name: "Property details" });
    const input = screen.getByLabelText("Upload floor plan", { selector: "input" });
    fireEvent.change(input, { target: { files: [new File(["%PDF"], "plan.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.includes("/requirement-notes/lead/l1/"))).toBe(true));
    await waitFor(() => expect(calls.find((call) => call.method === "PUT" && call.url.includes("requirement-notes"))?.body).toMatchObject({ title: "Floor plan", version: 0, assetIds: ["asset-1"] }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((call) => call.method === "PUT" && call.url.includes("discovery"))?.body).toMatchObject({ floorPlanAssetId: "asset-1" }));
  });

  it("shows the priced fee with the package", async () => {
    stub(view({ missing: [], designFee: { amount: "4000.00", currency: "AED" }, facts: { area: "100", areaUnit: "sqft", spaces: null, propertyLocation: "Marina", clientEmail: "c@example.com", floorPlanAssetId: "f1", designPackageId: "p1" } }));
    renderSheet({ group: "package" });
    expect(await screen.findByText(/4,000\.00/)).toBeInTheDocument();
  });
});
