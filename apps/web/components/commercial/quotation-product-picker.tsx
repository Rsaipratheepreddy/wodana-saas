"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import { useMemo, useState } from "react";
import { Check, Minus, Pencil, Plus } from "lucide-react";
import { Button, DataGrid, SegmentedControl, SelectField, type DataGridColumn } from "@/design-system";
import type { QuoteLine } from "@/lib/commercial/types";
import { quotationItemName, quotationVariantName } from "@/lib/commercial/presentation";
import type { CommercialCatalogChoice } from "./catalog-picker";
import { useCatalogOptions } from "./catalog-options-cache";
import s from "./quotation-workbench.module.css";

const pricingLabel = (mode?: "unpriced" | "fixed" | "on_request") =>
  mode === "fixed" ? tKey("Fixed price") : mode === "on_request" ? tKey("Quote required") : tKey("Unpriced");

function VariantOptions({ options, work, roomName, value, onChange }: {
  options: CommercialCatalogChoice[];
  work: CommercialCatalogChoice;
  roomName: string;
  value: CommercialCatalogChoice | null;
  onChange: (variant: CommercialCatalogChoice) => void;
}) {
  const t = useT();
  if (options.length > 5) return <SelectField
    aria-label={t("Variant for {name}", { name: quotationItemName(work.name, roomName) })}
    items={options.map((variant) => ({ id: variant.id, label: quotationVariantName(variant.name, work.name, roomName, variant.code) }))}
    label={<span className="wd-visually-hidden">{t("Variant")}</span>}
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
  const t = useT();
  const columns = useMemo<DataGridColumn<CommercialCatalogChoice>[]>(() => [
    { accessorKey: "name", header: t("Variant"), size: 190, meta: { primary: true }, cell: ({ row }) => <span><strong>{quotationVariantName(row.original.name, work.name, roomName, row.original.code)}</strong><small>{row.original.code}</small></span> },
    { id: "specification", header: t("Specification"), size: 180, accessorFn: (variant) => String(variant.configuration?.specificationTier ?? variant.configuration?.qualityGrade ?? variant.configuration?.variant ?? variant.description ?? "—") },
    { id: "price", header: t("Price"), size: 120, accessorFn: (variant) => t(pricingLabel(variant.commerce?.pricingMode)) },
    { id: "select", header: "", size: 110, enableSorting: false, meta: { align: "end", renderCell: (variant) => <Button aria-label={t("Select {name}", { name: variant.name })} onPress={() => onChange(variant)} size="compact" variant={value?.id === variant.id ? "primary" : "secondary"}>{t(value?.id === variant.id ? "Selected" : "Select")}</Button> } },
  ], [onChange, roomName, t, value?.id, work.name]);
  return <DataGrid
    ariaLabel={t("Compare variants for {name}", { name: quotationItemName(work.name, roomName) })}
    columns={columns}
    data={options}
    emptyDescription={t("Add an active variant to this item before comparing.")}
    emptyTitle={t("No variants")}
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
  const t = useT();
  const [compare, setCompare] = useState(false);
  const { items, loading, error, refresh } = useCatalogOptions(workspaceId, caseId, "variant", "", work.id, work.catalogId);
  const options = value && !items.some((item) => item.id === value.id) ? [value, ...items] : items;
  if (!loading && !error && !options.length) return null;
  return <div className={s.variantOptions} role="group" aria-label={t("Variant")}>
    <span>{t("Variant")}</span>
    <VariantOptions options={options} work={work} roomName={roomName} value={value} onChange={onChange} />
    {options.length > 1 ? <Button onPress={() => setCompare((open) => !open)} size="compact" variant="quiet">{t(compare ? "Close comparison" : "Compare variants")}</Button> : null}
    {compare ? <VariantComparison options={options} work={work} roomName={roomName} value={value} onChange={onChange} /> : null}
    {loading ? <small role="status">{t("Loading variants…")}</small> : null}
    {error ? <p role="alert" className={s.error}>{translateKnown(t, error)} <Button onPress={refresh} size="compact" variant="quiet">{t("Retry")}</Button></p> : null}
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
  const t = useT();
  const [variantId, setVariantId] = useState<string | null>(null);
  const { items: variants, loading, error, refresh } = useCatalogOptions(workspaceId, caseId, "variant", "", work.id, work.catalogId);
  const variant = variants.find((item) => item.id === variantId) ?? variants[0] ?? null;
  const added = lines.filter((line) => line.catalogLinks?.some((link) => link.role === "work" && link.recordId === work.id));
  const matching = added.find((line) => line.catalogLinks?.find((link) => link.role === "variant")?.recordId === variant?.id) ?? (variant ? undefined : added[0]);
  const name = quotationItemName(work.name, roomName), ready = !loading && !error;
  return <div className={s.productActionCell}>
    {variants.length ? <VariantOptions options={variants} work={work} roomName={roomName} value={variant} onChange={(next) => setVariantId(next.id)} /> : null}
    {matching ? <div className={s.quantityStepper} aria-label={t("Quantity for {title}", { title: name })}>
      <Button aria-label={t("Decrease {name}", { name })} onPress={() => onQuantity(matching.id, Math.max(0, matching.quantity - 1))} size="compact" variant="quiet"><Minus size={13} /></Button>
      <span aria-live="polite">{matching.quantity}</span>
      <Button aria-label={t("Add {name}", { name })} isDisabled={!ready || matching.quantity >= 1e6} onPress={() => onAdd(work, variant)} size="compact" variant="quiet"><Plus size={13} /></Button>
    </div> : <Button aria-label={t("Add {name}", { name })} isDisabled={!ready || atLimit} onPress={() => onAdd(work, variant)} size="compact" variant="primary"><Plus size={13} />{t("Add")}</Button>}
    {added.length ? <span className={s.productMeta}><span><Check size={12} />{t("{count} in room", { count: added.reduce((sum, line) => sum + line.quantity, 0) })}</span><Button aria-label={t("Edit {title}", { title: name })} onPress={() => onEdit((matching ?? added[0]).id)} size="compact" variant="quiet"><Pencil size={12} />{t("Materials & price")}</Button></span> : null}
    {loading ? <small className={s.hint} role="status">{t("Loading variants…")}</small> : null}
    {error ? <span role="alert" className={s.error}>{translateKnown(t, error)} <Button onPress={refresh} size="compact" variant="quiet">{t("Retry")}</Button></span> : null}
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
  const t = useT();
  const [search, setSearch] = useState(""), [allRooms, setAllRooms] = useState(false);
  const { items, loading, error, refresh } = useCatalogOptions(workspaceId, caseId, "work", search, allRooms ? undefined : room?.id, catalogId);
  const columns = useMemo<DataGridColumn<CommercialCatalogChoice>[]>(() => [
    { accessorKey: "name", header: t("Item"), size: 230, meta: { primary: true }, cell: ({ row }) => <span><strong>{quotationItemName(row.original.name, room?.name ?? "")}</strong><small>{row.original.code}{row.original.description ? ` · ${row.original.description}` : ""}</small></span> },
    { accessorKey: "catalogName", header: t("Catalog"), size: 140, cell: ({ row }) => row.original.catalogName ?? "—" },
    { id: "pricing", header: t("Selling price"), size: 130, accessorFn: (item) => t(pricingLabel(item.commerce?.pricingMode)) },
    { id: "add", header: t("Choose"), size: 310, enableSorting: false, meta: { renderCell: (work) => <ProductActions work={work} roomName={room?.name ?? ""} workspaceId={workspaceId} caseId={caseId} lines={lines} atLimit={atLimit} onAdd={onAdd} onEdit={onEdit} onQuantity={onQuantity} /> } },
  ], [atLimit, caseId, lines, onAdd, onEdit, onQuantity, room?.name, t, workspaceId]);
  return <div className={s.productPicker}>
    <DataGrid
      ariaLabel={t("Catalog items")}
      columns={columns}
      data={items}
      emptyDescription={t("Try another search or add a custom item.")}
      emptyTitle={t("No matching items")}
      error={error ? translateKnown(t, error) : null}
      getRowId={(work) => work.id}
      isLoading={loading}
      onSearchChange={setSearch}
      persistKey="quotation-product-picker"
      rowNumbers={false}
      searchLabel={t("Search products")}
      searchValue={search}
      selectable={false}
      showFooter={false}
      toolbarActions={<>
        {room ? <SegmentedControl label={t("Item source")} onChange={(value) => setAllRooms(value === "all")} options={[{ id: "room", label: room.name }, { id: "all", label: t("All items") }]} value={allRooms ? "all" : "room"} /> : null}
        {error ? <Button onPress={refresh} size="compact" variant="quiet">{t("Retry")}</Button> : null}
        <Button isDisabled={atLimit} onPress={onCustom} size="compact" variant="secondary"><Plus size={13} />{t("Custom item")}</Button>
      </>}
    />
  </div>;
}
