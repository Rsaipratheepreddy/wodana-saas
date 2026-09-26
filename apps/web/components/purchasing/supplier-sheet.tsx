"use client";

import { useState } from "react";
import {
  Button, ControlledModalDialog, InlineNotice, InspectorSheet, MultiSelectField, PhoneField, SegmentedControl, SelectField, TagsField, TextAreaField, TextInput, useDesignSystem,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { joinPhone, phoneCountry, splitPhone } from "@/lib/phone";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { Approval, Deal, PaymentTerms, Supplier, SupplierState } from "@/lib/purchasing/types";
import { percentText, useSupplierLabels } from "./supplier-labels";
import styles from "./purchasing.module.css";

const TERMS: PaymentTerms[] = ["upfront", "split", "on_delivery", "credit", "statement"];
const DEALS: Deal[] = ["none", "discount", "commission", "on_request"];

/**
 * One supplier: what it supplies, its payment terms and deal, its contact, and the companies that buy
 * from it — saved together. Approval sits apart, for the people who approve suppliers.
 */
export function SupplierSheet({ api, state, supplier, onState, onClose }: {
  api: PurchasingApi; state: SupplierState; supplier: Supplier | null; onState: (state: SupplierState) => void; onClose: () => void;
}) {
  const t = useT();
  const labels = useSupplierLabels();
  const { locale } = useDesignSystem();
  const home = phoneCountry(null, locale) ?? "";
  const phone = splitPhone(supplier?.phone ?? "", home);
  const [id] = useState(() => supplier?.id ?? crypto.randomUUID());
  const [form, setForm] = useState({
    name: supplier?.name ?? "", legalName: supplier?.legalName ?? "", categories: supplier?.categories ?? [], paymentTerms: supplier?.paymentTerms ?? "upfront" as PaymentTerms,
    advancePercent: percentText(supplier?.advancePercent ?? null), creditDays: supplier?.creditDays ? String(supplier.creditDays) : "", termsNote: supplier?.termsNote ?? "",
    deal: supplier?.deal ?? "none" as Deal, dealPercent: percentText(supplier?.dealPercent ?? null), dealNote: supplier?.dealNote ?? "",
    contactName: supplier?.contactName ?? "", phoneCountry: phone.country, phone: phone.national, email: supplier?.email ?? "", locality: supplier?.locality ?? "",
    entityIds: new Set(supplier?.entityIds ?? (state.entities.length === 1 ? [state.entities[0].id] : [])), taxRegistrationNumber: supplier?.taxRegistrationNumber ?? "", notes: supplier?.notes ?? "",
  });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"approval" | "archive" | null>(null);
  const edit = state.canManage && supplier?.status !== "archived";
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const run = async (work: () => Promise<SupplierState>) => {
    setNotice("");
    try { onState(await work()); return true; } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); return false; }
  };
  const valid = form.name.trim() && (form.paymentTerms !== "split" || Number(form.advancePercent) > 0) && (form.paymentTerms !== "credit" || Number(form.creditDays) > 0)
    && (!["discount", "commission"].includes(form.deal) || Number(form.dealPercent) > 0);
  const save = async () => {
    setBusy(true);
    const done = await run(() => api.saveSupplier({ id, version: supplier?.version ?? 0, name: form.name, legalName: form.legalName, categories: form.categories,
      paymentTerms: form.paymentTerms, advancePercent: form.advancePercent, creditDays: form.creditDays ? Number(form.creditDays) : null, termsNote: form.termsNote,
      deal: form.deal, dealPercent: form.dealPercent, dealNote: form.dealNote, contactName: form.contactName, phone: joinPhone(form.phoneCountry, form.phone), email: form.email,
      locality: form.locality, entityIds: [...form.entityIds], taxRegistrationNumber: form.taxRegistrationNumber, notes: form.notes }));
    setBusy(false);
    if (done) onClose();
  };

  return <InspectorSheet isOpen size="md" title={supplier ? supplier.name : t("New supplier")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={edit ? <div className="wd-dialog-actions">
      {supplier ? <Button variant="quiet" onPress={() => setDialog("archive")}>{t("Archive")}</Button> : null}
      <span className={styles.spacer} />
      <Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={() => void save()}>{t("Save")}</Button>
    </div> : supplier?.status === "archived" && state.canManage ? <div className="wd-dialog-actions">
      <span className={styles.spacer} />
      <Button onPress={() => void run(() => api.archiveSupplier(supplier.id, { version: supplier.version, restore: true }))}>{t("Use again")}</Button>
    </div> : null}>
    <div className={styles.sheet}>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {supplier?.status === "archived" ? <InlineNotice tone="info" message={t("Archived: {reason}", { reason: supplier.archivedReason ?? "" })} /> : null}
      {supplier ? <div className={styles.approvalRow}>
        <span className={styles.approval} data-approval={supplier.approval}>{labels.approval[supplier.approval]}</span>
        <span className={styles.muted}>{[supplier.preferredFor.length ? t("Preferred for {categories}", { categories: supplier.preferredFor.join(", ") }) : "",
          supplier.approvalByName ? t("by {name}", { name: supplier.approvalByName }) : "", supplier.approvalNote].filter(Boolean).join(" · ")}</span>
        {state.canApprove && supplier.status !== "archived" ? <Button size="compact" onPress={() => setDialog("approval")}>{t("Change approval")}</Button> : null}
      </div> : null}

      <TextInput label={t("Name")} isRequired isReadOnly={!edit} value={form.name} onChange={set("name")} />
      <TagsField label={t("Categories")} isReadOnly={!edit} values={form.categories} onChange={set("categories")} suggestions={state.categories} placeholder={t("e.g. Marble, Joinery, Paint")} />
      {state.entities.length > 1 ? <MultiSelectField label={t("Companies that buy from it")} selectedKeys={form.entityIds}
        onSelectionChange={(keys) => set("entityIds")(new Set([...keys].map(String)))} items={state.entities.map((entity) => ({ id: entity.id, label: entity.name }))} /> : null}

      <section className={styles.part} aria-label={t("Payment")}>
        <div className={styles.pair}>
          <SelectField label={t("Payment terms")} isDisabled={!edit} selectedKey={form.paymentTerms} onSelectionChange={(key) => set("paymentTerms")(key as PaymentTerms)}
            items={TERMS.map((item) => ({ id: item, label: labels.terms[item] }))} />
          {form.paymentTerms === "split" ? <TextInput label={t("Advance")} isRequired isReadOnly={!edit} inputMode="decimal" suffix="%" value={form.advancePercent} onChange={(value) => set("advancePercent")(value.replace(/[^\d.]/g, ""))} />
            : form.paymentTerms === "credit" ? <TextInput label={t("Days")} isRequired isReadOnly={!edit} inputMode="numeric" value={form.creditDays} onChange={(value) => set("creditDays")(value.replace(/\D/g, "").slice(0, 3))} />
            : <span />}
        </div>
        <TextInput label={t("Terms note")} isReadOnly={!edit} value={form.termsNote} onChange={set("termsNote")} />
        <div className={styles.pair}>
          <SelectField label={t("Discount or commission")} isDisabled={!edit} selectedKey={form.deal} onSelectionChange={(key) => set("deal")(key as Deal)}
            items={DEALS.map((item) => ({ id: item, label: labels.deal[item] }))} />
          {form.deal === "discount" || form.deal === "commission" ? <TextInput label={t("Percent")} isRequired isReadOnly={!edit} inputMode="decimal" suffix="%" value={form.dealPercent}
            onChange={(value) => set("dealPercent")(value.replace(/[^\d.]/g, ""))} /> : <span />}
        </div>
        {form.deal !== "none" ? <TextInput label={t("Deal note")} isReadOnly={!edit} value={form.dealNote} onChange={set("dealNote")} /> : null}
      </section>

      <section className={styles.part} aria-label={t("Contact")}>
        <div className={styles.pair}>
          <TextInput label={t("Contact")} isReadOnly={!edit} value={form.contactName} onChange={set("contactName")} />
          <PhoneField label={t("Phone")} kind="any" locale={locale} value={form.phone} onChange={set("phone")} countryCode={form.phoneCountry} onCountryChange={set("phoneCountry")} />
        </div>
        <div className={styles.pair}>
          <TextInput label={t("Email")} inputType="email" isReadOnly={!edit} value={form.email} onChange={set("email")} />
          <TextInput label={t("Location")} isReadOnly={!edit} value={form.locality} onChange={set("locality")} />
        </div>
        <div className={styles.pair}>
          <TextInput label={t("Legal name")} isReadOnly={!edit} value={form.legalName} onChange={set("legalName")} />
          <TextInput label={t("Tax number")} isReadOnly={!edit} value={form.taxRegistrationNumber} onChange={set("taxRegistrationNumber")} />
        </div>
        <TextAreaField label={t("Notes")} isReadOnly={!edit} value={form.notes} onChange={set("notes")} />
      </section>
    </div>
    {dialog === "approval" && supplier ? <ApprovalDialog supplier={supplier} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run(() => api.approveSupplier(supplier.id, { version: supplier.version, ...input }))) setDialog(null); }} /> : null}
    {dialog === "archive" && supplier ? <ArchiveDialog onClose={() => setDialog(null)}
      onSave={async (reason) => { if (await run(() => api.archiveSupplier(supplier.id, { version: supplier.version, reason }))) { setDialog(null); onClose(); } }} /> : null}
  </InspectorSheet>;
}

