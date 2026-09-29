"use client";

import { useEffect, useState } from "react";
import { Badge, EditableField, ErrorState, Skeleton, Tabs } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { CatalogRequestError, catalogApi } from "@/lib/workspace/catalog-v2";
import { CatalogPrices, type PriceRow } from "./catalog-prices";
import { CatalogComponentsEditor, CatalogItemForm } from "./catalog-item-editors";
import { CatalogItemImages } from "./catalog-item-images";
import type { CatalogStructure } from "@/lib/workspace/catalog-v2";
import { Pencil } from "lucide-react";
import { Button } from "@/design-system";
import styles from "./catalog-page.module.css";

type ItemDetail = {
  id: string; code: string; name: string; itemType: string; unitCode: string; categoryId: string | null; version: number; description: string | null; wastePercent: string | null; purchaseRoundTo: string | null;
  values: Record<string, string>;
  components: Array<{ componentItemId: string; name: string; quantityFormula: string; unitCode: string }>;
  prices: PriceRow[];
  suppliers: Array<{ id: string; vendorName: string; vendorSku: string | null; cost: string | null; currency: string | null; leadTimeDays: number | null }>;
  canViewCosts: boolean;
};

/** Item detail in the grid inspector: facts, components with their formulas, prices and suppliers. */
export function CatalogItemInspector({ workspaceId, catalogId, itemId, locale, canManage = false, canReview = false, currency, structure, onChanged }: { workspaceId: string; catalogId: string; itemId: string; locale?: string; canManage?: boolean; canReview?: boolean; currency: string; structure?: CatalogStructure | null; onChanged?: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState<"details" | "components" | null>(null);
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    catalogApi<ItemDetail>(workspaceId, `${catalogId}/items/${itemId}`).then((next) => { if (live) { setItem(next); setError(""); } }).catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : ""); });
    return () => { live = false; };
  }, [workspaceId, catalogId, itemId, attempt]);
  if (error) return <ErrorState description={error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!item) return <Skeleton lines={5} shape="facts" />;
  const money = (value: string | null | undefined, currency: string | null) => {
    if (!value) return "—";
    try { return new Intl.NumberFormat(locale, { style: "currency", currency: currency ?? "USD" }).format(Number(value)); } catch { return value; }
  };
  const statusTone = (status: string) => (status === "active" ? "success" : status === "reviewed" ? "info" : "neutral") as "success" | "info" | "neutral";
  const facts: Array<[string, string]> = [
    [t("Code"), item.code], [t("Unit"), item.unitCode],
    ...Object.entries(item.values).map(([code, value]): [string, string] => [code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), value]),
    ...(item.wastePercent ? [[t("Waste"), `${Number(item.wastePercent)}%`] as [string, string]] : []),
    ...(item.purchaseRoundTo ? [[t("Buy in multiples of"), `${Number(item.purchaseRoundTo)} ${item.unitCode}`] as [string, string]] : []),
  ];
  const saved = () => { setEditing(null); setAttempt((value) => value + 1); onChanged?.(); };
  /**
   * One fact changed in place: the item is saved whole (the catalog replaces it), with this change and its version.
   * A clash with someone else's change loads the latest.
   */
  const saveFact = async (patch: Partial<Pick<ItemDetail, "code" | "itemType" | "unitCode" | "categoryId" | "description" | "wastePercent" | "purchaseRoundTo">>, values = item.values) => {
    const next = { ...item, ...patch };
    const applies = structure?.attributes.filter((attribute) => !attribute.categoryId || attribute.categoryId === (next.categoryId ?? "")) ?? [];
    try {
      await catalogApi(workspaceId, `${catalogId}/items/${item.id}`, { method: "PUT", body: {
        version: item.version, code: next.code, name: next.name, itemType: next.itemType, unitCode: next.unitCode, categoryId: next.categoryId || undefined,
        description: next.description || undefined, wastePercent: next.wastePercent || undefined, purchaseRoundTo: next.purchaseRoundTo || undefined,
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
  const reload = () => setAttempt((value) => value + 1);
  const itemTypes = [{ id: "product", label: t("Product") }, { id: "material", label: t("Material") }, { id: "assembly", label: t("Assembly") }, { id: "service", label: t("Service") }, { id: "package", label: t("Package") }, { id: "ready_made", label: t("Ready-made") }];
  if (editing === "details" && structure) return <CatalogItemForm catalogId={catalogId} item={item} onCancel={() => setEditing(null)} onSaved={saved} structure={structure} workspaceId={workspaceId} />;
  if (editing === "components" && structure) return <CatalogComponentsEditor catalogId={catalogId} item={item} onCancel={() => setEditing(null)} onSaved={saved} structure={structure} workspaceId={workspaceId} />;
  const isAssembly = item.itemType === "assembly" || item.itemType === "package";
  return <div className={styles.inspector}>
    {canManage && structure ? <div className={styles.inspectorActions}><Button onPress={() => setEditing("details")} size="compact"><Pencil aria-hidden="true" size={14} />{t("Edit")}</Button>{isAssembly ? <Button onPress={() => setEditing("components")} size="compact">{t("Edit components")}</Button> : null}</div> : null}
    {canManage && structure ? <dl className={styles.facts}>
      <EditableField isRequired label={t("Code")} maxLength={80} onReload={reload} onSave={(code) => saveFact({ code })} value={item.code} />
      <EditableField items={itemTypes} kind="select" label={t("Type")} onReload={reload} onSave={(itemType) => saveFact({ itemType })} value={item.itemType} />
      <EditableField items={structure.units.map((unit) => ({ id: unit.code, label: `${unit.code} · ${unit.label}` }))} kind="select" label={t("Unit")} onReload={reload} onSave={(unitCode) => saveFact({ unitCode })} value={item.unitCode} />
      <EditableField items={[{ id: "", label: t("No category") }, ...structure.categories.map((category) => ({ id: category.id, label: category.name }))]} kind="select" label={t("Category")}
        onReload={reload} onSave={(categoryId) => saveFact({ categoryId: categoryId || null })} value={item.categoryId ?? ""} />
      {structure.attributes.filter((attribute) => !attribute.categoryId || attribute.categoryId === item.categoryId).map((attribute) => {
        const save = (value: string) => saveFact({}, { ...item.values, [attribute.code]: value });
        const value = item.values[attribute.code] ?? "";
        if (attribute.valueType === "choice" || attribute.valueType === "boolean") {
          const choices = attribute.valueType === "boolean" ? [{ id: "true", label: t("Yes") }, { id: "false", label: t("No") }] : attribute.choices.map((choice) => ({ id: choice.value, label: choice.label }));
          return <EditableField isRequired={attribute.required} items={[...(attribute.required ? [] : [{ id: "", label: t("Not set") }]), ...choices]} key={attribute.id} kind="select" label={attribute.label} onReload={reload} onSave={save} value={value} />;
        }
        const numeric = attribute.valueType === "number" || attribute.valueType === "dimension";
        return <EditableField display={value && attribute.unitCode ? `${value} ${attribute.unitCode}` : undefined} isRequired={attribute.required} key={attribute.id} label={attribute.label} onReload={reload} onSave={save}
          validate={numeric ? decimalProblem : undefined} value={value} />;
      })}
      <EditableField display={item.wastePercent ? `${Number(item.wastePercent)}%` : undefined} label={t("Waste")} onReload={reload} onSave={(wastePercent) => saveFact({ wastePercent: wastePercent || null })}
        validate={decimalProblem} value={item.wastePercent ? String(Number(item.wastePercent)) : ""} />
      <EditableField display={item.purchaseRoundTo ? `${Number(item.purchaseRoundTo)} ${item.unitCode}` : undefined} label={t("Buy in multiples of")} onReload={reload}
        onSave={(purchaseRoundTo) => saveFact({ purchaseRoundTo: purchaseRoundTo || null })} validate={decimalProblem} value={item.purchaseRoundTo ? String(Number(item.purchaseRoundTo)) : ""} />
      <EditableField kind="multiline" label={t("Description")} maxLength={4000} onReload={reload} onSave={(description) => saveFact({ description: description || null })} value={item.description ?? ""} />
    </dl> : <dl className={styles.facts}>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>)}</dl>}
    <Tabs items={[
      { id: "pictures", label: t("Pictures"), panel: <CatalogItemImages workspaceId={workspaceId} itemId={item.id} canManage={canManage} /> },
      ...(item.components.length || isAssembly ? [{ id: "components", label: t("Components"), panel: item.components.length ? <ul className={styles.list}>{item.components.map((component) => <li key={component.componentItemId}><strong>{component.name}</strong><code dir="ltr">{component.quantityFormula}</code><small>{component.unitCode}</small></li>)}</ul> : <p className={styles.muted}>{t("No components yet")}</p> }] : []),
      { id: "prices", label: t("Prices"), panel: <CatalogPrices canManage={canManage} canReview={canReview} catalogId={catalogId} currency={currency} itemId={item.id} itemType={item.itemType} locale={locale} onChanged={() => { setAttempt((value) => value + 1); onChanged?.(); }} prices={item.prices} unitCode={item.unitCode} workspaceId={workspaceId} /> },
      ...(item.canViewCosts ? [{ id: "suppliers", label: t("Suppliers"), panel: item.suppliers.length ? <ul className={styles.list}>{item.suppliers.map((supplier) => <li key={supplier.id}><strong>{supplier.vendorName}</strong><small dir="ltr">{supplier.vendorSku ?? ""}</small><span dir="ltr">{money(supplier.cost, supplier.currency)}</span></li>)}</ul> : <p className={styles.muted}>{t("No suppliers linked")}</p> }] : []),
    ]} />
  </div>;
}
