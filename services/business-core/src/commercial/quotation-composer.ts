import { BadRequestException, ConflictException } from "@nestjs/common";
import { canonicalHash, normalizeName } from "../crm/shared/crm-types";
import { totals } from "./commercial.domain";
import type {
  CatalogSelection,
  Quote,
  QuoteLine,
} from "./commercial.types";

export type QuotationProposalMode = "scope" | "assistant";
export type QuotationProposalItemStatus =
  | "ready"
  | "price_required"
  | "catalog_required";

export type QuotationProposalItem = {
  id: string;
  roomId: string;
  roomName: string;
  roomCatalog?: CatalogSelection;
  line: QuoteLine;
  sourceIds: string[];
  reason: string;
  status: QuotationProposalItemStatus;
  issue?: string;
};

export type QuotationProposal = {
  schemaVersion: 1;
  mode: QuotationProposalMode;
  summary: string;
  intent: string;
  items: QuotationProposalItem[];
  coverage: {
    includedSourceIds: string[];
    linkedSourceIds: string[];
    unlinkedSourceIds: string[];
  };
  notes: string[];
};

export type QuotationComposerIssue = {
  code: string;
  severity: "blocker" | "warning";
  message: string;
  lineId?: string;
};

export type QuotationScopeItem = {
  id: string;
  title: string;
  roomName?: string | null;
};

export type QuotationScopeCoverage = {
  included: QuotationScopeItem[];
  covered: QuotationScopeItem[];
  uncovered: QuotationScopeItem[];
};

export function quotationScopeCoverage(
  quote: Quote,
  included: QuotationScopeItem[] = [],
): QuotationScopeCoverage {
  const linked = new Set(quote.lines.flatMap((line) => line.scopeId ? [line.scopeId] : []));
  return {
    included,
    covered: included.filter((item) => linked.has(item.id)),
    uncovered: included.filter((item) => !linked.has(item.id)),
  };
}

export function quoteDraftHash(quote: Quote) {
  return canonicalHash({
    id: quote.id,
    status: quote.status,
    direction: quote.direction,
    title: quote.title,
    cover: quote.cover,
    rooms: quote.rooms,
    inclusions: quote.inclusions,
    currency: quote.currency,
    validUntil: quote.validUntil,
    discount: quote.discount,
    taxRate: quote.taxRate,
    terms: quote.terms,
    exclusions: quote.exclusions,
    lines: quote.lines,
    paymentTerms: quote.paymentTerms,
    paymentTemplate: quote.paymentTemplate,
    requestIds: quote.requestIds,
    designEvidence: quote.designEvidence,
  });
}

function selected(line: QuoteLine, role: string) {
  return line.catalogLinks?.find((link) => link.role === role);
}

/** Identity is intentionally narrow: legitimate custom lines may share a title. */
export function quotationLineIdentity(line: QuoteLine) {
  if (line.scopeId) return `scope:${line.scopeId}`;
  const work = selected(line, "work");
  if (!work) return null;
  return [
    "catalog",
    normalizeName(line.room),
    work.recordId,
    selected(line, "variant")?.recordId ?? "",
  ].join(":");
}

/** A scope-linked line also carries a catalog identity, so AI cannot add it twice. */
export function quotationLineIdentities(line: QuoteLine) {
  const identities: string[] = [];
  if (line.scopeId) identities.push(`scope:${line.scopeId}`);
  const work = selected(line, "work");
  if (work)
    identities.push(
      [
        "catalog",
        normalizeName(line.room),
        work.recordId,
        selected(line, "variant")?.recordId ?? "",
      ].join(":"),
    );
  return identities;
}

