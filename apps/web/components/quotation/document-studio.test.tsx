import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { quoteApi } from "@/lib/quotation/client";
import type { BuilderState } from "@/lib/quotation/types";
import { DocumentStudio } from "./document-studio";

const KITCHEN = "11111111-1111-4111-8111-111111111111";
const state = {
  quote: { id: "q1", number: 3, title: "Main", status: "draft", kind: "quotation", round: "main", currency: "AED", decimals: 2, validUntil: "2026-10-03", taxRate: "5", revision: 1, paymentTerms: [{ id: "p", title: "Advance", percent: 100, trigger: "On acceptance", requiredForRelease: true }], approvedBy: null, clientDecision: null },
  family: [{ id: "q1", number: 3, status: "draft", total: "105", createdAt: null }], flow: { internalReview: true, reviewAction: "approve", canReview: true, canRecordDecision: true }, paymentTemplates: [],
  settings: { defaultView: "area", pricesIncludeTax: false, rounding: "line", defaultMarkupPercent: "0", marginFloorPercent: null, discountApprovalPercent: null, validityDays: 7, internalReview: true, priceBookId: null, version: 1 },
  areas: [{ id: KITCHEN, name: "Kitchen" }], workPackages: [], taxCodes: [], discounts: [], checks: [], me: "u1",
  lines: [{ id: "a", position: 0, version: 1, kind: "item", areaId: KITCHEN, fromAreaId: null, workPackageId: null, title: "Base cabinets", description: "Soft-close", unit: "lm", quantity: "1", formula: null, formulaError: null, length: null, width: null, height: null, count: null, dimensionUnit: null, rate: "100", unitCost: null, markupPercent: null, pricingMode: "rate", discountKind: null, discountValue: null, taxCode: null, taxRate: null, optional: null, optionGroup: null, note: "", catalogItemId: null, catalogSnapshot: null, buildUpComplete: null, updatedAt: "", updatedByName: null, components: [] }],
  pricing: { lines: [{ id: "a", included: true, gross: "100.00", lineDiscount: "0.00", sectionDiscount: "0.00", quoteDiscount: "0.00", net: "100.00", tax: "5.00", total: "105.00", cost: null }], areas: [{ key: KITCHEN, gross: "100.00", discount: "0.00", net: "100.00" }], trades: [], subtotal: "100.00", discounts: { line: "0.00", section: "0.00", quote: "0.00", total: "0.00" }, net: "100.00", tax: "5.00", taxes: [], total: "105.00", cost: null, margin: null, optionalTotal: "0.00" },
  document: { style: "atelier", accent: null, sections: { cover: true, intro: true, summary: true, items: true, payments: true, terms: true, acceptance: true }, title: "Villa interiors", subtitle: "", intro: "Thank you.", terms: "Valid 7 days.", exclusions: "", itemsView: "area", itemsDetail: "lines", showRates: true, showDescriptions: true, coverAssetId: null },
  brand: { name: "Palm Studio", logo: "", primaryColor: "#1f6f5c", accentColor: "#1f6f5c" }, client: { name: "Maya Rahman", project: "Villa", address: null },
  canEdit: true, canEditCosts: false, canViewCosts: false,
} as unknown as BuilderState;

describe("document studio", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the document from the quote in the chosen style", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) })));
    render(<DesignSystemProvider><DocumentStudio state={state} api={quoteApi("w", "c", "q1")} workspaceId="w" caseId="c" onState={vi.fn()} onError={vi.fn()} /></DesignSystemProvider>);
    expect(screen.getByRole("radio", { name: /Atelier/ })).toHaveAttribute("aria-checked", "true");
    const cover = screen.getByRole("region", { name: "Cover" });
    expect(cover).toHaveTextContent("Villa interiors");
    expect(cover).toHaveTextContent("Maya Rahman");
    expect(screen.getByRole("region", { name: "Items" })).toHaveTextContent("Base cabinets");
    expect(screen.getByRole("region", { name: "Payments" })).toHaveTextContent("Advance");
    expect(screen.getByRole("region", { name: "Acceptance" })).toHaveTextContent("Q-3 · R1");
  });

  it("switches style and hides a section, saving the change", async () => {
    const onState = vi.fn();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => (init?.method === "PUT" ? state : { items: [] }) }));
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><DocumentStudio state={state} api={quoteApi("w", "c", "q1")} workspaceId="w" caseId="c" onState={onState} onError={vi.fn()} /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("radio", { name: /Noir/ }));
    await userEvent.click(within(screen.getByRole("complementary", { name: "Document settings" })).getByRole("switch", { name: "Introduction" }));
    expect(screen.queryByRole("region", { name: "Introduction" })).not.toBeInTheDocument();
    await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => String(url).includes("/document") && init?.method === "PUT" && JSON.parse(String(init.body)).style === "noir" && JSON.parse(String(init.body)).sections.intro === false)).toBe(true), { timeout: 3000 });
  });
});
