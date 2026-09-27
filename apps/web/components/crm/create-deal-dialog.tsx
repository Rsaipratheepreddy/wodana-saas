"use client";

import { useId, useRef, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, Callout, ControlledModalDialog, DateField, NumericInput, SelectField, TextInput, useDesignSystem } from "@/design-system";
import { crmRequest, rows, type RecordData } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { localDateTime } from "@/lib/crm/calendar";
import type { CrmLeadListItem, CrmPipeline, LeadsPageData } from "@/lib/crm/leads";
import { hasResolvedEnquiryType } from "@/lib/crm/lead-options";
import { CrmDateTimeField } from "./crm-date-time-field";
import { useCrmResource } from "./crm-workbench";
import styles from "./create-deal-dialog.module.css";

export function CreateDealDialog({ lead, initialData, onClose, onCreated }: { lead: CrmLeadListItem; initialData: LeadsPageData; onClose: () => void; onCreated: (record: RecordData) => Promise<void> }) {
  const t = useT();
  const id = useId(), saving = useRef(false);
  const resource = useCrmResource<unknown>(initialData.workspaceId, "pipelines");
  const pipelines = (resource.data ? rows(resource.data) as unknown as CrmPipeline[] : initialData.pipelines).filter(p => p.status === "active");
  const pipeline = pipelines.find(p => p.isDefault) ?? pipelines[0];
  // The enquiry's own owner can always keep it, even for a role that can't list the whole team.
  const active = initialData.members.filter(m => m.status === "active");
  const members = lead.ownerMembershipId && !active.some(m => m.id === lead.ownerMembershipId)
    ? [...active, { id: lead.ownerMembershipId, displayName: lead.ownerName ?? t("Current owner") }]
    : active;
  const needsEnquiryType = !hasResolvedEnquiryType(lead.serviceType);
  const [owner, setOwner] = useState(lead.ownerMembershipId ?? (members.length === 1 ? members[0].id : ""));
  const [title, setTitle] = useState(lead.title);
  const [nextAction, setNextAction] = useState(localDateTime(lead.nextActionAt));
  const [closeDate, setCloseDate] = useState("");
  const [amount, setAmount] = useState<number | undefined>();
  // Every member's session carries the workspace region; the page data may not (roles without settings access).
  const region = useDesignSystem();
  const currency = initialData.defaultCurrency ?? region.currency ?? "";
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [failure, setFailure] = useState("");
  // Every workspace is provisioned with a Sales pipeline. Only someone who may manage CRM settings
  // recreates a missing one here; a salesperson is told who to ask instead of hitting a 403.
  const ensurePipeline = async () => {
    const available = rows(await crmRequest(initialData.workspaceId, "pipelines"));
    const existing = available.find(p => p.status === "active" && p.isDefault) ?? available.find(p => p.status === "active");
    if (existing) return existing;
    if (!initialData.canManagePipelines) throw new Error(t("No sales pipeline is set up yet. Ask a workspace administrator to add one in Sales settings."));
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
      if (needsEnquiryType) throw new Error(t("Choose a specific enquiry type in Edit details before converting this enquiry."));
      if (!title.trim() || !owner) throw new Error(t("Enter an opportunity name and choose a sales owner."));
      if (!nextAction || !Number.isFinite(Date.parse(nextAction))) throw new Error(t("Choose the next follow-up date and time."));
      if (amount !== undefined && !/^[A-Z]{3}$/.test(currency)) throw new Error(t("Set your workspace currency in Company settings before adding a value."));
      const salesPipeline = pipeline ?? await ensurePipeline();
      const result = await crmRequest(initialData.workspaceId, `leads/${lead.id}/qualify`, "POST", {
        partyId: lead.partyId, leadVersion: lead.version, pipelineId: salesPipeline.id, ownerMembershipId: owner, title: title.trim(),
        nextActionAt: new Date(nextAction).toISOString(), ...(closeDate ? { expectedCloseAt: new Date(`${closeDate}T12:00`).toISOString() } : {}),
        ...(amount !== undefined ? { amount, currencyCode: currency.trim().toUpperCase() } : {}),
      });
      setSaved(true);
      try { await onCreated(result); } catch { setFailure(t("Opportunity created. Close this window and open Pipeline to find it. Do not submit again.")); }
    } catch (error) { setFailure(error instanceof Error ? translateKnown(t, error.message) : t("Could not convert the enquiry.")); }
    finally { saving.current = false; setBusy(false); }
  };
  return <ControlledModalDialog isOpen title={t("Convert to opportunity")} description={lead.partyName} size="md" isDismissable={!busy} onOpenChange={open => { if (!open && !busy) onClose(); }} footer={<div className={styles.actions}><Button size="compact" style={{ flex: "0 0 auto", minWidth: 88 }} isDisabled={busy} onPress={onClose}>{t(saved ? "Close" : "Cancel")}</Button><Button size="compact" style={{ flex: "0 0 auto", minWidth: 112 }} variant="primary" type="submit" form={id} isLoading={busy} isDisabled={saved || !members.length || needsEnquiryType}>{t("Convert to opportunity")}</Button></div>}>
    <form id={id} className={styles.form} onSubmit={submit}>
      <p className={styles.explanation}>{t("Move this enquiry into Pipeline as a new opportunity, keeping its client, owner and follow-up connected.")}</p>
      {failure && <Callout tone={saved ? "warning" : "danger"} title={t(saved ? "Opportunity created" : "Could not continue")}>{failure}</Callout>}
      {needsEnquiryType && <Callout tone="warning" title={t("Enquiry type needed")}>{t("This enquiry is marked Not Sure Yet. Open Edit details and choose its actual type before conversion.")}</Callout>}
      {!members.length && <Callout tone="warning" title={t("A sales owner is needed")}>{t("Ask an administrator to assign this enquiry before converting it.")}</Callout>}
      <fieldset disabled={busy || saved} className={styles.fields}>
        <div className={styles.identityRow}><TextInput label={t("Opportunity name")} isRequired value={title} onChange={setTitle} maxLength={240} />
        <SelectField label={t("Sales owner")} isRequired selectedKey={owner || null} items={members.map(m => ({ id: m.id, label: m.displayName }))} onSelectionChange={key => setOwner(String(key ?? ""))} /></div>
        <CrmDateTimeField label={t("Next follow-up")} isRequired value={nextAction} onChange={setNextAction} />
        <div className={styles.optional}><span>{t("Optional details")}</span><DateField label={t("Expected close date")} value={closeDate ? parseDate(closeDate) : null} onChange={value => setCloseDate(value?.toString() ?? "")} /><NumericInput label={currency ? t("Estimated value ({currency})", { currency }) : t("Estimated value")} minValue={0} value={amount} onChange={setAmount} /></div>
      </fieldset>
    </form>
  </ControlledModalDialog>;
}
