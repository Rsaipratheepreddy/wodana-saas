"use client";

import { useState } from "react";
import { Button, ControlledModalDialog, InlineNotice, SelectField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { InventoryApi } from "@/lib/inventory/client";
import type { ReorderPoint, StockState } from "@/lib/inventory/types";
import { quantityText } from "../purchasing/order-labels";
import styles from "./inventory.module.css";

const numeric = (value: string) => value.replace(/[^\d.]/g, "");
const EVERYWHERE = "everywhere";
const NOBODY = "none";

/**
 * An item's reorder point: the free stock at or below which it's low (at one place, or every place
 * together), what to order then and from whom. The people who keep and buy stock hear when it runs short.
 */
export function ReorderPointDialog({ api, state, item, point, suppliers, onClose, onDone }: {
  api: InventoryApi; state: StockState; item: { itemId: string; itemName: string; unit: string; locationId: string | null }; point: ReorderPoint | null;
  suppliers: Array<{ id: string; name: string }> | null; onClose: () => void; onDone: (next: StockState) => void;
}) {
  const t = useT();
  const [id] = useState(() => point?.id ?? crypto.randomUUID());
  const [place, setPlace] = useState<string>(point ? point.locationId ?? EVERYWHERE : item.locationId ?? EVERYWHERE);
  const [reorderAt, setReorderAt] = useState(point ? quantityText(point.reorderAt) : "");
  const [quantity, setQuantity] = useState(point?.reorderQuantity ? quantityText(point.reorderQuantity) : "");
  const [vendorId, setVendorId] = useState<string>(point?.vendorId ?? NOBODY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (remove = false) => {
    setBusy(true); setError("");
    try {
      onDone(await api.setReorderPoint(remove ? { id, version: point?.version, remove: true } : { id, version: point?.version, itemId: item.itemId, locationId: place === EVERYWHERE ? null : place,
        reorderAt, reorderQuantity: quantity || null, vendorId: vendorId === NOBODY ? null : vendorId }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
  };
  return <ControlledModalDialog isOpen size="md" title={t("Reorder point")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions">
      {point ? <Button variant="quiet" isLoading={busy} onPress={() => void save(true)}>{t("Remove")}</Button> : null}<span className={styles.spacer} />
      <Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={reorderAt === ""} onPress={() => void save()}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <p className={styles.dialogText}>{item.itemName}</p>
      <SelectField label={t("Where")} isDisabled={Boolean(point)} selectedKey={place} onSelectionChange={(key) => setPlace(String(key ?? EVERYWHERE))}
        items={[{ id: EVERYWHERE, label: t("Every place together") }, ...state.locations.filter((location) => location.kind !== "site").map((location) => ({ id: location.id, label: location.name }))]} />
      <div className={styles.pair}>
        <TextInput label={t("Low at")} description={t("Free stock at or below this")} isRequired inputMode="decimal" suffix={item.unit || undefined} value={reorderAt} onChange={(value) => setReorderAt(numeric(value))} />
        <TextInput label={t("Order")} inputMode="decimal" suffix={item.unit || undefined} value={quantity} onChange={(value) => setQuantity(numeric(value))} />
      </div>
      {suppliers ? <SelectField label={t("From")} selectedKey={vendorId} onSelectionChange={(key) => setVendorId(String(key ?? NOBODY))}
        items={[{ id: NOBODY, label: t("Any supplier") }, ...suppliers.map((supplier) => ({ id: supplier.id, label: supplier.name }))]} /> : null}
    </div>
  </ControlledModalDialog>;
}