export function mergeQuotationProposal(
  quote: Quote,
  items: QuotationProposalItem[],
  selectedItemIds: string[],
) {
  if (quote.status !== "draft")
    throw new ConflictException("Only a draft quotation can accept a proposal.");
  if (quote.direction === "deduction")
    throw new ConflictException(
      "Build deduction variations from accepted items instead of a generated proposal.",
    );
  if (!selectedItemIds.length)
    throw new BadRequestException("Choose at least one proposed item to add.");
  if (new Set(selectedItemIds).size !== selectedItemIds.length)
    throw new BadRequestException("Choose each proposed item only once.");
  const byId = new Map(items.map((item) => [item.id, item]));
  const selectedItems = selectedItemIds.map((id) => {
    const item = byId.get(id);
    if (!item)
      throw new BadRequestException("A selected proposal item is unavailable.");
    return item;
  });
  const next = structuredClone(quote);
  next.rooms ??= [];
  const identities = new Set(next.lines.flatMap(quotationLineIdentities));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const item of selectedItems) {
    const itemIdentities = quotationLineIdentities(item.line);
    if (itemIdentities.some((identity) => identities.has(identity))) {
      skipped.push(item.id);
      continue;
    }
    let room = next.rooms.find(
      (candidate) =>
        candidate.id === item.roomId ||
        normalizeName(candidate.name) === normalizeName(item.roomName),
    );
    if (!room) {
      if (next.rooms.length >= 100)
        throw new ConflictException("A quotation can contain up to 100 rooms.");
      room = {
        id: item.roomId,
        name: item.roomName,
        ...(item.roomCatalog
          ? { catalog: structuredClone(item.roomCatalog) }
          : {}),
      };
      next.rooms.push(room);
    }
    if (next.lines.length >= 300)
      throw new ConflictException("A quotation can contain up to 300 items.");
    next.lines.push({ ...structuredClone(item.line), room: room.name });
    for (const identity of itemIdentities) identities.add(identity);
    added.push(item.id);
  }
  next.total = totals(next).total;
  return { quote: next, added, skipped };
}

export function quotationComposerReadiness(
  quote: Quote,
  definition: { confirmed: boolean; current: boolean; includedScope?: QuotationScopeItem[] } | null,
  today = new Date().toISOString().slice(0, 10),
) {
  const issues: QuotationComposerIssue[] = [];
  const add = (
    code: string,
    severity: QuotationComposerIssue["severity"],
    message: string,
    lineId?: string,
  ) => issues.push({ code, severity, message, ...(lineId ? { lineId } : {}) });
  if (quote.status !== "draft")
    add("QUOTE_LOCKED", "blocker", "Create or return a version to draft before editing it.");
  if (!quote.lines.length)
    add("ADD_ITEMS", "blocker", "Add at least one quotation item.");
  if (quote.kind === "quotation" && quote.lines.some((line) => line.scopeId)) {
    if (!definition?.confirmed || !definition.current)
      add(
        "CONFIRM_DEFINITION",
        "blocker",
        "Confirm the current requirements and design definition before review.",
      );
  }
  const coverage = quotationScopeCoverage(quote, definition?.includedScope);
  if (definition?.confirmed && definition.current && coverage.uncovered.length)
    add(
      "UNCOVERED_SCOPE",
      "warning",
      `${coverage.uncovered.length} confirmed scope ${coverage.uncovered.length === 1 ? "item is" : "items are"} not included in this quotation.`,
    );
  const identities = new Map<string, string>();
  for (const line of quote.lines) {
    if (line.catalogPrice?.status !== undefined && line.catalogPrice.status !== "resolved")
      add(
        line.catalogPrice.status === "stale" ? "REFRESH_PRICE" : "CONFIRM_PRICE",
        "blocker",
        line.catalogPrice.issue?.message ?? `Confirm a selling price for ${line.title}.`,
        line.id,
      );
    if (line.rate <= 0)
      add("ADD_SELLING_RATE", "blocker", `Add a selling rate for ${line.title}.`, line.id);
    const lineIdentities = quotationLineIdentities(line);
    if (lineIdentities.length) {
      const duplicate = lineIdentities.some((identity) => identities.has(identity));
      if (duplicate)
        add(
          "DUPLICATE_ITEM",
          "blocker",
          `${line.title} is linked more than once. Merge or remove the duplicate.`,
          line.id,
        );
      else for (const identity of lineIdentities) identities.set(identity, line.id);
    }
    if (!line.scopeId && !selected(line, "work"))
      add(
        "CUSTOM_ITEM",
        "warning",
        line.manualReason
          ? `${line.title} is an authorized manual item; verify its specification and rate.`
          : `${line.title} is a legacy manual item without an authorization reason.`,
        line.id,
      );
    if (line.customMaterials?.some((material) => material.suppliedByClient))
      add(
        "CLIENT_SUPPLIED_MATERIAL",
        "warning",
        `${line.title} includes client-supplied material; state responsibility clearly.`,
        line.id,
      );
  }
  const paymentPercent = quote.paymentTerms.reduce(
    (sum, milestone) => sum + milestone.percent,
    0,
  );
  if (quote.direction !== "deduction" && !quote.paymentTerms.length)
    add("ADD_PAYMENT_TERMS", "blocker", "Add the payment schedule.");
  else if (quote.paymentTerms.length && Math.abs(paymentPercent - 100) > 0.001)
    add("FIX_PAYMENT_TERMS", "blocker", "Payment milestones must total 100%.");
  if (quote.validUntil < today)
    add("UPDATE_VALIDITY", "blocker", "Update the quotation validity date.");
  try {
    const financials = totals(quote);
    if (financials.cost > 0 && financials.net < financials.cost)
      add(
        "NEGATIVE_MARGIN",
        "warning",
        "The quotation value does not cover the recorded internal cost. Review it with an authorized commercial owner.",
      );
  } catch (error) {
    add(
      "FIX_TOTALS",
      "blocker",
      error instanceof Error ? error.message : "Check quotation totals.",
    );
  }
  const blockers = issues.filter((issue) => issue.severity === "blocker");
  return {
    readyForReview: blockers.length === 0,
    blockers,
    warnings: issues.filter((issue) => issue.severity === "warning"),
    summary: {
      items: quote.lines.length,
      pricedItems: quote.lines.filter((line) => line.rate > 0).length,
      customItems: quote.lines.filter(
        (line) => !line.scopeId && !selected(line, "work"),
      ).length,
      total: quote.total,
      currency: quote.currency,
    },
  };
}

