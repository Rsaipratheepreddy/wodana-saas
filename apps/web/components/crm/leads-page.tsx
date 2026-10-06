"use client";

import { useRouter } from "next/navigation";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, CalendarDays, CheckCircle2, BriefcaseBusiness, ContactRound, Globe, ListFilter, PhoneCall, Plus, RefreshCw, Timer, Type, UserRoundPlus, UsersRound } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  ListTabs,
  DataGrid,
  IconButton,
  InspectorSheet,
  NoAccessNotice,
  NoAccessState,
  EmptyState,
  NoResultsState,
  PageShell,
  RecordName,
  type DataGridColumn,
  type ToolbarFilter,
  DesignSystemProvider,
  FormDialog,
  TextAreaField,
  formatDate,
  useConfirmationDialog,
  useDesignSystem,
  type SaveProblem,
} from "@/design-system";
import { CrmRequestError } from "@/lib/crm/client";
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
import Link from "next/link";
import { quickConversion, quickConvert } from "@/lib/crm/quick-convert";
import { CreateDealDialog } from "./create-deal-dialog";
import { EnquiryBulkActions, EnquiryBulkDialog, type BulkMode } from "./enquiry-bulk-actions";
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
import { zonedDateTimeToIso, zonedToUtc, zonedToday } from "@/lib/crm/zoned-time";
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

