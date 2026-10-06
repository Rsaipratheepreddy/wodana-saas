"use client";

import { useState } from "react";
import { Badge,
  Button, EditableField, EditableFieldList, FactRow, FillWithWoddy, FormDialog, FormSection, InlineNotice, InspectorSheet, MoreDetails, MultiSelectField, PhoneField, SegmentedControl, SelectField, TagsField, TextAreaField, TextInput, useDesignSystem, useFormDraft,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { joinPhone, phoneCountry, splitPhone } from "@/lib/phone";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { Approval, Deal, PaymentTerms, Supplier, SupplierState, TaxNumberRule } from "@/lib/purchasing/types";
import { SupplierControls } from "./supplier-controls";
import { useAiReady } from "@/lib/workspace/ai-settings";
import { fillWithWoddy, imageForWoddy } from "@/lib/woddy/form-fill";
import { APPROVAL_TONE, percentText, useSupplierLabels } from "./supplier-labels";
import styles from "./purchasing.module.css";

const TERMS: PaymentTerms[] = ["upfront", "split", "on_delivery", "credit", "statement"];
const DEALS: Deal[] = ["none", "discount", "commission", "on_request"];

/**
 * The workspace country's tax number check (PLM-111): spaces, dots, dashes and slashes between groups
 * don't count; a country without one fixed format takes any number.
 */
export function taxNumberProblem(value: string, rule: TaxNumberRule | undefined, saved = ""): { example: string } | null {
  const plain = (text: string) => text.replace(/[\s.\-/]+/g, "").toUpperCase();
  const number = plain(value);
  // A number saved before the check stays as it was until someone changes it.
  if (!number || !rule?.pattern || number === plain(saved)) return null;
  try { return new RegExp(rule.pattern).test(number) ? null : { example: rule.example ?? "" }; } catch { return null; }
}

type SheetProps = { api: PurchasingApi; state: SupplierState; supplier: Supplier | null; onState: (state: SupplierState) => void; onClose: () => void };

/** A supplier opened from the list edits in place; a new one is a form saved once. */
export function SupplierSheet(props: SheetProps) {
  return props.supplier ? <SupplierRecord {...props} supplier={props.supplier} /> : <NewSupplierSheet {...props} />;
}

/**
 * One supplier's record: each value edits in place and saves the supplier (the register replaces it whole)
 * with its version. Terms and the deal change together, in their own small forms, because each part needs
 * the other. Approval sits apart, for the people who approve suppliers.
 */
function SupplierRecord({ api, state, supplier, onState, onClose }: SheetProps & { supplier: Supplier }) {
  const t = useT();
  const labels = useSupplierLabels();
  const { locale } = useDesignSystem();
  const home = phoneCountry(null, locale) ?? "";
  const phone = splitPhone(supplier.phone ?? "", home);
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"approval" | "archive" | "terms" | "deal" | null>(null);
  const edit = state.canManage && supplier.status !== "archived";
  const run = async (work: () => Promise<SupplierState>, inDialog = false) => {
    setNotice("");
    try { onState(await work()); return true; } catch (cause) { if (inDialog) throw cause; setNotice(cause instanceof Error ? cause.message : t("Could not save.")); return false; }
  };
  /** The supplier as saved, with one change and its version (its currency is kept). A clash loads the latest. */
  const save = async (patch: Record<string, unknown>) => {
    const whole = { id: supplier.id, version: supplier.version, name: supplier.name, legalName: supplier.legalName ?? "", categories: supplier.categories,
      paymentTerms: supplier.paymentTerms, advancePercent: percentText(supplier.advancePercent), creditDays: supplier.creditDays, termsNote: supplier.termsNote,
      retentionPercent: Number(supplier.retentionPercent) ? percentText(supplier.retentionPercent) : "", deal: supplier.deal, dealPercent: percentText(supplier.dealPercent), dealNote: supplier.dealNote,
      contactName: supplier.contactName ?? "", phone: supplier.phone ?? "", email: supplier.email ?? "", locality: supplier.locality ?? "", entityIds: supplier.entityIds,
      taxRegistrationNumber: supplier.taxRegistrationNumber ?? "", notes: supplier.notes, ...(supplier.currency ? { currency: supplier.currency } : {}) };
    try { onState(await api.saveSupplier({ ...whole, ...patch })); setNotice(""); }
    catch (cause) {
      if (cause instanceof Error && "status" in cause && cause.status === 409) void api.suppliers().then(onState).catch(() => undefined);
      throw cause;
    }
  };
  const quietly = (patch: Record<string, unknown>) => { void save(patch).catch((cause) => setNotice(cause instanceof Error ? cause.message : t("Could not save."))); };
  const reload = () => void api.suppliers().then(onState).catch(() => undefined);
  const email = (value: string) => value && !/^\S+@\S+\.\S+$/.test(value) ? t("Enter an email like name@company.com.") : null;
  const taxNumber = (value: string) => { const problem = taxNumberProblem(value, state.taxNumber, supplier.taxRegistrationNumber ?? ""); return problem ? t("Use the format {example}.", problem) : null; };

  return <InspectorSheet isOpen size="md" title={supplier.name} hideTitle={edit} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={edit ? <div className="wd-form-footer"><div className="wd-form-footer-start"><Button variant="quiet" onPress={() => setDialog("archive")}>{t("Archive")}</Button></div></div>
      : supplier.status === "archived" && state.canManage ? <div className="wd-dialog-actions">
        <Button onPress={() => void run(() => api.archiveSupplier(supplier.id, { version: supplier.version, restore: true }))}>{t("Use again")}</Button>
      </div> : null}>
    <div className={styles.sheet}>
      {edit ? <EditableField heading="h2" isRequired label={t("Name")} maxLength={240} onReload={reload} onSave={(name) => save({ name })} value={supplier.name} /> : null}
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {supplier.status === "archived" ? <InlineNotice tone="info" message={t("Archived: {reason}", { reason: supplier.archivedReason ?? "" })} /> : null}
      <div className={styles.approvalRow}>
        <Badge tone={APPROVAL_TONE[supplier.approval]}>{labels.approval[supplier.approval]}</Badge>
        <span className={styles.muted}>{[supplier.preferredFor.length ? t("Preferred for {categories}", { categories: supplier.preferredFor.join(", ") }) : "",
          supplier.approvalByName ? t("by {name}", { name: supplier.approvalByName }) : "", supplier.approvalNote].filter(Boolean).join(" · ")}</span>
        {state.canApprove && supplier.status !== "archived" ? <Button size="compact" onPress={() => setDialog("approval")}>{t("Change approval")}</Button> : null}
      </div>

      <TagsField label={t("Categories")} isReadOnly={!edit} values={supplier.categories} onChange={(categories) => quietly({ categories })} suggestions={state.categories} placeholder={t("e.g. Marble, Joinery, Paint")} />
      {state.entities.length > 1 ? <MultiSelectField isDisabled={!edit} label={t("Companies that buy from it")} selectedKeys={new Set(supplier.entityIds)}
        onSelectionChange={(keys) => quietly({ entityIds: [...keys].map(String) })} items={state.entities.map((entity) => ({ id: entity.id, label: entity.name }))} /> : null}

      <EditableFieldList>
        <FactRow action={edit ? <Button size="compact" variant="quiet" onPress={() => setDialog("terms")}>{t("Change")}</Button> : null} label={t("Payment terms")}>
          <span>{[labels.termsText(supplier), supplier.termsNote].filter(Boolean).join(" · ")}</span></FactRow>
        <FactRow action={edit ? <Button size="compact" variant="quiet" onPress={() => setDialog("deal")}>{t("Change")}</Button> : null} label={t("Discount or commission")}>
          <span>{[labels.dealText(supplier) || labels.deal.none, supplier.dealNote].filter(Boolean).join(" · ")}</span></FactRow>
        <EditableField canEdit={edit} label={t("Contact")} maxLength={180} onReload={reload} onSave={(contactName) => save({ contactName })} placeholder={t("Not set")} value={supplier.contactName ?? ""} />
        <EditableField canEdit={edit} countryCode={phone.country} display={supplier.phone || undefined} kind="phone" label={t("Phone")} onReload={reload}
          onSave={(national, { countryCode }) => save({ phone: joinPhone(countryCode, national) })} placeholder={t("Not set")} value={phone.national} />
        <EditableField canEdit={edit} kind="email" label={t("Email")} maxLength={320} onReload={reload} onSave={(value) => save({ email: value })} placeholder={t("Not set")} validate={email} value={supplier.email ?? ""} />
        <EditableField canEdit={edit} label={t("Location")} maxLength={160} onReload={reload} onSave={(locality) => save({ locality })} placeholder={t("Not set")} value={supplier.locality ?? ""} />
        <EditableField canEdit={edit} label={t("Legal name")} maxLength={240} onReload={reload} onSave={(legalName) => save({ legalName })} placeholder={t("Not set")} value={supplier.legalName ?? ""} />
        <EditableField canEdit={edit} label={state.taxNumber?.label ?? t("Tax number")} maxLength={120} onReload={reload} onSave={(taxRegistrationNumber) => save({ taxRegistrationNumber })} placeholder={t("Not set")}
          validate={taxNumber} value={supplier.taxRegistrationNumber ?? ""} />
        <EditableField canEdit={edit} kind="multiline" label={t("Notes")} maxLength={10000} onReload={reload} onSave={(notes) => save({ notes })} placeholder={t("Not set")} value={supplier.notes} />
        {/* Columns of the firm's own supplier list, kept as they were written there. */}
        {(supplier.attributes ?? []).map((attribute) => <FactRow key={attribute.name} label={attribute.name}><span dir="auto">{attribute.value}</span></FactRow>)}
      </EditableFieldList>
      <section className={styles.part} aria-label={t("Documents, bank details and performance")}>
        <SupplierControls api={api} supplierId={supplier.id} onChanged={reload} />
      </section>
    </div>
    {dialog === "terms" ? <TermsDialog supplier={supplier} onClose={() => setDialog(null)} onSave={async (input) => { await save(input); setDialog(null); }} onReload={reload} /> : null}
    {dialog === "deal" ? <DealDialog supplier={supplier} onClose={() => setDialog(null)} onSave={async (input) => { await save(input); setDialog(null); }} onReload={reload} /> : null}
    {dialog === "approval" ? <ApprovalDialog supplier={supplier} onClose={() => setDialog(null)}
      onSave={async (input) => { await run(() => api.approveSupplier(supplier.id, { version: supplier.version, ...input }), true); setDialog(null); }} /> : null}
    {dialog === "archive" ? <ArchiveDialog onClose={() => setDialog(null)}
      onSave={async (reason) => { await run(() => api.archiveSupplier(supplier.id, { version: supplier.version, reason }), true); setDialog(null); onClose(); }} /> : null}
  </InspectorSheet>;
}

/** Payment terms with what each needs (the advance, the days), the terms note and the retention: saved together. */
function TermsDialog({ supplier, onClose, onSave, onReload }: { supplier: Supplier; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void>; onReload: () => void }) {
  const t = useT();
  const labels = useSupplierLabels();
  const initial = { paymentTerms: supplier.paymentTerms, advancePercent: percentText(supplier.advancePercent), creditDays: supplier.creditDays ? String(supplier.creditDays) : "", termsNote: supplier.termsNote,
    retentionPercent: Number(supplier.retentionPercent) ? percentText(supplier.retentionPercent) : "" };
  const [form, setForm] = useState(initial);
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  return <FormDialog conflict={{ onReload: () => { onReload(); onClose(); } }} isDirty={JSON.stringify(form) !== JSON.stringify(initial)} onClose={onClose}
    onSubmit={() => onSave({ ...form, creditDays: form.creditDays ? Number(form.creditDays) : null })} submitLabel={t("Save")} title={t("Payment terms")}>
    <SelectField label={t("Payment terms")} isRequired selectedKey={form.paymentTerms} onSelectionChange={(key) => set("paymentTerms")(key as PaymentTerms)} items={TERMS.map((item) => ({ id: item, label: labels.terms[item] }))} />
    {form.paymentTerms === "split" ? <TextInput label={t("Advance")} isRequired inputMode="decimal" suffix="%" value={form.advancePercent} onChange={(value) => set("advancePercent")(value.replace(/[^\d.]/g, ""))}
      validate={(value) => value && Number(value) > 0 && Number(value) < 100 ? null : t("Between 1 and 99%.")} /> : null}
    {form.paymentTerms === "credit" ? <TextInput label={t("Days")} isRequired inputMode="numeric" value={form.creditDays} onChange={(value) => set("creditDays")(value.replace(/\D/g, "").slice(0, 3))}
      validate={(value) => Number(value) >= 1 && Number(value) <= 365 ? null : t("Between 1 and 365 days.")} /> : null}
    <TextInput label={t("Terms note")} maxLength={500} value={form.termsNote} onChange={set("termsNote")} />
    <TextInput label={t("Retention")} inputMode="decimal" suffix="%" value={form.retentionPercent}
      onChange={(value) => set("retentionPercent")(value.replace(/[^\d.]/g, ""))} validate={(value) => !value || Number(value) < 100 ? null : t("Less than 100%.")} />
  </FormDialog>;
}

/** The deal (discount, commission, on request) with its percent and note: saved together. */
function DealDialog({ supplier, onClose, onSave, onReload }: { supplier: Supplier; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void>; onReload: () => void }) {
  const t = useT();
  const labels = useSupplierLabels();
  const initial = { deal: supplier.deal, dealPercent: percentText(supplier.dealPercent), dealNote: supplier.dealNote };
  const [form, setForm] = useState(initial);
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const needsPercent = form.deal === "discount" || form.deal === "commission";
  return <FormDialog conflict={{ onReload: () => { onReload(); onClose(); } }} isDirty={JSON.stringify(form) !== JSON.stringify(initial)} onClose={onClose}
    onSubmit={() => onSave({ ...form, dealPercent: needsPercent ? form.dealPercent : "" })} submitLabel={t("Save")} title={t("Discount or commission")}>
    <SelectField label={t("Discount or commission")} isRequired selectedKey={form.deal} onSelectionChange={(key) => set("deal")(key as Deal)} items={DEALS.map((item) => ({ id: item, label: labels.deal[item] }))} />
    {needsPercent ? <TextInput label={t("Percent")} isRequired inputMode="decimal" suffix="%" value={form.dealPercent} onChange={(value) => set("dealPercent")(value.replace(/[^\d.]/g, ""))}
      validate={(value) => value && Number(value) > 0 && Number(value) < 100 ? null : t("Between 1 and 99%.")} /> : null}
    {form.deal !== "none" ? <TextInput label={t("Deal note")} maxLength={500} value={form.dealNote} onChange={set("dealNote")} /> : null}
  </FormDialog>;
}

/**
 * A new supplier: its name, what it supplies, who to call and how it's paid first; the rest under More
 * details. Saved together; Woddy can read a pasted message or card into it. A draft survives closing.
 */
function NewSupplierSheet({ api, state, onState, onClose }: SheetProps) {
  const t = useT();
  const labels = useSupplierLabels();
  const { locale, regionLocale } = useDesignSystem();
  const home = phoneCountry(null, regionLocale) ?? "";
  const [id] = useState(() => crypto.randomUUID());
  const initial = {
    name: "", legalName: "", categories: [] as string[], paymentTerms: "upfront" as PaymentTerms, advancePercent: "", creditDays: "", termsNote: "", retentionPercent: "",
    deal: "none" as Deal, dealPercent: "", dealNote: "", contactName: "", phoneCountry: home, phone: "", email: "", locality: "",
    entityIds: state.entities.length === 1 ? [state.entities[0].id] : [] as string[], taxRegistrationNumber: "", notes: "",
  };
  const [form, setForm] = useState(initial);
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const draft = useFormDraft(`${api.workspaceId}/supplier/new`, form, { isDirty: dirty, restore: setForm });
  const aiReady = useAiReady(api.workspaceId);
  const save = async () => {
    onState(await api.saveSupplier({ id, version: 0, name: form.name, legalName: form.legalName, categories: form.categories,
      paymentTerms: form.paymentTerms, advancePercent: form.advancePercent, creditDays: form.creditDays ? Number(form.creditDays) : null, termsNote: form.termsNote, retentionPercent: form.retentionPercent,
      deal: form.deal, dealPercent: form.dealPercent, dealNote: form.dealNote, contactName: form.contactName, phone: joinPhone(form.phoneCountry, form.phone), email: form.email,
      locality: form.locality, entityIds: form.entityIds, taxRegistrationNumber: form.taxRegistrationNumber, notes: form.notes }));
    onClose();
  };
  const fill = (found: Record<string, string>) => setForm((current) => ({ ...current,
    ...(found.name ? { name: found.name } : {}), ...(found.legalName ? { legalName: found.legalName } : {}), ...(found.contactName ? { contactName: found.contactName } : {}),
    ...(found.phone ? { phone: found.phone } : {}), ...(found.email ? { email: found.email } : {}), ...(found.locality ? { locality: found.locality } : {}),
    ...(found.taxRegistrationNumber ? { taxRegistrationNumber: found.taxRegistrationNumber } : {}), ...(found.notes ? { notes: found.notes } : {}),
    ...(found.categories ? { categories: [...new Set([...current.categories, ...found.categories.split(",").map((item) => item.trim()).filter(Boolean)])] } : {}) }));
  const percent = (value: string) => value.replace(/[^\d.]/g, "");
  const inRange = (value: string) => value && Number(value) > 0 && Number(value) < 100 ? null : t("Between 1 and 99%.");
  const moreFilled = [form.email, form.locality, form.legalName, form.taxRegistrationNumber, form.notes, form.termsNote, form.retentionPercent, form.deal !== "none" ? "deal" : ""].filter(Boolean).length;
  return <FormDialog draft={draft} isDirty={dirty} onClose={onClose} onSubmit={save} size="lg" submitLabel={t("Add supplier")} title={t("New supplier")}
    lead={aiReady ? <FillWithWoddy fields={[{ key: "name", label: t("Name") }, { key: "categories", label: t("Categories") }, { key: "contactName", label: t("Contact") }, { key: "phone", label: t("Phone") },
      { key: "email", label: t("Email") }, { key: "locality", label: t("Location") }, { key: "legalName", label: t("Legal name") }, { key: "taxRegistrationNumber", label: t("Tax number") }, { key: "notes", label: t("Notes") }]}
      onApply={fill} onExtract={async ({ text, image }) => fillWithWoddy(api.workspaceId, "supplier", { ...(text ? { text } : {}), ...(image ? { image: await imageForWoddy(image) } : {}) })} /> : null}>
    <FormSection title={t("Supplier")}>
      <TextInput label={t("Name")} isRequired maxLength={240} value={form.name} onChange={set("name")} />
      <TagsField label={t("Categories")} values={form.categories} onChange={set("categories")} suggestions={state.categories} placeholder={t("e.g. Marble, Joinery, Paint")} />
      <TextInput label={t("Contact")} maxLength={180} value={form.contactName} onChange={set("contactName")} />
      <PhoneField label={t("Phone")} kind="any" locale={locale} value={form.phone} onChange={set("phone")} countryCode={form.phoneCountry} onCountryChange={set("phoneCountry")} />
    </FormSection>
    <FormSection title={t("Payment")}>
      <SelectField label={t("Payment terms")} isRequired selectedKey={form.paymentTerms} onSelectionChange={(key) => set("paymentTerms")(key as PaymentTerms)}
        items={TERMS.map((item) => ({ id: item, label: labels.terms[item] }))} />
      {form.paymentTerms === "split" ? <TextInput label={t("Advance")} isRequired inputMode="decimal" suffix="%" value={form.advancePercent} onChange={(value) => set("advancePercent")(percent(value))} validate={inRange} />
        : form.paymentTerms === "credit" ? <TextInput label={t("Days")} isRequired inputMode="numeric" value={form.creditDays} onChange={(value) => set("creditDays")(value.replace(/\D/g, "").slice(0, 3))}
          validate={(value) => Number(value) >= 1 && Number(value) <= 365 ? null : t("Between 1 and 365 days.")} /> : null}
    </FormSection>
    <MoreDetails filled={moreFilled}>
      <TextInput label={t("Email")} inputType="email" maxLength={320} value={form.email} onChange={set("email")} />
      <TextInput label={t("Location")} maxLength={160} value={form.locality} onChange={set("locality")} />
      <TextInput label={t("Legal name")} maxLength={240} value={form.legalName} onChange={set("legalName")} />
      <TextInput label={state.taxNumber?.label ?? t("Tax number")} maxLength={120} value={form.taxRegistrationNumber} onChange={set("taxRegistrationNumber")}
        validate={(value) => { const problem = taxNumberProblem(value, state.taxNumber); return problem ? t("Use the format {example}.", problem) : null; }} />
      {state.entities.length > 1 ? <MultiSelectField label={t("Companies that buy from it")} selectedKeys={new Set(form.entityIds)}
        onSelectionChange={(keys) => set("entityIds")([...keys].map(String))} items={state.entities.map((entity) => ({ id: entity.id, label: entity.name }))} /> : null}
      <TextInput label={t("Terms note")} maxLength={500} value={form.termsNote} onChange={set("termsNote")} />
      <TextInput label={t("Retention")} inputMode="decimal" suffix="%" value={form.retentionPercent}
        onChange={(value) => set("retentionPercent")(percent(value))} validate={(value) => !value || Number(value) < 100 ? null : t("Less than 100%.")} />
      <SelectField label={t("Discount or commission")} selectedKey={form.deal} onSelectionChange={(key) => set("deal")(key as Deal)} items={DEALS.map((item) => ({ id: item, label: labels.deal[item] }))} />
      {form.deal === "discount" || form.deal === "commission" ? <TextInput label={t("Percent")} isRequired inputMode="decimal" suffix="%" value={form.dealPercent}
        onChange={(value) => set("dealPercent")(percent(value))} validate={inRange} /> : null}
      {form.deal !== "none" ? <TextInput label={t("Deal note")} maxLength={500} value={form.dealNote} onChange={set("dealNote")} /> : null}
      <TextAreaField label={t("Notes")} maxLength={10000} value={form.notes} onChange={set("notes")} />
    </MoreDetails>
  </FormDialog>;
}

/** Approve (and name what it's preferred for), put on hold or refuse — with the reason for the last two. */
function ApprovalDialog({ supplier, onClose, onSave }: { supplier: Supplier; onClose: () => void; onSave: (input: { approval: Approval; preferredFor: string[]; note: string }) => Promise<void> }) {
  const t = useT();
  const labels = useSupplierLabels();
  const [approval, setApproval] = useState<Approval>(supplier.approval === "pending" ? "approved" : supplier.approval);
  const [preferred, setPreferred] = useState<Set<string>>(new Set(supplier.preferredFor));
  const [note, setNote] = useState(supplier.approvalNote);
  const needsNote = approval === "on_hold" || approval === "not_approved";
  return <FormDialog size="md" title={t("Approval")} onClose={onClose} isDirty={note !== supplier.approvalNote} isSubmitDisabled={needsNote && !note.trim()} submitLabel={t("Save")}
    onSubmit={() => onSave({ approval, preferredFor: approval === "approved" ? [...preferred] : [], note: note.trim() })}>
      <SegmentedControl label={t("Approval")} value={approval} onChange={(value) => setApproval(value as Approval)}
        options={(["approved", "on_hold", "not_approved", "pending"] as const).map((id) => ({ id, label: labels.approval[id] }))} />
      {approval === "approved" && supplier.categories.length ? <MultiSelectField label={t("Preferred supplier for")} selectedKeys={preferred}
        onSelectionChange={(keys) => setPreferred(new Set([...keys].map(String)))} items={supplier.categories.map((item) => ({ id: item, label: item }))} /> : null}
      <TextAreaField label={needsNote ? t("Why") : t("Note")} isRequired={needsNote} value={note} onChange={setNote} />
  </FormDialog>;
}

function ArchiveDialog({ onClose, onSave }: { onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  return <FormDialog size="md" title={t("Archive")} onClose={onClose} cancelLabel={t("Cancel")} isDirty={Boolean(reason.trim())} isSubmitDisabled={!reason.trim()}
    submitLabel={t("Archive")} submitVariant={"danger"} onSubmit={() => onSave(reason.trim())}>
    <TextAreaField label={t("Why you no longer use it")} isRequired value={reason} onChange={setReason} />
  </FormDialog>;
}
