"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, DataGrid, EmptyState, ErrorState, InlineNotice, isNoAccessError, NoAccessState, Skeleton, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { useProjectFormat } from "../project-core/format";

/** One event the Ledger couldn't post yet (business-core books_posting_issues). */
export type LedgerIssue = {
  id: string;
  legalEntityId: string | null;
  companyName: string | null;
  sourceType: string;
  sourceId: string;
  sourceEvent: string;
  sourceLabel: string;
  sourceHref: string;
  eventDate: string | null;
  code: string;
  detail: string;
  attempts: number;
  firstSeenAt: string;
  lastSeenAt: string;
};
export type LedgerIssues = { issues: LedgerIssue[]; canRetry: boolean };

export class LedgerRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** The Ledger's attention API for one workspace (proxied by /api/books/[...path]). */
export function ledgerAttentionApi(workspaceId: string) {
  const at = (path: string) => `/api/books/${path}?${new URLSearchParams({ workspaceId })}`;
  const request = async (url: string, method = "GET") => {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}", cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new LedgerRequestError(typeof data?.message === "string" ? data.message : "", response.status);
    return data as LedgerIssues;
  };
  return {
    issues: () => request(at("issues")),
    retry: (issueId: string) => request(at(`issues/${encodeURIComponent(issueId)}/retry`), "POST"),
  };
}
export type LedgerAttentionApi = ReturnType<typeof ledgerAttentionApi>;

/**
 * Needs attention: the money records the Ledger couldn't post yet, why, and how often it tried. Each opens its
 * record; people who manage the Ledger try one again once it's fixed. Mounted by the Ledger area (it has the title).
 */
export function LedgerAttention({ workspaceId, api: given }: { workspaceId: string; api?: LedgerAttentionApi }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => given ?? ledgerAttentionApi(workspaceId), [given, workspaceId]);
  const [state, setState] = useState<LedgerIssues | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try { setState(await api.issues()); setError(null); } catch (cause) { setError(cause); }
  }, [api]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const retry = useCallback(async (issue: LedgerIssue) => {
    setRetrying(issue.id);
    setNotice("");
    try {
      const next = await api.retry(issue.id);
      setState(next);
      if (next.issues.some((item) => item.id === issue.id)) setNotice(t("{source} still can't post.", { source: issue.sourceLabel || sourceName(t, issue.sourceType) }));
    } catch (cause) {
      setNotice(cause instanceof Error && cause.message ? cause.message : t("It couldn't be tried again."));
    }
    setRetrying(null);
  }, [api, t]);

  const columns = useMemo<DataGridColumn<LedgerIssue>[]>(() => [
    { id: "source", header: t("Record"), accessorFn: (row) => `${sourceName(t, row.sourceType)} ${row.sourceLabel}`, size: 260, meta: { primary: true, renderCell: (row) =>
      <span>
        <span>{sourceName(t, row.sourceType)}</span>{" "}
        {row.sourceHref ? <Link href={row.sourceHref}>{row.sourceLabel || t("Open")}</Link> : <span>{row.sourceLabel}</span>}
      </span> } },
    { id: "code", header: t("Problem"), accessorFn: (row) => problemName(t, row.code), size: 200, meta: { renderCell: (row) => <Badge tone="warning">{problemName(t, row.code)}</Badge> } },
    { id: "detail", header: t("Details"), accessorFn: (row) => row.detail, size: 360, meta: { mobileHidden: true } },
    { id: "date", header: t("Date"), accessorFn: (row) => row.eventDate ?? "", size: 130, meta: { mobileHidden: true, renderCell: (row) => format.day(row.eventDate) } },
    { id: "attempts", header: t("Tries"), accessorFn: (row) => row.attempts, size: 90, meta: { align: "end" } },
    ...(state?.canRetry ? [{ id: "retry", header: t("Actions"), enableSorting: false, size: 130, meta: { align: "end", interactive: true, renderCell: (row: LedgerIssue) =>
      <Button size="compact" intent="write" isLoading={retrying === row.id} isDisabled={Boolean(retrying) && retrying !== row.id} onPress={() => void retry(row)}>{t("Retry")}</Button> } } satisfies DataGridColumn<LedgerIssue>] : []),
  ], [t, format, state?.canRetry, retrying, retry]);

  if (error && !state) return isNoAccessError(error) ? <NoAccessState area={t("Ledger")} /> : <ErrorState onRetry={() => void load()} />;
  if (!state) return <Skeleton lines={5} shape="rows" />;
  return <>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    <DataGrid<LedgerIssue> ariaLabel={t("Needs attention")} columns={columns} data={state.issues} getRowId={(row) => row.id} rowNumbers={false} selectable={false} wrapText
      emptyContent={<EmptyState illustration="empty" title={t("Everything is posted")} />} />
  </>;
}

type Translate = ReturnType<typeof useT>;

/** What kind of record an issue is about. */
function sourceName(t: Translate, sourceType: string) {
  switch (sourceType) {
    case "client_invoice": return t("Client invoice");
    case "client_credit_note": return t("Credit note");
    case "receipt": return t("Client payment");
    case "supplier_bill": return t("Supplier invoice");
    case "supplier_payment": return t("Supplier payment");
    case "goods_receipt": return t("Delivery");
    case "stock_batch": return t("Stock movement");
    case "petty_cash": return t("Petty cash");
    case "labour": return t("Labour");
    case "manual_journal": return t("Manual journal");
    default: return t("Record");
  }
}

/** Why it couldn't post, in a few words. */
function problemName(t: Translate, code: string) {
  switch (code) {
    case "missing_rate": return t("No exchange rate");
    case "missing_account": return t("Account not set");
    case "unknown_tax": return t("Tax code missing");
    case "no_cost": return t("No cost yet");
    case "no_entity": return t("Company unknown");
    case "currency_mismatch": return t("Different currency");
    case "external_invoice": return t("Invoiced elsewhere");
    case "entity_not_enabled": return t("Ledger off for this company");
    default: return t("Can't post yet");
  }
}
