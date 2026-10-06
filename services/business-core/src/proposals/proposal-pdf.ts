import { createHash } from "node:crypto";
import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFPage, type RGB } from "pdf-lib";
import type { ClientPresentation, ClientSummaryRow } from "./markup-disclosure";
import { PdfText, cleanText, type TextWeight } from "./pdf-text";

/**
 * The client proposal as one PDF (PLM-085): the firm's own designed pages 1–3, page 4 = the live quotation,
 * then page 5. Uploaded pages are copied as they are (a PDF's pages, or an image filling an A4 page); the
 * quotation is drawn from the quote's own data, so the locked pages can never be changed from a quote and the
 * quotation can never be changed from the template. Signing appends a certificate page (R8).
 */
export type TemplatePage = { slot: 1 | 2 | 3 | 5; mimeType: string; bytes: Uint8Array };

export type QuotationPage = {
  brand: { name: string; accent: string | null };
  title: string;
  /** The quotation number, as allocated or as the firm's own. */
  reference: string;
  revision: number;
  issuedOn: string;
  validUntil: string | null;
  client: { name: string; project: string; address: string | null };
  currency: string;
  decimals: number;
  /** The tax's own name in the entity's country ("VAT", "GST"); "Tax" when unknown. */
  taxLabel: string;
  presentation: ClientPresentation;
  /** Lines grouped as the client document shows them (by area, or one group). */
  groups: Array<{ name: string; lineIds: string[] }>;
  paymentTerms: Array<{ title: string; percent: number | string; trigger: string }>;
};

export type SignatureEvidence = {
  requestId: string;
  documentTitle: string;
  reference: string;
  documentSha256: string;
  signer: { name: string; email: string | null; phone: string | null };
  signedAt: string;
  ip: string;
  userAgent: string;
  signature: { kind: "typed"; text: string } | { kind: "drawn"; png: Uint8Array };
  brandName: string;
};

