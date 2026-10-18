import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { priceQuote } from "../quotation/quote-pricing";
import { clientNetwork, linkState, newSigningToken, SIGNING_TOKEN, signatureInput, signerIdentity, signingTokenHash } from "./esign.domain";
import { answerText, introPagePdf } from "./intro-deck";
import { markupDisclosure, presentForClient } from "./markup-disclosure";
import { appendCertificate, composeProposal, moneyText, sha256, templatePageCount } from "./proposal-pdf";
import { sniff } from "./proposal-files";
import { pricingHash, qsStage, touchesQsFields } from "./qs-review.domain";

const lines = [
  { id: "a", title: "Wardrobe", quantity: "2", unit: "nos", rate: "1200", unitCost: "1000", optional: false },
  { id: "b", title: "Paint", quantity: "10.5", unit: "m²", rate: "30", unitCost: "20", optional: false },
  { id: "c", title: "Survey", quantity: "1", unit: "lump", rate: "500", unitCost: null, optional: false },
  { id: "d", title: "Mirror", quantity: "1", unit: "nos", rate: "300", unitCost: "200", optional: true },
];
const priced = priceQuote(lines.map((line) => ({ ...line, areaKey: "general", tradeKey: "none", taxRate: "5" })),
  [{ scope: "quote", target: "", kind: "amount", value: "100" }], { currencyDecimals: 2, pricesIncludeTax: false, rounding: "line" });

describe("markup disclosure (R3)", () => {
  it("shows one selling price per line when all-inclusive", () => {
    const view = presentForClient(lines, priced, "all_inclusive", 2);
    expect(view.lines[0]).toMatchObject({ rate: "1200.00", amount: "2400.00", cost: null, markupPercent: null });
    expect(view.summary.map((row) => row.key)).toEqual(["Subtotal", "Discount", "Tax", "Total"]);
    expect(view.summary.at(-1)).toEqual({ key: "Total", amount: priced.total });
  });

  it("shows cost, markup and price per line, and cost + markup = subtotal, when disclosed", () => {
    const view = presentForClient(lines, priced, "disclosed_markup", 2);
    expect(view.lines[0]).toMatchObject({ cost: "1000.00", markupPercent: "20.00", markupAmount: "400.00", amount: "2400.00" });
    // A line without a cost carries no markup.
    expect(view.lines[2]).toMatchObject({ cost: "500.00", markupPercent: "0.00", markupAmount: "0.00" });
    const [cost, markup, subtotal] = view.summary;
    expect([cost.key, markup.key, subtotal.key]).toEqual(["Cost of items", "Markup", "Subtotal"]);
    expect(cost.amount).toBe("2710.00");
    expect(markup.amount).toBe("505.00");
    expect(subtotal.amount).toBe(priced.subtotal);
  });

  it("shows lines at cost and the margin once as the fee, the same total, when fee-based", () => {
    const view = presentForClient(lines, priced, "fee_based", 2);
    expect(view.lines.map((line) => line.rate)).toEqual(["1000.00", "20.00", "500.00", "200.00"]);
    expect(view.lines[1].amount).toBe("210.00");
    const rows = Object.fromEntries(view.summary.map((row) => [row.key, row.amount]));
    expect(rows["Items at cost"]).toBe("2710.00");
    expect(rows["Our fee"]).toBe("505.00");
    expect(rows.Subtotal).toBe("3215.00");
    expect(rows.Total).toBe(priced.total);
  });

  it("falls back to all-inclusive for an unknown mode", () => {
    expect(markupDisclosure("hidden")).toBe("all_inclusive");
    expect(markupDisclosure("fee_based")).toBe("fee_based");
  });
});

