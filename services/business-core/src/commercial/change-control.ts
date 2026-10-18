import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  ChangeDisposition,
  ChangeImpact,
  ControlledChangeKind,
  CommercialData,
  Quote,
  QuoteLine,
} from "./commercial.types";
import type { ProjectData } from "../projects/execution.types";
import { acceptedQuoteLines, matchesQuoteSnapshot } from "./commercial.domain";

export const controlledChangeKinds: readonly ControlledChangeKind[] = [
  "addition",
  "removal",
  "replacement",
  "clarification",
  "date_change",
  "price_correction",
];

export function acceptedContractLines(data: CommercialData) {
  return data.quotes
    .filter(
      (quote) =>
        quote.status === "accepted" && quote.direction !== "deduction",
    )
    .flatMap((quote) => acceptedQuoteLines(quote).map((line) => ({ quote, line })));
}

export function remainingContractQuantity(
  data: CommercialData,
  sourceLineId: string,
) {
  const source = acceptedContractLines(data).find(
    ({ line }) => line.id === sourceLineId,
  )?.line;
  if (!source) return 0;
  const deducted = data.quotes
    .filter(
      (quote) => quote.status === "accepted" && quote.direction === "deduction",
    )
    .flatMap((quote) => acceptedQuoteLines(quote))
    .filter((line) => line.deductsLineId === sourceLineId)
    .reduce((total, line) => total + line.quantity, 0);
  return Math.max(0, Math.round((source.quantity - deducted) * 10000) / 10000);
}

export function validateControlledChangeSources(
  data: CommercialData,
  kind: ControlledChangeKind,
  sourceLineIds: string[],
) {
  const needsSource = ["removal", "replacement"].includes(kind);
  if (needsSource && !sourceLineIds.length)
    throw new ConflictException(
      "Choose the accepted contract item that is being removed or replaced.",
    );
  if (new Set(sourceLineIds).size !== sourceLineIds.length)
    throw new ConflictException("A contract item can only appear once in a change case.");
  const sources = acceptedContractLines(data);
  for (const sourceLineId of sourceLineIds) {
    if (!sources.some(({ line }) => line.id === sourceLineId))
      throw new ConflictException(
        "Choose items from the currently accepted contract scope.",
      );
    if (remainingContractQuantity(data, sourceLineId) <= 0)
      throw new ConflictException(
        "This contract item has already been fully removed or replaced.",
      );
  }
}

export function sourceLinesForChange(
  data: CommercialData,
  sourceLineIds: string[],
) {
  return sourceLineIds.map((sourceLineId) => {
    const source = acceptedContractLines(data).find(
      ({ line }) => line.id === sourceLineId,
    );
    if (!source)
      throw new ConflictException(
        "The selected contract item is no longer available for this change.",
      );
    return { ...source, remainingQuantity: remainingContractQuantity(data, sourceLineId) };
  });
}

export function deductionDraftLine(source: QuoteLine, quantity: number): QuoteLine {
  const {
    id: _id,
    deductsLineId: _deductsLineId,
    scopeId: _scopeId,
    scopeVersion: _scopeVersion,
    specificationVersion: _specificationVersion,
    ...snapshot
  } = structuredClone(source);
  return {
    ...snapshot,
    id: randomUUID(),
    deductsLineId: source.id,
    quantity,
  };
}

