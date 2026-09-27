"use client";

import { useEffect, useState } from "react";
import { ErrorState, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commercialPath, jsonRequest } from "@/lib/commercial/client";
import { caseApi } from "@/lib/pre-project/content";
import { catalogImageUrl } from "@/lib/quotation/client";
import type { CommercialState, Quote } from "@/lib/commercial/types";
import type { quoteApi } from "@/lib/quotation/client";
import { QuotationBuilderShell } from "@/components/commercial/quotation-builder-shell";
import styles from "./quote-builder.module.css";

/**
 * The proposal the client receives, designed page by page: the firm's own layout (cover, introduction,
 * letter, the items room by room, payments, terms), with every text and picture editable. It opens with
 * the lines as they are now and saves only its design, so the sheet stays the single source of the items.
 */
export function QuoteProposal({ workspaceId, caseId, quoteId, api, sizeUnit, onPayments }: {
  workspaceId: string; caseId: string; quoteId: string; api: ReturnType<typeof quoteApi>; sizeUnit: string; onPayments: () => void;
}) {
  const t = useT();
  const [state, setState] = useState<CommercialState | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    jsonRequest<CommercialState>(commercialPath(workspaceId, `cases/${caseId}`))
      .then((next) => { if (alive) { setState(next); setError(""); } })
      .catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [workspaceId, caseId, attempt]);
  if (error) return <ErrorState title={t("The proposal didn't load")} description={error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!state) return <Skeleton lines={6} shape="rows" />;
  const sheet = (quote: Quote) => withSheetFields(quote, workspaceId, caseId, sizeUnit);
  if (!state.data.quotes.some((quote) => quote.id === quoteId)) return <ErrorState title={t("The proposal didn't load")} />;
  return <div className={styles.proposal}>
    <QuotationBuilderShell backHref="" initial={{ ...state, data: { ...state.data, quotes: state.data.quotes.map(sheet) } }} quoteId={quoteId}
      embedded={{ save: async (change) => { const result = await api.proposal(change); return { ...result, quote: sheet(result.quote) }; }, onPayments }} />
  </div>;
}

type SheetLine = Quote["lines"][number] & {
  imageAssetId?: string | null; catalogImageId?: string | null; length?: number | string | null; width?: number | string | null; height?: number | string | null; dimensionUnit?: string | null;
};

/**
 * The proposal pages read a line's picture and size the way older quotes stored them; lines made in the
 * sheet keep their own picture and length × depth × height. This shows the sheet's values on the pages
 * (it is never saved back).
 */
function withSheetFields(quote: Quote, workspaceId: string, caseId: string, sizeUnit: string): Quote {
  const size = (value: number | string | null | undefined) => (value === null || value === undefined || value === "" ? undefined : Number(value));
  return { ...quote, lines: quote.lines.map((raw) => {
    const line = raw as SheetLine;
    const photo = line.photo || (line.imageAssetId ? caseApi(workspaceId, caseId, `assets/${line.imageAssetId}?preview=1`) : line.catalogImageId ? catalogImageUrl(workspaceId, line.catalogImageId) : undefined);
    const [length, depth, height] = [size(line.length), size(line.width), size(line.height)];
    const dimensions = line.dimensions ?? (length !== undefined || depth !== undefined || height !== undefined ? { length, height, depth, unit: line.dimensionUnit ?? sizeUnit } : undefined);
    return { ...line, ...(photo ? { photo } : {}), ...(dimensions ? { dimensions } : {}) } as typeof raw;
  }) };
}