const A4 = PageSizes.A4 as [number, number];
const MARGIN = 48;
const INK = rgb(0.13, 0.14, 0.16), MUTED = rgb(0.42, 0.44, 0.48), RULE = rgb(0.86, 0.87, 0.89);

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** An exact decimal string as money: grouped thousands, the currency's decimals, the ISO code first. */
export function moneyText(amount: string, currency: string, decimals: number) {
  const negative = amount.trim().startsWith("-");
  const [whole, fraction = ""] = amount.replace(/^[-+]/, "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const digits = decimals > 0 ? `.${fraction.padEnd(decimals, "0").slice(0, decimals)}` : "";
  return `${negative ? "-" : ""}${currency} ${grouped}${digits}`;
}

function accentColor(hex: string | null): RGB {
  const match = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match) return INK;
  const value = Number.parseInt(match[1], 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/** Adds an uploaded page: every page of a PDF, or an image scaled to fill an A4 page. */
async function addTemplatePage(document: PDFDocument, page: TemplatePage) {
  if (page.mimeType === "application/pdf") {
    const source = await PDFDocument.load(page.bytes, { ignoreEncryption: false });
    const copied = await document.copyPages(source, source.getPageIndices());
    for (const item of copied) document.addPage(item);
    return;
  }
  const image = page.mimeType === "image/png" ? await document.embedPng(page.bytes) : await document.embedJpg(page.bytes);
  const landscape = image.width > image.height;
  const [width, height] = landscape ? [A4[1], A4[0]] : A4;
  const target = document.addPage([width, height]);
  const scale = Math.max(width / image.width, height / image.height);
  const drawn = { width: image.width * scale, height: image.height * scale };
  target.drawImage(image, { x: (width - drawn.width) / 2, y: (height - drawn.height) / 2, ...drawn });
}

/** How many pages a template file holds (validated on upload). */
export async function templatePageCount(mimeType: string, bytes: Uint8Array) {
  if (mimeType === "application/pdf") return (await PDFDocument.load(bytes)).getPageCount();
  const probe = await PDFDocument.create();
  if (mimeType === "image/png") await probe.embedPng(bytes); else await probe.embedJpg(bytes);
  return 1;
}

const SUMMARY_LABEL: Record<ClientSummaryRow["key"], string> = {
  "Cost of items": "Cost of items", Markup: "Markup", "Items at cost": "Items at cost", "Our fee": "Our fee",
  Subtotal: "Subtotal", Discount: "Discount", Tax: "Tax", Total: "Total",
};

/** Page 4: the quotation, drawn from the quote's data in the firm's disclosure mode; continues onto more pages when long. */
async function drawQuotation(document: PDFDocument, data: QuotationPage) {
  const t = await PdfText.embed(document);
  const accent = accentColor(data.brand.accent);
  const disclosed = data.presentation.mode === "disclosed_markup";
  const width = A4[0] - MARGIN * 2;
  // Columns from the inline end: amount, rate, (markup, cost), quantity; the item takes what is left.
  const columns = disclosed
    ? [{ key: "quantity", width: 52 }, { key: "cost", width: 70 }, { key: "markup", width: 52 }, { key: "rate", width: 70 }, { key: "amount", width: 82 }]
    : [{ key: "quantity", width: 64 }, { key: "rate", width: 88 }, { key: "amount", width: 96 }];
  const itemWidth = width - columns.reduce((sum, column) => sum + column.width, 0) - 8;
  const heading: Record<string, string> = { quantity: "Qty", cost: "Cost", markup: "Markup", rate: data.presentation.mode === "fee_based" ? "Cost" : "Rate", amount: "Amount" };
  const money = (amount: string) => moneyText(amount, data.currency, data.decimals);
  const byId = new Map(data.presentation.lines.map((line) => [line.id, line]));

  let page: PDFPage = document.addPage(A4);
  let y = A4[1] - MARGIN;
  // `box` is the width a right-to-left value aligns within (to its end); without one, text starts at x.
  const text = (value: string, x: number, at: number, size = 9, weight: TextWeight = "regular", color = INK, box?: number) => t.draw(page, value, { x, y: at, size, weight, color, width: box });
  const right = (value: string, end: number, at: number, size = 9, weight: TextWeight = "regular", color = INK) => t.draw(page, value, { x: end, y: at, size, weight, color, align: "end" });
  const tableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 6, width, height: 20, color: rgb(0.96, 0.96, 0.97) });
    text("Item", MARGIN + 6, y, 8, "bold", MUTED);
    let end = A4[0] - MARGIN;
    for (const column of [...columns].reverse()) { right(heading[column.key], end - 6, y, 8, "bold", MUTED); end -= column.width; }
    y -= 24;
  };
  const fresh = () => {
    page = document.addPage(A4);
    y = A4[1] - MARGIN;
    text(`${data.reference} · ${data.title} (continued)`, MARGIN, y, 9, "bold", MUTED);
    y -= 22;
    tableHeader();
  };
  const room = (needed: number) => { if (y - needed < MARGIN + 24) fresh(); };

  // Header: brand, document, number and dates; the client on the other side.
  text(data.brand.name, MARGIN, y, 16, "bold", accent);
  right("QUOTATION", A4[0] - MARGIN, y, 16, "bold", INK);
  y -= 22;
  right(`${data.reference} · R${data.revision}`, A4[0] - MARGIN, y, 10, "bold");
  text(data.title, MARGIN, y, 11, "bold");
  y -= 15;
  right(`Date ${data.issuedOn}`, A4[0] - MARGIN, y, 9, "regular", MUTED);
  text(`Prepared for ${data.client.name}`, MARGIN, y, 9, "regular", MUTED);
  y -= 13;
  if (data.validUntil) right(`Valid until ${data.validUntil}`, A4[0] - MARGIN, y, 9, "regular", MUTED);
  if (data.client.project) text(data.client.project, MARGIN, y, 9, "regular", MUTED);
  y -= 13;
  if (data.client.address) y = t.paragraph(page, data.client.address, { x: MARGIN, y, width: width / 2, size: 9, color: MUTED, lineHeight: 12, hug: true });
  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4[0] - MARGIN, y }, thickness: 1, color: accent });
  y -= 22;
  tableHeader();

  for (const group of data.groups) {
    const lines = group.lineIds.map((id) => byId.get(id)).filter((line): line is NonNullable<typeof line> => Boolean(line));
    if (!lines.length) continue;
    room(40);
    text(group.name, MARGIN + 6, y, 10, "bold", INK, itemWidth);
    y -= 16;
    for (const line of lines) {
      const title = t.lines(`${line.title}${line.optional ? " (optional)" : ""}`, 9, itemWidth);
      room(title.length * 12 + 8);
      const top = y;
      title.forEach((row, index) => t.draw(page, row, { x: MARGIN + 6, y: top - index * 12, width: itemWidth, color: line.optional ? MUTED : INK }));
      const values: Record<string, string> = {
        quantity: `${line.quantity} ${line.unit}`.trim(), rate: money(line.rate), amount: money(line.amount),
        cost: line.cost === null ? "" : money(line.cost), markup: line.markupPercent === null ? "" : `${line.markupPercent}%`,
      };
      let end = A4[0] - MARGIN;
      for (const column of [...columns].reverse()) { right(values[column.key], end - 6, top, 9, column.key === "amount" ? "bold" : "regular"); end -= column.width; }
      y = top - title.length * 12 - 6;
      page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: A4[0] - MARGIN, y: y + 2 }, thickness: 0.5, color: RULE });
      y -= 8;
    }
    y -= 6;
  }

  // Totals, at the inline end.
  room(data.presentation.summary.length * 16 + 20);
  y -= 6;
  for (const row of data.presentation.summary) {
    const total = row.key === "Total";
    const label = row.key === "Tax" ? `${data.taxLabel}${row.rate ? ` ${row.rate}%` : ""}` : SUMMARY_LABEL[row.key];
    // The rule sits clear of the row above's descenders (deep in Naskh).
    if (total) { y -= 3; page.drawLine({ start: { x: A4[0] - MARGIN - 220, y: y + 12 }, end: { x: A4[0] - MARGIN, y: y + 12 }, thickness: 1, color: accent }); }
    right(label, A4[0] - MARGIN - 120, y, total ? 11 : 9, total ? "bold" : "regular", total ? INK : MUTED);
    right(money(row.amount), A4[0] - MARGIN - 6, y, total ? 11 : 9, total ? "bold" : "regular");
    y -= total ? 22 : 15;
  }

  if (data.paymentTerms.length) {
    room(30 + data.paymentTerms.length * 13);
    text("Payment schedule", MARGIN, y, 10, "bold");
    y -= 15;
    for (const term of data.paymentTerms) {
      text(`${term.percent}% · ${term.title}${term.trigger ? ` — ${term.trigger}` : ""}`, MARGIN, y, 9, "regular", MUTED);
      y -= 13;
    }
  }
}

