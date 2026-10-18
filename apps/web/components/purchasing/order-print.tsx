"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DocumentTable, ErrorState, NoAccessState, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { isDenied, purchasingApi } from "@/lib/purchasing/client";
import type { OrderState } from "@/lib/purchasing/types";
import { ReceiveQr } from "../operations/receive-qr";
import styles from "../operations/print.module.css";
import { quantityText, useOrderLabels } from "./order-labels";
import { fetchLetterhead, type DocumentLetterhead } from "@/lib/brand/letterhead";
import { DocumentSignatures, DocumentTotals, PrintDocument, useDocumentFormat } from "../documents/print-document";
import { useSupplierLabels } from "./supplier-labels";

/**
 * A purchase order on its own page, to print or save as PDF (D-46): the supplier, where it goes, the lines and totals,
 * and a code that opens the order's receive screen when it's scanned on arrival.
 */
export function OrderPrint({ workspaceId, orderId }: { workspaceId: string; orderId: string }) {
  const t = useT();
  const doc = useDocumentFormat();
  const labels = useOrderLabels();
  const supplierLabels = useSupplierLabels();
  const api = useMemo(() => purchasingApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<OrderState | null>(null);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  // The ordering business's letterhead (PLM-112); without one the order shows the business's name.
  const [letterhead, setLetterhead] = useState<DocumentLetterhead | null>(null);
  const load = useCallback(async () => {
    try {
      const next = await api.order(orderId);
      setLetterhead(next.order.legalEntityId ? await fetchLetterhead(workspaceId, next.order.legalEntityId) : null);
      setState(next); setError(null);
    }
    catch (cause) { setError({ message: cause instanceof Error ? cause.message : t("The order didn't load."), denied: isDenied(cause) }); }
  }, [api, orderId, t, workspaceId]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !state) return <main className={styles.page}>{error.denied ? <NoAccessState /> : <ErrorState description={error.message} onRetry={() => void load()} />}</main>;
  if (!state) return <main className={styles.page}><Skeleton lines={10} shape="rows" /></main>;
  const { order, lines, supplier } = state;
  const money = (value: string) => doc.money(value, order.currency);
  const due = order.promisedDate ?? order.expectedDate;
  const supplierName = supplier?.name ?? order.supplierName;
  return <PrintDocument kind={t("Purchase order")} number={order.number} label={t("Purchase order {number}", { number: order.number })}
    letterhead={letterhead} brand={{ name: order.companyName }} fileName={[order.number, supplierName]}
    aside={<ReceiveQr target={{ kind: "order", id: order.id }} caption={t("Scan to receive")} />}
    facts={[
      { label: t("Order date"), value: doc.date((order.sentAt ?? order.createdAt).slice(0, 10)) },
      { label: t("Needed by"), value: due ? doc.date(due) : "" },
      { label: t("Supplier reference"), value: order.supplierReference },
    ]}
    parties={[
      { label: t("Supplier"), name: supplierName, lines: [supplier?.contactName, [supplier?.phone, supplier?.email].filter(Boolean).join(" · ")] },
      { label: t("Deliver to"), name: labels.deliverTo[order.deliverTo], lines: [order.deliveryAddress, order.projects.length ? order.projects.map((project) => project.reference).join(", ") : null] },
    ]}>
    <DocumentTable label={t("Lines")} rows={lines} getRowKey={(line) => line.id} columns={[
      { id: "item", header: t("Item"), cell: (line) => <><span dir="auto">{line.description}</span>{line.specification ? <small dir="auto">{line.specification}</small> : null}{line.projectReference ? <small>{line.projectReference}</small> : null}</> },
      { id: "quantity", header: t("Quantity"), align: "end", cell: (line) => `${quantityText(line.quantity)} ${line.unit}`.trim() },
      { id: "price", header: t("Unit price"), align: "end", cell: (line) => money(line.unitPrice) },
      { id: "total", header: t("Total"), align: "end", cell: (line) => money(line.total) },
    ]} />
    <DocumentTotals label={t("Totals")} rows={[
      { key: "subtotal", label: t("Subtotal"), value: money(order.subtotal) },
      ...(Number(order.discountTotal) ? [{ key: "discount", label: t("Discount"), value: money(`-${order.discountTotal}`) }] : []),
      { key: "tax", label: letterhead?.taxName ?? t("Tax"), value: money(order.taxTotal) },
      { key: "total", label: t("Total"), value: money(order.total), emphasis: true },
    ]} />
    <dl className={styles.facts}>
      <div><dt>{t("Payment terms")}</dt><dd>{supplierLabels.termsText(order)}</dd></div>
      {order.termsNote ? <div><dt>{t("Terms")}</dt><dd dir="auto">{order.termsNote}</dd></div> : null}
      {order.notes ? <div><dt>{t("Note")}</dt><dd dir="auto">{order.notes}</dd></div> : null}
    </dl>
    <DocumentSignatures boxes={[{ label: t("Authorised by"), name: order.approvedByName }, { label: t("Accepted by the supplier"), name: supplierName }]} />
  </PrintDocument>;
}
