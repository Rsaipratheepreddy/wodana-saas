"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarClock, CalendarDays, CheckCircle2, BriefcaseBusiness, ContactRound, Globe, ListFilter, PhoneCall, Plus, RefreshCw, Timer, Type, UserRoundPlus, UsersRound } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  ListTabs,
  DataGrid,
  IconButton,
  IconMenuButton,
  InspectorSheet,
  NoAccessNotice,
  NoAccessState,
  PageHeader,
  type DataGridColumn,
  DesignSystemProvider,
  TextAreaField,
  formatDate,
  useConfirmationDialog,
  useDesignSystem,
} from "@/design-system";
import { CRM_LEAD_TRANSITIONS, leadStage, leadStageLabel, salesOwnerChoices, type CrmLeadListItem, type CrmLeadStatus, type LeadsPageData } from "@/lib/crm/leads";
import { Avatar } from "@/design-system/components/avatar";
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
import { RespondByChip, useNow } from "./respond-by-chip";
import { respondBy } from "@/lib/crm/sales-time";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown, type Translate } from "@/lib/i18n/keys";
import { administrativeAreaLabel, countryFromLocale } from "@/lib/workspace/region-labels";

type LocalFormat = { locale: string; timeZone: string };
const ACTIVE_STATUSES = new Set<CrmLeadStatus>(["new", "attempting_contact", "connected", "nurturing", "paused"]);
const stageLabel = leadStageLabel;
type LeadMove = { leadId: string; status: CrmLeadStatus };
export type EnquirySection = "leads" | "forms" | "sources" | "options" | "reports" | "sla" | "assignment" | "automations";
function humanize(value: string | null, notSet: string) {
  if (!value) return notSet;
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

type EnquiryView = "new" | "contacted" | "come_back" | "all" | "unassigned" | "review" | "duplicates";
/** New enquiries are worked in respond-by order: the most urgent first (S-6). */
const respondOrder = (lead: CrmLeadListItem) => lead.slaDueAt && ["active", "warning", "breached"].includes(lead.slaStatus ?? "") ? Date.parse(lead.slaDueAt) : Number.POSITIVE_INFINITY;
/** How often the list checks for new and changed enquiries while it is on screen (S-5). */
const REFRESH_EVERY = 30_000;
function listOf(status: CrmLeadStatus): "new" | "contacted" | "come_back" | "closed" {
  if (status === "new") return "new";
  if (status === "attempting_contact" || status === "connected" || status === "nurturing") return "contacted";
  if (status === "paused") return "come_back";
  return "closed";
}

function nextActionLabel(value: string | null, referenceTime: number, status: CrmLeadStatus, t: Translate, localFormat: LocalFormat) {
  if (!ACTIVE_STATUSES.has(status)) return { label: t("No follow-up"), overdue: false };
  if (!value) return { label: t("Not scheduled"), overdue: false };
  const date = new Date(value);
  const difference = date.getTime() - referenceTime;
  if (difference < 0) {
    const hours = Math.max(1, Math.round(Math.abs(difference) / 3_600_000));
    return { label: t("{hours}h overdue", { hours }), overdue: true };
  }
  if (difference < 86_400_000) {
    const hours = Math.max(1, Math.round(difference / 3_600_000));
    return { label: t("In {hours}h", { hours }), overdue: false };
  }
  return {
    label: formatDate(date, localFormat, { day: "numeric", month: "short" }),
    overdue: false,
  };
}

function responseMessage(response: Response, fallback: string) {
  return response.json()
    .then((payload: { message?: string } | null) => payload?.message ?? fallback)
    .catch(() => fallback);
}

/** What each Enquiries section is called when someone's role can't open it. */
const SECTION_AREA: Record<EnquirySection, "Enquiries" | "Campaigns" | "Reports" | "Sales settings" | "Automations"> = {
  leads: "Enquiries", forms: "Campaigns", sources: "Campaigns", reports: "Reports", assignment: "Sales settings", sla: "Sales settings", options: "Sales settings", automations: "Automations",
};

export function LeadsPage({ initialData: serverData, integrationsData, integrationsDenied = false, formBranding, initialLeadId, initialCreate = false, initialSection = "leads", sectionDenied = false }: { initialData: LeadsPageData; integrationsData?: IntegrationsPageData; integrationsDenied?: boolean; formBranding?: LeadFormBranding; initialLeadId?: string; initialCreate?: boolean; initialSection?: EnquirySection; sectionDenied?: boolean }) {
  const router = useRouter();
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const localFormat = { locale, timeZone };
  const notSet = t("Not set");
  const areaLabel = t(administrativeAreaLabel(countryFromLocale(serverData.defaultLocale)) as never);
  const [formDirty, setFormDirty] = useState(false);
  const [formEditing, setFormEditing] = useState(false);
  const [leadOptions, setLeadOptions] = useState(serverData.leadOptions);
  const initialData = { ...serverData, leadOptions };
  const [linkedLead, setLinkedLead] = useState(initialLeadId);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [items, setItems] = useState(initialData.items);
  const [nextCursor, setNextCursor] = useState(initialData.nextCursor);
  // Whoever assigns enquiries sees the team; salespeople start from their own new enquiries (PLM-076). A permission, never a role name.
  const seesTeam = serverData.canAssign !== false || !serverData.currentMembershipId;
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
  // Relative times tick while the page is open (S-5).
  const now = Math.max(useNow(60_000), referenceTime);
  const unowned = useMemo(() => items.filter((lead) => !lead.isConverted && ACTIVE_STATUSES.has(lead.status) && lead.status !== "paused" && !lead.ownerMembershipId).length, [items]);

  const openSection = (section: EnquirySection) => {
    if (section === activeSection) return;
    const navigate = () => router.push(section === "leads" ? "/workspace/crm/leads" : `/workspace/crm/leads?section=${section}`);
    if (formDirty) {
      requestConfirmation({ title: t("Discard unsaved changes?"), body: t("Your current enquiry configuration has not been saved."), confirmLabel: t("Discard changes"), onConfirm: navigate });
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
    if (view === "review") return Boolean(lead.clientMatches) && lead.status !== "duplicate";
    if (view === "duplicates") return lead.status === "duplicate";
    return listOf(lead.status) === view;
  };
  const visibleItems = useMemo(() => {
    const listed = scoped.filter((lead) => inView(lead, leadView));
    return leadView === "new" ? [...listed].sort((a, b) => respondOrder(a) - respondOrder(b)) : listed;
  }, [scoped, leadView]);
  const viewCount = (view: EnquiryView) => scoped.filter((lead) => inView(lead, view)).length;
  const sources = useMemo(() => [...new Set(items.map(lead => lead.source))].sort(), [items]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setFailure("");
    try {
      const query = new URLSearchParams({ workspaceId: initialData.workspaceId, cursor: nextCursor });
      const response = await fetch(`/api/workspace/crm/leads?${query}`);
      if (!response.ok) throw new Error(await responseMessage(response, t("More leads could not be loaded.")));
      const page = await response.json() as { data: CrmLeadListItem[]; nextCursor: string | null };
      setItems((current) => [...current, ...page.data.filter((lead) => !current.some((item) => item.id === lead.id))]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t("More leads could not be loaded."));
    } finally {
      setLoadingMore(false);
    }
  };

  const reloadLeads = async (focusLeadId?: string) => {
    const query = new URLSearchParams({ workspaceId: initialData.workspaceId });
    const response = await fetch(`/api/workspace/crm/leads?${query}`);
    if (!response.ok) throw new Error(await responseMessage(response, t("Leads could not be refreshed.")));
    const page = await response.json() as { data: CrmLeadListItem[]; nextCursor: string | null };
    setItems(page.data);
    setNextCursor(page.nextCursor);
    if (focusLeadId) setCardLead(page.data.find((lead) => lead.id === focusLeadId) ?? null);
  };

  // S-5: while the list is on screen it refreshes itself. Changed rows update in place; new ones wait
  // behind "n new enquiries" so nothing jumps under the cursor.
  const [latest, setLatest] = useState<CrmLeadListItem[]>([]);
  const incoming = useMemo(() => latest.filter((lead) => !items.some((item) => item.id === lead.id) && (seesTeam || lead.ownerMembershipId === serverData.currentMembershipId)), [latest, items, seesTeam, serverData.currentMembershipId]);
  useEffect(() => {
    if (activeSection !== "leads" || !initialData.canView || sectionDenied) return;
    let stopped = false;
    const poll = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (mutationInFlight.current) return;
      try {
        const response = await fetch(`/api/workspace/crm/leads?${new URLSearchParams({ workspaceId: initialData.workspaceId })}`, { cache: "no-store" });
        if (!response.ok || stopped || mutationInFlight.current) return;
        const page = await response.json() as { data?: CrmLeadListItem[] };
        const fresh = new Map((page.data ?? []).map((lead) => [lead.id, lead]));
        setItems((current) => current.map((lead) => {
          const next = fresh.get(lead.id);
          return next && next.version >= lead.version ? { ...lead, ...next } : lead;
        }));
        setLatest(page.data ?? []);
      } catch { /* the next pass tries again */ }
    };
    const timer = window.setInterval(() => void poll(), REFRESH_EVERY);
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [activeSection, initialData.canView, initialData.workspaceId, sectionDenied]);
  const showIncoming = () => {
    setItems((current) => [...incoming, ...current.filter((lead) => !incoming.some((item) => item.id === lead.id))]);
    setLatest([]);
  };

  const refresh = async () => {
    setRefreshing(true);
    setFailure("");
    try { await reloadLeads(); setStatusMessage(t("Leads refreshed.")); }
    catch (error) { setFailure(error instanceof Error ? error.message : t("Leads could not be refreshed.")); }
    finally { setRefreshing(false); }
  };

  const saveMove = async (move: LeadMove, details: { reason?: string; nextActionAt?: string } = {}) => {
    const lead = items.find((item) => item.id === move.leadId);
    if (!lead || lead.isConverted || mutationInFlight.current || refreshing || loadingMore || leadStage(lead.status) === move.status) return;
    if (!CRM_LEAD_TRANSITIONS[lead.status].includes(move.status)) {
      setFailure(t("This enquiry cannot move from {from} to {to}.", { from: t(stageLabel(lead.status)), to: t(stageLabel(move.status)) }));
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
      if (!response.ok) throw new Error(await responseMessage(response, t("The stage could not be saved. Try again.")));
      const saved = await response.json() as Pick<CrmLeadListItem, "status" | "version" | "nextActionAt" | "updatedAt">;
      // Keep list-only contact/enquiry fields and previously loaded pages intact.
      setItems((current) => current.map((item) => item.id === lead.id ? { ...item, status: saved.status, version: saved.version, nextActionAt: saved.nextActionAt, updatedAt: saved.updatedAt ?? item.updatedAt } : item));
      setPendingMove(null);
      setStatusMessage(t("{name} moved to {stage}.", { name: customerDisplayName(lead.partyName), stage: t(stageLabel(saved.status)) }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("The stage could not be saved.");
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
      try { await reloadLeads(); } catch { setFailure(t("Assignment finished. Refresh to load the latest lead list.")); }
    } catch (error) { setFailure(error instanceof Error ? error.message : t("Auto-assignment could not finish. Refresh before trying again.")); }
    finally { mutationInFlight.current = false; setAutoBusy(false); }
  };
  const scheduleFollowUp = (lead: CrmLeadListItem) => setFollowUp(lead);
  const busy = Boolean(savingLeadId || refreshing || loadingMore || pendingMove || qualificationLead || autoBusy);
  const sourceLabel = (source: string) => initialData.leadOptions?.sources.find(option => option.id === source)?.label ?? humanize(source, notSet);
  // Hidden enquiry fields leave the list; the workspace's own fields become columns.
  const fieldList = useMemo(() => enquiryFields(serverData.enquiryFields, ""), [serverData.enquiryFields]);
  const shown = (key: string) => isShown(fieldList, key);
  const customColumns = fieldList.filter((field) => field.custom && field.visible);
  const statusText = (lead: CrmLeadListItem) => lead.isConverted ? t("Converted") : lead.status === "duplicate" ? t("Duplicate") : lead.status === "qualified" ? t("Qualified") : lead.status === "disqualified" ? t("Not interested") : listOf(lead.status) === "come_back" ? t("Come back later") : listOf(lead.status) === "contacted" ? t("Contacted") : t("New");
  const statusTone = (lead: CrmLeadListItem): "success" | "info" | "warning" | "neutral" | "danger" => lead.isConverted || lead.status === "qualified" ? "success" : lead.status === "disqualified" ? "neutral" : listOf(lead.status) === "come_back" ? "warning" : listOf(lead.status) === "new" ? "info" : "neutral";
  const columns: DataGridColumn<CrmLeadListItem>[] = [
    { accessorKey: "partyName", header: t("Customer"), size: 220, meta: { headerIcon: <ContactRound size={14}/> }, cell: ({row:{original:lead}}) => { const name = customerDisplayName(lead.partyName); return <button type="button" className={styles.sheetLead} data-tour={!lead.isConverted && !["disqualified", "paused"].includes(lead.status) && hasResolvedEnquiryType(lead.serviceType) ? "enquiry-customer" : undefined} data-tour-safe onClick={() => setCardLead(lead)} aria-label={t("Open {name}", { name })} title={name}><Avatar name={name} roles={["client"]} seed={lead.id} size="sm" /><span className={styles.clientRequest}><strong>{name}</strong>{lead.reference ? <small>{lead.reference}</small> : null}</span></button>; } },
    { accessorKey: "title", header: t("Enquiry title"), size: 240, meta: { headerIcon: <Type size={14}/> }, cell: ({getValue}) => <span className={styles.sheetText} title={String(getValue())}>{String(getValue())}</span> },
    { id: "status", header: t("Status"), size: 170, accessorFn: lead => statusText(lead), meta: { headerIcon: <CheckCircle2 size={14}/> }, cell: ({row:{original:lead}}) => <span className={styles.attentionFlags}>
      <Badge tone={statusTone(lead)}>{statusText(lead)}</Badge>
      {lead.clientMatches && lead.status !== "duplicate" ? <Badge tone="warning">{t("Confirm client")}</Badge> : null}
      {lead.contactAttempts && ACTIVE_STATUSES.has(lead.status) ? <Badge tone="neutral">{t("Attempt {count}", { count: lead.contactAttempts })}</Badge> : null}
      {lead.escalatedAt && ACTIVE_STATUSES.has(lead.status) ? <Badge tone="danger">{t("Escalated")}</Badge> : null}
    </span> },
    { id: "respondBy", header: t("Respond by"), size: 210, accessorFn: lead => Number.isFinite(respondOrder(lead)) ? lead.slaDueAt : undefined, sortUndefined: "last", meta: { headerIcon: <Timer size={14}/> }, cell: ({row:{original:lead}}) => respondBy(lead, now) ? <RespondByChip lead={lead} now={now} /> : <span className={styles.sheetText}>—</span> },
    { id: "source", header: t("Source"), size: 150, accessorFn: lead => sourceLabel(lead.source), filterFn: "equalsString", meta: { headerIcon: <Globe size={14}/>, filterOptions: sources.map(source=>({id:sourceLabel(source),label:sourceLabel(source)})) }, cell: ({row:{original:lead}}) => <SourceChip source={lead.source} displayLabel={sourceLabel(lead.source)} /> },
    { id: "channel", header: t("Channel"), size: 140, accessorFn: lead => initialData.leadOptions?.channels[lead.source]?.find(option => option.id === lead.channel)?.label ?? humanize(lead.channel, notSet), meta: { headerIcon: <Globe size={14}/> } },
    { id: "intakeMethod", header: t("Captured via"), size: 145, accessorFn: lead => humanize(lead.intakeMethod ?? null, notSet), cell: ({ row }) => <span className={styles.intakeChip}>{humanize(row.original.intakeMethod ?? null, notSet)}</span> },
    { id: "serviceType", header: t("Service required"), size: 195, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.enquiryTypes, lead.serviceType), cell: ({ row }) => <span className={styles.serviceChip} data-missing={!hasResolvedEnquiryType(row.original.serviceType) || undefined}>{!hasResolvedEnquiryType(row.original.serviceType) ? t("To confirm") : leadOptionLabel(initialData.leadOptions?.enquiryTypes, row.original.serviceType)}</span>, meta: { headerIcon: <BriefcaseBusiness size={14}/> } },
    { accessorKey: "ownerName", header: t("Assigned to"), size: 190, meta: { headerIcon: <UsersRound size={14}/> }, cell: ({row:{original:lead}}) => <div className={styles.managerCell}><button type="button"
      aria-label={t("Assign {name}", { name: customerDisplayName(lead.partyName) })} title={lead.ownerName ? t("{name} · Reassign", { name: lead.ownerName }) : t("Choose sales owner")}
      className={styles.assigneeButton} disabled={busy || lead.isConverted || ["qualified", "disqualified"].includes(lead.status)} onClick={() => setAssignment(lead)}>
      {lead.ownerName ? <Avatar name={lead.ownerName} roles={["sales"]} seed={lead.ownerMembershipId ?? lead.ownerName} size="sm" /> : <UserRoundPlus aria-hidden="true" size={16} />}
      <span>{lead.ownerName ?? t("Unassigned")}</span>
    </button>{!lead.ownerMembershipId && ACTIVE_STATUSES.has(lead.status) && !lead.isConverted ? <Button size="compact" isDisabled={busy} onPress={() => void runAutoAssign(lead)} aria-label={t("Auto-assign {name}", { name: customerDisplayName(lead.partyName) })}>{t("Auto")}</Button> : null}</div> },
    { accessorKey: "nextActionAt", header: t("Next follow-up"), size: 160, meta: { headerIcon: <CalendarClock size={14}/> }, cell: ({row:{original:lead}}) => {
      if (lead.status === "qualified") return <Button size="compact" variant="quiet" onPress={() => setCardLead(lead)}>{t("View linked records")}</Button>;
      const action = nextActionLabel(lead.nextActionAt, now, lead.status, t, localFormat);
      return <Button size="compact" className={styles.nextAction} data-overdue={action.overdue || undefined} isDisabled={busy || lead.isConverted || ["qualified", "disqualified"].includes(lead.status)} aria-label={t("Follow up with {name}", { name: customerDisplayName(lead.partyName) })} onPress={() => scheduleFollowUp(lead)}><CalendarClock size={14} aria-hidden="true" />{lead.nextActionAt ? action.label : t("Schedule")}</Button>;
    } },
    { id: "contact", header: t("Action"), size: 150, meta: { headerIcon: <PhoneCall size={14}/> }, enableSorting: false, cell: ({row:{original:lead}}) => ACTIVE_STATUSES.has(lead.status) && !lead.isConverted ? <Button size="compact" variant="secondary" isDisabled={busy} aria-label={t("Log contact · {name}", { name: customerDisplayName(lead.partyName) })} onPress={() => setContactLead(lead)}><PhoneCall size={14} aria-hidden="true" />{t("Log contact")}</Button> : null },
    { id: "priority", header: t("Priority"), size: 120, accessorFn: lead => humanize(lead.priority, notSet), meta: { headerIcon: <ListFilter size={14}/> } },
    ...(shown("budgetRange") ? [{ id: "budgetRange", header: t("Budget range"), size: 180, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.budgetRanges, lead.details?.budgetRange) } as DataGridColumn<CrmLeadListItem>] : []),
    ...(shown("customerType") ? [{ id: "customerType", header: t("Customer type"), size: 140, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.customerTypes, lead.details?.customerType) } as DataGridColumn<CrmLeadListItem>] : []),
    ...(initialData.leadOptions?.emirates.length ? [{ id: "emirate", header: areaLabel, size: 160, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.emirates, lead.details?.emirate), filterFn: "equalsString", meta: { filterOptions: (initialData.leadOptions?.emirates ?? []).map(option => ({ id: option.label, label: option.label })) } } as DataGridColumn<CrmLeadListItem>] : []),
    ...(shown("area") ? [{ id: "area", header: t("Area / city"), size: 190, accessorFn: lead => lead.details?.area ?? lead.details?.location ?? "" } as DataGridColumn<CrmLeadListItem>] : []),
    { id: "campaign", header: t("Campaign"), size: 160, accessorFn: lead => lead.details?.campaign ?? "" },
    ...customColumns.map((field) => ({ id: field.key, header: field.label, size: 190, accessorFn: (lead: CrmLeadListItem) => customValueText(lead.customFields?.[field.custom!.id]), cell: ({ getValue }: { getValue: () => unknown }) => <span className={styles.sheetText} title={String(getValue())}>{String(getValue())}</span> })),
    { accessorKey: "updatedAt", header: t("Last updated"), size: 120, cell: ({row:{original:lead}}) => formatDate(new Date(lead.updatedAt), localFormat, {day:'numeric',month:'short',year:'numeric'}) },
    { accessorKey: "createdAt", header: t("Created"), size: 150, meta: { headerIcon: <CalendarDays size={14}/> }, cell: ({row:{original:lead}}) => formatDate(new Date(lead.createdAt), localFormat, {day:'numeric',month:'short',year:'numeric'}) },
    { id: "dealAction", header: t("Opportunity"), size: 190, enableSorting: false, cell: ({ row: { original: lead } }) => lead.isConverted
      ? <Button size="compact" variant="quiet" onPress={() => setCardLead(lead)}>{t("View opportunity")}</Button>
      : ["disqualified", "paused"].includes(lead.status) ? <span className={styles.sheetText}>—</span>
      : !hasResolvedEnquiryType(lead.serviceType) ? <Button size="compact" className={styles.createDeal} isDisabled={busy} aria-label={t("Choose enquiry type for {name}", { name: customerDisplayName(lead.partyName) })} onPress={() => setCardLead(lead)}>{t("Choose type")}</Button>
      : <Button size="compact" className={styles.createDeal} data-tour="enquiry-convert" data-tour-safe isDisabled={busy} aria-label={t("Convert {name} to opportunity", { name: customerDisplayName(lead.partyName) })} onPress={() => setQualificationLead(lead)}>{t("Convert")}</Button> },
  ];
  const pendingLead = pendingMove ? items.find((lead) => lead.id === pendingMove.leadId) : undefined;
  const workspaceArea = activeSection === "leads" ? "work" : activeSection === "forms" || activeSection === "sources" ? "capture" : activeSection === "assignment" || activeSection === "sla" ? "response" : "performance";
  return <DesignSystemProvider className={`${styles.provider} ${theme.theme}`} portalContainer={portalContainer} ref={setPortalContainer}>
    <section aria-label={t("Enquiries workspace")} className={styles.page}>
      {/* One title per section, with New enquiry top-end on the list (S-20). */}
      <div className={styles.pageHeader}><PageHeader title={t(SECTION_AREA[activeSection])} actions={activeSection === "leads" && initialData.canView
        ? <Button variant="primary" onPress={() => setCreateOpen(true)}><Plus size={15} aria-hidden="true"/>{t("New enquiry")}</Button> : undefined} /></div>


      {workspaceArea === "capture" && !sectionDenied && !(activeSection === "forms" && formEditing) ? <nav className={styles.subnav} aria-label={t("Capture settings")}><button type="button" data-active={activeSection === "forms" || undefined} onClick={() => openSection("forms")}>{t("Forms")}</button><button type="button" data-active={activeSection === "sources" || undefined} onClick={() => openSection("sources")}>{t("Lead sources")}</button></nav> : null}


      {!initialData.canView ? <NoAccessState area={t("Enquiries")} /> : sectionDenied ? <NoAccessState area={t(SECTION_AREA[activeSection])} /> : <>
        {linkedLead ? <InspectorSheet isOpen hideTitle title={t("Enquiry details")} size="md" onOpenChange={(open) => { if (!open) setLinkedLead(undefined); }}><LinkedLeadWorkbench leadId={linkedLead} initialData={initialData} onChanged={() => reloadLeads()} onQualify={setQualificationLead} /></InspectorSheet> : null}
        {failure ? <Callout title={t("Enquiries could not be updated")} tone="danger">{failure}</Callout> : null}
        {statusMessage ? <p aria-live="polite" className={styles.statusMessage}>{statusMessage}</p> : null}

        <div className={styles.sections}>
          {activeSection === "leads" ? <>
        <section data-sales-grid data-tour="enquiry-list" aria-label={t("Enquiries")} className={`${styles.boardRegion} ${styles.sheet}`}>
          {autoProgress && <section className={styles.assignmentSummary} aria-label={t("Assignment results")}>
            <div className={styles.assignmentSummaryHeader}>
              <strong role="status">{autoBusy ? t("Assigning enquiries… {completed}/{total}", { completed: autoProgress.completed, total: autoProgress.total }) : autoProgress.remaining.length ? t("{count} enquiries need an owner", { count: autoProgress.remaining.length }) : t("{count} enquiries assigned", { count: autoProgress.assigned })}</strong>
              {!autoBusy && <Button size="compact" variant="quiet" onPress={() => setAutoProgress(null)}>{t("Dismiss")}</Button>}
            </div>
            {!autoBusy && autoProgress.remaining.length > 0 && <>
              <p>{t("Choose an owner below, or configure automatic assignment in Sales settings.")}</p>
              <ul>{autoProgress.remaining.map(item => {
                const record = items.find(lead => lead.id === item.id);
                return <li key={item.id}><div><strong>{item.name}</strong><small>{item.reason.includes("policy") || item.reason.includes("fallback queue") ? t("Automatic assignment is not configured.") : translateKnown(t, item.reason)}</small></div>
                  {record ? <Button size="compact" onPress={() => setAssignment(record)}>{t("Choose owner")}</Button> : <Button size="compact" onPress={() => void reloadLeads()}>{t("Refresh enquiries")}</Button>}
                </li>;
              })}</ul>
              <Button size="compact" variant="quiet" onPress={() => openSection("assignment")}>{t("Assignment settings")}</Button>
            </>}
          </section>}
          {seesTeam && unowned > 0 && leadView !== "unassigned" ? <Callout title={unowned === 1 ? t("1 enquiry has no owner") : t("{count} enquiries have no owner", { count: unowned })} tone="warning" actions={<Button size="compact" onPress={() => setLeadView("unassigned")}>{t("Show them")}</Button>}>{t("Assign them before the client waits longer.")}</Callout> : null}
          {incoming.length ? <div className={styles.newRows}><Button size="compact" variant="secondary" onPress={showIncoming}>{incoming.length === 1 ? t("1 new enquiry · Show") : t("{count} new enquiries · Show", { count: incoming.length })}</Button></div> : null}
          <DataGrid keepEmptyTable compactToolbar selectable={false} emptyContent={<div className={styles.illustratedEmpty}><Image src="/images/empty-states/enquiries.png" width={112} height={112} alt={items.length ? t("No matching enquiries") : t("Your enquiries will appear here")} /><span>{items.length ? t("No matching enquiries") : t("No enquiries yet")}</span></div>} key={initialData.workspaceId} ariaLabel={t("CRM enquiries")} persistKey="crm-enquiries-v4" rowNumbers={false} columns={columns} data={visibleItems} getRowId={lead => lead.id}
            initialColumnVisibility={{emirate:false,updatedAt:false,title:false,channel:false,intakeMethod:false,serviceType:false,priority:false,createdAt:false,budgetRange:false,customerType:false,area:false,campaign:false}} searchLabel={t("Search enquiries")} exportFileName="enquiries.csv"

            onRowAction={setCardLead} pageSize={50} hasMoreRows={Boolean(nextCursor)} totalRowCount={items.length}
            emptyTitle={items.length ? t("No matching enquiries") : t("Your enquiries will appear here")} emptyDescription={items.length ? t("Try another view or clear your filters.") : t("Use New enquiry to add one.")}
            toolbarLeading={<ListTabs label={t("Enquiry lists")} value={leadView} onChange={setLeadView} items={[
          { id: "new", label: t("New"), count: viewCount("new") },
          { id: "contacted", label: t("Contacted"), count: viewCount("contacted") },
          { id: "come_back", label: t("Come back to"), count: viewCount("come_back") },
          ...(seesTeam ? [{ id: "unassigned" as const, label: t("Unassigned"), count: viewCount("unassigned") }] : []),
          ...(viewCount("review") ? [{ id: "review" as const, label: t("Needs review"), count: viewCount("review") }] : []),
          ...(viewCount("duplicates") ? [{ id: "duplicates" as const, label: t("Duplicates"), count: viewCount("duplicates") }] : []),
          { id: "all", label: t("All") },
        ]} />}
            toolbarActions={<><IconMenuButton ariaLabel={t("More actions")} items={[{ id: "import", label: t("Import CSV") }, { id: "review", label: t("Intake review") }]} onAction={(id) => id === "import" ? setImportOpen(true) : setReviewOpen(true)} /></>}
            footerActions={<><Button size="compact" variant="quiet" isDisabled={busy || !items.some(lead => !lead.ownerMembershipId && ACTIVE_STATUSES.has(lead.status))} onPress={() => void runAutoAssign()}>{t("Assign unassigned")}</Button>{nextCursor ? <Button isDisabled={busy} isLoading={loadingMore} onPress={() => void loadMore()} size="compact">{t("Load more enquiries")}</Button> : null}<IconButton aria-label={t("Refresh enquiries")} onPress={() => void refresh()} isDisabled={busy} size="compact"><RefreshCw size={14} aria-hidden="true"/></IconButton></>}
          />
        </section>
          </> : null}
          {activeSection === "forms" ? <LeadFormBuilder initialData={initialData} initialBranding={formBranding} onDirtyChange={setFormDirty} onEditingChange={setFormEditing} /> : null}
          {activeSection === "sources" ? <section aria-label={t("Sales lead source connections")}>{integrationsData ? <IntegrationsPage embedded initialData={integrationsData} onlyIds={["whatsapp", "meta_lead_ads"]} /> : integrationsDenied ? <NoAccessNotice area={t("Lead sources")} /> : <Callout title={t("Connections unavailable")} tone="warning">{t("Reload this page to see available lead-source connections.")}</Callout>}</section> : null}
          {activeSection === "options" ? <EnquiryFieldsSettings workspaceId={initialData.workspaceId} leadOptions={leadOptions} regionLabel={areaLabel} onOptionsSaved={setLeadOptions} /> : null}
          {activeSection === "reports" ? <SalesReports initialData={initialData} regionLabel={areaLabel} /> : null}
          {activeSection === "sla" ? <LeadResponseSla initialData={initialData} /> : null}
          {activeSection === "assignment" ? <LeadRouting initialData={initialData} /> : null}
          {activeSection === "automations" ? <SalesAutomations workspaceId={initialData.workspaceId} /> : null}
        </div>

        {cardLead ? <InspectorSheet isOpen onOpenChange={(open) => { if (!open) setCardLead(null); }} size="md" hideTitle title={t("Enquiry details")}><LeadWorkbench initialData={initialData} key={cardLead.id} lead={items.find((item) => item.id === cardLead.id) ?? cardLead} onChanged={() => reloadLeads()} onQualify={setQualificationLead} /></InspectorSheet> : null}
        {importOpen ? <LeadImportDialog initialData={initialData} onClose={() => setImportOpen(false)} onImported={() => reloadLeads()} /> : null}
        {reviewOpen ? <InspectorSheet isOpen onOpenChange={setReviewOpen} size="lg" title={t("Intake review")}><IntakeInbox workspaceId={initialData.workspaceId} onChanged={() => reloadLeads()} /></InspectorSheet> : null}
        {pendingMove && pendingLead ? <MoveLeadDialog lead={pendingLead} move={pendingMove} saving={Boolean(savingLeadId)} onClose={() => setPendingMove(null)} onSave={(details) => saveMove(pendingMove, details)} /> : null}
        {qualificationLead ? <CreateDealDialog lead={qualificationLead} initialData={initialData} onClose={() => setQualificationLead(null)} onCreated={async record => {
          setStatusMessage(t("{name}: opportunity created.", { name: customerDisplayName(qualificationLead.partyName) }));
          setQualificationLead(null); setCardLead(null);
          router.push(`/workspace/crm/opportunities?record=${encodeURIComponent(record.id)}`);
        }} /> : null}

        {createOpen ? <LeadEnquiryForm initialData={initialData} onClose={() => setCreateOpen(false)} onOpenLead={(leadId) => { setCreateOpen(false); setLinkedLead(leadId); }} onSaved={async (_leadId, reference) => {
          await reloadLeads();
          setCreateOpen(false);
          setStatusMessage(reference ? t("Enquiry {reference} created.", { reference }) : t("Enquiry created."));
        }} /> : null}


        {assignment ? <LeadAssignmentDialog workspaceId={initialData.workspaceId} lead={assignment} members={salesOwnerChoices(initialData)} onClose={() => setAssignment(null)} onSaved={(result) => {
          const saved = result as unknown as Pick<CrmLeadListItem, "id" | "ownerMembershipId" | "queueId" | "nextActionAt" | "version" | "status" | "updatedAt">;
          if (!saved.id || !Number.isInteger(saved.version)) throw new Error(t("Assignment response could not be confirmed."));
          setItems((current) => current.map((lead) => lead.id === saved.id ? {
            ...lead, ...saved,
            ownerName: initialData.members.find((member) => member.id === saved.ownerMembershipId)?.displayName ?? null,
            queueName: initialData.queues.find((queue) => queue.id === saved.queueId)?.name ?? lead.queueName,
          } : lead));
          if (saved.ownerMembershipId) setAutoProgress(current => current ? { ...current, assigned: current.assigned + 1, remaining: current.remaining.filter(item => item.id !== saved.id) } : null);
          setStatusMessage(saved.ownerMembershipId ? t("Assignment updated.") : t("No available sales owner. The enquiry remains in its queue."));
        }} /> : null}
        {followUp ? <NewFollowUpDialog workspaceId={initialData.workspaceId} initialLead={{ ...followUp }} onClose={() => setFollowUp(null)} onCreated={async () => { await reloadLeads(); setFollowUp(null); setStatusMessage(t("Follow-up scheduled.")); }} /> : null}
        {contactLead ? <LogContactDialog workspaceId={initialData.workspaceId} slaPolicies={initialData.slaPolicies} lead={{ id: contactLead.id, version: contactLead.version, name: customerDisplayName(contactLead.partyName) }} onClose={() => setContactLead(null)} onLogged={(saved, outcome) => {
          setItems((current) => current.map((item) => item.id === contactLead.id ? { ...item, status: saved.status as CrmLeadStatus, version: saved.version, nextActionAt: saved.nextActionAt, updatedAt: saved.updatedAt ?? item.updatedAt, ...(saved.contactAttempts !== undefined ? { contactAttempts: saved.contactAttempts } : {}), slaStatus: item.slaStatus === "active" || item.slaStatus === "warning" || item.slaStatus === "breached" ? "met" : item.slaStatus } : item));
          setStatusMessage(saved.contactAttempts && (outcome === "no_answer" || outcome === "message_sent_no_reply")
            ? t("{name} · Attempt {count} logged.", { name: customerDisplayName(contactLead.partyName), count: saved.contactAttempts })
            : t("{name} · Contact logged.", { name: customerDisplayName(contactLead.partyName) }));
          setContactLead(null);
        }} /> : null}
        {confirmationDialog}
      </>}
    </section>
  </DesignSystemProvider>;
}

