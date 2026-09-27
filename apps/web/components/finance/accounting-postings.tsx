"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, DataGrid, EmptyState, ErrorState, NoResultsState, SegmentedControl, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { AccountingApi } from "@/lib/accounting/client";
import type { Posting, PostingKind, PostingStatus } from "@/lib/accounting/types";
import { useProjectFormat } from "../project-core/format";
import styles from "./finance.module.css";

type Show = "attention" | "all";

/** What went to the accounting system: each document, where it stands, and why one is waiting or failed; retried from here. */
export function AccountingPostings({ api }: { api: AccountingApi }) {
  const t = useT();
  const format = useProjectFormat();
  const [postings, setPostings] = useState<Posting[] | null>(null);
  const [error, setError] = useState("");
  const [show, setShow] = useState<Show>("attention");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setPostings((await api.postings()).postings); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Postings didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const kinds = useMemo<Record<PostingKind, string>>(() => ({ invoice: t("Invoice"), credit_note: t("Credit note"), invoice_payment: t("Client payment"), bill: t("Supplier bill"),
    bill_payment: t("Supplier payment"), bill_payment_void: t("Payment reversed") }), [t]);
  const statuses = useMemo<Record<PostingStatus, [string, string]>>(() => ({ pending: [t("Waiting"), "info"], sent: [t("Posted"), "success"], failed: [t("Failed"), "danger"],
    blocked: [t("Needs a mapping"), "warning"], cancelled: [t("Not needed"), "neutral"] }), [t]);
  const needsAttention = (row: Posting) => row.status === "blocked" || (row.status === "failed" && !row.nextAt) || row.errorCode === "total_differs";
  const needle = search.trim().toLocaleLowerCase();
  const rows = (postings ?? []).filter((row) => (show === "all" || needsAttention(row)) && (!needle || `${row.label ?? ""} ${row.companyName} ${kinds[row.kind]}`.toLocaleLowerCase().includes(needle)));
  const columns = useMemo<DataGridColumn<Posting>[]>(() => [
    { id: "document", header: t("Document"), accessorFn: (row) => row.label ?? "", size: 300, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.label ?? kinds[row.kind]}</span><small>{[kinds[row.kind], row.companyName, format.day(row.documentDate)].join(" · ")}</small></span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 320, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.status} data-tone={row.errorCode === "total_differs" ? "warning" : statuses[row.status][1]}>
        {row.status === "sent" && row.providerNumber ? `${statuses.sent[0]} · ${row.providerNumber}` : statuses[row.status][0]}</span>
      {row.error ? <small>{row.error}</small> : row.status === "failed" && row.nextAt ? <small>{t("Tries again {date}", { date: format.when(row.nextAt) })}</small> : null}</span> } },
    { id: "action", header: "", accessorFn: () => "", size: 120, meta: { renderCell: (row) => ["failed", "blocked"].includes(row.status)
      ? <Button size="compact" isLoading={busy === row.id} onPress={async () => {
          setBusy(row.id);
          try { setPostings((await api.retry(row.id)).postings); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); } finally { setBusy(null); }
        }}>{t("Retry")}</Button> : null } },
  ], [t, format, kinds, statuses, api, busy]);
  if (error && !postings) return <ErrorState description={error} onRetry={() => void load()} />;
  return <DataGrid<Posting> appearance="flush" ariaLabel={t("Accounting postings")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!postings}
    onSearchChange={setSearch} searchValue={search} searchLabel={t("Search postings")} rowNumbers={false} wrapText
    toolbarLeading={<SegmentedControl label={t("Show")} value={show} onChange={(value) => setShow(value as Show)} options={[{ id: "attention", label: t("Needs attention") }, { id: "all", label: t("All") }]} />}
    emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={show === "attention" ? t("Nothing needs attention") : t("Nothing posted yet")}
      action={<Link className={styles.linkButton} href="/workspace/settings/accounting">{t("Accounting settings")}</Link>} />} />;
}
