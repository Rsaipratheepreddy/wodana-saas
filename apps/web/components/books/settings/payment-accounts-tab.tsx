"use client";

import { useState } from "react";
import { InlineNotice, SelectField, SettingsRow, SettingsSection } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { BooksSettingsApi, LedgerSettingsView, PaymentAccountView } from "@/lib/books/settings-client";
import { L, METHOD_LABELS } from "./ledger-labels";

const NONE = "none";

/** Payment accounts: where money comes in and goes out, by method (an open bank, cash or clearing account). */
export function PaymentAccountsTab({ api, view, onChange }: { api: BooksSettingsApi; view: LedgerSettingsView; onChange: (view: LedgerSettingsView) => void }) {
  const t = useT();
  const [error, setError] = useState("");
  const choices = view.accounts.filter((account) => account.type === "asset" && !account.isControl && !account.archived)
    .map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }));
  const map = async (row: PaymentAccountView, accountId: string | null) => {
    setError("");
    try { onChange(await api.command(view.company.id, "map_payment_account", { direction: row.direction, method: row.method, accountId, version: row.version })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
  };
  const section = (direction: "in" | "out") => <SettingsSection id={`ledger-payments-${direction}`} title={t(direction === "in" ? L.moneyIn : L.moneyOut)}>
    {view.paymentAccounts.filter((row) => row.direction === direction).map((row) => <SettingsRow key={`${row.direction}-${row.method}`} label={t(METHOD_LABELS[row.method])}>
      <SelectField aria-label={`${t(direction === "in" ? L.moneyIn : L.moneyOut)} · ${t(METHOD_LABELS[row.method])}`} label={null} isDisabled={!view.canManage}
        selectedKey={row.accountId ?? NONE} items={[{ id: NONE, label: t(L.none) }, ...choices]}
        onSelectionChange={(key) => { const next = !key || key === NONE ? null : String(key); if (next !== row.accountId) void map(row, next); }} />
    </SettingsRow>)}
  </SettingsSection>;
  return <>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {section("in")}
    {section("out")}
  </>;
}
