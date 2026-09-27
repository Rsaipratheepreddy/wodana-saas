"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarClock, CalendarDays, CheckCircle2, BriefcaseBusiness, ContactRound, Globe, ListFilter, PhoneCall, Plus, RefreshCw, Type, UserRoundPlus, UsersRound } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  ListTabs,
  DataGrid,
  IconButton,
  IconMenuButton,
  InspectorSheet,
  type DataGridColumn,
  DesignSystemProvider,
  TextAreaField,
  formatDate,
  useConfirmationDialog,
} from "@/design-system";
import { CRM_LEAD_TRANSITIONS, leadStage, leadStageLabel, salesOwnerChoices, type CrmLeadListItem, type CrmLeadStatus, type LeadsPageData } from "@/lib/crm/leads";
import styles from "./leads-page.module.css";
import theme from "./crm-workspace-colors.module.css";
import { EnquiryFieldsSettings } from "./enquiry-fields-settings";
import { SalesReports } from "./sales-reports";
import { SalesAutomations } from "./crm-smart-rules";
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
import { customValueText, enquiryFields, isShown } from "@/lib/crm/enquiry-fields";
import type { IntegrationsPageData } from "@/lib/workspace/integrations";
import { IntegrationsPage } from "@/components/workspace/integrations-page";
import { LogContactDialog } from "./log-contact-dialog";
import { useT } from "@/lib/i18n/i18n-provider";
import { administrativeAreaLabel, countryFromLocale } from "@/lib/workspace/region-labels";

