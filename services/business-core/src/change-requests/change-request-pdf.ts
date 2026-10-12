import { MUTED, PdfLayout, amountText, documentDate, moneyText, quantityText } from "../documents/pdf-layout";
import type { PdfLetterhead } from "../proposals/pdf-letterhead";

/**
 * A change request as the document the client signs (R11), in the shared document theme: what changes, each priced
 * line, the price and handover impact and the design note. Drawn from the change's own record (client prices only;
 * no cost or margin). Signing appends the e-sign certificate page to exactly this file.
 */
export type ChangeDocument = {
  brandName: string;
  /** The brand's accent colour ("#1F6FEB"). */
  accent?: string | null;
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
  /** The workspace's locale, for dates; English when unknown. */
  locale?: string | null;
};

const ACTION: Record<string, string> = { add: "Add", omit: "Omit", replace: "Replace", draw: "Allowance", move: "Move" };

export async function composeChangeDocument(data: ChangeDocument): Promise<Uint8Array> {
  return (await renderChangeDocument(data)).bytes;
}

/** The change request PDF and what it says, as text (for render tests). */
export async function renderChangeDocument(data: ChangeDocument): Promise<{ bytes: Uint8Array; outline: string }> {
  const layout = await PdfLayout.create({
    title: `${data.reference} ${data.title}`, brand: { name: data.brandName, accent: data.accent ?? null }, letterhead: data.letterhead ?? null,
    running: `Change request ${data.reference} · ${data.clientName}`,
  });
  const money = (amount: string) => moneyText(amount, data.currency, data.decimals);
  const date = (value: string | null) => documentDate(value, data.locale);
  await layout.header({
    label: "Change request", reference: data.reference, facts: [["Date", date(data.issuedOn)], ["Currency", data.currency]], title: data.title,
    party: { label: "Prepared for", name: data.clientName, lines: [data.project] },
  });
  if (data.description) { layout.paragraph(data.description, { size: 9.5 }); layout.gap(4); }
  layout.table([
    { key: "item", header: "Item" }, { key: "quantity", header: "Qty", width: 70, align: "end" },
    { key: "rate", header: `Rate (${data.currency})`, width: 92, align: "end" }, { key: "amount", header: `Amount (${data.currency})`, width: 96, align: "end" },
  ], data.lines.map((line) => ({
    cells: {
      item: `${ACTION[line.action] ?? line.action}: ${line.title}`, quantity: quantityText(line.quantity, line.unit),
      rate: line.unitPrice ? amountText(line.unitPrice, data.decimals) : "", amount: amountText(line.amount, data.decimals),
    },
    note: line.room ?? undefined,
  })));
  const handover = data.timeImpactDays
    ? `${date(data.handoverBefore) || "—"} to ${date(data.handoverAfter) || "—"} (${data.timeImpactDays > 0 ? "+" : ""}${data.timeImpactDays} working days)`
    : data.handoverBefore ? `${date(data.handoverBefore)} (unchanged)` : "No change";
  layout.totals([{ label: "Price impact", value: money(data.priceImpact), emphasis: true }]);
  layout.facts([["Handover", handover]], 90);
  if (data.designImpact) { layout.section("Design"); layout.paragraph(data.designImpact, { size: 9.5 }); }
  layout.gap(6);
  layout.paragraph("Signing approves this change at the price and handover date above. The signed copy and its certificate are kept with your project.", { size: 8.5, color: MUTED });
  layout.section("Acceptance", 84);
  layout.signatures([{ label: "For the client", name: data.clientName }, { label: `For ${data.letterhead?.name ?? data.brandName}` }]);
  return { bytes: await layout.save(), outline: layout.outline() };
}
