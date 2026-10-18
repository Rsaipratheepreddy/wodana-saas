import type { Db } from "../ledger/ledger";
import { readTemplate } from "../ledger/templates";
import { money, units, ZERO } from "./report-math";
import type { BooksReportQuery, ReportEntity, VatBox, VatBoxColumn, VatBoxLine, VatReport, VatReviewItem } from "./report-types";

/**
 * The tax return, laid out by the company's chart template (`taxReport`, e.g. the UAE VAT 201) and filled from the
 * period's journal lines that carry a tax code:
 *   - a line on the account playing `vat_output` or `vat_input` is tax: its amount is the tax and its `tax_base` the
 *     base, in the code's tax box (by the line's region when the layout splits the box by region); reverse charge and
 *     imports on the output side go to the code's output box;
 *   - a line on any other account with a code that charges no tax (zero rated, exempt) is a base in the code's base box;
 *   - VAT on advances (`vat_advance_contra`) is a contra, never counted, so tax on an advance counts once.
 * Boxes worked out from others follow the layout's formulas: sum, vat_of (tax and adjustments) and difference.
 * Corrections are reversals, so they reduce the box they first fed.
 */

type LayoutSource = "entered" | { taxBox?: string; region?: string; baseBox?: string; rcOutputBox?: string };
type LayoutBox = {
  box: string; label: string; section: "sales" | "purchases" | "net"; columns: VatBoxColumn[];
  from?: LayoutSource; formula?: { op: "sum" | "vat_of" | "difference"; boxes: string[] };
};
export type TaxReportLayout = {
  code: string; name: string; regionLabel?: string | null;
  regions?: Array<{ code: string; name: string; box: string }>;
  boxes: LayoutBox[];
};

type Contribution = { kind: "taxBox" | "baseBox" | "rcOutputBox"; box: string; region: string | null; amount: bigint; vat: bigint; line: TaxLine };

type TaxLine = {
  lineId: string; debit: string; credit: string; taxBase: string | null; taxRegion: string | null; partyType: string | null; partyId: string | null;
  taxCode: string; treatment: string; direction: "sales" | "purchases"; baseBox: string | null; taxBox: string | null; rcOutputBox: string | null;
  accountId: string; accountCode: string; accountName: string; vatRole: "vat_output" | "vat_input" | "vat_advance_contra" | null;
  journalId: string; journalNumber: string; journalDate: string; sourceType: string; sourceEvent: string; sourceLabel: string; sourceHref: string;
};

const ZERO_TREATMENTS = ["zero", "exempt", "out_of_scope"];
const REVERSE_CHARGE = ["reverse_charge", "import_reverse_charge"];

export async function readTaxLayout(db: Db, entity: Pick<ReportEntity, "templateCode" | "templateVersion">): Promise<TaxReportLayout | null> {
  if (!entity.templateCode) return null;
  const template = await readTemplate(db, entity.templateCode, entity.templateVersion ?? undefined);
  const layout = template?.taxReport as TaxReportLayout | null | undefined;
  return layout && Array.isArray(layout.boxes) && layout.boxes.length ? layout : null;
}

async function taxLines(db: Db, workspaceId: string, scope: BooksReportQuery): Promise<TaxLine[]> {
  return (await db.query<TaxLine>(
    `SELECT line.id AS "lineId", line.debit::text AS debit, line.credit::text AS credit, line.tax_base::text AS "taxBase", line.tax_region AS "taxRegion",
            line.party_type AS "partyType", line.party_id AS "partyId",
            tax.code AS "taxCode", tax.treatment, tax.direction, tax.base_box AS "baseBox", tax.tax_box AS "taxBox", tax.rc_output_box AS "rcOutputBox",
            account.id AS "accountId", account.code AS "accountCode", account.name AS "accountName",
            (SELECT mapping.role FROM books_account_roles mapping
              WHERE mapping.workspace_id = line.workspace_id AND mapping.legal_entity_id = line.legal_entity_id AND mapping.account_id = line.account_id
                AND mapping.role IN ('vat_output', 'vat_input', 'vat_advance_contra')
              ORDER BY mapping.role DESC LIMIT 1) AS "vatRole",
            journal.id AS "journalId", journal.number AS "journalNumber", journal.journal_date::text AS "journalDate", journal.source_type AS "sourceType",
            journal.source_event AS "sourceEvent", journal.source_label AS "sourceLabel", journal.source_href AS "sourceHref"
       FROM books_journal_lines line
       JOIN books_journals journal ON journal.workspace_id = line.workspace_id AND journal.id = line.journal_id
       JOIN books_tax_codes tax ON tax.workspace_id = line.workspace_id AND tax.legal_entity_id = line.legal_entity_id AND tax.id = line.tax_code_id
       JOIN books_accounts account ON account.workspace_id = line.workspace_id AND account.legal_entity_id = line.legal_entity_id AND account.id = line.account_id
      WHERE line.workspace_id = $1 AND line.legal_entity_id = $2 AND journal.journal_date BETWEEN $3::date AND $4::date
      ORDER BY journal.journal_date, journal.number, line.position`,
    [workspaceId, scope.legalEntityId, scope.from, scope.to])).rows;
}

