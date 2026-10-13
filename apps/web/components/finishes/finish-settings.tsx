"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, ErrorState, IconButton, InlineNotice, MoneyField, SaveBar, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { EDITOR_SLOTS, libraryApi, type FinishCategory, type SettingsView } from "@/lib/pre-project/finishes";
import styles from "./finishes.module.css";

type Band = { id: string | null; label: string; minAmount: string; maxAmount: string };
type Draft = { categories: FinishCategory[]; specificationGate: boolean; finishesToQsDays: string; materialEditorSlots: string[]; bands: Band[] };

const SLOT_LABEL: Record<(typeof EDITOR_SLOTS)[number], MessageKey> = {
  lead_designer: tKey("Lead designer"), junior_designer: tKey("Junior designer"), sales_admin: tKey("Sales Admin"), visualiser: tKey("Visualiser"), draftsman: tKey("Draftsman"),
  material_coordinator: tKey("Material Coordinator"),
};
const keyOf = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "c_$1").slice(0, 40);
const draftOf = (view: SettingsView): Draft => ({
  categories: view.settings.categories.map((category) => ({ ...category })), specificationGate: view.settings.specificationGate, finishesToQsDays: String(view.settings.finishesToQsDays),
  materialEditorSlots: [...view.settings.materialEditorSlots],
  bands: view.bands.map((band) => ({ id: band.id, label: band.label, minAmount: band.minAmount ?? "", maxAmount: band.maxAmount ?? "" })),
});

/**
 * Settings › Finishes & samples (PLM-146/148/156/157): the finish categories (and which the client signs before
 * procurement orders), whether the final quotation waits for the final specification, the days to send the finishes to
 * QS, who edits the quotation's material column, and the sample library's price bands in the workspace's currency.
 */