/** Approve (and name what it's preferred for), put on hold or refuse — with the reason for the last two. */
function ApprovalDialog({ supplier, onClose, onSave }: { supplier: Supplier; onClose: () => void; onSave: (input: { approval: Approval; preferredFor: string[]; note: string }) => Promise<void> }) {
  const t = useT();
  const labels = useSupplierLabels();
  const [approval, setApproval] = useState<Approval>(supplier.approval === "pending" ? "approved" : supplier.approval);
  const [preferred, setPreferred] = useState<Set<string>>(new Set(supplier.preferredFor));
  const [note, setNote] = useState(supplier.approvalNote);
  const [busy, setBusy] = useState(false);
  const needsNote = approval === "on_hold" || approval === "not_approved";
  return <ControlledModalDialog isOpen size="md" title={t("Approval")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={needsNote && !note.trim()} onPress={async () => {
        setBusy(true); await onSave({ approval, preferredFor: approval === "approved" ? [...preferred] : [], note: note.trim() }); setBusy(false);
      }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <SegmentedControl label={t("Approval")} value={approval} onChange={(value) => setApproval(value as Approval)}
        options={(["approved", "on_hold", "not_approved", "pending"] as const).map((id) => ({ id, label: labels.approval[id] }))} />
      {approval === "approved" && supplier.categories.length ? <MultiSelectField label={t("Preferred supplier for")} selectedKeys={preferred}
        onSelectionChange={(keys) => setPreferred(new Set([...keys].map(String)))} items={supplier.categories.map((item) => ({ id: item, label: item }))} /> : null}
      <TextAreaField label={needsNote ? t("Why") : t("Note")} isRequired={needsNote} value={note} onChange={setNote} />
    </div>
  </ControlledModalDialog>;
}

function ArchiveDialog({ onClose, onSave }: { onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Archive")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!reason.trim()} onPress={async () => { setBusy(true); await onSave(reason.trim()); setBusy(false); }}>{t("Archive")}</Button></div>}>
    <TextAreaField label={t("Why you no longer use it")} isRequired value={reason} onChange={setReason} />
  </ControlledModalDialog>;
}
