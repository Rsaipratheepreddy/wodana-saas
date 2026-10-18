import { PDFDocument, PageSizes, rgb, type PDFPage, type RGB } from "pdf-lib";
import { drawLetterheadTop, type PdfLetterhead } from "../proposals/pdf-letterhead";
import { PdfText, cleanText, type TextLine, type TextWeight } from "../proposals/pdf-text";

/**
 * The one document theme for every PDF the server makes for a client or a supplier (quotation, change request,
 * signature certificate…): an A4 page with the issuing business's letterhead (else the brand's name in its accent),
 * the document's name, number and dates at the inline end, the party it is for, tables that never split a row and
 * repeat their header on every page, a totals block, signature boxes, and on every page the business's footer text,
 * "Page x of y" and a small "Powered by Wodana". Labels are passed in by each document; the layout only places them.
 */
export const A4 = PageSizes.A4 as [number, number];
export const INK = rgb(0.13, 0.14, 0.16), MUTED = rgb(0.42, 0.44, 0.48), FAINT = rgb(0.58, 0.6, 0.64), RULE = rgb(0.86, 0.87, 0.89), SHADE = rgb(0.96, 0.965, 0.97);
const INLINE = 48, TOP = 48, FOOTER_BASE = 22, FOOTER_LINE = 9;
const POWERED_BY = "Powered by Wodana";

