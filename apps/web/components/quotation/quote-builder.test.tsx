import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { BuilderLine, BuilderState } from "@/lib/quotation/types";
import { QuoteBuilder } from "./quote-builder";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const KITCHEN = "11111111-1111-4111-8111-111111111111", JOINERY = "44444444-4444-4444-8444-444444444444";
const line = (fields: Partial<BuilderLine>): BuilderLine => ({
  id: "a", position: 0, version: 3, kind: "item", areaId: KITCHEN, fromAreaId: null, workPackageId: JOINERY, title: "Base cabinets", description: "", unit: "lm", quantity: "4", formula: null, formulaError: null,
  length: null, width: null, height: null, count: null, dimensionUnit: null, rate: "100", unitCost: "60", markupPercent: null, pricingMode: "rate", discountKind: null, discountValue: null,
  taxCode: null, taxRate: null, optional: null, optionGroup: null, note: "", catalogItemId: null, catalogSnapshot: null, buildUpComplete: null, updatedAt: "", updatedByName: null, components: [], imageAssetId: null, catalogImageId: null, material: "", values: {}, ...fields,
});
const state = (lines: BuilderLine[]): BuilderState => ({
  quote: { id: "q1", number: 2, title: "Main quote", status: "draft", kind: "quotation", round: "main", currency: "AED", decimals: 2, validUntil: null, taxRate: "5", revision: 1, paymentTerms: [], approvedBy: null, clientDecision: null },
  family: [{ id: "q1", number: 2, status: "draft", total: "420.00", createdAt: null }],
  flow: { internalReview: true, reviewAction: "approve", canReview: true, canRecordDecision: true },
  paymentTemplates: [],
  settings: { defaultView: "area", pricesIncludeTax: false, rounding: "line", defaultMarkupPercent: "0", marginFloorPercent: null, discountApprovalPercent: null, validityDays: 30, internalReview: true, priceBookId: null, decisionReminderDays: [2, 5], expiryWarningDays: 3, defaultPaymentTemplateId: null, version: 0 },
  areas: [{ id: KITCHEN, name: "Kitchen" }], workPackages: [{ id: JOINERY, name: "Joinery" }], taxCodes: [], lines, discounts: [],
  pricing: { lines: lines.map((item) => ({ id: item.id, included: true, gross: "400.00", lineDiscount: "0.00", sectionDiscount: "0.00", quoteDiscount: "0.00", net: "400.00", tax: "20.00", total: "420.00", cost: "240.00" })),
    areas: [{ key: KITCHEN, gross: "400.00", discount: "0.00", net: "400.00" }], trades: [{ key: JOINERY, gross: "400.00", discount: "0.00", net: "400.00" }], subtotal: "400.00",
    discounts: { line: "0.00", section: "0.00", quote: "0.00", total: "0.00" }, net: "400.00", tax: "20.00", taxes: [{ rate: "5", base: "400.00", tax: "20.00" }], total: "420.00", cost: "240.00", margin: "40.00", optionalTotal: "0.00" },
  checks: [], me: "u1",
  document: { style: "atelier", accent: null, sections: { cover: true, intro: true, summary: true, items: true, payments: true, terms: true, acceptance: true }, title: "", subtitle: "", intro: "", terms: "", exclusions: "", itemsView: "area", itemsDetail: "lines", showRates: true, showDescriptions: true, showImages: false, coverAssetId: null },
  brand: { name: "Studio", logo: "", primaryColor: "#1f6f5c", accentColor: "#1f6f5c" }, client: { name: "Maya Client", project: "Villa", address: null },
  canEdit: true, canEditCosts: true, canViewCosts: true,
});
const mount = (initial: BuilderState, respond: (url: string, body: unknown) => unknown = () => initial) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined) }));
  vi.stubGlobal("fetch", fetcher);
  render(<DesignSystemProvider><QuoteBuilder workspaceId="w" caseId="c" quoteId="q1" backHref="/quotes" initial={initial} /></DesignSystemProvider>);
  return fetcher;
};
const posted = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([url, init]) => init?.method === "POST" && !String(url).includes("/pulse") && typeof init.body === "string").map(([, init]) => JSON.parse(String(init!.body)));

