import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fontkit from "@pdf-lib/fontkit";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream, type PDFPage } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { priceQuote } from "../quotation/quote-pricing";
import { presentForClient } from "./markup-disclosure";
import { PdfText } from "./pdf-text";
import { introPagePdf } from "./intro-deck";
import { appendCertificate, composeProposal, sha256 } from "./proposal-pdf";

const FONTS = join(__dirname, "..", "..", "assets", "fonts");
const naskh = fontkit.create(readFileSync(join(FONTS, "NotoNaskhArabic-Regular.ttf")));

/** Every glyph id the page shows, from its content streams' hex show-text operators (Identity-H: 4 hex digits a glyph). */
function shownGlyphs(page: PDFPage): number {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => page.doc.context.lookup(ref)) : [contents];
  const text = streams.map((stream) => (stream instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1") : "")).join("\n");
  return Array.from(text.matchAll(/<([0-9a-fA-F]*)>\s*Tj/g)).reduce((sum, match) => sum + match[1].length / 4, 0);
}

async function render(value: string) {
  const document = await PDFDocument.create();
  const text = await PdfText.embed(document);
  const page = document.addPage([595, 842]);
  const line = text.draw(page, value, { x: 40, y: 800, size: 12, width: 500 });
  const loaded = await PDFDocument.load(await document.save());
  return { line, glyphs: shownGlyphs(loaded.getPage(0)), text };
}

const glyphCount = (line: { runs: Array<{ glyphs: unknown[] }> }) => line.runs.reduce((sum, run) => sum + run.glyphs.length, 0);

describe("PDF text in any script (rule 10)", () => {
  it("draws Latin, Arabic, mixed and Hindi text with every glyph in the page", async () => {
    const latin = await render("Invoice 42");
    expect(latin.glyphs).toBe(10);
    const arabic = await render("سلام");
    expect(arabic.glyphs).toBe(4);
    const mixed = await render("Invoice INV-0042 فاتورة");
    expect(mixed.glyphs).toBe(glyphCount(mixed.line));
    expect(mixed.glyphs).toBeGreaterThanOrEqual(17 + 6);
    const hindi = await render("नमस्ते");
    // na, ma, the half form of sa, ta and the e matra, as the font shapes them.
    expect(hindi.glyphs).toBe(5);
    expect(glyphCount(hindi.line)).toBe(5);
  });

  it("shapes Arabic into joined forms and orders it for display", async () => {
    const { text } = await render("");
    const line = text.layout("سلام", 12);
    expect(line.rtl).toBe(true);
    const [run] = line.runs;
    // Visual order, left to right: meem (isolated, as U+FEE1), lam-alef (the rlig ligature), seen (initial, as U+FEB3).
    expect(run.glyphs.map((glyph) => glyph.codePoints[0])).toEqual([0x645, 0x627, 0x644, 0x633]);
    expect(run.glyphs[0].id).toBe(naskh.glyphForCodePoint(0xfee1).id);
    expect(run.glyphs[3].id).toBe(naskh.glyphForCodePoint(0xfeb3).id);
    expect(run.glyphs[1].name).toMatch(/fina\.rlig/);
    expect(run.glyphs[2].name).toMatch(/medi\.rlig/);
    expect(run.glyphs[3].id).not.toBe(naskh.glyphForCodePoint(0x633).id);
  });

  it("keeps numbers and Latin inside right-to-left text in reading order", async () => {
    const { text } = await render("");
    const rtl = text.layout("فاتورة 42", 12);
    expect(rtl.rtl).toBe(true);
    const codes = (line: typeof rtl) => line.runs.map((run) => run.glyphs.flatMap((glyph) => glyph.codePoints));
    // The number is the leftmost run and still reads 4, 2; the Arabic word follows to its right.
    expect(codes(rtl)[0]).toEqual([0x34, 0x32]);
    expect(codes(rtl).at(-1)).toContain(0x641);
    const ltr = text.layout("Invoice INV-0042 فاتورة", 12);
    expect(ltr.rtl).toBe(false);
    expect(codes(ltr)[0].slice(0, 7)).toEqual(Array.from("Invoice", (char) => char.codePointAt(0)));
    expect(codes(ltr).at(-1)).toContain(0x641);
    // Brackets in right-to-left text are mirrored so they still enclose their words.
    const bracketed = text.layout("فاتورة (مسودة)", 12).runs.flatMap((run) => run.glyphs.flatMap((glyph) => glyph.codePoints));
    expect(bracketed.indexOf(0x28)).toBeLessThan(bracketed.indexOf(0x29));
  });

  it("wraps by the shaped width, keeping a paragraph's direction on every line", async () => {
    const { text } = await render("");
    const lines = text.lines("طاولة طعام من خشب الجوز مع ستة كراسي منجدة بالقماش INV-0042 والتسليم خلال ستة أسابيع", 11, 150);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) { expect(line.width).toBeLessThanOrEqual(150); expect(line.rtl).toBe(true); }
    expect(text.lines("Supercalifragilisticexpialidocious", 11, 60).every((line) => line.width <= 60)).toBe(true);
  });

  it("ships fonts fontkit can subset (no odd-length glyph records)", () => {
    for (const file of readdirSync(FONTS).filter((name) => name.endsWith(".ttf"))) {
      const font = fontkit.create(readFileSync(join(FONTS, file))) as unknown as { loca: { offsets: number[] } };
      const offsets = font.loca.offsets;
      expect(offsets.slice(1).filter((offset, index) => (offset - offsets[index]) % 2).length, file).toBe(0);
    }
  });

  it("generates a proposal with an Arabic client and Arabic line items", async () => {
    const lines = [
      { id: "a", title: "خزانة ملابس من خشب الجوز بأبواب منزلقة", quantity: "2", unit: "قطعة", rate: "12500", unitCost: "9000", optional: false },
      { id: "b", title: "دهان الجدران - لونان (أبيض عاجي)", quantity: "120", unit: "م²", rate: "35", unitCost: "20", optional: false },
      { id: "c", title: "Kitchen cabinets, matt lacquer", quantity: "1", unit: "lot", rate: "48000", unitCost: "39000", optional: false },
      { id: "d", title: "إضاءة مخفية للسقف", quantity: "1", unit: "lot", rate: "6400", unitCost: "4200", optional: true },
    ];
    const priced = priceQuote(lines.map((line) => ({ ...line, areaKey: "general", tradeKey: "none", taxRate: "5" })), [], { currencyDecimals: 2, pricesIncludeTax: false, rounding: "line" });
    const bytes = await composeProposal([], {
      brand: { name: "Palm Interiors", accent: "#1f6feb" }, title: "فيلا النخيل - تصميم داخلي", reference: "PLM-QUO-2026-00042", revision: 1, issuedOn: "2026-10-06", validUntil: "2026-10-20",
      client: { name: "سارة المنصوري", project: "فيلا 12، جزيرة النخيل", address: "شارع 4، المنطقة 2، دبي" }, currency: "AED", decimals: 2, taxLabel: "ضريبة القيمة المضافة",
      presentation: presentForClient(lines, priced, "all_inclusive", 2), groups: [{ name: "غرفة النوم الرئيسية", lineIds: ["a", "b"] }, { name: "Kitchen", lineIds: ["c", "d"] }],
      paymentTerms: [{ title: "دفعة مقدمة", percent: 50, trigger: "عند التوقيع" }, { title: "On delivery", percent: 50, trigger: "" }],
    });
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(1);
    expect(shownGlyphs(document.getPage(0))).toBeGreaterThan(200);
    expect(bytes.length).toBeLessThan(200_000);
    const signed = await appendCertificate(bytes, {
      requestId: "00000000-0000-4000-8000-000000000001", documentTitle: "فيلا النخيل - تصميم داخلي", reference: "PLM-QUO-2026-00042", documentSha256: sha256(bytes),
      signer: { name: "سارة المنصوري", email: "sara@example.com", phone: "+971 50 000 0000" }, signedAt: "2026-10-06T10:00:00.000Z", ip: "203.0.113.9", userAgent: "Mozilla/5.0",
      signature: { kind: "typed", text: "سارة المنصوري" }, brandName: "Palm Interiors",
    });
    expect((await PDFDocument.load(signed)).getPageCount()).toBe(2);
    const intro = await introPagePdf({ brand: { name: "Palm Interiors", accent: "#1f6feb" }, title: "فيلا النخيل", reference: "O-0042", clientName: "سارة المنصوري", enquiryType: "full_interior_design",
      clientType: "homeowner", location: "جزيرة النخيل، دبي", area: "3200", areaUnit: "sqft", spaces: 6, clientEmail: "sara@example.com", floorPlan: true,
      answers: [{ label: "Style", value: "عصري دافئ مع لمسات خشبية" }, { label: "Budget", value: "AED 450,000" }, { label: "शैली", value: "आधुनिक और गर्म" }] });
    expect(shownGlyphs((await PDFDocument.load(intro)).getPage(0))).toBeGreaterThan(100);
    if (process.env.PDF_SAMPLE_DIR) {
      mkdirSync(process.env.PDF_SAMPLE_DIR, { recursive: true });
      writeFileSync(join(process.env.PDF_SAMPLE_DIR, "arabic-proposal.pdf"), bytes);
      writeFileSync(join(process.env.PDF_SAMPLE_DIR, "arabic-signed.pdf"), signed);
      writeFileSync(join(process.env.PDF_SAMPLE_DIR, "arabic-intro.pdf"), intro);
    }
  });
});
