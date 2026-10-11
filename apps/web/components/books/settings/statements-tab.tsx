"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ErrorState, InlineNotice, RadioSet, SaveBar, SettingsSection, Skeleton } from "@/design-system";
import { SOURCE_LABELS, statementsApi, type FinancialStatementSource, type StatementSourceView } from "@/lib/books/statements-client";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import styles from "./ledger-settings.module.css";

const UNAVAILABLE: Record<FinancialStatementSource, MessageKey> = {
  ledger: tKey("Turn the Ledger on first"),
  zoho_books: tKey("Connect Zoho Books first"),
  quickbooks: tKey("Connect QuickBooks first"),
  operational_cash: tKey("Always available"),
};
const DESCRIPTIONS: Record<FinancialStatementSource, MessageKey> = {
  ledger: tKey("Journals posted from invoices, payments and bills"),
  zoho_books: tKey("Reports from the connected Zoho Books"),
  quickbooks: tKey("Reports from the connected QuickBooks"),
  operational_cash: tKey("Wodana's payments, invoices and bills, without full books"),
};

/**
 * Settings › Ledger › Statements: where one company's P&L and cash flow come from — the Wodana Ledger, Zoho Books,
 * QuickBooks or operational cash. Only a source that can serve the company is offered; the choice is version-checked
 * and everyone else who sets up the Ledger is told.
 */
export function StatementsTab({ workspaceId, companyId }: { workspaceId: string; companyId: string }) {
  const t = useT();
  const api = useMemo(() => statementsApi(workspaceId), [workspaceId]);
  const [view, setView] = useState<StatementSourceView | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<FinancialStatementSource | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    api.source(companyId).then((next) => { if (live) { setView(next); setDraft(next.source); setError(""); } })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : t("Could not load.")); });
    return () => { live = false; };
  }, [api, companyId, attempt, t]);
  if (error && !view) return <ErrorState title={t("Could not load.")} description={error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!view) return <Skeleton lines={4} shape="form" />;
  const save = async () => {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const next = await api.setSource({ legalEntityId: companyId, source: draft, expectedVersion: view.version });
      setView(next); setDraft(next.source); setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    setBusy(false);
  };
  const dirty = draft !== view.source || (!view.chosen && draft !== null);
  return <SettingsSection id="ledger-statements" title={view.company.name}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <RadioSet label={t("Where the books live")} value={draft ?? view.source} isDisabled={!view.canManage}
      onChange={(value) => { setDraft(value as FinancialStatementSource); setSaved(false); }}
      items={view.options.map((option) => ({
        id: option.source,
        label: option.label ? `${t(SOURCE_LABELS[option.source])} · ${option.label}` : t(SOURCE_LABELS[option.source]),
        description: option.available ? t(DESCRIPTIONS[option.source]) : t(UNAVAILABLE[option.source]),
        isDisabled: !option.available,
      }))} />
    {view.options.some((option) => !option.available && (option.source === "zoho_books" || option.source === "quickbooks"))
      ? <Link className={styles.link} href="/workspace/integrations">{t("Connect an accounting system")}</Link> : null}
    {view.canManage ? <SaveBar isDirty={dirty} isSaving={busy} saved={saved} onDiscard={() => { setDraft(view.source); setError(""); }} onSave={() => void save()} /> : null}
  </SettingsSection>;
}
