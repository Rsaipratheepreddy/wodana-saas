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
  definition: { confirmed: boolean; current: boolean } | null,
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
        `${line.title} is a custom item; verify its scope, specification and rate.`,
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
    totals(quote);
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
  if (!previous)
    return {
      previousQuoteId: null,
      added: current.lines.length,
      removed: 0,
      changed: 0,
      totalDelta: current.total,
    };
  const key = (line: QuoteLine) => quotationLineIdentity(line) ?? `line:${line.id}`;
  const before = new Map(previous.lines.map((line) => [key(line), line]));
  const after = new Map(current.lines.map((line) => [key(line), line]));
  let changed = 0;
  for (const [identity, line] of after) {
    const old = before.get(identity);
    if (old && canonicalHash(old) !== canonicalHash(line)) changed++;
  }
  return {
    previousQuoteId: previous.id,
    added: [...after.keys()].filter((identity) => !before.has(identity)).length,
    removed: [...before.keys()].filter((identity) => !after.has(identity)).length,
    changed,
    totalDelta: Math.round((current.total - previous.total) * 100) / 100,
  };
}
