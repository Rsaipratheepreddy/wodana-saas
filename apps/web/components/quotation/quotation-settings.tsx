"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, Checkbox, EmptyState, Form, FormDialog, FormNotSaved, IconButton, InlineNotice, PercentageInput, SaveBar, SelectField, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextInput } from "@/design-system";
import { commercialPath } from "@/lib/commercial/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { quotationPath } from "@/lib/quotation/client";
import { VIEW_LABEL } from "@/lib/quotation/format";
import type { QuotationSettings as Settings, QuoteView } from "@/lib/quotation/types";
import { ProposalKitSettings } from "./proposal-kit-settings";
import { qsItemTypeLabels } from "./quote-qs";
import { ProposalTemplateSettings } from "./proposal-template-settings";
import { QuotationNumberingSettings } from "./quotation-numbering-settings";
import styles from "./quotation-settings.module.css";

/** Catalogue kinds a firm can mark for QS review, in the order the server keeps them (sorted). */
const QS_ITEM_TYPES = ["assembly", "material", "package", "product", "ready_made", "service"] as const;

type Loaded = { settings: Settings; workPackages: Array<{ id: string; name: string; archived: boolean; qsReview?: boolean }>; priceBooks: Array<{ id: string; name: string; currency: string; status: string }>;
  paymentTemplates?: Array<{ id: string; name: string }>; canManage: boolean };

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
  const [creatingPlan, setCreatingPlan] = useState(false);
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
  const kinds = qsItemTypeLabels(t);

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
  const updateTrade = async (id: string, patch: { name?: string; archived?: boolean; qsReview?: boolean }) => {
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
      <SettingsRow label={t("Markup shown to clients")} hint={t("The same on the quote, the PDF and the client portal. The total never changes.")}>
        <SelectField aria-label={t("Markup shown to clients")} label={null} accent="neutral" isDisabled={readOnly} selectedKey={form.markupDisclosure ?? "all_inclusive"}
          onSelectionChange={(key) => set("markupDisclosure", key as Settings["markupDisclosure"])}
          items={[{ id: "all_inclusive", label: t("All-inclusive prices") }, { id: "disclosed_markup", label: t("Cost and markup on each line") }, { id: "fee_based", label: t("Items at cost plus our fee") }]} />
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
      <SettingsRow label={t("Default payment plan")} hint={t("A new quote starts with these milestones; change them on the quote.")}>
        {data.paymentTemplates?.length ? <SelectField aria-label={t("Default payment plan")} label={null} accent="neutral" isDisabled={readOnly} selectedKey={form.defaultPaymentTemplateId ?? ""} onSelectionChange={(key) => set("defaultPaymentTemplateId", key ? String(key) : null)}
          items={[{ id: "", label: t("None") }, ...data.paymentTemplates.map((template) => ({ id: template.id, label: template.name }))]} />
          : readOnly ? <span className={styles.muted}>{t("None")}</span>
            : <Button size="compact" onPress={() => setCreatingPlan(true)}><Plus aria-hidden="true" size={14} />{t("Create payment plan")}</Button>}
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
      <SettingsRow label={t("QS prices quotations")} hint={t("A QS confirms the pricing before a quotation can go to the client.")}>
        <Switch aria-label={t("QS prices quotations")} isDisabled={readOnly} isSelected={Boolean(form.qsReview)} onChange={(value) => set("qsReview", value)} />
      </SettingsRow>
      {form.qsReview ? <SettingsRow label={t("Quotations the QS prices")} hint={t("Rules: work packages and catalogue kinds marked for QS review, and orders that need a BOQ. Design Fee proposals skip the QS.")}>
        <SelectField aria-label={t("Quotations the QS prices")} label={null} accent="neutral" isDisabled={readOnly} selectedKey={form.qsReviewScope ?? "all"}
          onSelectionChange={(key) => set("qsReviewScope", key === "rules" ? "rules" : "all")}
          items={[{ id: "all", label: t("Every quotation") }, { id: "rules", label: t("Only where the rules apply") }]} />
      </SettingsRow> : null}
      {form.qsReview && form.qsReviewScope === "rules" ? <SettingsRow align="start" label={t("Catalogue kinds for QS review")}>
        <div className={styles.kinds}>{QS_ITEM_TYPES.map((type) => <Checkbox key={type} isDisabled={readOnly} isSelected={(form.qsReviewItemTypes ?? []).includes(type)}
          onChange={(on) => set("qsReviewItemTypes", QS_ITEM_TYPES.filter((item) => (item === type ? on : (form.qsReviewItemTypes ?? []).includes(item))))}>{kinds[type]}</Checkbox>)}</div>
      </SettingsRow> : null}
      <SettingsRow label={t("Signing link open for (days)")}>
        <TextInput aria-label={t("Signing link open for (days)")} label={null} isReadOnly={readOnly} inputMode="numeric" value={String(form.signingLinkDays ?? 14)}
          onChange={(value) => set("signingLinkDays", Number(value.replace(/\D/g, "") || 0))} />
      </SettingsRow>
    </SettingsSection>

    <SettingsSection id="sales" title={t("Sales")}>
      <SettingsRow label={t("Intro deck link")} hint={t("Shown on every opportunity, next to the intro meeting.")}>
        <TextInput aria-label={t("Intro deck link")} label={null} isReadOnly={readOnly} inputType="url" placeholder="https://" value={form.introDeckUrl ?? ""}
          onChange={(value) => set("introDeckUrl", value.trim() ? value.trim() : null)} />
      </SettingsRow>
    </SettingsSection>
    {creatingPlan ? <PaymentPlanDialog workspaceId={workspaceId} onClose={() => setCreatingPlan(false)} onCreated={async (templateId) => {
      // The new plan becomes the default straight away (the rest of the form keeps its unsaved edits).
      const next = await call<Settings>(quotationPath(workspaceId, "settings"), "PUT", { ...data.settings, defaultPaymentTemplateId: templateId });
      const fresh = await call<Loaded>(quotationPath(workspaceId, "settings"));
      setData(fresh); setForm({ ...form, defaultPaymentTemplateId: templateId, version: next.version }); setCreatingPlan(false);
    }} /> : null}
    {readOnly ? null : <SaveBar isDirty={dirty} isSaving={busy} saved={saved} onDiscard={() => { setForm(data.settings); setDays(dayList(data.settings)); setError(""); }} onSave={() => void save()} />}

    <QuotationNumberingSettings workspaceId={workspaceId} />

    <ProposalTemplateSettings workspaceId={workspaceId} />

    <ProposalKitSettings workspaceId={workspaceId} />

    <SettingsSection id="work-packages" title={t("Work packages")}>
      {data.workPackages.length ? <ul className={styles.trades}>{data.workPackages.map((item) => <li key={item.id} data-archived={item.archived || undefined}>
        <TradeName name={item.name} readOnly={readOnly || item.archived} onRename={(name) => void updateTrade(item.id, { name })} />
        {form.qsReview && form.qsReviewScope === "rules" && !item.archived ? <Checkbox isDisabled={readOnly} isSelected={Boolean(item.qsReview)}
          onChange={(qsReview) => void updateTrade(item.id, { qsReview })}>{t("QS review")}</Checkbox> : null}
        {readOnly ? null : <Button size="compact" variant="quiet" onPress={() => void updateTrade(item.id, { archived: !item.archived })}>{item.archived ? t("Restore") : t("Archive")}</Button>}
      </li>)}</ul> : <p className={styles.muted}>{t("No work packages yet. Add the trades you quote by, like joinery or electrical.")}</p>}
      {readOnly ? null : <Form className={styles.addTrade} fieldMarkers="none" onSubmit={(event) => { event.preventDefault(); void addTrade(); }}>
        <TextInput aria-label={t("New work package")} label={null} maxLength={80} placeholder={t("New work package")} value={trade} onChange={setTrade} />
        <Button size="compact" type="submit" isDisabled={!trade.trim()}><Plus aria-hidden="true" size={14} />{t("Add")}</Button>
      </Form>}
    </SettingsSection>
  </SettingsPage>;
}