/** A brand accent ("#1F6FEB") as a PDF colour; ink when it isn't a six-digit hex. */
export function accentColor(hex: string | null | undefined): RGB {
  const match = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match) return INK;
  const value = Number.parseInt(match[1], 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/** An exact decimal string as money: the ISO code, grouped thousands and exactly the currency's decimals (never floats). */
export function moneyText(amount: string, currency: string, decimals: number) {
  const negative = amount.trim().startsWith("-");
  const [whole, fraction = ""] = amount.trim().replace(/^[-+]/, "").split(".");
  const grouped = (whole.replace(/^0+(?=\d)/, "") || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const digits = decimals > 0 ? `.${fraction.padEnd(decimals, "0").slice(0, decimals)}` : "";
  return `${negative ? "-" : ""}${currency} ${grouped}${digits}`;
}

/** An exact decimal string as an amount in a table whose currency the document states once: "7,770.00". */
export function amountText(amount: string, decimals: number) {
  return moneyText(amount, "", decimals).replace(/^(-?) /, "$1");
}

/** A quantity without trailing zeros ("2.50" → "2.5", "3.000" → "3"), with its unit. */
export function quantityText(quantity: string | null | undefined, unit?: string | null) {
  if (quantity === null || quantity === undefined || quantity === "") return "";
  const trimmed = quantity.includes(".") ? quantity.replace(/\.?0+$/, "") : quantity;
  return `${trimmed} ${unit ?? ""}`.trim();
}

/**
 * A calendar date (YYYY-MM-DD) or a moment as the workspace's locale writes it ("12 Oct 2026"), with Latin digits so
 * dates read like the amounts beside them. A moment is taken in the workspace's time zone. Unparseable values pass through.
 */
export function documentDate(value: string | null | undefined, locale?: string | null, timeZone?: string | null) {
  if (!value) return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const moment = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(moment.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", timeZone: dateOnly ? "UTC" : timeZone || "UTC" };
  for (const tag of [locale ? `${locale}-u-nu-latn` : null, locale, "en-GB"]) {
    if (!tag) continue;
    try { return new Intl.DateTimeFormat(tag, options).format(moment); } catch { /* the next locale */ }
  }
  return value;
}

/** A document's download name: "Q-0012 Client name.pdf", without characters a file system refuses. */
export function documentFileName(...parts: Array<string | null | undefined>) {
  const name = cleanText(parts.map((part) => part?.trim()).filter(Boolean).join(" ")).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return `${(name || "Document").slice(0, 196)}.pdf`;
}

export type LayoutSetup = {
  /** The PDF's own title (what a viewer shows in its title bar). */
  title: string;
  brand: { name: string; accent: string | null };
  /** The issuing business's letterhead (PLM-112); without one the brand's name heads the first page. */
  letterhead?: PdfLetterhead | null;
  /** What continuation pages print at their top: "Q-0012 · Kitchen". */
  running?: string;
};

export type Column = { key: string; header: string; /** Fixed width in points; one column without a width takes the rest. */ width?: number; align?: "start" | "end" };
export type Row = { cells: Record<string, string>; /** A smaller muted line under the first column (a description, a room). */ note?: string; weight?: TextWeight; muted?: boolean };
export type RowGroup = { title?: string; rows: Row[]; subtotal?: string };
export type TotalRow = { label: string; value: string; emphasis?: boolean; muted?: boolean };
export type Party = { label: string; name: string; lines?: string[] };

/** One positioned line of text, kept per page so a document's render can be asserted (and snapshotted) as text. */
type Traced = { page: number; text: string };

export class PdfLayout {
  readonly width = A4[0] - INLINE * 2;
  readonly start = INLINE;
  readonly end = A4[0] - INLINE;
  readonly accent: RGB;
  page!: PDFPage;
  y = 0;
  private readonly pages: PDFPage[] = [];
  private readonly traced: Traced[] = [];
  private repeat: (() => void) | null = null;
  private readonly bottom: number;

  private constructor(readonly document: PDFDocument, readonly t: PdfText, private readonly setup: LayoutSetup) {
    this.accent = accentColor(setup.brand.accent);
    const footerLines = setup.letterhead?.footer ? Math.min(3, t.lines(setup.letterhead.footer, 7, this.width).length) : 0;
    this.bottom = FOOTER_BASE + 18 + footerLines * FOOTER_LINE + 12;
  }

  /** A new PDF (or more pages on an existing one, e.g. a certificate after a signed document) laid out in the theme. */
  static async create(setup: LayoutSetup, existing?: PDFDocument, weights: TextWeight[] = ["regular", "bold"]) {
    const document = existing ?? await PDFDocument.create();
    if (!existing) {
      document.setTitle(cleanText(setup.title));
      document.setAuthor(cleanText(setup.letterhead?.name ?? setup.brand.name));
      document.setCreator(cleanText(setup.brand.name));
      document.setProducer(POWERED_BY);
    }
    const layout = new PdfLayout(document, await PdfText.embed(document, weights), setup);
    layout.addPage(true);
    return layout;
  }

  /** Every text the layout drew, page by page ("--- page 2" between pages): the document's render as plain text. */
  outline() {
    const pages = new Map<number, string[]>();
    for (const item of this.traced) pages.set(item.page, [...(pages.get(item.page) ?? []), item.text]);
    return [...pages.entries()].sort(([a], [b]) => a - b).map(([page, lines]) => `--- page ${page}\n${lines.join("\n")}`).join("\n");
  }

  private pageNumber() { return this.pages.indexOf(this.page) + 1; }

  /** Draws one line (a string is laid out first) and records it. `align: "end"` ends at x; with `box`, RTL text aligns to the box's end. */
  draw(value: string | TextLine, x: number, y: number, options: { size?: number; weight?: TextWeight; color?: RGB; align?: "start" | "end"; box?: number } = {}) {
    const line = typeof value === "string" ? this.t.layout(value, options.size ?? 9, options.weight ?? "regular") : value;
    if (!line.text) return line;
    this.traced.push({ page: this.pageNumber(), text: line.text });
    return this.t.draw(this.page, line, { x, y, color: options.color ?? INK, align: options.align, width: options.box });
  }

  /** Starts a new page; continuation pages carry the running title, then whatever must repeat (a table's header). */
  addPage(first = false) {
    this.page = this.document.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - TOP;
    if (first) return;
    const name = this.setup.letterhead?.name ?? this.setup.brand.name;
    this.draw(name, this.start, this.y, { size: 8, weight: "bold", color: this.accent, box: this.width / 2 });
    if (this.setup.running) this.draw(this.t.lines(this.setup.running, 8, this.width / 2)[0], this.end, this.y, { size: 8, color: MUTED, align: "end" });
    this.y -= 8;
    this.page.drawLine({ start: { x: this.start, y: this.y }, end: { x: this.end, y: this.y }, thickness: 0.5, color: RULE });
    this.y -= 18;
    this.repeat?.();
  }

  /** Keeps the next `height` points on one page: breaks first when they wouldn't fit. */
  room(height: number) {
    if (this.y - height < this.bottom) this.addPage();
  }

  /** Vertical space. */
  gap(points: number) { this.y -= points; }

  /**
   * The document's head: the letterhead (or brand) at the start; at the end the document's name, its number and its
   * facts ("Date 12 Oct 2026"); then the party it is for and an accent rule.
   */
  async header(head: { label: string; reference?: string; facts?: Array<[string, string]>; title?: string; party?: Party; aside?: Party }) {
    let top = this.y;
    let startY = top;
    const letterhead = this.setup.letterhead;
    // A letterhead banner spans the page; the party then sits at the start of the band beside the document's name.
    let party = head.party;
    const half = (this.width - 24) / 2;
    if (letterhead) this.traced.push({ page: this.pageNumber(), text: letterhead.name }, ...letterhead.lines.map((text) => ({ page: this.pageNumber(), text })));
    if (letterhead?.header) {
      top = await drawLetterheadTop(this.document, this.page, this.t, letterhead, { x: this.start, y: top, width: this.width, accent: this.accent }) - 6;
      startY = party ? this.partyBlock(party, this.start, top - 2, half) : top;
      party = undefined;
    } else if (letterhead) startY = await drawLetterheadTop(this.document, this.page, this.t, letterhead, { x: this.start, y: top, width: this.width * 0.55, accent: this.accent });
    else { this.draw(this.setup.brand.name, this.start, top, { size: 15, weight: "bold", color: this.accent, box: this.width * 0.55 }); startY = top - 18; }
    let endY = top;
    this.draw(head.label.toUpperCase(), this.end, endY, { size: 16, weight: "bold", align: "end" });
    endY -= 18;
    if (head.reference) { this.draw(head.reference, this.end, endY, { size: 10, weight: "bold", align: "end" }); endY -= 14; }
    for (const [label, value] of head.facts ?? []) {
      if (!value) continue;
      const valueLine = this.draw(value, this.end, endY, { size: 9, align: "end" });
      this.draw(label, this.end - valueLine.width - 6, endY, { size: 9, color: MUTED, align: "end" });
      endY -= 13;
    }
    this.y = Math.min(startY, endY) - 8;
    if (head.title) {
      for (const line of this.t.lines(head.title, 13, this.width, "bold")) { this.draw(line, this.start, this.y, { color: INK, box: this.width }); this.y -= 17; }
    }
    if (party || head.aside) {
      this.y -= 2;
      const blockTop = this.y;
      const first = party ? this.partyBlock(party, this.start, blockTop, half) : blockTop;
      const second = head.aside ? this.partyBlock(head.aside, this.start + half + 24, blockTop, half) : blockTop;
      this.y = Math.min(first, second) - 2;
    }
    this.y -= 4;
    this.page.drawLine({ start: { x: this.start, y: this.y }, end: { x: this.end, y: this.y }, thickness: 1, color: this.accent });
    this.y -= 20;
  }

  /** A party (who the document is for, or from): a small label, the name, then its address and number lines. */
  private partyBlock(party: Party, x: number, top: number, width: number) {
    let y = top;
    this.draw(party.label.toUpperCase(), x, y, { size: 7, weight: "bold", color: MUTED, box: width });
    y -= 13;
    const name = this.t.lines(party.name || "—", 10, width, "bold");
    const details = (party.lines ?? []).filter(Boolean).flatMap((text) => this.t.lines(text, 8.5, width));
    // Right-to-left lines align to the block's own widest line, so the block stays where a left-to-right one starts.
    const hug = Math.max(...name.map((line) => line.width), ...details.map((line) => line.width));
    for (const line of name) { this.draw(line, x, y, { box: hug }); y -= 13; }
    for (const line of details) { this.draw(line, x, y, { color: MUTED, box: hug }); y -= 11; }
    return y;
  }

  /** A section's title, kept with at least `keep` points of what follows. */
  section(title: string, keep = 40) {
    this.room(26 + keep);
    this.y -= 8;
    this.draw(title, this.start, this.y, { size: 10.5, weight: "bold", box: this.width });
    this.y -= 16;
  }

  /** A wrapped paragraph across the full width; it continues on the next page line by line. */
  paragraph(value: string, options: { size?: number; color?: RGB; weight?: TextWeight } = {}) {
    const size = options.size ?? 9;
    for (const block of value.split(/\n+/)) {
      if (!block.trim()) continue;
      for (const line of this.t.lines(block, size, this.width, options.weight)) {
        this.room(size + 4);
        this.draw(line, this.start, this.y, { color: options.color ?? INK, box: this.width });
        this.y -= size + 4;
      }
      this.y -= 3;
    }
  }

  /** Label → value pairs, the label in a fixed column (facts, the certificate's evidence). */
  facts(rows: Array<[string, string]>, labelWidth = 130) {
    const width = this.width - labelWidth;
    for (const [label, value] of rows) {
      const lines = this.t.lines(value || "—", 9.5, width);
      this.room(lines.length * 13 + 5);
      this.draw(label, this.start, this.y, { size: 8.5, weight: "bold", color: MUTED, box: labelWidth - 8 });
      lines.forEach((line, index) => this.draw(line, this.start + labelWidth, this.y - index * 13, { box: width }));
      this.y -= lines.length * 13 + 5;
    }
  }

  /**
   * A table: a shaded header row (repeated at the top of every page it continues on), rows that never split across
   * pages, long text wrapped in its column, amounts at the inline end with tabular digits, and optional groups with a
   * title (kept with their first row) and a subtotal.
   */
  table(columns: Column[], body: Row[] | RowGroup[]) {
    const fixed = columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
    const flexible = columns.filter((column) => column.width === undefined).length || 1;
    const widths = columns.map((column) => column.width ?? (this.width - fixed) / flexible);
    const xs = widths.map((_, index) => this.start + widths.slice(0, index).reduce((sum, width) => sum + width, 0));
    const PAD = 5, LINE = 11.5;
    const header = () => {
      this.page.drawRectangle({ x: this.start, y: this.y - 6, width: this.width, height: 19, color: SHADE });
      columns.forEach((column, index) => {
        if (column.align === "end") this.draw(column.header, xs[index] + widths[index] - PAD, this.y, { size: 7.5, weight: "bold", color: MUTED, align: "end" });
        else this.draw(column.header, xs[index] + PAD, this.y, { size: 7.5, weight: "bold", color: MUTED, box: widths[index] - PAD * 2 });
      });
      this.y -= 22;
    };
    const measure = (row: Row) => {
      const cells = columns.map((column, index) => {
        const weight = row.weight ?? (column.align === "end" && column.key === columns.at(-1)?.key ? "bold" : "regular");
        const value = row.cells[column.key] ?? "";
        // Amounts and quantities never wrap: one line, ending at the column's end.
        if (column.align === "end") return value ? [this.t.layout(value, 9, weight)] : [];
        return this.t.lines(value, 9, widths[index] - PAD * 2, weight);
      });
      const note = row.note ? this.t.lines(row.note, 7.5, widths[0] - PAD * 2) : [];
      const lines = Math.max(1, ...cells.map((cell) => cell.length));
      return { cells, note, height: lines * LINE + note.length * 10 + 8 };
    };
    const drawRow = (row: Row) => {
      const shaped = measure(row);
      this.room(shaped.height);
      const top = this.y;
      columns.forEach((column, index) => shaped.cells[index].forEach((line, lineIndex) => {
        const color = row.muted ? MUTED : INK;
        if (column.align === "end") this.draw(line, xs[index] + widths[index] - PAD, top - lineIndex * LINE, { color, align: "end" });
        else this.draw(line, xs[index] + PAD, top - lineIndex * LINE, { color, box: widths[index] - PAD * 2 });
      }));
      const firstLines = shaped.cells[0].length;
      shaped.note.forEach((line, index) => this.draw(line, xs[0] + PAD, top - firstLines * LINE - index * 10 + 1, { color: MUTED, box: widths[0] - PAD * 2 }));
      this.y = top - shaped.height + 8;
      this.page.drawLine({ start: { x: this.start, y: this.y + 1 }, end: { x: this.end, y: this.y + 1 }, thickness: 0.5, color: RULE });
      this.y -= 11;
    };
    const groups: RowGroup[] = body.length && "rows" in body[0] ? body as RowGroup[] : [{ rows: body as Row[] }];
    this.room(22 + (groups[0]?.rows[0] ? measure(groups[0].rows[0]).height : 0) + (groups[0]?.title ? 18 : 0));
    header();
    this.repeat = header;
    for (const group of groups) {
      if (!group.rows.length) continue;
      if (group.title) {
        this.room(18 + measure(group.rows[0]).height);
        this.draw(group.title, this.start + PAD, this.y, { size: 9.5, weight: "bold", box: this.width - PAD * 2 });
        this.y -= 16;
      }
      group.rows.forEach(drawRow);
      if (group.subtotal) {
        this.room(16);
        this.draw(group.subtotal, this.end - PAD, this.y, { size: 9, weight: "bold", align: "end" });
        this.y -= 18;
      }
    }
    this.repeat = null;
    this.y -= 4;
  }

  /** The totals block at the inline end, kept on one page; the emphasised row (the total) under an accent rule. */
  totals(rows: TotalRow[]) {
    const height = rows.reduce((sum, row) => sum + (row.emphasis ? 24 : 15), 0) + 6;
    this.room(height);
    const labelEnd = this.end - 130;
    for (const row of rows) {
      if (row.emphasis) {
        this.y -= 3;
        this.page.drawLine({ start: { x: this.end - 240, y: this.y + 13 }, end: { x: this.end, y: this.y + 13 }, thickness: 1, color: this.accent });
      }
      const size = row.emphasis ? 11 : 9;
      this.draw(row.label, labelEnd, this.y, { size, weight: row.emphasis ? "bold" : "regular", color: row.emphasis ? INK : MUTED, align: "end" });
      this.draw(row.value, this.end - 5, this.y, { size, weight: row.emphasis ? "bold" : "regular", color: row.muted ? MUTED : INK, align: "end" });
      this.y -= row.emphasis ? 21 : 15;
    }
    this.y -= 6;
  }

  /** Signature boxes side by side (for whoever signs on paper), kept together. */
  signatures(boxes: Array<{ label: string; name?: string }>) {
    this.room(84);
    const gap = 24;
    const width = (this.width - gap * (boxes.length - 1)) / Math.max(1, boxes.length);
    const lineY = this.y - 46;
    boxes.forEach((box, index) => {
      const x = this.start + index * (width + gap);
      this.page.drawLine({ start: { x, y: lineY }, end: { x: x + width, y: lineY }, thickness: 0.7, color: MUTED });
      this.draw(box.label, x, lineY - 12, { size: 8, weight: "bold", color: MUTED, box: width });
      if (box.name) this.draw(box.name, x, lineY - 24, { size: 8.5, box: width });
    });
    this.y = lineY - 36;
  }

  /**
   * Stamps every page this layout drew: the letterhead's footer text, then a rule with "Powered by Wodana" at the start
   * and "Page x of y" at the end (counted over the whole PDF, so designed pages around the generated ones count too).
   * `numbered: false` leaves the page count off (a certificate appended to an already numbered document).
   */
  finish(options: { numbered?: boolean; pageLabel?: (page: number, total: number) => string } = {}) {
    const total = this.document.getPageCount();
    const all = this.document.getPages();
    const label = options.pageLabel ?? ((page: number, count: number) => `Page ${page} of ${count}`);
    for (const page of this.pages) {
      this.page = page;
      const footer = this.setup.letterhead?.footer ? this.t.lines(this.setup.letterhead.footer, 7, this.width).slice(0, 3) : [];
      footer.forEach((line, index) => {
        const y = FOOTER_BASE + 16 + (footer.length - 1 - index) * FOOTER_LINE;
        this.draw(line, this.start + (this.width - line.width) / 2, y, { color: MUTED });
      });
      page.drawLine({ start: { x: this.start, y: FOOTER_BASE + 10 }, end: { x: this.end, y: FOOTER_BASE + 10 }, thickness: 0.4, color: RULE });
      this.draw(POWERED_BY, this.start, FOOTER_BASE, { size: 6.5, color: FAINT });
      if (options.numbered !== false) this.draw(label(all.indexOf(page) + 1, total), this.end, FOOTER_BASE, { size: 7.5, color: MUTED, align: "end" });
    }
  }

  async save(options?: Parameters<PdfLayout["finish"]>[0]) {
    this.finish(options);
    return this.document.save();
  }
}
