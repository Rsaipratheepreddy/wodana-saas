import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderChangeDocument } from "../change-requests/change-request-pdf";
import { presentForClient } from "../proposals/markup-disclosure";
import { renderProposal } from "../proposals/proposal-pdf";
import { priceQuote } from "../quotation/quote-pricing";
import { renderSampleDocuments, sampleLetterhead } from "./document-samples";
import { amountText, documentDate, documentFileName, moneyText, quantityText } from "./pdf-layout";

const pages = (outline: string) => outline.split(/^--- page \d+$/m).slice(1).map((page) => page.trim());

describe("the shared document theme: values", () => {
  it("prints money exactly at the currency's decimals, the code once", () => {
    expect(moneyText("1234567.5", "AED", 2)).toBe("AED 1,234,567.50");
    expect(moneyText("-1680", "AED", 2)).toBe("-AED 1,680.00");
    expect(moneyText("12.345", "KWD", 3)).toBe("KWD 12.345");
    expect(moneyText("1500", "JPY", 0)).toBe("JPY 1,500");
    expect(moneyText("0007.10", "INR", 2)).toBe("INR 7.10");
    expect(amountText("7770", 2)).toBe("7,770.00");
    expect(amountText("-1680.5", 2)).toBe("-1,680.50");
  });

  it("writes quantities without trailing zeros and dates as the workspace locale does, with Latin digits", () => {
    expect(quantityText("2.500", "sqm")).toBe("2.5 sqm");
    expect(quantityText("3.000", "nos")).toBe("3 nos");
    expect(quantityText(null)).toBe("");
    expect(documentDate("2026-10-12", "en-AE")).toBe("12 Oct 2026");
    expect(documentDate("2026-10-12", "en-US")).toBe("Oct 12, 2026");
    expect(documentDate("2026-10-12", "ar-AE")).toMatch(/12/);
    expect(documentDate("2026-10-11T22:30:00Z", "en-GB", "Asia/Dubai")).toBe("12 Oct 2026");
    expect(documentDate("not a date", "en-GB")).toBe("not a date");
    expect(documentDate(null)).toBe("");
  });

  it("names a file after its number and who it's for, without characters file systems refuse", () => {
    expect(documentFileName("Q-0012", "Aisha Rahman")).toBe("Q-0012 Aisha Rahman.pdf");
    expect(documentFileName("CR/7", "A: B?")).toBe("CR-7 A- B-.pdf");
    expect(documentFileName(null, "")).toBe("Document.pdf");
  });
});

