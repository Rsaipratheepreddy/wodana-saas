"use client";

import { useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, ControlledModalDialog, DateField, InlineNotice, MultiSelectField, SelectField, Skeleton, Switch, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { Need, SupplierState } from "@/lib/purchasing/types";
import { quantityText } from "./order-labels";
import styles from "./purchasing.module.css";

/** Asks several suppliers to price the chosen lines; each can be emailed the list. Any supplier may be asked. */
export function AskPricesDialog({ api, needs, onClose, onCreated }: { api: PurchasingApi; needs: Need[]; onClose: () => void; onCreated: (requestId: string) => void }) {
  const t = useT();
  const [id] = useState(() => crypto.randomUUID());
  const [suppliers, setSuppliers] = useState<SupplierState | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [neededBy, setNeededBy] = useState<string | null>(null);
  const [send, setSend] = useState(true);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.suppliers().then(setSuppliers).catch((cause: Error) => setError(cause.message)); }, [api]);
  const active = useMemo(() => (suppliers?.suppliers ?? []).filter((item) => item.status !== "archived").sort((a, b) => a.name.localeCompare(b.name)), [suppliers]);
  const companies = suppliers?.entities ?? [];
  const company = companies.length === 1 ? companies[0].id : companyId;
  const save = async () => {
    setBusy(true); setError("");
    try {
      const created = await api.createPriceRequest({ id, vendorIds: [...chosen], legalEntityId: company, neededBy, notes: notes.trim(), send,
        lines: needs.map((need) => ({ source: need.source, ...(need.source === "material" ? { materialItemId: need.sourceId } : { boqLineId: need.sourceId }),
          quantity: quantityText(need.remaining ?? need.required ?? "") || "1" })) });
      onCreated(created.request.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not ask for prices.")); setBusy(false); }
  };
  return <ControlledModalDialog isOpen size="md" title={t("Ask for prices")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!chosen.size || !company} onPress={() => void save()}>{t("Ask {count} suppliers", { count: chosen.size })}</Button></div>}>
    {!suppliers && !error ? <Skeleton lines={4} /> : <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <p className={styles.dialogText}>{needs.map((need) => `${need.title} (${quantityText(need.remaining ?? need.required ?? "")} ${need.unit})`).join(", ")}</p>
      <MultiSelectField label={t("Suppliers")} selectedKeys={chosen} onSelectionChange={(keys) => setChosen(new Set([...keys].map(String)))}
        items={active.map((item) => ({ id: item.id, label: item.categories.length ? `${item.name} · ${item.categories.slice(0, 2).join(", ")}` : item.name }))} />
      <div className={styles.pair}>
        {companies.length > 1 ? <SelectField label={t("Buying company")} isRequired placeholder={t("Which company buys")} selectedKey={companyId}
          onSelectionChange={(key) => setCompanyId(key === null ? null : String(key))} items={companies.map((entity) => ({ id: entity.id, label: entity.name }))} /> : null}
        <DateField label={t("Needed by")} value={neededBy ? parseDate(neededBy) : null} onChange={(value) => setNeededBy(value ? value.toString() : null)} />
      </div>
      <TextAreaField label={t("Note for the suppliers")} value={notes} onChange={setNotes} />
      <Switch isSelected={send} onChange={setSend}>{t("Email each supplier the list")}</Switch>
    </div>}
  </ControlledModalDialog>;
}
