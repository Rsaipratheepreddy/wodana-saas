"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { Activity, CalendarClock, CalendarDays, CheckCircle2, BriefcaseBusiness, ContactRound, FileInput, Gauge, Globe, ListFilter, Plus, RefreshCw, Settings2, Type, UserRoundPlus, UsersRound, WandSparkles } from "lucide-react";
import {
  Avatar,
  Button,
  Callout,
  ControlledModalDialog,
  DataGrid,
  IconButton,
  type DataGridColumn,
  DesignSystemProvider,
  InspectorSheet,
  SelectField,
  TextAreaField,
  formatDate,
  useConfirmationDialog,
} from "@/design-system";
import { CRM_LEAD_TRANSITIONS, CRM_LEAD_STAGES, leadStage, leadStageLabel, type CrmLeadListItem, type CrmLeadStatus, type LeadsPageData } from "@/lib/crm/leads";
import styles from "./leads-page.module.css";
import theme from "./crm-workspace-colors.module.css";
import { LeadOptionsEditor } from "./lead-options-editor";
import { LeadFlowReport } from "./lead-flow-report";
import { LeadFormBuilder } from "./lead-form-builder";
import { LeadEnquiryForm } from "./lead-enquiry-form";
import { leadOptionLabel } from "@/lib/crm/lead-options";
import { LeadWorkbench, LinkedLeadWorkbench } from "./lead-workbench";
import { IntakeInbox, LeadRouting } from "./lead-operations";
import { LeadResponseSla } from "./lead-sla-policies";
import { LeadAssignmentDialog } from "./lead-assignment-dialog";
import { ActionDialog, type ActionSpec } from "./crm-workbench";
import { SourceChip } from "./source-chip";
import { autoAssignLeads, type AutoAssignmentProgress } from "@/lib/crm/auto-assign-leads";

