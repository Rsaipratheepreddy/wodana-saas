"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, ErrorState, RecordTable, EmptyState, type DataGridColumn, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { consoleApi, type TenantBillingOverview } from "@/lib/internal/console";
import { useConsoleFormat } from "./labels";
import styles from "./control-plane.module.css";

type BillingDocument = TenantBillingOverview["documents"][number];

/** The account's billing documents as the billing provider reports them, and its collection state. */
export function BillingTab({ orgKey }: { orgKey: string }) {
  const t = useT();
  const format = useConsoleFormat();
  const [billing, setBilling] = useState<TenantBillingOverview | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setBilling(await consoleApi.billing(orgKey)); setError(""); }
    catch (cause) { setError((cause as Error).message || t("Billing didn't load.")); }
  }, [orgKey, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const documentStatus = useMemo<Record<string, { label: string; tone: StatusTone }>>(() => ({
    draft: { label: t("Draft"), tone: "neutral" }, issued: { label: t("Issued"), tone: "info" },
    past_due: { label: t("Past due"), tone: "danger" }, paid: { label: t("Paid"), tone: "success" },
    applied: { label: t("Applied"), tone: "success" }, verified: { label: t("Verified"), tone: "success" },
    failed: { label: t("Failed"), tone: "danger" }, void: { label: t("Void"), tone: "neutral" },
    refunded: { label: t("Refunded"), tone: "neutral" },
  }), [t]);
  const documentType: Record<string, string> = { invoice: t("Invoice"), credit_note: t("Credit note"), receipt: t("Receipt") };
  const collectionStatus: Record<string, { label: string; tone: StatusTone }> = {
    current: { label: t("Current"), tone: "success" }, grace: { label: t("Grace"), tone: "warning" },
    past_due: { label: t("Past due"), tone: "danger" }, collections: { label: t("Collections"), tone: "danger" },
    suspended: { label: t("Suspended"), tone: "danger" }, closed: { label: t("Closed"), tone: "neutral" },
    not_configured: { label: t("Not set"), tone: "neutral" },
  };
  const columns = useMemo<DataGridColumn<BillingDocument>[]>(() => [
    { id: "number", header: t("Document"), size: 200, accessorFn: (row) => row.documentNumber ?? row.externalReference, meta: { primary: true, renderCell: (row) =>
      <span className={styles.nameCell}><strong>{row.documentNumber ?? row.externalReference}</strong><small>{documentType[row.documentType] ?? row.documentType}</small></span> } },
    { id: "status", header: t("Status"), size: 120, accessorFn: (row) => row.status, meta: { renderCell: (row) => {
      const status = row.status === "issued" && row.dueAt && new Date(row.dueAt) < new Date() ? documentStatus.past_due : documentStatus[row.status];
      return <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? row.status}</Badge>;
    } } },
    { id: "total", header: t("Total"), size: 130, accessorFn: (row) => Number(row.totalAmount), meta: { align: "end", renderCell: (row) =>
      <span className={styles.number}>{format.money(row.totalAmount, row.currency)}</span> } },
    { id: "balance", header: t("Balance"), size: 130, accessorFn: (row) => Number(row.balanceAmount), meta: { align: "end", renderCell: (row) =>
      <span className={styles.number}>{format.money(row.balanceAmount, row.currency)}</span> } },
    { id: "due", header: t("Due"), size: 130, accessorFn: (row) => row.dueAt ?? "", meta: { renderCell: (row) => format.date(row.dueAt) } },
  ], [documentStatus, documentType, format, t]);

  if (error && !billing) return <div className={styles.panel}><ErrorState description={error} onRetry={() => void load()} /></div>;
  const collection = billing ? collectionStatus[billing.collection.status] ?? collectionStatus.not_configured : null;
  return <div className={styles.panel}>
    {billing && collection ? <dl className={styles.properties}>
      <div><dt>{t("Collection")}</dt><dd><Badge tone={collection.tone}>{collection.label}</Badge>
        {"overdueAmount" in billing.collection && Number(billing.collection.overdueAmount) > 0
          ? <span className={styles.number}>{format.money(billing.collection.overdueAmount, billing.collection.currency)}</span> : null}</dd></div>
      {"nextReviewAt" in billing.collection && billing.collection.nextReviewAt
        ? <div><dt>{t("Next review")}</dt><dd>{format.date(billing.collection.nextReviewAt)}</dd></div> : null}
    </dl> : null}
    <RecordTable<BillingDocument> ariaLabel={t("Billing documents")} columns={columns} data={billing?.documents ?? []} getRowId={(row) => row.id}
      isLoading={!billing} emptyContent={<EmptyState illustration={null} title={t("No billing documents")} />} rowNumbers={false} selectable={false} showToolbar={false} showFooter={false} wrapText />
  </div>;
}
