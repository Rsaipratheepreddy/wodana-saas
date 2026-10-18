"use client";

import { useState } from "react";
import { Badge, Button, Checkbox, FormNotSaved, MenuButton, QuantityInput, ReviewDialog, SegmentedControl, SelectField, TextAreaField, TextInput, VisuallyHidden, FormDialog } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { WorkOrderMaterial, WorkOrderState } from "@/lib/factory/types";
import { useProjectFormat } from "../project-core/format";
import { subtractExact } from "@/lib/purchasing/amounts";
import { quantityText } from "../purchasing/order-labels";
import styles from "./factory.module.css";

/** Quantities stay exact decimal text for the payload; the number field shows and commits them. */
const asNumber = (value: string) => (value === "" ? Number.NaN : Number(value));
const asText = (next: number) => (Number.isFinite(next) ? String(next) : "");
const QUANTITY = { maximumFractionDigits: 4 };
type Run = (action: string, input?: Record<string, unknown>) => Promise<boolean>;
type Dialog = { kind: "add" | "list" } | { kind: "issue" | "return" | "quantity" | "swap"; material: WorkOrderMaterial } | { kind: "review"; material: WorkOrderMaterial } | null;

/**
 * What the work order uses: each material with how much is issued and on hand, what it's worth, and the
 * next thing to do with it (issue, return, change, swap). A swap waits for someone else's decision, made in a review of it.
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
      {open && state.canManage && state.canSuggest ? <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "list" })}>{t("Add from the material list")}</Button> : null}
      {open && state.canManage ? <Button size="compact" onPress={() => setDialog({ kind: "add" })}>{t("Add material")}</Button> : null}
    </div>
    {shown.length ? <ul className={styles.list}>{shown.map((row) => <li key={row.id}>
      <span className={styles.nameCell}>
        <span>{row.itemName}</span>
        <small>{row.status === "pending" ? t("Instead of {item}: {reason} ({name})", { item: row.replacesName ?? "", reason: row.reason, name: row.requestedByName })
          : row.status === "replaced" ? t("Replaced; {quantity} still issued", { quantity: amount(row, row.issued) })
          : row.status === "removed" ? t("Removed; {quantity} still issued", { quantity: amount(row, row.issued) })
          : [t("{issued} of {quantity} issued", { issued: quantityText(row.issued) || "0", quantity: amount(row, row.quantity) }),
            Number(row.projectOnHand) ? t("{quantity} in the project's stock", { quantity: amount(row, row.projectOnHand) }) : "",
            Number(row.freeOnHand) ? t("{quantity} free", { quantity: amount(row, row.freeOnHand) }) : ""].filter(Boolean).join(" · ")}</small>
      </span>
      {row.status === "pending" ? state.canApprove && row.requestedBy !== state.me
        ? <Button size="compact" variant="primary" isLoading={busy} onPress={() => setDialog({ kind: "review", material: row })}>{t("Review")}</Button>
        : <Badge tone="warning">{t("Waiting for a decision")}</Badge>
        : actions(row).length ? <MenuButton size="compact" label={t("Actions")} items={actions(row)} onAction={(id) => {
          if (id === "remove") void run("remove_material", { materialId: row.id });
          else setDialog({ kind: id as "issue" | "return" | "quantity" | "swap", material: row });
        }} /> : null}
    </li>)}</ul> : null}

    {dialog?.kind === "list" ? <ListDialog state={state} onClose={() => setDialog(null)}
      onSave={async (items) => { if (await run("suggest_materials", { items })) setDialog(null); }} /> : null}
    {dialog?.kind === "add" ? <MaterialDialog title={t("Add material")} state={state} action={t("Add material")} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("add_material", { materialId: crypto.randomUUID(), ...input })) setDialog(null); }} /> : null}
    {dialog?.kind === "swap" ? <MaterialDialog title={t("Swap {item}", { item: dialog.material.itemName })} state={state} action={t("Ask for the swap")} withReason onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("substitute", { materialId: crypto.randomUUID(), replacesId: dialog.material.id, ...input })) setDialog(null); }} /> : null}
    {dialog?.kind === "issue" || dialog?.kind === "return" ? <StockDialog state={state} material={dialog.material} mode={dialog.kind} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run(dialog.kind === "issue" ? "issue_material" : "return_material", { id: crypto.randomUUID(), materialId: dialog.material.id, ...input })) setDialog(null); }} /> : null}
    {dialog?.kind === "quantity" ? <QuantityDialog material={dialog.material} onClose={() => setDialog(null)}
      onSave={async (quantity) => { if (await run("set_material", { materialId: dialog.material.id, quantity })) setDialog(null); }} /> : null}
    {/* §0.3 P0: a swap is approved or refused in a review of what it changes, never one click. */}
    {dialog?.kind === "review" ? <ReviewDialog title={t("Swap {item}", { item: dialog.material.replacesName ?? "" })} description={dialog.material.itemName}
      confirmLabel={t("Approve")} rejectLabel={t("Refuse")} onClose={() => setDialog(null)}
      facts={[
        { label: t("Material"), value: dialog.material.itemName },
        { label: t("Quantity"), value: amount(dialog.material, dialog.material.quantity) },
        { label: t("Why it's swapped"), value: dialog.material.reason },
        { label: t("Requested by"), value: dialog.material.requestedByName },
      ]}
      onConfirm={async () => { if (!(await run("decide_substitution", { materialId: dialog.material.id, decision: "approve" }))) throw new FormNotSaved(); setDialog(null); }}
      onReject={async (note) => { if (!(await run("decide_substitution", { materialId: dialog.material.id, decision: "refuse", note }))) throw new FormNotSaved(); setDialog(null); }} /> : null}
  </section>;
}

