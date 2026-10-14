"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { Button, ConfirmationDialog, DataGrid, EmptyState, IconButton, InlineNotice, InspectorSheet, PageTools, RadioSet, SearchInput, SelectField, Switch, TextInput, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { UNRESOLVED_ENQUIRY_TYPE_ID, type LeadOptions, type RequiredAt } from "@/lib/crm/lead-options";
import { crmRequest } from "@/lib/crm/client";
import type { SalesSettings } from "@/lib/crm/leads";
import { loadRequirements, REQUIRED_AT_CHOICES, saveRequirement, teamRoleLabel, type RequirementState } from "@/lib/crm/enquiry-requirements";
import {
  createCustomField, enquiryFields, FIELD_TYPE_LABELS, loadEnquiryFields, NEW_FIELD_TYPES, setFixedFieldShown, updateCustomField,
  type CustomEnquiryField, type EnquiryField, type EnquiryFieldsState, type EnquiryFieldType,
} from "@/lib/crm/enquiry-fields";
import { LeadOptionsEditor } from "./lead-options-editor";
import styles from "./enquiry-fields-settings.module.css";

type Draft = { label: string; type: EnquiryFieldType; options: string[] };

/** Always required to create an enquiry (the record can't exist without them). */
const ALWAYS_REQUIRED = new Set(["displayName", "mobile", "region", "serviceType", "source"]);
/** Fields a firm can require per enquiry type (PLM-096); team roles and its own fields join them. */
const REQUIRABLE = new Set(["email", "area", "address", "budgetRange", "customerType", "summary", "targetCompletion"]);
const requirable = (key: string) => REQUIRABLE.has(key) || key.startsWith("team:") || key.startsWith("cf:");
const INTERNAL_NOTES = "internalNotes";

/**
 * Settings → Fields: everything an enquiry captures. Fixed fields and the workspace's own fields in
 * one list; each can be shown or hidden (hiding keeps stored values). Choice fields open their options.
 */
