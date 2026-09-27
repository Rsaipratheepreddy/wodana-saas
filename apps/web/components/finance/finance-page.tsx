"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, PageHeader, Tabs } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { payablesApi } from "@/lib/payables/client";
import type { FinanceSection } from "@/lib/payables/sections";
import type { PayablesState } from "@/lib/payables/types";
import { BillEditor } from "./bill-editor";
import { Bills } from "./bills";
import { Payments } from "./payments";
import { SuppliersOwed } from "./suppliers-owed";
import styles from "./finance.module.css";

/** Finance: suppliers' invoices to check and pay, payments made, and what each supplier is owed. Records open in place. */
export function FinancePage({ workspaceId, section, supplierId }: { workspaceId: string; section: FinanceSection; supplierId: string | null }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const api = useMemo(() => payablesApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<PayablesState | null>(null);
  const [error, setError] = useState("");
  const [entering, setEntering] = useState(false);
  const load = useCallback(async () => {
    try { setState(await api.state()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Finance didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const go = (next: FinanceSection, open?: string | null) => {
    const base = `/workspace/finance${next === "bills" ? "" : `/${next}`}`;
    router.replace(!open ? base : next === "suppliers" ? `${base}/${open}` : `${base}?${next === "bills" ? "bill" : "payment"}=${open}`, { scroll: false });
  };
  const held = state?.bills.filter((bill) => bill.status === "held").length ?? 0;
  return <div className={styles.page}>
    <PageHeader title={t("Finance")} actions={state?.canManage ? <Button variant="primary" onPress={() => setEntering(true)}>{t("Enter invoice")}</Button> : undefined} />
    <Tabs selectedKey={section} onSelectionChange={(key) => go(key as FinanceSection)} items={[
      { id: "bills", label: held ? t("Supplier invoices ({count})", { count: held }) : t("Supplier invoices"),
        panel: <Bills api={api} state={state} error={error} openId={params.get("bill")} onReload={() => void load()} onOpen={(id) => go("bills", id)} /> },
      { id: "payments", label: t("Payments"),
        panel: <Payments api={api} state={state} error={error} openId={params.get("payment")} onReload={() => void load()} onOpen={(id) => go("payments", id)} onOpenBill={(id) => go("bills", id)} /> },
      { id: "suppliers", label: t("Owed to suppliers"),
        panel: <SuppliersOwed api={api} state={state} error={error} openId={supplierId} onReload={() => void load()} onOpen={(id) => go("suppliers", id)} onOpenBill={(id) => go("bills", id)}
          onOpenPayment={(id) => go("payments", id)} /> },
    ]} />
    {entering && state ? <BillEditor api={api} vendors={state.vendors} companies={state.companies} onClose={() => setEntering(false)}
      onSaved={(id) => { setEntering(false); void load(); go("bills", id); }} /> : null}
  </div>;
}
