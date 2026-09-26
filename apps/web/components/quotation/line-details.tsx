"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, IconButton, InlineNotice, InspectorSheet, SegmentedControl, SelectField, Switch, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { LINE_KIND_LABEL, money, plain } from "@/lib/quotation/format";
import type { BuilderLine, BuilderState, BuildUpRow, LineKind } from "@/lib/quotation/types";
import styles from "./quote-builder.module.css";

const KINDS: LineKind[] = ["item", "service", "allowance", "client_supplied", "relocate", "dismantle", "remove_store", "dispose"];
const ROW_KINDS: BuildUpRow["kind"][] = ["material", "finish", "hardware", "labour", "other"];
const ROW_KIND_LABEL: Record<BuildUpRow["kind"], string> = { material: "Material", finish: "Finish", hardware: "Hardware", labour: "Labour", other: "Other" };
type Row = Pick<BuildUpRow, "kind" | "name" | "quantityFormula" | "quantity" | "unit" | "rate" | "unitCost" | "wastePercent" | "suppliedByClient" | "catalogItemId"> & { key: string };

/**
 * Everything about one line: what it is, where it goes, how its quantity is worked out (measurements
 * and a formula), how it's priced (a rate, or a build-up of materials and labour), its discount,
 * tax and notes. Saves as one change.
 */