const dayList = (settings: Settings) => (settings.decisionReminderDays ?? []).join(", ");

type Milestone = { id: string; title: string; percent: number; trigger: string; requiredForRelease: boolean };

/**
 * The firm's first payment plan, made here: named milestones that add up to 100%, at least one of them paid before
 * work starts. It starts as a common three-step plan to change.
 */
function PaymentPlanDialog({ workspaceId, onClose, onCreated }: { workspaceId: string; onClose: () => void; onCreated: (templateId: string) => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState(() => t("Standard payment plan"));
  const [rows, setRows] = useState<Milestone[]>(() => [
    { id: crypto.randomUUID(), title: t("Advance"), percent: 50, trigger: t("On signing"), requiredForRelease: true },
    { id: crypto.randomUUID(), title: t("Before installation"), percent: 40, trigger: t("Before installation starts"), requiredForRelease: false },
    { id: crypto.randomUUID(), title: t("On handover"), percent: 10, trigger: t("At handover"), requiredForRelease: false },
  ]);
  const [error, setError] = useState("");
  const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.percent) ? row.percent : 0), 0);
  const update = (id: string, patch: Partial<Milestone>) => setRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const problem = !name.trim() ? t("Name the plan.") : rows.some((row) => !row.title.trim() || !row.trigger.trim() || !(row.percent > 0)) ? t("Give every milestone a name, a share and when it's due.")
    : Math.abs(total - 100) > 0.001 ? t("The milestones add up to {total}%, not 100%.", { total: Math.round(total * 100) / 100 })
      : !rows.some((row) => row.requiredForRelease) ? t("Mark at least one milestone as paid before work starts.") : "";
  return <FormDialog title={t("Create payment plan")} size="lg" onClose={onClose} submitLabel={t("Create and use")} isSubmitDisabled={Boolean(problem)} error={error || undefined}
    onSubmit={async () => {
      setError("");
      try {
        const created = await call<{ id: string }>(commercialPath(workspaceId, "payment-templates"), "POST", { name: name.trim(), milestones: rows.map((row) => ({ ...row, title: row.title.trim(), trigger: row.trigger.trim() })) });
        await onCreated(created.id);
      } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); throw new FormNotSaved(); }
    }}>
    <TextInput label={t("Name")} isRequired maxLength={160} value={name} onChange={setName} />
    <ul className={styles.milestones}>{rows.map((row, index) => <li key={row.id}>
      <TextInput label={t("Milestone")} isRequired maxLength={160} value={row.title} onChange={(title) => update(row.id, { title })} />
      <PercentageInput label={t("Share")} isRequired minValue={0.01} value={row.percent} onChange={(percent) => update(row.id, { percent })} />
      <TextInput label={t("When")} isRequired maxLength={300} value={row.trigger} onChange={(trigger) => update(row.id, { trigger })} />
      <Checkbox isSelected={row.requiredForRelease} onChange={(requiredForRelease) => update(row.id, { requiredForRelease })}>{t("Paid before work starts")}</Checkbox>
      {rows.length > 1 ? <IconButton aria-label={t("Remove milestone {number}", { number: index + 1 })} size="compact" variant="quiet" onPress={() => setRows(rows.filter((item) => item.id !== row.id))}><X aria-hidden="true" size={14} /></IconButton> : null}
    </li>)}</ul>
    {rows.length < 20 ? <Button size="compact" variant="quiet" onPress={() => setRows([...rows, { id: crypto.randomUUID(), title: "", percent: Math.max(0, Math.round((100 - total) * 100) / 100), trigger: "", requiredForRelease: false }])}>
      <Plus aria-hidden="true" size={14} />{t("Add milestone")}</Button> : null}
    {problem ? <p className={styles.muted} role="status">{problem}</p> : null}
  </FormDialog>;
}

function TradeName({ name, readOnly, onRename }: { name: string; readOnly: boolean; onRename: (name: string) => void }) {
  const t = useT();
  const [value, setValue] = useState(name);
  // A rename saves when the field is left or on Enter; an empty name puts the saved one back.
  const commit = () => { if (value.trim() && value.trim() !== name) onRename(value.trim()); else setValue(name); };
  return <TextInput aria-label={t("Work package name")} label={null} isDisabled={readOnly} maxLength={80} value={value} onChange={setValue}
    onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />;
}