/**
 * Materials from the project's list the work order doesn't use yet, to add with how much each: those used only on its
 * line come ticked with its share; any other (shared with other items, or tied to none) can be ticked.
 */
function ListDialog({ state, onClose, onSave }: {
  state: WorkOrderState; onClose: () => void; onSave: (items: Array<{ materialItemId: string; quantity: string }>) => Promise<void>;
}) {
  const t = useT();
  const offered = state.projectMaterials.filter((item) => !state.materials.some((row) => row.materialItemId === item.id && (row.status === "active" || row.status === "pending")));
  const [picks, setPicks] = useState<Record<string, { on: boolean; quantity: string }>>(() =>
    Object.fromEntries(offered.map((item) => [item.id, { on: Boolean(item.suggested), quantity: item.suggested ? quantityText(item.suggested) : "" }])));
  const pick = (id: string) => picks[id] ?? { on: false, quantity: "" };
  const set = (id: string, patch: Partial<{ on: boolean; quantity: string }>) => setPicks((current) => ({ ...current, [id]: { ...(current[id] ?? { on: false, quantity: "" }), ...patch } }));
  const chosen = offered.filter((item) => pick(item.id).on);
  const valid = chosen.length > 0 && chosen.every((item) => Number(pick(item.id).quantity) > 0);
  return <FormDialog size="md" title={t("Add from the material list")} onClose={onClose} isSubmitDisabled={!valid} submitLabel={t("Add materials")} onSubmit={async () => {
        await onSave(chosen.map((item) => ({ materialItemId: item.id, quantity: pick(item.id).quantity })));
      }}>
      <ul className={styles.picks}>{offered.map((item) => <li key={item.id}>
        <Checkbox isSelected={pick(item.id).on} onChange={(on) => set(item.id, { on })}>{item.unit ? `${item.name} (${item.unit})` : item.name}</Checkbox>
        {pick(item.id).on ? <QuantityInput label={<VisuallyHidden>{t("Quantity of {item}", { item: item.name })}</VisuallyHidden>} isRequired unit={item.unit} minValue={0}
          formatOptions={QUANTITY} value={asNumber(pick(item.id).quantity)} onChange={(next) => set(item.id, { quantity: asText(next) })} /> : null}
      </li>)}</ul>
  </FormDialog>;
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
  const listed = state.projectMaterials.find((item) => item.id === materialItemId);
  const valid = Number(quantity) > 0 && (listed || name.trim()) && (!withReason || reason.trim());
  return <FormDialog size="md" title={title} onClose={onClose} isSubmitDisabled={!valid} submitLabel={action} onSubmit={async () => {
        await onSave({ ...(listed ? { materialItemId: listed.id } : { name: name.trim(), unit: unit.trim() }), quantity, ...(withReason ? { reason: reason.trim() } : {}) });
      }}>
      <SelectField isRequired label={t("Material")} selectedKey={materialItemId} onSelectionChange={(key) => setMaterialItemId(key ? String(key) : other)}
        items={[...state.projectMaterials.map((item) => ({ id: item.id, label: item.unit ? `${item.name} (${item.unit})` : item.name })), { id: other, label: t("Another material") }]} />
      {!listed ? <>
        <TextInput label={t("Name")} isRequired value={name} onChange={setName} />
        <TextInput label={t("Unit")} value={unit} onChange={setUnit} />
      </> : null}
      <QuantityInput label={t("Quantity")} isRequired unit={listed?.unit ?? unit} minValue={0} formatOptions={QUANTITY} value={asNumber(quantity)} onChange={(next) => setQuantity(asText(next))} />
      {withReason ? <TextAreaField label={t("Why it's swapped")} isRequired value={reason} onChange={setReason} /> : null}
  </FormDialog>;
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
  const over = mode === "issue" ? Number(quantity) > Number(left) : Number(quantity) > Number(material.issued);
  const needsReason = mode === "return" || over;
  const valid = Number(quantity) > 0 && locationId && (!needsReason || reason.trim()) && !(mode === "return" && over);
  const unit = material.unit;
  return <FormDialog size="md" title={mode === "issue" ? t("Issue {item}", { item: material.itemName }) : t("Return {item}", { item: material.itemName })} onClose={onClose} isSubmitDisabled={!valid} submitLabel={mode === "issue" ? t("Issue") : t("Return")} onSubmit={async () => { await onSave({ locationId, quantity, reason: reason.trim(), ...(mode === "issue" ? { from } : {}) });
      }}>
      <SelectField label={mode === "issue" ? t("From") : t("Back to")} selectedKey={locationId} onSelectionChange={(key) => setLocationId(key ? String(key) : "")}
        items={places.map((place) => ({ id: place.id, label: place.name }))} />
      {mode === "issue" ? <SegmentedControl label={t("Whose stock")} value={from} onChange={(value) => setFrom(value as "project" | "free")}
        options={[{ id: "project", label: t("The project's") }, { id: "free", label: t("Free stock") }]} /> : null}
      <QuantityInput label={t("Quantity")} isRequired unit={unit} minValue={0} formatOptions={QUANTITY} value={asNumber(quantity)} onChange={(next) => setQuantity(asText(next))}
        isInvalid={mode === "return" && over} errorMessage={mode === "return" && over ? t("Only {quantity} was issued.", { quantity: `${quantityText(material.issued)} ${unit}`.trim() }) : undefined}
        description={mode === "issue" && over ? t("More than it still needs ({quantity}).", { quantity: `${quantityText(left) || "0"} ${unit}`.trim() }) : undefined} />
      {needsReason ? <TextInput label={mode === "issue" ? t("Why more") : t("Why it's coming back")} isRequired value={reason} onChange={setReason} /> : null}
  </FormDialog>;
}

function QuantityDialog({ material, onClose, onSave }: { material: WorkOrderMaterial; onClose: () => void; onSave: (quantity: string) => Promise<void> }) {
  const t = useT();
  const [quantity, setQuantity] = useState(quantityText(material.quantity));
  const under = Number(quantity) < Number(material.issued);
  return <FormDialog size="md" title={material.itemName} onClose={onClose} isSubmitDisabled={!(Number(quantity) > 0) || under} submitLabel={t("Save")} onSubmit={async () => { await onSave(quantity); }}>
    <QuantityInput label={t("Quantity")} isRequired unit={material.unit} minValue={0} formatOptions={QUANTITY} value={asNumber(quantity)} onChange={(next) => setQuantity(asText(next))}
      isInvalid={under} errorMessage={under ? t("{quantity} is already issued.", { quantity: `${quantityText(material.issued)} ${material.unit}`.trim() }) : undefined} />
  </FormDialog>;
}

