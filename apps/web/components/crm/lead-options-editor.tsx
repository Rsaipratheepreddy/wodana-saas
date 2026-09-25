"use client";

import { useEffect, useState } from "react";
import { History, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, Callout, ConfirmationDialog, IconButton, InspectorSheet, SelectField, TextInput } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import type { LeadOption, LeadOptions } from "@/lib/crm/lead-options";
import type { WorkspaceConfigurationRevision } from "@/lib/workspace/company-profile";
import styles from "./lead-forms.module.css";

type Taxonomy = { id: string; code: string; version: number; status: string };
export function LeadOptionsEditor({ workspaceId, initialOptions, onSaved, onDirtyChange }: { workspaceId: string; initialOptions?: LeadOptions; onSaved: (options: LeadOptions) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [options, setOptions] = useState(initialOptions);
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>();
  const [group, setGroup] = useState("enquiry_type");
  const [entries, setEntries] = useState<LeadOption[]>(initialOptions?.enquiryTypes ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<WorkspaceConfigurationRevision[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [revisionTarget, setRevisionTarget] = useState<WorkspaceConfigurationRevision>();
  const [groupTarget, setGroupTarget] = useState("");
  useEffect(() => { crmRequest<{ taxonomies: Taxonomy[] }>(workspaceId, "settings").then(result => setTaxonomies(result.taxonomies)).catch(failure => setError(failure.message)); }, [workspaceId]);
  const groups = [{ id: "customer_type", label: "Customer types", values: options?.customerTypes ?? [] }, { id: "enquiry_type", label: "Enquiry types", values: options?.enquiryTypes ?? [] }, { id: "emirate", label: "Emirates", values: options?.emirates ?? [] }, ...(options?.emirates ?? []).filter(emirate => emirate.id !== "outside_uae").map(emirate => ({ id: `lead_area_${emirate.id}`, label: `${emirate.label} areas`, values: options?.areas?.[emirate.id] ?? [] })), { id: "budget_range", label: "Budget ranges", values: options?.budgetRanges ?? [] }, { id: "referral_broker", label: "Brokers", values: options?.referralBrokers ?? [] }, { id: "referral_partner", label: "Referral partners", values: options?.referralPartners ?? [] }, { id: "lead_source", label: "Sources", values: options?.sources ?? [] }, ...(options?.sources ?? []).map(source => ({ id: `lead_channel_${source.id}`, label: `${source.label} channels`, values: options?.channels[source.id] ?? [] }))];
  const dirty = JSON.stringify(entries) !== JSON.stringify(groups.find(item => item.id === group)?.values ?? []);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const save = async () => {
    if (!taxonomies) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (entries.some(option => !option.label.trim())) throw new Error("Give every option a label.");
      if (["enquiry_type", "lead_source", "emirate"].includes(group) && !entries.length) throw new Error("Keep at least one option.");
      const existing = taxonomies.find(item => item.code === group);
      const values = { name: groups.find(item => item.id === group)?.label ?? group, options: entries.map((option, position) => ({ code: option.id, label: option.label.trim(), position })) };
      const saved = await crmRequest<Taxonomy>(workspaceId, existing ? `taxonomies/${existing.id}` : "taxonomies", existing ? "PATCH" : "POST", existing ? { ...values, version: existing.version, status: "active" } : { ...values, code: group });
      setTaxonomies(previous => [...(previous ?? []).filter(item => item.id !== saved.id), saved]);
      const current = await crmRequest<LeadOptions>(workspaceId, "lead-options"); setOptions(current); onSaved(current); setEntries(entries.map(option => ({ ...option, label: option.label.trim() }))); setNotice("Options saved.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Options could not be saved."); }
    finally { setBusy(false); }
  };
  const openHistory = async () => {
    const existing = taxonomies?.find(item => item.code === group);
    if (!existing) return;
    setHistoryOpen(true); setHistoryError("");
    try { setRevisions(await crmRequest<WorkspaceConfigurationRevision[]>(workspaceId, `settings/taxonomy/${existing.id}/history`)); }
    catch (failure) { setHistoryError(failure instanceof Error ? failure.message : "Option history could not be loaded."); }
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
      setEntries(values); setRevisionTarget(undefined); setNotice("Options restored from history.");
      setRevisions(await crmRequest<WorkspaceConfigurationRevision[]>(workspaceId, `settings/taxonomy/${existing.id}/history`));
    } catch (failure) { setHistoryError(failure instanceof Error ? failure.message : "Options could not be restored."); setRevisionTarget(undefined); }
    finally { setBusy(false); }
  };
  const changeGroup = (id: string) => { setGroup(id); setEntries(structuredClone(groups.find(item => item.id === id)?.values ?? [])); setNotice(""); };
  return <section className={styles.settings} aria-label="Enquiry options">
    <h3>Workspace enquiry options</h3><p>These choices belong only to this workspace. Add the services your team accepts; removing a choice keeps past enquiries intact. Outside UAE stays available and uses a free-text city or country. Republish forms after changing their choices.</p>
    {error && <Callout title="Options not saved" tone="warning">{error}</Callout>}{notice && <p role="status">{notice}</p>}
    <SelectField label="Manage" items={groups.map(({ id, label }) => ({ id, label }))} selectedKey={group} isDisabled={busy} onSelectionChange={key => { const id = String(key); if (dirty) { setGroupTarget(id); return; } changeGroup(id); }} />
    <div className={styles.optionList}>{entries.map((option, index) => <div key={option.id} className={styles.optionRow}><TextInput label={`Option ${index + 1}`} value={option.label} isDisabled={busy || (group === "emirate" && option.id === "outside_uae")} onChange={label => setEntries(previous => previous.map(item => item.id === option.id ? { ...item, label } : item))} /><IconButton aria-label={`Remove ${option.label || "option"}`} isDisabled={busy || (["enquiry_type", "budget_range"].includes(group) && option.id === "not_sure") || (group === "emirate" && option.id === "outside_uae")} onPress={() => setEntries(previous => previous.filter(item => item.id !== option.id))}><Trash2 size={15} /></IconButton></div>)}</div>
    {!entries.length && <p>No choices configured yet. Add the options approved for this workspace.</p>}
    <div className={styles.actions}><Button size="compact" isDisabled={busy || !taxonomies?.some(item => item.code === group)} onPress={() => void openHistory()} variant="quiet"><History size={15} />History</Button><Button size="compact" isDisabled={busy || !taxonomies || entries.length >= 100} onPress={() => setEntries(previous => [...previous, { id: `option_${crypto.randomUUID().replaceAll("-", "")}`, label: "" }])}><Plus size={15} />Add option</Button><Button variant="primary" size="compact" isDisabled={!taxonomies} isLoading={busy} onPress={() => void save()}>Save options</Button></div>
    <InspectorSheet isOpen={historyOpen} onOpenChange={setHistoryOpen} size="sm" title={`${groups.find(item => item.id === group)?.label ?? "Options"} history`} description="Every save is retained. Restoring creates a new revision and keeps the current version in history.">
      {historyError ? <Callout title="History unavailable" tone="danger">{historyError}</Callout> : null}
      {!historyError && !revisions.length ? <p>No saved changes yet.</p> : null}
      {revisions.length ? <ol className={styles.historyList}>{revisions.map((revision, index) => <li key={revision.id}><div><strong>Revision {revision.revisionNumber}</strong>{index === 0 ? <Badge tone="neutral">Current</Badge> : null}</div><small>{new Date(revision.createdAt).toLocaleString()} · {revision.changes.length} changed {revision.changes.length === 1 ? "field" : "fields"}</small>{index ? <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => setRevisionTarget(revision)}><RotateCcw size={14} />Restore</Button> : null}</li>)}</ol> : null}
    </InspectorSheet>
    <ConfirmationDialog isOpen={Boolean(revisionTarget)} onOpenChange={open => { if (!open && !busy) setRevisionTarget(undefined); }} title="Restore these options?" body="The selected labels and order will become active. Existing enquiries keep their stored values, and the current configuration stays in history." confirmLabel={busy ? "Restoring…" : "Restore revision"} onConfirm={() => void rollback()} />
    <ConfirmationDialog isOpen={Boolean(groupTarget)} onOpenChange={open => { if (!open) setGroupTarget(""); }} title="Discard unsaved option changes?" body="The labels and order in the current option group have not been saved." confirmLabel="Discard changes" onConfirm={() => { const target = groupTarget; setGroupTarget(""); changeGroup(target); }} />
  </section>;
}