const DUBAI_FORMAT = { locale: "en-GB", timeZone: "Asia/Dubai" };
const ACTIVE_STATUSES = new Set<CrmLeadStatus>(["new", "attempting_contact", "connected", "nurturing", "paused"]);
const LEAD_STAGES = CRM_LEAD_STAGES;
const stageLabel = leadStageLabel;
type LeadMove = { leadId: string; status: CrmLeadStatus };
export type EnquirySection = "leads" | "forms" | "options" | "reports" | "sla" | "assignment";
function humanize(value: string | null) {
  if (!value) return "Not set";
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function nextActionLabel(value: string | null, referenceTime: number, status: CrmLeadStatus) {
  if (!ACTIVE_STATUSES.has(status)) return { label: "No follow-up", overdue: false };
  if (!value) return { label: "Not scheduled", overdue: false };
  const date = new Date(value);
  const difference = date.getTime() - referenceTime;
  if (difference < 0) {
    const hours = Math.max(1, Math.round(Math.abs(difference) / 3_600_000));
    return { label: `${hours}h overdue`, overdue: true };
  }
  if (difference < 86_400_000) {
    const hours = Math.max(1, Math.round(difference / 3_600_000));
    return { label: `In ${hours}h`, overdue: false };
  }
  return {
    label: formatDate(date, DUBAI_FORMAT, { day: "numeric", month: "short" }),
    overdue: false,
  };
}

function responseMessage(response: Response, fallback: string) {
  return response.json()
    .then((payload: { message?: string } | null) => payload?.message ?? fallback)
    .catch(() => fallback);
}

export function LeadsPage({ initialData: serverData, initialLeadId, initialCreate = false, initialSection = "leads" }: { initialData: LeadsPageData; initialLeadId?: string; initialCreate?: boolean; initialSection?: EnquirySection }) {
  const router = useRouter();
  const [formDirty, setFormDirty] = useState(false);
  const [leadOptions, setLeadOptions] = useState(serverData.leadOptions);
  const initialData = { ...serverData, leadOptions };
  const [linkedLead, setLinkedLead] = useState(initialLeadId);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [items, setItems] = useState(initialData.items);
  const [nextCursor, setNextCursor] = useState(initialData.nextCursor);
  const [leadView, setLeadView] = useState("all");
  const [savingLeadId, setSavingLeadId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<LeadMove | null>(null);
  const [qualificationLead, setQualificationLead] = useState<CrmLeadListItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mutationInFlight = useRef(false);
  const [cardLead, setCardLead] = useState<CrmLeadListItem | null>(null);
  const [createOpen, setCreateOpen] = useState(initialCreate);
  const [leadTool, setLeadTool] = useState<"intake" | null>(null);
  const activeSection = initialSection;
  const [assignment, setAssignment] = useState<CrmLeadListItem | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState("");
  const [followUp, setFollowUp] = useState<ActionSpec | null>(null);
  const [autoProgress, setAutoProgress] = useState<AutoAssignmentProgress | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const referenceTime = Date.parse(initialData.referenceTime);

  const openSection = (section: EnquirySection) => {
    if (section === activeSection) return;
    const navigate = () => router.push(section === "leads" ? "/workspace/crm/leads" : `/workspace/crm/leads?section=${section}`);
    if (formDirty) {
      requestConfirmation({ title: "Discard unsaved changes?", body: "Your current enquiry configuration has not been saved.", confirmLabel: "Discard changes", onConfirm: navigate });
      return;
    }
    navigate();
  };

  const visibleItems = useMemo(() => items.filter(lead => leadView === 'unassigned' ? !lead.ownerMembershipId && !lead.isConverted && ACTIVE_STATUSES.has(lead.status) : leadView === 'qualified' ? lead.status === 'qualified' : true), [items, leadView]);
  const sources = useMemo(() => [...new Set(items.map(lead => lead.source))].sort(), [items]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setFailure("");
    try {
      const query = new URLSearchParams({ workspaceId: initialData.workspaceId, cursor: nextCursor });
      const response = await fetch(`/api/workspace/crm/leads?${query}`);
      if (!response.ok) throw new Error(await responseMessage(response, "More leads could not be loaded."));
      const page = await response.json() as { data: CrmLeadListItem[]; nextCursor: string | null };
      setItems((current) => [...current, ...page.data.filter((lead) => !current.some((item) => item.id === lead.id))]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "More leads could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  };

  const reloadLeads = async (focusLeadId?: string) => {
    const query = new URLSearchParams({ workspaceId: initialData.workspaceId });
    const response = await fetch(`/api/workspace/crm/leads?${query}`);
    if (!response.ok) throw new Error(await responseMessage(response, "Leads could not be refreshed."));
    const page = await response.json() as { data: CrmLeadListItem[]; nextCursor: string | null };
    setItems(page.data);
    setNextCursor(page.nextCursor);
    if (focusLeadId) setCardLead(page.data.find((lead) => lead.id === focusLeadId) ?? null);
  };

  const refresh = async () => {
    setRefreshing(true);
    setFailure("");
    try { await reloadLeads(); setStatusMessage("Leads refreshed."); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Leads could not be refreshed."); }
    finally { setRefreshing(false); }
  };

  const saveMove = async (move: LeadMove, details: { reason?: string; nextActionAt?: string } = {}) => {
    const lead = items.find((item) => item.id === move.leadId);
    if (!lead || lead.isConverted || mutationInFlight.current || refreshing || loadingMore || leadStage(lead.status) === move.status) return;
    if (!CRM_LEAD_TRANSITIONS[lead.status].includes(move.status)) {
      setFailure(`This enquiry cannot move from ${stageLabel(lead.status)} to ${stageLabel(move.status)}.`);
      return;
    }
    mutationInFlight.current = true;
    setSavingLeadId(lead.id);
    setFailure("");
    setStatusMessage("");
    try {
      const response = await fetch(`/api/workspace/crm/leads/${lead.id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: initialData.workspaceId, version: lead.version, status: move.status, ...details }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The stage could not be saved. Try again."));
      const saved = await response.json() as Pick<CrmLeadListItem, "status" | "version" | "nextActionAt" | "updatedAt">;
      // Keep list-only contact/enquiry fields and previously loaded pages intact.
      setItems((current) => current.map((item) => item.id === lead.id ? { ...item, status: saved.status, version: saved.version, nextActionAt: saved.nextActionAt, updatedAt: saved.updatedAt ?? item.updatedAt } : item));
      setPendingMove(null);
      setStatusMessage(`${lead.partyName} moved to ${stageLabel(saved.status)}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The stage could not be saved.";
      setFailure(message);
      throw new Error(message);
    } finally {
      mutationInFlight.current = false;
      setSavingLeadId(null);
    }
  };

  const requestMove = (leadId: string, status: CrmLeadStatus) => {
    const lead = items.find((item) => item.id === leadId);
    if (!lead || lead.isConverted || leadStage(lead.status) === status || mutationInFlight.current || pendingMove || refreshing || loadingMore) return;
    if (!CRM_LEAD_TRANSITIONS[lead.status].includes(status)) {
      setFailure(`This enquiry cannot move from ${stageLabel(lead.status)} to ${stageLabel(status)}.`);
      return;
    }
    setFailure("");
    if (status === "qualified") {
      setQualificationLead(lead);
      return;
    }
    if (status === "disqualified" || (ACTIVE_STATUSES.has(status) && !lead.ownerMembershipId && !lead.nextActionAt)) {
      setPendingMove({ leadId, status });
    } else {
      void saveMove({ leadId, status }).catch(() => { /* The inline alert retains the original lead on failure. */ });
    }
  };
  const applyAssignment = (saved: CrmLeadListItem) => {
    setItems((current) => current.map((lead) => lead.id === saved.id ? {
      ...lead, ...saved,
      ownerName: initialData.members.find((member) => member.id === saved.ownerMembershipId)?.displayName ?? null,
      queueName: initialData.queues.find((queue) => queue.id === saved.queueId)?.name ?? lead.queueName,
    } : lead));
  };
  const runAutoAssign = async (lead?: CrmLeadListItem) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setAutoBusy(true); setFailure("");
    setAutoProgress({ total: 0, completed: 0, assigned: 0, remaining: [] });
    try {
      const result = await autoAssignLeads(initialData.workspaceId, lead ? [lead] : undefined, setAutoProgress, applyAssignment);
      setAutoProgress(result);
      setStatusMessage(`${result.assigned} enquir${result.assigned === 1 ? "y" : "ies"} assigned.`);
      // Reload list-only names and leads that were outside the loaded page.
      try { await reloadLeads(); } catch { setFailure("Assignment finished. Refresh to load the latest lead list."); }
    } catch (error) { setFailure(error instanceof Error ? error.message : "Auto-assignment could not finish. Refresh before trying again."); }
    finally { mutationInFlight.current = false; setAutoBusy(false); }
  };
  const scheduleFollowUp = (lead: CrmLeadListItem) => setFollowUp({
    title: "Schedule follow-up", description: lead.partyName, path: "activities",
    initial: { leadId: lead.id, partyId: lead.partyId, ...(lead.ownerMembershipId ? { ownerMembershipId: lead.ownerMembershipId } : {}), type: "task", isNextAction: true, title: `Follow up with ${lead.partyName}`, dueAt: lead.nextActionAt },
    fields: [{ key: "title", label: "Title", required: true }, { key: "dueAt", label: "Follow-up (your local time)", type: "datetime-local", required: true }, { key: "description", label: "Notes", type: "textarea" }], submit: "Save follow-up",
  });
  const busy = Boolean(savingLeadId || refreshing || loadingMore || pendingMove || qualificationLead || autoBusy);
  const activePipelines = initialData.pipelines.filter((pipeline) => pipeline.status === "active");
  const defaultPipeline = activePipelines.find((pipeline) => pipeline.isDefault) ?? activePipelines[0];
  const activeMembers = initialData.members.filter((member) => member.status === "active");
  const qualificationBlocker = !defaultPipeline
    ? "Set up an active sales pipeline before qualifying an enquiry."
    : !activeMembers.length
      ? "Add an active workspace member before qualifying an enquiry."
      : undefined;
  const qualificationAction: ActionSpec | null = qualificationLead ? {
    title: qualificationLead.status === "qualified" ? "Create opportunity" : "Qualify enquiry",
    path: `leads/${qualificationLead.id}/qualify`,
    blockedReason: qualificationBlocker,
    initial: {
      partyId: qualificationLead.partyId,
      leadVersion: qualificationLead.version,
      pipelineId: defaultPipeline?.id ?? "",
      ownerMembershipId: qualificationLead.ownerMembershipId ?? "",
      title: qualificationLead.title,
      nextActionAt: qualificationLead.nextActionAt ?? "",
    },
    fields: [
      { key: "title", label: "Opportunity name", required: true },
      { key: "pipelineId", label: "Pipeline", options: activePipelines.map((pipeline) => ({ id: pipeline.id, label: pipeline.name })), required: true },
      { key: "ownerMembershipId", label: "Sales owner", options: activeMembers.map((member) => ({ id: member.id, label: member.displayName })), required: true },
      { key: "nextActionAt", label: "Next follow-up", type: "datetime-local", required: true },
      { key: "expectedCloseAt", label: "Expected close", type: "datetime-local" },
      { key: "amount", label: "Value", type: "number", min: 0 },
      { key: "currencyCode", label: "Currency" },
    ],
    transform: ({ amount, currencyCode, ...values }) => {
      if ((amount === undefined) !== (currencyCode === undefined)) throw new Error("Add both a value and currency, or leave both blank.");
      return { ...values, ...(amount !== undefined ? { amount, currencyCode: String(currencyCode).toUpperCase() } : {}) };
    },
    submit: qualificationLead.status === "qualified" ? "Create opportunity" : "Qualify & create opportunity",
  } : null;
  const sourceLabel = (source: string) => initialData.leadOptions?.sources.find(option => option.id === source)?.label ?? humanize(source);
  const columns: DataGridColumn<CrmLeadListItem>[] = [
    { accessorKey: "partyName", header: "Customer", size: 200, meta: { headerIcon: <ContactRound size={14}/> }, cell: ({row:{original:lead}}) => <button type="button" className={styles.sheetLead} onClick={() => setCardLead(lead)} aria-label={`Open ${lead.partyName} — ${lead.title}`} title={lead.partyName}><Avatar name={lead.partyName} size="sm"/><span>{lead.partyName}</span></button> },
    { accessorKey: "reference", header: "Enquiry ref", size: 125, cell: ({row:{original:lead}}) => <button type="button" className={styles.referenceLink} onClick={() => setCardLead(lead)}>{lead.reference ?? "—"}</button> },
    { accessorKey: "title", header: "Enquiry title", size: 240, meta: { headerIcon: <Type size={14}/> }, cell: ({getValue}) => <span className={styles.sheetText} title={String(getValue())}>{String(getValue())}</span> },
    { id: "status", header: "Stage", size: 138, accessorFn: lead => stageLabel(lead.status), filterFn: "equalsString", meta: { headerIcon: <CheckCircle2 size={14}/>, filterOptions: LEAD_STAGES.map(stage=>({id:stage.label,label:stage.label})) }, cell: ({row:{original:lead}}) => <StatusSelect lead={lead} disabled={busy} onMove={requestMove} /> },
    { id: "source", header: "Source", size: 135, accessorFn: lead => sourceLabel(lead.source), filterFn: "equalsString", meta: { headerIcon: <Globe size={14}/>, filterOptions: sources.map(source=>({id:sourceLabel(source),label:sourceLabel(source)})) }, cell: ({row:{original:lead}}) => <SourceChip source={lead.source} displayLabel={sourceLabel(lead.source)} /> },
    { id: "channel", header: "Channel", size: 140, accessorFn: lead => initialData.leadOptions?.channels[lead.source]?.find(option => option.id === lead.channel)?.label ?? humanize(lead.channel), meta: { headerIcon: <Globe size={14}/> } },
    { id: "intakeMethod", header: "Intake method", size: 130, accessorFn: lead => humanize(lead.intakeMethod ?? null) },
    { id: "serviceType", header: "Enquiry type", size: 195, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.enquiryTypes, lead.serviceType), meta: { headerIcon: <BriefcaseBusiness size={14}/> } },
    { accessorKey: "ownerName", header: "Sales owner", size: 185, meta: { headerIcon: <UsersRound size={14}/> }, cell: ({row:{original:lead}}) => <div className={styles.managerCell}><button type="button"
      aria-label={`Assign ${lead.partyName}`} title={lead.ownerName ? `${lead.ownerName} · Reassign` : "Choose sales owner"}
      className={styles.assigneeButton} disabled={busy || lead.isConverted || ["qualified", "disqualified"].includes(lead.status)} onClick={() => setAssignment(lead)}>
      {lead.ownerName ? <Avatar name={lead.ownerName} size="sm" /> : <UserRoundPlus aria-hidden="true" size={16} />}
      {lead.ownerName ? <span>{lead.ownerName}</span> : null}
    </button>{!lead.ownerMembershipId && ACTIVE_STATUSES.has(lead.status) && !lead.isConverted ? <Button size="compact" isDisabled={busy} onPress={() => void runAutoAssign(lead)} aria-label={`Auto-assign ${lead.partyName}`}>Auto-assign</Button> : !lead.ownerMembershipId ? <span>Unassigned</span> : null}</div> },
    { accessorKey: "nextActionAt", header: "Next follow-up", size: 175, meta: { headerIcon: <CalendarClock size={14}/> }, cell: ({row:{original:lead}}) => {
      if (lead.status === "qualified") return <Link className={styles.preProjectLink} href={`/workspace/pre-projects?search=${encodeURIComponent(lead.title)}`}>Open Pre-execution <span aria-hidden="true">↗</span></Link>;
      const action = nextActionLabel(lead.nextActionAt, referenceTime, lead.status);
      return <Button size="compact" className={styles.nextAction} data-overdue={action.overdue || undefined} isDisabled={busy || lead.isConverted || ["qualified", "disqualified"].includes(lead.status)} aria-label={`Follow up with ${lead.partyName}`} onPress={() => scheduleFollowUp(lead)}><CalendarClock size={14} aria-hidden="true" />{lead.nextActionAt ? action.label : "Follow up"}</Button>;
    } },
    { id: "priority", header: "Priority", size: 120, accessorFn: lead => humanize(lead.priority), meta: { headerIcon: <ListFilter size={14}/> } },
    { id: "budgetRange", header: "Budget range", size: 180, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.budgetRanges, lead.details?.budgetRange) },
    { id: "customerType", header: "Customer type", size: 140, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.customerTypes, lead.details?.customerType) },
    { id: "location", header: "Property location", size: 190, accessorFn: lead => lead.details?.location ?? "" },
    { id: "campaign", header: "Campaign", size: 160, accessorFn: lead => lead.details?.campaign ?? "" },
    { accessorKey: "updatedAt", header: "Last updated", size: 150, cell: ({row:{original:lead}}) => formatDate(new Date(lead.updatedAt), DUBAI_FORMAT, {day:'numeric',month:'short',year:'numeric'}) },
    { accessorKey: "createdAt", header: "Created", size: 150, meta: { headerIcon: <CalendarDays size={14}/> }, cell: ({row:{original:lead}}) => formatDate(new Date(lead.createdAt), DUBAI_FORMAT, {day:'numeric',month:'short',year:'numeric'}) },
  ];
  const pendingLead = pendingMove ? items.find((lead) => lead.id === pendingMove.leadId) : undefined;
  const workspaceArea = activeSection === "leads" ? "work" : activeSection === "forms" || activeSection === "options" ? "capture" : activeSection === "assignment" || activeSection === "sla" ? "response" : "performance";
  const sectionCopy: Record<typeof workspaceArea, { title: string; description: string }> = {
    work: { title: "Enquiries", description: "Review every enquiry, assign an owner and keep the next action clear." },
    capture: { title: "Capture", description: "Build customer forms and maintain the answer choices used across every channel." },
    response: { title: "Routing & response", description: "Send each enquiry to the right team and protect the promised response time." },
    performance: { title: "Performance", description: "Find slow, unassigned or stale enquiries before they are lost." },
  };

  return <DesignSystemProvider className={`${styles.provider} ${theme.theme}`} portalContainer={portalContainer} ref={setPortalContainer}>
    <section aria-label="Enquiries workspace" className={styles.page}>
      <header className={styles.workspaceHeader}>
        <div><h1>{sectionCopy[workspaceArea].title}</h1><p>{sectionCopy[workspaceArea].description}</p></div>
        <nav className={styles.workspaceNav} aria-label="Enquiry workspace">
          <button type="button" data-active={workspaceArea === "work" || undefined} aria-current={workspaceArea === "work" ? "page" : undefined} onClick={() => openSection("leads")}><ContactRound size={15}/><span>Work queue</span></button>
          <button type="button" data-active={workspaceArea === "capture" || undefined} aria-current={workspaceArea === "capture" ? "page" : undefined} onClick={() => openSection("forms")}><FileInput size={15}/><span>Capture</span></button>
          <button type="button" data-active={workspaceArea === "response" || undefined} aria-current={workspaceArea === "response" ? "page" : undefined} onClick={() => openSection("assignment")}><Gauge size={15}/><span>Routing & response</span></button>
          <button type="button" data-active={workspaceArea === "performance" || undefined} aria-current={workspaceArea === "performance" ? "page" : undefined} onClick={() => openSection("reports")}><Activity size={15}/><span>Performance</span></button>
        </nav>
      </header>

      {workspaceArea === "capture" ? <nav className={styles.subnav} aria-label="Capture settings"><button type="button" data-active={activeSection === "forms" || undefined} onClick={() => openSection("forms")}>Forms</button><button type="button" data-active={activeSection === "options" || undefined} onClick={() => openSection("options")}>Answer choices</button></nav> : null}
      {workspaceArea === "response" ? <nav className={styles.subnav} aria-label="Routing and response settings"><button type="button" data-active={activeSection === "assignment" || undefined} onClick={() => openSection("assignment")}>Routing & capacity</button><button type="button" data-active={activeSection === "sla" || undefined} onClick={() => openSection("sla")}>Response targets</button></nav> : null}

      {!initialData.canView ? <Callout title="Enquiry access is restricted" tone="warning">Ask a workspace owner or administrator for CRM enquiry access.</Callout> : <>
        {linkedLead ? <InspectorSheet isOpen title="Enquiry details" size="md" onOpenChange={(open) => { if (!open) setLinkedLead(undefined); }}><LinkedLeadWorkbench leadId={linkedLead} initialData={initialData} onChanged={() => reloadLeads()} onQualify={setQualificationLead} /></InspectorSheet> : null}
        {failure ? <Callout title="Enquiries could not be updated" tone="danger">{failure}</Callout> : null}
        {statusMessage ? <p aria-live="polite" className={styles.statusMessage}>{statusMessage}</p> : null}

        <div className={styles.sections}>
          {activeSection === "leads" ? <>
        <section aria-label="All enquiries" className={`${styles.boardRegion} ${styles.sheet}`}>
          <DataGrid key={initialData.workspaceId} ariaLabel="CRM enquiries" columns={columns} data={visibleItems} getRowId={lead => lead.id}
            initialColumnVisibility={{priority:false,createdAt:false,updatedAt:false,budgetRange:false,customerType:false,location:false,campaign:false}} searchLabel="Search enquiries" exportFileName="enquiries.csv"
            savedViews={[{id:'all',label:'All enquiries'},{id:'unassigned',label:'Unassigned'},{id:'qualified',label:'Qualified'}]} selectedView={leadView} onViewChange={setLeadView}
            onRowAction={setCardLead} pageSize={50} hasMoreRows={Boolean(nextCursor)} totalRowCount={items.length}
            emptyTitle="No matching enquiries" emptyDescription="Change the view or filters, or add an enquiry."
            toolbarActions={<><Button size="compact" variant="quiet" isDisabled={busy} onPress={() => void runAutoAssign()}><WandSparkles size={14} aria-hidden="true"/>Assign unassigned</Button><Button size="compact" variant="primary" onPress={() => setCreateOpen(true)}><Plus size={14} aria-hidden="true"/>Add enquiry</Button></>}
            footerActions={<><Button size="compact" variant="quiet" onPress={() => setLeadTool("intake")}>Incoming enquiries</Button>{nextCursor ? <Button isDisabled={busy} isLoading={loadingMore} onPress={() => void loadMore()} size="compact">Load more enquiries</Button> : null}<IconButton aria-label="Refresh enquiries" onPress={() => void refresh()} isDisabled={busy} size="compact"><RefreshCw size={14} aria-hidden="true"/></IconButton></>}
          />
        </section>
          </> : null}
          {activeSection === "forms" ? <LeadFormBuilder initialData={initialData} onDirtyChange={setFormDirty} /> : null}
          {activeSection === "options" ? <LeadOptionsEditor workspaceId={initialData.workspaceId} initialOptions={leadOptions} onSaved={setLeadOptions} onDirtyChange={setFormDirty} /> : null}
          {activeSection === "reports" ? <LeadFlowReport initialData={initialData} /> : null}
          {activeSection === "sla" ? <LeadResponseSla initialData={initialData} /> : null}
          {activeSection === "assignment" ? <LeadRouting initialData={initialData} /> : null}
        </div>

        {cardLead ? <InspectorSheet isOpen onOpenChange={(open) => { if (!open) setCardLead(null); }} size="md" title={cardLead.partyName}><LeadWorkbench initialData={initialData} key={cardLead.id} lead={items.find((item) => item.id === cardLead.id) ?? cardLead} onChanged={() => reloadLeads()} onQualify={setQualificationLead} /></InspectorSheet> : null}
        {pendingMove && pendingLead ? <MoveLeadDialog lead={pendingLead} move={pendingMove} saving={Boolean(savingLeadId)} onClose={() => setPendingMove(null)} onSave={(details) => saveMove(pendingMove, details)} /> : null}
        {qualificationLead && qualificationAction ? <ActionDialog workspaceId={initialData.workspaceId} action={qualificationAction} onClose={() => setQualificationLead(null)} onSaved={async () => {
          setQualificationLead(null);
          setStatusMessage(`${qualificationLead.partyName} qualified and created an opportunity.`);
          try { await reloadLeads(); }
          catch { setFailure("The opportunity was created. Refresh Enquiries to load its latest status."); }
        }} /> : null}

        {createOpen ? <LeadEnquiryForm initialData={initialData} onClose={() => setCreateOpen(false)} onDuplicate={() => { setCreateOpen(false); setLeadTool("intake"); }} onSaved={async (leadId) => {
          await reloadLeads(leadId);
          setCreateOpen(false);
          setStatusMessage("Enquiry created.");
        }} /> : null}


        {assignment ? <LeadAssignmentDialog workspaceId={initialData.workspaceId} lead={assignment} members={initialData.members} onClose={() => setAssignment(null)} onSaved={(result) => {
          const saved = result as unknown as Pick<CrmLeadListItem, "id" | "ownerMembershipId" | "queueId" | "nextActionAt" | "version" | "status" | "updatedAt">;
          if (!saved.id || !Number.isInteger(saved.version)) throw new Error("Assignment response could not be confirmed.");
          setItems((current) => current.map((lead) => lead.id === saved.id ? {
            ...lead, ...saved,
            ownerName: initialData.members.find((member) => member.id === saved.ownerMembershipId)?.displayName ?? null,
            queueName: initialData.queues.find((queue) => queue.id === saved.queueId)?.name ?? lead.queueName,
          } : lead));
          setStatusMessage(saved.ownerMembershipId ? "Assignment updated." : "No available sales owner. The enquiry remains in its queue.");
        }} /> : null}
        {followUp ? <ActionDialog workspaceId={initialData.workspaceId} action={followUp} onClose={() => setFollowUp(null)} onSaved={async () => { await reloadLeads(); setStatusMessage("Follow-up scheduled."); }} /> : null}
        {autoProgress ? <ControlledModalDialog isOpen title="Auto-assignment" isDismissable={!autoBusy} onOpenChange={(open) => { if (!open && !autoBusy) setAutoProgress(null); }} footer={<div className={styles.dialogActions}>{!autoBusy && autoProgress.remaining.length ? <Button onPress={() => { setAutoProgress(null); openSection("assignment"); }}>Manage sales owners</Button> : null}<Button isDisabled={autoBusy} onPress={() => setAutoProgress(null)}>Done</Button></div>}>
          <div className={styles.leadForm}>
            <p role="status">{autoBusy ? autoProgress.total ? `Assigning ${autoProgress.completed} of ${autoProgress.total} enquiries…` : "Checking unassigned active enquiries…" : `${autoProgress.assigned} of ${autoProgress.total} enquiries assigned.`}</p>
            {failure ? <Callout title="Assignment needs attention" tone="warning">{failure}</Callout> : null}
            {!autoBusy && !failure && !autoProgress.total ? <p>No unassigned active enquiries.</p> : null}
            {autoProgress.remaining.length ? <><p>These enquiries still need a sales owner. Check availability and capacity in Auto-assignment.</p><ul className={styles.assignmentResults}>{autoProgress.remaining.map((item) => <li key={item.id}><strong>{item.name}</strong><span>{item.reason}</span></li>)}</ul></> : null}
          </div>
        </ControlledModalDialog> : null}
        {leadTool ? <ControlledModalDialog isOpen onOpenChange={(open) => { if (!open) setLeadTool(null); }} size="lg" title="Review incoming enquiries"><IntakeInbox workspaceId={initialData.workspaceId} onChanged={() => reloadLeads()} /></ControlledModalDialog> : null}
        {confirmationDialog}
      </>}
    </section>
  </DesignSystemProvider>;
}

function StatusSelect({ lead, disabled, onMove }: { lead: CrmLeadListItem; disabled: boolean; onMove: (id: string, status: CrmLeadStatus) => void }) {
  return <div className={styles.statusSelect} data-status={leadStage(lead.status)} data-grid-interactive>
    <SelectField label={<span className="wd-visually-hidden">Stage for {lead.partyName}</span>} aria-label={`Stage for ${lead.partyName}`} isDisabled={disabled || lead.isConverted} selectedKey={leadStage(lead.status)} onSelectionChange={(key) => { if (key) onMove(lead.id, String(key) as CrmLeadStatus); }} items={LEAD_STAGES.filter((stage) => stage.id === leadStage(lead.status) || CRM_LEAD_TRANSITIONS[lead.status].includes(stage.id)).map((stage) => ({ id: stage.id, label: stage.label }))} />
  </div>;
}

function MoveLeadDialog({ lead, move, saving, onClose, onSave }: { lead: CrmLeadListItem; move: LeadMove; saving: boolean; onClose: () => void; onSave: (details: { reason?: string; nextActionAt?: string }) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const needsReason = move.status === "disqualified";
  const needsDate = ACTIVE_STATUSES.has(move.status) && !lead.ownerMembershipId && !lead.nextActionAt;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (needsReason && !reason.trim()) { setError("Add a short reason for this change."); return; }
    if (needsDate && (!date || Number.isNaN(Date.parse(date)))) { setError("Choose the next follow-up date and time."); return; }
    try { await onSave({ ...(needsReason ? { reason: reason.trim() } : {}), ...(needsDate ? { nextActionAt: new Date(date).toISOString() } : {}) }); }
    catch (error) { setError(error instanceof Error ? error.message : "The lead could not be moved."); }
  };
  return <ControlledModalDialog isOpen onOpenChange={(open) => { if (!open && !saving) onClose(); }} title={`Move to ${stageLabel(move.status)}`} size="md">
    <form className={styles.leadForm} onSubmit={submit}>
      <p className={styles.muted}>{lead.partyName} · {lead.title}</p>
      {needsReason ? <TextAreaField label="Reason" isRequired maxLength={160} value={reason} onChange={setReason} placeholder="Briefly explain this stage change…" /> : null}
      {needsDate ? <label className={styles.followUpField}><span>Next follow-up</span><input type="datetime-local" required value={date} onChange={(event) => setDate(event.target.value)} /><small>An unassigned active enquiry needs a follow-up date.</small></label> : null}
      {error ? <Callout title="Stage not saved" tone="danger">{error}</Callout> : null}
      <div className={styles.dialogActions}><Button onPress={onClose} isDisabled={saving}>Cancel</Button><Button type="submit" variant="primary" isLoading={saving}>Save stage</Button></div>
    </form>
  </ControlledModalDialog>;
}