/** The amount on its normal side (credit for output tax and sales, debit for input tax and purchases), signed. */
function signed(line: TaxLine, normal: "debit" | "credit") {
  const value = units(line.debit) - units(line.credit);
  return normal === "debit" ? value : -value;
}

/** The base, signed like the line (a reversal or credit note reduces the box). */
function signedBase(line: TaxLine, normal: "debit" | "credit") {
  const side = signed(line, normal);
  const base = line.taxBase !== null ? units(line.taxBase) : side < 0n ? -side : side;
  return side < 0n ? -base : base;
}

/** What each line feeds; lines the layout can't place go to the review list. */
export function contributions(lines: readonly TaxLine[], layout: TaxReportLayout, defaultRegion: string | null) {
  const regionBoxes = new Set(layout.boxes.flatMap((box) => (typeof box.from === "object" && box.from.taxBox && box.from.region ? [box.from.taxBox] : [])));
  const regions = new Map((layout.regions ?? []).map((region) => [region.code.toUpperCase(), region.code]));
  const out: Contribution[] = [];
  const unplaced: TaxLine[] = [];
  const regionOf = (line: TaxLine) => {
    const wanted = (line.taxRegion ?? defaultRegion ?? "").toUpperCase();
    return regions.get(wanted) ?? null;
  };
  for (const line of lines) {
    if (line.vatRole === "vat_advance_contra") continue;
    if (line.vatRole === "vat_output" || line.vatRole === "vat_input") {
      const normal = line.vatRole === "vat_output" ? "credit" : "debit";
      const vat = signed(line, normal), base = signedBase(line, normal);
      if (line.vatRole === "vat_output" && REVERSE_CHARGE.includes(line.treatment)) {
        if (line.rcOutputBox) out.push({ kind: "rcOutputBox", box: line.rcOutputBox, region: null, amount: base, vat, line });
        continue;
      }
      if (!line.taxBox) continue;
      let region: string | null = null;
      if (regionBoxes.has(line.taxBox)) {
        region = regionOf(line);
        if (!region) unplaced.push(line);
      }
      const splitBase = Boolean(line.baseBox && line.baseBox !== line.taxBox);
      out.push({ kind: "taxBox", box: line.taxBox, region, amount: splitBase ? 0n : base, vat, line });
      if (splitBase) out.push({ kind: "baseBox", box: line.baseBox!, region: null, amount: base, vat: 0n, line });
      continue;
    }
    // A base on an income or cost account: only codes that charge no tax place it (taxed bases come with their tax line).
    if (!line.taxBox && line.baseBox) {
      const normal = line.direction === "sales" ? "credit" : "debit";
      out.push({ kind: "baseBox", box: line.baseBox, region: null, amount: signedBase(line, normal), vat: 0n, line });
    }
  }
  return { contributions: out, unplaced };
}

function matches(box: LayoutBox, item: Contribution) {
  if (typeof box.from !== "object") return false;
  const from = box.from;
  if (from.taxBox) return item.kind === "taxBox" && item.box === from.taxBox && (!from.region || item.region === from.region);
  if (from.baseBox) return item.kind === "baseBox" && item.box === from.baseBox;
  if (from.rcOutputBox) return item.kind === "rcOutputBox" && item.box === from.rcOutputBox;
  return false;
}

