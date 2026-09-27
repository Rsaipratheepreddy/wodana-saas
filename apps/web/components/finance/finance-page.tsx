"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, PageHeader, Tabs } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { payablesApi } from "@/lib/payables/client";
import { receivablesApi } from "@/lib/receivables/client";
import { accountingApi } from "@/lib/accounting/client";
import type { FinanceSection } from "@/lib/payables/sections";
import type { PayablesState } from "@/lib/payables/types";
import { AccountingPostings } from "./accounting-postings";
import { BillEditor } from "./bill-editor";
import { ClientInvoices } from "./client-invoices";
import { Bills } from "./bills";
import { PaymentRuns } from "./payment-runs";
import { Payments } from "./payments";
import { PettyCash } from "./petty-cash";
import { SuppliersOwed } from "./suppliers-owed";
import styles from "./finance.module.css";

const OPEN_PARAM: Record<Exclude<FinanceSection, "suppliers" | "accounting">, string> = { bills: "bill", payments: "payment", runs: "run", "petty-cash": "claim", "client-invoices": "invoice" };

/** Finance: suppliers' invoices to check and pay, payments and payment runs, what each supplier is owed, petty cash to reimburse, clients' tax invoices, and accounting postings. Records open in place. */
export function FinancePage({ workspaceId, section, supplierId }: { workspaceId: string; section: FinanceSection; supplierId: string | null }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const api = useMemo(() => payablesApi(workspaceId), [workspaceId]);
  const receivables = useMemo(() => receivablesApi(workspaceId), [workspaceId]);
  const accounting = useMemo(() => accountingApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<PayablesState | null>(null);
  const [error, setError] = useState("");
  const [entering, setEntering] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const load = useCallback(async () => {
    try { setState(await api.state()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Finance didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const go = (next: FinanceSection, open?: string | null) => {
    const base = `/workspace/finance${next === "bills" ? "" : `/${next}`}`;
    router.replace(!open || next === "accounting" ? base : next === "suppliers" ? `${base}/${open}` : `${base}?${OPEN_PARAM[next]}=${open}`, { scroll: false });
  };
  const held = state?.bills.filter((bill) => bill.status === "held").length ?? 0;
  const toApprove = state?.canApprove ? state.runs.filter((run) => run.status === "submitted").length : 0;
  // One primary action, for the tab it belongs to: a run on Payment runs, a supplier's invoice on the supplier tabs.
  const action = !state?.canManage || section === "petty-cash" || section === "client-invoices" || section === "accounting" ? undefined : section === "runs"
    ? <Button variant="primary" onPress={() => setPreparing(true)}>{t("New run")}</Button>
    : <Button variant="primary" onPress={() => setEntering(true)}>{t("Enter invoice")}</Button>;
  return <div className={styles.page}>
    <PageHeader title={t("Finance")} actions={action} />
    <Tabs selectedKey={section} onSelectionChange={(key) => go(key as FinanceSection)} items={[
      { id: "bills", label: held ? t("Supplier invoices ({count})", { count: held }) : t("Supplier invoices"),
        panel: <Bills api={api} state={state} error={error} openId={params.get("bill")} onReload={() => void load()} onOpen={(id) => go("bills", id)} /> },
      { id: "payments", label: t("Payments"),
        panel: <Payments api={api} state={state} error={error} openId={params.get("payment")} onReload={() => void load()} onOpen={(id) => go("payments", id)} onOpenBill={(id) => go("bills", id)} /> },
      { id: "runs", label: toApprove ? t("Payment runs ({count})", { count: toApprove }) : t("Payment runs"),
        panel: <PaymentRuns api={api} state={state} error={error} openId={params.get("run")} creating={preparing} onReload={() => void load()} onOpen={(id) => go("runs", id)}
          onCreated={(id) => { setPreparing(false); if (id) go("runs", id); }} /> },
      { id: "suppliers", label: t("Owed to suppliers"),
        panel: <SuppliersOwed api={api} state={state} error={error} openId={supplierId} onReload={() => void load()} onOpen={(id) => go("suppliers", id)} onOpenBill={(id) => go("bills", id)}
          onOpenPayment={(id) => go("payments", id)} /> },
      { id: "petty-cash", label: t("Petty cash"), panel: <PettyCash workspaceId={workspaceId} openId={params.get("claim")} onOpen={(id) => go("petty-cash", id)} /> },
      { id: "client-invoices", label: t("Client invoices"),
        panel: <ClientInvoices api={receivables} openId={params.get("invoice")} onOpen={(id) => go("client-invoices", id)} /> },
      { id: "accounting", label: t("Accounting"), panel: <AccountingPostings api={accounting} /> },
    ]} />
    {entering && state ? <BillEditor api={api} vendors={state.vendors} companies={state.companies} onClose={() => setEntering(false)}
      onSaved={(id) => { setEntering(false); void load(); go("bills", id); }} /> : null}
  </div>;
}