export function projectChangeImpact(
  projectId: string,
  data: ProjectData,
  sourceLineIds: string[],
  assessedAt: string,
  bookingCount: number,
): ChangeImpact {
  const source = new Set(sourceLineIds);
  const tasks = data.tasks.filter((task) =>
    task.scopeIds.some((scopeLineId) => source.has(scopeLineId)),
  );
  const taskIds = new Set(tasks.map((task) => task.id));
  const workPackages = (data.workPackages ?? []).filter((workPackage) =>
    workPackage.scopeLineIds.some((scopeLineId) => source.has(scopeLineId)),
  );
  const orders = data.orders.filter((order) => taskIds.has(order.taskId));
  const materials = data.materials.filter((material) => taskIds.has(material.taskId));
  const targets = [
    ...workPackages.map((workPackage) => ({
      kind: "work_package" as const,
      id: workPackage.id,
      title: workPackage.title,
      status: workPackage.status,
    })),
    ...tasks.map((task) => ({
      kind: "task" as const,
      id: task.id,
      title: task.title,
      status: task.status,
    })),
    ...orders.map((order) => ({
      kind: "order" as const,
      id: order.id,
      title: order.title,
      status: order.status,
    })),
    ...materials.map((material) => ({
      kind: "material" as const,
      id: material.id,
      title: material.title,
      status: material.movements.length ? "received_or_issued" : "planned",
    })),
    ...(bookingCount
      ? [{
      kind: "booking" as const,
      id: "confirmed-bookings",
      title: `${bookingCount} confirmed project booking${bookingCount === 1 ? "" : "s"}`,
      status: "confirmed",
    }]
      : []),
  ];
  return {
    assessedAt,
    projectId,
    sourceLineIds: [...sourceLineIds],
    targets,
    bookingCount,
    hasReportedOrCompletedWork:
      tasks.some(
        (task) =>
          task.approved > 0 ||
          ["awaiting_inspection", "completed"].includes(task.status),
      ) ||
      data.reports.some(
        (report) =>
          report.status !== "draft" &&
          report.entries.some((entry) => taskIds.has(entry.taskId)),
      ),
  };
}

export function dispositionsCoverImpact(
  impact: ChangeImpact | undefined,
  dispositions: ChangeDisposition[],
) {
  if (!impact) return false;
  const expected = new Set(
    impact.targets.map((target) => `${target.kind}:${target.id}`),
  );
  const supplied = new Set(
    dispositions.map(
      (disposition) => `${disposition.targetKind}:${disposition.targetId}`,
    ),
  );
  return (
    expected.size === supplied.size &&
    [...expected].every((key) => supplied.has(key))
  );
}

export function controlledChangeQuotes(data: CommercialData, requestId: string) {
  const request = data.requests.find((candidate) => candidate.id === requestId);
  if (!request?.control) return [];
  return request.control.quoteIds.map((quoteId) => {
    const quote = data.quotes.find((candidate) => candidate.id === quoteId);
    if (!quote || !quote.requestIds.includes(requestId)) return undefined;
    return quote;
  }).filter((quote): quote is Quote => Boolean(quote));
}

export function controlledChangeCanRelease(data: CommercialData, requestId: string) {
  const request = data.requests.find((candidate) => candidate.id === requestId);
  if (!request?.control) return true;
  const quotes = controlledChangeQuotes(data, requestId);
  return (
    quotes.length === request.control.quoteIds.length &&
    request.control.quoteIds.every((quoteId) =>
      quotes.some(
        (quote) =>
          quote.id === quoteId && acceptedVariationSnapshotIsCurrent(quote),
      ),
    ) &&
    (request.control.kind === "addition" ||
      request.control.kind === "clarification" ||
      request.control.kind === "date_change" ||
      request.control.kind === "price_correction" ||
      dispositionsCoverImpact(request.control.impact, request.control.dispositions))
  );
}

export function acceptedVariationSnapshotIsCurrent(quote: Quote) {
  return Boolean(
    quote.kind === "variation" &&
      quote.status === "accepted" &&
      quote.hash &&
      quote.clientDecision?.decision === "accept" &&
      quote.clientDecision.quoteHash === quote.hash &&
      matchesQuoteSnapshot(quote),
  );
}

export function controlledChangeForQuote(data: CommercialData, quoteId: string) {
  return data.requests.find(
    (request) => request.control?.quoteIds.includes(quoteId),
  );
}

/** Plans the immutable delta only; a previously released quote is never applied twice. */
export function acceptedVariationsToRelease(
  data: CommercialData,
  releasedQuoteIds: Iterable<string>,
) {
  const released = new Set(releasedQuoteIds);
  return data.quotes.filter(
    (quote) =>
      quote.kind === "variation" &&
      quote.status === "accepted" &&
      !released.has(quote.id),
  );
}

export function isNonFinancialControlledChange(kind: ControlledChangeKind) {
  return kind === "clarification" || kind === "date_change";
}
