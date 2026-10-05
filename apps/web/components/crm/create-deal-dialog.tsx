"use client";

import { useState } from "react";
import { parseDate } from "@internationalized/date";
import { Callout, DateField, FormDialog, FormNotSaved, MoneyField, MoreDetails, SelectField, TextInput, useDesignSystem, useWorkingCalendar, type SaveProblem } from "@/design-system";
import { CrmRequestError, crmRequest, rows, type RecordData } from "@/lib/crm/client";
import { problemText } from "@/lib/crm/enquiry-requirements";
import { administrativeAreaLabel, countryFromLocale } from "@/lib/workspace/region-labels";
import { useT } from "@/lib/i18n/i18n-provider";
import { zonedDateTime, zonedDateTimeToIso } from "@/lib/crm/zoned-time";
import { salesOwnerChoices, type CrmLeadListItem, type CrmPipeline, type LeadsPageData } from "@/lib/crm/leads";
import { hasResolvedEnquiryType } from "@/lib/crm/lead-options";
import { CrmDateTimeField } from "./crm-date-time-field";
import { useCrmResource } from "./crm-workbench";
import styles from "./create-deal-dialog.module.css";

export function CreateDealDialog({ lead, initialData, onClose, onCreated, initialProblems }: { lead: CrmLeadListItem; initialData: LeadsPageData; onClose: () => void; onCreated: (record: RecordData) => Promise<void>;
  /** PLM-096: what the enquiry still needs, when a quick conversion was refused. */
  initialProblems?: SaveProblem[];
}) {
  const t = useT();
  // PLM-092: a refused conversion names everything the enquiry type still needs, at once.
  const [problems, setProblems] = useState<SaveProblem[]>(initialProblems ?? []);
  const regionLabel = t(administrativeAreaLabel(countryFromLocale(initialData.defaultLocale)) as never);
  const resource = useCrmResource<unknown>(initialData.workspaceId, "pipelines");
  const pipelines = (resource.data ? rows(resource.data) as unknown as CrmPipeline[] : initialData.pipelines).filter(p => p.status === "active");
  const pipeline = pipelines.find(p => p.isDefault) ?? pipelines[0];
  // The enquiry's own owner can always keep it, even for a role that can't list the whole team.
  const active = salesOwnerChoices(initialData);
  const members = lead.ownerMembershipId && !active.some(m => m.id === lead.ownerMembershipId)
    ? [...active, { id: lead.ownerMembershipId, displayName: lead.ownerName ?? t("Current owner") }]
    : active;
  const needsEnquiryType = !hasResolvedEnquiryType(lead.serviceType);
  const [owner, setOwner] = useState(lead.ownerMembershipId ?? (members.length === 1 ? members[0].id : ""));
  const [title, setTitle] = useState(lead.title);
  // Every member's session carries the workspace region; the page data may not (roles without settings access).
  const region = useDesignSystem();
  // No follow-up yet: the next working day at 10:00 in the workspace's week. The field is the workspace's wall clock.
  const calendar = useWorkingCalendar();
  const [nextAction, setNextAction] = useState(() => lead.nextActionAt ? zonedDateTime(lead.nextActionAt, region.timeZone) : `${calendar.nextWorkingDayFromToday().toString()}T10:00`);
  const [closeDate, setCloseDate] = useState("");
  const [amount, setAmount] = useState("");
  const currency = initialData.defaultCurrency ?? region.currency ?? "";
  const [saved, setSaved] = useState(false), [failure, setFailure] = useState("");
  const [start] = useState(() => JSON.stringify({ owner, title, nextAction, closeDate, amount }));
  const dirty = !saved && JSON.stringify({ owner, title, nextAction, closeDate, amount }) !== start;
  // Every workspace is provisioned with a Sales pipeline. Only someone who may manage CRM settings
  // recreates a missing one here; a salesperson is told who to ask instead of hitting a 403.
  const ensurePipeline = async () => {
    const available = rows(await crmRequest(initialData.workspaceId, "pipelines"));
    const existing = available.find(p => p.status === "active" && p.isDefault) ?? available.find(p => p.status === "active");
    if (existing) return existing;
    if (!initialData.canManagePipelines) throw new Error(t("No sales pipeline is set up yet. Ask a workspace administrator to add one in Sales settings."));
    return crmRequest<RecordData>(initialData.workspaceId, "pipelines", "POST", { name: "Sales", code: "sales", isDefault: true, stages: [
      { code: "qualified", name: "New Opportunity", position: 1, probability: 20, forecastCategory: "pipeline", entryRequirements: { owner: true, nextAction: true } },
      { code: "qualification", name: "Qualified", position: 2, probability: 35, forecastCategory: "pipeline", entryRequirements: {} },
      { code: "proposal", name: "Proposal", position: 3, probability: 50, forecastCategory: "best_case", entryRequirements: {} },
      { code: "negotiation", name: "Negotiation", position: 4, probability: 75, forecastCategory: "commit", entryRequirements: {} },
      { code: "won", name: "Won", position: 5, probability: 100, forecastCategory: "closed", entryRequirements: {} },
      { code: "lost", name: "Lost", position: 6, probability: 0, forecastCategory: "closed", entryRequirements: {} },
    ] });
  };
  const submit = async () => {
    if (saved) return;
    setFailure("");
    if (needsEnquiryType) throw new Error(t("Choose a specific enquiry type in Edit details before converting this enquiry."));
    if (!title.trim() || !owner) throw new Error(t("Enter an opportunity name and choose a sales owner."));
    const nextActionAt = nextAction ? zonedDateTimeToIso(nextAction, region.timeZone) : null;
    if (!nextActionAt) throw new Error(t("Choose the next follow-up date and time."));
    if (amount && !/^[A-Z]{3}$/.test(currency)) throw new Error(t("Set your workspace currency in Company settings before adding a value."));
    const salesPipeline = pipeline ?? await ensurePipeline();
    setProblems([]);
    const result = await crmRequest(initialData.workspaceId, `leads/${lead.id}/qualify`, "POST", {
      partyId: lead.partyId, leadVersion: lead.version, pipelineId: salesPipeline.id, ownerMembershipId: owner, title: title.trim(),
      nextActionAt, ...(closeDate ? { expectedCloseAt: new Date(`${closeDate}T12:00`).toISOString() } : {}),
      ...(amount ? { amount: Number(amount), currencyCode: currency.trim().toUpperCase() } : {}),
    }).catch((error: unknown) => {
      if (error instanceof CrmRequestError && error.missing.length) { setProblems(error.missing); throw new FormNotSaved(); }
      throw error;
    });
    setSaved(true);
    try { await onCreated(result); } catch { setFailure(t("Opportunity created. Close this window and open Pipeline to find it. Do not submit again.")); }
  };
  return <FormDialog cancelLabel={saved ? t("Close") : undefined} description={lead.partyName} error={failure || undefined} errorTitle={problems.length ? t("Complete the enquiry before converting") : t("Opportunity created")} hideSubmit={saved}
    problems={problems.map((item) => ({ ...item, text: problemText(item, t, { regionLabel }) }))}
    isDirty={dirty} isSubmitDisabled={!members.length || needsEnquiryType} onClose={onClose} onSubmit={submit} submitLabel={t("Convert to opportunity")} title={t("Convert to opportunity")}
    lead={<>
      {needsEnquiryType && <Callout tone="warning" title={t("Enquiry type needed")}>{t("This enquiry is marked Not Sure Yet. Open Edit details and choose its actual type before conversion.")}</Callout>}
      {!members.length && <Callout tone="warning" title={t("A sales owner is needed")}>{t("Nobody here can own sales work yet. Ask whoever manages roles to give someone the Sales role.")}</Callout>}
    </>}>
    <fieldset className={styles.fields} data-tour="convert-form" disabled={saved}>
      <TextInput label={t("Opportunity name")} isRequired value={title} onChange={setTitle} maxLength={240} />
      <SelectField label={t("Sales owner")} isRequired selectedKey={owner || null} items={members.map(m => ({ id: m.id, label: m.displayName }))} onSelectionChange={key => setOwner(String(key ?? ""))} />
      <CrmDateTimeField label={t("Next follow-up")} isRequired value={nextAction} onChange={setNextAction} />
      <MoreDetails filled={[closeDate, amount].filter(Boolean).length}>
        <DateField label={t("Expected close date")} value={closeDate ? parseDate(closeDate) : null} onChange={value => setCloseDate(value?.toString() ?? "")} />
        <MoneyField label={t("Estimated value")} currency={currency || undefined} min="0" value={amount} onChange={setAmount} />
      </MoreDetails>
    </fieldset>
  </FormDialog>;
}
