"use client";

import { useEffect, useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button, ComboboxField, FormSection, IconButton, InlineNotice, SelectField, Switch, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { AiPauseNotice } from "@/components/workspace/ai-pause-notice";
import { isAiPauseMessage } from "@/lib/ai/pause";
import { loadAiSettings } from "@/lib/workspace/ai-settings";
import { catalogApi, type CatalogItemRow, type CatalogStructure } from "@/lib/workspace/catalog-v2";
import styles from "./catalog-page.module.css";

export type EditableItem = {
  id: string; code: string; name: string; itemType: string; unitCode: string; categoryId?: string | null; description: string | null;
  wastePercent: string | null; purchaseRoundTo: string | null; values: Record<string, string>; version: number;
  components: Array<{ componentItemId: string; name: string; quantityFormula: string; unitCode: string }>;
};

const decimal = (value: string) => value.replace(/[^\d.]/g, "");

/** Edit an item's facts and attribute values; typed fields follow each attribute's type. */
export function CatalogItemForm({ workspaceId, catalogId, item, structure, onSaved, onCancel }: { workspaceId: string; catalogId: string; item: EditableItem; structure: CatalogStructure; onSaved: () => void; onCancel: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState({ code: item.code, name: item.name, itemType: item.itemType, unitCode: item.unitCode, categoryId: item.categoryId ?? "", description: item.description ?? "", wastePercent: item.wastePercent ? String(Number(item.wastePercent)) : "", purchaseRoundTo: item.purchaseRoundTo ? String(Number(item.purchaseRoundTo)) : "" });
  const [values, setValues] = useState<Record<string, string>>(item.values);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof draft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const types = [{ id: "product", label: t("Product") }, { id: "material", label: t("Material") }, { id: "assembly", label: t("Assembly") }, { id: "service", label: t("Service") }, { id: "package", label: t("Package") }, { id: "ready_made", label: t("Ready-made") }];
  // Attributes that apply: catalog-wide ones and those of the chosen category.
  const attributes = structure.attributes.filter((attribute) => !attribute.categoryId || attribute.categoryId === draft.categoryId);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await catalogApi(workspaceId, `${catalogId}/items/${item.id}`, { method: "PUT", body: {
        version: item.version, ...draft, categoryId: draft.categoryId || undefined, description: draft.description || undefined,
        wastePercent: draft.wastePercent || undefined, purchaseRoundTo: draft.purchaseRoundTo || undefined,
        values: Object.fromEntries(attributes.map((attribute) => [attribute.code, values[attribute.code] ?? ""]).filter(([, value]) => value !== "")),
      } });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : ""); }
    finally { setSaving(false); }
  };
  return <form className={styles.form} onSubmit={submit}>
    {error ? <InlineNotice message={error} tone="error" /> : null}
    <FormSection>
      <TextInput isRequired label={t("Name")} onChange={set("name")} value={draft.name} />
      <TextInput isRequired label={t("Code")} onChange={set("code")} value={draft.code} />
      <SelectField isRequired items={types} label={t("Type")} onSelectionChange={(key) => set("itemType")(String(key))} selectedKey={draft.itemType} />
      <SelectField items={[{ id: "", label: t("No category") }, ...structure.categories.map((category) => ({ id: category.id, label: category.name }))]} label={t("Category")} onSelectionChange={(key) => set("categoryId")(String(key ?? ""))} selectedKey={draft.categoryId} />
    </FormSection>
    {attributes.length ? <FormSection title={t("Attributes")}>
      {attributes.map((attribute) => {
        const value = values[attribute.code] ?? "";
        const change = (next: string) => setValues((current) => ({ ...current, [attribute.code]: next }));
        if (attribute.valueType === "choice") return <SelectField isRequired={attribute.required} items={[...(attribute.required ? [] : [{ id: "", label: t("Not set") }]), ...attribute.choices.map((choice) => ({ id: choice.value, label: choice.label }))]} key={attribute.id} label={attribute.label} onSelectionChange={(key) => change(String(key ?? ""))} selectedKey={value} />;
        if (attribute.valueType === "boolean") return <Switch isSelected={value === "true"} key={attribute.id} onChange={(on) => change(on ? "true" : "false")}>{attribute.label}</Switch>;
        if (attribute.valueType === "number" || attribute.valueType === "dimension") return <TextInput isRequired={attribute.required} key={attribute.id} label={attribute.label} onChange={(next) => change(decimal(next))} suffix={attribute.unitCode ?? undefined} value={value} />;
        return <TextInput isRequired={attribute.required} key={attribute.id} label={attribute.label} onChange={change} value={value} />;
      })}
    </FormSection> : null}
    <FormSection title={t("Quantities")}>
      <SelectField isRequired items={structure.units.map((unit) => ({ id: unit.code, label: `${unit.code} · ${unit.label}` }))} label={t("Unit")} onSelectionChange={(key) => set("unitCode")(String(key))} selectedKey={draft.unitCode} />
      <TextInput label={t("Waste")} onChange={(next) => set("wastePercent")(decimal(next))} suffix="%" value={draft.wastePercent} />
      <TextInput label={t("Buy in multiples of")} onChange={(next) => set("purchaseRoundTo")(decimal(next))} suffix={draft.unitCode} value={draft.purchaseRoundTo} />
    </FormSection>
    <div className={styles.actions}><Button onPress={onCancel}>{t("Cancel")}</Button><Button isLoading={saving} type="submit" variant="primary">{t("Save item")}</Button></div>
  </form>;
}

