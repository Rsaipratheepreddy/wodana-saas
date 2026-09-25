"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarClock, CalendarDays, CheckCircle2, BriefcaseBusiness, ContactRound, FileInput, Globe, ListFilter, Plus, RefreshCw, Type, UserRoundPlus, UsersRound } from "lucide-react";
import {
  Button,
  Callout,
  DataGrid,
  IconButton,
  InspectorSheet,
  type DataGridColumn,
  DesignSystemProvider,
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
import { LeadFormBuilder, type LeadFormBranding } from "./lead-form-builder";
import { LeadEnquiryForm } from "./lead-enquiry-form";
import { hasResolvedEnquiryType, leadOptionLabel } from "@/lib/crm/lead-options";
import { LeadWorkbench, LinkedLeadWorkbench } from "./lead-workbench";
import { IntakeInbox, LeadRouting } from "./lead-operations";
import { LeadImportDialog } from "./lead-import-dialog";
import { LeadResponseSla } from "./lead-sla-policies";
import { LeadAssignmentDialog } from "./lead-assignment-dialog";
import { CreateDealDialog } from "./create-deal-dialog";
import { CrmDateTimeField } from "./crm-date-time-field";
import { NewFollowUpDialog } from "./follow-up-editor";
import { SourceChip } from "./source-chip";
import { autoAssignLeads, type AutoAssignmentProgress } from "@/lib/crm/auto-assign-leads";
import { customerDisplayName } from "@/lib/crm/customer-name";
import { formAnswerColumns, formAnswerValue } from "@/lib/crm/form-answer-columns";
import type { IntegrationsPageData } from "@/lib/workspace/integrations";
import { IntegrationsPage } from "@/components/workspace/integrations-page";

const LOCAL_FORMAT = { locale: "en-GB", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
const ACTIVE_STATUSES = new Set<CrmLeadStatus>(["new", "attempting_contact", "connected", "nurturing", "paused"]);
const LEAD_STAGES = CRM_LEAD_STAGES;
const stageLabel = leadStageLabel;
type LeadMove = { leadId: string; status: CrmLeadStatus };
export type EnquirySection = "leads" | "forms" | "sources" | "options" | "reports" | "sla" | "assignment";
function humanize(value: string | null) {
  if (!value) return "Not set";
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function PersonAvatar({ name }: { name: string }) {
  const palette = [["#e3eafa", "#334f8a"], ["#f5e5d6", "#8b542b"], ["#ece3f7", "#6a438a"], ["#dceeed", "#286763"], ["#f5dfe7", "#8b3d5d"]];
  const hash = [...name].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0);
  const [background, color] = palette[hash % palette.length];
  return <span aria-hidden="true" className={styles.personAvatar} style={{ background, color }}>{name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase()}</span>;
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
    label: formatDate(date, LOCAL_FORMAT, { day: "numeric", month: "short" }),
    overdue: false,
  };
}

function responseMessage(response: Response, fallback: string) {
  return response.json()
    .then((payload: { message?: string } | null) => payload?.message ?? fallback)
    .catch(() => fallback);
}

export function LeadsPage({ initialData: serverData, integrationsData, formBranding, initialLeadId, initialCreate = false, initialSection = "leads" }: { initialData: LeadsPageData; integrationsData?: IntegrationsPageData; formBranding?: LeadFormBranding; initialLeadId?: string; initialCreate?: boolean; initialSection?: EnquirySection }) {
  const router = useRouter();
  const [formDirty, setFormDirty] = useState(false);
  const [formEditing, setFormEditing] = useState(false);
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
  const [importOpen, setImportOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const activeSection = initialSection;
  const [assignment, setAssignment] = useState<CrmLeadListItem | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState("");
  const [followUp, setFollowUp] = useState<CrmLeadListItem | null>(null);
  const [autoProgress, setAutoProgress] = useState<AutoAssignmentProgress | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const referenceTime = Date.parse(serverData.referenceTime);

  const openSection = (section: EnquirySection) => {
    if (section === activeSection) return;
    const navigate = () => router.push(section === "leads" ? "/workspace/crm/leads" : `/workspace/crm/leads?section=${section}`);
    if (formDirty) {
      requestConfirmation({ title: "Discard unsaved changes?", body: "Your current enquiry configuration has not been saved.", confirmLabel: "Discard changes", onConfirm: navigate });
      return;
    }
    navigate();
  };

  const visibleItems = useMemo(() => items.filter(lead => {
    const active = ACTIVE_STATUSES.has(lead.status) && !lead.isConverted;
    if (leadView === "mine") return lead.ownerMembershipId === serverData.currentMembershipId;
    if (leadView === "unassigned") return active && !lead.ownerMembershipId;
    if (leadView === "attention") return active && (!lead.ownerMembershipId || !lead.nextActionAt || Date.parse(lead.nextActionAt) < referenceTime);
    if (leadView === "qualified") return lead.status === "qualified";
    return true;
  }), [items, leadView, serverData.currentMembershipId, referenceTime]);
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
      setStatusMessage(`${customerDisplayName(lead.partyName)} moved to ${stageLabel(saved.status)}.`);
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
      if (hasResolvedEnquiryType(lead.serviceType)) setQualificationLead(lead);
      else setCardLead(lead);
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
      setStatusMessage("");
      // Reload list-only names and leads that were outside the loaded page.
      try { await reloadLeads(); } catch { setFailure("Assignment finished. Refresh to load the latest lead list."); }
    } catch (error) { setFailure(error instanceof Error ? error.message : "Auto-assignment could not finish. Refresh before trying again."); }
    finally { mutationInFlight.current = false; setAutoBusy(false); }
  };
  const scheduleFollowUp = (lead: CrmLeadListItem) => setFollowUp(lead);
  const busy = Boolean(savingLeadId || refreshing || loadingMore || pendingMove || qualificationLead || autoBusy);
  const sourceLabel = (source: string) => initialData.leadOptions?.sources.find(option => option.id === source)?.label ?? humanize(source);
  const customFormColumns = useMemo(() => formAnswerColumns(items), [items]);
  const columns: DataGridColumn<CrmLeadListItem>[] = [
    { accessorKey: "reference", header: "Enquiry ID", size: 125, cell: ({row:{original:lead}}) => <button type="button" className={styles.referenceLink} onClick={() => setCardLead(lead)}>{lead.reference ?? "—"}</button> },
    { accessorKey: "partyName", header: "Customer", size: 220, meta: { headerIcon: <ContactRound size={14}/> }, cell: ({row:{original:lead}}) => { const name = customerDisplayName(lead.partyName); return <button type="button" className={styles.sheetLead} onClick={() => setCardLead(lead)} aria-label={`Open ${name}`} title={name}><PersonAvatar name={name} /><span className={styles.clientRequest}><strong>{name}</strong></span></button>; } },
    { accessorKey: "title", header: "Enquiry title", size: 240, meta: { headerIcon: <Type size={14}/> }, cell: ({getValue}) => <span className={styles.sheetText} title={String(getValue())}>{String(getValue())}</span> },
    { id: "status", header: "Stage", size: 138, accessorFn: lead => stageLabel(lead.status), filterFn: "equalsString", meta: { headerIcon: <CheckCircle2 size={14}/>, filterOptions: LEAD_STAGES.map(stage=>({id:stage.label,label:stage.label})) }, cell: ({row:{original:lead}}) => <StatusSelect lead={lead} disabled={busy} onMove={requestMove} /> },
    { id: "source", header: "Source", size: 220, accessorFn: lead => sourceLabel(lead.source), filterFn: "equalsString", meta: { headerIcon: <Globe size={14}/>, filterOptions: sources.map(source=>({id:sourceLabel(source),label:sourceLabel(source)})) }, cell: ({row:{original:lead}}) => <SourceChip source={lead.source} displayLabel={sourceLabel(lead.source)} /> },
    { id: "channel", header: "Channel", size: 140, accessorFn: lead => initialData.leadOptions?.channels[lead.source]?.find(option => option.id === lead.channel)?.label ?? humanize(lead.channel), meta: { headerIcon: <Globe size={14}/> } },
    { id: "intakeMethod", header: "Captured via", size: 145, accessorFn: lead => humanize(lead.intakeMethod ?? null), cell: ({ row }) => <span className={styles.intakeChip}>{humanize(row.original.intakeMethod ?? null)}</span> },
    { id: "serviceType", header: "Service required", size: 195, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.enquiryTypes, lead.serviceType), cell: ({ row }) => <span className={styles.serviceChip} data-missing={!hasResolvedEnquiryType(row.original.serviceType) || undefined}>{!hasResolvedEnquiryType(row.original.serviceType) ? "To confirm" : leadOptionLabel(initialData.leadOptions?.enquiryTypes, row.original.serviceType)}</span>, meta: { headerIcon: <BriefcaseBusiness size={14}/> } },
    { accessorKey: "ownerName", header: "Assigned to", size: 230, meta: { headerIcon: <UsersRound size={14}/> }, cell: ({row:{original:lead}}) => <div className={styles.managerCell}><button type="button"
      aria-label={`Assign ${customerDisplayName(lead.partyName)}`} title={lead.ownerName ? `${lead.ownerName} · Reassign` : "Choose sales owner"}
      className={styles.assigneeButton} disabled={busy || lead.isConverted || ["qualified", "disqualified"].includes(lead.status)} onClick={() => setAssignment(lead)}>
      {lead.ownerName ? <PersonAvatar name={lead.ownerName} /> : <UserRoundPlus aria-hidden="true" size={16} />}
      <span>{lead.ownerName ?? "Unassigned"}</span>
    </button>{!lead.ownerMembershipId && ACTIVE_STATUSES.has(lead.status) && !lead.isConverted ? <Button size="compact" isDisabled={busy} onPress={() => void runAutoAssign(lead)} aria-label={`Auto-assign ${customerDisplayName(lead.partyName)}`}>Auto</Button> : null}</div> },
    { accessorKey: "nextActionAt", header: "Next follow-up", size: 160, meta: { headerIcon: <CalendarClock size={14}/> }, cell: ({row:{original:lead}}) => {
      if (lead.status === "qualified") return <Button size="compact" variant="quiet" onPress={() => setCardLead(lead)}>View linked records</Button>;
      const action = nextActionLabel(lead.nextActionAt, referenceTime, lead.status);
      return <Button size="compact" className={styles.nextAction} data-overdue={action.overdue || undefined} isDisabled={busy || lead.isConverted || ["qualified", "disqualified"].includes(lead.status)} aria-label={`Follow up with ${customerDisplayName(lead.partyName)}`} onPress={() => scheduleFollowUp(lead)}><CalendarClock size={14} aria-hidden="true" />{lead.nextActionAt ? action.label : "Schedule"}</Button>;
    } },
    { id: "priority", header: "Priority", size: 120, accessorFn: lead => humanize(lead.priority), meta: { headerIcon: <ListFilter size={14}/> } },
    { id: "budgetRange", header: "Budget range", size: 180, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.budgetRanges, lead.details?.budgetRange) },
    { id: "customerType", header: "Customer type", size: 140, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.customerTypes, lead.details?.customerType) },
    { id: "emirate", header: "Emirate", size: 160, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.emirates, lead.details?.emirate), filterFn: "equalsString", meta: { filterOptions: (initialData.leadOptions?.emirates ?? []).map(option => ({ id: option.label, label: option.label })) } },
    { id: "area", header: "Area / city", size: 190, accessorFn: lead => lead.details?.area ?? lead.details?.location ?? "" },
    { id: "campaign", header: "Campaign", size: 160, accessorFn: lead => lead.details?.campaign ?? "" },
    ...customFormColumns.map(column => ({ id: column.id, header: column.title, size: 190, accessorFn: (lead: CrmLeadListItem) => formAnswerValue(lead, column), cell: ({ getValue }: { getValue: () => unknown }) => <span className={styles.sheetText} title={String(getValue())}>{String(getValue())}</span> })),
    { accessorKey: "updatedAt", header: "Last updated", size: 120, cell: ({row:{original:lead}}) => formatDate(new Date(lead.updatedAt), LOCAL_FORMAT, {day:'numeric',month:'short',year:'numeric'}) },
    { accessorKey: "createdAt", header: "Created", size: 150, meta: { headerIcon: <CalendarDays size={14}/> }, cell: ({row:{original:lead}}) => formatDate(new Date(lead.createdAt), LOCAL_FORMAT, {day:'numeric',month:'short',year:'numeric'}) },
    { id: "dealAction", header: "Opportunity", size: 190, enableSorting: false, cell: ({ row: { original: lead } }) => lead.isConverted
      ? <Button size="compact" variant="quiet" onPress={() => setCardLead(lead)}>View opportunity</Button>
      : ["disqualified", "paused"].includes(lead.status) ? <span className={styles.sheetText}>—</span>
      : !hasResolvedEnquiryType(lead.serviceType) ? <Button size="compact" className={styles.createDeal} isDisabled={busy} aria-label={`Choose enquiry type for ${customerDisplayName(lead.partyName)}`} onPress={() => setCardLead(lead)}>Choose type</Button>
      : <Button size="compact" className={styles.createDeal} isDisabled={busy} aria-label={`Convert ${customerDisplayName(lead.partyName)} to opportunity`} onPress={() => setQualificationLead(lead)}>Convert</Button> },
  ];
  const pendingLead = pendingMove ? items.find((lead) => lead.id === pendingMove.leadId) : undefined;
  const workspaceArea = activeSection === "leads" ? "work" : activeSection === "forms" || activeSection === "sources" || activeSection === "options" ? "capture" : activeSection === "assignment" || activeSection === "sla" ? "response" : "performance";
  return <DesignSystemProvider className={`${styles.provider} ${theme.theme}`} portalContainer={portalContainer} ref={setPortalContainer}>
    <section aria-label="Enquiries workspace" className={styles.page}>


      {workspaceArea === "capture" && !(activeSection === "forms" && formEditing) ? <nav className={styles.subnav} aria-label="Capture settings"><button type="button" data-active={activeSection === "forms" || undefined} onClick={() => openSection("forms")}>Forms</button><button type="button" data-active={activeSection === "sources" || undefined} onClick={() => openSection("sources")}>Lead sources</button><button type="button" data-active={activeSection === "options" || undefined} onClick={() => openSection("options")}>Answer choices</button></nav> : null}
      {workspaceArea === "response" ? <nav className={styles.subnav} aria-label="Routing and response settings"><button type="button" data-active={activeSection === "assignment" || undefined} onClick={() => openSection("assignment")}>Routing & capacity</button><button type="button" data-active={activeSection === "sla" || undefined} onClick={() => openSection("sla")}>Response targets</button></nav> : null}

      {!initialData.canView ? <Callout title="Enquiry access is restricted" tone="warning">Ask a workspace owner or administrator for CRM enquiry access.</Callout> : <>
        {linkedLead ? <InspectorSheet isOpen title="Enquiry details" size="md" onOpenChange={(open) => { if (!open) setLinkedLead(undefined); }}><LinkedLeadWorkbench leadId={linkedLead} initialData={initialData} onChanged={() => reloadLeads()} onQualify={setQualificationLead} /></InspectorSheet> : null}
        {failure ? <Callout title="Enquiries could not be updated" tone="danger">{failure}</Callout> : null}
        {statusMessage ? <p aria-live="polite" className={styles.statusMessage}>{statusMessage}</p> : null}

        <div className={styles.sections}>
          {activeSection === "leads" ? <>
        <section data-sales-grid aria-label="All enquiries" className={`${styles.boardRegion} ${styles.sheet}`}>
          {autoProgress && <section className={styles.assignmentSummary} aria-label="Assignment results">
            <div className={styles.assignmentSummaryHeader}>
              <strong role="status">{autoBusy ? `Assigning enquiries… ${autoProgress.completed}/${autoProgress.total}` : autoProgress.remaining.length ? `${autoProgress.remaining.length} enquiries need an owner` : `${autoProgress.assigned} enquiries assigned`}</strong>
              {!autoBusy && <Button size="compact" variant="quiet" onPress={() => setAutoProgress(null)}>Dismiss</Button>}
            </div>
            {!autoBusy && autoProgress.remaining.length > 0 && <>
              <p>Choose an owner below, or configure automatic assignment in Sales settings.</p>
              <ul>{autoProgress.remaining.map(item => {
                const record = items.find(lead => lead.id === item.id);
                return <li key={item.id}><div><strong>{item.name}</strong><small>{item.reason.includes("policy") || item.reason.includes("fallback queue") ? "Automatic assignment is not configured." : item.reason}</small></div>
                  {record ? <Button size="compact" onPress={() => setAssignment(record)}>Choose owner</Button> : <Button size="compact" onPress={() => void reloadLeads()}>Refresh enquiries</Button>}
                </li>;
              })}</ul>
              <Button size="compact" variant="quiet" onPress={() => openSection("assignment")}>Assignment settings</Button>
            </>}
          </section>}
          <DataGrid appearance="flush" keepEmptyTable compactToolbar selectable={false} emptyContent={<div className={styles.illustratedEmpty}><Image src="/images/empty-states/enquiries.png" width={112} height={112} alt={items.length ? "No matching enquiries" : "Your enquiries will appear here"} /><span>{items.length ? "No matching enquiries" : "No enquiries yet"}</span></div>} key={initialData.workspaceId} ariaLabel="CRM enquiries" persistKey="crm-enquiries-v3" rowNumbers={false} columns={columns} data={visibleItems} getRowId={lead => lead.id}
            initialColumnVisibility={{title:false,channel:false,intakeMethod:false,serviceType:false,priority:false,createdAt:false,budgetRange:false,customerType:false,area:false,campaign:false}} searchLabel="Search enquiries" exportFileName="enquiries.csv"
            savedViews={[...(initialData.currentMembershipId ? [{id:'mine',label:'Mine'}] : []),{id:'unassigned',label:'Unassigned'},{id:'attention',label:'Needs attention'},{id:'all',label:'All enquiries'}]} selectedView={leadView} onViewChange={setLeadView}
            onRowAction={setCardLead} pageSize={50} hasMoreRows={Boolean(nextCursor)} totalRowCount={items.length}
            emptyTitle={items.length ? "No matching enquiries" : "Your enquiries will appear here"} emptyDescription={items.length ? "Try another view or clear your filters." : "Use New enquiry to add one."}
            toolbarActions={<><Button size="compact" variant="quiet" onPress={() => setReviewOpen(true)}>Intake review</Button><Button size="compact" onPress={() => setImportOpen(true)}><FileInput size={14} aria-hidden="true"/>Import CSV</Button><Button size="compact" variant="primary" onPress={() => setCreateOpen(true)}><Plus size={14} aria-hidden="true"/>New enquiry</Button></>}
            footerActions={<><Button size="compact" variant="quiet" isDisabled={busy || !items.some(lead => !lead.ownerMembershipId && ACTIVE_STATUSES.has(lead.status))} onPress={() => void runAutoAssign()}>Assign unassigned</Button>{nextCursor ? <Button isDisabled={busy} isLoading={loadingMore} onPress={() => void loadMore()} size="compact">Load more enquiries</Button> : null}<IconButton aria-label="Refresh enquiries" onPress={() => void refresh()} isDisabled={busy} size="compact"><RefreshCw size={14} aria-hidden="true"/></IconButton></>}
          />
        </section>
          </> : null}
          {activeSection === "forms" ? <LeadFormBuilder initialData={initialData} initialBranding={formBranding} onDirtyChange={setFormDirty} onEditingChange={setFormEditing} /> : null}
          {activeSection === "sources" ? <section aria-label="Sales lead source connections"><div className={styles.sourceIntro}><div><h2>Connect lead sources</h2><p>Connect messaging here without leaving Sales. Published Wodana forms already create enquiries from their shared link or QR code.</p></div><Button size="compact" onPress={() => openSection("forms")}>Open forms</Button></div>{integrationsData ? <IntegrationsPage embedded initialData={integrationsData} onlyIds={["whatsapp", "meta_lead_ads"]} /> : <Callout title="Connections unavailable" tone="warning">Reload this page to see available lead-source connections.</Callout>}</section> : null}
          {activeSection === "options" ? <LeadOptionsEditor workspaceId={initialData.workspaceId} initialOptions={leadOptions} onSaved={setLeadOptions} onDirtyChange={setFormDirty} /> : null}
          {activeSection === "reports" ? <LeadFlowReport initialData={initialData} /> : null}
          {activeSection === "sla" ? <LeadResponseSla initialData={initialData} /> : null}
          {activeSection === "assignment" ? <LeadRouting initialData={initialData} /> : null}
        </div>

        {cardLead ? <InspectorSheet isOpen onOpenChange={(open) => { if (!open) setCardLead(null); }} size="md" title="Enquiry details"><LeadWorkbench initialData={initialData} key={cardLead.id} lead={items.find((item) => item.id === cardLead.id) ?? cardLead} onChanged={() => reloadLeads()} onQualify={setQualificationLead} /></InspectorSheet> : null}
        {importOpen ? <LeadImportDialog initialData={initialData} onClose={() => setImportOpen(false)} onImported={() => reloadLeads()} /> : null}
        {reviewOpen ? <InspectorSheet isOpen onOpenChange={setReviewOpen} size="lg" title="Intake review"><IntakeInbox workspaceId={initialData.workspaceId} onChanged={() => reloadLeads()} /></InspectorSheet> : null}
        {pendingMove && pendingLead ? <MoveLeadDialog lead={pendingLead} move={pendingMove} saving={Boolean(savingLeadId)} onClose={() => setPendingMove(null)} onSave={(details) => saveMove(pendingMove, details)} /> : null}
        {qualificationLead ? <CreateDealDialog lead={qualificationLead} initialData={initialData} onClose={() => setQualificationLead(null)} onCreated={async record => {
          setStatusMessage(`${customerDisplayName(qualificationLead.partyName)}: opportunity created.`);
          setQualificationLead(null); setCardLead(null);
          router.push(`/workspace/crm/opportunities?record=${encodeURIComponent(record.id)}`);
        }} /> : null}

        {createOpen ? <LeadEnquiryForm initialData={initialData} onClose={() => setCreateOpen(false)} onSaved={async () => {
          await reloadLeads();
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
          if (saved.ownerMembershipId) setAutoProgress(current => current ? { ...current, assigned: current.assigned + 1, remaining: current.remaining.filter(item => item.id !== saved.id) } : null);
          setStatusMessage(saved.ownerMembershipId ? "Assignment updated." : "No available sales owner. The enquiry remains in its queue.");
        }} /> : null}
        {followUp ? <NewFollowUpDialog workspaceId={initialData.workspaceId} initialLead={{ ...followUp }} onClose={() => setFollowUp(null)} onCreated={async () => { await reloadLeads(); setFollowUp(null); setStatusMessage("Follow-up scheduled."); }} /> : null}
        {confirmationDialog}
      </>}
    </section>
  </DesignSystemProvider>;
}

