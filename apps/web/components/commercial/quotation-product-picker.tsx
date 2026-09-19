"use client";

import { useMemo, useState } from "react";
import { Check, Minus, Pencil, Plus } from "lucide-react";
import { Button, DataGrid, SegmentedControl, SelectField, type DataGridColumn } from "@/design-system";
import type { QuoteLine } from "@/lib/commercial/types";
import { quotationItemName, quotationVariantName } from "@/lib/commercial/presentation";
import type { CommercialCatalogChoice } from "./catalog-picker";
import { useCatalogOptions } from "./catalog-options-cache";
import s from "./quotation-workbench.module.css";

const pricingLabel = (mode?: "unpriced" | "fixed" | "on_request") =>
  mode === "fixed" ? "Fixed price" : mode === "on_request" ? "Quote required" : "Unpriced";

function VariantOptions({ options, work, roomName, value, onChange }: {
  options: CommercialCatalogChoice[];
  work: CommercialCatalogChoice;
  roomName: string;
  value: CommercialCatalogChoice | null;
  onChange: (variant: CommercialCatalogChoice) => void;
}) {
  if (options.length > 5) return <SelectField
    aria-label={`Variant for ${quotationItemName(work.name, roomName)}`}
    items={options.map((variant) => ({ id: variant.id, label: quotationVariantName(variant.name, work.name, roomName, variant.code) }))}
    label={<span className="wd-visually-hidden">Variant</span>}
    onSelectionChange={(key) => { const selected = options.find((variant) => variant.id === key); if (selected) onChange(selected); }}
    selectedKey={value?.id ?? null}
  />;
  return <div>{options.map((variant) => <Button
    aria-pressed={value?.id === variant.id}
    key={variant.id}
    onPress={() => onChange(variant)}
    size="compact"
    variant="quiet"
  >{quotationVariantName(variant.name, work.name, roomName, variant.code)}</Button>)}</div>;
}

function VariantComparison({ options, work, roomName, value, onChange }: {
  options: CommercialCatalogChoice[];
  work: CommercialCatalogChoice;
  roomName: string;
  value: CommercialCatalogChoice | null;
  onChange: (variant: CommercialCatalogChoice) => void;
}) {
  const columns = useMemo<DataGridColumn<CommercialCatalogChoice>[]>(() => [
    { accessorKey: "name", header: "Variant", size: 190, meta: { primary: true }, cell: ({ row }) => <span><strong>{quotationVariantName(row.original.name, work.name, roomName, row.original.code)}</strong><small>{row.original.code}</small></span> },
    { id: "specification", header: "Specification", size: 180, accessorFn: (variant) => String(variant.configuration?.specificationTier ?? variant.configuration?.qualityGrade ?? variant.configuration?.variant ?? variant.description ?? "—") },
    { id: "price", header: "Price", size: 120, accessorFn: (variant) => pricingLabel(variant.commerce?.pricingMode) },
    { id: "select", header: "", size: 110, enableSorting: false, meta: { align: "end", renderCell: (variant) => <Button aria-label={`Select ${variant.name}`} onPress={() => onChange(variant)} size="compact" variant={value?.id === variant.id ? "primary" : "secondary"}>{value?.id === variant.id ? "Selected" : "Select"}</Button> } },
  ], [onChange, roomName, value?.id, work.name]);
  return <DataGrid
    appearance="flush"
    ariaLabel={`Compare variants for ${quotationItemName(work.name, roomName)}`}
    columns={columns}
    data={options}
    emptyDescription="Add an active variant to this item before comparing."
    emptyTitle="No variants"
    getRowId={(variant) => variant.id}
    rowNumbers={false}
    selectable={false}
    showFooter={false}
    showToolbar={false}
  />;
}

export function QuotationVariantChoices({ workspaceId, caseId, work, roomName = "", value, onChange }: {
  workspaceId: string;
  caseId: string;
  work: CommercialCatalogChoice;
  roomName?: string;
  value: CommercialCatalogChoice | null;
  onChange: (variant: CommercialCatalogChoice | null) => void;
}) {
  const [compare, setCompare] = useState(false);
  const { items, loading, error, refresh } = useCatalogOptions(workspaceId, caseId, "variant", "", work.id, work.catalogId);
  const options = value && !items.some((item) => item.id === value.id) ? [value, ...items] : items;
  if (!loading && !error && !options.length) return null;
  return <div className={s.variantOptions} role="group" aria-label="Variant">
    <span>Variant</span>
    <VariantOptions options={options} work={work} roomName={roomName} value={value} onChange={onChange} />
    {options.length > 1 ? <Button onPress={() => setCompare((open) => !open)} size="compact" variant="quiet">{compare ? "Close comparison" : "Compare variants"}</Button> : null}
    {compare ? <VariantComparison options={options} work={work} roomName={roomName} value={value} onChange={onChange} /> : null}
    {loading ? <small role="status">Loading variants…</small> : null}
    {error ? <p role="alert" className={s.error}>{error} <Button onPress={refresh} size="compact" variant="quiet">Retry</Button></p> : null}
  </div>;
}

