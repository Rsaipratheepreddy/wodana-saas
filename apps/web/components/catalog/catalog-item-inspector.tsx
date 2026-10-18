"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { Button, EditableField, ErrorState, Skeleton, Tabs, type TabItem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { CatalogRequestError, catalogApi } from "@/lib/workspace/catalog-v2";
import type { CatalogStructure } from "@/lib/workspace/catalog-v2";
import { CatalogPrices, type PriceRow } from "./catalog-prices";
import { CatalogComponentsEditor, CatalogItemForm, type RecipeComponent } from "./catalog-item-editors";
import { CatalogRecipe } from "./catalog-recipe";
import { CatalogItemImages } from "./catalog-item-images";
import { CatalogItemProvenance, CatalogItemSize, useItemSource } from "./catalog-item-source";
import styles from "./catalog-page.module.css";

type ItemDetail = {
  id: string; code: string; name: string; itemType: string; unitCode: string; categoryId: string | null; version: number; description: string | null; wastePercent: string | null; purchaseRoundTo: string | null;
  /** A link to the item's technical drawing (PLM-057: a standard item with one needs no project drawing). */
  technicalDrawingUrl?: string | null;
  values: Record<string, string>;
  components: RecipeComponent[];
  /** PLM-166: who verified the recipe and when (null: its quantities aren't used on projects yet), and whether the viewer may verify it. */
  recipeVerified?: { at: string; byName: string | null } | null;
  canVerifyRecipe?: boolean;
  prices: PriceRow[];
  suppliers: Array<{ id: string; vendorName: string; vendorSku: string | null; cost: string | null; currency: string | null; leadTimeDays: number | null }>;
  canViewCosts: boolean;
};

/** Kinds of item with an outside size (the fit check reads it; made furniture has one too). */
const SIZED = ["product", "ready_made", "material", "assembly", "package"];
/** The attribute an import keeps size text in when a cell isn't one number. */
const SIZE_NOTES = "size_notes";

