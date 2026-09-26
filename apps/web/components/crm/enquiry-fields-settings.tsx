"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { Button, ConfirmationDialog, DataGrid, EmptyState, IconButton, InlineNotice, InspectorSheet, SearchInput, SelectField, Switch, TextInput, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { LeadOptions } from "@/lib/crm/lead-options";
import {
  createCustomField, enquiryFields, FIELD_TYPE_LABELS, loadEnquiryFields, NEW_FIELD_TYPES, setFixedFieldShown, updateCustomField,
  type CustomEnquiryField, type EnquiryField, type EnquiryFieldsState, type EnquiryFieldType,
} from "@/lib/crm/enquiry-fields";
import { LeadOptionsEditor } from "./lead-options-editor";
import styles from "./enquiry-fields-settings.module.css";

type Draft = { label: string; type: EnquiryFieldType; options: string[] };

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

  useEffect(() => {
    const controller = new AbortController();
    loadEnquiryFields(workspaceId, controller.signal).then((result) => { setState(result); setFailure(""); }).catch((cause: Error) => { if (!controller.signal.aborted) setFailure(cause.message); });
    return () => controller.abort();
  }, [workspaceId, reload]);

  const fields = useMemo(() => enquiryFields(state, regionLabel).map((field) => ({ ...field, label: field.kind === "fixed" && field.key !== "region" ? t(field.label as never) : field.label })), [state, regionLabel, t]);
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

  const columns: DataGridColumn<EnquiryField>[] = [
    { id: "label", header: t("Field"), size: 280, accessorFn: (field) => field.label, meta: { primary: true }, cell: ({ row: { original: field } }) => <span className={styles.name}>
      <span>{field.label}</span>
      {field.locked ? <Lock aria-label={t("Always shown")} className={styles.lock} size={13} /> : null}
    </span> },
    { id: "type", header: t("Type"), size: 150, accessorFn: (field) => t(FIELD_TYPE_LABELS[field.type] as never) },
    { id: "choices", header: t("Choices"), size: 120, accessorFn: (field) => choices(field) ?? -1, cell: ({ row: { original: field } }) => { const count = choices(field); return count === null ? <span className={styles.muted}>—</span> : <button type="button" className={styles.open} onClick={() => setOpen(field)}>{count === 1 ? t("1 choice") : t("{count} choices", { count })}</button>; } },
    { id: "visible", header: t("Shown"), size: 110, enableSorting: false, meta: { align: "center" }, cell: ({ row: { original: field } }) => <Switch aria-label={t("Show {name}", { name: field.label })} isDisabled={field.locked || busy === field.key} isSelected={field.visible} onChange={(value) => void toggle(field, value)} /> },
  ];

  return <section className={styles.page} aria-label={t("Enquiry fields")}>
    <div className={styles.toolbar}>
      <SearchInput label={t("Search fields")} placeholder={t("Search fields")} value={search} onChange={setSearch} />
      <span className={styles.spacer} />
      <Button size="compact" variant="primary" isDisabled={!state} onPress={() => setOpen("new")}><Plus aria-hidden="true" size={14} />{t("New field")}</Button>
    </div>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {failure ? <EmptyState illustration="error" title={t("Fields could not load")} description={failure} action={<Button size="compact" onPress={() => setReload((value) => value + 1)}>{t("Retry")}</Button>} />
      : <DataGrid ariaLabel={t("Enquiry fields")} appearance="flush" columns={columns} data={state ? rows : []} getRowId={(field) => field.key} selectable={false} rowNumbers={false} showToolbar={false} showFooter={false}
        isLoading={!state} onRowAction={(field) => { if (editable(field)) setOpen(field); }} emptyTitle={t("No fields match")} emptyDescription={t("Try another name.")} />}

    {open === "new" ? <CustomFieldSheet workspaceId={workspaceId} onClose={() => setOpen(null)} position={(state?.custom.length ?? 0) + 1}
      onSaved={(saved) => { setState((current) => current && ({ ...current, custom: [...current.custom, saved] })); setOpen(null); }} /> : null}
    {open && open !== "new" && open.custom ? <CustomFieldSheet workspaceId={workspaceId} field={open.custom} onClose={() => setOpen(null)} position={open.custom.position}
      onSaved={(saved) => { replaceCustom(saved); setOpen(null); }} onArchived={(id) => { setState((current) => current && ({ ...current, custom: current.custom.filter((item) => item.id !== id) })); setOpen(null); }} /> : null}
    {open && open !== "new" && !open.custom && open.lists ? <InspectorSheet isOpen onOpenChange={(value) => { if (!value) setOpen(null); }} size="md" title={open.label}>
      <LeadOptionsEditor workspaceId={workspaceId} initialOptions={options} lists={open.lists} regionLabel={regionLabel} onSaved={(saved) => { setOptions(saved); onOptionsSaved?.(saved); }} />
    </InspectorSheet> : null}
  </section>;
}

export function CustomFieldSheet({ workspaceId, field, position, onClose, onSaved, onArchived }: { workspaceId: string; field?: CustomEnquiryField; position: number; onClose: () => void; onSaved: (field: CustomEnquiryField) => void; onArchived?: (id: string) => void }) {
  const t = useT();
  const initial: Draft = { label: field?.label ?? "", type: field ? (field.dataType === "text" && field.configuration.multiline ? "paragraph" : field.dataType) : "text", options: field?.configuration.options ?? [] };
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
