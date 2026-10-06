"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarClock, CircleDollarSign, Flag, UserRound, UserRoundCheck } from "lucide-react";
import {
  Badge, Button, EditableField, EditableFieldList, EmptyState, FactRow, FormDialog, IconMenuButton, InlineNotice, PersonName, Progress, SelectField, Skeleton, TextAreaField,
  type ActionItem,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { caseApi, caseRequest } from "@/lib/pre-project/content";
import type { DefinitionPageData } from "@/lib/pre-project/definition";
import type { JourneyView } from "@/lib/pre-project/design-workspace";
import { caseHref, type PreProjectCase } from "@/lib/pre-project/types";
import {
  casePhases, casePhaseText, effectivePhase, caseActivity, caseFiles, caseMoney, caseNextStep, caseOverdue, casePosition, caseTeam, caseTimeline,
  type CaseCommand, type CaseNextStep, type Message,
} from "@/lib/pre-project/case-record";
import type { CommercialState } from "@/lib/commercial/types";
import { projectApi } from "@/lib/project-core/client";
import type { ProjectDetail } from "@/lib/project-core/types";
import { NextStepCard, RecordColumns, RecordFrame, RecordHeader, RecordPanel, RecordStrip, SideSection, StripItem } from "@/components/record/record-layout";
import { ActivityList, FactList, FileList, PeopleList, PersonChip, PersonRow, RecordTimeline } from "@/components/record/record-parts";
import { SiteLocation } from "@/components/ui/site-location";
import { useProjectFormat } from "@/components/project-core/format";
import { DesignJourney } from "./design-journey";
import { ClientCallsSection } from "./client-calls";
import { casePriorityLabel, caseRiskLabel, caseStatusLabel, caseStatusTone } from "./case-spine";

type Action = "hold" | "resume" | "cancel" | "reopen" | "set_phase";
type Member = { id: string; displayName: string; email?: string | null };
const phases = ["discover", "define", "design", "price", "agree", "release"] as const;
const actionLabel: Record<Action, MessageKey> = { hold: tKey("Put on hold"), resume: tKey("Resume"), cancel: tKey("Cancel planning"), reopen: tKey("Reopen planning"), set_phase: tKey("Change stage") };
const actionNotice: Record<Action, MessageKey> = { hold: tKey("Put on hold recorded."), resume: tKey("Resume recorded."), cancel: tKey("Cancel planning recorded."), reopen: tKey("Reopen planning recorded."), set_phase: tKey("Change stage recorded.") };

/** A message from the record logic in the person's language; a stage name inside it is translated too. */
export function say(t: Translate, message: Message | { text: string } | null | undefined) {
  if (!message) return "";
  if ("text" in message) return message.text;
  const values = message.values ? Object.fromEntries(Object.entries(message.values).map(([key, value]) => [key, key === "stage" || key === "section" ? t(String(value) as MessageKey) : value])) : undefined;
  return t(message.key, values);
}

/**
 * A planning case's Overview (§5c D.7): the case in one header, where it stands in one strip, the one next step
 * computed from its real state with the stages under it and the latest activity, and the sidebar's Overview
 * (team, site, dates, money) · Details · Files. The section tabs stay the case's navigation.
 */
export function CaseOverview({ record: initial, workspaceId, members, commercial, onUpdated }: {
  record: PreProjectCase;
  workspaceId: string;
  members: Member[];
  progress?: DefinitionPageData;
  commercial?: CommercialState;
  onUpdated: (record: PreProjectCase) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [record, setRecord] = useState(initial);
  const [action, setAction] = useState<Action | null>(null);
  const [phase, setPhase] = useState<PreProjectCase["phase"]>(initial.phase);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [journey, setJourney] = useState<JourneyView | null | undefined>(undefined);
  const [project, setProject] = useState<ProjectDetail | null | undefined>(record.projectId ? undefined : null);
  const [starting, setStarting] = useState(false);

  // What the next step needs beyond the case: its design stages, and the project it opened. A failure leaves the part out.
  const loadJourney = useCallback(() => caseRequest<JourneyView>(workspaceId, initial.id, "design-journey").then(setJourney).catch(() => setJourney(null)), [workspaceId, initial.id]);
  useEffect(() => { queueMicrotask(() => void loadJourney()); }, [loadJourney]);
  useEffect(() => {
    if (!record.projectId) return;
    projectApi(workspaceId).get(record.projectId).then(setProject).catch(() => setProject(null));
  }, [workspaceId, record.projectId]);

  const phaseIndex = phases.indexOf(record.phase);
  const chosenPhaseIndex = phases.indexOf(phase);
  const reasonRequired = action === "hold" || action === "cancel" || action === "reopen" || (action === "set_phase" && (chosenPhaseIndex < phaseIndex || chosenPhaseIndex > phaseIndex + 1));
  const active = record.status === "active";
  const manageable = Boolean(record.canEditDetails ?? record.canManageLifecycle) && ["draft", "active", "on_hold"].includes(record.status);
  const caseActions: ActionItem[] = record.canManageLifecycle && record.status !== "released" ? [
    ...(active ? [{ id: "set_phase", label: t("Change stage") }, { id: "hold", label: t("Put on hold") }] : []),
    ...(record.status === "on_hold" ? [{ id: "resume", label: t("Resume") }] : []),
    ...(record.status === "cancelled" ? [{ id: "reopen", label: t("Reopen") }] : []),
    ...(["draft", "active", "on_hold"].includes(record.status) ? [{ id: "cancel", label: t("Cancel planning"), tone: "danger" as const }] : []),
  ] : [];

  function update(next: PreProjectCase) {
    const updated = { ...next, canManageLifecycle: record.canManageLifecycle, canEditDetails: record.canEditDetails };
    setRecord(updated);
    setPhase(next.phase);
    onUpdated(updated);
  }

  // One detail changes in place; the others are sent as saved, with the case's version.
  async function saveProfile(changes: { ownerMembershipId?: string; targetDate?: string | null; priority?: PreProjectCase["priority"]; riskLevel?: PreProjectCase["riskLevel"] }) {
    setNotice("");
    const next = await caseRequest<PreProjectCase>(workspaceId, record.id, "profile", "PATCH", {
      requestId: crypto.randomUUID(), version: record.version,
      targetDate: record.targetDate ?? null, priority: record.priority, riskLevel: record.riskLevel,
      ...changes,
    });
    update(next);
  }

  async function transition() {
    if (!action || !record.canManageLifecycle || (reasonRequired && !reason.trim())) return;
    setError(""); setNotice("");
    const next = await caseRequest<PreProjectCase>(workspaceId, record.id, "lifecycle", "POST", {
      requestId: crypto.randomUUID(), version: record.version, action,
      ...(action === "set_phase" ? { phase } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    update(next); setAction(null); setReason(""); setNotice(t(actionNotice[action]));
  }

  async function command(id: CaseCommand) {
    setError("");
    if (id === "resume" || id === "reopen") { setAction(id); return; }
    setStarting(true);
    try { setJourney(await caseRequest<JourneyView>(workspaceId, record.id, "design-journey/start", "POST", {})); setNotice(journey?.startsAs === "site_and_materials" ? t("Site visit started.") : t("Design stages started.")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("The design stages could not start.")); }
    finally { setStarting(false); }
  }

  const closeAction = () => { setAction(null); setReason(""); };
  const date = (value: string) => format.day(value);
  const loading = journey === undefined || project === undefined;
  const portal = <Link className="wd-button" data-size="compact" data-variant="secondary" href={`/workspace/pre-projects/cases/${record.id}/client-portal`}><UserRoundCheck aria-hidden="true" size={15} />{t("Client access")}</Link>;
  const menu = caseActions.length ? <IconMenuButton ariaLabel={t("Project actions")} items={caseActions} onAction={(id) => { setError(""); if (id === "set_phase") setPhase(record.phase); setAction(id as Action); }} /> : null;
  // The journey's own list (schedule, assign, close a stage) while the design stages run.
  const journeySlot = journey?.journey && !["released", "cancelled"].includes(record.status) ? <DesignJourney workspaceId={workspaceId} caseId={record.id} members={members} /> : null;

  const details = <>
    {!manageable && record.status !== "released" ? <p className="wd-visually-hidden">{t("View only · the case owner or an admin can change details")}</p> : null}
    <EditableFieldList>
      {members.length ? <EditableField canEdit={manageable} kind="select" label={t("Owner")} value={record.ownerMembershipId ?? ""} display={<PersonName person={record.engagementOwnerName} fallback={t("Unassigned")} />}
        items={members.map((member) => ({ id: member.id, label: member.displayName }))} onSave={(ownerMembershipId) => saveProfile({ ownerMembershipId })} />
        : <FactRow label={t("Owner")}><PersonName person={record.engagementOwnerName} fallback={t("Unassigned")} /></FactRow>}
      <EditableField canEdit={manageable} kind="date" label={t("Target")} value={record.targetDate ?? ""} display={record.targetDate ? date(record.targetDate) : undefined} placeholder={t("Not set")}
        onSave={(targetDate) => saveProfile({ targetDate: targetDate || null })} />
      <EditableField canEdit={manageable} kind="select" label={t("Priority")} value={record.priority} items={(["low", "normal", "high", "urgent"] as const).map((value) => ({ id: value, label: t(casePriorityLabel[value]) }))}
        onSave={(priority) => saveProfile({ priority: priority as PreProjectCase["priority"] })} />
      <EditableField canEdit={manageable} kind="select" label={t("Risk")} value={record.riskLevel} items={(["none", "low", "medium", "high", "critical"] as const).map((value) => ({ id: value, label: t(caseRiskLabel[value]) }))}
        onSave={(riskLevel) => saveProfile({ riskLevel: riskLevel as PreProjectCase["riskLevel"] })} />
    </EditableFieldList>
  </>;

  return <>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    <CaseRecordView record={record} commercial={commercial} journey={journey ?? null} project={project ?? null} members={members} today={format.today()} loading={loading}
      busy={starting} onCommand={(id) => void command(id)} actions={<>{portal}{menu}</>} details={details} journeySlot={journeySlot}
      callsSlot={<ClientCallsSection workspaceId={workspaceId} caseId={record.id} />}
      assetHref={(assetId) => caseApi(workspaceId, record.id, `assets/${assetId}`)} />
    <FormDialog isOpen={Boolean(action)} title={action ? t(actionLabel[action]) : t("Case action")} onClose={closeAction} isDirty={Boolean(reason.trim())}
      submitLabel={action ? t(actionLabel[action]) : t("Save")} submitVariant={action === "cancel" ? "danger" : "primary"} isSubmitDisabled={action === "set_phase" && phase === record.phase}
      onSubmit={transition}>
      {action === "set_phase" ? <SelectField label={t("Stage")} isRequired items={casePhases(record.plan).map((value) => ({ id: value, label: t(casePhaseText(value, record.plan).stage) }))} selectedKey={phase} onSelectionChange={(key) => setPhase(String(key) as PreProjectCase["phase"])} /> : null}
      {action === "hold" || action === "cancel" || action === "reopen" || action === "set_phase" ? <TextAreaField label={t("Reason")} value={reason} onChange={setReason} isRequired={reasonRequired} maxLength={500} /> : null}
    </FormDialog>
  </>;
}

/** The case record itself, from data only: header, strip, next step, stages, activity and the sidebar. */
export function CaseRecordView({ record, commercial, journey, project, members, today, loading = false, busy = false, onCommand, actions, details, journeySlot, callsSlot, assetHref }: {
  record: PreProjectCase; commercial?: CommercialState | null; journey: JourneyView | null; project: ProjectDetail | null; members: Member[]; today: string;
  loading?: boolean; busy?: boolean; onCommand?: (command: CaseCommand) => void; actions?: ReactNode; details?: ReactNode; journeySlot?: ReactNode;
  /** The recurring client update call (PLM-046), in the sidebar. */
  callsSlot?: ReactNode;
  assetHref: (assetId: string) => string;
}) {
  const t = useT();
  const format = useProjectFormat();
  const input = useMemo(() => ({ record, commercial, journey, project, today }), [record, commercial, journey, project, today]);
  const next = useMemo(() => caseNextStep(input), [input]);
  const money = useMemo(() => caseMoney(commercial), [commercial]);
  const overdue = caseOverdue(input);
  const steps = caseTimeline(input);
  const activity = caseActivity(commercial);
  const people = caseTeam(input, members);
  const files = caseFiles(record, commercial, assetHref);
  const day = (value?: string | null) => (value ? format.short(value.length > 10 ? format.dayOf(value) : value) : "");
  const until = (value?: string | null) => (value ? format.until(value.length > 10 ? format.dayOf(value) : value) : null);
  const position = casePosition(record, commercial);
  const currentStage = project?.stages.find((stage) => stage.status === "current");
  const reference = record.reference ?? commercial?.opportunityReference ?? null;
  // When the work should be done: the case's target while it is planned, the project's handover while the project runs.
  const completeBy = record.projectId ? (project && ["active", "on_hold"].includes(project.project.status) ? project.project.promiseDate : null) : record.status === "released" ? null : record.targetDate;
  const completeUntil = until(completeBy);
  const value = money?.agreed ? { label: t("Agreed value"), amount: money.agreed } : money?.quoted ? { label: t("Quoted"), amount: money.quoted } : record.amount ? { label: t("Estimated value"), amount: record.amount } : null;
  const currency = money?.currency ?? record.currencyCode ?? commercial?.currency ?? "";
  const stageText = record.projectId && project
    ? project.project.status === "completed" ? t("Project completed") : currentStage ? t("{stage} · {position} of {count}", { stage: t(currentStage.name as MessageKey), position: currentStage.position + 1, count: project.stages.length }) : t("Released")
    : t("{stage} · {position} of {count}", { stage: t(casePhaseText(effectivePhase(record, commercial), record.plan).stage), ...position });
  const site = record.siteAddress || record.siteLatitude != null ? record : null;
  const quote = commercial?.data.quotes.find((item) => item.status === "issued");
  const dates = [
    record.activatedAt ? { label: t("Started"), value: day(record.activatedAt) } : null,
    record.targetDate ? { label: t("Target"), value: day(record.targetDate) } : null,
    quote?.validUntil ? { label: t("Quotation valid until"), value: day(quote.validUntil) } : null,
    commercial?.data.agreement?.executedAt ? { label: t("Agreement signed"), value: day(commercial.data.agreement.executedAt) } : null,
    record.releasedAt ? { label: t("Released"), value: day(record.releasedAt) } : null,
    project?.project.promiseDate && project.project.status !== "completed" ? { label: t("Handover"), value: day(project.project.promiseDate) } : null,
    project?.project.status === "completed" && project.project.closedAt ? { label: t("Completed"), value: day(project.project.closedAt) } : null,
  ];

  const overview = <RecordPanel>
    <SideSection title={t("Team")}>
      <PeopleList label={t("Team")}>
        {people.client ? <PersonRow id={people.client.id} name={people.client.name} role={t("Client")} phone={people.client.phone} email={people.client.email} /> : null}
        {people.team.map((person) => <PersonRow key={person.id} id={person.id} name={person.name} role={person.roles.map((role) => t(role)).join(" · ")} email={person.email} />)}
      </PeopleList>
    </SideSection>
    {/* PLM-046: the Account Manager's recurring client update call. */}
    {callsSlot}
    {site ? <SideSection title={t("Site")}><SiteLocation address={site.siteAddress} latitude={site.siteLatitude} longitude={site.siteLongitude} /></SideSection> : null}
    {dates.some(Boolean) ? <SideSection title={t("Key dates")}><FactList facts={dates} /></SideSection> : null}
    {money ? <SideSection title={t("Money")}>
      <FactList facts={[
        money.quoted ? { label: t("Quoted"), value: format.money(money.quoted, money.currency) } : null,
        money.agreed ? { label: t("Agreed"), value: format.money(money.agreed, money.currency) } : null,
        money.paid ? { label: t("Paid"), value: format.money(money.paid, money.currency), tone: "success" } : null,
        money.outstanding && Number(money.outstanding) > 0 ? { label: t("Outstanding"), value: format.money(money.outstanding, money.currency) } : null,
      ]} />
      {money.paidShare !== null ? <Progress label={t("{percent}% paid", { percent: money.paidShare })} value={money.paidShare} /> : null}
    </SideSection> : null}
  </RecordPanel>;

  const detailsPanel = <RecordPanel>
    {details ? <SideSection title={t("Details")}>{details}</SideSection> : null}
    <SideSection title={t("Enquiry")}>
      <FactList facts={[
        reference ? { label: t("Reference"), value: <Link href={`/workspace/crm/opportunities?record=${record.opportunityId}`}>{reference}</Link> } : null,
        record.enquiryTypeName ? { label: t("Enquiry type"), value: record.enquiryTypeName } : null,
        { label: t("Created"), value: day(record.createdAt) },
        project ? { label: t("Project"), value: <Link href={`/workspace/projects/${project.project.id}`}>{project.project.reference}</Link> } : null,
      ]} />
    </SideSection>
  </RecordPanel>;

  const filesPanel = files.length ? <RecordPanel><FileList label={t("Files")} items={files.map((file) => ({ ...file, meta: file.at ? day(file.at) : null }))} /></RecordPanel>
    : <EmptyState illustration={null} title={t("No files yet")} action={<Link className="wd-button" data-size="compact" data-variant="secondary" href={caseHref(record.id, new URLSearchParams(), "quotations")}>{t("Open quotations")}</Link>} />;

  return <RecordFrame tour="case-record">
    <RecordHeader title={<h2>{record.title}</h2>} actions={actions} meta={<>
      <span>{record.customerName}</span>
      {reference ? <span>{reference}</span> : null}
      {record.enquiryTypeName ? <span>{record.enquiryTypeName}</span> : null}
      <Badge data-chip="" tone={caseStatusTone(record.status)}>{t(caseStatusLabel(record.status))}</Badge>
    </>} />
    <RecordStrip label={t("Where the case stands")}>
      <StripItem icon={<Flag aria-hidden="true" size={13} />} label={t("Stage")}>{stageText}</StripItem>
      {record.engagementOwnerName ? <StripItem icon={<UserRound aria-hidden="true" size={13} />} label={t("Owner")}><PersonChip id={record.ownerMembershipId ?? "owner"} name={record.engagementOwnerName} /></StripItem> : null}
      {completeBy ? <StripItem icon={<CalendarClock aria-hidden="true" size={13} />} label={t("Complete by")}>{day(completeBy)}{completeUntil ? <>&nbsp;·&nbsp;<span data-late={completeUntil.late || undefined}>{completeUntil.text}</span></> : null}</StripItem> : null}
      {overdue ? <StripItem label={t("Overdue")}><Badge tone="danger">{t("{count} overdue", { count: overdue })}</Badge></StripItem> : null}
      {value ? <StripItem icon={<CircleDollarSign aria-hidden="true" size={13} />} label={value.label}>{format.money(value.amount, currency)}</StripItem> : null}
      {money?.paidShare !== null && money?.paidShare !== undefined ? <StripItem label={t("Paid")}>{t("{percent}%", { percent: money.paidShare })}</StripItem> : null}
    </RecordStrip>
    <RecordColumns sideLabel={t("Case overview")} tabs={[
      { id: "overview", label: t("Overview"), panel: overview },
      { id: "details", label: t("Details"), panel: detailsPanel },
      { id: "files", label: t("Files"), panel: filesPanel },
    ]}
      next={<>
        {loading ? <Skeleton lines={3} shape="facts" /> : <CaseNextStepCard next={next} busy={busy} onCommand={onCommand} />}
        <SideSection title={t("Stages")}>
          <RecordTimeline label={t("Stages")} steps={steps.map((step) => ({
            id: step.id, label: say(t, step.label), state: step.state, people: step.people,
            date: step.doneAt ? day(step.doneAt) : null, detail: step.detail ? say(t, step.detail) : null,
          }))} />
        </SideSection>
        {journeySlot}
      </>}
      activity={activity.length ? <SideSection title={t("Recent activity")}>
        <ActivityList label={t("Recent activity")} items={activity.map((entry) => ({ id: entry.id, text: say(t, entry.text), meta: entry.note || null, at: format.when(entry.at) }))} />
      </SideSection> : null} />
  </RecordFrame>;
}

/** The next step as the action card: what, why, who, by when, and the one action. */
function CaseNextStepCard({ next, busy, onCommand }: { next: CaseNextStep; busy: boolean; onCommand?: (command: CaseCommand) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const due = next.due ? (next.due.length > 10 ? format.dayOf(next.due) : next.due) : null;
  const action = next.action;
  return <NextStepCard title={say(t, next.title)} why={next.why ? say(t, next.why) : null} status={next.status} tour="case-next" meta={<>
    {next.owner ? <PersonChip id={`next-${next.owner}`} name={next.owner} /> : null}
    {due ? <Badge tone={next.overdue ? "danger" : "neutral"}>{next.overdue ? t("Overdue · {date}", { date: format.short(due) }) : t("Due {date}", { date: format.short(due) })}</Badge> : null}
    {action?.href ? <Link className="wd-button" data-variant="primary" data-size="compact" href={action.href}>{say(t, action.label)}</Link>
      : action?.command && onCommand ? <Button size="compact" variant="primary" isLoading={busy} onPress={() => onCommand(action.command!)}>{say(t, action.label)}</Button> : null}
  </>} />;
}
