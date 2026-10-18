"use client";

import { useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Plus, X } from "lucide-react";
import { Button, DataGrid, DateField, FormDialog, IconButton, InlineNotice, MoneyField, QuantityInput, SelectField, Skeleton, TextInput, VisuallyHidden, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { ReorderPoint } from "@/lib/inventory/types";
import type { Need, SupplierState } from "@/lib/purchasing/types";
import { restockQuantity } from "@/lib/inventory/levels";
import { fieldNumber, fieldText, quantityText } from "./order-labels";
import { useSupplierLabels } from "./supplier-labels";
import styles from "./purchasing.module.css";

type Draft = { key: string; need: Need | null; stock: ReorderPoint | null; description: string; quantity: string; unit: string; unitPrice: string };

/**
 * A new order to one supplier: from the lines chosen in "To order" (each keeps what it's for), stock to
 * restock (each line lands on its stock item, delivered to the warehouse), or blank. Prices left empty come
 * from the supplier's catalog price where there is one.
 */
export function CreateOrderDialog({ api, needs, restock = [], onClose, onCreated }: {
  api: PurchasingApi; needs: Need[]; restock?: ReorderPoint[]; onClose: () => void; onCreated: (orderId: string) => void;
}) {
  const t = useT();
  const labels = useSupplierLabels();
  const [id] = useState(() => crypto.randomUUID());
  const [suppliers, setSuppliers] = useState<SupplierState | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [expected, setExpected] = useState<string | null>(null);
  const [lines, setLines] = useState<Draft[]>(() => needs.length
    ? needs.map((need) => ({ key: need.key, need, stock: null, description: need.title, quantity: quantityText(need.remaining ?? need.required ?? "") || "", unit: need.unit, unitPrice: "" }))
    : restock.length ? restock.map((point) => ({ key: point.id, need: null, stock: point, description: point.itemName, quantity: quantityText(restockQuantity(point)), unit: point.unit, unitPrice: "" }))
    : [{ key: crypto.randomUUID(), need: null, stock: null, description: "", quantity: "", unit: "", unitPrice: "" }]);
  const [error, setError] = useState("");
  const held = [...new Set(needs.filter((need) => need.projectStatus === "on_hold").map((need) => need.projectReference))];
  useEffect(() => {
    api.suppliers().then((state) => {
      setSuppliers(state);
      // The supplier restocking names, or a material that names its supplier, picks it.
      const vendors = [...new Set(restock.map((point) => point.vendorId).filter((value): value is string => Boolean(value)))];
      if (vendors.length === 1 && state.suppliers.some((item) => item.id === vendors[0] && item.status !== "archived")) { setVendorId(vendors[0]); return; }
      const hint = needs.map((need) => need.supplierHint.trim().toLocaleLowerCase()).find(Boolean);
      const match = hint ? state.suppliers.find((item) => item.status !== "archived" && item.name.toLocaleLowerCase().includes(hint)) : undefined;
      if (match) setVendorId(match.id);
    }).catch((cause: Error) => setError(cause.message));
  }, [api, needs, restock]);
  const active = useMemo(() => (suppliers?.suppliers ?? []).filter((item) => item.status !== "archived")
    .sort((a, b) => Number(b.approval === "approved") - Number(a.approval === "approved") || a.name.localeCompare(b.name)), [suppliers]);
  const supplier = active.find((item) => item.id === vendorId) ?? null;
  const companies = (suppliers?.entities ?? []).filter((entity) => !supplier?.entityIds.length || supplier.entityIds.includes(entity.id));
  const company = companies.length === 1 ? companies[0].id : companyId;
  const valid = supplier && company && lines.length && lines.every((line) => line.description.trim() && Number(line.quantity) > 0);
  const update = (key: string, patch: Partial<Draft>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const hidden = (text: string) => <VisuallyHidden>{text}</VisuallyHidden>;
  const named = (line: Draft) => line.description || t("the line");
  const columns: DataGridColumn<Draft>[] = [
    { id: "item", header: t("Item"), size: 240, accessorFn: (line) => line.description, meta: { renderCell: (line) => line.need
      ? <span className={styles.nameCell}><span>{line.need.title}</span><small>{line.need.projectReference}{line.need.detail ? ` · ${line.need.detail}` : ""}</small></span>
      : line.stock ? <span className={styles.nameCell}><span>{line.stock.itemName}</span><small>{t("Restock · {place}", { place: line.stock.locationName ?? t("Every place") })}</small></span>
      : <TextInput label={hidden(t("What"))} maxLength={240} placeholder={t("What")} value={line.description} onChange={(description) => update(line.key, { description })} /> } },
    { id: "quantity", header: t("Quantity"), size: 150, accessorFn: (line) => line.quantity, meta: { align: "end", renderCell: (line) =>
      <QuantityInput label={hidden(t("Quantity for {item}", { item: named(line) }))} unit={line.need || line.stock ? line.unit : ""} minValue={0} formatOptions={{ maximumFractionDigits: 4 }}
        value={fieldNumber(line.quantity)} onChange={(value) => update(line.key, { quantity: fieldText(value) })} /> } },
    ...(lines.some((line) => !line.need && !line.stock) ? [{ id: "unit", header: t("Unit"), size: 110, accessorFn: (line: Draft) => line.unit, meta: { renderCell: (line: Draft) => line.need || line.stock ? null
      : <TextInput label={hidden(t("Unit"))} placeholder={t("Unit")} value={line.unit} onChange={(unit) => update(line.key, { unit })} /> } }] : []),
    { id: "price", header: t("Price"), size: 160, accessorFn: (line) => line.unitPrice, meta: { align: "end", renderCell: (line) =>
      <MoneyField label={hidden(t("Price for {item}", { item: named(line) }))} placeholder={t("Price")} currency={supplier?.currency ?? undefined}
        value={line.unitPrice} onChange={(unitPrice) => update(line.key, { unitPrice })} /> } },
    ...(lines.length > 1 ? [{ id: "remove", header: "", size: 56, enableSorting: false, meta: { align: "end" as const, renderCell: (line: Draft) =>
      <IconButton aria-label={t("Remove {item}", { item: named(line) })} size="compact" variant="quiet" onPress={() => setLines(lines.filter((item) => item.key !== line.key))}><X aria-hidden="true" size={14} /></IconButton> } }] : []),
  ];

  const save = async () => {
    if (!supplier || !company) return;
    setError("");
    {
      const created = await api.createOrder({ id, vendorId: supplier.id, legalEntityId: company, expectedDate: expected, ...(restock.length ? { deliverTo: "warehouse" } : {}),
        lines: lines.map((line) => ({ source: line.need?.source ?? "free", ...(line.need?.source === "material" ? { materialItemId: line.need.sourceId } : line.need?.source === "line" ? { boqLineId: line.need.sourceId } : {}),
          ...(line.stock ? { stockItemId: line.stock.itemId } : {}),
          description: line.need || line.stock ? undefined : line.description.trim(), quantity: line.quantity, unit: line.need || line.stock ? undefined : line.unit, unitPrice: line.unitPrice || undefined })) });
      onCreated(created.order.id);
    }
  };

  return <FormDialog size="lg" title={t("New order")} onClose={onClose} error={error || undefined} errorTitle={t("Could not create the order.")} isSubmitDisabled={!valid}
    isDirty={lines.some((line) => line.description.trim() && !line.need && !line.stock) || Boolean(vendorId && !needs.length && !restock.length)} submitLabel={t("Create order")} onSubmit={save}>
    {!suppliers && !error ? <Skeleton lines={5} /> : <>
      <SelectField label={t("Supplier")} isRequired placeholder={t("Choose a supplier")} selectedKey={vendorId} onSelectionChange={(key) => { setVendorId(key === null ? null : String(key)); setCompanyId(null); }}
        items={active.map((item) => ({ id: item.id, label: item.approval === "approved" ? item.name : `${item.name} · ${labels.approval[item.approval]}` }))} />
      <DateField label={t("Needed by")} value={expected ? parseDate(expected) : null} onChange={(value) => setExpected(value ? value.toString() : null)} />
      {supplier && companies.length > 1 ? <SelectField label={t("Buying company")} isRequired placeholder={t("Which company buys")} selectedKey={companyId}
        onSelectionChange={(key) => setCompanyId(key === null ? null : String(key))} items={companies.map((entity) => ({ id: entity.id, label: entity.name }))} /> : null}
      {supplier && !companies.length ? <InlineNotice tone="error" message={t("None of your companies buys from {supplier}. Add one to the supplier first.", { supplier: supplier.name })} /> : null}
      {supplier && supplier.approval !== "approved" ? <InlineNotice tone="info" message={t("{supplier} isn't approved yet; the order can be drafted but not placed.", { supplier: supplier.name })} /> : null}
      {held.length ? <InlineNotice tone="info" message={t("{projects} is on hold: the order is drafted, and placing it asks why it goes ahead.", { projects: held.join(", ") })} /> : null}
      <DataGrid ariaLabel={t("Lines")} data={lines} getRowId={(line) => line.key} columns={columns}
        showToolbar={false} showFooter={false} selectable={false} rowNumbers={false} pinFirstColumn={false} wrapText />
      {!needs.length && !restock.length ? <div><Button size="compact" variant="quiet" onPress={() => setLines([...lines, { key: crypto.randomUUID(), need: null, stock: null, description: "", quantity: "", unit: "", unitPrice: "" }])}>
        <Plus aria-hidden="true" size={14} />{t("Add line")}</Button></div> : null}
    </>}
  </FormDialog>;
}