function StatusSelect({ lead, disabled, onMove }: { lead: CrmLeadListItem; disabled: boolean; onMove: (id: string, status: CrmLeadStatus) => void }) {
  return <div className={styles.statusSelect} data-status={leadStage(lead.status)} data-grid-interactive>
    <SelectField label={<span className="wd-visually-hidden">Stage for {customerDisplayName(lead.partyName)}</span>} aria-label={`Stage for ${customerDisplayName(lead.partyName)}`} isDisabled={disabled || lead.isConverted} selectedKey={leadStage(lead.status)} onSelectionChange={(key) => { if (key) onMove(lead.id, String(key) as CrmLeadStatus); }} items={LEAD_STAGES.filter((stage) => stage.id === leadStage(lead.status) || CRM_LEAD_TRANSITIONS[lead.status].includes(stage.id)).map((stage) => ({ id: stage.id, label: stage.label }))} />
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
  return <InspectorSheet isOpen onOpenChange={(open) => { if (!open && !saving) onClose(); }} title={`Move to ${stageLabel(move.status)}`} size="md">
    <form className={styles.leadForm} onSubmit={submit}>
      <p className={styles.muted}>{customerDisplayName(lead.partyName)} · {lead.title}</p>
      {needsReason ? <TextAreaField label="Reason" isRequired maxLength={160} value={reason} onChange={setReason} placeholder="Briefly explain this stage change…" /> : null}
      {needsDate ? <div className={styles.followUpField}><CrmDateTimeField label="Next follow-up" isRequired isDisabled={saving} value={date} onChange={setDate} /><small>An unassigned active enquiry needs a follow-up date.</small></div> : null}
      {error ? <Callout title="Stage not saved" tone="danger">{error}</Callout> : null}
      <div className={styles.dialogActions}><Button onPress={onClose} isDisabled={saving}>Cancel</Button><Button type="submit" variant="primary" isLoading={saving}>Save stage</Button></div>
    </form>
  </InspectorSheet>;
}
