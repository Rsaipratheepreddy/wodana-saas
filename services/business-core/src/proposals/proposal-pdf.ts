import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { A4, MUTED, PdfLayout, RULE, amountText, documentDate, moneyText, quantityText, type Column, type RowGroup } from "../documents/pdf-layout";
import type { ClientPresentation, ClientSummaryRow } from "./markup-disclosure";
import { cleanText } from "./pdf-text";
import type { PdfLetterhead } from "./pdf-letterhead";

export { moneyText } from "../documents/pdf-layout";

/**
 * The client proposal as one PDF (PLM-085): the firm's own designed pages 1–3, page 4 = the live quotation,
 * then page 5. Uploaded pages are copied as they are (a PDF's pages, or an image filling an A4 page); the
 * quotation is drawn from the quote's own data, so the locked pages can never be changed from a quote and the
 * quotation can never be changed from the template. Signing appends a certificate page (R8).
 */
export type TemplatePage = { slot: 1 | 2 | 3 | 5; mimeType: string; bytes: Uint8Array };

export type QuotationPage = {
  brand: { name: string; accent: string | null };
  /** The issuing business's letterhead (PLM-112); without one the brand's name heads the page. */
  letterhead?: PdfLetterhead | null;
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
  /** The workspace's locale, for dates ("12 Oct 2026"); English when unknown. */
  locale?: string | null;
  /** A line's description, printed under its title. */
  descriptions?: Record<string, string>;
  terms?: string;
  exclusions?: string;
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
  /** The brand's accent colour. */
  brandAccent?: string | null;
};

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

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

/** Page 4: the quotation in the shared document theme, drawn from the quote's data in the firm's disclosure mode. */
async function drawQuotation(document: PDFDocument, data: QuotationPage) {
  const layout = await PdfLayout.create({
    title: `${data.reference} · ${data.title}`, brand: data.brand, letterhead: data.letterhead ?? null, running: `Quotation ${data.reference} · R${data.revision} · ${data.client.name}`,
  }, document);
  const disclosed = data.presentation.mode === "disclosed_markup";
  const money = (amount: string) => moneyText(amount, data.currency, data.decimals);
  const amount = (value: string) => amountText(value, data.decimals);
  const date = (value: string | null) => documentDate(value, data.locale);
  const priced = (label: string) => `${label} (${data.currency})`;
  await layout.header({
    label: "Quotation",
    reference: `${data.reference} · R${data.revision}`,
    facts: [["Date", date(data.issuedOn)], ["Valid until", date(data.validUntil)], ["Currency", data.currency]],
    title: data.title,
    party: { label: "Prepared for", name: data.client.name, lines: [data.client.project !== data.title ? data.client.project : "", data.client.address ?? ""] },
  });
  const columns: Column[] = disclosed
    ? [{ key: "item", header: "Item" }, { key: "quantity", header: "Qty", width: 56, align: "end" }, { key: "cost", header: priced("Cost"), width: 72, align: "end" },
      { key: "markup", header: "Markup", width: 50, align: "end" }, { key: "rate", header: priced("Rate"), width: 72, align: "end" }, { key: "amount", header: priced("Amount"), width: 80, align: "end" }]
    : [{ key: "item", header: "Item" }, { key: "quantity", header: "Qty", width: 66, align: "end" },
      { key: "rate", header: priced(data.presentation.mode === "fee_based" ? "Cost" : "Rate"), width: 88, align: "end" }, { key: "amount", header: priced("Amount"), width: 92, align: "end" }];
  const byId = new Map(data.presentation.lines.map((line) => [line.id, line]));
  const groups: RowGroup[] = data.groups.map((group) => ({
    title: data.groups.length > 1 || group.name !== "General" ? group.name : undefined,
    rows: group.lineIds.map((id) => byId.get(id)).filter((line): line is NonNullable<typeof line> => Boolean(line)).map((line) => ({
      cells: {
        item: `${line.title}${line.optional ? " (optional)" : ""}`, quantity: quantityText(line.quantity, line.unit), rate: amount(line.rate), amount: amount(line.amount),
        cost: line.cost === null ? "" : amount(line.cost), markup: line.markupPercent === null ? "" : `${line.markupPercent}%`,
      },
      note: data.descriptions?.[line.id] || undefined,
      muted: line.optional,
    })),
  })).filter((group) => group.rows.length);
  layout.table(columns, groups);
  layout.totals(data.presentation.summary.map((row) => ({
    label: row.key === "Tax" ? `${data.taxLabel}${row.rate ? ` ${row.rate}%` : ""}` : SUMMARY_LABEL[row.key],
    value: money(row.amount), emphasis: row.key === "Total",
  })));
  if (data.paymentTerms.length) {
    layout.section("Payment schedule", 20 + data.paymentTerms.length * 15);
    layout.table([{ key: "stage", header: "Stage" }, { key: "when", header: "When", width: 170 }, { key: "share", header: "Share", width: 60, align: "end" }],
      data.paymentTerms.map((term) => ({ cells: { stage: term.title, when: term.trigger, share: `${term.percent}%` } })));
  }
  if (data.terms?.trim()) { layout.section("Terms"); layout.paragraph(data.terms, { size: 8.5, color: MUTED }); }
  if (data.exclusions?.trim()) { layout.section("Exclusions"); layout.paragraph(data.exclusions, { size: 8.5, color: MUTED }); }
  layout.section("Acceptance", 84);
  layout.signatures([{ label: "For the client", name: data.client.name }, { label: `For ${data.letterhead?.name ?? data.brand.name}` }]);
  return layout;
}

