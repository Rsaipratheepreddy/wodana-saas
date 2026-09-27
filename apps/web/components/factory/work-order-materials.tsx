"use client";

import { useState } from "react";
import { Button, ControlledModalDialog, MenuButton, SegmentedControl, SelectField, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { WorkOrderMaterial, WorkOrderState } from "@/lib/factory/types";
import { useProjectFormat } from "../project-core/format";
import { subtractExact } from "@/lib/purchasing/amounts";
import { quantityText } from "../purchasing/order-labels";
import styles from "./factory.module.css";

const numeric = (value: string) => value.replace(/[^\d.]/g, "");
type Run = (action: string, input?: Record<string, unknown>) => Promise<boolean>;
type Dialog = { kind: "add" } | { kind: "issue" | "return" | "quantity" | "swap"; material: WorkOrderMaterial } | { kind: "refuse"; material: WorkOrderMaterial } | null;

/**
 * What the work order uses: each material with how much is issued and on hand, what it's worth, and the
 * next thing to do with it (issue, return, change, swap). A swap waits for someone else's decision.
 */
export function WorkOrderMaterials({ state, run, busy }: { state: WorkOrderState; run: Run; busy: boolean }) {
  const t = useT();
  const format = useProjectFormat();
  const [dialog, setDialog] = useState<Dialog>(null);
  const open = ["planned", "released", "in_production", "on_hold"].includes(state.order.status);
  const shown = state.materials.filter((row) => row.status === "active" || row.status === "pending" || (row.status !== "refused" && Number(row.issued) > 0));
  const amount = (row: WorkOrderMaterial, value: string) => `${quantityText(value) || "0"} ${row.unit}`.trim();
  const actions = (row: WorkOrderMaterial) => !open ? [] : [
    ...(state.canIssue && row.status === "active" ? [{ id: "issue", label: t("Issue") }] : []),
    ...(state.canIssue && Number(row.issued) > 0 ? [{ id: "return", label: t("Return") }] : []),
    ...(state.canManage && row.status === "active" ? [{ id: "quantity", label: t("Change quantity") }] : []),
    ...(state.canManage && row.status === "active" && !state.materials.some((other) => other.replacesId === row.id && other.status === "pending") ? [{ id: "swap", label: t("Swap for another") }] : []),
    ...(state.canManage && row.status === "active" && !Number(row.issued) ? [{ id: "remove", label: t("Remove") }] : []),
  ];
  if (!shown.length && !(open && state.canManage)) return null;
  return <section className={styles.stack} aria-label={t("Materials")}>
    <div className={styles.filters}>
      <h3 className={styles.subhead}>{t("Materials")}</h3>
      {Number(state.materialCost) ? <span className={styles.muted}>{t("Issued worth {value}", { value: format.money(state.materialCost, state.currency) })}</span> : null}
      <span className={styles.spacer} />
      {open && state.canManage && state.canSuggest ? <Button size="compact" variant="quiet" isLoading={busy} onPress={() => void run("suggest_materials")}>{t("Add from the material list")}</Button> : null}
      {open && state.canManage ? <Button size="compact" onPress={() => setDialog({ kind: "add" })}>{t("Add material")}</Button> : null}
    </div>
    {shown.length ? <ul className={styles.list}>{shown.map((row) => <li key={row.id}>
      <span className={styles.nameCell}>
        <span>{row.itemName}</span>
        <small>{row.status === "pending" ? t("Instead of {item}: {reason} — {name}", { item: row.replacesName ?? "", reason: row.reason, name: row.requestedByName })
          : row.status === "replaced" ? t("Replaced; {quantity} still issued", { quantity: amount(row, row.issued) })
          : row.status === "removed" ? t("Removed; {quantity} still issued", { quantity: amount(row, row.issued) })
          : [t("{issued} of {quantity} issued", { issued: quantityText(row.issued) || "0", quantity: amount(row, row.quantity) }),
            Number(row.projectOnHand) ? t("{quantity} in the project's stock", { quantity: amount(row, row.projectOnHand) }) : "",
            Number(row.freeOnHand) ? t("{quantity} free", { quantity: amount(row, row.freeOnHand) }) : ""].filter(Boolean).join(" · ")}</small>
      </span>
      {row.status === "pending" ? state.canApprove && row.requestedBy !== state.me ? <span className={styles.filters}>
        <Button size="compact" variant="primary" isLoading={busy} onPress={() => void run("decide_substitution", { materialId: row.id, decision: "approve" })}>{t("Approve")}</Button>
        <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "refuse", material: row })}>{t("Refuse")}</Button>
      </span> : <small className={styles.muted}>{t("Waiting for a decision")}</small>
        : actions(row).length ? <MenuButton size="compact" label={t("Actions")} items={actions(row)} onAction={(id) => {
          if (id === "remove") void run("remove_material", { materialId: row.id });
          else setDialog({ kind: id as "issue" | "return" | "quantity" | "swap", material: row });
        }} /> : null}
    </li>)}</ul> : null}

    {dialog?.kind === "add" ? <MaterialDialog title={t("Add material")} state={state} action={t("Add material")} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("add_material", { materialId: crypto.randomUUID(), ...input })) setDialog(null); }} /> : null}
    {dialog?.kind === "swap" ? <MaterialDialog title={t("Swap {item}", { item: dialog.material.itemName })} state={state} action={t("Ask for the swap")} withReason onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("substitute", { materialId: crypto.randomUUID(), replacesId: dialog.material.id, ...input })) setDialog(null); }} /> : null}
    {dialog?.kind === "issue" || dialog?.kind === "return" ? <StockDialog state={state} material={dialog.material} mode={dialog.kind} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run(dialog.kind === "issue" ? "issue_material" : "return_material", { id: crypto.randomUUID(), materialId: dialog.material.id, ...input })) setDialog(null); }} /> : null}
    {dialog?.kind === "quantity" ? <QuantityDialog material={dialog.material} onClose={() => setDialog(null)}
      onSave={async (quantity) => { if (await run("set_material", { materialId: dialog.material.id, quantity })) setDialog(null); }} /> : null}
    {dialog?.kind === "refuse" ? <RefuseDialog onClose={() => setDialog(null)}
      onSave={async (note) => { if (await run("decide_substitution", { materialId: dialog.material.id, decision: "refuse", note })) setDialog(null); }} /> : null}
  </section>;
}

