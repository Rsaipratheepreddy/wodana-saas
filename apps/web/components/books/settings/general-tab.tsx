"use client";

import { useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import {
  ConfirmationDialog, DateField, InlineNotice, SaveBar, SelectField, SettingsRow, SettingsSection, Switch, useDesignSystem,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { BooksSettingsApi, LedgerSettingsView } from "@/lib/books/settings-client";
import { L } from "./ledger-labels";
import styles from "./ledger-settings.module.css";

type Draft = { enabled: boolean; startDate: string; lockDate: string | null; fiscalYearStartMonth: number; taxPointOnPayment: boolean; vatRegion: string | null };

/** General: on or off, the start and lock dates (a new lock date asks first), the fiscal year, when tax is due and the region of supply. */
export function GeneralTab({ api, view, onChange }: { api: BooksSettingsApi; view: LedgerSettingsView; onChange: (view: LedgerSettingsView) => void }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const settings = view.company.settings!;
  const saved: Draft = { enabled: settings.enabled, startDate: settings.startDate, lockDate: settings.lockDate, fiscalYearStartMonth: settings.fiscalYearStartMonth,
    taxPointOnPayment: settings.taxPointOnPayment, vatRegion: settings.vatRegion };
  const [draft, setDraft] = useState<Draft>(saved);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const changed = (Object.keys(saved) as Array<keyof Draft>).filter((key) => draft[key] !== saved[key]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => ({
    id: String(index + 1), label: new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, index, 15))) })), [locale]);
  const template = view.company.templates.find((item) => item.code === settings.templateCode);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setJustSaved(false); };

  const save = async (confirmLockDate: boolean) => {
    setBusy(true); setError("");
    try {
      const input: Record<string, unknown> = { version: settings.version, confirmLockDate };
      for (const key of changed) input[key] = draft[key];
      const next = await api.command(view.company.id, "update_settings", input);
      onChange(next);
      const after = next.company.settings!;
      setDraft({ enabled: after.enabled, startDate: after.startDate, lockDate: after.lockDate, fiscalYearStartMonth: after.fiscalYearStartMonth,
        taxPointOnPayment: after.taxPointOnPayment, vatRegion: after.vatRegion });
      setJustSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    setBusy(false); setConfirming(false);
  };

  const readOnly = !view.canManage;
  return <SettingsSection id="ledger-general" title={view.company.name}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <SettingsRow label={t(L.chartTemplate)}><span className={styles.value}>{template?.name ?? settings.templateCode} · {settings.functionalCurrency}</span></SettingsRow>
    <SettingsRow label={t(L.ledgerOn)}>
      <Switch aria-label={t(L.ledgerOn)} isDisabled={readOnly} isSelected={draft.enabled} onChange={(value) => set("enabled", value)} />
    </SettingsRow>
    <SettingsRow label={t(L.startDate)} hint={view.hasJournals ? t(L.startFixed) : undefined}>
      <DateField aria-label={t(L.startDate)} label={null} isDisabled={readOnly || view.hasJournals} value={parseDate(draft.startDate)}
        onChange={(value) => value && set("startDate", value.toString())} />
    </SettingsRow>
    <SettingsRow label={t(L.lockDate)} hint={t(L.lockDateHint)}>
      <DateField aria-label={t(L.lockDate)} label={null} isDisabled={readOnly} value={draft.lockDate ? parseDate(draft.lockDate) : null}
        maxValue={parseDate(view.today)} onChange={(value) => set("lockDate", value ? value.toString() : null)} />
    </SettingsRow>
    <SettingsRow label={t(L.fiscalYearStarts)}>
      <SelectField aria-label={t(L.fiscalYearStarts)} label={null} isDisabled={readOnly} selectedKey={String(draft.fiscalYearStartMonth)}
        onSelectionChange={(key) => key && set("fiscalYearStartMonth", Number(key))} items={months} />
    </SettingsRow>
    <SettingsRow label={t(L.taxOnPayment)} hint={t(L.taxOnPaymentHint)}>
      <Switch aria-label={t(L.taxOnPayment)} isDisabled={readOnly} isSelected={draft.taxPointOnPayment} onChange={(value) => set("taxPointOnPayment", value)} />
    </SettingsRow>
    {view.regions.options.length ? <SettingsRow label={view.regions.label || t(L.region)}>
      <SelectField aria-label={view.regions.label || t(L.region)} label={null} isDisabled={readOnly} placeholder={t(L.none)} selectedKey={draft.vatRegion}
        onSelectionChange={(key) => set("vatRegion", key ? String(key) : null)} items={view.regions.options.map((region) => ({ id: region.code, label: region.name }))} />
    </SettingsRow> : null}
    {readOnly ? null : <SaveBar isDirty={changed.length > 0} isSaving={busy} saved={justSaved} onDiscard={() => { setDraft(saved); setError(""); }}
      onSave={() => changed.includes("lockDate") ? setConfirming(true) : void save(false)} />}
    <ConfirmationDialog isOpen={confirming} onOpenChange={setConfirming} isConfirming={busy} confirmVariant="primary"
      title={draft.lockDate ? t(L.confirmLockTitle, { date: draft.lockDate }) : t(L.confirmUnlockTitle)}
      body={<p className={styles.value}>{draft.lockDate ? `${t(L.lockDateHint)} ${t(L.confirmLockBody)}` : t(L.confirmLockBody)}</p>}
      confirmLabel={draft.lockDate ? t(L.lock) : t(L.save)} onConfirm={() => void save(true)} />
  </SettingsSection>;
}
