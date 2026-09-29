"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button, EmptyState, InlineNotice, SaveBar, SelectField, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { quotationPath } from "@/lib/quotation/client";
import { VIEW_LABEL } from "@/lib/quotation/format";
import type { QuotationSettings as Settings, QuoteView } from "@/lib/quotation/types";
import { ProposalKitSettings } from "./proposal-kit-settings";
import styles from "./quotation-settings.module.css";

type Loaded = { settings: Settings; workPackages: Array<{ id: string; name: string; archived: boolean }>; priceBooks: Array<{ id: string; name: string; currency: string; status: string }>; canManage: boolean };

async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "Could not save.");
  return data as T;
}

/**
 * Settings → Quotations: how this firm prices (tax-inclusive or not, rounding, markup, margin floor,
 * the discount that needs approval, validity), its proposal kit and its work packages. Nothing here is fixed in code.
 */
export function QuotationSettingsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const [data, setData] = useState<Loaded | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trade, setTrade] = useState("");
  const [days, setDays] = useState("");
  const load = useCallback(async () => {
    try { const next = await call<Loaded>(quotationPath(workspaceId, "settings")); setData(next); setForm(next.settings); setDays(dayList(next.settings)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [workspaceId, t]);
  useEffect(() => {
    let alive = true;
    call<Loaded>(quotationPath(workspaceId, "settings")).then((next) => { if (alive) { setData(next); setForm(next.settings); setDays(dayList(next.settings)); } }).catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [workspaceId]);

  if (error && !data) return <EmptyState illustration="error" title={t("Settings didn't load")} description={error} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!data || !form) return <Skeleton lines={6} shape="form" />;
  const readOnly = !data.canManage;
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => { setForm({ ...form, [key]: value }); setSaved(false); };
  const number = (value: string) => value.replace(/[^\d.]/g, "");

  const save = async () => {
    setBusy(true); setError("");
    try {
      const next = await call<Settings>(quotationPath(workspaceId, "settings"), "PUT", { ...form, marginFloorPercent: form.marginFloorPercent || null, discountApprovalPercent: form.discountApprovalPercent || null });
      setData({ ...data, settings: next }); setForm(next); setDays(dayList(next)); setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  const addTrade = async () => {
    const name = trade.trim();
    if (!name) return;
    try { await call(quotationPath(workspaceId, "work-packages"), "POST", { id: crypto.randomUUID(), name }); setTrade(""); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
  };
  const updateTrade = async (id: string, patch: { name?: string; archived?: boolean }) => {
    try { const list = await call<Loaded["workPackages"]>(quotationPath(workspaceId, `work-packages/${id}`), "PATCH", patch); setData({ ...data, workPackages: list }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
  };

  return <SettingsPage title={t("Quotations")}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <SettingsSection id="pricing" title={t("Pricing")}>
      <SettingsRow label={t("Prices include tax")} hint={t("Rates you type already contain tax; tax is worked out from them.")}>
        <Switch aria-label={t("Prices include tax")} isDisabled={readOnly} isSelected={form.pricesIncludeTax} onChange={(value) => set("pricesIncludeTax", value)} />
      </SettingsRow>
      <SettingsRow label={t("Rounding")} hint={t("Round every line, or only the totals.")}>
        <SelectField aria-label={t("Rounding")} label={null} accent="neutral" isDisabled={readOnly} selectedKey={form.rounding} onSelectionChange={(key) => set("rounding", key as Settings["rounding"])}
          items={[{ id: "line", label: t("Each line") }, { id: "document", label: t("Totals only") }]} />
      </SettingsRow>
      <SettingsRow label={t("Default markup %")} hint={t("Added to cost when a rate comes from cost.")}>
        <TextInput aria-label={t("Default markup %")} label={null} isReadOnly={readOnly} inputMode="decimal" value={form.defaultMarkupPercent} onChange={(value) => set("defaultMarkupPercent", number(value))} />
      </SettingsRow>
      <SettingsRow label={t("Minimum margin %")} hint={t("Quotes below this are flagged. Leave empty for none.")}>
        <TextInput aria-label={t("Minimum margin %")} label={null} isReadOnly={readOnly} inputMode="decimal" value={form.marginFloorPercent ?? ""} onChange={(value) => set("marginFloorPercent", number(value) || null)} />
      </SettingsRow>
      <SettingsRow label={t("Discount needing approval %")} hint={t("Discounts above this need a manager's approval. Leave empty for none.")}>
        <TextInput aria-label={t("Discount needing approval %")} label={null} isReadOnly={readOnly} inputMode="decimal" value={form.discountApprovalPercent ?? ""} onChange={(value) => set("discountApprovalPercent", number(value) || null)} />
      </SettingsRow>
      {data.priceBooks.length ? <SettingsRow label={t("Price book")} hint={t("Where catalog rates come from. Automatic uses the newest active book in the quote's currency.")}>
        <SelectField aria-label={t("Price book")} label={null} accent="neutral" isDisabled={readOnly} selectedKey={form.priceBookId ?? ""} onSelectionChange={(key) => set("priceBookId", key ? String(key) : null)}
          items={[{ id: "", label: t("Automatic") }, ...data.priceBooks.map((book) => ({ id: book.id, label: `${book.name} · ${book.currency}` }))]} />
      </SettingsRow> : null}
    </SettingsSection>

    <SettingsSection id="quotes" title={t("Quotes")}>
      <SettingsRow label={t("Default view")} hint={t("How a new quote is grouped. Anyone can switch while working.")}>
        <SelectField aria-label={t("Default view")} label={null} accent="neutral" isDisabled={readOnly} selectedKey={form.defaultView} onSelectionChange={(key) => set("defaultView", key as QuoteView)}
          items={(["area", "trade", "area_trade"] as QuoteView[]).map((id) => ({ id, label: t(VIEW_LABEL[id] as never) }))} />
      </SettingsRow>
      <SettingsRow label={t("Valid for (days)")}>
        <TextInput aria-label={t("Valid for (days)")} label={null} isReadOnly={readOnly} inputMode="numeric" value={String(form.validityDays)} onChange={(value) => set("validityDays", Number(value.replace(/\D/g, "") || 0))} />
      </SettingsRow>
      <SettingsRow label={t("Warn before a quote expires (days)")} hint={t("The case owner and the client hear it this many days before. 0 for none.")}>
        <TextInput aria-label={t("Warn before a quote expires (days)")} label={null} isReadOnly={readOnly} inputMode="numeric" value={String(form.expiryWarningDays ?? 0)} onChange={(value) => set("expiryWarningDays", Number(value.replace(/\D/g, "") || 0))} />
      </SettingsRow>
      <SettingsRow label={t("Remind the client after (days)")} hint={t("While a quote or design waits, the client and the case owner hear on each of these days. Leave empty for none.")}>
        <TextInput aria-label={t("Remind the client after (days)")} label={null} isReadOnly={readOnly} inputMode="numeric" value={days}
          onChange={(value) => { const clean = value.replace(/[^\d,\s]/g, ""); setDays(clean); set("decisionReminderDays", clean.split(/[,\s]+/).map(Number).filter((day) => Number.isInteger(day) && day > 0)); }} />
      </SettingsRow>
      <SettingsRow label={t("Review before sending")} hint={t("A reviewer approves each quote before it goes to the client.")}>
        <Switch aria-label={t("Review before sending")} isDisabled={readOnly} isSelected={form.internalReview} onChange={(value) => set("internalReview", value)} />
      </SettingsRow>
    </SettingsSection>
    {readOnly ? null : <SaveBar isDirty={dirty} isSaving={busy} saved={saved} onDiscard={() => { setForm(data.settings); setDays(dayList(data.settings)); setError(""); }} onSave={() => void save()} />}

    <ProposalKitSettings workspaceId={workspaceId} />

    <SettingsSection id="work-packages" title={t("Work packages")}>
      {data.workPackages.length ? <ul className={styles.trades}>{data.workPackages.map((item) => <li key={item.id} data-archived={item.archived || undefined}>
        <TradeName name={item.name} readOnly={readOnly || item.archived} onRename={(name) => void updateTrade(item.id, { name })} />
        {readOnly ? null : <Button size="compact" variant="quiet" onPress={() => void updateTrade(item.id, { archived: !item.archived })}>{item.archived ? t("Restore") : t("Archive")}</Button>}
      </li>)}</ul> : <p className={styles.muted}>{t("No work packages yet. Add the trades you quote by, like joinery or electrical.")}</p>}
      {readOnly ? null : <form className={styles.addTrade} onSubmit={(event) => { event.preventDefault(); void addTrade(); }}>
        <TextInput aria-label={t("New work package")} label={null} placeholder={t("New work package")} value={trade} onChange={setTrade} />
        <Button size="compact" type="submit" isDisabled={!trade.trim()}><Plus aria-hidden="true" size={14} />{t("Add")}</Button>
      </form>}
    </SettingsSection>
  </SettingsPage>;
}

const dayList = (settings: Settings) => (settings.decisionReminderDays ?? []).join(", ");

function TradeName({ name, readOnly, onRename }: { name: string; readOnly: boolean; onRename: (name: string) => void }) {
  const t = useT();
  const [value, setValue] = useState(name);
  return <input className={styles.tradeInput} aria-label={t("Work package name")} disabled={readOnly} value={value} onChange={(event) => setValue(event.target.value)}
    onBlur={() => { if (value.trim() && value.trim() !== name) onRename(value.trim()); else setValue(name); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}