describe("quotation builder", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("groups lines by area with totals, and regroups by trade", async () => {
    mount(state([line({})]));
    const grid = screen.getByRole("grid", { name: "Quote lines" });
    expect(within(grid).getByText("Kitchen")).toBeInTheDocument();
    expect(within(grid).getByText("General")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Totals/ }));
    expect(screen.getByRole("complementary", { name: "Totals" })).toHaveTextContent("Margin40%");
    await userEvent.click(screen.getByRole("button", { name: /Group by area/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "By trade" }));
    expect(within(grid).getByText("Joinery")).toBeInTheDocument();
    expect(within(grid).getByRole("combobox", { name: "Area" })).toHaveValue("Kitchen");
  });

  it("saves a cell with the line's version and moves down on Enter", async () => {
    const fetcher = mount(state([line({})]));
    const quantity = screen.getByRole("textbox", { name: "Quantity" });
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "6{Enter}");
    await waitFor(() => expect(posted(fetcher)).toEqual([{ ops: [{ op: "upsert", line: { id: "a", quantity: "6", version: 3 } }] }]));
  });

  it("finds a catalog item from the item cell and fills a new line with it", async () => {
    const initial = state([line({})]);
    const fetcher = mount(initial, (url) => url.includes("/catalog") ? { items: [{ id: "i1", code: "WRD", name: "Wardrobe", itemType: "assembly", unitCode: "nos", categoryName: "Joinery", description: null, rate: "7200", hasBuildUp: false }] } : initial);
    await userEvent.click(screen.getAllByRole("button", { name: "New line" })[0]);
    await userEvent.type(screen.getAllByRole("combobox", { name: "Item" }).at(-1)!, "ward");
    await userEvent.click(await screen.findByRole("option", { name: /Wardrobe/ }));
    await waitFor(() => expect(posted(fetcher)).toEqual([{ ops: [{ op: "catalog", itemId: "i1", line: expect.objectContaining({ areaId: KITCHEN, workPackageId: null }) }] }]));
  });

  it("adds an item from the catalog panel to the chosen area", async () => {
    const initial = state([line({})]);
    const fetcher = mount(initial, (url) => url.includes("/catalog") ? { items: [{ id: "i1", code: "WRD", name: "Wardrobe", itemType: "assembly", unitCode: "nos", categoryName: "Joinery", description: null, rate: "7200", hasBuildUp: false }] } : initial);
    await userEvent.click(screen.getByRole("button", { name: "Catalog" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add Wardrobe" }));
    await waitFor(() => expect(posted(fetcher)).toEqual([{ ops: [{ op: "catalog", itemId: "i1", line: expect.objectContaining({ areaId: null, workPackageId: null }) }] }]));
  });

  it("drops a new line left empty instead of saving it", async () => {
    const fetcher = mount(state([line({})]));
    await userEvent.click(screen.getAllByRole("button", { name: "New line" })[0]);
    const cell = screen.getAllByRole("combobox", { name: "Item" }).at(-1)!;
    fireEvent.blur(cell);
    await waitFor(() => expect(screen.getAllByRole("combobox", { name: "Item" })).toHaveLength(1));
    expect(posted(fetcher)).toEqual([]);
  });

  it("writes the size in the workspace's unit and the material as typed", async () => {
    const fetcher = mount({ ...state([line({})]), sizeUnit: "cm", units: [{ code: "lm", label: "running metre" }, { code: "nos", label: "number" }], materials: ["Veneer wood"] });
    const length = screen.getByRole("textbox", { name: "Length" });
    await userEvent.type(length, "220{Enter}");
    await waitFor(() => expect(posted(fetcher)).toContainEqual({ ops: [{ op: "upsert", line: { id: "a", length: "220", dimensionUnit: "cm", version: 3 } }] }));
    const material = screen.getByRole("combobox", { name: "Material" });
    await userEvent.type(material, "Taj Mahal marble / veneer");
    fireEvent.blur(material);
    await waitFor(() => expect(posted(fetcher)).toContainEqual({ ops: [{ op: "upsert", line: expect.objectContaining({ id: "a", material: "Taj Mahal marble / veneer" }) }] }));
  });

  it("picks the unit from the workspace's units", async () => {
    const fetcher = mount({ ...state([line({})]), units: [{ code: "lm", label: "running metre" }, { code: "nos", label: "number" }] });
    // A click opens the whole list; typing narrows it.
    await userEvent.click(screen.getByRole("button", { name: "Unit" }));
    expect(await screen.findAllByRole("option")).toHaveLength(3);
    await userEvent.type(screen.getByRole("combobox", { name: "Unit" }), "{Control>}a{/Control}no");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["nos"]);
    await userEvent.click(screen.getByRole("option", { name: "nos" }));
    await waitFor(() => expect(posted(fetcher)).toContainEqual({ ops: [{ op: "upsert", line: expect.objectContaining({ id: "a", unit: "nos" }) }] }));
  });

  it("keeps what was typed in a new row as a line when you click away, like a spreadsheet", async () => {
    const fetcher = mount(state([line({})]));
    await userEvent.click(screen.getAllByRole("button", { name: "New line" })[0]);
    const cell = screen.getAllByRole("combobox", { name: "Item" }).at(-1)!;
    await userEvent.type(cell, "Site protection");
    fireEvent.blur(cell);
    await waitFor(() => expect(posted(fetcher)).toEqual([{ ops: [{ op: "upsert", line: expect.objectContaining({ title: "Site protection", areaId: KITCHEN }) }] }]));
  });

  it("adds a line to an area that has none yet", async () => {
    const fetcher = mount(state([]));
    const kitchen = screen.getAllByRole("button", { name: "New line" })[0];
    await userEvent.click(kitchen);
    const cell = screen.getAllByRole("combobox", { name: "Item" }).at(-1)!;
    await userEvent.type(cell, "Tall pantry unit");
    fireEvent.blur(cell);
    await waitFor(() => expect(posted(fetcher)).toEqual([{ ops: [{ op: "upsert", line: expect.objectContaining({ title: "Tall pantry unit", areaId: KITCHEN }) }] }]));
  });

  it("reads numbers the workspace's way and puts back anything that isn't one", async () => {
    const fetcher = mount(state([line({})]));
    const quantity = screen.getByRole("textbox", { name: "Quantity" });
    await userEvent.clear(quantity);
    await userEvent.type(quantity, ".{Enter}");
    expect(posted(fetcher)).toEqual([]);
    expect(quantity).toHaveValue("4");
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "1,250.5{Enter}");
    await waitFor(() => expect(posted(fetcher)).toEqual([{ ops: [{ op: "upsert", line: { id: "a", quantity: "1250.5", version: 3 } }] }]));
  });

  it("turns rows pasted from the estimator's own sheet into lines, mapping its headings", async () => {
    const fetcher = mount({ ...state([line({})]), sizeUnit: "cm" });
    await userEvent.click(screen.getAllByRole("button", { name: "New line" })[0]);
    const cell = screen.getAllByRole("combobox", { name: "Item" }).at(-1)!;
    const sheet = ["SN\tDESCRIPTION OF ITEM\tINSPO PICTURE\tLENGTH (cm)\tHEIGHT (cm)\tDEPTH (cm)\tMATERIALS REQUESTED\tQTY\tUNIT PRICE\tTOTAL AMOUNT",
      "1\tDining Chairs\t\t-\t-\t-\tPL Core Fabric / Veneer wood\t6\tAED3,500.00\tAED21,000.00",
      "2\tDining Table\t\t220\t75\t100\tTaj mahal marble / veneer wood\t1\tAED29,000.00\tAED29,000.00"].join("\n");
    fireEvent.paste(cell, { clipboardData: { getData: () => sheet } });
    await waitFor(() => expect(posted(fetcher)).toEqual([{ ops: [
      { op: "upsert", line: expect.objectContaining({ title: "Dining Chairs", material: "PL Core Fabric / Veneer wood", quantity: "6", rate: "3500", areaId: KITCHEN }) },
      { op: "upsert", line: expect.objectContaining({ title: "Dining Table", length: "220", height: "75", width: "100", dimensionUnit: "cm", quantity: "1", rate: "29000" }) },
    ] }]));
  });

  it("puts the cell back on Escape without saving", async () => {
    const fetcher = mount(state([line({})]));
    const rate = screen.getByRole("textbox", { name: "Rate" });
    await userEvent.clear(rate);
    await userEvent.type(rate, "999");
    fireEvent.keyDown(rate, { key: "Escape" });
    fireEvent.blur(rate);
    expect(posted(fetcher)).toEqual([]);
    expect(rate).toHaveValue("100");
  });

  it("shows formula quantities and build-up rates as chips that open the details", async () => {
    mount(state([line({ formula: "area * 1.05", quantity: "2.52", pricingMode: "build_up", rate: "683.52", buildUpComplete: true })]));
    await userEvent.click(screen.getByRole("button", { name: /ƒ 2.52/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Works out to 2.52");
  });

  it("is read-only once the quote is sent", () => {
    mount({ ...state([line({})]), quote: { ...state([]).quote, status: "issued" }, canEdit: false });
    expect(screen.getByText("This quote has been sent. Start a new revision to change it.")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Quantity" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Add item/ })).not.toBeInTheDocument();
  });

  it("sends a draft for review through the case, with the case revision", async () => {
    const initial = state([line({})]);
    const fetcher = mount(initial, (url) => url.includes("/api/commercial/") ? { data: { revision: 2, quotes: [{ id: "q1", number: 2, status: "internal_review" }] } } : initial);
    await userEvent.click(screen.getByRole("button", { name: "Send for review" }));
    await waitFor(() => expect(posted(fetcher)).toContainEqual({ action: "submit", revision: 1, quoteId: "q1" }));
  });

  it("returns a quote in review only with the reviewer's reason", async () => {
    const initial = state([line({})]);
    initial.quote.status = "internal_review";
    const fetcher = mount(initial, (url) => url.includes("/api/commercial/") ? { data: { revision: 2, quotes: [{ id: "q1", number: 2, status: "draft" }] } } : initial);
    await userEvent.click(screen.getByRole("button", { name: "Return" }));
    const dialog = await screen.findByRole("dialog", { name: "Return for changes" });
    expect(within(dialog).getByRole("button", { name: "Return" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What needs to change/ }), "Add the QS cost for the design fee.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Return" }));
    await waitFor(() => expect(posted(fetcher)).toContainEqual({ action: "return", revision: 1, quoteId: "q1", note: "Add the QS cost for the design fee." }));
  });

  it("records the client's decision with how they decided and the options they chose", async () => {
    const base = state([line({}), line({ id: "o", title: "TV unit", optional: true })]);
    const initial = { ...base, quote: { ...base.quote, status: "issued" }, canEdit: false };
    const fetcher = mount(initial, (url) => url.includes("/api/commercial/") ? { data: { revision: 2, quotes: [] } } : initial);
    await userEvent.click(screen.getByRole("button", { name: "Record client decision" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Decided by/ }), "Maya Client");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /TV unit/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posted(fetcher)).toContainEqual(expect.objectContaining({ action: "record_decision", decision: "accept", method: "signed_document", clientName: "Maya Client", selectedOptionLineIds: ["o"] })));
  });

  it("asks Sales for the file the client decided in before recording it (Q-24)", async () => {
    const base = state([line({})]);
    const initial = { ...base, quote: { ...base.quote, status: "issued" }, flow: { ...base.flow, decisionEvidenceRequired: true }, canEdit: false };
    const asset = { id: "55555555-5555-4555-8555-555555555555", name: "signed.pdf", mimeType: "application/pdf", byteSize: 10, hasPreview: false };
    const fetcher = mount(initial, (url) => url.includes("/assets/") ? asset : url.includes("/api/commercial/") ? { data: { revision: 2, quotes: [] } } : initial);
    await userEvent.click(screen.getByRole("button", { name: "Record client decision" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Decided by/ }), "Maya Client");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.upload(within(dialog).getByLabelText("Attach the signed copy, email or message"), new File(["%PDF"], "signed.pdf", { type: "application/pdf" }));
    expect(await within(dialog).findByText("signed.pdf")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posted(fetcher)).toContainEqual(expect.objectContaining({ action: "record_decision", evidenceAssetId: asset.id })));
  });

  it("sends an expired quote again with a new validity date (Q-7)", async () => {
    const base = state([line({})]);
    const initial = { ...base, quote: { ...base.quote, status: "expired", validUntil: "2026-01-10" }, canEdit: false, canEditValidity: true };
    const fetcher = mount(initial, (url) => url.includes("/api/commercial/") ? { data: { revision: 2, quotes: [] } } : initial);
    await userEvent.click(screen.getByRole("button", { name: "Extend validity" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Extend" }));
    await waitFor(() => expect(posted(fetcher)).toContainEqual(expect.objectContaining({ action: "extend_validity", validUntil: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })));
  });

  it("only saves payment milestones that add up to 100%", async () => {
    const initial = state([line({})]);
    const fetcher = mount(initial);
    await userEvent.click(screen.getByRole("radio", { name: "Payments" }));
    const dialog = screen.getByRole("region", { name: "Payments" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Add milestone" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Milestone" }), "Advance");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "When" }), "On acceptance");
    const percent = within(dialog).getByRole("textbox", { name: "%" });
    await userEvent.clear(percent); await userEvent.type(percent, "40");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.clear(percent); await userEvent.type(percent, "100");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => String(url).includes("/payment-terms") && init?.method === "PUT")).toBe(true));
  });

  it("drafts an empty quote with the assistant and applies only the ticked changes", async () => {
    const initial = state([]);
    const proposal = { summary: "From the brief", changes: [
      { key: "0", action: "add", lineId: null, lineVersion: null, lineTitle: null, catalogItemId: "i1", catalogName: "Wardrobe · hinged", priced: true, fields: { areaId: KITCHEN, quantity: "2" }, areaName: "Kitchen", unknownArea: null, why: "Brief asks for wardrobes" },
      { key: "1", action: "add", lineId: null, lineVersion: null, lineTitle: null, catalogItemId: null, catalogName: null, priced: false, fields: { title: "Paint walls", quantity: "40", unit: "sqm" }, areaName: null, unknownArea: "Study", why: "" },
    ] };
    const fetcher = mount(initial, (url) => url.includes("/ai/draft") ? proposal : initial);
    await userEvent.click(screen.getByRole("button", { name: /Draft it with AI/ }));
    const panel = await screen.findByRole("region", { name: "Suggested changes" });
    expect(panel).toHaveTextContent("“Study” isn't an area of this project yet; it goes to General.");
    await userEvent.click(within(within(panel).getByText(/Paint walls/).closest("li")!).getByRole("checkbox"));
    await userEvent.click(within(panel).getByRole("button", { name: "Apply 1 change" }));
    await waitFor(() => {
      const ops = posted(fetcher).find((body) => body.ops)?.ops;
      expect(ops).toEqual([{ op: "catalog", itemId: "i1", line: expect.objectContaining({ areaId: KITCHEN, quantity: "2" }) }]);
    });
  });

  it("lists what to fix before sending", () => {
    mount({ ...state([line({ rate: "0" })]), checks: [{ code: "{name} has no price", values: { name: "Base cabinets" }, lineId: "a", tone: "danger" }, { code: "Add the payment milestones", tone: "warning" }] });
    expect(screen.getByRole("button", { name: "2 to fix" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Totals/ }));
    const checks = screen.getByRole("region", { name: "To fix before sending" });
    expect(checks).toHaveTextContent("Base cabinets has no price");
    expect(checks).toHaveTextContent("Add the payment milestones");
  });

  it("opens comments on a line, posts one with a mention, and shows who else is editing", async () => {
    const initial = state([line({})]);
    const thread = { id: "t1", anchorKind: "line", anchorKey: "a", anchorField: null, status: "open", version: 1, createdBy: "u1", createdByName: "Sam", createdAt: "2026-09-26T10:00:00Z", resolvedByName: null, resolvedAt: null,
      messages: [{ id: "t1", body: "@Dana check hinges", mentions: ["u2"], createdBy: "u1", createdByName: "Sam", createdAt: "2026-09-26T10:00:00Z" }] };
    const fetcher = mount(initial, (url, body) => {
      if (url.includes("/pulse")) return { people: [{ userId: "u2", name: "Dana Designer", lineId: "a", field: "rate" }], revision: 1, comments: "0:0" };
      if (url.includes("/comments")) return body ? { threads: [thread] } : { threads: [], members: [{ id: "u1", name: "Sam" }, { id: "u2", name: "Dana" }] };
      return initial;
    });
    expect(await screen.findByLabelText("Also here: Dana Designer")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Comments on Base cabinets" }));
    const panel = screen.getByRole("region", { name: "Comments on Base cabinets" });
    await userEvent.type(within(panel).getByRole("textbox"), "@Da");
    await userEvent.click(within(panel).getByRole("option", { name: /Dana/ }));
    await new Promise((resolve) => requestAnimationFrame(resolve)); // the cursor moves after the name
    await userEvent.type(within(panel).getByRole("textbox"), "check hinges{Enter}", { skipClick: true });
    await waitFor(() => expect(posted(fetcher).find((body) => body.anchorKind)).toMatchObject({ anchorKind: "line", anchorKey: "a", body: "@Dana check hinges", mentions: ["u2"] }));
    expect(await within(panel).findByText("@Dana check hinges")).toBeInTheDocument();
  });

  it("shows a pictures column and saves an uploaded picture on the line", async () => {
    const initial = state([line({ catalogImageId: "11111111-2222-4333-8444-555555555555" })]);
    const fetcher = mount(initial, (url) => url.includes("/api/workspace/pre-projects/") ? { id: "99999999-2222-4333-8444-555555555555", name: "tv.png" } : initial);
    expect(screen.getByRole("img", { name: "Picture of Base cabinets" })).toHaveAttribute("src", expect.stringContaining("/api/catalog-images/11111111-2222-4333-8444-555555555555"));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, new File(["x"], "tv.png", { type: "image/png" }));
    await waitFor(() => expect(posted(fetcher)).toContainEqual({ ops: [{ op: "upsert", line: { id: "a", imageAssetId: "99999999-2222-4333-8444-555555555555", version: 3 } }] }));
  });
});