/** A material from the project's list, or any other by name and unit, with how much the work order uses. */
function MaterialDialog({ title, state, action, withReason = false, onClose, onSave }: {
  title: string; state: WorkOrderState; action: string; withReason?: boolean; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  const t = useT();
  const other = "other";
  const [materialItemId, setMaterialItemId] = useState(state.projectMaterials[0]?.id ?? other);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const listed = state.projectMaterials.find((item) => item.id === materialItemId);
  const valid = Number(quantity) > 0 && (listed || name.trim()) && (!withReason || reason.trim());
  return <ControlledModalDialog isOpen size="md" title={title} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => {
        setBusy(true);
        await onSave({ ...(listed ? { materialItemId: listed.id } : { name: name.trim(), unit: unit.trim() }), quantity, ...(withReason ? { reason: reason.trim() } : {}) });
        setBusy(false);
      }}>{action}</Button></div>}>
    <div className={styles.dialogBody}>
      <SelectField label={t("Material")} selectedKey={materialItemId} onSelectionChange={(key) => setMaterialItemId(key ? String(key) : other)}
        items={[...state.projectMaterials.map((item) => ({ id: item.id, label: item.unit ? `${item.name} (${item.unit})` : item.name })), { id: other, label: t("Another material") }]} />
      {!listed ? <div className={styles.pair}>
        <TextInput label={t("Name")} isRequired value={name} onChange={setName} />
        <TextInput label={t("Unit")} value={unit} onChange={setUnit} />
      </div> : null}
      <TextInput label={t("Quantity")} isRequired inputMode="decimal" suffix={(listed?.unit ?? unit) || undefined} value={quantity} onChange={(value) => setQuantity(numeric(value))} />
      {withReason ? <TextAreaField label={t("Why it's swapped")} isRequired value={reason} onChange={setReason} /> : null}
    </div>
  </ControlledModalDialog>;
}

