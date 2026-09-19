import type { QuoteLine } from "./types";

export type QuotationProposalItem = {
  id: string;
  roomName: string;
  line: QuoteLine;
  reason: string;
  status: "ready" | "price_required" | "catalog_required";
  issue?: string;
};

export type QuotationProposalRun = {
  id: string;
  status: "proposed" | "applied" | "dismissed";
  stale: boolean;
  staleReasons: string[];
  duplicates: string[];
  proposal: { items: QuotationProposalItem[]; coverage: { unlinkedSourceIds: string[] }; notes: string[] };
};

export type QuotationComposerState = {
  revision: number;
  definition: null | { id: string; number: number; confirmed: boolean; current: boolean };
  readiness: { readyForReview: boolean; blockers: { code: string; message: string }[]; warnings: { code: string; message: string }[] };
  coverage: {
    included: { id: string; title: string; roomName?: string | null }[];
    covered: { id: string; title: string; roomName?: string | null }[];
    uncovered: { id: string; title: string; roomName?: string | null }[];
  };
  comparison: {
    previousQuoteId: string | null;
    added: number;
    removed: number;
    changed: number;
    totalDelta: number;
    details: {
      added: { id: string; room: string; title: string; optional: boolean }[];
      removed: { id: string; room: string; title: string; optional: boolean }[];
      changed: { id: string; room: string; title: string; optional: boolean; changes: string[] }[];
    };
  };
  runs: QuotationProposalRun[];
};

export function selectableProposalIds(run: QuotationProposalRun) {
  const duplicates = new Set(run.duplicates);
  return run.proposal.items.filter((item) => !duplicates.has(item.id)).map((item) => item.id);
}
