"use client";

import { useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Plus, X } from "lucide-react";
import { Button, ControlledModalDialog, DateField, IconButton, InlineNotice, SelectField, Skeleton, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { ReorderPoint } from "@/lib/inventory/types";
import type { Need, SupplierState } from "@/lib/purchasing/types";
import { restockQuantity } from "@/lib/inventory/levels";
import { quantityText } from "./order-labels";
import { useSupplierLabels } from "./supplier-labels";
import styles from "./purchasing.module.css";

type Draft = { key: string; need: Need | null; stock: ReorderPoint | null; description: string; quantity: string; unit: string; unitPrice: string };
const numeric = (value: string) => value.replace(/[^\d.]/g, "");

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
  const [busy, setBusy] = useState(false);
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
  const update = (key: string, patch: Partial<Draft>) => setLines(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const save = async () => {
    if (!supplier || !company) return;
    setBusy(true); setError("");
    try {
      const created = await api.createOrder({ id, vendorId: supplier.id, legalEntityId: company, expectedDate: expected, ...(restock.length ? { deliverTo: "warehouse" } : {}),
        lines: lines.map((line) => ({ source: line.need?.source ?? "free", ...(line.need?.source === "material" ? { materialItemId: line.need.sourceId } : line.need?.source === "line" ? { boqLineId: line.need.sourceId } : {}),
          ...(line.stock ? { stockItemId: line.stock.itemId } : {}),
          description: line.need || line.stock ? undefined : line.description.trim(), quantity: line.quantity, unit: line.need || line.stock ? undefined : line.unit, unitPrice: line.unitPrice || undefined })) });
      onCreated(created.order.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not create the order.")); setBusy(false); }
  };

  return <ControlledModalDialog isOpen size="lg" title={t("New order")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={() => void save()}>{t("Create order")}</Button></div>}>
    {!suppliers && !error ? <Skeleton lines={5} /> : <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <div className={styles.pair}>
        <SelectField label={t("Supplier")} isRequired placeholder={t("Choose a supplier")} selectedKey={vendorId} onSelectionChange={(key) => { setVendorId(key === null ? null : String(key)); setCompanyId(null); }}
          items={active.map((item) => ({ id: item.id, label: item.approval === "approved" ? item.name : `${item.name} · ${labels.approval[item.approval]}` }))} />
        <DateField label={t("Needed by")} value={expected ? parseDate(expected) : null} onChange={(value) => setExpected(value ? value.toString() : null)} />
      </div>
      {supplier && companies.length > 1 ? <SelectField label={t("Buying company")} isRequired placeholder={t("Which company buys")} selectedKey={companyId}
        onSelectionChange={(key) => setCompanyId(key === null ? null : String(key))} items={companies.map((entity) => ({ id: entity.id, label: entity.name }))} /> : null}
      {supplier && !companies.length ? <InlineNotice tone="error" message={t("None of your companies buys from {supplier}. Add one to the supplier first.", { supplier: supplier.name })} /> : null}
      {supplier && supplier.approval !== "approved" ? <InlineNotice tone="info" message={t("{supplier} isn't approved yet; the order can be drafted but not placed.", { supplier: supplier.name })} /> : null}
      {held.length ? <InlineNotice tone="info" message={t("{projects} is on hold: the order is drafted, and placing it asks why it goes ahead.", { projects: held.join(", ") })} /> : null}
      <ul className={styles.draftLines} aria-label={t("Lines")}>
        {lines.map((line) => <li key={line.key}>
          {line.need ? <span className={styles.nameCell}><span>{line.need.title}</span><small>{line.need.projectReference}{line.need.detail ? ` · ${line.need.detail}` : ""}</small></span>
            : line.stock ? <span className={styles.nameCell}><span>{line.stock.itemName}</span><small>{t("Restock · {place}", { place: line.stock.locationName ?? t("Every place") })}</small></span>
            : <TextInput aria-label={t("What")} label={null} placeholder={t("What")} value={line.description} onChange={(description) => update(line.key, { description })} />}
          <TextInput aria-label={t("Quantity for {item}", { item: line.description || t("the line") })} label={null} inputMode="decimal" placeholder={t("Quantity")} value={line.quantity}
            onChange={(value) => update(line.key, { quantity: numeric(value) })} suffix={line.need || line.stock ? line.unit : undefined} />
          {line.need || line.stock ? null : <TextInput aria-label={t("Unit")} label={null} placeholder={t("Unit")} value={line.unit} onChange={(unit) => update(line.key, { unit })} />}
          <TextInput aria-label={t("Price for {item}", { item: line.description || t("the line") })} label={null} inputMode="decimal" placeholder={t("Price")} value={line.unitPrice}
            onChange={(value) => update(line.key, { unitPrice: numeric(value) })} suffix={supplier?.currency ?? undefined} />
          {lines.length > 1 ? <IconButton aria-label={t("Remove {item}", { item: line.description || t("the line") })} size="compact" variant="quiet" onPress={() => setLines(lines.filter((item) => item.key !== line.key))}><X aria-hidden="true" size={14} /></IconButton> : <span />}
        </li>)}
      </ul>
      {!needs.length && !restock.length ? <Button size="compact" variant="quiet" onPress={() => setLines([...lines, { key: crypto.randomUUID(), need: null, stock: null, description: "", quantity: "", unit: "", unitPrice: "" }])}>
        <Plus aria-hidden="true" size={14} />{t("Add line")}</Button> : null}
    </div>}
  </ControlledModalDialog>;
}
