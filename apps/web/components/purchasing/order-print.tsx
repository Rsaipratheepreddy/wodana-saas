"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, DocumentTable, ErrorState, NoAccessState, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { isDenied, purchasingApi } from "@/lib/purchasing/client";
import type { OrderState } from "@/lib/purchasing/types";
import { ReceiveQr } from "../operations/receive-qr";
import styles from "../operations/print.module.css";
import { useProjectFormat } from "../project-core/format";
import { quantityText, useOrderLabels } from "./order-labels";
import { useDocumentTitle } from "@/lib/document-title";

/**
 * A purchase order on its own page, to print or save as PDF (D-46): the supplier, where it goes, the lines and totals,
 * and a code that opens the order's receive screen when it's scanned on arrival.
 */
export function OrderPrint({ workspaceId, orderId }: { workspaceId: string; orderId: string }) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useOrderLabels();
  const api = useMemo(() => purchasingApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<OrderState | null>(null);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const load = useCallback(async () => {
    try { setState(await api.order(orderId)); setError(null); }
    catch (cause) { setError({ message: cause instanceof Error ? cause.message : t("The order didn't load."), denied: isDenied(cause) }); }
  }, [api, orderId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useDocumentTitle(state ? [state.order.number, state.order.companyName] : null);
  if (error && !state) return <main className={styles.page}>{error.denied ? <NoAccessState /> : <ErrorState description={error.message} onRetry={() => void load()} />}</main>;
  if (!state) return <main className={styles.page}><Skeleton lines={10} shape="rows" /></main>;
  const { order, lines, supplier } = state;
  const money = (value: string) => format.money(value, order.currency);
  const due = order.promisedDate ?? order.expectedDate;
  return <main className={styles.page}>
    <div className={styles.actions}><Button variant="primary" onPress={() => window.print()}>{t("Print or save as PDF")}</Button></div>
    <article className={styles.document} aria-label={t("Purchase order {number}", { number: order.number })}>
      <header className={styles.head}>
        <div>
          <p className={styles.company}>{order.companyName}</p>
          <h1 className={styles.title}>{t("Purchase order")}</h1>
          <p className={styles.number} dir="ltr">{order.number}</p>
        </div>
        <ReceiveQr target={{ kind: "order", id: order.id }} caption={t("Scan to receive")} />
      </header>
      <dl className={styles.facts}>
        <div><dt>{t("Supplier")}</dt><dd>{[supplier?.name ?? order.supplierName, supplier?.contactName, supplier?.phone, supplier?.email].filter(Boolean).join("\n")}</dd></div>
        <div><dt>{t("Order date")}</dt><dd>{format.day((order.sentAt ?? order.createdAt).slice(0, 10))}</dd></div>
        <div><dt>{t("Deliver to")}</dt><dd>{[labels.deliverTo[order.deliverTo], order.deliveryAddress].filter(Boolean).join("\n")}</dd></div>
        {due ? <div><dt>{t("Needed by")}</dt><dd>{format.day(due)}</dd></div> : null}
        {order.projects.length ? <div><dt>{t("Projects")}</dt><dd>{order.projects.map((project) => project.reference).join(", ")}</dd></div> : null}
        {order.supplierReference ? <div><dt>{t("Supplier reference")}</dt><dd>{order.supplierReference}</dd></div> : null}
      </dl>
      <DocumentTable label={t("Lines")} rows={lines} getRowKey={(line) => line.id} columns={[
        { id: "item", header: t("Item"), cell: (line) => <><span dir="auto">{line.description}</span>{line.specification ? <small dir="auto">{line.specification}</small> : null}{line.projectReference ? <small>{line.projectReference}</small> : null}</> },
        { id: "quantity", header: t("Quantity"), align: "end", cell: (line) => `${quantityText(line.quantity)} ${line.unit}`.trim() },
        { id: "price", header: t("Unit price"), align: "end", cell: (line) => money(line.unitPrice) },
        { id: "total", header: t("Total"), align: "end", cell: (line) => money(line.total) },
      ]} summary={[
        { key: "subtotal", label: t("Subtotal"), value: money(order.subtotal) },
        ...(Number(order.discountTotal) ? [{ key: "discount", label: t("Discount"), value: money(`-${order.discountTotal}`) }] : []),
        { key: "tax", label: t("Tax"), value: money(order.taxTotal) },
        { key: "total", label: t("Total"), value: money(order.total), emphasis: true },
      ]} />
      {order.notes ? <p className={styles.note} dir="auto">{order.notes}</p> : null}
    </article>
  </main>;
}