/** The one proposal PDF: pages 1–3, the quotation, page 5. Pages the firm hasn't uploaded are left out. */
export async function composeProposal(template: TemplatePage[], quotation: QuotationPage): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(cleanText(`${quotation.reference} · ${quotation.title}`));
  document.setAuthor(cleanText(quotation.brand.name));
  document.setProducer(cleanText(quotation.brand.name));
  const slot = (number: TemplatePage["slot"]) => template.find((page) => page.slot === number);
  for (const number of [1, 2, 3] as const) { const page = slot(number); if (page) await addTemplatePage(document, page); }
  await drawQuotation(document, quotation);
  const closing = slot(5);
  if (closing) await addTemplatePage(document, closing);
  return document.save();
}

/**
 * The signed copy: the exact signed PDF with a certificate page after it, naming the signer, when, from where
 * (IP and browser), how they signed, and the SHA-256 of the document they signed.
 */
export async function appendCertificate(signed: Uint8Array, evidence: SignatureEvidence): Promise<Uint8Array> {
  const document = await PDFDocument.load(signed);
  const t = await PdfText.embed(document, ["regular", "bold", "italic"]);
  // The digest and the request id are hex and ASCII by construction; they stay in a monospaced standard font.
  const mono = await document.embedFont(StandardFonts.Courier);
  const page = document.addPage(A4);
  const width = A4[0] - MARGIN * 2;
  let y = A4[1] - MARGIN;
  const write = (value: string, size = 10, weight: TextWeight = "regular", color = INK) => {
    y = t.paragraph(page, value, { x: MARGIN, y, width, size, weight, color, lineHeight: size + 5, hug: true });
  };
  write("Signature certificate", 18, "bold");
  y -= 6;
  write(`${evidence.brandName} · ${evidence.documentTitle} · ${evidence.reference}`, 10, "regular", MUTED);
  y -= 14;
  const monoLines = (value: string) => {
    const perLine = Math.max(1, Math.floor((width - 130) / mono.widthOfTextAtSize("0", 10)));
    const lines = value.match(new RegExp(`.{1,${perLine}}`, "g")) ?? [value];
    lines.forEach((line, index) => page.drawText(line, { x: MARGIN + 130, y: y - index * 14, size: 10, font: mono, color: INK }));
    return lines.length;
  };
  const row = (label: string, value: string, monospaced = false) => {
    t.draw(page, label, { x: MARGIN, y, size: 9, weight: "bold", color: MUTED });
    const shown = value || "—";
    const count = monospaced && /^[ -~]+$/.test(shown) ? monoLines(shown)
      : Math.round((y - t.paragraph(page, shown, { x: MARGIN + 130, y, width: width - 130, size: 10, color: INK, lineHeight: 14, hug: true })) / 14);
    y -= Math.max(1, count) * 14 + 6;
  };
  row("Signed by", evidence.signer.name);
  row("Email", evidence.signer.email ?? "");
  row("Phone", evidence.signer.phone ?? "");
  row("Signed at (UTC)", evidence.signedAt);
  row("IP address", evidence.ip);
  row("Browser", evidence.userAgent);
  row("Method", evidence.signature.kind === "typed" ? "Typed name" : "Drawn signature");
  row("Document SHA-256", evidence.documentSha256, true);
  row("Request", evidence.requestId, true);
  y -= 10;
  t.draw(page, "Signature", { x: MARGIN, y, size: 9, weight: "bold", color: MUTED });
  y -= 12;
  page.drawRectangle({ x: MARGIN, y: y - 90, width: 260, height: 90, borderColor: RULE, borderWidth: 1 });
  if (evidence.signature.kind === "typed") {
    const [line] = t.lines(evidence.signature.text, 22, 232, "italic");
    t.draw(page, line, { x: MARGIN + 14, y: y - 55, width: 232, color: INK });
  } else {
    const image = await document.embedPng(evidence.signature.png);
    const scale = Math.min(240 / image.width, 80 / image.height, 1);
    page.drawImage(image, { x: MARGIN + 10, y: y - 85, width: image.width * scale, height: image.height * scale });
  }
  y -= 110;
  write("The SHA-256 above is the fingerprint of the document exactly as it was presented for signature; any change to that document changes it.", 8, "regular", MUTED);
  return document.save();
}
