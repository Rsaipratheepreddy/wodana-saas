"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DocumentTable, ErrorState, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { inventoryApi } from "@/lib/inventory/client";
import type { TransferState } from "@/lib/inventory/types";
import { ReceiveQr } from "../operations/receive-qr";
import styles from "../operations/print.module.css";
import { quantityText } from "../purchasing/order-labels";
import { DocumentSignatures, PrintDocument, useDocumentFormat } from "../documents/print-document";

/**
 * A stock move on its own page, to print and send with the goods (D-46): where from and to, what's on it and for which
 * project, and a code that opens the move's receive screen where it arrives.
 */
export function MovePrint({ workspaceId, moveId }: { workspaceId: string; moveId: string }) {
  const t = useT();
  const doc = useDocumentFormat();
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
  const number = t("Move {number}", { number: transfer.number });
  return <PrintDocument kind={t("Delivery note")} number={number} label={number} fileName={[number, transfer.toName]}
    aside={<ReceiveQr target={{ kind: "move", id: transfer.id }} caption={t("Scan to receive")} />}
    facts={[{ label: t("Sent"), value: doc.date(transfer.sentOn) }, { label: t("Projects"), value: transfer.projects?.map((project) => project.reference).join(", ") ?? "" }]}
    parties={[{ label: t("From"), name: transfer.fromName, lines: [transfer.sentByName] }, { label: t("To"), name: transfer.toName }]}>
    <DocumentTable label={t("Lines")} rows={lines} getRowKey={(line) => line.id} columns={[
      { id: "item", header: t("Item"), cell: (line) => <span dir="auto">{line.itemName}</span> },
      { id: "project", header: t("Project"), cell: (line) => line.projectReference ?? "—" },
      { id: "quantity", header: t("Quantity"), align: "end", cell: (line) => `${quantityText(line.quantity)} ${line.unit}`.trim() },
    ]} />
    {transfer.note ? <p className={styles.note} dir="auto">{transfer.note}</p> : null}
    <DocumentSignatures boxes={[{ label: t("Delivered by"), name: transfer.sentByName }, { label: t("Received by") }]} />
  </PrintDocument>;
}