const LOCAL_FORMAT = { locale: "en-GB", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
const ACTIVE_STATUSES = new Set<CrmLeadStatus>(["new", "attempting_contact", "connected", "nurturing", "paused"]);
const stageLabel = leadStageLabel;
type LeadMove = { leadId: string; status: CrmLeadStatus };
export type EnquirySection = "leads" | "forms" | "sources" | "options" | "reports" | "sla" | "assignment" | "automations";
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

/** Owners, admins and sales managers see the team; salespeople start from their own new enquiries (PLM-076). */
const TEAM_ROLES = new Set(["owner", "administrator", "sales_manager", "sales_admin", "ops_admin"]);
type EnquiryView = "new" | "contacted" | "come_back" | "all" | "unassigned";
function listOf(status: CrmLeadStatus): "new" | "contacted" | "come_back" | "closed" {
  if (status === "new") return "new";
  if (status === "attempting_contact" || status === "connected" || status === "nurturing") return "contacted";
  if (status === "paused") return "come_back";
  return "closed";
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
  const t = useT();
  const [formDirty, setFormDirty] = useState(false);
  const [formEditing, setFormEditing] = useState(false);
  const [leadOptions, setLeadOptions] = useState(serverData.leadOptions);
  const initialData = { ...serverData, leadOptions };
  const [linkedLead, setLinkedLead] = useState(initialLeadId);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [items, setItems] = useState(initialData.items);
  const [nextCursor, setNextCursor] = useState(initialData.nextCursor);
  const seesTeam = (serverData.currentRoles ?? []).some((role) => TEAM_ROLES.has(role)) || !serverData.currentMembershipId;
  const [leadView, setLeadView] = useState<EnquiryView>(seesTeam ? "all" : "new");
  const [contactLead, setContactLead] = useState<CrmLeadListItem | null>(null);
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

  // Salespeople see their own lists; team leads see everyone's.
  const scoped = useMemo(() => seesTeam ? items : items.filter((lead) => lead.ownerMembershipId === serverData.currentMembershipId), [items, seesTeam, serverData.currentMembershipId]);
  const inView = (lead: CrmLeadListItem, view: EnquiryView) => {
    if (lead.isConverted && view !== "all") return false;
    if (view === "all") return true;
    if (view === "unassigned") return ACTIVE_STATUSES.has(lead.status) && !lead.ownerMembershipId;
    return listOf(lead.status) === view;
  };
  const visibleItems = useMemo(() => scoped.filter((lead) => inView(lead, leadView)), [scoped, leadView]);
  const viewCount = (view: EnquiryView) => scoped.filter((lead) => inView(lead, view)).length;
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
  // Hidden enquiry fields leave the list; the workspace's own fields become columns.
  const fieldList = useMemo(() => enquiryFields(serverData.enquiryFields, ""), [serverData.enquiryFields]);
  const shown = (key: string) => isShown(fieldList, key);
  const customColumns = fieldList.filter((field) => field.custom && field.visible);
  const statusText = (lead: CrmLeadListItem) => lead.isConverted ? t("Converted") : lead.status === "duplicate" ? t("Duplicate") : lead.status === "qualified" ? t("Qualified") : lead.status === "disqualified" ? t("Not interested") : listOf(lead.status) === "come_back" ? t("Come back later") : listOf(lead.status) === "contacted" ? t("Contacted") : t("New");
  const statusTone = (lead: CrmLeadListItem): "success" | "info" | "warning" | "neutral" | "danger" => lead.isConverted || lead.status === "qualified" ? "success" : lead.status === "disqualified" ? "neutral" : listOf(lead.status) === "come_back" ? "warning" : listOf(lead.status) === "new" ? "info" : "neutral";
  const columns: DataGridColumn<CrmLeadListItem>[] = [
    { accessorKey: "partyName", header: t("Customer"), size: 220, meta: { headerIcon: <ContactRound size={14}/> }, cell: ({row:{original:lead}}) => { const name = customerDisplayName(lead.partyName); return <button type="button" className={styles.sheetLead} onClick={() => setCardLead(lead)} aria-label={`${t("Open")} ${name}`} title={name}><PersonAvatar name={name} /><span className={styles.clientRequest}><strong>{name}</strong>{lead.reference ? <small>{lead.reference}</small> : null}</span></button>; } },
    { accessorKey: "title", header: "Enquiry title", size: 240, meta: { headerIcon: <Type size={14}/> }, cell: ({getValue}) => <span className={styles.sheetText} title={String(getValue())}>{String(getValue())}</span> },
    { id: "status", header: t("Status"), size: 140, accessorFn: lead => statusText(lead), meta: { headerIcon: <CheckCircle2 size={14}/> }, cell: ({row:{original:lead}}) => <Badge tone={statusTone(lead)}>{statusText(lead)}</Badge> },
    { id: "source", header: t("Source"), size: 150, accessorFn: lead => sourceLabel(lead.source), filterFn: "equalsString", meta: { headerIcon: <Globe size={14}/>, filterOptions: sources.map(source=>({id:sourceLabel(source),label:sourceLabel(source)})) }, cell: ({row:{original:lead}}) => <SourceChip source={lead.source} displayLabel={sourceLabel(lead.source)} /> },
    { id: "channel", header: "Channel", size: 140, accessorFn: lead => initialData.leadOptions?.channels[lead.source]?.find(option => option.id === lead.channel)?.label ?? humanize(lead.channel), meta: { headerIcon: <Globe size={14}/> } },
    { id: "intakeMethod", header: "Captured via", size: 145, accessorFn: lead => humanize(lead.intakeMethod ?? null), cell: ({ row }) => <span className={styles.intakeChip}>{humanize(row.original.intakeMethod ?? null)}</span> },
    { id: "serviceType", header: "Service required", size: 195, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.enquiryTypes, lead.serviceType), cell: ({ row }) => <span className={styles.serviceChip} data-missing={!hasResolvedEnquiryType(row.original.serviceType) || undefined}>{!hasResolvedEnquiryType(row.original.serviceType) ? "To confirm" : leadOptionLabel(initialData.leadOptions?.enquiryTypes, row.original.serviceType)}</span>, meta: { headerIcon: <BriefcaseBusiness size={14}/> } },
    { accessorKey: "ownerName", header: t("Assigned to"), size: 190, meta: { headerIcon: <UsersRound size={14}/> }, cell: ({row:{original:lead}}) => <div className={styles.managerCell}><button type="button"
      aria-label={`Assign ${customerDisplayName(lead.partyName)}`} title={lead.ownerName ? `${lead.ownerName} · Reassign` : "Choose sales owner"}
      className={styles.assigneeButton} disabled={busy || lead.isConverted || ["qualified", "disqualified"].includes(lead.status)} onClick={() => setAssignment(lead)}>
      {lead.ownerName ? <PersonAvatar name={lead.ownerName} /> : <UserRoundPlus aria-hidden="true" size={16} />}
      <span>{lead.ownerName ?? "Unassigned"}</span>
    </button>{!lead.ownerMembershipId && ACTIVE_STATUSES.has(lead.status) && !lead.isConverted ? <Button size="compact" isDisabled={busy} onPress={() => void runAutoAssign(lead)} aria-label={`Auto-assign ${customerDisplayName(lead.partyName)}`}>Auto</Button> : null}</div> },
    { accessorKey: "nextActionAt", header: t("Next follow-up"), size: 160, meta: { headerIcon: <CalendarClock size={14}/> }, cell: ({row:{original:lead}}) => {
      if (lead.status === "qualified") return <Button size="compact" variant="quiet" onPress={() => setCardLead(lead)}>View linked records</Button>;
      const action = nextActionLabel(lead.nextActionAt, referenceTime, lead.status);
      return <Button size="compact" className={styles.nextAction} data-overdue={action.overdue || undefined} isDisabled={busy || lead.isConverted || ["qualified", "disqualified"].includes(lead.status)} aria-label={`Follow up with ${customerDisplayName(lead.partyName)}`} onPress={() => scheduleFollowUp(lead)}><CalendarClock size={14} aria-hidden="true" />{lead.nextActionAt ? action.label : "Schedule"}</Button>;
    } },
    { id: "contact", header: t("Action"), size: 150, meta: { headerIcon: <PhoneCall size={14}/> }, enableSorting: false, cell: ({row:{original:lead}}) => ACTIVE_STATUSES.has(lead.status) && !lead.isConverted ? <Button size="compact" variant="secondary" isDisabled={busy} aria-label={`${t("Log contact")} · ${customerDisplayName(lead.partyName)}`} onPress={() => setContactLead(lead)}><PhoneCall size={14} aria-hidden="true" />{t("Log contact")}</Button> : null },
    { id: "priority", header: "Priority", size: 120, accessorFn: lead => humanize(lead.priority), meta: { headerIcon: <ListFilter size={14}/> } },
    ...(shown("budgetRange") ? [{ id: "budgetRange", header: "Budget range", size: 180, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.budgetRanges, lead.details?.budgetRange) } as DataGridColumn<CrmLeadListItem>] : []),
    ...(shown("customerType") ? [{ id: "customerType", header: "Customer type", size: 140, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.customerTypes, lead.details?.customerType) } as DataGridColumn<CrmLeadListItem>] : []),
    ...(initialData.leadOptions?.emirates.length ? [{ id: "emirate", header: administrativeAreaLabel(countryFromLocale(serverData.defaultLocale)), size: 160, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.emirates, lead.details?.emirate), filterFn: "equalsString", meta: { filterOptions: (initialData.leadOptions?.emirates ?? []).map(option => ({ id: option.label, label: option.label })) } } as DataGridColumn<CrmLeadListItem>] : []),
    ...(shown("area") ? [{ id: "area", header: "Area / city", size: 190, accessorFn: lead => lead.details?.area ?? lead.details?.location ?? "" } as DataGridColumn<CrmLeadListItem>] : []),
    { id: "campaign", header: "Campaign", size: 160, accessorFn: lead => lead.details?.campaign ?? "" },
    ...customColumns.map((field) => ({ id: field.key, header: field.label, size: 190, accessorFn: (lead: CrmLeadListItem) => customValueText(lead.customFields?.[field.custom!.id]), cell: ({ getValue }: { getValue: () => unknown }) => <span className={styles.sheetText} title={String(getValue())}>{String(getValue())}</span> })),
    { accessorKey: "updatedAt", header: "Last updated", size: 120, cell: ({row:{original:lead}}) => formatDate(new Date(lead.updatedAt), LOCAL_FORMAT, {day:'numeric',month:'short',year:'numeric'}) },
    { accessorKey: "createdAt", header: "Created", size: 150, meta: { headerIcon: <CalendarDays size={14}/> }, cell: ({row:{original:lead}}) => formatDate(new Date(lead.createdAt), LOCAL_FORMAT, {day:'numeric',month:'short',year:'numeric'}) },
    { id: "dealAction", header: "Opportunity", size: 190, enableSorting: false, cell: ({ row: { original: lead } }) => lead.isConverted
      ? <Button size="compact" variant="quiet" onPress={() => setCardLead(lead)}>View opportunity</Button>
      : ["disqualified", "paused"].includes(lead.status) ? <span className={styles.sheetText}>—</span>
      : !hasResolvedEnquiryType(lead.serviceType) ? <Button size="compact" className={styles.createDeal} isDisabled={busy} aria-label={`Choose enquiry type for ${customerDisplayName(lead.partyName)}`} onPress={() => setCardLead(lead)}>Choose type</Button>
      : <Button size="compact" className={styles.createDeal} isDisabled={busy} aria-label={`Convert ${customerDisplayName(lead.partyName)} to opportunity`} onPress={() => setQualificationLead(lead)}>Convert</Button> },
  ];
  const pendingLead = pendingMove ? items.find((lead) => lead.id === pendingMove.leadId) : undefined;
  const workspaceArea = activeSection === "leads" ? "work" : activeSection === "forms" || activeSection === "sources" ? "capture" : activeSection === "assignment" || activeSection === "sla" ? "response" : "performance";
  return <DesignSystemProvider className={`${styles.provider} ${theme.theme}`} portalContainer={portalContainer} ref={setPortalContainer}>
    <section aria-label="Enquiries workspace" className={styles.page}>


      {workspaceArea === "capture" && !(activeSection === "forms" && formEditing) ? <nav className={styles.subnav} aria-label="Capture settings"><button type="button" data-active={activeSection === "forms" || undefined} onClick={() => openSection("forms")}>Forms</button><button type="button" data-active={activeSection === "sources" || undefined} onClick={() => openSection("sources")}>Lead sources</button></nav> : null}


      {!initialData.canView ? <Callout title="Enquiry access is restricted" tone="warning">Ask a workspace owner or administrator for CRM enquiry access.</Callout> : <>
        {linkedLead ? <InspectorSheet isOpen hideTitle title="Enquiry details" size="md" onOpenChange={(open) => { if (!open) setLinkedLead(undefined); }}><LinkedLeadWorkbench leadId={linkedLead} initialData={initialData} onChanged={() => reloadLeads()} onQualify={setQualificationLead} /></InspectorSheet> : null}
        {failure ? <Callout title="Enquiries could not be updated" tone="danger">{failure}</Callout> : null}
        {statusMessage ? <p aria-live="polite" className={styles.statusMessage}>{statusMessage}</p> : null}

        <div className={styles.sections}>
          {activeSection === "leads" ? <>
        <section data-sales-grid aria-label={t("Enquiries")} className={`${styles.boardRegion} ${styles.sheet}`}>
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
          <DataGrid appearance="flush" keepEmptyTable compactToolbar selectable={false} emptyContent={<div className={styles.illustratedEmpty}><Image src="/images/empty-states/enquiries.png" width={112} height={112} alt={items.length ? "No matching enquiries" : "Your enquiries will appear here"} /><span>{items.length ? "No matching enquiries" : "No enquiries yet"}</span></div>} key={initialData.workspaceId} ariaLabel="CRM enquiries" persistKey="crm-enquiries-v4" rowNumbers={false} columns={columns} data={visibleItems} getRowId={lead => lead.id}
            initialColumnVisibility={{emirate:false,updatedAt:false,title:false,channel:false,intakeMethod:false,serviceType:false,priority:false,createdAt:false,budgetRange:false,customerType:false,area:false,campaign:false}} searchLabel="Search enquiries" exportFileName="enquiries.csv"

            onRowAction={setCardLead} pageSize={50} hasMoreRows={Boolean(nextCursor)} totalRowCount={items.length}
            emptyTitle={items.length ? "No matching enquiries" : "Your enquiries will appear here"} emptyDescription={items.length ? "Try another view or clear your filters." : "Use New enquiry to add one."}
            toolbarLeading={<ListTabs label={t("Enquiry lists")} value={leadView} onChange={setLeadView} items={[
          { id: "new", label: t("New"), count: viewCount("new") },
          { id: "contacted", label: t("Contacted"), count: viewCount("contacted") },
          { id: "come_back", label: t("Come back to"), count: viewCount("come_back") },
          ...(seesTeam ? [{ id: "unassigned" as const, label: t("Unassigned"), count: viewCount("unassigned") }] : []),
          { id: "all", label: t("All") },
        ]} />}
            toolbarActions={<><IconMenuButton ariaLabel={t("More actions")} items={[{ id: "import", label: t("Import CSV") }, { id: "review", label: t("Intake review") }]} onAction={(id) => id === "import" ? setImportOpen(true) : setReviewOpen(true)} /><Button size="compact" variant="primary" onPress={() => setCreateOpen(true)}><Plus size={14} aria-hidden="true"/>{t("New enquiry")}</Button></>}
            footerActions={<><Button size="compact" variant="quiet" isDisabled={busy || !items.some(lead => !lead.ownerMembershipId && ACTIVE_STATUSES.has(lead.status))} onPress={() => void runAutoAssign()}>Assign unassigned</Button>{nextCursor ? <Button isDisabled={busy} isLoading={loadingMore} onPress={() => void loadMore()} size="compact">Load more enquiries</Button> : null}<IconButton aria-label="Refresh enquiries" onPress={() => void refresh()} isDisabled={busy} size="compact"><RefreshCw size={14} aria-hidden="true"/></IconButton></>}
          />
        </section>
          </> : null}
          {activeSection === "forms" ? <LeadFormBuilder initialData={initialData} initialBranding={formBranding} onDirtyChange={setFormDirty} onEditingChange={setFormEditing} /> : null}
          {activeSection === "sources" ? <section aria-label="Sales lead source connections">{integrationsData ? <IntegrationsPage embedded initialData={integrationsData} onlyIds={["whatsapp", "meta_lead_ads"]} /> : <Callout title="Connections unavailable" tone="warning">Reload this page to see available lead-source connections.</Callout>}</section> : null}
          {activeSection === "options" ? <EnquiryFieldsSettings workspaceId={initialData.workspaceId} leadOptions={leadOptions} regionLabel={administrativeAreaLabel(countryFromLocale(serverData.defaultLocale))} onOptionsSaved={setLeadOptions} /> : null}
          {activeSection === "reports" ? <SalesReports initialData={initialData} regionLabel={administrativeAreaLabel(countryFromLocale(serverData.defaultLocale))} /> : null}
          {activeSection === "sla" ? <LeadResponseSla initialData={initialData} /> : null}
          {activeSection === "assignment" ? <LeadRouting initialData={initialData} /> : null}
          {activeSection === "automations" ? <SalesAutomations workspaceId={initialData.workspaceId} /> : null}
        </div>

        {cardLead ? <InspectorSheet isOpen onOpenChange={(open) => { if (!open) setCardLead(null); }} size="md" hideTitle title="Enquiry details"><LeadWorkbench initialData={initialData} key={cardLead.id} lead={items.find((item) => item.id === cardLead.id) ?? cardLead} onChanged={() => reloadLeads()} onQualify={setQualificationLead} /></InspectorSheet> : null}
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


        {assignment ? <LeadAssignmentDialog workspaceId={initialData.workspaceId} lead={assignment} members={salesOwnerChoices(initialData)} onClose={() => setAssignment(null)} onSaved={(result) => {
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
        {contactLead ? <LogContactDialog workspaceId={initialData.workspaceId} lead={{ id: contactLead.id, version: contactLead.version, name: customerDisplayName(contactLead.partyName) }} onClose={() => setContactLead(null)} onLogged={(saved) => {
          setItems((current) => current.map((item) => item.id === contactLead.id ? { ...item, status: saved.status as CrmLeadStatus, version: saved.version, nextActionAt: saved.nextActionAt, updatedAt: saved.updatedAt ?? item.updatedAt } : item));
          setStatusMessage(`${customerDisplayName(contactLead.partyName)} · ${t("Contact logged.")}`);
          setContactLead(null);
        }} /> : null}
        {confirmationDialog}
      </>}
    </section>
  </DesignSystemProvider>;
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