type EnquiryView = "my_day" | "new" | "contacted" | "come_back" | "all" | "unassigned" | "review" | "duplicates";
/** New enquiries are worked in respond-by order: the most urgent first (S-6). */
const respondOrder = (lead: CrmLeadListItem) => lead.slaDueAt && ["active", "warning", "breached"].includes(lead.slaStatus ?? "") ? Date.parse(lead.slaDueAt) : Number.POSITIVE_INFINITY;
/** How often the list checks for new and changed enquiries while it is on screen (S-5). */
const REFRESH_EVERY = 30_000;
/** How long a notice on the enquiry list stays before it goes. */
const NOTICE_MS = 8_000;
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
    // A day or more late reads in days ("29d overdue"), in the person's own unit style.
    if (hours >= 24) return { label: t("{duration} overdue", { duration: new Intl.NumberFormat(localFormat.locale, { style: "unit", unit: "day", unitDisplay: "narrow" }).format(Math.floor(hours / 24)) }), overdue: true };
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
  // Whoever assigns enquiries sees the team; salespeople see their own (PLM-076). A permission, never a role name.
  const seesTeam = serverData.canAssign !== false || !serverData.currentMembershipId;
  // S-30: everyone with enquiries of their own opens on My day: new ones, and those due today or overdue.
  const [leadView, setLeadView] = useState<EnquiryView>(serverData.currentMembershipId ? "my_day" : "all");
  // Enquiries to check (a possible existing client, or a duplicate) are a filter, not more tabs (at most six).
  const [check, setCheck] = useState<"review" | "duplicates" | undefined>();
  const [contactLead, setContactLead] = useState<CrmLeadListItem | null>(null);
  const [savingLeadId, setSavingLeadId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<LeadMove | null>(null);
  const [qualificationLead, setQualificationLead] = useState<CrmLeadListItem | null>(null);
  const [convertProblems, setConvertProblems] = useState<SaveProblem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const mutationInFlight = useRef(false);
  const [cardLead, setCardLead] = useState<CrmLeadListItem | null>(null);
  const [createOpen, setCreateOpen] = useState(initialCreate);
  const [importOpen, setImportOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const activeSection = initialSection;
  const [assignment, setAssignment] = useState<CrmLeadListItem | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  // One-click Convert (S-39): the opportunity just made, to open from the enquiry list.
  const [converted, setConverted] = useState<{ name: string; id: string } | null>(null);
  // A notice says what just happened and then goes; a newer one takes its place (they never stack).
  useEffect(() => { if (!statusMessage) return; const timer = window.setTimeout(() => setStatusMessage(""), NOTICE_MS); return () => window.clearTimeout(timer); }, [statusMessage]);
  useEffect(() => { if (!converted) return; const timer = window.setTimeout(() => setConverted(null), NOTICE_MS * 2); return () => window.clearTimeout(timer); }, [converted]);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  // Bulk actions (S-17): select enquiries, then assign, change status, add a follow-up or close; each is its own command.
  const [bulk, setBulk] = useState<{ mode: BulkMode; rows: CrmLeadListItem[] } | null>(null);
  const [bulkRound, setBulkRound] = useState(0);
  const canBulk = Boolean(initialData.canAssign || initialData.canEdit);
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
  // The end of today in the workspace's zone: a follow-up before it is due today or overdue.
  const endOfToday = useMemo(() => {
    const [year, month, day] = zonedToday(timeZone, new Date(now)).split("-").map(Number);
    return Date.parse(zonedToUtc(new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10), "00:00", timeZone) ?? "") || Number.POSITIVE_INFINITY;
  }, [now, timeZone]);
  const inView = (lead: CrmLeadListItem, view: EnquiryView) => {
    if (lead.isConverted && view !== "all") return false;
    if (view === "all") return true;
    if (view === "my_day") return lead.ownerMembershipId === serverData.currentMembershipId && ACTIVE_STATUSES.has(lead.status) && lead.status !== "paused"
      && (lead.status === "new" || Number.isFinite(respondOrder(lead)) || (lead.nextActionAt !== null && Date.parse(lead.nextActionAt) < endOfToday));
    if (view === "unassigned") return ACTIVE_STATUSES.has(lead.status) && !lead.ownerMembershipId;
    if (view === "review") return Boolean(lead.clientMatches) && lead.status !== "duplicate";
    if (view === "duplicates") return lead.status === "duplicate";
    return listOf(lead.status) === view;
  };
  const visibleItems = useMemo(() => {
    const listed = scoped.filter((lead) => inView(lead, leadView) && (!check || inView(lead, check)));
    // New and My day read in the order they need a reply: respond-by first, then the follow-up that's due.
    const due = (lead: CrmLeadListItem) => (lead.nextActionAt ? Date.parse(lead.nextActionAt) : Number.POSITIVE_INFINITY);
    return leadView === "new" || leadView === "my_day" ? [...listed].sort((a, b) => respondOrder(a) - respondOrder(b) || due(a) - due(b)) : listed;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, leadView, check, endOfToday]);
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
  /**
   * One-click Convert (S-39): with the enquiry's own title and owner, the default pipeline and a follow-up
   * (its own if one is ahead, else tomorrow 10:00), the opportunity is made at once and the list stays open with a
   * "View opportunity" link. Anything missing opens the full dialog instead.
   */
  const convertNow = async (lead: CrmLeadListItem) => {
    const body = quickConversion(lead, initialData, timeZone);
    if (!body) { setQualificationLead(lead); return; }
    setConvertingId(lead.id); setFailure(""); setConverted(null);
    try {
      const record = await quickConvert(initialData.workspaceId, lead, body);
      setStatusMessage("");
      setConverted({ name: customerDisplayName(lead.partyName), id: String(record.id) });
      await reloadLeads();
    } catch (error) {
      // PLM-096: what the enquiry type still needs shows in the conversion dialog, every item at once.
      if (error instanceof CrmRequestError && error.missing.length) setConvertProblems(error.missing);
      else setFailure(error instanceof Error ? translateKnown(t, error.message) : t("Could not convert the enquiry."));
      setQualificationLead(lead);
    } finally { setConvertingId(null); }
  };
  // Converting can't be undone, so the row button asks first (the full dialog opens instead when details are missing).
  const confirmConvert = (lead: CrmLeadListItem) => {
    if (!quickConversion(lead, initialData, timeZone)) { setQualificationLead(lead); return; }
    const name = customerDisplayName(lead.partyName);
    requestConfirmation({ title: t("Convert {name} to an opportunity?", { name }), body: t("A converted enquiry can't be changed back."), confirmLabel: t("Convert"), confirmVariant: "primary", onConfirm: () => void convertNow(lead) });
  };
  // Leaving for a linked record closes the enquiry sheet first; navigating with it open leaves its modal over the next page.
  const [leavingFor, setLeavingFor] = useState<string | null>(null);
  const openRecord = (href: string) => { setCardLead(null); setLinkedLead(undefined); setLeavingFor(href); };
  useEffect(() => {
    if (!leavingFor || cardLead || linkedLead) return;
    setLeavingFor(null);
    router.push(leavingFor);
  }, [leavingFor, cardLead, linkedLead, router]);
  const opportunityHref = (id: string) => `/workspace/crm/opportunities?record=${encodeURIComponent(id)}`;
  const busy = Boolean(savingLeadId || refreshing || loadingMore || pendingMove || qualificationLead || autoBusy);
  const sourceLabel = (source: string) => initialData.leadOptions?.sources.find(option => option.id === source)?.label ?? humanize(source, notSet);
  // Hidden enquiry fields leave the list; the workspace's own fields become columns.
  const fieldList = useMemo(() => enquiryFields(serverData.enquiryFields, ""), [serverData.enquiryFields]);
  const shown = (key: string) => isShown(fieldList, key);
  const customColumns = fieldList.filter((field) => field.custom && field.visible);
  const statusText = (lead: CrmLeadListItem) => lead.isConverted ? t("Converted") : lead.status === "duplicate" ? t("Duplicate") : lead.status === "qualified" ? t("Qualified") : lead.status === "disqualified" ? t("Not interested") : listOf(lead.status) === "come_back" ? t("Come back later") : listOf(lead.status) === "contacted" ? t("Contacted") : t("New");
  const statusTone = (lead: CrmLeadListItem): "success" | "info" | "warning" | "neutral" | "danger" => lead.isConverted || lead.status === "qualified" ? "success" : lead.status === "disqualified" ? "neutral" : listOf(lead.status) === "come_back" ? "warning" : listOf(lead.status) === "new" ? "info" : "neutral";
  // The default columns (with the row checkbox) add up to the content area at 1440 px, so Log contact and Convert
  // stay in view; their text wraps inside the cells (leads-page.module.css).
  const columns: DataGridColumn<CrmLeadListItem>[] = [
    { accessorKey: "partyName", header: t("Customer"), size: 190, meta: { primary: true, interactive: true }, cell: ({row:{original:lead}}) => { const name = customerDisplayName(lead.partyName); return <RecordName detail={lead.reference} title={<button type="button" className={styles.sheetLead} data-tour={!lead.isConverted && !["disqualified", "paused"].includes(lead.status) && hasResolvedEnquiryType(lead.serviceType) ? "enquiry-customer" : undefined} data-tour-safe onClick={() => setCardLead(lead)} aria-label={t("Open {name}", { name })} title={name}>{name}</button>} />; } },
    { accessorKey: "title", header: t("Enquiry title"), size: 240, meta: {}, cell: ({getValue}) => <span className={styles.sheetText} title={String(getValue())}>{String(getValue())}</span> },
    { id: "status", header: t("Status"), size: 118, accessorFn: lead => statusText(lead), meta: {}, cell: ({row:{original:lead}}) => <span className={styles.attentionFlags}>
      <Badge tone={statusTone(lead)}>{statusText(lead)}</Badge>
      {lead.clientMatches && lead.status !== "duplicate" ? <Badge tone="warning">{t("Confirm client")}</Badge> : null}
      {lead.contactAttempts && ACTIVE_STATUSES.has(lead.status) ? <Badge tone="neutral">{t("Attempt {count}", { count: lead.contactAttempts })}</Badge> : null}
      {lead.escalatedAt && ACTIVE_STATUSES.has(lead.status) ? <Badge tone="danger">{t("Escalated")}</Badge> : null}
    </span> },
    { id: "respondBy", header: t("Respond by"), size: 128, accessorFn: lead => Number.isFinite(respondOrder(lead)) ? lead.slaDueAt : undefined, sortUndefined: "last", meta: { priority: "medium" }, cell: ({row:{original:lead}}) => respondBy(lead, now) ? <RespondByChip compact lead={lead} now={now} /> : <span className={styles.sheetText}>—</span> },
    { id: "source", header: t("Source"), size: 130, accessorFn: lead => sourceLabel(lead.source), filterFn: "equalsString", meta: { priority: "low", filterOptions: sources.map(source=>({id:sourceLabel(source),label:sourceLabel(source)})) }, cell: ({row:{original:lead}}) => <span className={styles.sourceCell}><SourceChip source={lead.source} displayLabel={sourceLabel(lead.source)} />
      {lead.channel ? <small>{initialData.leadOptions?.channels[lead.source]?.find(option => option.id === lead.channel)?.label ?? humanize(lead.channel, notSet)}</small> : null}</span> },
    { id: "channel", header: t("Channel"), size: 140, accessorFn: lead => initialData.leadOptions?.channels[lead.source]?.find(option => option.id === lead.channel)?.label ?? humanize(lead.channel, notSet), meta: {} },
    { id: "intakeMethod", header: t("Captured via"), size: 145, accessorFn: lead => humanize(lead.intakeMethod ?? null, notSet), cell: ({ row }) => <span className={styles.intakeChip}>{humanize(row.original.intakeMethod ?? null, notSet)}</span> },
    { id: "serviceType", header: t("Service required"), size: 195, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.enquiryTypes, lead.serviceType), cell: ({ row }) => <span className={styles.serviceChip} data-missing={!hasResolvedEnquiryType(row.original.serviceType) || undefined}>{!hasResolvedEnquiryType(row.original.serviceType) ? t("To confirm") : leadOptionLabel(initialData.leadOptions?.enquiryTypes, row.original.serviceType)}</span>, meta: {} },
    { accessorKey: "ownerName", header: t("Assigned to"), size: 150, meta: { priority: "medium" }, cell: ({row:{original:lead}}) => <div className={styles.managerCell}><button type="button"
      aria-label={t("Assign {name}", { name: customerDisplayName(lead.partyName) })} title={lead.ownerName ? t("{name} · Reassign", { name: lead.ownerName }) : t("Choose sales owner")}
      className={styles.assigneeButton} disabled={busy || lead.isConverted || ["qualified", "disqualified"].includes(lead.status)} onClick={() => setAssignment(lead)}>
      {lead.ownerName ? <Avatar name={lead.ownerName} roles={["sales"]} seed={lead.ownerMembershipId ?? lead.ownerName} size="sm" /> : <UserRoundPlus aria-hidden="true" size={16} />}
      <span>{lead.ownerName ?? t("Unassigned")}</span>
    </button>{!lead.ownerMembershipId && ACTIVE_STATUSES.has(lead.status) && !lead.isConverted ? <Button size="compact" isDisabled={busy} onPress={() => void runAutoAssign(lead)} aria-label={t("Auto-assign {name}", { name: customerDisplayName(lead.partyName) })}>{t("Auto")}</Button> : null}</div> },
    { accessorKey: "nextActionAt", header: t("Next follow-up"), size: 163, meta: {}, cell: ({row:{original:lead}}) => {
      if (lead.status === "qualified") return <Button size="compact" variant="quiet" onPress={() => setCardLead(lead)}>{t("View linked records")}</Button>;
      const action = nextActionLabel(lead.nextActionAt, now, lead.status, t, localFormat);
      return <Button size="compact" className={styles.nextAction} data-overdue={action.overdue || undefined} isDisabled={busy || lead.isConverted || ["qualified", "disqualified"].includes(lead.status)} aria-label={t("Follow up with {name}", { name: customerDisplayName(lead.partyName) })} onPress={() => scheduleFollowUp(lead)}><CalendarClock size={14} aria-hidden="true" />{lead.nextActionAt ? action.label : t("Schedule")}</Button>;
    } },
    { id: "contact", header: t("Action"), size: 126, meta: {}, enableSorting: false, cell: ({row:{original:lead}}) => ACTIVE_STATUSES.has(lead.status) && !lead.isConverted ? <Button size="compact" variant="secondary" isDisabled={busy} aria-label={t("Log contact · {name}", { name: customerDisplayName(lead.partyName) })} onPress={() => setContactLead(lead)}><PhoneCall size={14} aria-hidden="true" />{t("Log contact")}</Button> : null },
    { id: "priority", header: t("Priority"), size: 120, accessorFn: lead => humanize(lead.priority, notSet), meta: {} },
    ...(shown("budgetRange") ? [{ id: "budgetRange", header: t("Budget range"), size: 180, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.budgetRanges, lead.details?.budgetRange) } as DataGridColumn<CrmLeadListItem>] : []),
    ...(shown("customerType") ? [{ id: "customerType", header: t("Customer type"), size: 140, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.customerTypes, lead.details?.customerType) } as DataGridColumn<CrmLeadListItem>] : []),
    ...(initialData.leadOptions?.emirates.length ? [{ id: "emirate", header: areaLabel, size: 160, accessorFn: lead => leadOptionLabel(initialData.leadOptions?.emirates, lead.details?.emirate), filterFn: "equalsString", meta: { filterOptions: (initialData.leadOptions?.emirates ?? []).map(option => ({ id: option.label, label: option.label })) } } as DataGridColumn<CrmLeadListItem>] : []),
    ...(shown("area") ? [{ id: "area", header: t("Area / city"), size: 190, accessorFn: lead => lead.details?.area ?? lead.details?.location ?? "" } as DataGridColumn<CrmLeadListItem>] : []),
    { id: "campaign", header: t("Campaign"), size: 160, accessorFn: lead => lead.details?.campaign ?? "" },
    ...customColumns.map((field) => ({ id: field.key, header: field.label, size: 190, accessorFn: (lead: CrmLeadListItem) => customValueText(lead.customFields?.[field.custom!.id]), cell: ({ getValue }: { getValue: () => unknown }) => <span className={styles.sheetText} title={String(getValue())}>{String(getValue())}</span> })),
    { accessorKey: "updatedAt", header: t("Last updated"), size: 120, cell: ({row:{original:lead}}) => formatDate(new Date(lead.updatedAt), localFormat, {day:'numeric',month:'short',year:'numeric'}) },
    { accessorKey: "createdAt", header: t("Created"), size: 150, meta: {}, cell: ({row:{original:lead}}) => formatDate(new Date(lead.createdAt), localFormat, {day:'numeric',month:'short',year:'numeric'}) },
    { id: "dealAction", header: t("Opportunity"), size: 136, enableSorting: false, cell: ({ row: { original: lead } }) => lead.isConverted
      ? <Button size="compact" variant="quiet" onPress={() => lead.opportunityId ? router.push(opportunityHref(lead.opportunityId)) : setCardLead(lead)}>{t("View opportunity")}</Button>
      : ["disqualified", "paused"].includes(lead.status) ? <span className={styles.sheetText}>—</span>
      : !hasResolvedEnquiryType(lead.serviceType) ? <Button size="compact" className={styles.createDeal} isDisabled={busy} aria-label={t("Choose enquiry type for {name}", { name: customerDisplayName(lead.partyName) })} onPress={() => setCardLead(lead)}>{t("Choose type")}</Button>
      : <Button size="compact" className={styles.createDeal} data-tour="enquiry-convert" data-tour-safe isDisabled={busy} isLoading={convertingId === lead.id} aria-label={t("Convert {name} to opportunity", { name: customerDisplayName(lead.partyName) })} onPress={() => confirmConvert(lead)}>{t("Convert")}</Button> },
  ];
  const pendingLead = pendingMove ? items.find((lead) => lead.id === pendingMove.leadId) : undefined;
  const add = () => setCreateOpen(true);
  // At most six lists; a count shows only on a list that asks for action (My day, New, Unassigned).
  const leadTabs: Array<{ id: EnquiryView; label: string; count?: number }> = [
    ...(serverData.currentMembershipId ? [{ id: "my_day" as const, label: t("My day"), count: viewCount("my_day") }] : []),
    { id: "new", label: t("New"), count: viewCount("new") },
    { id: "contacted", label: t("Contacted") },
    { id: "come_back", label: t("Come back to") },
    ...(seesTeam ? [{ id: "unassigned" as const, label: t("Unassigned"), count: viewCount("unassigned") }] : []),
    { id: "all", label: t("All") },
  ];
  const checkOptions = [...(viewCount("review") ? [{ id: "review", label: t("Needs review") }] : []), ...(viewCount("duplicates") ? [{ id: "duplicates", label: t("Duplicates") }] : [])];
  const checkFilters: ToolbarFilter[] = checkOptions.length || check ? [{ id: "check", label: t("To check"), options: checkOptions, value: check,
    // A duplicate is in no working list, so checking one shows All.
    onChange: (value) => { setCheck(value as typeof check); if (value) setLeadView("all"); } }] : [];
  const workspaceArea = activeSection === "leads" ? "work" : activeSection === "forms" || activeSection === "sources" ? "capture" : activeSection === "assignment" || activeSection === "sla" ? "response" : "performance";
  return <DesignSystemProvider className={`${styles.provider} ${theme.theme}`} portalContainer={portalContainer} ref={setPortalContainer}>
    {/* One title per section, with New enquiry top-end on the list (S-20); the lists sit under the title. */}
    <PageShell aria-label={t("Enquiries workspace")} title={t(SECTION_AREA[activeSection])}
      action={activeSection === "leads" && initialData.canView ? <Button variant="primary" onPress={add}><Plus size={15} aria-hidden="true"/>{t("New enquiry")}</Button> : undefined}
      tabs={activeSection === "leads" && initialData.canView && !sectionDenied ? <ListTabs label={t("Enquiry lists")} value={leadView} onChange={setLeadView} items={leadTabs} />
        : workspaceArea === "capture" && !sectionDenied && !(activeSection === "forms" && formEditing) ? <ListTabs label={t("Capture settings")} value={activeSection} onChange={openSection} items={[{ id: "forms", label: t("Forms") }, { id: "sources", label: t("Lead sources") }]} /> : undefined}>

      {!initialData.canView ? <NoAccessState area={t("Enquiries")} /> : sectionDenied ? <NoAccessState area={t(SECTION_AREA[activeSection])} /> : <>
        {linkedLead ? <InspectorSheet isOpen hideTitle title={t("Enquiry details")} size="xl" onOpenChange={(open) => { if (!open) setLinkedLead(undefined); }}><LinkedLeadWorkbench leadId={linkedLead} initialData={initialData} onChanged={() => reloadLeads()} onQualify={setQualificationLead} onOpenRecord={openRecord} /></InspectorSheet> : null}
        {failure ? <Callout title={t("Enquiries could not be updated")} tone="danger">{failure}</Callout> : null}
        {statusMessage ? <p aria-live="polite" className={styles.statusMessage}>{statusMessage}</p> : null}
        {converted && !statusMessage ? <p aria-live="polite" className={styles.statusMessage}>{t("{name}: opportunity created.", { name: converted.name })} <Link href={`/workspace/crm/opportunities?record=${encodeURIComponent(converted.id)}`}>{t("View opportunity")}</Link></p> : null}

        <div className={styles.sections}>
          {activeSection === "leads" ? <>
        <section data-sales-grid data-tour="enquiry-list" aria-label={t("Enquiries")} className={`${styles.boardRegion} ${styles.sheet}`}>
          {autoProgress && <section className={styles.assignmentSummary} aria-label={t("Assignment results")}>
            <div className={styles.assignmentSummaryHeader}>
              <strong role="status">{autoBusy ? t("Assigning enquiries… {completed}/{total}", { completed: autoProgress.completed, total: autoProgress.total }) : autoProgress.remaining.length ? (autoProgress.remaining.length === 1 ? t("1 enquiry needs an owner") : t("{count} enquiries need an owner", { count: autoProgress.remaining.length }))
                : autoProgress.assigned === 1 ? t("1 enquiry assigned") : t("{count} enquiries assigned", { count: autoProgress.assigned })}</strong>
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
          <DataGrid gridKey="crm.enquiries" keepEmptyTable compactToolbar selectable={canBulk} key={`${initialData.workspaceId}:${bulkRound}`} bulkActions={canBulk ? (selected) => <EnquiryBulkActions rows={selected} onPick={(mode, picked) => setBulk({ mode, rows: picked })} /> : undefined}
            emptyContent={check || (items.length && leadView !== "my_day") ? <NoResultsState onClear={() => { setCheck(undefined); setLeadView("all"); }} />
              : <EmptyState illustration="empty" title={items.length ? t("You're all caught up") : t("Your enquiries will appear here")} action={items.length ? undefined : <Button variant="primary" onPress={add}>{t("New enquiry")}</Button>} />}
            ariaLabel={t("CRM enquiries")} persistKey="crm-enquiries-v4" rowNumbers={false} columns={columns} data={visibleItems} getRowId={lead => lead.id}
            initialColumnVisibility={{emirate:false,updatedAt:false,title:false,channel:false,intakeMethod:false,serviceType:false,priority:false,createdAt:false,budgetRange:false,customerType:false,area:false,campaign:false}} searchLabel={t("Search enquiries")} exportFileName="enquiries.csv"
            onRowAction={setCardLead} pageSize={50} hasMoreRows={Boolean(nextCursor)} totalRowCount={items.length} filters={checkFilters}
            menuActions={[{ id: "import", label: t("Import CSV") }, { id: "review", label: t("Intake review") }]} onMenuAction={(id) => id === "import" ? setImportOpen(true) : setReviewOpen(true)}
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

        {cardLead ? <InspectorSheet isOpen onOpenChange={(open) => { if (!open) setCardLead(null); }} size="xl" hideTitle title={t("Enquiry details")}><LeadWorkbench initialData={initialData} key={cardLead.id} lead={items.find((item) => item.id === cardLead.id) ?? cardLead} onChanged={() => reloadLeads()} onQualify={setQualificationLead} onOpenRecord={openRecord} /></InspectorSheet> : null}
        {importOpen ? <LeadImportDialog initialData={initialData} onClose={() => setImportOpen(false)} onImported={() => reloadLeads()} /> : null}
        {reviewOpen ? <InspectorSheet isOpen onOpenChange={setReviewOpen} size="lg" title={t("Intake review")}><IntakeInbox workspaceId={initialData.workspaceId} onChanged={() => reloadLeads()} /></InspectorSheet> : null}
        {pendingMove && pendingLead ? <MoveLeadDialog lead={pendingLead} move={pendingMove} saving={Boolean(savingLeadId)} onClose={() => setPendingMove(null)} onSave={(details) => saveMove(pendingMove, details)} /> : null}
        {bulk ? <EnquiryBulkDialog mode={bulk.mode} rows={bulk.rows} initialData={initialData} onClose={() => setBulk(null)}
          onDone={async (summary) => { setStatusMessage(summary); setBulkRound((round) => round + 1); await reloadLeads(); }} /> : null}
        {qualificationLead ? <CreateDealDialog lead={qualificationLead} initialData={initialData} initialProblems={convertProblems} onClose={() => { setQualificationLead(null); setConvertProblems([]); }} onCreated={async record => {
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
    </PageShell>
  </DesignSystemProvider>;
}

function MoveLeadDialog({ lead, move, saving, onClose, onSave }: { lead: CrmLeadListItem; move: LeadMove; saving: boolean; onClose: () => void; onSave: (details: { reason?: string; nextActionAt?: string }) => Promise<void> }) {
  const t = useT();
  // The follow-up is the workspace's wall clock (its region's zone).
  const { timeZone } = useDesignSystem();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const needsReason = move.status === "disqualified";
  const needsDate = ACTIVE_STATUSES.has(move.status) && !lead.ownerMembershipId && !lead.nextActionAt;
  const submit = async () => {
    if (needsReason && !reason.trim()) throw new Error(t("Add a short reason for this change."));
    const nextActionAt = needsDate && date ? zonedDateTimeToIso(date, timeZone) : null;
    if (needsDate && !nextActionAt) throw new Error(t("Choose the next follow-up date and time."));
    await onSave({ ...(needsReason ? { reason: reason.trim() } : {}), ...(nextActionAt ? { nextActionAt } : {}) });
  };
  return <FormDialog description={`${customerDisplayName(lead.partyName)} · ${lead.title}`} errorTitle={t("Stage not saved")} isDirty={Boolean(reason.trim() || date)} isSubmitting={saving}
    onClose={onClose} onSubmit={submit} submitLabel={t("Save stage")} title={t("Move to {stage}", { stage: t(stageLabel(move.status)) })}>
    {needsReason ? <TextAreaField label={t("Reason")} isRequired maxLength={160} value={reason} onChange={setReason} placeholder={t("Briefly explain this stage change…")} /> : null}
    {needsDate ? <CrmDateTimeField label={t("Next follow-up")} isRequired isDisabled={saving} value={date} onChange={setDate} /> : null}
    {!needsReason && !needsDate ? <p className={styles.muted}>{t("Move this enquiry to {stage}?", { stage: t(stageLabel(move.status)) })}</p> : null}
  </FormDialog>;
}
