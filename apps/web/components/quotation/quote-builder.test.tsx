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
  taxCode: null, taxRate: null, optional: null, optionGroup: null, note: "", catalogItemId: null, catalogSnapshot: null, buildUpComplete: null, updatedAt: "", updatedByName: null, components: [], ...fields,
});
const state = (lines: BuilderLine[]): BuilderState => ({
  quote: { id: "q1", number: 2, title: "Main quote", status: "draft", kind: "quotation", round: "main", currency: "AED", decimals: 2, validUntil: null, taxRate: "5", revision: 1, paymentTerms: [], approvedBy: null, clientDecision: null },
  family: [{ id: "q1", number: 2, status: "draft", total: "420.00", createdAt: null }],
  flow: { internalReview: true, reviewAction: "approve", canReview: true, canRecordDecision: true },
  paymentTemplates: [],
  settings: { defaultView: "area", pricesIncludeTax: false, rounding: "line", defaultMarkupPercent: "0", marginFloorPercent: null, discountApprovalPercent: null, validityDays: 30, internalReview: true, priceBookId: null, version: 0 },
  areas: [{ id: KITCHEN, name: "Kitchen" }], workPackages: [{ id: JOINERY, name: "Joinery" }], taxCodes: [], lines, discounts: [],
  pricing: { lines: lines.map((item) => ({ id: item.id, included: true, gross: "400.00", lineDiscount: "0.00", sectionDiscount: "0.00", quoteDiscount: "0.00", net: "400.00", tax: "20.00", total: "420.00", cost: "240.00" })),
    areas: [{ key: KITCHEN, gross: "400.00", discount: "0.00", net: "400.00" }], trades: [{ key: JOINERY, gross: "400.00", discount: "0.00", net: "400.00" }], subtotal: "400.00",
    discounts: { line: "0.00", section: "0.00", quote: "0.00", total: "0.00" }, net: "400.00", tax: "20.00", taxes: [{ rate: "5", base: "400.00", tax: "20.00" }], total: "420.00", cost: "240.00", margin: "40.00", optionalTotal: "0.00" },
  checks: [], me: "u1", canEdit: true, canEditCosts: true, canViewCosts: true,
});
const mount = (initial: BuilderState, respond: (url: string, body: unknown) => unknown = () => initial) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => respond(url, init?.body ? JSON.parse(String(init.body)) : undefined) }));
  vi.stubGlobal("fetch", fetcher);
  render(<DesignSystemProvider><QuoteBuilder workspaceId="w" caseId="c" quoteId="q1" backHref="/quotes" initial={initial} /></DesignSystemProvider>);
  return fetcher;
};
const posted = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([url, init]) => init?.method === "POST" && !String(url).includes("/pulse")).map(([, init]) => JSON.parse(String(init!.body)));

describe("quotation builder", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("groups lines by area with totals, and regroups by trade", async () => {
    mount(state([line({})]));
    const grid = screen.getByRole("grid", { name: "Quote lines" });
    expect(within(grid).getByText("Kitchen")).toBeInTheDocument();
    expect(within(grid).getByText("General")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Totals" })).toHaveTextContent("Margin40%");
    await userEvent.click(screen.getByRole("radio", { name: "By trade" }));
    expect(within(grid).getByText("Joinery")).toBeInTheDocument();
    expect(within(grid).getByRole("combobox", { name: "Area" })).toHaveValue(KITCHEN);
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
    await userEvent.click(screen.getAllByRole("button", { name: /Add (the first )?item/ })[0]);
    await userEvent.type(screen.getAllByRole("combobox", { name: "Item" }).at(-1)!, "ward");
    await userEvent.click(await screen.findByRole("option", { name: /Wardrobe/ }));
    await waitFor(() => expect(posted(fetcher)).toEqual([{ ops: [{ op: "catalog", itemId: "i1", line: expect.objectContaining({ areaId: KITCHEN, workPackageId: null }) }] }]));
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

  it("only saves payment milestones that add up to 100%", async () => {
    const initial = state([line({})]);
    const fetcher = mount(initial);
    await userEvent.click(screen.getByRole("button", { name: "Edit payments" }));
    const dialog = await screen.findByRole("dialog");
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
    await userEvent.click(screen.getByRole("button", { name: "Draft the quote" }));
    const panel = await screen.findByRole("region", { name: "Suggested changes" });
    expect(panel).toHaveTextContent("“Study” isn't an area of this project yet; it goes to General.");
    await userEvent.click(within(panel).getByRole("checkbox", { name: /Paint walls/ }));
    await userEvent.click(within(panel).getByRole("button", { name: "Apply 1 change" }));
    await waitFor(() => {
      const ops = posted(fetcher).find((body) => body.ops)?.ops;
      expect(ops).toEqual([{ op: "catalog", itemId: "i1", line: expect.objectContaining({ areaId: KITCHEN, quantity: "2" }) }]);
    });
  });

  it("lists what to fix before sending", () => {
    mount({ ...state([line({ rate: "0" })]), checks: [{ code: "{name} has no price", values: { name: "Base cabinets" }, lineId: "a", tone: "danger" }, { code: "Add the payment milestones", tone: "warning" }] });
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
    await userEvent.type(within(panel).getByRole("textbox"), "check hinges{Enter}");
    await waitFor(() => expect(posted(fetcher)).toContainEqual(expect.objectContaining({ anchorKind: "line", anchorKey: "a", body: "@Dana check hinges", mentions: ["u2"] })));
    expect(await within(panel).findByText("@Dana check hinges")).toBeInTheDocument();
  });
});