/** Issue stock to the work order (from the project's own or free stock at a place), or send some back to the project's stock. */
function StockDialog({ state, material, mode, onClose, onSave }: {
  state: WorkOrderState; material: WorkOrderMaterial; mode: "issue" | "return"; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  const t = useT();
  const places = state.places.filter((place) => place.kind !== "site" || place.projectId === state.order.projectId);
  // What it still needs, exactly (never below nothing).
  const left = subtractExact(material.quantity, material.issued);
  const [locationId, setLocationId] = useState(places.find((place) => place.kind === "factory")?.id ?? places.find((place) => place.isDefault)?.id ?? places[0]?.id ?? "");
  const [from, setFrom] = useState<"project" | "free">(Number(material.projectOnHand) > 0 || !Number(material.freeOnHand) ? "project" : "free");
  const [quantity, setQuantity] = useState(mode === "issue" ? quantityText(left) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const over = mode === "issue" ? Number(quantity) > Number(left) : Number(quantity) > Number(material.issued);
  const needsReason = mode === "return" || over;
  const valid = Number(quantity) > 0 && locationId && (!needsReason || reason.trim()) && !(mode === "return" && over);
  const unit = material.unit;
  return <ControlledModalDialog isOpen size="md" title={mode === "issue" ? t("Issue {item}", { item: material.itemName }) : t("Return {item}", { item: material.itemName })}
    onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => {
        setBusy(true); await onSave({ locationId, quantity, reason: reason.trim(), ...(mode === "issue" ? { from } : {}) }); setBusy(false);
      }}>{mode === "issue" ? t("Issue") : t("Return")}</Button></div>}>
    <div className={styles.dialogBody}>
      <SelectField label={mode === "issue" ? t("From") : t("Back to")} selectedKey={locationId} onSelectionChange={(key) => setLocationId(key ? String(key) : "")}
        items={places.map((place) => ({ id: place.id, label: place.name }))} />
      {mode === "issue" ? <SegmentedControl label={t("Whose stock")} value={from} onChange={(value) => setFrom(value as "project" | "free")}
        options={[{ id: "project", label: t("The project's") }, { id: "free", label: t("Free stock") }]} /> : null}
      <TextInput label={t("Quantity")} isRequired inputMode="decimal" suffix={unit || undefined} value={quantity} onChange={(value) => setQuantity(numeric(value))}
        isInvalid={mode === "return" && over} errorMessage={mode === "return" && over ? t("Only {quantity} was issued.", { quantity: `${quantityText(material.issued)} ${unit}`.trim() }) : undefined}
        description={mode === "issue" && over ? t("More than it still needs ({quantity}).", { quantity: `${quantityText(left) || "0"} ${unit}`.trim() }) : undefined} />
      {needsReason ? <TextInput label={mode === "issue" ? t("Why more") : t("Why it's coming back")} isRequired value={reason} onChange={setReason} /> : null}
    </div>
  </ControlledModalDialog>;
}

function QuantityDialog({ material, onClose, onSave }: { material: WorkOrderMaterial; onClose: () => void; onSave: (quantity: string) => Promise<void> }) {
  const t = useT();
  const [quantity, setQuantity] = useState(quantityText(material.quantity));
  const [busy, setBusy] = useState(false);
  const under = Number(quantity) < Number(material.issued);
  return <ControlledModalDialog isOpen size="md" title={material.itemName} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!(Number(quantity) > 0) || under} onPress={async () => { setBusy(true); await onSave(quantity); setBusy(false); }}>{t("Save")}</Button></div>}>
    <TextInput label={t("Quantity")} isRequired inputMode="decimal" suffix={material.unit || undefined} value={quantity} onChange={(value) => setQuantity(numeric(value))}
      isInvalid={under} errorMessage={under ? t("{quantity} is already issued.", { quantity: `${quantityText(material.issued)} ${material.unit}`.trim() }) : undefined} />
  </ControlledModalDialog>;
}

function RefuseDialog({ onClose, onSave }: { onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Refuse the swap")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!note.trim()} onPress={async () => { setBusy(true); await onSave(note.trim()); setBusy(false); }}>{t("Refuse")}</Button></div>}>
    <TextAreaField label={t("Why it's refused")} isRequired value={note} onChange={setNote} />
  </ControlledModalDialog>;
}
