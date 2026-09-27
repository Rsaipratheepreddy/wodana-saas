"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Callout, Container, DataGrid, isNoAccessError, NoAccessState, PageHeader, Stack, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type Translate } from "@/lib/i18n/keys";

export type SupplierOffer = {
  id: string;
  vendorName: string;
  vendorSiteName: string | null;
  legalEntityName: string | null;
  legalEntityBaseCurrency: string | null;
  catalogRecordName: string;
  catalogRecordCode: string;
  unitName: string | null;
  unitCode: string | null;
  supplierSku: string | null;
  amount: number | null;
  currency: string | null;
  quantityFrom: number | null;
  minimumOrderQuantity: number | null;
  leadTimeDays: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sourceType: string | null;
  sourceReference: string | null;
  taxTreatment: string;
  currencyBoundary: "base" | "conversion_required" | "unbound";
  status: "draft" | "active" | "archived";
  version: number;
};

const dateLabel = (value: string | null, t: Translate, locale: string) => value ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : t("Open ended");
const sourceLabel = (offer: SupplierOffer, t: Translate) => offer.sourceReference ? `${offer.sourceType?.replaceAll("_", " ") ?? t("Source")} · ${offer.sourceReference}` : t("Source not recorded");
const offerState = (offer: SupplierOffer) => {
  const today = new Date().toISOString().slice(0, 10);
  if (offer.status !== "active") return { label: offer.status === "draft" ? tKey("Draft") : tKey("Archived"), tone: "neutral" as const };
  if (offer.effectiveTo && offer.effectiveTo < today) return { label: tKey("Expired"), tone: "danger" as const };
  if (offer.currencyBoundary === "conversion_required") return { label: tKey("FX required"), tone: "warning" as const };
  if (offer.currencyBoundary === "unbound") return { label: tKey("Entity needed"), tone: "warning" as const };
  return { label: tKey("Current"), tone: "success" as const };
};

export function SupplierOfferPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<{ items: SupplierOffer[]; loading: boolean; error: string; denied?: boolean }>({ items: [], loading: true, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setResult((current) => ({ ...current, loading: true, error: "" }));
      try {
        const query = new URLSearchParams({ workspaceId, ...(status !== "all" ? { status } : {}), ...(search.trim() ? { search: search.trim() } : {}) });
        const response = await fetch(`/api/workspace/supplier-offers?${query}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw Object.assign(new Error(payload.message ?? t("Supplier offers could not be loaded.")), { status: response.status });
        setResult({ items: Array.isArray(payload.data) ? payload.data : [], loading: false, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ items: [], loading: false, error: error instanceof Error ? error.message : t("Supplier offers could not be loaded."), denied: isNoAccessError(error) });
      }
    }, search ? 160 : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [search, status, workspaceId, t]);

  const columns = useMemo<DataGridColumn<SupplierOffer>[]>(() => [
    { accessorKey: "catalogRecordName", header: t("Item"), size: 210, meta: { primary: true }, cell: ({ row }) => <span><strong>{row.original.catalogRecordName}</strong><small>{row.original.catalogRecordCode}{row.original.supplierSku ? ` · ${row.original.supplierSku}` : ""}</small></span> },
    { accessorKey: "vendorName", header: t("Supplier"), size: 180, cell: ({ row }) => <span><strong>{row.original.vendorName}</strong><small>{row.original.vendorSiteName ?? t("All locations")}</small></span> },
    { id: "price", header: t("Offer"), size: 155, meta: { align: "end" }, accessorFn: (offer) => offer.amount === null || !offer.currency ? t("Not priced") : `${offer.currency} ${offer.amount.toLocaleString(locale, { maximumFractionDigits: 2 })}`, cell: ({ row }) => <span><strong>{row.original.amount === null || !row.original.currency ? t("Not priced") : `${row.original.currency} ${row.original.amount.toLocaleString(locale, { maximumFractionDigits: 2 })}`}</strong><small>{row.original.unitCode ?? row.original.unitName ?? t("Unit needed")}{row.original.quantityFrom ? ` · ${t("from {quantity}", { quantity: row.original.quantityFrom })}` : ""}</small></span> },
    { id: "availability", header: t("Availability"), size: 160, accessorFn: (offer) => `${dateLabel(offer.effectiveFrom, t, locale)} ${dateLabel(offer.effectiveTo, t, locale)}`, cell: ({ row }) => <span><strong>{row.original.effectiveFrom ? t("From {date}", { date: dateLabel(row.original.effectiveFrom, t, locale) }) : t("Date needed")}</strong><small>{row.original.effectiveTo ? t("To {date}", { date: dateLabel(row.original.effectiveTo, t, locale) }) : t("No end date")}{row.original.leadTimeDays !== null ? ` · ${t("{days}d lead", { days: row.original.leadTimeDays })}` : ""}</small></span> },
    { id: "source", header: t("Evidence"), size: 220, accessorFn: (offer) => sourceLabel(offer, t), cell: ({ row }) => <span><strong>{sourceLabel(row.original, t)}</strong><small>{row.original.legalEntityName ?? t("Legal entity not bound")} · {row.original.taxTreatment.replaceAll("_", " ")}</small></span> },
    { id: "state", header: t("Status"), size: 120, accessorFn: (offer) => t(offerState(offer).label), cell: ({ row }) => { const state = offerState(row.original); return <Badge tone={state.tone}>{t(state.label)}</Badge>; } },
  ], [locale, t]);

  if (result.denied) return <NoAccessState area={t("Supplier offers")} />;
  return <Container as="main" size="full"><Stack gap={5}>
    <PageHeader eyebrow={t("Planning")} title={t("Supplier offers")} description={t("Compare permissioned purchase offers by item, entity, currency, source and validity. Selling-price users cannot see this data.")} />
    <Callout tone="info" title={t("Purchase evidence only")}>{t("Currency conversion is never implied. Offers outside the legal entity's base currency remain marked for conversion before selection.")}</Callout>
    <DataGrid
      ariaLabel={t("Supplier offers")}
      columns={columns}
      data={result.items}
      emptyDescription={t("Create and activate a sourced offer before it can be compared here.")}
      emptyTitle={search ? t("No matching supplier offers") : t("No supplier offers in this view")}
      error={result.error || null}
      getRowId={(offer) => offer.id}
      isLoading={result.loading}
      onSearchChange={setSearch}
      onViewChange={setStatus}
      persistKey="supplier-offers"
      rowNumbers={false}
      savedViews={[{ id: "active", label: t("Active") }, { id: "draft", label: t("Drafts") }, { id: "archived", label: t("Archived") }, { id: "all", label: t("All") }]}
      searchLabel={t("Search item, supplier, SKU or source")}
      searchValue={search}
      selectable={false}
      selectedView={status}
    />
  </Stack></Container>;
}
