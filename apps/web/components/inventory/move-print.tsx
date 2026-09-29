"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, DocumentTable, ErrorState, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { inventoryApi } from "@/lib/inventory/client";
import type { TransferState } from "@/lib/inventory/types";
import { ReceiveQr } from "../operations/receive-qr";
import styles from "../operations/print.module.css";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";

/**
 * A stock move on its own page, to print and send with the goods (D-46): where from and to, what's on it and for which
 * project, and a code that opens the move's receive screen where it arrives.
 */
export function MovePrint({ workspaceId, moveId }: { workspaceId: string; moveId: string }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => inventoryApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<TransferState | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setState(await api.transfer(moveId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The move didn't load.")); }
  }, [api, moveId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !state) return <main className={styles.page}><ErrorState description={error} onRetry={() => void load()} /></main>;
  if (!state) return <main className={styles.page}><Skeleton lines={8} shape="rows" /></main>;
  const { transfer, lines } = state;
  return <main className={styles.page}>
    <div className={styles.actions}><Button variant="primary" onPress={() => window.print()}>{t("Print or save as PDF")}</Button></div>
    <article className={styles.document} aria-label={t("Move {number}", { number: transfer.number })}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>{t("Move {number}", { number: transfer.number })}</h1>
          <p className={styles.number}>{`${transfer.fromName} → ${transfer.toName}`}</p>
        </div>
        <ReceiveQr target={{ kind: "move", id: transfer.id }} caption={t("Scan to receive")} />
      </header>
      <dl className={styles.facts}>
        <div><dt>{t("Sent")}</dt><dd>{[format.day(transfer.sentOn), transfer.sentByName].filter(Boolean).join(" · ")}</dd></div>
        {transfer.projects?.length ? <div><dt>{t("Projects")}</dt><dd>{transfer.projects.map((project) => project.reference).join(", ")}</dd></div> : null}
        {transfer.note ? <div><dt>{t("Note")}</dt><dd>{transfer.note}</dd></div> : null}
      </dl>
      <DocumentTable label={t("Lines")} rows={lines} getRowKey={(line) => line.id} columns={[
        { id: "item", header: t("Item"), cell: (line) => <span dir="auto">{line.itemName}</span> },
        { id: "project", header: t("Project"), cell: (line) => line.projectReference ?? "—" },
        { id: "quantity", header: t("Quantity"), align: "end", cell: (line) => `${quantityText(line.quantity)} ${line.unit}`.trim() },
      ]} />
    </article>
  </main>;
}