/** The layout's boxes filled from the contributions, formulas worked out in dependency order. */
export function fillBoxes(layout: TaxReportLayout, items: readonly Contribution[]): VatBox[] {
  const byBox = new Map(layout.boxes.map((box) => [box.box, box]));
  const values = new Map<string, Record<VatBoxColumn, bigint | null>>();
  const has = (box: LayoutBox, column: VatBoxColumn) => box.columns.includes(column);
  const resolve = (code: string, seen: Set<string>): Record<VatBoxColumn, bigint | null> => {
    const known = values.get(code);
    if (known) return known;
    const box = byBox.get(code);
    if (!box || seen.has(code)) return { amount: 0n, vat: 0n, adjustment: 0n };
    seen.add(code);
    const cell = (column: VatBoxColumn, value: bigint) => (has(box, column) ? value : null);
    let result: Record<VatBoxColumn, bigint | null>;
    if (box.formula) {
      const inputs = box.formula.boxes.map((input) => resolve(input, seen));
      const sumOf = (column: VatBoxColumn) => inputs.reduce((sum, input) => sum + (input[column] ?? 0n), 0n);
      if (box.formula.op === "vat_of") {
        result = { amount: cell("amount", 0n), vat: cell("vat", sumOf("vat") + sumOf("adjustment")), adjustment: cell("adjustment", 0n) };
      } else if (box.formula.op === "difference") {
        const [first, ...rest] = inputs;
        const diff = (column: VatBoxColumn) => (first?.[column] ?? 0n) - rest.reduce((sum, input) => sum + (input[column] ?? 0n), 0n);
        result = { amount: cell("amount", diff("amount")), vat: cell("vat", diff("vat")), adjustment: cell("adjustment", diff("adjustment")) };
      } else {
        result = { amount: cell("amount", sumOf("amount")), vat: cell("vat", sumOf("vat")), adjustment: cell("adjustment", sumOf("adjustment")) };
      }
    } else {
      const feeding = items.filter((item) => matches(box, item));
      result = {
        amount: cell("amount", feeding.reduce((sum, item) => sum + item.amount, 0n)),
        vat: cell("vat", feeding.reduce((sum, item) => sum + item.vat, 0n)),
        adjustment: cell("adjustment", 0n),
      };
    }
    values.set(code, result);
    return result;
  };
  return layout.boxes.map((box) => {
    const value = resolve(box.box, new Set());
    const text = (column: VatBoxColumn) => (value[column] === null ? null : money(value[column]!));
    return { box: box.box, label: box.label, section: box.section, amount: text("amount"), vat: text("vat"), adjustment: text("adjustment"), computed: Boolean(box.formula) };
  });
}

type ForeignBill = { journalId: string; journalNumber: string; journalDate: string; sourceLabel: string; sourceHref: string; partyName: string; total: string };

/** Supplier bills from suppliers based abroad that carry no reverse charge: usually a missed RC code. */
async function foreignBillsWithoutReverseCharge(db: Db, workspaceId: string, scope: BooksReportQuery): Promise<ForeignBill[]> {
  return (await db.query<ForeignBill>(
    `SELECT DISTINCT ON (journal.id) journal.id AS "journalId", journal.number AS "journalNumber", journal.journal_date::text AS "journalDate",
            journal.source_label AS "sourceLabel", journal.source_href AS "sourceHref", vendor.display_name AS "partyName", journal.total::text AS total
       FROM books_journals journal
       JOIN legal_entities entity ON entity.workspace_id = journal.workspace_id AND entity.id = journal.legal_entity_id
       JOIN books_journal_lines line ON line.workspace_id = journal.workspace_id AND line.journal_id = journal.id AND line.party_type = 'vendor'
       JOIN workspace_vendors vendor ON vendor.workspace_id = line.workspace_id AND vendor.id = line.party_id
      WHERE journal.workspace_id = $1 AND journal.legal_entity_id = $2 AND journal.journal_date BETWEEN $3::date AND $4::date
        AND journal.source_type = 'supplier_bill' AND journal.kind = 'auto'
        AND EXISTS (SELECT 1 FROM workspace_vendor_sites site WHERE site.workspace_id = vendor.workspace_id AND site.vendor_id = vendor.id
                     AND site.is_primary AND site.status = 'active' AND site.country_code IS NOT NULL AND site.country_code <> entity.country_code)
        AND NOT EXISTS (SELECT 1 FROM books_journal_lines rc
                          JOIN books_tax_codes tax ON tax.workspace_id = rc.workspace_id AND tax.legal_entity_id = rc.legal_entity_id AND tax.id = rc.tax_code_id
                         WHERE rc.workspace_id = journal.workspace_id AND rc.journal_id = journal.id AND tax.treatment IN ('reverse_charge', 'import_reverse_charge'))
      ORDER BY journal.id`, [workspaceId, scope.legalEntityId, scope.from, scope.to])).rows;
}