function MoveLeadDialog({ lead, move, saving, onClose, onSave }: { lead: CrmLeadListItem; move: LeadMove; saving: boolean; onClose: () => void; onSave: (details: { reason?: string; nextActionAt?: string }) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const needsReason = move.status === "disqualified";
  const needsDate = ACTIVE_STATUSES.has(move.status) && !lead.ownerMembershipId && !lead.nextActionAt;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (needsReason && !reason.trim()) { setError(t("Add a short reason for this change.")); return; }
    if (needsDate && (!date || Number.isNaN(Date.parse(date)))) { setError(t("Choose the next follow-up date and time.")); return; }
    try { await onSave({ ...(needsReason ? { reason: reason.trim() } : {}), ...(needsDate ? { nextActionAt: new Date(date).toISOString() } : {}) }); }
    catch (error) { setError(error instanceof Error ? error.message : t("The lead could not be moved.")); }
  };
  return <InspectorSheet isOpen onOpenChange={(open) => { if (!open && !saving) onClose(); }} title={t("Move to {stage}", { stage: t(stageLabel(move.status)) })} size="md">
    <form className={styles.leadForm} onSubmit={submit}>
      <p className={styles.muted}>{customerDisplayName(lead.partyName)} · {lead.title}</p>
      {needsReason ? <TextAreaField label={t("Reason")} isRequired maxLength={160} value={reason} onChange={setReason} placeholder={t("Briefly explain this stage change…")} /> : null}
      {needsDate ? <div className={styles.followUpField}><CrmDateTimeField label={t("Next follow-up")} isRequired isDisabled={saving} value={date} onChange={setDate} /><small>{t("An unassigned active enquiry needs a follow-up date.")}</small></div> : null}
      {error ? <Callout title={t("Stage not saved")} tone="danger">{error}</Callout> : null}
      <div className={styles.dialogActions}><Button onPress={onClose} isDisabled={saving}>{t("Cancel")}</Button><Button type="submit" variant="primary" isLoading={saving}>{t("Save stage")}</Button></div>
    </form>
  </InspectorSheet>;
}