export function LineDetails({ line, state, onClose, onSave }: { line: BuilderLine; state: BuilderState; onClose: () => void; onSave: (fields: Record<string, unknown>) => Promise<boolean> }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const { currency, decimals } = state.quote;
  const readOnly = !state.canEdit;
  const [form, setForm] = useState(() => ({
    kind: line.kind, title: line.title, description: line.description, areaId: line.areaId ?? "", fromAreaId: line.fromAreaId ?? "", workPackageId: line.workPackageId ?? "",
    length: line.length ?? "", width: line.width ?? "", height: line.height ?? "", count: line.count ?? "", dimensionUnit: line.dimensionUnit ?? "",
    formula: line.formula ?? "", quantity: line.quantity, unit: line.unit, pricingMode: line.pricingMode, rate: line.rate, unitCost: line.unitCost ?? "", markupPercent: line.markupPercent ?? "",
    discountKind: line.discountKind ?? "", discountValue: line.discountValue ?? "", taxCode: line.taxCode ?? "", optional: Boolean(line.optional), optionGroup: line.optionGroup ?? "", note: line.note,
  }));
  const [rows, setRows] = useState<Row[]>(() => line.components.map((part) => ({ ...part, key: part.id || crypto.randomUUID() })));
  const [rowsChanged, setRowsChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const original: Record<string, string | boolean> = {
    kind: line.kind, title: line.title, description: line.description, areaId: line.areaId ?? "", fromAreaId: line.fromAreaId ?? "", workPackageId: line.workPackageId ?? "",
    length: line.length ?? "", width: line.width ?? "", height: line.height ?? "", count: line.count ?? "", dimensionUnit: line.dimensionUnit ?? "", formula: line.formula ?? "",
    quantity: line.quantity, unit: line.unit, pricingMode: line.pricingMode, rate: line.rate, unitCost: line.unitCost ?? "", markupPercent: line.markupPercent ?? "",
    discountKind: line.discountKind ?? "", discountValue: line.discountValue ?? "", taxCode: line.taxCode ?? "", optional: Boolean(line.optional), optionGroup: line.optionGroup ?? "", note: line.note,
  };
  const changed = Object.keys(form).filter((key) => form[key as keyof typeof form] !== original[key]);
  const dirty = changed.length > 0 || rowsChanged;
  const editRows = (next: Row[]) => { setRows(next); setRowsChanged(true); };

  const save = async () => {
    const nullable = new Set(["areaId", "fromAreaId", "workPackageId", "length", "width", "height", "count", "dimensionUnit", "markupPercent", "taxCode", "optionGroup"]);
    const fields: Record<string, unknown> = {};
    for (const key of changed) {
      if (!state.canEditCosts && (key === "unitCost" || key === "markupPercent")) continue;
      const value = form[key as keyof typeof form];
      fields[key] = value === "" && nullable.has(key) ? null : value;
    }
    if (changed.includes("discountKind") || changed.includes("discountValue")) {
      fields.discountKind = form.discountKind || null;
      fields.discountValue = form.discountKind ? form.discountValue : null;
    }
    if (rowsChanged) fields.components = rows.map(({ key: _key, ...row }) => ({ ...row, quantity: row.quantity || "0", unitCost: state.canEditCosts ? row.unitCost : undefined }));
    setBusy(true);
    const ok = await onSave(fields);
    setBusy(false);
    if (ok) onClose();
  };

  const kindItems = KINDS.map((kind) => ({ id: kind, label: t(LINE_KIND_LABEL[kind] as never) }));
  const areaItems = [{ id: "", label: t("General") }, ...state.areas.map((area) => ({ id: area.id, label: area.name }))];
  const tradeItems = [{ id: "", label: t("No work package") }, ...state.workPackages.map((trade) => ({ id: trade.id, label: trade.name }))];
  const amount = state.pricing.lines.find((item) => item.id === line.id);
  return <InspectorSheet size="lg" isOpen isDirty={dirty} title={line.title || t("New line")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={readOnly ? undefined : <div className={styles.sheetActions}><Button variant="primary" size="compact" isLoading={busy} isDisabled={!dirty} onPress={() => void save()}>{t("Save")}</Button></div>}>
    <div className={styles.details}>
      <section className={styles.detailSection}>
        <div className={styles.pair}>
          <SelectField label={t("Type")} isDisabled={readOnly} items={kindItems} selectedKey={form.kind} onSelectionChange={(key) => set("kind", String(key) as LineKind)} />
          <SelectField label={t("Work package")} isDisabled={readOnly} items={tradeItems} selectedKey={form.workPackageId} onSelectionChange={(key) => set("workPackageId", String(key ?? ""))} />
        </div>
        <TextInput label={t("Name")} isReadOnly={readOnly} value={form.title} onChange={(value) => set("title", value)} />
        <TextAreaField label={t("Description")} isReadOnly={readOnly} value={form.description} onChange={(value) => set("description", value)} />
        <div className={styles.pair}>
          {form.kind === "relocate" ? <SelectField label={t("From area")} isDisabled={readOnly} items={areaItems.filter((item) => item.id)} selectedKey={form.fromAreaId || null} onSelectionChange={(key) => set("fromAreaId", String(key ?? ""))} /> : null}
          <SelectField label={form.kind === "relocate" ? t("To area") : t("Area")} isDisabled={readOnly} items={areaItems} selectedKey={form.areaId} onSelectionChange={(key) => set("areaId", String(key ?? ""))} />
        </div>
      </section>

      <section className={styles.detailSection} aria-label={t("Quantity")}>
        <h3>{t("Quantity")}</h3>
        <div className={styles.quad}>
          {(["length", "width", "height", "count"] as const).map((key) => <TextInput key={key} label={t(key[0].toUpperCase() + key.slice(1) as never)} isReadOnly={readOnly} inputMode="decimal" value={form[key]} onChange={(value) => set(key, value.replace(/[^\d.]/g, ""))} />)}
        </div>
        <TextInput label={t("Formula")} isReadOnly={readOnly} placeholder="area * 1.05" value={form.formula} onChange={(value) => set("formula", value)}
          description={t("Use length, width, height, count, area, perimeter or wall. Leave empty to type the quantity.")}
          errorMessage={line.formulaError && form.formula === (line.formula ?? "") ? line.formulaError : undefined} isInvalid={Boolean(line.formulaError && form.formula === (line.formula ?? ""))} />
        <div className={styles.pair}>
          {form.formula.trim() ? <p className={styles.worked}>{t("Works out to {quantity}", { quantity: plain(line.quantity, locale) })}</p>
            : <TextInput label={t("Quantity")} isReadOnly={readOnly} inputMode="decimal" value={form.quantity} onChange={(value) => set("quantity", value.replace(/[^\d.]/g, ""))} />}
          <TextInput label={t("Unit")} isReadOnly={readOnly} value={form.unit} onChange={(value) => set("unit", value)} />
        </div>
      </section>

      <section className={styles.detailSection} aria-label={t("Price")}>
        <h3>{t("Price")}</h3>
        {form.kind === "client_supplied" ? <InlineNotice tone="info" message={t("The client supplies this; it's installed at no charge for the item.")} /> : <>
          <SegmentedControl label={t("Pricing")} value={form.pricingMode} onChange={(value) => set("pricingMode", value as "rate" | "build_up")}
            options={[{ id: "rate", label: t("Rate") }, { id: "build_up", label: t("Build-up") }]} />
          {form.pricingMode === "rate" ? <div className={styles.triple}>
            <TextInput label={t("Rate")} isReadOnly={readOnly} inputMode="decimal" value={form.rate} onChange={(value) => set("rate", value.replace(/[^\d.]/g, ""))} />
            {state.canViewCosts ? <TextInput label={t("Cost")} isReadOnly={readOnly || !state.canEditCosts} inputMode="decimal" value={form.unitCost} onChange={(value) => set("unitCost", value.replace(/[^\d.]/g, ""))} /> : null}
            {state.canViewCosts ? <TextInput label={t("Markup %")} isReadOnly={readOnly || !state.canEditCosts} inputMode="decimal" value={form.markupPercent} onChange={(value) => set("markupPercent", value.replace(/[^\d.]/g, ""))} /> : null}
          </div> : <BuildUp rows={rows} readOnly={readOnly} costs={state.canViewCosts} editCosts={state.canEditCosts} line={line} onChange={editRows} currency={currency} decimals={decimals}
            markup={form.markupPercent} onMarkup={(value) => set("markupPercent", value)} />}
        </>}
        <div className={styles.pair}>
          <SelectField label={t("Discount")} isDisabled={readOnly} selectedKey={form.discountKind} onSelectionChange={(key) => set("discountKind", String(key ?? "") as "" | "percent" | "amount")}
            items={[{ id: "", label: t("None") }, { id: "percent", label: t("Percent") }, { id: "amount", label: t("Amount") }]} />
          {form.discountKind ? <TextInput label={form.discountKind === "percent" ? t("Discount %") : t("Discount amount")} isReadOnly={readOnly} inputMode="decimal" value={form.discountValue} onChange={(value) => set("discountValue", value.replace(/[^\d.]/g, ""))} /> : null}
        </div>
        {state.taxCodes.length ? <SelectField label={t("Tax")} isDisabled={readOnly} selectedKey={form.taxCode} onSelectionChange={(key) => set("taxCode", String(key ?? ""))}
          items={[{ id: "", label: t("Quote tax") }, ...state.taxCodes.map((tax) => ({ id: tax.code, label: `${tax.label} · ${plain(tax.rate, locale)}%` }))]} /> : null}
        {amount ? <p className={styles.worked}>{t("Line total {amount}", { amount: money(amount.net, currency, decimals, locale) })}</p> : null}
      </section>

      <section className={styles.detailSection}>
        <Switch isSelected={form.optional} isDisabled={readOnly} onChange={(value) => set("optional", value)}>{t("Optional — the client can add it")}</Switch>
        {form.optional ? <TextInput label={t("Choose-one group")} description={t("Options with the same group are alternatives; the client picks one.")} isReadOnly={readOnly} value={form.optionGroup} onChange={(value) => set("optionGroup", value)} /> : null}
        <TextAreaField label={t("Internal note")} isReadOnly={readOnly} value={form.note} onChange={(value) => set("note", value)} />
      </section>
    </div>
  </InspectorSheet>;
}

/** What one unit is made of: each row per one unit (a quantity or a formula), with its rate or cost. */
function BuildUp({ rows, readOnly, costs, editCosts, line, onChange, currency, decimals, markup, onMarkup }: {
  rows: Row[]; readOnly: boolean; costs: boolean; editCosts: boolean; line: BuilderLine; onChange: (rows: Row[]) => void; currency: string; decimals: number; markup: string; onMarkup: (value: string) => void;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const update = (key: string, patch: Partial<Row>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const worked = new Map(line.components.map((part, index) => [part.id || String(index), part.worked]));
  return <div className={styles.buildUp}>
    <table>
      <thead><tr>
        <th>{t("Part")}</th><th>{t("Per unit")}</th><th>{t("Unit")}</th><th>{t("Rate")}</th>{costs ? <th>{t("Cost")}</th> : null}<th>{t("Waste %")}</th><th>{t("Client")}</th><th><span className={styles.srOnly}>{t("Remove")}</span></th>
      </tr></thead>
      <tbody>{rows.map((row) => {
        const work = worked.get(row.key);
        return <tr key={row.key}>
          <td>
            <input aria-label={t("Part")} disabled={readOnly} value={row.name} onChange={(event) => update(row.key, { name: event.target.value })} />
            <select aria-label={t("Type")} disabled={readOnly} value={row.kind} onChange={(event) => update(row.key, { kind: event.target.value as Row["kind"] })}>
              {ROW_KINDS.map((kind) => <option key={kind} value={kind}>{t(ROW_KIND_LABEL[kind] as never)}</option>)}
            </select>
          </td>
          <td>
            <input aria-label={t("Per unit")} disabled={readOnly} value={row.quantityFormula ?? row.quantity} title={t("A number, or a formula like height * 2")}
              onChange={(event) => { const value = event.target.value; update(row.key, /^[\d.]*$/.test(value) ? { quantity: value, quantityFormula: null } : { quantityFormula: value }); }} />
            {work ? <small data-error={work.error ? true : undefined}>{work.error ?? `= ${plain(work.quantity, locale)}`}</small> : null}
          </td>
          <td><input aria-label={t("Unit")} disabled={readOnly} value={row.unit} onChange={(event) => update(row.key, { unit: event.target.value })} /></td>
          <td><input aria-label={t("Rate")} disabled={readOnly || row.suppliedByClient} inputMode="decimal" value={row.rate ?? ""} placeholder={costs ? t("from cost") : ""} onChange={(event) => update(row.key, { rate: event.target.value.replace(/[^\d.]/g, "") || null })} /></td>
          {costs ? <td><input aria-label={t("Cost")} disabled={readOnly || !editCosts} inputMode="decimal" value={row.unitCost ?? ""} onChange={(event) => update(row.key, { unitCost: event.target.value.replace(/[^\d.]/g, "") || null })} /></td> : null}
          <td><input aria-label={t("Waste %")} disabled={readOnly} inputMode="decimal" value={row.wastePercent ?? ""} onChange={(event) => update(row.key, { wastePercent: event.target.value.replace(/[^\d.]/g, "") || null })} /></td>
          <td><Checkbox aria-label={t("Client supplies")} isDisabled={readOnly} isSelected={row.suppliedByClient} onChange={(value) => update(row.key, { suppliedByClient: value })} /></td>
          <td>{readOnly ? null : <IconButton aria-label={t("Remove {name}", { name: row.name })} size="compact" variant="quiet" onPress={() => onChange(rows.filter((item) => item.key !== row.key))}><Trash2 aria-hidden="true" size={14} /></IconButton>}</td>
        </tr>;
      })}</tbody>
    </table>
    <div className={styles.buildUpFoot}>
      {readOnly ? null : <Button size="compact" variant="quiet" onPress={() => onChange([...rows, { key: crypto.randomUUID(), kind: "material", name: "", quantityFormula: null, quantity: "1", unit: "", rate: null, unitCost: null, wastePercent: null, suppliedByClient: false, catalogItemId: null }])}><Plus aria-hidden="true" size={14} />{t("Add part")}</Button>}
      {costs ? <label className={styles.inlineField}>{t("Markup % on cost")}<input inputMode="decimal" disabled={readOnly || !editCosts} value={markup} onChange={(event) => onMarkup(event.target.value.replace(/[^\d.]/g, ""))} /></label> : null}
      <span className={styles.spacer} />
      <strong>{t("Per unit {amount}", { amount: money(line.rate, currency, decimals, locale) })}</strong>
    </div>
  </div>;
}
