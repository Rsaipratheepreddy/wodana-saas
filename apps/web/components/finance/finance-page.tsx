"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSection } from "@/lib/navigation/use-section";
import { Button, PageShell } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { payablesApi } from "@/lib/payables/client";
import { receivablesApi } from "@/lib/receivables/client";
import { accountingApi } from "@/lib/accounting/client";
import { FINANCE_SECTIONS, type FinanceSection } from "@/lib/payables/sections";
import type { PayablesState } from "@/lib/payables/types";
import { AccountingPostings } from "./accounting-postings";
import { BillEditor } from "./bill-editor";
import { ClientInvoices } from "./client-invoices";
import { Bills } from "./bills";
import { PaymentRuns } from "./payment-runs";
import { Payments } from "./payments";
import { PettyCash } from "./petty-cash";
import { SuppliersOwed } from "./suppliers-owed";
import { FinanceRequests } from "../finance-requests/finance-requests";
import { moduleTabs, type ModuleTab } from "../operations/module-tabs";

const PAYABLES_SECTIONS = ["bills", "payments", "runs", "suppliers"] as const;

/**
 * Over six tabs, the read-mostly and periodic views (what each supplier is owed, petty cash to reimburse,
 * accounting postings) sit under "More"; the daily queues (invoices, payments, runs, client invoices, requests)
 * stay one click away.
 */
const MORE: FinanceSection[] = ["suppliers", "petty-cash", "accounting"];

const OPEN_PARAM: Record<Exclude<FinanceSection, "suppliers" | "accounting">, string> = { bills: "bill", payments: "payment", runs: "run", "petty-cash": "claim", "client-invoices": "invoice",
  requests: "request" };

/** Finance: suppliers' invoices to check and pay, payments and payment runs, what each supplier is owed, petty cash to reimburse, clients' tax invoices, and accounting postings. Records open in place. */
export function FinancePage({ workspaceId, section: initialSection, sections = FINANCE_SECTIONS, supplierId: initialSupplier }: { workspaceId: string; section: FinanceSection; sections?: readonly FinanceSection[]; supplierId: string | null }) {
  const t = useT();
  const [route, move] = useSection({ section: initialSection, supplierId: initialSupplier }, `${initialSection}/${initialSupplier ?? ""}`);
  const { section, supplierId } = route;
  const params = useSearchParams();
  const api = useMemo(() => payablesApi(workspaceId), [workspaceId]);
  const receivables = useMemo(() => receivablesApi(workspaceId), [workspaceId]);
  const accounting = useMemo(() => accountingApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<PayablesState | null>(null);
  const [error, setError] = useState("");
  const [entering, setEntering] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [raising, setRaising] = useState(false);
  const load = useCallback(async () => {
    try { setState(await api.state()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Finance didn't load.")); }
  }, [api, t]);
  // Supplier invoices, payments, runs and what's owed share one load; only fetch it for people who have those tabs.
  const payablesTabs = sections.some((item) => (PAYABLES_SECTIONS as readonly string[]).includes(item));
  useEffect(() => { if (payablesTabs) queueMicrotask(() => void load()); }, [load, payablesTabs]);
  const go = (next: FinanceSection, open?: string | null) => {
    const base = `/workspace/finance${next === "bills" ? "" : `/${next}`}`;
    move({ section: next, supplierId: next === "suppliers" ? open ?? null : null },
      !open || next === "accounting" ? base : next === "suppliers" ? `${base}/${open}` : `${base}?${OPEN_PARAM[next]}=${open}`);
  };
  const held = state?.bills.filter((bill) => bill.status === "held").length ?? 0;
  const toApprove = state?.canApprove ? state.runs.filter((run) => run.status === "submitted").length : 0;
  // One primary action, for the tab it belongs to: a run on Payment runs, a supplier's invoice on the supplier tabs.
  // Requests: whoever sees the tab may ask Finance for something.
  const action = section === "requests" ? <Button variant="primary" onPress={() => setRaising(true)}>{t("New request")}</Button>
    : !state?.canManage || section === "petty-cash" || section === "client-invoices" || section === "accounting" ? undefined : section === "runs"
    ? <Button variant="primary" onPress={() => setPreparing(true)}>{t("New run")}</Button>
    : <Button variant="primary" onPress={() => setEntering(true)}>{t("Enter invoice")}</Button>;
  const { tabs, content } = moduleTabs<FinanceSection>({ t, value: section, onChange: (key) => go(key), more: MORE, items: ([
      { id: "bills", label: t("Supplier invoices"), count: held,
        panel: <Bills api={api} state={state} error={error} openId={params.get("bill")} onReload={() => void load()} onOpen={(id) => go("bills", id)} /> },
      { id: "payments", label: t("Payments"),
        panel: <Payments api={api} state={state} error={error} openId={params.get("payment")} onReload={() => void load()} onOpen={(id) => go("payments", id)} onOpenBill={(id) => go("bills", id)} /> },
      { id: "runs", label: t("Payment runs"), count: toApprove,
        panel: <PaymentRuns api={api} state={state} error={error} openId={params.get("run")} creating={preparing} onReload={() => void load()} onOpen={(id) => go("runs", id)}
          onCreated={(id) => { setPreparing(false); if (id) go("runs", id); }} /> },
      { id: "suppliers", label: t("Owed to suppliers"),
        panel: <SuppliersOwed api={api} state={state} error={error} openId={supplierId} onReload={() => void load()} onOpen={(id) => go("suppliers", id)} onOpenBill={(id) => go("bills", id)}
          onOpenPayment={(id) => go("payments", id)} /> },
      { id: "petty-cash", label: t("Petty cash"), panel: <PettyCash workspaceId={workspaceId} openId={params.get("claim")} onOpen={(id) => go("petty-cash", id)} /> },
      { id: "client-invoices", label: t("Client invoices"),
        panel: <ClientInvoices api={receivables} openId={params.get("invoice")} onOpen={(id) => go("client-invoices", id)} /> },
      { id: "requests", label: t("Requests"),
        panel: <FinanceRequests workspaceId={workspaceId} openId={params.get("request")} onOpen={(id) => go("requests", id)} raising={raising} onRaised={() => setRaising(false)} /> },
      { id: "accounting", label: t("Accounting"), panel: <AccountingPostings api={accounting} /> },
    ] satisfies Array<ModuleTab<FinanceSection>>).filter((item) => sections.includes(item.id)) });
  return <PageShell title={t("Finance")} action={action} tabs={tabs}>
    {content}
    {entering && state ? <BillEditor api={api} vendors={state.vendors} companies={state.companies} onClose={() => setEntering(false)}
      onSaved={(id) => { setEntering(false); void load(); go("bills", id); }} /> : null}
  </PageShell>;
}
