"use client";

import { useEffect, useState } from "react";
import { Badge, ErrorState, Skeleton, Tabs } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { catalogApi } from "@/lib/workspace/catalog-v2";
import { CatalogPrices, type PriceRow } from "./catalog-prices";
import { CatalogComponentsEditor, CatalogItemForm } from "./catalog-item-editors";
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
  if (!item) return <Skeleton lines={5} />;
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
  if (editing === "details" && structure) return <CatalogItemForm catalogId={catalogId} item={item} onCancel={() => setEditing(null)} onSaved={saved} structure={structure} workspaceId={workspaceId} />;
  if (editing === "components" && structure) return <CatalogComponentsEditor catalogId={catalogId} item={item} onCancel={() => setEditing(null)} onSaved={saved} structure={structure} workspaceId={workspaceId} />;
  const isAssembly = item.itemType === "assembly" || item.itemType === "package";
  return <div className={styles.inspector}>
    {canManage && structure ? <div className={styles.inspectorActions}><Button onPress={() => setEditing("details")} size="compact"><Pencil aria-hidden="true" size={14} />{t("Edit")}</Button>{isAssembly ? <Button onPress={() => setEditing("components")} size="compact">{t("Edit components")}</Button> : null}</div> : null}
    <dl className={styles.facts}>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>)}</dl>
    <Tabs items={[
      ...(item.components.length || isAssembly ? [{ id: "components", label: t("Components"), panel: item.components.length ? <ul className={styles.list}>{item.components.map((component) => <li key={component.componentItemId}><strong>{component.name}</strong><code dir="ltr">{component.quantityFormula}</code><small>{component.unitCode}</small></li>)}</ul> : <p className={styles.muted}>{t("No components yet")}</p> }] : []),
      { id: "prices", label: t("Prices"), panel: <CatalogPrices canManage={canManage} canReview={canReview} catalogId={catalogId} currency={currency} itemId={item.id} itemType={item.itemType} locale={locale} onChanged={() => { setAttempt((value) => value + 1); onChanged?.(); }} prices={item.prices} unitCode={item.unitCode} workspaceId={workspaceId} /> },
      ...(item.canViewCosts ? [{ id: "suppliers", label: t("Suppliers"), panel: item.suppliers.length ? <ul className={styles.list}>{item.suppliers.map((supplier) => <li key={supplier.id}><strong>{supplier.vendorName}</strong><small dir="ltr">{supplier.vendorSku ?? ""}</small><span dir="ltr">{money(supplier.cost, supplier.currency)}</span></li>)}</ul> : <p className={styles.muted}>{t("No suppliers linked")}</p> }] : []),
    ]} />
  </div>;
}