/** The one proposal PDF: pages 1–3, the quotation, page 5. Pages the firm hasn't uploaded are left out. */
export async function composeProposal(template: TemplatePage[], quotation: QuotationPage): Promise<Uint8Array> {
  return (await renderProposal(template, quotation)).bytes;
}

/** The proposal PDF and what its generated pages say, as text (for render tests). */
export async function renderProposal(template: TemplatePage[], quotation: QuotationPage): Promise<{ bytes: Uint8Array; outline: string }> {
  const document = await PDFDocument.create();
  document.setTitle(cleanText(`${quotation.reference} · ${quotation.title}`));
  document.setAuthor(cleanText(quotation.letterhead?.name ?? quotation.brand.name));
  document.setCreator(cleanText(quotation.brand.name));
  document.setProducer("Powered by Wodana");
  const slot = (number: TemplatePage["slot"]) => template.find((page) => page.slot === number);
  for (const number of [1, 2, 3] as const) { const page = slot(number); if (page) await addTemplatePage(document, page); }
  const layout = await drawQuotation(document, quotation);
  const closing = slot(5);
  if (closing) await addTemplatePage(document, closing);
  // Numbered once every page is in, so "Page x of y" counts the firm's designed pages too.
  layout.finish();
  return { bytes: await document.save(), outline: layout.outline() };
}

/**
 * The signed copy: the exact signed PDF with a certificate page after it, naming the signer, when, from where
 * (IP and browser), how they signed, and the SHA-256 of the document they signed.
 */
/** A moment as "2026-10-12 09:41:07 UTC" (the evidence keeps the exact ISO value). */
const utcMoment = (value: string) => { const at = new Date(value); return Number.isNaN(at.getTime()) ? value : `${at.toISOString().slice(0, 19).replace("T", " ")} UTC`; };

export async function appendCertificate(signed: Uint8Array, evidence: SignatureEvidence): Promise<Uint8Array> {
  const document = await PDFDocument.load(signed);
  const layout = await PdfLayout.create({ title: evidence.documentTitle, brand: { name: evidence.brandName, accent: evidence.brandAccent ?? null }, running: `Signature certificate · ${evidence.reference}` },
    document, ["regular", "bold", "italic"]);
  // The digest and the request id are hex and ASCII by construction; they stay in a monospaced standard font.
  const mono = await document.embedFont(StandardFonts.Courier);
  await layout.header({ label: "Signature certificate", reference: evidence.reference, title: evidence.documentTitle });
  layout.facts([
    ["Signed by", evidence.signer.name], ["Email", evidence.signer.email ?? ""], ["Phone", evidence.signer.phone ?? ""], ["Signed at (UTC)", utcMoment(evidence.signedAt)],
    ["IP address", evidence.ip], ["Browser", evidence.userAgent], ["Method", evidence.signature.kind === "typed" ? "Typed name" : "Drawn signature"],
  ]);
  const monoRow = (label: string, value: string) => {
    const perLine = Math.max(1, Math.floor((layout.width - 130) / mono.widthOfTextAtSize("0", 9.5)));
    const lines = /^[ -~]+$/.test(value) ? value.match(new RegExp(`.{1,${perLine}}`, "g")) ?? [value] : null;
    if (!lines) { layout.facts([[label, value]]); return; }
    layout.room(lines.length * 13 + 5);
    layout.draw(label, layout.start, layout.y, { size: 8.5, weight: "bold", color: MUTED, box: 122 });
    lines.forEach((line, index) => layout.page.drawText(line, { x: layout.start + 130, y: layout.y - index * 13, size: 9.5, font: mono }));
    layout.y -= lines.length * 13 + 5;
  };
  monoRow("Document SHA-256", evidence.documentSha256);
  monoRow("Request", evidence.requestId);
  layout.gap(8);
  layout.section("Signature", 100);
  const top = layout.y;
  layout.page.drawRectangle({ x: layout.start, y: top - 90, width: 260, height: 90, borderColor: RULE, borderWidth: 1 });
  if (evidence.signature.kind === "typed") {
    const [line] = layout.t.lines(evidence.signature.text, 22, 232, "italic");
    layout.draw(line, layout.start + 14, top - 55, { box: 232 });
  } else {
    const image = await document.embedPng(evidence.signature.png);
    const scale = Math.min(240 / image.width, 80 / image.height, 1);
    layout.page.drawImage(image, { x: layout.start + 10, y: top - 85, width: image.width * scale, height: image.height * scale });
  }
  layout.y = top - 108;
  layout.paragraph("The SHA-256 above is the fingerprint of the document exactly as it was presented for signature; any change to that document changes it.", { size: 8, color: MUTED });
  // The signed pages keep their own numbers; the certificate is not counted into them.
  return layout.save({ numbered: false });
}