/** Components of an assembly with quantity formulas, e.g. ceil(height / 450) * 2. */
export function CatalogComponentsEditor({ workspaceId, catalogId, item, structure, onSaved, onCancel }: { workspaceId: string; catalogId: string; item: EditableItem; structure: CatalogStructure; onSaved: () => void; onCancel: () => void }) {
  const t = useT();
  const [rows, setRows] = useState(item.components.map((component) => ({ ...component })));
  // Start with the current components so each row shows its item before the list loads.
  const [options, setOptions] = useState<Array<{ id: string; label: string; unit: string }>>(() => item.components.map((component) => ({ id: component.componentItemId, label: component.name, unit: component.unitCode })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [aiReady, setAiReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [ideas, setIdeas] = useState<Array<{ componentItemId: string; name: string; quantityFormula: string; unitCode: string; reason?: string }> | null>(null);
  useEffect(() => { void loadAiSettings(workspaceId).then((settings) => setAiReady(Boolean(settings?.enabled && settings.available))); }, [workspaceId]);
  const suggest = async () => {
    setThinking(true); setError("");
    try {
      const result = await catalogApi<{ suggestions: NonNullable<typeof ideas> }>(workspaceId, `${catalogId}/items/${item.id}/ai-components`, { body: {} });
      setOptions((current) => [...current, ...(result.suggestions ?? []).filter((idea) => !current.some((option) => option.id === idea.componentItemId)).map((idea) => ({ id: idea.componentItemId, label: idea.name, unit: idea.unitCode }))]);
      setIdeas((result.suggestions ?? []).filter((idea) => !rows.some((row) => row.componentItemId === idea.componentItemId)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : ""); }
    finally { setThinking(false); }
  };
  const addIdea = (idea: NonNullable<typeof ideas>[number]) => { setRows((current) => [...current, { componentItemId: idea.componentItemId, name: idea.name, quantityFormula: idea.quantityFormula, unitCode: idea.unitCode }]); setIdeas((current) => current?.filter((entry) => entry !== idea) ?? null); };
  useEffect(() => {
    void catalogApi<{ items: CatalogItemRow[] }>(workspaceId, `${catalogId}/items?limit=200`).then((page) => setOptions((current) => { const loaded = page.items.filter((entry) => entry.id !== item.id).map((entry) => ({ id: entry.id, label: `${entry.name} · ${entry.code}`, unit: entry.unitCode })); return [...loaded, ...current.filter((option) => !loaded.some((entry) => entry.id === option.id))]; })).catch(() => undefined);
  }, [workspaceId, catalogId, item.id]);
  const update = (index: number, patch: Partial<(typeof rows)[number]>) => setRows((current) => current.map((row, at) => at === index ? { ...row, ...patch } : row));
  const save = async () => {
    setSaving(true); setError("");
    try {
      await catalogApi(workspaceId, `${catalogId}/items/${item.id}/components`, { method: "PUT", body: { version: item.version, components: rows.filter((row) => row.componentItemId).map(({ componentItemId, quantityFormula, unitCode }) => ({ componentItemId, quantityFormula, unitCode })) } });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : ""); }
    finally { setSaving(false); }
  };
  return <div className={styles.form}>
    {isAiPauseMessage(error) ? <AiPauseNotice message={error} /> : error ? <InlineNotice message={error} tone="error" /> : null}
    <p className={styles.muted}>{t("Formulas use the measurements from the site, e.g. width, height, length, area.")}</p>
    {rows.length ? <div aria-hidden="true" className={`${styles.componentRow} ${styles.componentHead}`}><span>{t("Component")}</span><span>{t("Quantity formula")}</span><span>{t("Unit")}</span><span /></div> : null}
    {rows.map((row, index) => <div className={`${styles.componentRow} ${styles.componentLine}`} key={index}>
      <ComboboxField aria-label={t("Component")} items={options.map(({ id, label }) => ({ id, label }))} label={t("Component")} onSelectionChange={(key) => { const chosen = options.find((option) => option.id === key); if (chosen) update(index, { componentItemId: chosen.id, name: chosen.label, unitCode: chosen.unit }); }} selectedKey={row.componentItemId || null} />
      <TextInput isRequired label={t("Quantity formula")} onChange={(value) => update(index, { quantityFormula: value })} placeholder="ceil(height / 450) * 2" value={row.quantityFormula} />
      <SelectField items={structure.units.map((unit) => ({ id: unit.code, label: unit.code }))} label={t("Unit")} onSelectionChange={(key) => update(index, { unitCode: String(key) })} selectedKey={row.unitCode} />
      <IconButton aria-label={`${t("Remove")} ${row.name}`} onPress={() => setRows((current) => current.filter((_, at) => at !== index))}><Trash2 aria-hidden="true" size={15} /></IconButton>
    </div>)}
    <div className={styles.inspectorActions}>
      <Button onPress={() => setRows((current) => [...current, { componentItemId: "", name: "", quantityFormula: "1", unitCode: "pcs" }])} size="compact" variant="quiet"><Plus aria-hidden="true" size={14} />{t("Add component")}</Button>
      {aiReady ? <Button isLoading={thinking} onPress={() => void suggest()} size="compact" variant="quiet"><Sparkles aria-hidden="true" size={14} />{t("Suggest with AI")}</Button> : null}
    </div>
    {ideas ? ideas.length ? <ul className={styles.ideas} aria-label={t("AI suggestions")}>{ideas.map((idea) => <li key={idea.componentItemId}>
      <div><strong>{idea.name}</strong><code dir="ltr">{idea.quantityFormula}</code><small>{idea.unitCode}</small>{idea.reason ? <p>{idea.reason}</p> : null}</div>
      <Button onPress={() => addIdea(idea)} size="compact">{t("Add")}</Button>
    </li>)}</ul> : <p className={styles.muted}>{t("AI has no further suggestions.")}</p> : null}
    <div className={styles.actions}><Button onPress={onCancel}>{t("Cancel")}</Button><Button isLoading={saving} onPress={() => void save()} variant="primary">{t("Save components")}</Button></div>
  </div>;
}