function reviewItem(reason: VatReviewItem["reason"], line: TaxLine, amount: bigint): VatReviewItem {
  return {
    reason, journalId: line.journalId, journalNumber: line.journalNumber, journalDate: line.journalDate, accountCode: line.accountCode, accountName: line.accountName,
    taxCode: line.taxCode, partyName: null, amount: money(amount), sourceLabel: line.sourceLabel, sourceHref: line.sourceHref,
  };
}

/** The tax report for a company and period, its review list, and the lines behind one box when `box` is given. */
export async function readVatReport(db: Db, workspaceId: string, entity: ReportEntity, scope: BooksReportQuery, options: { box?: string | null } = {}): Promise<VatReport> {
  const base = { report: "vat" as const, scope, entity, generatedAt: new Date().toISOString() };
  const layout = await readTaxLayout(db, entity);
  if (!layout) return { ...base, layout: null, boxes: [], review: [], lines: options.box ? [] : null };
  const settings = (await db.query<{ vatRegion: string | null }>(`SELECT vat_region AS "vatRegion" FROM books_settings WHERE workspace_id = $1 AND legal_entity_id = $2`,
    [workspaceId, scope.legalEntityId])).rows[0];
  const lines = await taxLines(db, workspaceId, scope);
  const { contributions: items, unplaced } = contributions(lines, layout, settings?.vatRegion ?? null);
  const boxes = fillBoxes(layout, items);

  const review: VatReviewItem[] = [];
  for (const line of lines) {
    if (line.vatRole === null && ZERO_TREATMENTS.includes(line.treatment)) review.push(reviewItem("zero_rate", line, signedBase(line, line.direction === "sales" ? "credit" : "debit")));
    if (line.vatRole === "vat_output" && line.sourceType === "receipt" && line.sourceEvent === "verified") review.push(reviewItem("advance_split", line, signed(line, "credit")));
  }
  for (const line of unplaced) review.push(reviewItem("missing_region", line, signed(line, line.vatRole === "vat_input" ? "debit" : "credit")));
  for (const bill of await foreignBillsWithoutReverseCharge(db, workspaceId, scope)) {
    review.push({ reason: "foreign_supplier_without_reverse_charge", journalId: bill.journalId, journalNumber: bill.journalNumber, journalDate: bill.journalDate,
      accountCode: null, accountName: null, taxCode: null, partyName: bill.partyName, amount: bill.total, sourceLabel: bill.sourceLabel, sourceHref: bill.sourceHref });
  }

  let drill: VatBoxLine[] | null = null;
  if (options.box) {
    const box = layout.boxes.find((candidate) => candidate.box === options.box);
    drill = !box || box.formula ? [] : items.filter((item) => matches(box, item)).map((item) => ({
      box: box.box, lineId: item.line.lineId, journalId: item.line.journalId, journalNumber: item.line.journalNumber, journalDate: item.line.journalDate,
      accountId: item.line.accountId, accountCode: item.line.accountCode, accountName: item.line.accountName, taxCode: item.line.taxCode, region: item.region,
      amount: money(item.amount), vat: money(item.vat), sourceLabel: item.line.sourceLabel, sourceHref: item.line.sourceHref,
    }));
  }
  return { ...base, layout: { code: layout.code, name: layout.name, regionLabel: layout.regionLabel ?? null }, boxes, review, lines: drill };
}

/** The tax payable on the return (the last box worked out as a difference), or null without a tax layout. */
export function payableOf(report: VatReport): string | null {
  if (!report.layout) return null;
  const payable = [...report.boxes].reverse().find((box) => box.computed && box.section === "net" && box.vat !== null);
  return payable?.vat ?? ZERO;
}

/** How many tax lines the return left out of its regional boxes for want of a region, with the region's name; null when none. */
export function missingRegion(report: VatReport) {
  const lines = report.review.filter((item) => item.reason === "missing_region").length;
  return lines && report.layout ? { lines, label: report.layout.regionLabel } : null;
}
