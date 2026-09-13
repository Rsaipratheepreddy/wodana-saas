"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Callout, IconButton, SelectField, TextInput } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import type { LeadOption, LeadOptions } from "@/lib/crm/lead-options";
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
  useEffect(() => { crmRequest<{ taxonomies: Taxonomy[] }>(workspaceId, "settings").then(result => setTaxonomies(result.taxonomies)).catch(failure => setError(failure.message)); }, [workspaceId]);
  const groups = [{ id: "customer_type", label: "Customer types", values: options?.customerTypes ?? [] }, { id: "enquiry_type", label: "Enquiry types", values: options?.enquiryTypes ?? [] }, { id: "budget_range", label: "Budget ranges", values: options?.budgetRanges ?? [] }, { id: "lead_source", label: "Sources", values: options?.sources ?? [] }, ...(options?.sources ?? []).map(source => ({ id: `lead_channel_${source.id}`, label: `${source.label} channels`, values: options?.channels[source.id] ?? [] }))];
  const dirty = JSON.stringify(entries) !== JSON.stringify(groups.find(item => item.id === group)?.values ?? []);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const save = async () => {
    if (!taxonomies) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (entries.some(option => !option.label.trim())) throw new Error("Give every option a label.");
      if (["enquiry_type", "lead_source"].includes(group) && !entries.length) throw new Error("Keep at least one option.");
      const existing = taxonomies.find(item => item.code === group);
      const values = { name: groups.find(item => item.id === group)?.label ?? group, options: entries.map((option, position) => ({ code: option.id, label: option.label.trim(), position })) };
      const saved = await crmRequest<Taxonomy>(workspaceId, existing ? `taxonomies/${existing.id}` : "taxonomies", existing ? "PATCH" : "POST", existing ? { ...values, version: existing.version, status: "active" } : { ...values, code: group });
      setTaxonomies(previous => [...(previous ?? []).filter(item => item.id !== saved.id), saved]);
      const current = await crmRequest<LeadOptions>(workspaceId, "lead-options"); setOptions(current); onSaved(current); setEntries(entries.map(option => ({ ...option, label: option.label.trim() }))); setNotice("Options saved.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Options could not be saved."); }
    finally { setBusy(false); }
  };
  return <section className={styles.settings} aria-label="Lead options">
    <h3>Workspace enquiry options</h3><p>These choices belong only to this workspace. Add the services your team accepts; removing a choice keeps past enquiries intact. Republish forms after changing their choices.</p>
    {error && <Callout title="Options not saved" tone="warning">{error}</Callout>}{notice && <p role="status">{notice}</p>}
    <SelectField label="Manage" items={groups.map(({ id, label }) => ({ id, label }))} selectedKey={group} isDisabled={busy} onSelectionChange={key => { if (dirty && !window.confirm("Discard unsaved option changes?")) return; const id = String(key); setGroup(id); setEntries(structuredClone(groups.find(item => item.id === id)?.values ?? [])); setNotice(""); }} />
    <div className={styles.optionList}>{entries.map((option, index) => <div key={option.id} className={styles.optionRow}><TextInput label={`Option ${index + 1}`} value={option.label} isDisabled={busy} onChange={label => setEntries(previous => previous.map(item => item.id === option.id ? { ...item, label } : item))} /><IconButton aria-label={`Remove ${option.label || "option"}`} isDisabled={busy || (["enquiry_type", "budget_range"].includes(group) && option.id === "not_sure")} onPress={() => setEntries(previous => previous.filter(item => item.id !== option.id))}><Trash2 size={15} /></IconButton></div>)}</div>
    {!entries.length && <p>No choices configured yet. Add the options approved for this workspace.</p>}
    <div className={styles.actions}><Button size="compact" isDisabled={busy || !taxonomies || entries.length >= 100} onPress={() => setEntries(previous => [...previous, { id: `option_${crypto.randomUUID().replaceAll("-", "")}`, label: "" }])}><Plus size={15} />Add option</Button><Button variant="primary" size="compact" isDisabled={!taxonomies} isLoading={busy} onPress={() => void save()}>Save options</Button></div>
  </section>;
}
