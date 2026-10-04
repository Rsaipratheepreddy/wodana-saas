"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { History, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, Callout, ConfirmationDialog, IconButton, InspectorSheet, SelectField, TextInput, formatDate, useDesignSystem } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import type { LeadOption, LeadOptions } from "@/lib/crm/lead-options";
import type { WorkspaceConfigurationRevision } from "@/lib/workspace/company-profile";
import styles from "./lead-forms.module.css";

type Taxonomy = { id: string; code: string; version: number; status: string; options?: Array<{ id: string; code: string }> };
const inLists = (lists: string[] | undefined, id: string) => !lists || lists.some(list => list.endsWith("_") ? id.startsWith(list) : id === list);
/** Option lists for enquiry fields; `lists` limits it to one field's lists (ids, or prefixes ending in "_"). */
export function LeadOptionsEditor({ workspaceId, initialOptions, onSaved, onDirtyChange, lists, regionLabel }: { workspaceId: string; initialOptions?: LeadOptions; onSaved: (options: LeadOptions) => void; onDirtyChange?: (dirty: boolean) => void; lists?: string[]; regionLabel?: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [options, setOptions] = useState(initialOptions);
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>();
  const [group, setGroup] = useState(() => lists?.[0]?.endsWith("_") ? `${lists[0]}${lists[0] === "lead_area_" ? initialOptions?.emirates.find(item => item.id !== "other")?.id ?? "" : initialOptions?.sources[0]?.id ?? ""}` : lists?.[0] ?? "enquiry_type");
  const [entries, setEntries] = useState<LeadOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<WorkspaceConfigurationRevision[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [revisionTarget, setRevisionTarget] = useState<WorkspaceConfigurationRevision>();
  const [groupTarget, setGroupTarget] = useState("");
  useEffect(() => { crmRequest<{ taxonomies: Taxonomy[] }>(workspaceId, "settings").then(result => setTaxonomies(result.taxonomies)).catch(failure => setError(failure.message)); }, [workspaceId]);
  const groups = [{ id: "customer_type", label: t("Customer types"), values: options?.customerTypes ?? [] }, { id: "enquiry_type", label: t("Enquiry types"), values: options?.enquiryTypes ?? [] }, { id: "emirate", label: regionLabel ?? t("Regions"), values: options?.emirates ?? [] }, ...(options?.emirates ?? []).filter(emirate => emirate.id !== "other").map(emirate => ({ id: `lead_area_${emirate.id}`, label: t("{region} areas", { region: emirate.label }), values: options?.areas?.[emirate.id] ?? [] })), { id: "budget_range", label: t("Budget ranges"), values: options?.budgetRanges ?? [] }, { id: "referral_broker", label: t("Brokers"), values: options?.referralBrokers ?? [] }, { id: "referral_partner", label: t("Referral partners"), values: options?.referralPartners ?? [] }, { id: "lead_source", label: t("Sources"), values: options?.sources ?? [] }, ...(options?.sources ?? []).map(source => ({ id: `lead_channel_${source.id}`, label: t("{source} channels", { source: source.label }), values: options?.channels[source.id] ?? [] }))];
  // A saved enquiry type opens its own steps; "Not sure yet" has none.
  const typeIds = new Map((taxonomies?.find(item => item.code === "enquiry_type")?.options ?? []).filter(option => option.code !== "not_sure").map(option => [option.code, option.id]));
  const shownGroups = groups.filter(item => inLists(lists, item.id));
  const groupLabel = groups.find(item => item.id === group)?.label;
  const [loadedGroup, setLoadedGroup] = useState("");
  if (loadedGroup !== group && options) { setLoadedGroup(group); setEntries(structuredClone(groups.find(item => item.id === group)?.values ?? [])); }
  const dirty = JSON.stringify(entries) !== JSON.stringify(groups.find(item => item.id === group)?.values ?? []);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const save = async () => {
    if (!taxonomies) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (entries.some(option => !option.label.trim())) throw new Error(t("Give every option a label."));
      if (["enquiry_type", "lead_source", "emirate"].includes(group) && !entries.length) throw new Error(t("Keep at least one option."));
      const existing = taxonomies.find(item => item.code === group);
      // Each enquiry type keeps its own steps (Enquiry types); a type added here starts from Basic.
      const values = { name: groups.find(item => item.id === group)?.label ?? group, options: entries.map((option, position) => ({ code: option.id, label: option.label.trim(), position })) };
      const saved = await crmRequest<Taxonomy>(workspaceId, existing ? `taxonomies/${existing.id}` : "taxonomies", existing ? "PATCH" : "POST", existing ? { ...values, version: existing.version, status: "active" } : { ...values, code: group });
      setTaxonomies(previous => [...(previous ?? []).filter(item => item.id !== saved.id), saved]);
      const current = await crmRequest<LeadOptions>(workspaceId, "lead-options"); setOptions(current); onSaved(current); setEntries(entries.map(option => ({ ...option, label: option.label.trim() }))); setNotice(t("Options saved."));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("Options could not be saved.")); }
    finally { setBusy(false); }
  };
  const openHistory = async () => {
    const existing = taxonomies?.find(item => item.code === group);
    if (!existing) return;
    setHistoryOpen(true); setHistoryError("");
    try { setRevisions(await crmRequest<WorkspaceConfigurationRevision[]>(workspaceId, `settings/taxonomy/${existing.id}/history`)); }
    catch (failure) { setHistoryError(failure instanceof Error ? failure.message : t("Option history could not be loaded.")); }
  };
  const rollback = async () => {
    const existing = taxonomies?.find(item => item.code === group);
    if (!existing || !revisionTarget) return;
    setBusy(true); setHistoryError("");
    try {
      const saved = await crmRequest<Taxonomy>(workspaceId, `settings/taxonomy/${existing.id}/rollback`, "POST", { version: existing.version, revisionId: revisionTarget.id });
      setTaxonomies(previous => [...(previous ?? []).filter(item => item.id !== saved.id), saved]);
      const current = await crmRequest<LeadOptions>(workspaceId, "lead-options");
      setOptions(current); onSaved(current);
      const values = group === "customer_type" ? current.customerTypes : group === "enquiry_type" ? current.enquiryTypes : group === "emirate" ? current.emirates : group.startsWith("lead_area_") ? current.areas[group.replace(/^lead_area_/, "")] ?? [] : group === "budget_range" ? current.budgetRanges : group === "referral_broker" ? current.referralBrokers ?? [] : group === "referral_partner" ? current.referralPartners ?? [] : group === "lead_source" ? current.sources : current.channels[group.replace(/^lead_channel_/, "")] ?? [];
      setEntries(values); setRevisionTarget(undefined); setNotice(t("Options restored from history."));
      setRevisions(await crmRequest<WorkspaceConfigurationRevision[]>(workspaceId, `settings/taxonomy/${existing.id}/history`));
    } catch (failure) { setHistoryError(failure instanceof Error ? failure.message : t("Options could not be restored.")); setRevisionTarget(undefined); }
    finally { setBusy(false); }
  };
  const changeGroup = (id: string) => { setGroup(id); setEntries(structuredClone(groups.find(item => item.id === id)?.values ?? [])); setNotice(""); };
  return <section className={styles.settings} aria-label={t("Enquiry options")}>
    {error && <Callout title={t("Options not saved")} tone="warning">{error}</Callout>}{notice && <p role="status">{notice}</p>}
    {shownGroups.length > 1 && <SelectField label={t("List")} items={shownGroups.map(({ id, label }) => ({ id, label }))} selectedKey={group} isDisabled={busy} onSelectionChange={key => { const id = String(key); if (dirty) { setGroupTarget(id); return; } changeGroup(id); }} />}
    <div className={styles.optionList}>{entries.map((option, index) => <div key={option.id} className={styles.optionRow}><TextInput label={t("Option {number}", { number: index + 1 })} value={option.label} isDisabled={busy || (group === "emirate" && option.id === "other")} onChange={label => setEntries(previous => previous.map(item => item.id === option.id ? { ...item, label } : item))} />{group === "enquiry_type" ? <StepsLink id={typeIds.get(option.id)} /> : null}<IconButton aria-label={option.label ? t("Remove {option}", { option: option.label }) : t("Remove option")} isDisabled={busy || (["enquiry_type", "budget_range"].includes(group) && option.id === "not_sure") || (group === "emirate" && option.id === "other")} onPress={() => setEntries(previous => previous.filter(item => item.id !== option.id))}><Trash2 size={15} /></IconButton></div>)}</div>
    {!entries.length && <p>{t("No choices configured yet. Add the options approved for this workspace.")}</p>}
    <div className={styles.actions}><Button size="compact" isDisabled={busy || !taxonomies?.some(item => item.code === group)} onPress={() => void openHistory()} variant="quiet"><History size={15} />{t("History")}</Button><Button size="compact" isDisabled={busy || !taxonomies || entries.length >= 100} onPress={() => setEntries(previous => [...previous, { id: `option_${crypto.randomUUID().replaceAll("-", "")}`, label: "" }])}><Plus size={15} />{t("Add option")}</Button><Button variant="primary" size="compact" isDisabled={!taxonomies} isLoading={busy} onPress={() => void save()}>{t("Save options")}</Button></div>
    <InspectorSheet isOpen={historyOpen} onOpenChange={setHistoryOpen} size="sm" title={groupLabel ? t("{list} history", { list: groupLabel }) : t("Options history")} description={t("Every save is retained. Restoring creates a new revision and keeps the current version in history.")}>
      {historyError ? <Callout title={t("History unavailable")} tone="danger">{historyError}</Callout> : null}
      {!historyError && !revisions.length ? <p>{t("No saved changes yet.")}</p> : null}
      {revisions.length ? <ol className={styles.historyList}>{revisions.map((revision, index) => <li key={revision.id}><div><strong>{t("Revision {number}", { number: revision.revisionNumber })}</strong>{index === 0 ? <Badge tone="neutral">{t("Current")}</Badge> : null}</div><small>{formatDate(revision.createdAt, { locale, timeZone }, { dateStyle: "medium", timeStyle: "short" })} · {revision.changes.length === 1 ? t("{count} changed field", { count: revision.changes.length }) : t("{count} changed fields", { count: revision.changes.length })}</small>{index ? <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => setRevisionTarget(revision)}><RotateCcw size={14} />{t("Restore")}</Button> : null}</li>)}</ol> : null}
    </InspectorSheet>
    <ConfirmationDialog isOpen={Boolean(revisionTarget)} onOpenChange={open => { if (!open && !busy) setRevisionTarget(undefined); }} title={t("Restore these options?")} body={t("The selected labels and order will become active. Existing enquiries keep their stored values, and the current configuration stays in history.")} confirmLabel={busy ? t("Restoring…") : t("Restore revision")} onConfirm={() => void rollback()} />
    <ConfirmationDialog isOpen={Boolean(groupTarget)} onOpenChange={open => { if (!open) setGroupTarget(""); }} title={t("Discard unsaved option changes?")} body={t("The labels and order in the current option group have not been saved.")} confirmLabel={t("Discard changes")} onConfirm={() => { const target = groupTarget; setGroupTarget(""); changeGroup(target); }} />
  </section>;
}

/** "Edit steps" for a saved enquiry type; a space keeps the rows aligned for the others. */
function StepsLink({ id }: { id?: string }) {
  const t = useT();
  return id ? <Link className={`wd-button ${styles.stepsLink}`} data-size="compact" data-variant="quiet" href={`/workspace/enquiry-types/${id}`}><Pencil aria-hidden="true" size={14} />{t("Edit steps")}</Link> : <span className={styles.stepsLink} />;
}