export function FinishSettings({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const api = libraryApi(workspaceId);
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    try { const next = await libraryApi(workspaceId).settings(); setView(next); setDraft(draftOf(next)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("The settings didn't load.")); }
  }, [workspaceId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  if (error && !view) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!view || !draft) return <Skeleton lines={6} shape="form" />;
  const canManage = view.canManage;
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(view));
  const change = (next: Partial<Draft>) => { setSaved(false); setDraft({ ...draft, ...next }); };
  const valid = draft.categories.every((category) => category.label.trim() && category.key) && new Set(draft.categories.map((category) => category.key)).size === draft.categories.length
    && Number(draft.finishesToQsDays) >= 1 && Number(draft.finishesToQsDays) <= 60 && draft.bands.every((band) => band.label.trim());
  const save = async () => {
    setSaving(true); setError("");
    try {
      const next = await api.saveSettings({ version: view.settings.version, categories: draft.categories.map((category) => ({ ...category, label: category.label.trim() })),
        specificationGate: draft.specificationGate, finishesToQsDays: Number(draft.finishesToQsDays), materialEditorSlots: draft.materialEditorSlots,
        bands: draft.bands.map((band) => ({ id: band.id, label: band.label.trim(), minAmount: band.minAmount || null, maxAmount: band.maxAmount || null })) });
      setView(next); setDraft(draftOf(next)); setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setSaving(false); }
  };
  const setCategory = (index: number, patch: Partial<FinishCategory>) => change({ categories: draft.categories.map((category, at) => (at === index ? { ...category, ...patch } : category)) });
  const setBand = (index: number, patch: Partial<Band>) => change({ bands: draft.bands.map((band, at) => (at === index ? { ...band, ...patch } : band)) });

  return <SettingsPage title={t("Finishes & samples")}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <SettingsSection id="finish-categories" title={t("Finish categories")}
      actions={canManage ? <Button size="compact" onPress={() => change({ categories: [...draft.categories, { key: "", label: "", clientSignature: false }] })}><Plus aria-hidden="true" size={14} />{t("Add category")}</Button> : undefined}>
      {draft.categories.map((category, index) => <SettingsRow key={index} label={<TextInput aria-label={t("Category name")} label={null} isDisabled={!canManage} maxLength={80} value={category.label}
        onChange={(label) => setCategory(index, { label, ...(view.settings.categories.some((saved) => saved.key === category.key && category.key) ? {} : { key: keyOf(label) }) })} />}>
        <span className={styles.inline}>
          <Switch isDisabled={!canManage} isSelected={category.clientSignature} onChange={(clientSignature) => setCategory(index, { clientSignature })}>{t("Client signs before ordering")}</Switch>
          {canManage ? <IconButton aria-label={t("Remove {name}", { name: category.label || t("category") })} onPress={() => change({ categories: draft.categories.filter((_, at) => at !== index) })}>
            <Trash2 aria-hidden="true" size={14} /></IconButton> : null}
        </span>
      </SettingsRow>)}
    </SettingsSection>
    <SettingsSection id="finish-specification" title={t("Final quotation")}>
      <SettingsRow label={t("Waits for the final specification")} hint={t("Samples approved and the finishes sent to QS. A budget range can go before it.")}>
        <Switch isDisabled={!canManage} isSelected={draft.specificationGate} onChange={(specificationGate) => change({ specificationGate })}>{draft.specificationGate ? t("On") : t("Off")}</Switch>
      </SettingsRow>
      <SettingsRow label={t("Finishes to QS")} hint={t("Days after the samples are approved.")}>
        <TextInput aria-label={t("Finishes to QS")} label={null} isDisabled={!canManage} inputMode="numeric" suffix={t("days")} value={draft.finishesToQsDays}
          onChange={(value) => change({ finishesToQsDays: value.replace(/\D/g, "").slice(0, 2) })} />
      </SettingsRow>
      <SettingsRow label={t("Who edits the material column")} hint={t("Nobody chosen: whoever edits the quotation.")} align="start">
        <span className={styles.inline}>{EDITOR_SLOTS.map((slot) => <Checkbox key={slot} isDisabled={!canManage} isSelected={draft.materialEditorSlots.includes(slot)}
          onChange={(on) => change({ materialEditorSlots: on ? [...draft.materialEditorSlots, slot] : draft.materialEditorSlots.filter((item) => item !== slot) })}>{t(SLOT_LABEL[slot])}</Checkbox>)}</span>
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="sample-bands" title={t("Sample price bands")}
      actions={canManage ? <Button size="compact" onPress={() => change({ bands: [...draft.bands, { id: null, label: "", minAmount: "", maxAmount: "" }] })}><Plus aria-hidden="true" size={14} />{t("Add band")}</Button> : undefined}>
      {draft.bands.map((band, index) => <SettingsRow key={band.id ?? `new-${index}`} label={<TextInput aria-label={t("Band name")} label={null} isDisabled={!canManage} maxLength={80} value={band.label}
        onChange={(label) => setBand(index, { label })} />}>
        <span className={styles.inline}>
          <MoneyField label={t("From")} currency={view.currency ?? undefined} isDisabled={!canManage} value={band.minAmount} onChange={(minAmount) => setBand(index, { minAmount })} />
          <MoneyField label={t("Up to")} currency={view.currency ?? undefined} isDisabled={!canManage} value={band.maxAmount} onChange={(maxAmount) => setBand(index, { maxAmount })} />
          {canManage ? <IconButton aria-label={t("Remove {name}", { name: band.label || t("band") })} onPress={() => change({ bands: draft.bands.filter((_, at) => at !== index) })}>
            <Trash2 aria-hidden="true" size={14} /></IconButton> : null}
        </span>
      </SettingsRow>)}
    </SettingsSection>
    {canManage ? <SaveBar isDirty={dirty} isSaving={saving} saved={saved} isDisabled={!valid} onDiscard={() => { setDraft(draftOf(view)); setSaved(false); }} onSave={() => void save()} /> : null}
  </SettingsPage>;
}
