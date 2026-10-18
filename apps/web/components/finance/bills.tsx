"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DataGrid, EmptyState, ErrorState, InlineNotice, ListTabs, NoResultsState, RecordName, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { captureApi, type CaptureState } from "@/lib/books/capture-client";
import type { PayablesApi } from "@/lib/payables/client";
import type { Bill, BillState, PayablesState } from "@/lib/payables/types";
import { FromPhotoButton } from "../books/capture/from-photo";
import { useProjectFormat } from "../project-core/format";
import { BillEditor } from "./bill-editor";
import { BillSheet } from "./bill-sheet";
import { BillStatusLabel, billState } from "./finance-labels";
import styles from "./finance.module.css";

type Show = "open" | "all";
type Review = { capture: CaptureState; draft?: BillState };

/** Suppliers' invoices: by default the ones still to act on (drafts, held, and approved ones not fully paid). A bill can start from its photo. */
export function Bills({ api, state, error, openId, onReload, onOpen }: {
  api: PayablesApi; state: PayablesState | null; error: string; openId: string | null; onReload: () => void; onOpen: (id: string | null) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const today = format.today();
  const params = useSearchParams();
  const captures = useMemo(() => (api.workspaceId ? captureApi(api.workspaceId) : null), [api.workspaceId]);
  const [show, setShow] = useState<Show>("open");
  const [search, setSearch] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [problem, setProblem] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const open = (bill: Bill) => ["draft", "held"].includes(bill.status) || (bill.status === "approved" && Number(bill.balance) > 0);
  const rows = (state?.bills ?? []).filter((bill) => (show === "all" || open(bill))
    && (!needle || `${bill.supplierName} ${bill.number} ${bill.orders.join(" ")}`.toLocaleLowerCase().includes(needle)));
  const columns = useMemo<DataGridColumn<Bill>[]>(() => [
    { id: "invoice", header: t("Invoice"), accessorFn: (row) => row.supplierName, size: 300, meta: { primary: true, renderCell: (row) => <RecordName title={row.supplierName} detail={[row.number, ...row.orders].join(" · ")} /> } },
    { id: "due", header: t("Due"), accessorFn: (row) => row.dueDate ?? row.invoiceDate, size: 160, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span className={billState(row, today).key === "overdue" ? styles.lateText : undefined}>{row.dueDate ? format.day(row.dueDate) : "—"}</span>
      <small>{t("Invoiced {date}", { date: format.day(row.invoiceDate) })}</small></span> } },
    { id: "amount", header: t("Amount"), accessorFn: (row) => Number(row.total), size: 170, meta: { align: "end", renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.money}>{format.money(row.total, row.currency)}</span>
      {row.status === "approved" && Number(row.paid) > 0 && Number(row.balance) > 0 ? <small>{t("{amount} left", { amount: format.money(row.balance, row.currency) })}</small> : null}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => billState(row, today).key, size: 220, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span><BillStatusLabel bill={row} today={today} /></span>
      {row.status === "held" ? <small>{row.holdReasons.split("\n")[0]}</small> : null}</span> } },
  ], [t, format, today]);

  /** A bill read from its photo opens for checking: Woddy's draft when it entered one, else what it read. */
  const reviewCapture = async (capture: CaptureState) => {
    setProblem("");
    try {
      setReview({ capture, draft: capture.capture.billId ? await api.bill(capture.capture.billId) : undefined });
    } catch (cause) { setProblem(cause instanceof Error ? cause.message : t("Could not load.")); }
  };
  // The notice that a reading finished links here with ?capture=…
  const linked = params?.get("capture") ?? null;
  useEffect(() => {
    if (!linked || !captures || !/^[0-9a-f-]{36}$/i.test(linked)) return;
    let live = true;
    captures.get(linked).then((capture) => { if (live && capture.capture.status !== "discarded") void reviewCapture(capture); })
      .catch((cause) => { if (live) setProblem(cause instanceof Error ? cause.message : t("Could not load.")); });
    return () => { live = false; };
    // reviewCapture is recreated each render; the link is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, captures]);

  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  return <>
    {problem ? <InlineNotice message={problem} tone="error" /> : null}
    <DataGrid<Bill> gridKey="finance.bills" ariaLabel={t("Supplier invoices")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search invoices")} rowNumbers={false}
      toolbarLeading={<ListTabs label={t("Show")} value={show} onChange={setShow} items={[{ id: "open", label: t("To act on") }, { id: "all", label: t("All") }]} />}
      toolbarActions={captures && state?.canManage ? <FromPhotoButton api={captures} onCaptured={(capture) => void reviewCapture(capture)} onError={setProblem} /> : undefined}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={show === "open" ? t("Nothing to act on") : t("No supplier invoices yet")} />} />
    {openId ? <BillSheet api={api} billId={openId} vendors={state?.vendors ?? []} companies={state?.companies ?? []} onChanged={onReload} onClose={() => onOpen(null)} /> : null}
    {review && state ? <BillEditor api={api} capture={review.capture} existing={review.draft} vendors={state.vendors} companies={state.companies} onClose={() => setReview(null)}
      onSaved={(id) => { setReview(null); onReload(); onOpen(id); }} /> : null}
  </>;
}