export function EnquiryFieldsSettings({ workspaceId, leadOptions, regionLabel, onOptionsSaved }: { workspaceId: string; leadOptions?: LeadOptions; regionLabel: string; onOptionsSaved?: (options: LeadOptions) => void }) {
  const t = useT();
  const [state, setState] = useState<EnquiryFieldsState>();
  const [options, setOptions] = useState(leadOptions);
  const [failure, setFailure] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<EnquiryField | "new" | null>(null);
  const [reload, setReload] = useState(0);
  const [requirements, setRequirements] = useState<RequirementState>();
  const [requiring, setRequiring] = useState<EnquiryField | null>(null);
  const [sales, setSales] = useState<SalesSettings>();
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    loadEnquiryFields(workspaceId, controller.signal).then((result) => { setState(result); setFailure(""); }).catch((cause: Error) => { if (!controller.signal.aborted) setFailure(cause.message); });
    // PLM-096 and PLM-024: what each enquiry type requires, and who reads internal notes.
    loadRequirements(workspaceId, controller.signal).then(setRequirements).catch(() => undefined);
    crmRequest<SalesSettings>(workspaceId, "sales-settings", "GET", undefined, controller.signal).then(setSales).catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId, reload]);
  const types = (options?.enquiryTypes ?? []).filter((type) => type.id !== UNRESOLVED_ENQUIRY_TYPE_ID);
  // Team roles any enquiry type asks for (PLM-100); each is a row that can be required.
  const roles = [...new Set(Object.values(options?.teamRoles ?? {}).flat())];
  const typesFor = (field: EnquiryField) => field.key.startsWith("team:") ? types.filter((type) => options?.teamRoles?.[type.id]?.includes(field.key.slice(5))) : types;

  const fields = useMemo(() => {
    const listed = enquiryFields(state, regionLabel).map((field) => ({ ...field, label: field.kind === "fixed" && field.key !== "region" ? t(field.label as never) : field.label }));
    // The address, the team roles and the internal notes live on every enquiry too; they are settings here, never form questions.
    const extra: EnquiryField[] = [
      { key: "address", label: t("Address"), type: "text", kind: "fixed", locked: true, visible: true, version: 0 },
      ...roles.map((role): EnquiryField => ({ key: `team:${role}`, label: teamRoleLabel(role, t), type: "select", kind: "fixed", locked: true, visible: true, version: 0 })),
      { key: INTERNAL_NOTES, label: t("Internal notes"), type: "paragraph", kind: "fixed", locked: true, visible: true, version: 0 },
    ];
    const at = listed.findIndex((field) => field.key === "source");
    return [...listed.slice(0, at), ...extra, ...listed.slice(at)];
  }, [state, regionLabel, t, roles.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const query = search.trim().toLowerCase();
  const rows = fields.filter((field) => !query || field.label.toLowerCase().includes(query));

  const replaceCustom = (saved: CustomEnquiryField) => setState((current) => current && ({ ...current, custom: current.custom.map((item) => item.id === saved.id ? { ...item, ...saved } : item) }));
  const toggle = async (field: EnquiryField, visible: boolean) => {
    setBusy(field.key); setError("");
    try {
      if (field.custom) replaceCustom(await updateCustomField(workspaceId, field.custom, { visible }));
      else {
        const saved = await setFixedFieldShown(workspaceId, field.key, visible, field.version);
        setState((current) => current && ({ ...current, system: { ...current.system, [field.key]: { visible: saved.visible, version: saved.version } } }));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(null); }
  };

  const choices = (field: EnquiryField) => {
    if (field.custom) return field.type === "select" || field.type === "multi_select" ? field.custom.configuration.options?.length ?? 0 : null;
    if (!options || !field.lists) return null;
    if (field.key === "serviceType") return options.enquiryTypes.length;
    if (field.key === "budgetRange") return options.budgetRanges.length;
    if (field.key === "customerType") return options.customerTypes.length;
    if (field.key === "region") return options.emirates.length;
    if (field.key === "source") return options.sources.length;
    if (field.key === "area") return Object.values(options.areas).reduce((total, list) => total + list.length, 0);
    return null;
  };
  const editable = (field: EnquiryField) => Boolean(field.custom || field.lists);
  // How many enquiry types require the field, at any gate.
  const requiredCount = (field: EnquiryField) => typesFor(field).filter((type) => (requirements?.rules[type.id]?.[field.key] ?? "never") !== "never").length;
  const notesLabel = sales?.internalNotesVisibility === "sales" ? t("Everyone in Sales") : t("Enquiry team");

  const columns: DataGridColumn<EnquiryField>[] = [
    { id: "label", header: t("Field"), size: 280, accessorFn: (field) => field.label, meta: { primary: true }, cell: ({ row: { original: field } }) => <span className={styles.name}>
      <span>{field.label}</span>
      {field.locked ? <Lock aria-label={t("Always shown")} className={styles.lock} size={13} /> : null}
    </span> },
    { id: "type", header: t("Type"), size: 150, accessorFn: (field) => t(FIELD_TYPE_LABELS[field.type] as never) },
    { id: "choices", header: t("Choices"), size: 120, accessorFn: (field) => choices(field) ?? -1, cell: ({ row: { original: field } }) => { const count = choices(field); return count === null ? <span className={styles.muted}>—</span> : <button type="button" className={styles.open} onClick={() => setOpen(field)}>{count === 1 ? t("1 choice") : t("{count} choices", { count })}</button>; } },
    { id: "required", header: t("Required"), size: 150, enableSorting: false, cell: ({ row: { original: field } }) => ALWAYS_REQUIRED.has(field.key) ? <span className={styles.muted}>{t("Always")}</span>
      : !requirable(field.key) || !requirements ? <span className={styles.muted}>—</span>
      : <button type="button" className={styles.open} aria-label={t("Required: {name}", { name: field.label })} onClick={() => setRequiring(field)}>{(() => { const count = requiredCount(field); return count === 0 ? t("Not required") : count === 1 ? t("1 enquiry type") : t("{count} enquiry types", { count }); })()}</button> },
    { id: "visible", header: t("Shown"), size: 130, enableSorting: false, meta: { align: "center" }, cell: ({ row: { original: field } }) => field.key === INTERNAL_NOTES
      ? <button type="button" className={styles.open} aria-label={t("Who sees internal notes")} disabled={!sales} onClick={() => setNotesOpen(true)}>{notesLabel}</button>
      : field.key.startsWith("team:") || field.key === "address" ? <span className={styles.muted}>—</span>
      : <Switch aria-label={t("Show {name}", { name: field.label })} isDisabled={field.locked || busy === field.key} isSelected={field.visible} onChange={(value) => void toggle(field, value)} /> },
  ];

  return <section className={styles.page} aria-label={t("Enquiry fields")}>
    {/* In the Settings tabs' row: search and New field add no row of their own. */}
    <PageTools><div className={styles.toolbar}>
      <SearchInput label={t("Search fields")} placeholder={t("Search fields")} value={search} onChange={setSearch} />
      <span className={styles.spacer} />
      <Button size="compact" variant="primary" isDisabled={!state} onPress={() => setOpen("new")}><Plus aria-hidden="true" size={14} />{t("New field")}</Button>
    </div></PageTools>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {failure ? <EmptyState illustration="error" title={t("Fields could not load")} description={failure} action={<Button size="compact" onPress={() => setReload((value) => value + 1)}>{t("Retry")}</Button>} />
      : <DataGrid ariaLabel={t("Enquiry fields")} columns={columns} data={state ? rows : []} getRowId={(field) => field.key} selectable={false} rowNumbers={false} showToolbar={false} showFooter={false}
        isLoading={!state} onRowAction={(field) => { if (field.key === INTERNAL_NOTES) setNotesOpen(true); else if (editable(field)) setOpen(field); else if (requirable(field.key) && requirements) setRequiring(field); }} emptyTitle={t("No fields match")} emptyDescription={t("Try another name.")} />}

    {requiring && requirements ? <RequirementSheet workspaceId={workspaceId} field={requiring} types={typesFor(requiring)} state={requirements} onClose={() => setRequiring(null)}
      onSaved={(next) => { setRequirements(next); setOptions((current) => current && ({ ...current, requirements: next.rules })); if (options) onOptionsSaved?.({ ...options, requirements: next.rules }); setRequiring(null); }} /> : null}
    {notesOpen && sales ? <NotesVisibilitySheet workspaceId={workspaceId} settings={sales} onClose={() => setNotesOpen(false)} onSaved={(saved) => { setSales(saved); setNotesOpen(false); }} /> : null}

    {open === "new" ? <CustomFieldSheet workspaceId={workspaceId} onClose={() => setOpen(null)} position={(state?.custom.length ?? 0) + 1}
      onSaved={(saved) => { setState((current) => current && ({ ...current, custom: [...current.custom, saved] })); setOpen(null); }} /> : null}
    {open && open !== "new" && open.custom ? <CustomFieldSheet workspaceId={workspaceId} field={open.custom} onClose={() => setOpen(null)} position={open.custom.position}
      onSaved={(saved) => { replaceCustom(saved); setOpen(null); }} onArchived={(id) => { setState((current) => current && ({ ...current, custom: current.custom.filter((item) => item.id !== id) })); setOpen(null); }} /> : null}
    {open && open !== "new" && !open.custom && open.lists ? <InspectorSheet isOpen onOpenChange={(value) => { if (!value) setOpen(null); }} size="md" title={open.label}>
      <LeadOptionsEditor workspaceId={workspaceId} initialOptions={options} lists={open.lists} regionLabel={regionLabel} onSaved={(saved) => { setOptions(saved); onOptionsSaved?.(saved); }} />
    </InspectorSheet> : null}
  </section>;
}

export function CustomFieldSheet({ workspaceId, field, type, position, onClose, onSaved, onArchived }: { workspaceId: string; field?: CustomEnquiryField; /** A new field's starting type, picked in the form builder's palette. */ type?: EnquiryFieldType; position: number; onClose: () => void; onSaved: (field: CustomEnquiryField) => void; onArchived?: (id: string) => void }) {
  const t = useT();
  const initial: Draft = { label: field?.label ?? "", type: field ? (field.dataType === "text" && field.configuration.multiline ? "paragraph" : field.dataType) : type ?? "text", options: field?.configuration.options ?? (type === "select" || type === "multi_select" ? [""] : []) };
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [archiving, setArchiving] = useState(false);
  const choice = draft.type === "select" || draft.type === "multi_select";
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const save = async () => {
    const label = draft.label.trim();
    const options = [...new Set(draft.options.map((option) => option.trim()).filter(Boolean))];
    if (!label) { setError(t("Give the field a name.")); return; }
    if (choice && !options.length) { setError(t("Add at least one choice.")); return; }
    setBusy(true); setError("");
    try {
      onSaved(field
        ? await updateCustomField(workspaceId, field, { label, configuration: { ...field.configuration, ...(choice ? { options } : {}) } })
        : await createCustomField(workspaceId, { label, type: draft.type, options, position }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
  };
  const archive = async () => {
    if (!field) return;
    setBusy(true);
    try { await updateCustomField(workspaceId, field, { status: "archived" }); onArchived?.(field.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); setArchiving(false); }
  };

  return <InspectorSheet isOpen isDirty={dirty} onOpenChange={(value) => { if (!value && !busy) onClose(); }} size="sm" title={field ? field.label : t("New field")}
    footer={<>
      {field ? <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => setArchiving(true)}><Trash2 aria-hidden="true" size={14} />{t("Remove field")}</Button> : null}
      <span className={styles.spacer} />
      <Button size="compact" variant="primary" isLoading={busy} onPress={() => void save()}>{field ? t("Save") : t("Add field")}</Button>
    </>}>
    <div className={styles.sheet}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextInput autoFocus label={t("Name")} maxLength={160} value={draft.label} onChange={(label) => setDraft((current) => ({ ...current, label }))} />
      <SelectField label={t("Type")} isDisabled={Boolean(field)} items={NEW_FIELD_TYPES.map((type) => ({ id: type, label: t(FIELD_TYPE_LABELS[type] as never) }))} selectedKey={draft.type}
        onSelectionChange={(key) => setDraft((current) => ({ ...current, type: key as EnquiryFieldType, options: current.options.length || !["select", "multi_select"].includes(String(key)) ? current.options : [""] }))} />
      {choice ? <fieldset className={styles.choices}>
        <legend>{t("Choices")}</legend>
        {draft.options.map((option, index) => <div className={styles.choice} key={index}>
          <TextInput aria-label={t("Choice {number}", { number: index + 1 })} label={null} maxLength={160} value={option} onChange={(value) => setDraft((current) => ({ ...current, options: current.options.map((item, position) => position === index ? value : item) }))} />
          <IconButton aria-label={t("Remove choice {number}", { number: index + 1 })} onPress={() => setDraft((current) => ({ ...current, options: current.options.filter((_, position) => position !== index) }))}><Trash2 size={14} /></IconButton>
        </div>)}
        <Button size="compact" variant="quiet" isDisabled={draft.options.length >= 100} onPress={() => setDraft((current) => ({ ...current, options: [...current.options, ""] }))}><Plus aria-hidden="true" size={14} />{t("Add choice")}</Button>
      </fieldset> : null}
      {field?.valueCount ? <p className={styles.muted}>{field.valueCount === 1 ? t("1 enquiry has a value.") : t("{count} enquiries have a value.", { count: field.valueCount })}</p> : null}
    </div>
    <ConfirmationDialog isOpen={archiving} onOpenChange={(value) => { if (!value && !busy) setArchiving(false); }} title={t("Remove this field?")}
      body={t("It leaves the enquiry list and forms. Answers already given stay on each enquiry's history.")} confirmLabel={t("Remove field")} onConfirm={() => void archive()} />
  </InspectorSheet>;
}

/**
 * PLM-096: when one field is required, per enquiry type: not required, to create the enquiry, before converting it,
 * or before the intro is booked (each gate includes the earlier ones). Saved per type, version-checked.
 */
export function RequirementSheet({ workspaceId, field, types, state, onClose, onSaved }: {
  workspaceId: string; field: { key: string; label: string }; types: Array<{ id: string; label: string }>; state: RequirementState;
  onClose: () => void; onSaved: (state: RequirementState) => void;
}) {
  const t = useT();
  const current = (type: string) => state.rules[type]?.[field.key] ?? "never";
  const [choice, setChoice] = useState<Record<string, RequiredAt>>(() => Object.fromEntries(types.map((type) => [type.id, current(type.id)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = types.filter((type) => choice[type.id] !== current(type.id));
  // The workspace's own fields are saved after the enquiry exists, so they can be required from conversion on.
  const choices = REQUIRED_AT_CHOICES.filter((item) => !(field.key.startsWith("cf:") && item.id === "create"));
  const save = async () => {
    setBusy(true); setError("");
    try { onSaved(await saveRequirement(workspaceId, field.key, changed.map((type) => ({ enquiryType: type.id, requiredAt: choice[type.id], version: state.versions[type.id]?.[field.key] ?? 0 })))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
  };
  return <InspectorSheet isOpen isDirty={changed.length > 0} onOpenChange={(value) => { if (!value && !busy) onClose(); }} size="sm" title={field.label}
    footer={<><span className={styles.spacer} /><Button size="compact" variant="primary" isDisabled={!changed.length} isLoading={busy} onPress={() => void save()}>{t("Save")}</Button></>}>
    <div className={styles.sheet}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {types.length ? types.map((type) => <SelectField key={type.id} label={type.label} items={choices.map((item) => ({ id: item.id, label: t(item.label) }))} selectedKey={choice[type.id]}
        onSelectionChange={(key) => setChoice((previous) => ({ ...previous, [type.id]: String(key) as RequiredAt }))} />)
        : <p className={styles.muted}>{t("No enquiry type asks for this.")}</p>}
    </div>
  </InspectorSheet>;
}

/** PLM-024: who reads an enquiry's internal notes. Never the client or the portal. */
export function NotesVisibilitySheet({ workspaceId, settings, onClose, onSaved }: { workspaceId: string; settings: SalesSettings; onClose: () => void; onSaved: (settings: SalesSettings) => void }) {
  const t = useT();
  const initial = settings.internalNotesVisibility ?? "team";
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try { onSaved(await crmRequest<SalesSettings>(workspaceId, "sales-settings", "PATCH", { version: settings.version, internalNotesVisibility: value })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
  };
  return <InspectorSheet isOpen isDirty={value !== initial} onOpenChange={(open) => { if (!open && !busy) onClose(); }} size="sm" title={t("Internal notes")}
    footer={<><span className={styles.spacer} /><Button size="compact" variant="primary" isDisabled={value === initial} isLoading={busy} onPress={() => void save()}>{t("Save")}</Button></>}>
    <div className={styles.sheet}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <RadioSet label={t("Who sees internal notes")} value={value} onChange={(next) => setValue(next as "team" | "sales")} items={[
        { id: "team", label: t("Enquiry team"), description: t(tKey("The owner, the people tagged on it and whoever assigns enquiries")) },
        { id: "sales", label: t("Everyone in Sales"), description: t(tKey("Everyone who can open enquiries")) },
      ]} />
      <p className={styles.muted}>{t("Never shown to the client or on the portal.")}</p>
    </div>
  </InspectorSheet>;
}