describe("variations", () => {
  afterEach(() => vi.unstubAllGlobals());
  const variation = (lines: BuilderLine[], status = "draft", appliedAs: string | null = null): BuilderState => {
    const base = state(lines);
    return { ...base, quote: { ...base.quote, kind: "variation", status }, canEdit: status === "draft", project: { id: "p1", reference: "PRJ-0001", appliedAs } };
  };

  it("removes part of an agreed item as a locked credit line", async () => {
    const removal = line({ id: "r1", title: "Worktop", changeOp: "omit", boqLineId: "b1", quantity: "1", rate: "800" });
    const fetcher = mount(variation([removal]), (url) => (url.includes("/boq")
      ? { lines: [{ id: "b1", title: "Worktop", unit: "m²", quantity: "2.25", net: "1800.00", areaId: KITCHEN, areaName: "Kitchen" }] }
      : variation([removal])));
    expect(await screen.findByText("Removes")).toBeInTheDocument();
    const row = screen.getByText("Removes").closest("[role=row]") as HTMLElement;
    expect(within(row).getByRole("textbox", { name: "Rate" })).toBeDisabled();
    expect(within(row).getByRole("textbox", { name: "Quantity" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Change an agreed item" }));
    const dialog = await screen.findByRole("dialog", { name: "Change an agreed item" });
    await userEvent.click(await within(dialog).findByRole("button", { name: /Worktop/ }));
    const amount = within(dialog).getByRole("textbox", { name: /How much to remove/ });
    await userEvent.clear(amount);
    await userEvent.type(amount, "3");
    expect(within(dialog).getByRole("button", { name: "Add to variation" })).toBeDisabled();
    await userEvent.clear(amount);
    await userEvent.type(amount, "1.25");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add to variation" }));
    await waitFor(() => expect(posted(fetcher).at(-1)).toEqual({ ops: [expect.objectContaining({ op: "change", change: "omit", boqLineId: "b1", quantity: "1.25" })] }));
  });

  it("applies an accepted variation to the project, then links to it", async () => {
    const fetcher = mount(variation([], "accepted"), (url, body) => {
      if (url.includes("/api/project-core/projects/p1") && !body) return { project: { version: 9 } };
      if (url.includes("/api/project-core/projects/p1")) return { project: { version: 10 } };
      return variation([], "accepted", "VO-1");
    });
    await userEvent.click(await screen.findByRole("button", { name: "Apply to project" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => String(url).includes("/api/project-core/projects/p1") && init?.method === "POST"
      && JSON.parse(String(init.body)).action === "apply_variation" && JSON.parse(String(init.body)).version === 9)).toBe(true));
    expect(await screen.findByRole("link", { name: "Applied as VO-1" })).toHaveAttribute("href", "/workspace/projects/p1/scope");
  });
});

describe("requirement trace", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("links a line to the requirement it covers and shows what's still undecided", async () => {
    const base = state([line({})]);
    const traced: BuilderState = { ...base, requirements: [
      { id: "11111111-1111-4111-8111-111111111112", title: "Soft-close drawers", roomName: "Kitchen", priority: "must_have", source: "client", status: "included", note: "" },
      { id: "11111111-1111-4111-8111-111111111113", title: "Wine fridge", roomName: null, priority: "preferred", source: "client", status: "undecided", note: "" }],
      checks: [{ code: "Decide {count} requirements before sending", values: { count: "1" }, tone: "danger" }] };
    const fetcher = mount(traced);
    await userEvent.click(screen.getByRole("button", { name: /^Totals/ }));
    expect(await screen.findByText("Decide 1 requirements before sending")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Line actions for Base cabinets" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Details" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /Covers the requirement/ }));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["None", "Soft-close drawers · Kitchen"]);
    await userEvent.click(options[1]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posted(fetcher).at(-1)).toEqual({ ops: [{ op: "upsert", line: expect.objectContaining({ id: "a", scopeId: "11111111-1111-4111-8111-111111111112" }) }] }));
  });
});