describe("the shared document theme: every server-made document (render)", () => {
  it("renders each sample with the letterhead, page numbers and Powered by Wodana on every generated page", async () => {
    const samples = await renderSampleDocuments();
    expect(samples.map((sample) => sample.name)).toHaveLength(8);
    for (const sample of samples) {
      const document = await PDFDocument.load(sample.bytes);
      expect(document.getPageCount(), sample.name).toBeGreaterThan(0);
      if (!sample.outline) continue;
      const generated = pages(sample.outline);
      generated.forEach((page, index) => {
        expect(page, `${sample.name} page ${index + 1}`).toContain("Powered by Wodana");
        expect(page, `${sample.name} page ${index + 1}`).toMatch(new RegExp(`Page ${index + 1} of ${document.getPageCount()}`));
      });
      expect(generated[0]).toMatch(/Studio Meridian Interiors LLC|Kalpa Design Studio Pvt Ltd/);
      expect(generated[0]).toMatch(/TRN 100123456700003|GSTIN 27AAPFU0939F1ZV/);
    }
  });

  it("repeats the table header on every page a long quotation continues on and keeps each row whole", async () => {
    const lines = Array.from({ length: 70 }, (_, index) => ({ id: `l${index}`, title: `Item ${index} with a title long enough to wrap onto a second line of the item column`, quantity: "1", unit: "nos", rate: "1250.5", unitCost: "900" }));
    const pricing = priceQuote(lines.map((line) => ({ ...line, areaKey: "general", tradeKey: "none", taxRate: "5" })), [], { currencyDecimals: 2, pricesIncludeTax: false, rounding: "line" });
    const { bytes, outline } = await renderProposal([], {
      brand: { name: "Studio", accent: "#1f5c4f" }, letterhead: await sampleLetterhead("AE"), title: "Villa", reference: "Q-0099", revision: 1, issuedOn: "2026-10-12", validUntil: null,
      client: { name: "Aisha Rahman", project: "Villa 14", address: null }, currency: "AED", decimals: 2, taxLabel: "VAT", locale: "en-AE",
      presentation: presentForClient(lines, pricing, "all_inclusive", 2), groups: [{ name: "General", lineIds: lines.map((line) => line.id) }], paymentTerms: [],
    });
    const count = (await PDFDocument.load(bytes)).getPageCount();
    expect(count).toBeGreaterThan(2);
    const generated = pages(outline);
    expect(generated).toHaveLength(count);
    generated.forEach((page) => expect(page).toMatch(/^Item\nQty\nRate \(AED\)\nAmount \(AED\)$/m));
    // Every row's title lines stay on the page its amount is on.
    for (const page of generated) {
      const titles = page.match(/^Item \d+ with a title long enough to wrap onto a second$/gm) ?? [];
      const wraps = page.match(/^line of the item column$/gm) ?? [];
      expect(titles.length).toBeGreaterThan(0);
      expect(wraps.length).toBe(titles.length);
    }
    expect(generated.slice(1).every((page) => page.includes("Quotation Q-0099 · R1 · Aisha Rahman"))).toBe(true);
    expect(generated.at(-1)).toContain("AED 91,912.10");
  });

  it("§0.3 P4: names the snapshot's version, the code the portal shows and the client's decision records", async () => {
    const lines = [{ id: "l1", title: "Wardrobe", quantity: "1", unit: "nos", rate: "1000", unitCost: "0", description: "" }];
    const pricing = priceQuote(lines.map((line) => ({ ...line, areaKey: "general", tradeKey: "none", taxRate: "5" })) as never, [], { currencyDecimals: 2, pricesIncludeTax: false, rounding: "line" });
    const page = { brand: { name: "Studio", accent: null }, title: "Villa", reference: "Q-0100", revision: 2, issuedOn: "2026-10-12", validUntil: null,
      client: { name: "Aisha Rahman", project: "Villa", address: null }, currency: "AED", decimals: 2, taxLabel: "VAT", locale: "en-AE",
      presentation: presentForClient(lines as never, pricing, "all_inclusive", 2), groups: [{ name: "General", lineIds: ["l1"] }], paymentTerms: [] };
    expect((await renderProposal([], { ...page, quoteHash: "3fa1a4d4e5b6c7d8" })).outline).toMatch(/3fa1a4d4\nVersion/);
    expect((await renderProposal([], page)).outline).not.toMatch(/Version/);
  });

  it("matches the change request's render", async () => {
    const samples = await renderSampleDocuments();
    const change = samples.find((sample) => sample.name.startsWith("SM-CR-"))!;
    expect(change.outline).toMatchSnapshot();
    const { outline } = await renderChangeDocument({
      brandName: "Studio", reference: "CR-1", title: "Add a shelf", description: "", designImpact: "", project: "", clientName: "عائشة", issuedOn: "2026-10-06",
      currency: "KWD", decimals: 3, lines: [{ action: "add", title: "رف خشبي", room: null, quantity: "2", unit: "nos", unitPrice: "10.5", amount: "21" }],
      priceImpact: "21", timeImpactDays: 0, handoverBefore: null, handoverAfter: null,
    });
    expect(outline).toContain("KWD 21.000");
    expect(outline).toContain("21.000");
    expect(outline).toContain("No change");
  });

  it("matches the quotation's render", async () => {
    const samples = await renderSampleDocuments();
    expect(samples.find((sample) => sample.name.includes("(all-inclusive)"))!.outline).toMatchSnapshot();
  });
});
