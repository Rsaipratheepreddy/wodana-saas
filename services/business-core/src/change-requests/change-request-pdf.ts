import { PDFDocument, PageSizes, rgb, type PDFPage } from "pdf-lib";
import { drawLetterheadFooter, drawLetterheadTop, type PdfLetterhead } from "../proposals/pdf-letterhead";
import { PdfText, type TextWeight } from "../proposals/pdf-text";
import { moneyText } from "../proposals/proposal-pdf";

/**
 * A change request as the one-page document the client signs (R11): what changes, each priced line, the price and
 * handover impact and the design note. Drawn from the change's own record (client prices only; no cost or margin).
 * Signing appends the e-sign certificate page to exactly this file.
 */
export type ChangeDocument = {
  brandName: string;
  /** The issuing business's letterhead (PLM-112); without one the brand's name heads the page. */
  letterhead?: PdfLetterhead | null;
  reference: string;
  title: string;
  description: string;
  designImpact: string;
  project: string;
  clientName: string;
  issuedOn: string;
  currency: string;
  decimals: number;
  lines: Array<{ action: string; title: string; room: string | null; quantity: string | null; unit: string; unitPrice: string | null; amount: string }>;
  priceImpact: string;
  timeImpactDays: number;
  handoverBefore: string | null;
  handoverAfter: string | null;
};

const A4 = PageSizes.A4 as [number, number];
const MARGIN = 48;
const INK = rgb(0.13, 0.14, 0.16), MUTED = rgb(0.42, 0.44, 0.48), RULE = rgb(0.86, 0.87, 0.89);
const ACTION: Record<string, string> = { add: "Add", omit: "Omit", replace: "Replace", draw: "Allowance", move: "Move" };

export async function composeChangeDocument(data: ChangeDocument): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(`${data.reference} ${data.title}`);
  document.setProducer(data.brandName);
  const t = await PdfText.embed(document);
  const width = A4[0] - MARGIN * 2;
  const letterhead = data.letterhead ?? null;
  let page: PDFPage = document.addPage(A4);
  drawLetterheadFooter(page, t, letterhead, { x: MARGIN, width });
  let y = A4[1] - MARGIN;
  const draw = (value: string, x: number, size = 10, weight: TextWeight = "regular", color = INK, box?: number) => t.draw(page, value, { x, y, size, weight, color, width: box });
  const end = (value: string, x: number, size = 10, weight: TextWeight = "regular") => t.draw(page, value, { x, y, size, weight, color: INK, align: "end" });
  const money = (amount: string) => moneyText(amount, data.currency, data.decimals);
  const space = (needed: number) => { if (y - needed < MARGIN) { page = document.addPage(A4); drawLetterheadFooter(page, t, letterhead, { x: MARGIN, width }); y = A4[1] - MARGIN; } };
  const paragraph = (value: string, size = 10, color = MUTED) => {
    for (const line of wrap(t, value, width, size)) { space(size + 4); draw(line, MARGIN, size, "regular", color, width); y -= size + 4; }
  };

  if (letterhead) { y = await drawLetterheadTop(document, page, t, letterhead, { x: MARGIN, y, width, accent: INK }); y -= 8; }
  else draw(data.brandName, MARGIN, 11, "bold");
  end(data.reference, MARGIN + width, 11, "bold");
  y -= 28;
  draw(data.title, MARGIN, 18, "bold", INK, width);
  y -= 20;
  draw([data.project, data.clientName, data.issuedOn].filter(Boolean).join(" · "), MARGIN, 10, "regular", MUTED, width);
  y -= 22;
  if (data.description) { paragraph(data.description, 10, INK); y -= 8; }

  // Lines: what, how much, and what it adds or saves.
  const columns = { amount: MARGIN + width, rate: MARGIN + width - 96, quantity: MARGIN + width - 190 };
  space(40);
  draw("Item", MARGIN, 9, "bold", MUTED);
  end("Qty", columns.quantity, 9, "bold");
  end("Rate", columns.rate, 9, "bold");
  end("Amount", columns.amount, 9, "bold");
  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + width, y }, thickness: 0.6, color: RULE });
  y -= 14;
  for (const line of data.lines) {
    const label = `${ACTION[line.action] ?? line.action}: ${line.title}${line.room ? ` (${line.room})` : ""}`;
    const rows = wrap(t, label, width - 260, 10);
    space(rows.length * 14 + 6);
    rows.forEach((row, index) => { draw(row, MARGIN, 10, "regular", INK, width - 260); if (index < rows.length - 1) y -= 14; });
    if (line.quantity) end(`${line.quantity.replace(/\.?0+$/, "")} ${line.unit}`.trim(), columns.quantity);
    if (line.unitPrice) end(money(line.unitPrice), columns.rate);
    end(money(line.amount), columns.amount);
    y -= 18;
  }
  page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: MARGIN + width, y: y + 6 }, thickness: 0.6, color: RULE });
  y -= 10;
  space(70);
  draw("Price impact", MARGIN, 11, "bold");
  end(money(data.priceImpact), columns.amount, 11, "bold");
  y -= 18;
  draw("Handover", MARGIN, 10);
  const handover = data.timeImpactDays
    ? `${data.handoverBefore ?? "—"} → ${data.handoverAfter ?? "—"} (${data.timeImpactDays > 0 ? "+" : ""}${data.timeImpactDays} working days)`
    : data.handoverBefore ? `${data.handoverBefore} (unchanged)` : "No change";
  end(handover, columns.amount, 10);
  y -= 24;
  if (data.designImpact) { space(30); draw("Design", MARGIN, 10, "bold"); y -= 16; paragraph(data.designImpact, 10, INK); }
  y -= 12;
  paragraph("Signing approves this change at the price and handover date above. The signed copy and its certificate are kept with your project.", 9);
  return document.save();
}

/** Breaks text into lines that fit a width (by words; a long word stays whole). */
function wrap(t: PdfText, value: string, width: number, size: number) {
  const lines: string[] = [];
  for (const paragraph of value.split(/\n+/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && t.width(next, size) > width) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}