function ProductActions({ work, roomName, lines, workspaceId, caseId, atLimit, onAdd, onEdit, onQuantity }: {
  work: CommercialCatalogChoice;
  roomName: string;
  lines: QuoteLine[];
  workspaceId: string;
  caseId: string;
  atLimit: boolean;
  onAdd: (work: CommercialCatalogChoice, variant: CommercialCatalogChoice | null) => void;
  onEdit: (id: string) => void;
  onQuantity: (id: string, quantity: number) => void;
}) {
  const [variantId, setVariantId] = useState<string | null>(null);
  const { items: variants, loading, error, refresh } = useCatalogOptions(workspaceId, caseId, "variant", "", work.id, work.catalogId);
  const variant = variants.find((item) => item.id === variantId) ?? variants[0] ?? null;
  const added = lines.filter((line) => line.catalogLinks?.some((link) => link.role === "work" && link.recordId === work.id));
  const matching = added.find((line) => line.catalogLinks?.find((link) => link.role === "variant")?.recordId === variant?.id) ?? (variant ? undefined : added[0]);
  const name = quotationItemName(work.name, roomName), ready = !loading && !error;
  return <div className={s.productActionCell}>
    {variants.length ? <VariantOptions options={variants} work={work} roomName={roomName} value={variant} onChange={(next) => setVariantId(next.id)} /> : null}
    {matching ? <div className={s.quantityStepper} aria-label={`Quantity for ${name}`}>
      <Button aria-label={`Decrease ${name}`} onPress={() => onQuantity(matching.id, Math.max(0, matching.quantity - 1))} size="compact" variant="quiet"><Minus size={13} /></Button>
      <span aria-live="polite">{matching.quantity}</span>
      <Button aria-label={`Add ${name}`} isDisabled={!ready || matching.quantity >= 1e6} onPress={() => onAdd(work, variant)} size="compact" variant="quiet"><Plus size={13} /></Button>
    </div> : <Button aria-label={`Add ${name}`} isDisabled={!ready || atLimit} onPress={() => onAdd(work, variant)} size="compact" variant="primary"><Plus size={13} />Add</Button>}
    {added.length ? <span className={s.productMeta}><span><Check size={12} />{added.reduce((sum, line) => sum + line.quantity, 0)} in room</span><Button aria-label={`Edit ${name}`} onPress={() => onEdit((matching ?? added[0]).id)} size="compact" variant="quiet"><Pencil size={12} />Materials &amp; price</Button></span> : null}
    {loading ? <small className={s.hint} role="status">Loading variants…</small> : null}
    {error ? <span role="alert" className={s.error}>{error} <Button onPress={refresh} size="compact" variant="quiet">Retry</Button></span> : null}
  </div>;
}

export function QuotationProductPicker({ workspaceId, caseId, catalogId, room, lines, atLimit, onAdd, onCustom, onEdit, onQuantity }: {
  workspaceId: string;
  caseId: string;
  catalogId?: string;
  room: CommercialCatalogChoice | null;
  lines: QuoteLine[];
  atLimit: boolean;
  onAdd: (work: CommercialCatalogChoice, variant: CommercialCatalogChoice | null) => void;
  onCustom: () => void;
  onEdit: (id: string) => void;
  onQuantity: (id: string, quantity: number) => void;
}) {
  const [search, setSearch] = useState(""), [allRooms, setAllRooms] = useState(false);
  const { items, loading, error, refresh } = useCatalogOptions(workspaceId, caseId, "work", search, allRooms ? undefined : room?.id, catalogId);
  const columns = useMemo<DataGridColumn<CommercialCatalogChoice>[]>(() => [
    { accessorKey: "name", header: "Item", size: 230, meta: { primary: true }, cell: ({ row }) => <span><strong>{quotationItemName(row.original.name, room?.name ?? "")}</strong><small>{row.original.code}{row.original.description ? ` · ${row.original.description}` : ""}</small></span> },
    { accessorKey: "catalogName", header: "Catalog", size: 140, cell: ({ row }) => row.original.catalogName ?? "—" },
    { id: "pricing", header: "Selling price", size: 130, accessorFn: (item) => pricingLabel(item.commerce?.pricingMode) },
    { id: "add", header: "Choose", size: 310, enableSorting: false, meta: { renderCell: (work) => <ProductActions work={work} roomName={room?.name ?? ""} workspaceId={workspaceId} caseId={caseId} lines={lines} atLimit={atLimit} onAdd={onAdd} onEdit={onEdit} onQuantity={onQuantity} /> } },
  ], [atLimit, caseId, lines, onAdd, onEdit, onQuantity, room?.name, workspaceId]);
  return <div className={s.productPicker}>
    <DataGrid
      appearance="card"
      ariaLabel="Catalog items"
      columns={columns}
      data={items}
      emptyDescription="Try another search or add a custom item."
      emptyTitle="No matching items"
      error={error || null}
      getRowId={(work) => work.id}
      isLoading={loading}
      onSearchChange={setSearch}
      persistKey="quotation-product-picker"
      rowNumbers={false}
      searchLabel="Search products"
      searchValue={search}
      selectable={false}
      showFooter={false}
      toolbarActions={<>
        {room ? <SegmentedControl label="Item source" onChange={(value) => setAllRooms(value === "all")} options={[{ id: "room", label: room.name }, { id: "all", label: "All items" }]} value={allRooms ? "all" : "room"} /> : null}
        {error ? <Button onPress={refresh} size="compact" variant="quiet">Retry</Button> : null}
        <Button isDisabled={atLimit} onPress={onCustom} size="compact" variant="secondary"><Plus size={13} />Custom item</Button>
      </>}
    />
  </div>;
}
