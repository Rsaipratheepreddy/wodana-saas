"use client";

import { useId, useRef, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, Callout, ControlledModalDialog, DateField, NumericInput, SelectField, TextInput } from "@/design-system";
import { crmRequest, rows, type RecordData } from "@/lib/crm/client";
import { localDateTime } from "@/lib/crm/calendar";
import type { CrmLeadListItem, CrmPipeline, LeadsPageData } from "@/lib/crm/leads";
import { hasResolvedEnquiryType } from "@/lib/crm/lead-options";
import { CrmDateTimeField } from "./crm-date-time-field";
import { useCrmResource } from "./crm-workbench";
import styles from "./create-deal-dialog.module.css";

export function CreateDealDialog({ lead, initialData, onClose, onCreated }: { lead: CrmLeadListItem; initialData: LeadsPageData; onClose: () => void; onCreated: (record: RecordData) => Promise<void> }) {
  const id = useId(), saving = useRef(false);
  const resource = useCrmResource<unknown>(initialData.workspaceId, "pipelines");
  const pipelines = (resource.data ? rows(resource.data) as unknown as CrmPipeline[] : initialData.pipelines).filter(p => p.status === "active");
  const pipeline = pipelines.find(p => p.isDefault) ?? pipelines[0];
  const members = initialData.members.filter(m => m.status === "active");
  const needsEnquiryType = !hasResolvedEnquiryType(lead.serviceType);
  const [owner, setOwner] = useState(lead.ownerMembershipId ?? (members.length === 1 ? members[0].id : ""));
  const [title, setTitle] = useState(lead.title);
  const [nextAction, setNextAction] = useState(localDateTime(lead.nextActionAt));
  const [closeDate, setCloseDate] = useState("");
  const [amount, setAmount] = useState<number | undefined>();
  const currency = initialData.defaultCurrency ?? "";
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [failure, setFailure] = useState("");
  const ensurePipeline = async () => {
    const available = rows(await crmRequest(initialData.workspaceId, "pipelines"));
    const existing = available.find(p => p.status === "active" && p.isDefault) ?? available.find(p => p.status === "active");
    if (existing) return existing;
    return crmRequest<RecordData>(initialData.workspaceId, "pipelines", "POST", { name: "Sales", code: "sales", isDefault: true, stages: [
      { code: "qualified", name: "New Opportunity", position: 1, probability: 20, forecastCategory: "pipeline", entryRequirements: { owner: true, nextAction: true } },
      { code: "proposal", name: "Proposal", position: 2, probability: 50, forecastCategory: "best_case", entryRequirements: {} },
      { code: "negotiation", name: "Negotiation", position: 3, probability: 75, forecastCategory: "commit", entryRequirements: {} },
      { code: "won", name: "Won", position: 4, probability: 100, forecastCategory: "closed", entryRequirements: {} },
      { code: "lost", name: "Lost", position: 5, probability: 0, forecastCategory: "closed", entryRequirements: {} },
    ] });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving.current || saved) return;
    saving.current = true; setBusy(true); setFailure("");
    try {
      if (needsEnquiryType) throw new Error("Choose a specific enquiry type in Edit details before converting this enquiry.");
      if (!title.trim() || !owner) throw new Error("Enter an opportunity name and choose a sales owner.");
      if (!nextAction || !Number.isFinite(Date.parse(nextAction))) throw new Error("Choose the next follow-up date and time.");
      if (amount !== undefined && !/^[A-Z]{3}$/.test(currency)) throw new Error("Set your workspace currency in Company settings before adding a value.");
      const salesPipeline = pipeline ?? await ensurePipeline();
      const result = await crmRequest(initialData.workspaceId, `leads/${lead.id}/qualify`, "POST", {
        partyId: lead.partyId, leadVersion: lead.version, pipelineId: salesPipeline.id, ownerMembershipId: owner, title: title.trim(),
        nextActionAt: new Date(nextAction).toISOString(), ...(closeDate ? { expectedCloseAt: new Date(`${closeDate}T12:00`).toISOString() } : {}),
        ...(amount !== undefined ? { amount, currencyCode: currency.trim().toUpperCase() } : {}),
      });
      setSaved(true);
      try { await onCreated(result); } catch { setFailure("Opportunity created. Close this window and open Pipeline to find it. Do not submit again."); }
    } catch (error) { setFailure(error instanceof Error ? error.message : "Could not convert the enquiry."); }
    finally { saving.current = false; setBusy(false); }
  };
  return <ControlledModalDialog isOpen title="Convert to opportunity" description={lead.partyName} size="md" isDismissable={!busy} onOpenChange={open => { if (!open && !busy) onClose(); }} footer={<div className={styles.actions}><Button size="compact" style={{ flex: "0 0 auto", minWidth: 88 }} isDisabled={busy} onPress={onClose}>{saved ? "Close" : "Cancel"}</Button><Button size="compact" style={{ flex: "0 0 auto", minWidth: 112 }} variant="primary" type="submit" form={id} isLoading={busy} isDisabled={saved || !members.length || needsEnquiryType}>Convert to opportunity</Button></div>}>
    <form id={id} className={styles.form} onSubmit={submit}>
      <p className={styles.explanation}>Move this enquiry into Pipeline as a new opportunity, keeping its client, owner and follow-up connected.</p>
      {failure && <Callout tone={saved ? "warning" : "danger"} title={saved ? "Opportunity created" : "Could not continue"}>{failure}</Callout>}
      {needsEnquiryType && <Callout tone="warning" title="Enquiry type needed">This enquiry is marked Not Sure Yet. Open Edit details and choose its actual type before conversion.</Callout>}
      {!members.length && <Callout tone="warning" title="A sales owner is needed">Add an active team member in Company settings before conversion.</Callout>}
      <fieldset disabled={busy || saved} className={styles.fields}>
        <div className={styles.identityRow}><TextInput label="Opportunity name" isRequired value={title} onChange={setTitle} maxLength={240} />
        <SelectField label="Sales owner" isRequired selectedKey={owner || null} items={members.map(m => ({ id: m.id, label: m.displayName }))} onSelectionChange={key => setOwner(String(key ?? ""))} /></div>
        <CrmDateTimeField label="Next follow-up" isRequired value={nextAction} onChange={setNextAction} />
        <div className={styles.optional}><span>Optional details</span><DateField label="Expected close date" value={closeDate ? parseDate(closeDate) : null} onChange={value => setCloseDate(value?.toString() ?? "")} /><NumericInput label={`Estimated value${currency ? ` (${currency})` : ""}`} minValue={0} value={amount} onChange={setAmount} /></div>
      </fieldset>
    </form>
  </ControlledModalDialog>;
}