export function compareQuotationRevisions(current: Quote, previous?: Quote) {
  const publicLine = ({ unitCost: _unitCost, manualReason: _manualReason, catalogPrice: _catalogPrice, catalogPriceRequest: _catalogPriceRequest, ...line }: QuoteLine) => line;
  const summary = (line: QuoteLine) => ({ id: line.id, room: line.room, title: line.title, optional: Boolean(line.optional) });
  const changes = (before: QuoteLine, after: QuoteLine) => {
    const fields: string[] = [];
    if (before.room !== after.room) fields.push("room");
    if (before.title !== after.title) fields.push("item");
    if (before.quantity !== after.quantity || before.unit !== after.unit) fields.push("quantity");
    if (before.rate !== after.rate) fields.push("selling price");
    if (Boolean(before.optional) !== Boolean(after.optional)) fields.push("option status");
    if (before.specification !== after.specification) fields.push("specification");
    if (canonicalHash(before.dimensions ?? null) !== canonicalHash(after.dimensions ?? null)) fields.push("size");
    if (canonicalHash(before.materialRows ?? before.customMaterials ?? [before.material, before.finish]) !== canonicalHash(after.materialRows ?? after.customMaterials ?? [after.material, after.finish])) fields.push("materials");
    if (canonicalHash(before.catalogLinks ?? []) !== canonicalHash(after.catalogLinks ?? [])) fields.push("catalogue source");
    return fields;
  };
  if (!previous)
    return {
      previousQuoteId: null,
      added: current.lines.length,
      removed: 0,
      changed: 0,
      totalDelta: current.total,
      details: { added: current.lines.map(summary), removed: [], changed: [] },
    };
  const key = (line: QuoteLine) => quotationLineIdentity(line) ?? `line:${line.id}`;
  const before = new Map(previous.lines.map((line) => [key(line), line]));
  const after = new Map(current.lines.map((line) => [key(line), line]));
  let changed = 0;
  for (const [identity, line] of after) {
    const old = before.get(identity);
    if (old && canonicalHash(publicLine(old)) !== canonicalHash(publicLine(line))) changed++;
  }
  const addedLines = [...after.entries()].filter(([identity]) => !before.has(identity)).map(([, line]) => summary(line));
  const removedLines = [...before.entries()].filter(([identity]) => !after.has(identity)).map(([, line]) => summary(line));
  const changedLines = [...after.entries()].flatMap(([identity, line]) => {
    const old = before.get(identity);
    if (!old || canonicalHash(publicLine(old)) === canonicalHash(publicLine(line))) return [];
    return [{ ...summary(line), changes: changes(old, line) }];
  });
  return {
    previousQuoteId: previous.id,
    added: addedLines.length,
    removed: removedLines.length,
    changed,
    totalDelta: Math.round((current.total - previous.total) * 100) / 100,
    details: { added: addedLines, removed: removedLines, changed: changedLines },
  };
}
