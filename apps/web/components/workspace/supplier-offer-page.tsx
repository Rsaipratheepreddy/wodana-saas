"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Callout, Container, DataGrid, PageHeader, Stack, type DataGridColumn } from "@/design-system";

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

const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "Open ended";
const sourceLabel = (offer: SupplierOffer) => offer.sourceReference ? `${offer.sourceType?.replaceAll("_", " ") ?? "Source"} · ${offer.sourceReference}` : "Source not recorded";
const offerState = (offer: SupplierOffer) => {
  const today = new Date().toISOString().slice(0, 10);
  if (offer.status !== "active") return { label: offer.status === "draft" ? "Draft" : "Archived", tone: "neutral" as const };
  if (offer.effectiveTo && offer.effectiveTo < today) return { label: "Expired", tone: "danger" as const };
  if (offer.currencyBoundary === "conversion_required") return { label: "FX required", tone: "warning" as const };
  if (offer.currencyBoundary === "unbound") return { label: "Entity needed", tone: "warning" as const };
  return { label: "Current", tone: "success" as const };
};

export function SupplierOfferPage({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<{ items: SupplierOffer[]; loading: boolean; error: string }>({ items: [], loading: true, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setResult((current) => ({ ...current, loading: true, error: "" }));
      try {
        const query = new URLSearchParams({ workspaceId, ...(status !== "all" ? { status } : {}), ...(search.trim() ? { search: search.trim() } : {}) });
        const response = await fetch(`/api/workspace/supplier-offers?${query}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message ?? "Supplier offers could not be loaded.");
        setResult({ items: Array.isArray(payload.data) ? payload.data : [], loading: false, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ items: [], loading: false, error: error instanceof Error ? error.message : "Supplier offers could not be loaded." });
      }
    }, search ? 160 : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [search, status, workspaceId]);

  const columns = useMemo<DataGridColumn<SupplierOffer>[]>(() => [
    { accessorKey: "catalogRecordName", header: "Item", size: 210, meta: { primary: true }, cell: ({ row }) => <span><strong>{row.original.catalogRecordName}</strong><small>{row.original.catalogRecordCode}{row.original.supplierSku ? ` · ${row.original.supplierSku}` : ""}</small></span> },
    { accessorKey: "vendorName", header: "Supplier", size: 180, cell: ({ row }) => <span><strong>{row.original.vendorName}</strong><small>{row.original.vendorSiteName ?? "All locations"}</small></span> },
    { id: "price", header: "Offer", size: 155, meta: { align: "end" }, accessorFn: (offer) => offer.amount === null || !offer.currency ? "Not priced" : `${offer.currency} ${offer.amount.toLocaleString("en-AE", { maximumFractionDigits: 2 })}`, cell: ({ row }) => <span><strong>{row.original.amount === null || !row.original.currency ? "Not priced" : `${row.original.currency} ${row.original.amount.toLocaleString("en-AE", { maximumFractionDigits: 2 })}`}</strong><small>{row.original.unitCode ?? row.original.unitName ?? "Unit needed"}{row.original.quantityFrom ? ` · from ${row.original.quantityFrom}` : ""}</small></span> },
    { id: "availability", header: "Availability", size: 160, accessorFn: (offer) => `${dateLabel(offer.effectiveFrom)} ${dateLabel(offer.effectiveTo)}`, cell: ({ row }) => <span><strong>{row.original.effectiveFrom ? `From ${dateLabel(row.original.effectiveFrom)}` : "Date needed"}</strong><small>{row.original.effectiveTo ? `To ${dateLabel(row.original.effectiveTo)}` : "No end date"}{row.original.leadTimeDays !== null ? ` · ${row.original.leadTimeDays}d lead` : ""}</small></span> },
    { id: "source", header: "Evidence", size: 220, accessorFn: sourceLabel, cell: ({ row }) => <span><strong>{sourceLabel(row.original)}</strong><small>{row.original.legalEntityName ?? "Legal entity not bound"} · {row.original.taxTreatment.replaceAll("_", " ")}</small></span> },
    { id: "state", header: "Status", size: 120, accessorFn: (offer) => offerState(offer).label, cell: ({ row }) => { const state = offerState(row.original); return <Badge tone={state.tone}>{state.label}</Badge>; } },
  ], []);

  return <Container as="main" size="full"><Stack gap={5}>
    <PageHeader eyebrow="Pre-execution" title="Supplier offers" description="Compare permissioned purchase offers by item, entity, currency, source and validity. Selling-price users cannot see this data." />
    <Callout tone="info" title="Purchase evidence only">Currency conversion is never implied. Offers outside the legal entity&apos;s base currency remain marked for conversion before selection.</Callout>
    <DataGrid
      ariaLabel="Supplier offers"
      columns={columns}
      data={result.items}
      emptyDescription="Create and activate a sourced offer before it can be compared here."
      emptyTitle={search ? "No matching supplier offers" : "No supplier offers in this view"}
      error={result.error || null}
      getRowId={(offer) => offer.id}
      isLoading={result.loading}
      onSearchChange={setSearch}
      onViewChange={setStatus}
      persistKey="supplier-offers"
      rowNumbers={false}
      savedViews={[{ id: "active", label: "Active" }, { id: "draft", label: "Drafts" }, { id: "archived", label: "Archived" }, { id: "all", label: "All" }]}
      searchLabel="Search item, supplier, SKU or source"
      searchValue={search}
      selectable={false}
      selectedView={status}
    />
  </Stack></Container>;
}
