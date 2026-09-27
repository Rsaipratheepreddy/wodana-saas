"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseDate } from "@internationalized/date";
import { Button, DateField, EmptyState, InlineNotice, SelectField, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextInput, isNoAccessError, NoAccessState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { accountingApi, type AccountingApi } from "@/lib/accounting/client";
import type { AccountingCompany, AccountingConnection, AccountingSettings, ProviderOption } from "@/lib/accounting/types";
import styles from "./accounting.module.css";

type Options = { items: ProviderOption[]; accounts: ProviderOption[]; taxes: ProviderOption[] } | "failed" | null;
const EXPENSE = ["expense", "cost of goods sold", "other expense", "cost of sales"];
const MONEY = ["bank", "cash", "credit card", "other current asset"];

/** Settings → Accounting: for each company, the QuickBooks or Zoho Books account it posts to, from when, and with which item, accounts and tax codes. */
export function AccountingSettingsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const api = useMemo(() => accountingApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<AccountingSettings | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setState(await api.settings()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !state) return isNoAccessError(error) ? <NoAccessState area={t("Accounting")} /> : <EmptyState illustration="error" title={t("Settings didn't load")} description={error} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!state) return <Skeleton lines={6} shape="form" />;
  return <SettingsPage title={t("Accounting")}>
    {!state.connections.length ? <EmptyState title={t("No accounting connection yet")}
      action={<Link className={styles.link} href="/workspace/integrations">{t("Connect QuickBooks or Zoho Books")}</Link>} /> : state.companies.map((company) =>
      <CompanyAccounting key={company.id} api={api} company={company} connections={state.connections.filter((item) => !item.legalEntityId || item.legalEntityId === company.id)}
        onSaved={setState} />)}
  </SettingsPage>;
}

