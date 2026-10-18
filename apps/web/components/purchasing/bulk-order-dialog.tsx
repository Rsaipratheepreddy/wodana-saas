"use client";

import { useEffect, useMemo, useState } from "react";
import { FormDialog, InlineNotice, MoneyField, SelectField, Skeleton, TextInput, VisuallyHidden } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { Need, SupplierState } from "@/lib/purchasing/types";
import { quantityText } from "./order-labels";
import styles from "./purchasing.module.css";

type Line = { need: Need; vendorId: string | null; quantity: string; unitPrice: string };
const numeric = (value: string) => value.replace(/[^\d.]/g, "");

/**
 * PLM-071: the lines chosen in "To order", each with its supplier (the catalog's preferred one, or the one its material
 * names), drafted as one order per supplier in one go. Each line keeps what it's for; placing each order still goes
 * through its own checks.
 */
export function BulkOrderDialog({ api, needs, onClose, onCreated }: { api: PurchasingApi; needs: Need[]; onClose: () => void; onCreated: (count: number) => void }) {
  const t = useT();
  const [ids] = useState(() => new Map<string, string>());
  const [suppliers, setSuppliers] = useState<SupplierState | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>(() => needs.map((need) => ({ need, vendorId: null, quantity: quantityText(need.remaining ?? need.required ?? "") || "", unitPrice: "" })));
  const [error, setError] = useState("");
  useEffect(() => {
    api.suppliers().then((state) => {
      setSuppliers(state);
      const open = state.suppliers.filter((item) => item.status !== "archived");
      setLines((current) => current.map((line) => {
        if (line.vendorId) return line;
        const preferred = open.find((item) => item.id === line.need.supplierId);
        const hint = line.need.supplierHint.trim().toLocaleLowerCase();
        return { ...line, vendorId: preferred?.id ?? (hint ? open.find((item) => item.name.toLocaleLowerCase().includes(hint))?.id ?? null : null) };
      }));
    }).catch((cause: Error) => setError(cause.message));
  }, [api]);
  const active = useMemo(() => (suppliers?.suppliers ?? []).filter((item) => item.status !== "archived")
    .sort((a, b) => Number(b.approval === "approved") - Number(a.approval === "approved") || a.name.localeCompare(b.name)), [suppliers]);
  const vendors = [...new Set(lines.map((line) => line.vendorId).filter((id): id is string => Boolean(id)))];
  const entities = suppliers?.entities ?? [];
  // A supplier several of your companies buy from needs the buying company once for the batch.
  const needsCompany = entities.length > 1 && vendors.some((id) => (active.find((item) => item.id === id)?.entityIds.length ?? 0) !== 1);
  const valid = lines.length > 0 && lines.every((line) => line.vendorId && Number(line.quantity) > 0) && (!needsCompany || companyId);
  const update = (key: string, patch: Partial<Line>) => setLines(lines.map((line) => (line.need.key === key ? { ...line, ...patch } : line)));
  const idFor = (vendorId: string) => { if (!ids.has(vendorId)) ids.set(vendorId, crypto.randomUUID()); return ids.get(vendorId)!; };

  const save = async () => {
    setError("");
    const orders = vendors.map((vendorId) => {
      const supplier = active.find((item) => item.id === vendorId);
      return {
        id: idFor(vendorId), vendorId, ...(supplier?.entityIds.length === 1 ? {} : companyId ? { legalEntityId: companyId } : {}),
        lines: lines.filter((line) => line.vendorId === vendorId).map((line) => ({
          source: line.need.source, ...(line.need.source === "material" ? { materialItemId: line.need.sourceId } : { boqLineId: line.need.sourceId }),
          quantity: line.quantity, unitPrice: line.unitPrice || undefined })),
      };
    });
    const created = await api.createOrders(orders);
    onCreated(created.orders.length);
  };

  return <FormDialog size="lg" title={t("Orders by supplier")} onClose={onClose} error={error || undefined} errorTitle={t("Could not create the orders.")} isSubmitDisabled={!valid}
    isDirty={lines.some((line) => line.unitPrice)} submitLabel={vendors.length > 1 ? t("Create {count} orders", { count: vendors.length }) : t("Create order")} onSubmit={save}>
    {!suppliers && !error ? <Skeleton lines={5} /> : <>
      {needsCompany ? <SelectField label={t("Buying company")} isRequired placeholder={t("Which company buys")} selectedKey={companyId}
        onSelectionChange={(key) => setCompanyId(key === null ? null : String(key))} items={entities.map((entity) => ({ id: entity.id, label: entity.name }))} /> : null}
      {lines.some((line) => line.need.projectStatus === "on_hold")
        ? <InlineNotice tone="info" message={t("A project is on hold: its order is drafted, and placing it asks why it goes ahead.")} /> : null}
      <ul className={styles.draftLines} aria-label={t("Lines")}>
        {lines.map((line) => <li key={line.need.key}>
          <span className={styles.nameCell}><span>{line.need.title}</span><small>{line.need.projectReference}{line.need.detail ? ` · ${line.need.detail}` : ""}</small></span>
          <SelectField aria-label={t("Supplier for {item}", { item: line.need.title })} label={null} placeholder={t("Choose a supplier")} selectedKey={line.vendorId}
            onSelectionChange={(key) => update(line.need.key, { vendorId: key === null ? null : String(key) })} items={active.map((item) => ({ id: item.id, label: item.name }))} />
          <TextInput aria-label={t("Quantity for {item}", { item: line.need.title })} label={null} inputMode="decimal" placeholder={t("Quantity")} value={line.quantity}
            onChange={(value) => update(line.need.key, { quantity: numeric(value) })} suffix={line.need.unit} />
          <MoneyField label={<VisuallyHidden>{t("Price for {item}", { item: line.need.title })}</VisuallyHidden>} placeholder={t("Price")}
            currency={active.find((item) => item.id === line.vendorId)?.currency ?? undefined} value={line.unitPrice} onChange={(unitPrice) => update(line.need.key, { unitPrice })} />
        </li>)}
      </ul>
    </>}
  </FormDialog>;
}
