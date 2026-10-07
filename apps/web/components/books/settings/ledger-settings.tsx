"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseDate } from "@internationalized/date";
import {
  Button, DateField, EmptyState, ErrorState, InlineNotice, isNoAccessError, NoAccessState, SelectField, SettingsPage, Skeleton, Tabs,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { booksSettingsApi, type BooksSettingsApi, type CompanySummary, type LedgerOverview, type LedgerSettingsView } from "@/lib/books/settings-client";
import { AccountsTab } from "./accounts-tab";
import { GeneralTab } from "./general-tab";
import { L } from "./ledger-labels";
import { PaymentAccountsTab } from "./payment-accounts-tab";
import { TaxCodesTab } from "./tax-codes-tab";
import styles from "./ledger-settings.module.css";

const TABS = ["general", "accounts", "tax-codes", "payment-accounts"] as const;

/**
 * Settings › Ledger, per company: turn the Ledger on from a chart template offered for the company's country, then
 * its dates, chart of accounts, tax codes and payment accounts (plan §6.21b). People who set up the Ledger change
 * it; others with Ledger access read it.
 */
export function LedgerSettings({ workspaceId, companyId: initialCompany }: { workspaceId: string; companyId?: string | null }) {
  const t = useT();
  const api = useMemo(() => booksSettingsApi(workspaceId), [workspaceId]);
  const [overview, setOverview] = useState<LedgerOverview | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(initialCompany ?? null);
  const [view, setView] = useState<LedgerSettingsView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("general");

  const load = useCallback(async () => {
    try {
      const next = await api.overview();
      setOverview(next);
      setError(null);
      setCompanyId((current) => current && next.companies.some((company) => company.id === current) ? current : next.companies[0]?.id ?? null);
    } catch (cause) { setError(cause); }
  }, [api]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const company = overview?.companies.find((item) => item.id === companyId) ?? null;
  const turnedOn = Boolean(company?.settings?.templateCode);
  useEffect(() => {
    if (!companyId || !turnedOn) { queueMicrotask(() => setView(null)); return; }
    let live = true;
    api.company(companyId).then((next) => { if (live) setView(next); }).catch((cause) => { if (live) setError(cause); });
    return () => { live = false; };
  }, [api, companyId, turnedOn]);

  if (error && !overview) {
    return isNoAccessError(error) ? <NoAccessState area={t(L.ledger)} />
      : <ErrorState title={t(L.couldNotLoad)} description={error instanceof Error ? error.message : undefined} onRetry={() => void load()} />;
  }
  if (!overview) return <Skeleton lines={6} shape="form" />;

  const picker = overview.companies.length > 1
    ? <SelectField aria-label={t(L.company)} label={null} selectedKey={companyId} onSelectionChange={(key) => { setView(null); setCompanyId(key ? String(key) : null); }}
      items={overview.companies.map((item) => ({ id: item.id, label: item.name }))} />
    : null;

  const changed = (next: LedgerSettingsView) => {
    setView(next);
    setOverview((current) => current && { ...current, companies: current.companies.map((item) => item.id === next.company.id ? next.company : item) });
  };

  return <SettingsPage title={t(L.ledger)} actions={picker} width="wide">
    {!company ? <EmptyState title={t(L.noCompanies)} action={<Link className={styles.link} href="/workspace/legal-entities">{t(L.addCompany)}</Link>} />
      : !turnedOn ? <TurnOn api={api} company={company} canManage={overview.canManage} onDone={(next) => { changed(next); }} />
        : !view ? <Skeleton lines={6} shape="form" />
          : <>
            {error ? <InlineNotice tone="error" message={error instanceof Error ? error.message : t("Could not save.")} /> : null}
            <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as (typeof TABS)[number])} items={[
              { id: "general", label: t(L.general), panel: <GeneralTab api={api} view={view} onChange={changed} /> },
              { id: "accounts", label: t(L.accounts), panel: <AccountsTab api={api} view={view} onChange={changed} /> },
              { id: "tax-codes", label: t(L.taxCodes), panel: <TaxCodesTab api={api} view={view} onChange={changed} /> },
              { id: "payment-accounts", label: t(L.paymentAccounts), panel: <PaymentAccountsTab api={api} view={view} onChange={changed} /> },
            ]} />
          </>}
  </SettingsPage>;
}

/** The empty state of a company without the Ledger: the template its country is offered, the start date, and Turn on Ledger. */
function TurnOn({ api, company, canManage, onDone }: { api: BooksSettingsApi; company: CompanySummary; canManage: boolean; onDone: (view: LedgerSettingsView) => void }) {
  const t = useT();
  const [template, setTemplate] = useState(company.templates.find((item) => item.recommended)?.code ?? company.templates[0]?.code ?? "");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const turnOn = async () => {
    if (!template || !startDate) return;
    setBusy(true); setError("");
    try { onDone(await api.command(company.id, "turn_on", { templateCode: template, startDate })); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    setBusy(false);
  };
  return <EmptyState title={t(L.turnOn)} description={company.name} action={canManage ? <div className={styles.turnOn}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <SelectField label={t(L.chartTemplate)} selectedKey={template || null} onSelectionChange={(key) => setTemplate(key ? String(key) : "")}
      items={company.templates.map((item) => ({ id: item.code, label: item.name }))} />
    <DateField label={t(L.startDate)} value={startDate ? parseDate(startDate) : null} onChange={(value) => setStartDate(value ? value.toString() : null)} />
    <Button variant="primary" isDisabled={!template || !startDate} isLoading={busy} onPress={() => void turnOn()}>{t(L.turnOn)}</Button>
  </div> : undefined} />;
}