function CompanyAccounting({ api, company, connections, onSaved }: { api: AccountingApi; company: AccountingCompany; connections: AccountingConnection[]; onSaved: (next: AccountingSettings) => void }) {
  const t = useT();
  const link = company.link;
  const [connectionId, setConnectionId] = useState(link?.connectionId ?? (connections.length === 1 ? connections[0].id : ""));
  const [startDate, setStartDate] = useState<string | null>(link?.startDate ?? null);
  const [ids, setIds] = useState({ salesItemId: link?.salesItemId ?? "", expenseAccountId: link?.expenseAccountId ?? "", paymentsAccountId: link?.paymentsAccountId ?? "",
    depositAccountId: link?.depositAccountId ?? "", pettyCashAccountId: link?.pettyCashAccountId ?? "", pettyCashPaidFromId: link?.pettyCashPaidFromId ?? "" });
  const [taxCodes, setTaxCodes] = useState<Record<string, string>>(Object.fromEntries((link?.taxCodes ?? []).map((item) => [item.rate.includes(".") ? item.rate.replace(/\.?0+$/, "") : item.rate, item.providerTaxId])));
  const [active, setActive] = useState(link?.active ?? true);
  const [options, setOptions] = useState<Options>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!connectionId) return;
    let live = true;
    queueMicrotask(() => setOptions(null));
    Promise.all([api.options(connectionId, "items"), api.options(connectionId, "accounts"), api.options(connectionId, "taxes")])
      .then(([items, accounts, taxes]) => { if (live) setOptions({ items, accounts, taxes }); })
      .catch(() => { if (live) setOptions("failed"); });
    return () => { live = false; };
  }, [api, connectionId]);
  const provider = connections.find((item) => item.id === connectionId)?.provider;
  const choose = (label: string, key: keyof typeof ids, list: ProviderOption[] | null, prefer: string[] = []) => {
    if (!list) return <TextInput aria-label={label} label={null} value={ids[key]} onChange={(value) => setIds({ ...ids, [key]: value.trim() })} />;
    const preferred = list.filter((option) => prefer.includes(option.type));
    const shown = prefer.length && preferred.length ? preferred : list;
    return <SelectField aria-label={label} label={null} placeholder={t("Choose")} selectedKey={ids[key] || null} onSelectionChange={(value) => setIds({ ...ids, [key]: value ? String(value) : "" })}
      items={shown.map((option) => ({ id: option.id, label: option.name }))} />;
  };
  const loaded = options && options !== "failed" ? options : null;
  const counts = link?.counts ?? {};
  const attention = (counts.failed ?? 0) + (counts.blocked ?? 0);
  return <SettingsSection id={`accounting-${company.id}`} title={company.name}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {link ? <p className={styles.muted}>{[t("{count} posted", { count: counts.sent ?? 0 }), attention ? t("{count} need attention", { count: attention }) : ""].filter(Boolean).join(" · ")}</p> : null}
    <SettingsRow label={t("Posts to")}>
      <SelectField aria-label={t("Posts to")} label={null} placeholder={t("Choose")} selectedKey={connectionId || null} onSelectionChange={(value) => setConnectionId(value ? String(value) : "")}
        items={connections.map((item) => ({ id: item.id, label: `${item.name} · ${item.provider === "quickbooks" ? "QuickBooks" : "Zoho Books"}` }))} />
    </SettingsRow>
    <SettingsRow label={t("Post from")} hint={t("Documents dated before this stay out of the accounting system.")}>
      <DateField aria-label={t("Post from")} label={null} value={startDate ? parseDate(startDate) : null} onChange={(value) => setStartDate(value ? value.toString() : null)} />
    </SettingsRow>
    {connectionId ? <>
      {options === "failed" ? <InlineNotice tone="info" message={t("The accounting system's lists couldn't be read; enter the IDs.")} /> : null}
      {options === null ? <Skeleton lines={3} shape="form" /> : <>
        <SettingsRow label={t("Item for invoice lines")} hint={provider === "quickbooks" ? t("QuickBooks needs an item on every invoice line.") : undefined}>
          {choose(t("Item for invoice lines"), "salesItemId", loaded?.items ?? null)}
        </SettingsRow>
        <SettingsRow label={t("Expense account for bills")}>{choose(t("Expense account for bills"), "expenseAccountId", loaded?.accounts ?? null, EXPENSE)}</SettingsRow>
        <SettingsRow label={t("Supplier payments from")}>{choose(t("Supplier payments from"), "paymentsAccountId", loaded?.accounts ?? null, MONEY)}</SettingsRow>
        <SettingsRow label={t("Client payments into")}>{choose(t("Client payments into"), "depositAccountId", loaded?.accounts ?? null, MONEY)}</SettingsRow>
        <SettingsRow label={t("Expense account for petty cash")}>{choose(t("Expense account for petty cash"), "pettyCashAccountId", loaded?.accounts ?? null, EXPENSE)}</SettingsRow>
        <SettingsRow label={t("Petty cash paid from")}>{choose(t("Petty cash paid from"), "pettyCashPaidFromId", loaded?.accounts ?? null, MONEY)}</SettingsRow>
        {company.rates.map((rate) => <SettingsRow key={rate} label={t("Tax at {rate}%", { rate })}>
          {loaded ? <SelectField aria-label={t("Tax at {rate}%", { rate })} label={null} placeholder={t("Choose")} selectedKey={taxCodes[rate] || null}
            onSelectionChange={(value) => setTaxCodes({ ...taxCodes, [rate]: value ? String(value) : "" })}
            items={loaded.taxes.map((option) => ({ id: option.id, label: option.rate ? `${option.name} (${option.rate}%)` : option.name }))} />
            : <TextInput aria-label={t("Tax at {rate}%", { rate })} label={null} value={taxCodes[rate] ?? ""} onChange={(value) => setTaxCodes({ ...taxCodes, [rate]: value.trim() })} />}
        </SettingsRow>)}
      </>}
      <SettingsRow label={t("Posting")}>
        <Switch aria-label={t("Posting")} isSelected={active} onChange={setActive} />
      </SettingsRow>
    </> : null}
    <div className={styles.actions}>
      <Button size="compact" variant="primary" isLoading={busy} isDisabled={!connectionId || !startDate} onPress={async () => {
        setBusy(true); setError("");
        try {
          onSaved(await api.saveLink({ legalEntityId: company.id, connectionId, startDate, active, version: link?.version ?? 0, ...Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, value || null])),
            taxCodes: Object.entries(taxCodes).filter(([, value]) => value).map(([rate, providerTaxId]) => ({ rate, providerTaxId })) }));
        } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
        setBusy(false);
      }}>{t("Save")}</Button>
    </div>
  </SettingsSection>;
}
