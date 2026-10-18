"use client";

import { useState } from "react";
import { Button, FormDialog, QuantityInput, SelectField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { InventoryApi } from "@/lib/inventory/client";
import type { ReorderPoint, StockState } from "@/lib/inventory/types";
import { quantityText } from "../purchasing/order-labels";

/** Quantities stay exact decimal text for the payload; the number field shows and commits them. */
const asNumber = (value: string) => (value === "" ? Number.NaN : Number(value));
const asText = (next: number) => (Number.isFinite(next) ? String(next) : "");
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
  const [removing, setRemoving] = useState(false);
  const save = async (remove = false) => {
    onDone(await api.setReorderPoint(remove ? { id, version: point?.version, remove: true } : { id, version: point?.version, itemId: item.itemId, locationId: place === EVERYWHERE ? null : place,
      reorderAt, reorderQuantity: quantity || null, vendorId: vendorId === NOBODY ? null : vendorId }));
  };
  const remove = async () => {
    setRemoving(true); setError("");
    try { await save(true); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setRemoving(false); }
  };
  return <FormDialog size="md" title={t("Reorder point")} description={item.itemName} onClose={onClose} error={error || undefined} isSubmitDisabled={reorderAt === ""} submitLabel={t("Save")}
    onSubmit={() => { setError(""); return save(); }}
    secondaryAction={point ? <Button variant="quiet" isLoading={removing} onPress={() => void remove()}>{t("Remove")}</Button> : undefined}>
      <SelectField label={t("Where")} isRequired isDisabled={Boolean(point)} selectedKey={place} onSelectionChange={(key) => setPlace(String(key ?? EVERYWHERE))}
        items={[{ id: EVERYWHERE, label: t("Every place together") }, ...state.locations.filter((location) => location.kind !== "site").map((location) => ({ id: location.id, label: location.name }))]} />
      <QuantityInput label={t("Low at")} isRequired unit={item.unit} minValue={0} formatOptions={{ maximumFractionDigits: 4 }} value={asNumber(reorderAt)} onChange={(next) => setReorderAt(asText(next))} />
      <QuantityInput label={t("Order")} unit={item.unit} minValue={0} formatOptions={{ maximumFractionDigits: 4 }} value={asNumber(quantity)} onChange={(next) => setQuantity(asText(next))} />
      {suppliers ? <SelectField label={t("From")} selectedKey={vendorId} onSelectionChange={(key) => setVendorId(String(key ?? NOBODY))}
        items={[{ id: NOBODY, label: t("Any supplier") }, ...suppliers.map((supplier) => ({ id: supplier.id, label: supplier.name }))]} /> : null}
  </FormDialog>;
}