describe("e-sign rules (R8)", () => {
  it("makes a URL-safe token stored only as its hash", () => {
    const { token, hash } = newSigningToken();
    expect(token).toMatch(SIGNING_TOKEN);
    expect(hash).toBe(signingTokenHash(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(newSigningToken().token).not.toBe(token);
  });

  it("knows an open, expired, used and withdrawn link", () => {
    const now = new Date("2026-10-06T10:00:00Z");
    expect(linkState({ status: "pending", expiresAt: "2026-10-07T00:00:00Z" }, now)).toBe("open");
    expect(linkState({ status: "pending", expiresAt: "2026-10-06T10:00:00Z" }, now)).toBe("expired");
    expect(linkState({ status: "signed", expiresAt: "2026-01-01T00:00:00Z" }, now)).toBe("signed");
    expect(linkState({ status: "revoked", expiresAt: "2027-01-01T00:00:00Z" }, now)).toBe("revoked");
  });

  it("accepts a typed name or a drawn PNG, nothing else", async () => {
    expect(signatureInput({ kind: "typed", text: "  Aisha   Khan " })).toEqual({ kind: "typed", text: "Aisha Khan" });
    expect(() => signatureInput({ kind: "typed", text: "A" })).toThrow(/full name/);
    const png = Buffer.from(await (await PDFDocument.create()).save()); // not a PNG
    expect(() => signatureInput({ kind: "drawn", png: png.toString("base64") })).toThrow(/Draw/);
    const realPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const padded = Buffer.concat([realPng, Buffer.alloc(120)]);
    expect(signatureInput({ kind: "drawn", png: `data:image/png;base64,${padded.toString("base64")}` }).kind).toBe("drawn");
    expect(() => signatureInput({ kind: "stamp" })).toThrow();
  });

  it("needs the signer's name and consent; keeps the link's email and phone unless corrected", () => {
    const expected = { name: "Aisha", email: "aisha@example.com", phone: "+971501234567" };
    expect(() => signerIdentity({ name: "Aisha Khan" }, expected)).toThrow(/agree/);
    expect(signerIdentity({ name: "Aisha Khan", consent: true }, expected)).toEqual({ name: "Aisha Khan", email: "aisha@example.com", phone: "+971501234567" });
    expect(() => signerIdentity({ name: "Aisha", email: "nope", consent: true }, expected)).toThrow(/email/);
    expect(clientNetwork("203.0.113.9, 10.0.0.1", "Mozilla/5.0 (iPhone)\u0000")).toEqual({ ip: "203.0.113.9", userAgent: "Mozilla/5.0 (iPhone)" });
    expect(clientNetwork(undefined, undefined)).toEqual({ ip: "unknown", userAgent: "unknown" });
  });
});

describe("the proposal PDF (PLM-085)", () => {
  const page = async (text: string) => {
    const document = await PDFDocument.create();
    document.addPage([595, 842]).drawText(text, { x: 40, y: 800 });
    return document.save();
  };
  const quotation = {
    brand: { name: "Firm", accent: "#1f6feb" }, title: "Villa fit-out", reference: "FIRM-QUO-2026-00012", revision: 2, issuedOn: "2026-10-06", validUntil: "2026-10-13",
    client: { name: "Aisha Khan", project: "Villa 12", address: "Street 4, Area" }, currency: "AED", decimals: 2, taxLabel: "VAT",
    presentation: presentForClient(lines, priced, "all_inclusive", 2), groups: [{ name: "Living", lineIds: ["a", "b"] }, { name: "General", lineIds: ["c", "d"] }],
    paymentTerms: [{ title: "Advance", percent: 50, trigger: "On signing" }],
  };

  it("puts pages 1–3, the quotation and page 5 in one PDF, leaving out pages not uploaded", async () => {
    const template = [
      { slot: 1 as const, mimeType: "application/pdf", bytes: await page("Cover") },
      { slot: 3 as const, mimeType: "application/pdf", bytes: await page("Letter") },
      { slot: 5 as const, mimeType: "application/pdf", bytes: await page("Closing") },
    ];
    const bytes = await composeProposal(template, quotation);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(4);
    expect(await templatePageCount("application/pdf", await page("x"))).toBe(1);
    expect(sniff(Buffer.from(bytes))).toBe("application/pdf");
  });

  it("continues a long quotation over more pages", async () => {
    const many = Array.from({ length: 90 }, (_, index) => ({ id: `l${index}`, title: `Item ${index} with a description long enough to wrap onto a second line of the item column`, quantity: "1", unit: "nos", rate: "10", unitCost: "8" }));
    const pricing = priceQuote(many.map((line) => ({ ...line, areaKey: "general", tradeKey: "none" })), [], { currencyDecimals: 2, pricesIncludeTax: false, rounding: "line" });
    const bytes = await composeProposal([], { ...quotation, presentation: presentForClient(many, pricing, "disclosed_markup", 2), groups: [{ name: "General", lineIds: many.map((line) => line.id) }] });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
  });

  it("appends a certificate page; the signed file's hash differs from the original it names", async () => {
    const original = await composeProposal([], quotation);
    const signed = await appendCertificate(original, {
      requestId: "00000000-0000-4000-8000-000000000001", documentTitle: "Villa fit-out", reference: "FIRM-QUO-2026-00012", documentSha256: sha256(original),
      signer: { name: "Aisha Khan", email: "aisha@example.com", phone: null }, signedAt: "2026-10-06T10:00:00.000Z", ip: "203.0.113.9", userAgent: "Mozilla/5.0",
      signature: { kind: "typed", text: "Aisha Khan" }, brandName: "Firm",
    });
    expect((await PDFDocument.load(signed)).getPageCount()).toBe((await PDFDocument.load(original)).getPageCount() + 1);
    expect(sha256(signed)).not.toBe(sha256(original));
  });

  it("prints money exactly", async () => {
    expect(moneyText("1234567.5", "AED", 2)).toBe("AED 1,234,567.50");
    expect(moneyText("-12.345", "KWD", 3)).toBe("-KWD 12.345");
    expect(moneyText("1000", "JPY", 0)).toBe("JPY 1,000");
  });
});

describe("the QS step (PLM-082/084)", () => {
  const base = [{ id: "a", kind: "item", quantity: "2", rate: "100", unitCost: "80", markupPercent: "25", pricingMode: "rate", optional: false }];
  it("fingerprints the pricing; any price or quantity change makes the confirmation stale", () => {
    const hash = pricingHash(base);
    expect(pricingHash([{ ...base[0], rate: "100.00" }])).toBe(hash);
    expect(pricingHash([{ ...base[0], rate: "101" }])).not.toBe(hash);
    expect(pricingHash([{ ...base[0], quantity: "3" }])).not.toBe(hash);
    expect(qsStage(true, { status: "confirmed", pricingHash: hash }, hash)).toBe("confirmed");
    expect(qsStage(true, { status: "confirmed", pricingHash: hash }, pricingHash([{ ...base[0], rate: "90" }]))).toBe("stale");
    expect(qsStage(true, { status: "with_qs", pricingHash: null }, hash)).toBe("with_qs");
    expect(qsStage(true, null, hash)).toBe("to_send");
    expect(qsStage(false, null, hash)).toBe("not_required");
  });
  it("names the price fields a change touches", () => {
    expect(touchesQsFields({ title: "x", rate: "1", unitCost: "2" })).toEqual(["rate", "unitCost"]);
    expect(touchesQsFields({ title: "x", quantity: "3" })).toEqual([]);
  });
});

describe("the intro deck's page 3 (PLM-106)", () => {
  it("prints the discovery answers by their labels", async () => {
    expect(answerText(["modern", "warm"], [{ id: "modern", label: "Modern" }, { id: "warm", label: "Warm tones" }])).toBe("Modern, Warm tones");
    expect(answerText(true)).toBe("Yes");
    expect(answerText({ name: "plan.pdf" })).toBe("plan.pdf");
    const bytes = await introPagePdf({ brand: { name: "Firm", accent: null }, title: "Villa 12", reference: "O-0012", clientName: "Aisha", enquiryType: "full_interior_design",
      clientType: "homeowner", location: "Street 4", area: "3200", areaUnit: "sqft", spaces: 6, clientEmail: "a@example.com", floorPlan: true,
      answers: [{ label: "Style", value: "Modern" }] });
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(1);
    expect(document.getPage(0).getSize()).toEqual({ width: 960, height: 540 });
  });
});
