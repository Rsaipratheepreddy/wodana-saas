import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { DiscoverySheet, useDiscovery, type DiscoveryGroup, type DiscoveryView } from "./opportunity-discovery";

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));

afterEach(() => vi.unstubAllGlobals());
const packages = { minimumDeposit: null, version: 1, packages: [
  { id: "p1", code: "bespoke", name: "Bespoke Interior Design", pricingMethod: "per_area", rate: "40.00", currency: "AED", areaUnit: "sqft", includedRevisions: 2, includesSpacePlanning: true, includesRenders: true, requiredRoleCode: null, inclusions: null, position: 1, status: "active", version: 1 },
] };
const view = (over: Partial<DiscoveryView> = {}): DiscoveryView => ({
  facts: { area: null, areaUnit: null, spaces: null, propertyLocation: null, clientEmail: "client@example.com", floorPlanAssetId: null, designPackageId: null, latitude: null, longitude: null },
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
    // The server follows one known short link; any other resolves to nothing.
    if (url.includes("/map-link")) return { ok: true, json: async () => ({ url: decodeURIComponent(url).includes("AbCdEf12345") ? "https://www.google.com/maps/place/Villa/@25.11,55.13,17z/data=!3m1!4b1!8m2!3d25.1124317!4d55.1390165" : null }) };
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
    stub(view({ missing: [], designFee: { amount: "4000.00", currency: "AED" }, facts: { area: "100", areaUnit: "sqft", spaces: null, propertyLocation: "Marina", clientEmail: "c@example.com", floorPlanAssetId: "f1", designPackageId: "p1", latitude: null, longitude: null } }));
    renderSheet({ group: "package" });
    expect(await screen.findByText(/4,000\.00/)).toBeInTheDocument();
  });

  it("prices a package priced from its rate at the agreed rate (PLM-139)", async () => {
    packages.packages.push({ ...packages.packages[0], id: "p2", code: "director", name: "Designed by the Creative Director", rate: "100.00", rateFrom: true } as never);
    try {
      const calls = stub(view({ missing: [], designFee: { amount: "216000.00", currency: "AED" }, designRate: { requested: "120.00", rate: "120.00", approval: "approved", waitingFor: [] },
        facts: { area: "1800", areaUnit: "sqft", spaces: null, propertyLocation: "Jumeirah", clientEmail: "c@example.com", floorPlanAssetId: "f1", designPackageId: "p2", latitude: null, longitude: null, designRate: "120.00" } }));
      renderSheet({ group: "package" });
      expect(await screen.findByText("Rate approved")).toBeInTheDocument();
      await waitFor(() => expect(calls.find((call) => call.url.includes("/quote"))?.body).toEqual({ area: "1800", areaUnit: "sqft", rate: "120" }));
    } finally { packages.packages.pop(); }
  });

  it("places the property from a pasted map link, opens it in Maps and saves the coordinates", async () => {
    const calls = stub(view({ facts: { ...view().facts, propertyLocation: "Villa 12, Palm Way" } }));
    const onClose = vi.fn();
    renderSheet({ group: "property", onClose });
    await screen.findByRole("dialog", { name: "Property details" });
    expect(screen.queryByRole("link", { name: "Open in Maps" })).not.toBeInTheDocument();
    const link = screen.getByRole("textbox", { name: "Paste a Google Maps link" });
    // A pasted link is complete, so it is read at once.
    fireEvent.paste(link);
    fireEvent.change(link, { target: { value: "https://maps.app.goo.gl/AbCdEf" } });
    expect(await screen.findByText("No coordinates in this link")).toBeInTheDocument();
    fireEvent.paste(link);
    fireEvent.change(link, { target: { value: "https://www.google.com/maps/place/Villa/@25.11,55.13,17z/data=!3m1!4b1!8m2!3d25.1124317!4d55.1390165" } });
    expect(link).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Latitude" })).toHaveValue("25.1124317");
    expect(screen.getByRole("textbox", { name: "Longitude" })).toHaveValue("55.1390165");
    expect(screen.getByRole("link", { name: "Open in Maps" })).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=25.1124317,55.1390165");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((call) => call.method === "PUT")!.body).toMatchObject({ version: 0, propertyLocation: "Villa 12, Palm Way", latitude: 25.1124317, longitude: 55.1390165 });
  });

  it("follows a short Share link from the Maps app through the server, then reads its coordinates", async () => {
    const calls = stub(view());
    renderSheet({ group: "property", onClose: vi.fn() });
    await screen.findByRole("dialog", { name: "Property details" });
    const link = screen.getByRole("textbox", { name: "Paste a Google Maps link" });
    fireEvent.paste(link);
    fireEvent.change(link, { target: { value: "https://maps.app.goo.gl/AbCdEf12345" } });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Latitude" })).toHaveValue("25.1124317"));
    expect(calls.some((call) => call.url.includes("/map-link?") && decodeURIComponent(call.url).includes("maps.app.goo.gl/AbCdEf12345"))).toBe(true);
    expect(link).toHaveValue("");
    expect(screen.queryByText("No coordinates in this link")).not.toBeInTheDocument();
  });

  it("reads a map link typed key by key only once it is complete, never a half-typed longitude", async () => {
    const user = userEvent.setup();
    const calls = stub(view());
    const onClose = vi.fn();
    renderSheet({ group: "property", onClose });
    await screen.findByRole("dialog", { name: "Property details" });
    const link = screen.getByRole("textbox", { name: "Paste a Google Maps link" });
    // On its way, the link reads "…/@25.2048493,5" (a longitude of 5): nothing is filled while it is typed.
    await user.type(link, "https://www.google.com/maps/@25.2048493,55.2707828,15z");
    expect(link).toHaveValue("https://www.google.com/maps/@25.2048493,55.2707828,15z");
    expect(screen.getByRole("textbox", { name: "Latitude" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Longitude" })).toHaveValue("");
    expect(screen.queryByText("No coordinates in this link")).not.toBeInTheDocument();
    // Leaving the field reads the whole link.
    await user.tab();
    expect(link).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Latitude" })).toHaveValue("25.2048493");
    expect(screen.getByRole("textbox", { name: "Longitude" })).toHaveValue("55.2707828");
    // Enter reads it too; a typed link without coordinates is marked only then.
    await user.type(link, "https://maps.app.goo.gl/AbCdEf");
    expect(screen.queryByText("No coordinates in this link")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("No coordinates in this link")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((call) => call.method === "PUT")!.body).toMatchObject({ latitude: 25.2048493, longitude: 55.2707828 });
  });

  it("uses the browser's current location, and a half-entered position blocks the save", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({ coords: { latitude: -33.86881234, longitude: 151.20929876 } } as GeolocationPosition));
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });
    const calls = stub(view());
    renderSheet({ group: "property" });
    const sheet = await screen.findByRole("dialog", { name: "Property details" });
    fireEvent.click(screen.getByRole("button", { name: "Use my current location" }));
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ enableHighAccuracy: true }));
    expect(await screen.findByRole("link", { name: "Open in Maps" })).toHaveAttribute("href", expect.stringContaining("query=-33.868812,151.209299"));
    const longitude = screen.getByRole("textbox", { name: "Longitude" });
    fireEvent.change(longitude, { target: { value: "" } });
    fireEvent.blur(longitude);
    await waitFor(() => expect(sheet.querySelector("[data-variant=primary]")).toBeDisabled());
    expect(screen.queryByRole("link", { name: "Open in Maps" })).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("says so when the browser has no location", async () => {
    vi.stubGlobal("navigator", { ...navigator, geolocation: undefined });
    stub(view());
    renderSheet({ group: "property" });
    await screen.findByRole("dialog", { name: "Property details" });
    fireEvent.click(screen.getByRole("button", { name: "Use my current location" }));
    expect(await screen.findByText("Location unavailable")).toBeInTheDocument();
  });
});