/** Item detail in the grid inspector: details, photos, size, components, prices, suppliers and where it came from, one tab each. */
export function CatalogItemInspector({ workspaceId, catalogId, itemId, locale, canManage = false, canReview = false, currency, structure, onChanged, initialTab = "details" }: { workspaceId: string; catalogId: string; itemId: string; locale?: string; canManage?: boolean; canReview?: boolean; currency: string; structure?: CatalogStructure | null; onChanged?: () => void;
  /** The tab it opens on (a readiness chip opens the tab where the missing fact is filled). */
  initialTab?: string }) {
  const t = useT();
  const [editing, setEditing] = useState<"details" | "components" | null>(null);
  const [tab, setTab] = useState(initialTab);
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    catalogApi<ItemDetail>(workspaceId, `${catalogId}/items/${itemId}`).then((next) => { if (live) { setItem(next); setError(""); } }).catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : ""); });
    return () => { live = false; };
  }, [workspaceId, catalogId, itemId, attempt]);
  const sized = Boolean(item && item.id === itemId && SIZED.includes(item.itemType));
  const source = useItemSource(workspaceId, itemId, sized);
  if (error) return <ErrorState description={error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!item) return <Skeleton lines={5} shape="facts" />;
  const money = (value: string | null | undefined, currency: string | null) => {
    if (!value) return "—";
    try { return new Intl.NumberFormat(locale, { style: "currency", currency: currency ?? "USD" }).format(Number(value)); } catch { return value; }
  };
  const canEdit = canManage && Boolean(structure);
  const saved = () => { setEditing(null); setAttempt((value) => value + 1); onChanged?.(); };
  const reload = () => setAttempt((value) => value + 1);
  /**
   * One fact changed in place: the item is saved whole (the catalog replaces it), with this change and its version.
   * A clash with someone else's change loads the latest.
   */
  const saveFact = async (patch: Partial<Pick<ItemDetail, "code" | "itemType" | "unitCode" | "categoryId" | "description" | "wastePercent" | "purchaseRoundTo" | "technicalDrawingUrl">>, values = item.values) => {
    const next = { ...item, ...patch };
    const applies = structure?.attributes.filter((attribute) => !attribute.categoryId || attribute.categoryId === (next.categoryId ?? "")) ?? [];
    try {
      await catalogApi(workspaceId, `${catalogId}/items/${item.id}`, { method: "PUT", body: {
        version: item.version, code: next.code, name: next.name, itemType: next.itemType, unitCode: next.unitCode, categoryId: next.categoryId || undefined,
        description: next.description || undefined, wastePercent: next.wastePercent || undefined, purchaseRoundTo: next.purchaseRoundTo || undefined,
        ...("technicalDrawingUrl" in patch ? { technicalDrawingUrl: patch.technicalDrawingUrl ?? "" } : {}),
        values: Object.fromEntries(applies.map((attribute) => [attribute.code, values[attribute.code] ?? ""]).filter(([, value]) => value !== "")),
      } });
      setItem({ ...next, values, version: item.version + 1 });
      setAttempt((value) => value + 1);
      onChanged?.();
    } catch (cause) {
      if (cause instanceof CatalogRequestError && cause.status === 409) setAttempt((value) => value + 1);
      throw cause;
    }
  };
  const decimalProblem = (text: string) => text && !/^\d+(\.\d+)?$/.test(text) ? t("Enter a number, like 5 or 2.5.") : null;
  const itemTypes = [{ id: "product", label: t("Product") }, { id: "material", label: t("Material") }, { id: "assembly", label: t("Assembly") }, { id: "service", label: t("Service") }, { id: "package", label: t("Package") }, { id: "ready_made", label: t("Ready-made") }];
  const isAssembly = item.itemType === "assembly" || item.itemType === "package";
  const drawingLink = item.technicalDrawingUrl ? <a href={item.technicalDrawingUrl} target="_blank" rel="noreferrer" dir="ltr">{t("Open the drawing")}</a> : null;
  const filled = (value: string | null | undefined) => Boolean(value && value.trim());
  const notes = sized ? item.values[SIZE_NOTES] ?? "" : "";
  const notesAttribute = structure?.attributes.find((attribute) => attribute.code === SIZE_NOTES && !attribute.categoryId);

  // Details: the item's facts. Attributes without a value wait in the edit form; values the size tab shows aren't repeated.
  const applicable = structure?.attributes.filter((attribute) => !attribute.categoryId || attribute.categoryId === item.categoryId) ?? [];
  const shownAttributes = applicable.filter((attribute) => filled(item.values[attribute.code]) && !(sized && attribute.code === SIZE_NOTES));
  const otherValues = Object.entries(item.values).filter(([code, value]) => filled(value) && !applicable.some((attribute) => attribute.code === code) && !(sized && code === SIZE_NOTES));
  const labelOf = (code: string) => structure?.attributes.find((attribute) => attribute.code === code)?.label ?? code.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
  const categoryName = structure?.categories.find((category) => category.id === item.categoryId)?.name;
  const details = editing === "details" && structure
    ? <CatalogItemForm catalogId={catalogId} item={item} onCancel={() => setEditing(null)} onSaved={saved} structure={structure} workspaceId={workspaceId} />
    : <div className={styles.inspector}>
      {canEdit ? <div className={styles.actions}><Button onPress={() => setEditing("details")} size="compact"><Pencil aria-hidden="true" size={14} />{t("Edit")}</Button></div> : null}
      <dl className="wd-editable-list">
        <EditableField canEdit={canEdit} display={<bdi dir="ltr">{item.code}</bdi>} isRequired label={t("Code")} maxLength={80} onReload={reload} onSave={(code) => saveFact({ code })} value={item.code} />
        <EditableField canEdit={canEdit} items={itemTypes} kind="select" label={t("Type")} onReload={reload} onSave={(itemType) => saveFact({ itemType })} value={item.itemType} />
        <EditableField canEdit={canEdit} items={structure?.units.map((unit) => ({ id: unit.code, label: `${unit.code} · ${unit.label}` })) ?? []} kind="select" label={t("Unit")} onReload={reload}
          onSave={(unitCode) => saveFact({ unitCode })} value={item.unitCode} />
        {canEdit || categoryName ? <EditableField canEdit={canEdit} items={[{ id: "", label: t("No category") }, ...(structure?.categories.map((category) => ({ id: category.id, label: category.name })) ?? [])]} kind="select"
          label={t("Category")} onReload={reload} onSave={(categoryId) => saveFact({ categoryId: categoryId || null })} value={item.categoryId ?? ""} /> : null}
        {shownAttributes.map((attribute) => {
          const save = (value: string) => saveFact({}, { ...item.values, [attribute.code]: value });
          const value = item.values[attribute.code] ?? "";
          if (attribute.valueType === "choice" || attribute.valueType === "boolean") {
            const choices = attribute.valueType === "boolean" ? [{ id: "true", label: t("Yes") }, { id: "false", label: t("No") }] : attribute.choices.map((choice) => ({ id: choice.value, label: choice.label }));
            return <EditableField canEdit={canEdit} isRequired={attribute.required} items={[...(attribute.required ? [] : [{ id: "", label: t("Not set") }]), ...choices]} key={attribute.id} kind="select" label={attribute.label} onReload={reload} onSave={save} value={value} />;
          }
          const numeric = attribute.valueType === "number" || attribute.valueType === "dimension";
          return <EditableField canEdit={canEdit} display={attribute.unitCode ? `${value} ${attribute.unitCode}` : undefined} isRequired={attribute.required} key={attribute.id} label={attribute.label} onReload={reload} onSave={save}
            validate={numeric ? decimalProblem : undefined} value={value} />;
        })}
        {otherValues.map(([code, value]) => <EditableField canEdit={false} key={code} label={labelOf(code)} onSave={() => undefined} value={value} />)}
        {canEdit || filled(item.wastePercent) ? <EditableField canEdit={canEdit} display={item.wastePercent ? `${Number(item.wastePercent)}%` : undefined} label={t("Waste")} onReload={reload}
          onSave={(wastePercent) => saveFact({ wastePercent: wastePercent || null })} validate={decimalProblem} value={item.wastePercent ? String(Number(item.wastePercent)) : ""} /> : null}
        {canEdit || filled(item.purchaseRoundTo) ? <EditableField canEdit={canEdit} display={item.purchaseRoundTo ? `${Number(item.purchaseRoundTo)} ${item.unitCode}` : undefined} label={t("Buy in multiples of")} onReload={reload}
          onSave={(purchaseRoundTo) => saveFact({ purchaseRoundTo: purchaseRoundTo || null })} validate={decimalProblem} value={item.purchaseRoundTo ? String(Number(item.purchaseRoundTo)) : ""} /> : null}
        {canEdit || drawingLink ? <EditableField canEdit={canEdit} display={drawingLink ?? undefined} label={t("Technical drawing")} maxLength={2000} onReload={reload}
          onSave={(url) => saveFact({ technicalDrawingUrl: url.trim() || null })} validate={(text) => text.trim() && !/^https?:\/\/\S+$/i.test(text.trim()) ? t("Paste the drawing's link, starting with https://") : null}
          value={item.technicalDrawingUrl ?? ""} /> : null}
        {canEdit || filled(item.description) ? <EditableField canEdit={canEdit} kind="multiline" label={t("Description")} maxLength={4000} onReload={reload}
          onSave={(description) => saveFact({ description: description || null })} value={item.description ?? ""} /> : null}
      </dl>
    </div>;

  // PLM-162 / PLM-166: the production recipe by kind, with its verification (the factory marks it; a change clears it).
  const components = editing === "components" && structure
    ? <CatalogComponentsEditor catalogId={catalogId} item={item} onCancel={() => setEditing(null)} onSaved={saved} structure={structure} workspaceId={workspaceId} />
    : <CatalogRecipe catalogId={catalogId} item={item} workspaceId={workspaceId} canEdit={canEdit && isAssembly} onEdit={() => setEditing("components")} onChanged={reload} />;

  const sizeNotes = filled(notes) ? <dl className="wd-editable-list" data-layout="stacked">
    <EditableField canEdit={canEdit && Boolean(notesAttribute)} kind="multiline" label={t("Size notes")} maxLength={500} onReload={reload}
      onSave={(value) => saveFact({}, { ...item.values, [SIZE_NOTES]: value })} value={notes} />
  </dl> : null;
  const provenance = source.data?.source ?? null;
  const tabs: TabItem[] = [
    { id: "details", label: t("Details"), panel: details },
    { id: "photos", label: t("Photos"), panel: <CatalogItemImages workspaceId={workspaceId} itemId={item.id} canManage={canManage} /> },
    ...(sized ? [{ id: "size", label: t("Size"), panel: <CatalogItemSize canManage={canManage} itemId={item.id} notes={sizeNotes} source={source} workspaceId={workspaceId} /> }] : []),
    ...(item.components.length || isAssembly ? [{ id: "components", label: t("Recipe"), panel: components }] : []),
    { id: "prices", label: t("Prices"), panel: <CatalogPrices canManage={canManage} canReview={canReview} catalogId={catalogId} currency={currency} itemId={item.id} itemType={item.itemType} locale={locale} onChanged={() => { setAttempt((value) => value + 1); onChanged?.(); }} prices={item.prices} unitCode={item.unitCode} workspaceId={workspaceId} /> },
    ...(item.canViewCosts ? [{ id: "suppliers", label: t("Suppliers"), panel: item.suppliers.length ? <ul className={styles.list}>{item.suppliers.map((supplier) => <li key={supplier.id}><strong>{supplier.vendorName}</strong><small dir="ltr">{supplier.vendorSku ?? ""}</small><span dir="ltr">{money(supplier.cost, supplier.currency)}</span></li>)}</ul> : <p className={styles.muted}>{t("No suppliers linked")}</p> }] : []),
    ...(provenance ? [{ id: "source", label: t("Source"), panel: <CatalogItemProvenance source={provenance} /> }] : []),
  ];
  const selected = tabs.some((entry) => entry.id === tab) ? tab : "details";
  return <Tabs items={tabs} onSelectionChange={setTab} selectedKey={selected} />;
}
