"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, DocumentTable, ErrorState, Skeleton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { useDocumentTitle } from "@/lib/document-title";
import { caseRequest } from "@/lib/pre-project/content";
import { clientStatus, lineTotal, type LedgerEntry, type LedgerView } from "@/lib/pre-project/design-decisions";
import styles from "../operations/print.module.css";

/**
 * PLM-050: the material list as a document, straight from the ledger — each material's current version, its
 * quantity and price, and whether the client confirmed it. The signed-off list says which lock it is.
 */
export function MaterialListPrint({ workspaceId, caseId }: { workspaceId: string; caseId: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [view, setView] = useState<LedgerView | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => caseRequest<LedgerView>(workspaceId, caseId, "design-ledger").then(setView).catch((cause: Error) => setError(cause.message)), [workspaceId, caseId]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useDocumentTitle(view ? [t("Material list")] : null);
  if (error && !view) return <main className={styles.page}><ErrorState description={error} onRetry={() => void load()} /></main>;
  if (!view) return <main className={styles.page}><Skeleton lines={8} shape="rows" /></main>;
  const rows = view.entries.filter((entry) => !entry.archivedAt && entry.kind === "material" && entry.current);
  const money = (value: string | null) => value === null ? "" : `${value}${view.currency ? ` ${view.currency}` : ""}`;
  const day = (iso: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "long", year: "numeric" }).format(new Date(iso)); } catch { return iso; } };
  const total = rows.reduce<string | null>((sum, entry) => {
    const line = lineTotal(entry.current!.quantity, entry.current!.unitPrice);
    if (!line) return sum;
    return addMoney(sum ?? "0.00", line);
  }, null);
  return <main className={styles.page}>
    <div className={styles.actions}><Button variant="primary" onPress={() => window.print()}>{t("Print or save as PDF")}</Button></div>
    <article className={styles.document} aria-label={t("Material list")}>
      <header className={styles.head}><div>
        <h1 className={styles.title}>{t("Material list")}</h1>
        <p className={styles.number}>{view.lock ? t("Signed off {date}", { date: day(view.lock.lockedAt) }) : t("Not signed off")}</p>
      </div></header>
      <DocumentTable label={t("Materials")} rows={rows} getRowKey={(entry: LedgerEntry) => entry.id} columns={[
        { id: "item", header: t("Material"), cell: (entry: LedgerEntry) => <><span dir="auto">{entry.current!.title}</span>{entry.current!.specification ? <small dir="auto">{entry.current!.specification}</small> : null}{entry.roomName ? <small>{entry.roomName}</small> : null}</> },
        { id: "version", header: t("Version"), cell: (entry: LedgerEntry) => `V${entry.currentNumber}` },
        { id: "quantity", header: t("Quantity"), align: "end", cell: (entry: LedgerEntry) => `${entry.current!.quantity ?? ""} ${entry.current!.unit}`.trim() },
        { id: "price", header: t("Unit price"), align: "end", cell: (entry: LedgerEntry) => money(entry.current!.unitPrice) },
        { id: "total", header: t("Total"), align: "end", cell: (entry: LedgerEntry) => money(lineTotal(entry.current!.quantity, entry.current!.unitPrice)) },
        { id: "client", header: t("Client"), cell: (entry: LedgerEntry) => t(clientStatus(entry.current).key) },
      ]} summary={total ? [{ key: "total", label: t("Total"), value: money(total), emphasis: true }] : undefined} />
    </article>
  </main>;
}

/** Two money strings with two decimals added exactly. */
function addMoney(a: string, b: string) {
  const cents = (value: string) => { const negative = value.startsWith("-"); const [whole, fraction = ""] = value.replace("-", "").split("."); const units = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2)); return negative ? -units : units; };
  const sum = cents(a) + cents(b);
  const negative = sum < 0n; const abs = negative ? -sum : sum;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}
