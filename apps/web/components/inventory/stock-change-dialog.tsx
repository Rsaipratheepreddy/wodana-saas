"use client";

import { useMemo, useState } from "react";
import { FormDialog, FormRow, InlineNotice, MoneyField, SelectField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { InventoryApi } from "@/lib/inventory/client";
import type { StockRow, StockState } from "@/lib/inventory/types";
import { quantityText } from "../purchasing/order-labels";

export type ChangeMode = "issue" | "allocate" | "release" | "count" | "return" | "add";
const numeric = (value: string) => value.replace(/[^\d.]/g, "");
const FREE = "free";
const NEW_ITEM = "new";

/**
 * One change to stock: issue it to a project, reserve free stock for one or release it, take unused
 * stock back from a project, count it, or add stock that isn't in the system yet (opening stock).
 */
export function StockChangeDialog({ api, state, mode, row, onClose, onDone }: {
  api: InventoryApi; state: StockState; mode: ChangeMode; row: StockRow | null; onClose: () => void; onDone: (next: StockState) => void;
}) {
  const t = useT();
  const [id] = useState(() => crypto.randomUUID());
  const [quantity, setQuantity] = useState(mode === "count" && row ? quantityText(row.onHand) : "");
  const [projectId, setProjectId] = useState<string | null>(row?.projectId ?? null);
  const [reason, setReason] = useState("");
  const [itemId, setItemId] = useState<string>(row?.itemId ?? NEW_ITEM);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [locationId, setLocationId] = useState<string | null>(row?.locationId ?? state.locations.find((location) => location.kind === "warehouse")?.id ?? state.locations[0]?.id ?? null);
  const [cost, setCost] = useState("");
  const items = useMemo(() => [...new Map(state.rows.map((item) => [item.itemId, item])).values()].sort((a, b) => a.itemName.localeCompare(b.itemName)), [state.rows]);
  const projectItems = state.projects.map((project) => ({ id: project.id, label: `${project.reference} · ${project.name}` }));
  const unitOf = row?.unit ?? items.find((item) => item.itemId === itemId)?.unit ?? unit;
  const title = { issue: t("Issue to a project"), allocate: t("Reserve for a project"), release: t("Release to free stock"), count: t("Count"),
    return: t("Take back from a project"), add: t("Add stock") }[mode];
  const over = row && ["issue", "allocate", "release"].includes(mode) && Number(quantity) > Number(row.onHand);
  const differs = mode === "count" && row && Number(quantity || 0) !== Number(row.onHand);
  const ready = Boolean(locationId) && quantity !== "" && (mode === "count" || Number(quantity) > 0) && !over
    && (mode !== "issue" || row?.projectId || projectId) && (mode !== "allocate" || projectId) && (mode !== "return" || projectId)
    && (!differs || reason.trim()) && (mode !== "add" || ((itemId !== NEW_ITEM || name.trim()) && reason.trim())) && (mode !== "return" || reason.trim());

  const save = async () => {
    {
      const base = { id, action: mode, locationId, reason: reason.trim() };
      const input = mode === "add" ? { ...base, ...(itemId === NEW_ITEM ? { name: name.trim(), unit: unit.trim() } : { itemId }), projectId, quantity, unitCost: cost || null }
        : mode === "count" ? { ...base, itemId: row!.itemId, projectId: row!.projectId, counted: quantity }
        : mode === "return" ? { ...base, itemId: row!.itemId, projectId: null, forProjectId: projectId, quantity }
        : { ...base, itemId: row!.itemId, projectId: row!.projectId, quantity, ...(mode === "issue" || mode === "allocate" ? { forProjectId: row!.projectId ?? projectId } : {}) };
      onDone(await api.change(input));
    }
  };
  return <FormDialog size="md" title={title} onClose={onClose} isDirty={Boolean(reason.trim() || (mode !== "count" && quantity))} isSubmitDisabled={!ready}
    submitLabel={mode === "count" ? t("Save count") : title} onSubmit={save}
    description={row ? `${row.itemName} · ${row.locationName} · ${row.projectReference ?? t("Free stock")} · ${t("{quantity} on hand", { quantity: `${quantityText(row.onHand)} ${row.unit}`.trim() })}` : undefined}>
      {mode === "add" ? <>
        <SelectField label={t("Item")} isRequired selectedKey={itemId} onSelectionChange={(key) => setItemId(String(key ?? NEW_ITEM))}
          items={[{ id: NEW_ITEM, label: t("A new item") }, ...items.map((item) => ({ id: item.itemId, label: item.unit ? `${item.itemName} (${item.unit})` : item.itemName }))]} />
        {itemId === NEW_ITEM ? <FormRow>
          <TextInput label={t("Name")} isRequired maxLength={200} value={name} onChange={setName} />
          <TextInput label={t("Unit")} maxLength={20} value={unit} onChange={setUnit} />
        </FormRow> : null}
        <FormRow>
          <SelectField label={t("Place")} isRequired selectedKey={locationId} onSelectionChange={(key) => setLocationId(key === null ? null : String(key))}
            items={state.locations.map((location) => ({ id: location.id, label: location.name }))} />
          <SelectField label={t("For")} selectedKey={projectId ?? FREE} onSelectionChange={(key) => setProjectId(key === null || key === FREE ? null : String(key))}
            items={[{ id: FREE, label: t("Free stock") }, ...projectItems]} />
        </FormRow>
      </> : null}
      {(mode === "issue" && !row?.projectId) || mode === "allocate" || mode === "return" ? <SelectField label={mode === "return" ? t("Back from") : t("Project")} isRequired
        selectedKey={projectId} onSelectionChange={(key) => setProjectId(key === null ? null : String(key))} items={projectItems} /> : null}
      <FormRow>
        <TextInput label={mode === "count" ? t("Counted") : t("Quantity")} isRequired inputMode="decimal" suffix={unitOf || undefined} value={quantity} onChange={(value) => setQuantity(numeric(value))} />
        {mode === "add" ? <MoneyField label={t("Cost each")} value={cost} onChange={setCost} /> : null}
      </FormRow>
      {over ? <InlineNotice tone="error" message={t("Only {quantity} there.", { quantity: `${quantityText(row!.onHand)} ${row!.unit}`.trim() })} /> : null}
      {mode === "add" || mode === "count" || mode === "return" || mode === "issue" ? <TextInput
        label={mode === "add" ? t("Where it comes from") : mode === "count" ? t("Why it's different") : mode === "return" ? t("Why it's coming back") : t("Note")}
        isRequired={mode === "add" || mode === "return" || Boolean(differs)} maxLength={500} value={reason} onChange={setReason} /> : null}
  </FormDialog>;
}
