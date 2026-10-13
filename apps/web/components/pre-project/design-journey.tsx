"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, CalendarPlus, Check, CheckCircle2, NotebookPen, PackageCheck, Play, UserPlus, Users } from "lucide-react";
import { parseDate, parseTime } from "@internationalized/date";
import {
  Badge, Button, DateField, EmptyState, FormDialog, FormRow, InlineNotice, PersonName, SegmentedControl, SelectField, Skeleton, TextAreaField, TextInput, TimeField, useWorkingCalendar,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { caseRequest, type CaseAsset } from "@/lib/pre-project/content";
import { revisionDetail } from "@/lib/pre-project/design-decisions";
import { TASK_LABEL, TEAM_SLOT_LABEL, type JourneyStageView, type JourneyTaskView, type JourneyView as JourneyData, type TeamSlotView } from "@/lib/pre-project/design-workspace";
import { zonedToUtc } from "@/lib/crm/zoned-time";
import { factoryApi } from "@/lib/factory/client";
import { SampleRequests } from "../factory/samples";
import { MeetingMinutesSheet } from "../meetings/meeting-minutes";
import { AssetUpload } from "./case-controls";
import styles from "./design-journey.module.css";

export type JourneyStage = JourneyStageView;
export type JourneyView = JourneyData;
type StageCode = JourneyStageView["stage"];
type StageDialog = { kind: "close_inspiration" | "schedule" | "schedule_materials" | "schedule_home" | "not_required" | "confirm_materials" | "assign" | "schedule_kickoff" | "kickoff" | "deadline"
  | "render_signoff" | "samples_collected" | "approve_samples" | "questions"; stage: JourneyStage };
type Dialog = StageDialog | { kind: "team"; slot: TeamSlotView } | null;
type Slots = { configured: boolean; slots: Array<{ start: string; end: string; date: string }>; timezone: string | null; durationMinutes: number | null; location: string | null };
type Member = { id: string; displayName: string };
const NOT_NEEDED = "__not_needed__";

/**
 * PLM-047–053, 080/081 and the order of 13 Oct 2026 (PLM-140–145, PLM-151): the stages of a case, each with its owner,
 * deadline, revision counter and next action; the design team of the job; the work inside a step (the site measure,
 * the sample collection) on the step's own line.
 */
export function DesignJourney({ workspaceId, caseId, locale, members = [] }: { workspaceId: string; caseId: string; locale?: string; members?: Member[] }) {
  const t = useT();
  const [view, setView] = useState<JourneyView | null>(null);
  const [failure, setFailure] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState("");
  const [starting, setStarting] = useState(false);
  const [minutes, setMinutes] = useState<JourneyStage | null>(null);
  const load = useCallback(() => caseRequest<JourneyView>(workspaceId, caseId, "design-journey").then(setView).catch((error: Error) => setFailure(error.message)), [workspaceId, caseId]);
  // PLM-061: samples asked of the factory for the material selection.
  const samplesApi = useMemo(() => factoryApi(workspaceId), [workspaceId]);
  useEffect(() => { void load(); }, [load]);

  if (failure && !view) return <InlineNotice message={failure} tone="error" />;
  if (!view) return <Skeleton lines={4} shape="facts" />;
  const labels: Record<StageCode, string> = {
    inspiration: t("Inspiration"), kickoff: t("Kick-off meeting"), site_visit: t("Site visit"), concepts: t("Concepts"), space_planning: t("Space planning"),
    material_selection: t("Material selection"), renders: t("Renders"), samples: t("Samples"), approval: t("Design approval"),
  };
  const time = (iso: string, withDay = true) => { try { return new Intl.DateTimeFormat(locale, { timeZone: view.timezone, ...(withDay ? { weekday: "short", day: "numeric", month: "short" } : {}), hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch { return iso; } };
  const day = (iso: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone: view.timezone, day: "numeric", month: "short" }).format(new Date(iso)); } catch { return iso; } };
  const calendarDay = (ymd: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${ymd}T00:00:00Z`)); } catch { return ymd; } };
  const keepFlags = (next: JourneyView): JourneyView => ({ ...next, canStart: view.canStart, canManage: view.canManage, canEdit: view.canEdit, canReview: view.canReview, canRecordClient: view.canRecordClient });
  const saved = (message: string, next: JourneyView) => { setDialog(null); setNotice(message); setFailure(""); setView(keepFlags(next)); };
  const siteAndMaterials = (view.journey?.kind ?? view.startsAs) === "site_and_materials";
  const current = view.journey?.flowVersion === 2;
  const post = (path: string, body: Record<string, unknown>) => caseRequest<JourneyView>(workspaceId, caseId, path, "POST", body);
  const start = async () => {
    setStarting(true); setFailure("");
    try { saved(siteAndMaterials ? t("Site visit started.") : t("Design stages started."), await post("design-journey/start", {})); }
    catch (error) { setFailure(error instanceof Error ? error.message : t("The design stages could not start.")); }
    finally { setStarting(false); }
  };
  const done = view.stages.filter((stage) => stage.status === "done").length;
  const ledger = view.ledger;
  const task = (key: JourneyTaskView["task"]) => view.tasks?.find((item) => item.task === key) ?? null;
  const slot = (key: TeamSlotView["slot"]) => view.team?.slots.find((item) => item.slot === key) ?? null;
  const slotLabel = (item: TeamSlotView) => item.label ?? t(TEAM_SLOT_LABEL[item.slot]);
  const outcomeLine = (stage: JourneyStage) => {
    if (stage.outcome === "not_required") return `${t("Not required for this order")}${stage.completedByName ? ` · ${stage.completedByName}` : ""}`;
    if (stage.outcome === "skipped") return t("Skipped");
    if (stage.stage === "approval" && view.journey?.approvedOn) return [t("Approved {date}", { date: calendarDay(view.journey.approvedOn) }), view.journey.approvalSigner, view.journey.approvalAssetName].filter(Boolean).join(" · ");
    if (stage.stage === "renders" && view.journey?.renderSignedOn) return [t("Signed off {date}", { date: calendarDay(view.journey.renderSignedOn) }), view.journey.renderSignoffSigner, view.journey.renderSignoffAssetName].filter(Boolean).join(" · ");
    if (stage.stage === "kickoff" && view.journey?.renderSignoffDueOn) return t("Render sign-off agreed for {date}", { date: calendarDay(view.journey.renderSignoffDueOn) });
    if (stage.stage === "concepts" && stage.outcome === "chosen" && stage.note) return stage.note;
    return null;
  };
  const designLink = (stage: string) => `/workspace/pre-projects/cases/${caseId}/designs?stage=${stage}`;
  const taskLine = (item: JourneyTaskView | null) => {
    if (!item) return null;
    const label = t(TASK_LABEL[item.task]);
    if (item.status === "done") return <span>{t("{task} done {date}", { task: label, date: item.completedAt ? day(item.completedAt) : "" })}{item.completedByName ? ` · ${item.completedByName}` : ""}</span>;
    return <span data-overdue={item.overdue || undefined}>{item.dueAt ? t("{task} due {date}", { task: label, date: time(item.dueAt) }) : label}{item.ownerName ? ` · ${item.ownerName}` : ""}
      {item.overdue ? <> <Badge tone="danger">{t("Overdue")}</Badge></> : null}</span>;
  };
  const measure = task("site_measure");
  const collection = task("sample_collection");
  // PLM-146: once the samples are approved, the lead designer marks the finishes and sends them to QS.
  const finishesTask = task("finishes_to_qs");
  const team = view.team;
  const allocating = task("team_allocation");

  return <section aria-labelledby="design-journey-title" className={styles.journey}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <h3 id="design-journey-title">{siteAndMaterials ? t("Site visit & materials") : t("Design")}</h3>
        {view.journey?.packageName ? <span className={styles.package}>{view.journey.packageName}</span> : null}
      </div>
      {view.journey ? <span className={styles.progress} aria-label={t("{done} of {total} stages done", { done, total: view.stages.length })}>
        <span className={styles.progressTrack}><span style={{ inlineSize: `${Math.round((done / Math.max(view.stages.length, 1)) * 100)}%` }} /></span>
        {done}/{view.stages.length}
      </span> : view.canStart ? <Button isLoading={starting} size="compact" variant="primary" onPress={() => void start()}><Play aria-hidden="true" size={14} />{siteAndMaterials ? t("Start site visit") : t("Start design")}</Button> : null}
    </header>
    {failure ? <InlineNotice message={failure} tone="error" /> : null}
    {notice ? <InlineNotice message={notice} tone="success" /> : null}
    {current && team?.slots.length ? <div className={styles.team} aria-label={t("Design team")}>
      <div className={styles.titleRow}>
        <Users aria-hidden="true" size={14} /><span className={styles.title}>{t("Design team")}</span>
        {allocating?.status === "open" ? <Badge tone={allocating.overdue ? "danger" : "warning"}>{allocating.dueAt ? t("To allocate by {date}", { date: day(allocating.dueAt) }) : t("To allocate")}</Badge> : null}
      </div>
      <ul className={styles.teamList}>{team.slots.map((item) => <li key={item.slot}>
        <span className={styles.teamRole}>{slotLabel(item)}</span>
        <span className={styles.teamPerson}>{item.member ? <PersonName person={item.member.name ?? ""} /> : item.notApplicable ? t("Not needed on this job") : <span className={styles.muted}>{t("Not chosen")}</span>}</span>
        {item.canSet ? <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "team", slot: item })}><UserPlus aria-hidden="true" size={13} />{item.member || item.notApplicable ? t("Change") : t("Choose")}</Button> : null}
      </li>)}</ul>
    </div> : null}
    {!view.journey ? <EmptyState illustration="calendar" title={siteAndMaterials ? t("Site visit hasn't started") : t("Design hasn't started")} description={siteAndMaterials ? t("Start it once the order needs measuring.") : t("Design starts once the design deposit is paid.")} /> : <ol className={styles.timeline}>
      {view.stages.map((stage) => {
        const revision = revisionDetail(stage.revisions);
        const ended = stage.status === "done" ? outcomeLine(stage) : null;
        const meetingHeld = Boolean(stage.scheduledAt && new Date(stage.scheduledAt).getTime() < Date.now());
        return <li className={styles.step} data-status={stage.status} data-overdue={stage.overdue || undefined} key={stage.stage}>
          <span aria-hidden="true" className={styles.marker}>{stage.status === "done" ? <Check size={12} strokeWidth={3} /> : null}</span>
          <div className={styles.body}>
            <div className={styles.titleRow}>
              <span className={styles.title}>{labels[stage.stage] ?? stage.label}</span>
              {stage.status === "done" && stage.completedAt ? <span className={styles.meta}>{day(stage.completedAt)}</span> : null}
              {stage.status === "active" ? (stage.dueAt ? <Badge tone={stage.overdue ? "danger" : "neutral"}>{stage.overdue ? t("Overdue") : `${t("Due")} ${time(stage.dueAt)}`}</Badge> : <Badge tone="info">{t("Now")}</Badge>) : null}
              {stage.status === "active" && revision ? <Badge tone={stage.revisions?.chargeable ? "warning" : "neutral"}>{t(revision.key, revision.values)}</Badge> : null}
            </div>
            {ended ? <p className={styles.meta}><span>{ended}</span></p> : null}
            {stage.status === "active" ? <>
              <p className={styles.meta}>
                {stage.ownerName ? <span><PersonName person={stage.ownerName} /></span> : stage.stage === "renders" && !current ? <span>{t("No Visualiser yet")}</span> : null}
                {stage.scheduledAt ? <span>{stage.stage === "material_selection" ? t("Appointment {when}", { when: time(stage.scheduledAt) }) : stage.stage === "kickoff" ? t("Meeting {when}", { when: time(stage.scheduledAt) })
                  : stage.stage === "samples" ? t("Sample meeting {when}", { when: time(stage.scheduledAt) }) : t("Visit {when}", { when: time(stage.scheduledAt) })}</span> : null}
                {stage.stage === "material_selection" && !stage.scheduledAt ? <span>{t("Reminder every day until booked")}</span> : null}
                {(stage.stage === "material_selection" || stage.stage === "samples") && ledger ? <span>{t("{count} materials · {waiting} waiting for the client", { count: ledger.materials, waiting: ledger.waiting })}</span> : null}
                {stage.stage === "samples" && ledger?.outsourcedWaiting ? <span>{t("{count} outsourced waiting for sign-off", { count: ledger.outsourcedWaiting })}</span> : null}
                {stage.stage === "inspiration" && !stage.dueAt ? <span>{t("Timer starts with the first inspiration")}</span> : null}
                {stage.stage === "concepts" && current ? taskLine(measure) : null}
                {stage.stage === "samples" ? taskLine(collection) : null}
                {stage.stage === "approval" ? taskLine(finishesTask) : null}
                {stage.stage === "renders" && current ? <>
                  {(["visualiser", "draftsman"] as const).map((key) => { const item = slot(key); return item ? <span key={key}>{slotLabel(item)}: {item.member?.name ?? t("Not tagged")}</span> : null; })}
                  {view.journey?.renderSignoffDueOn ? <span>{t("Client signs off by {date}", { date: calendarDay(view.journey.renderSignoffDueOn) })}</span> : null}
                </> : null}
                {view.canManage && stage.clientDueAt && !(stage.stage === "renders" && current) ? <span>{t("Client deadline {date}", { date: day(stage.clientDueAt) })}</span> : null}
              </p>
              <div className={styles.actions}>
                {stage.stage === "inspiration" ? <Button size="compact" variant="secondary" onPress={() => setDialog({ kind: "close_inspiration", stage })}>{t("Close inspiration")}</Button> : null}
                {stage.stage === "kickoff" ? <>
                  <Button size="compact" variant={stage.scheduledAt ? "secondary" : "primary"} onPress={() => setDialog({ kind: "schedule_kickoff", stage })}><CalendarPlus aria-hidden="true" size={13} />{stage.scheduledAt ? t("Reschedule") : t("Book kick-off")}</Button>
                  {view.checklist?.length && view.canEdit ? <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "questions", stage })}>{t("Site visit questions")}</Button> : null}
                  {meetingHeld ? <Button size="compact" variant="primary" onPress={() => setDialog({ kind: "kickoff", stage })}><CheckCircle2 aria-hidden="true" size={13} />{t("Record the kick-off")}</Button> : null}
                </> : null}
                {stage.stage === "site_visit" ? <>
                  <Button size="compact" variant="secondary" onPress={() => setDialog({ kind: "schedule", stage })}><CalendarPlus aria-hidden="true" size={13} />{stage.scheduledAt ? t("Reschedule") : t("Book visit")}</Button>
                  <Link className="wd-button" data-size="compact" data-variant="primary" href={`/workspace/pre-projects/cases/${caseId}/site`}><CheckCircle2 aria-hidden="true" size={13} />{t("Open the visit")}</Link>
                </> : null}
                {["concepts", "space_planning", "renders"].includes(stage.stage) ? <Link className="wd-button" data-size="compact" data-variant="secondary" href={designLink(stage.stage)}>{t("Open {stage}", { stage: labels[stage.stage] })}</Link> : null}
                {stage.stage === "concepts" && current && measure?.status === "open" ? <Link className="wd-button" data-size="compact" data-variant="secondary" href={`/workspace/pre-projects/cases/${caseId}/site`}>{t("Open the visit")}</Link> : null}
                {(stage.stage === "concepts" || stage.stage === "renders") && current && view.canEdit ? <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "deadline", stage })}><CalendarClock aria-hidden="true" size={13} />{t("Set the due date")}</Button> : null}
                {stage.stage === "renders" && current && view.canRecordClient ? <Button size="compact" variant="primary" onPress={() => setDialog({ kind: "render_signoff", stage })}>{t("Record the render sign-off")}</Button> : null}
                {stage.stage === "renders" && !current && view.canReview && members.length ? <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "assign", stage })}><UserPlus aria-hidden="true" size={13} />{stage.ownerName ? t("Change Visualiser") : t("Assign Visualiser")}</Button> : null}
                {stage.stage === "samples" && collection?.status === "open" ? <Button size="compact" variant="primary" onPress={() => setDialog({ kind: "samples_collected", stage })}><PackageCheck aria-hidden="true" size={13} />{t("Samples collected")}</Button> : null}
                {stage.stage === "samples" ? <>
                  {/* PLM-144: the sample meeting is at the showroom (the booking page's free slots, or a time picked by hand), or at the client's home if they ask. */}
                  <Button size="compact" variant={stage.scheduledAt || collection?.status === "open" ? "secondary" : "primary"} onPress={() => setDialog({ kind: "schedule_materials", stage })}>
                    <CalendarPlus aria-hidden="true" size={13} />{stage.scheduledAt ? t("Reschedule") : t("Book sample meeting")}</Button>
                  <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "schedule_home", stage })}>{t("At the client's home")}</Button>
                  <Link className="wd-button" data-size="compact" data-variant="secondary" href={designLink("ledger")}>{t("Material list")}</Link>
                  {collection?.status === "done" ? <Button size="compact" variant="secondary" isDisabled={!meetingHeld || (ledger?.waiting ?? 0) > 0 || (ledger?.outsourcedWaiting ?? 0) > 0 || !ledger?.materials}
                    onPress={() => setDialog({ kind: "approve_samples", stage })}>{t("Approve samples")}</Button> : null}
                </> : null}
                {stage.stage === "material_selection" ? <>
                  <Button size="compact" variant={stage.scheduledAt ? "secondary" : "primary"} onPress={() => setDialog({ kind: "schedule_materials", stage })}><CalendarPlus aria-hidden="true" size={13} />{stage.scheduledAt ? t("Reschedule") : t("Book appointment")}</Button>
                  <Link className="wd-button" data-size="compact" data-variant="secondary" href={designLink("ledger")}>{t("Material list")}</Link>
                  {ledger?.materials ? <Button size="compact" variant="secondary" isDisabled={ledger.waiting > 0} onPress={() => setDialog({ kind: "confirm_materials", stage })}>{t("Confirm material list")}</Button> : null}
                  {siteAndMaterials && !stage.progress?.total && !ledger?.materials ? <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "not_required", stage })}>{t("Not required for this order")}</Button> : null}
                </> : null}
                {stage.stage === "approval" && finishesTask?.status === "open" ? <Link className="wd-button" data-size="compact" data-variant="secondary" href={designLink("finishes")}>{t("Mark the finishes")}</Link> : null}
                {stage.stage === "approval" ? <Link className="wd-button" data-size="compact" data-variant="primary" href={designLink("approval")}>{t("Record the approval")}</Link> : null}
              </div>
            </> : null}
            {/* PLM-153: the minutes of the stage's meeting with the client, once it is booked. */}
            {stage.activityId && stage.scheduledAt && stage.status !== "locked" ? <div className={styles.actions}>
              <Button size="compact" variant="quiet" onPress={() => setMinutes(stage)}><NotebookPen aria-hidden="true" size={13} />{t("Minutes")}</Button>
            </div> : null}
            {(stage.stage === "material_selection" || stage.stage === "samples") && stage.status !== "locked" ? <SampleRequests api={samplesApi} caseId={caseId} /> : null}
          </div>
        </li>;
      })}
    </ol>}
    {view.journey?.estimateDueAt && view.stages.find((stage) => stage.stage === "approval")?.status === "done" ? <p className={styles.muted}>{t("Estimate due {date}", { date: time(view.journey.estimateDueAt) })} · <Link href={`/workspace/pre-projects/cases/${caseId}/quotations`}>{view.journey.estimateQuoteId ? t("Open the estimate") : t("Open quotations")}</Link></p> : null}
    {minutes?.activityId ? <MeetingMinutesSheet workspaceId={workspaceId} activityId={minutes.activityId} title={labels[minutes.stage] ?? minutes.label} onClose={() => setMinutes(null)} /> : null}
    {dialog?.kind === "team" && team ? <TeamDialog slot={dialog.slot} label={slotLabel(dialog.slot)} members={team.candidates?.length ? team.candidates : members} onClose={() => setDialog(null)}
      onSubmit={async (choice) => saved(t("Design team saved."), await caseRequest<JourneyView>(workspaceId, caseId, "design-journey/team", "PUT", { version: team.version, roles: [{ slot: dialog.slot.slot, ...choice.role }], reason: choice.reason }))} /> : null}
    {dialog?.kind === "close_inspiration" ? <CloseInspirationDialog onClose={() => setDialog(null)} onSubmit={async (note) => saved(current ? t("Inspiration closed. The kick-off is next.") : t("Inspiration closed. The site visit is next."), await post("design-journey/inspiration/close", { version: dialog.stage.version, note: note || null }))} /> : null}
    {dialog?.kind === "schedule" ? <ScheduleVisitDialog title={t("Book site visit")} timezone={view.timezone} onClose={() => setDialog(null)} onSubmit={async (value) => saved(t("Site visit booked. The Account Manager has been invited."), await post("design-journey/site-visit/schedule", { version: dialog.stage.version, ...value }))} /> : null}
    {dialog?.kind === "schedule_kickoff" ? <ScheduleVisitDialog title={t("Book kick-off meeting")} timezone={view.timezone} onClose={() => setDialog(null)} onSubmit={async (value) => saved(t("Kick-off booked. The design team has been invited."), await post("design-journey/kickoff/schedule", { version: dialog.stage.version, ...value }))} /> : null}
    {dialog?.kind === "questions" ? <SiteQuestionsDialog view={view} onClose={() => setDialog(null)}
      onSubmit={async (answers) => saved(t("Answers saved."), await caseRequest<JourneyView>(workspaceId, caseId, "design-journey/site-visit/answers", "PUT", { version: dialog.stage.version, answers }))} /> : null}
    {dialog?.kind === "kickoff" ? <KickoffDialog needsRenderDate={Boolean(view.journey?.includesRenders)} onClose={() => setDialog(null)}
      onSubmit={async (value) => saved(t("Kick-off recorded. The concept and the site measure have started."), await post("design-journey/kickoff/complete", { version: dialog.stage.version, ...value }))} /> : null}
    {dialog?.kind === "deadline" ? <DeadlineDialog title={dialog.stage.stage === "renders" ? t("Render due date") : t("Concept due date")} onClose={() => setDialog(null)}
      onSubmit={async (dueOn) => saved(t("Due date saved."), await post(`design-journey/stages/${dialog.stage.stage}/deadline`, { version: dialog.stage.version, dueOn }))} /> : null}
    {dialog?.kind === "render_signoff" ? <RenderSignOffDialog workspaceId={workspaceId} caseId={caseId} onClose={() => setDialog(null)}
      onSubmit={async (value) => saved(t("Render sign-off recorded. Samples have started."), await post("design-journey/renders/sign-off", { version: dialog.stage.version, ...value }))} /> : null}
    {dialog?.kind === "samples_collected" && collection ? <FormNoteDialog title={t("Samples collected")} submitLabel={t("Record")} onClose={() => setDialog(null)}
      onSubmit={async (note) => saved(t("Samples recorded. The lead designer books the sample meeting."), await post("design-journey/samples/collected", { version: collection.version, note: note || null }))} /> : null}
    {dialog?.kind === "approve_samples" ? <FormDialog title={t("Approve samples")} onClose={() => setDialog(null)} submitLabel={t("Approve")} onSubmit={async () => saved(t("Samples approved."), await post("design-journey/samples/approve", { version: dialog.stage.version }))}>
      <p className={styles.muted}>{t("{count} materials, each confirmed by the client. The design approval is next.", { count: ledger?.materials ?? 0 })}</p>
    </FormDialog> : null}
    {dialog?.kind === "schedule_home" ? <ScheduleVisitDialog title={t("Book sample meeting")} timezone={view.timezone} addressRequired onClose={() => setDialog(null)}
      onSubmit={async (value) => saved(t("Sample meeting booked. The design team has been invited."), await post("design-journey/material-selection/schedule", { version: dialog.stage.version, ...value, atClientHome: true }))} /> : null}
    {dialog?.kind === "schedule_materials" ? (() => {
      const samples = dialog.stage.stage === "samples";
      const bookedMessage = samples ? t("Sample meeting booked. The design team has been invited.") : t("Material selection booked. The design team has been invited.");
      return view.showroomBooking
        ? <ShowroomSlotDialog title={samples ? t("Book sample meeting") : t("Book material selection")} workspaceId={workspaceId} caseId={caseId} locale={locale} onClose={() => setDialog(null)} onSubmit={async (slotPicked, timezone) => saved(bookedMessage, await post("design-journey/material-selection/schedule", { version: dialog.stage.version, startsAt: slotPicked.start, endsAt: slotPicked.end, timezone }))} />
        : <ScheduleVisitDialog title={samples ? t("Book sample meeting") : t("Book material selection")} timezone={view.timezone} onClose={() => setDialog(null)} onSubmit={async (value) => saved(bookedMessage, await post("design-journey/material-selection/schedule", { version: dialog.stage.version, ...value }))} />;
    })() : null}
    {dialog?.kind === "confirm_materials" ? <FormDialog title={t("Confirm material list")} onClose={() => setDialog(null)} submitLabel={t("Confirm")} onSubmit={async () => saved(t("Material list confirmed."), await post("design-journey/material-selection/confirm", { version: dialog.stage.version }))}>
      <p className={styles.muted}>{t("{count} materials, each confirmed by the client. The next stage opens straight away.", { count: ledger?.materials ?? 0 })}</p>
    </FormDialog> : null}
    {dialog?.kind === "not_required" ? <FormDialog title={t("Not required for this order")} onClose={() => setDialog(null)} submitLabel={t("Confirm")} onSubmit={async () => saved(t("Material selection recorded as not required."), await post("design-journey/material-selection/not-required", { version: dialog.stage.version }))}>
      <p className={styles.muted}>{t("Recorded with your name and today's date.")}</p>
    </FormDialog> : null}
    {dialog?.kind === "assign" ? <AssignDialog members={members} onClose={() => setDialog(null)} onSubmit={async (membershipId) => saved(t("Visualiser assigned."), await post(`design-journey/stages/${dialog.stage.stage}/assign`, { version: dialog.stage.version, membershipId }))} /> : null}
  </section>;
}

function CloseInspirationDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (note: string) => Promise<unknown> }) {
  const t = useT();
  const [note, setNote] = useState("");
  return <FormDialog title={t("Close inspiration")} onClose={onClose} isDirty={Boolean(note.trim())} submitLabel={t("Close inspiration")} onSubmit={() => onSubmit(note.trim())}>
    <TextAreaField label={t("Note")} maxLength={2000} onChange={setNote} value={note} />
  </FormDialog>;
}

function FormNoteDialog({ title, submitLabel, onClose, onSubmit }: { title: string; submitLabel: string; onClose: () => void; onSubmit: (note: string) => Promise<unknown> }) {
  const t = useT();
  const [note, setNote] = useState("");
  return <FormDialog title={title} onClose={onClose} isDirty={Boolean(note.trim())} submitLabel={submitLabel} onSubmit={() => onSubmit(note.trim())}>
    <TextAreaField label={t("Note · optional")} maxLength={2000} onChange={setNote} value={note} />
  </FormDialog>;
}

/**
 * PLM-151: one part of the design team. Changing an allocated designer asks for the reason (kept in the history); every
 * part but the lead designer can be "not needed on this job".
 */
function TeamDialog({ slot, label, members, onClose, onSubmit }: { slot: TeamSlotView; label: string; members: Member[]; onClose: () => void;
  onSubmit: (choice: { role: { membershipId: string | null; notApplicable: boolean }; reason: string | null }) => Promise<unknown> }) {
  const t = useT();
  const [picked, setPicked] = useState<string | null>(slot.member?.membershipId ?? (slot.notApplicable ? NOT_NEEDED : null));
  const [reason, setReason] = useState("");
  const designer = slot.slot === "lead_designer" || slot.slot === "junior_designer";
  const changing = designer && Boolean(slot.member) && picked !== slot.member?.membershipId;
  const items = [...members.map((member) => ({ id: member.id, label: member.displayName })), ...(slot.slot === "lead_designer" ? [] : [{ id: NOT_NEEDED, label: t("Not needed on this job") }])];
  return <FormDialog title={label} onClose={onClose} isDirty={picked !== (slot.member?.membershipId ?? null)} isSubmitDisabled={!picked || (changing && !reason.trim())} submitLabel={t("Save")}
    onSubmit={() => onSubmit({ role: picked === NOT_NEEDED ? { membershipId: null, notApplicable: true } : { membershipId: picked, notApplicable: false }, reason: reason.trim() || null })}>
    <SelectField isRequired label={label} items={items} selectedKey={picked} onSelectionChange={(key) => setPicked(String(key))} />
    {changing ? <TextAreaField isRequired label={t("Reason for the change")} maxLength={500} onChange={setReason} value={reason} /> : null}
  </FormDialog>;
}

/**
 * PLM-154: the site visit question list at the kick-off meeting, grouped by scope (the job's scopes first, a scope it
 * doesn't have marked optional). The site measure carries on from these answers.
 */
function SiteQuestionsDialog({ view, onClose, onSubmit }: { view: JourneyView; onClose: () => void; onSubmit: (answers: Array<{ key: string; answer: string }>) => Promise<unknown> }) {
  const t = useT();
  const checklist = view.checklist ?? [];
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(checklist.map((item) => [item.key, item.answer ?? ""])));
  const changed = checklist.filter((item) => (drafts[item.key] ?? "").trim() !== (item.answer ?? ""));
  const groups = view.checklistGroups?.length ? view.checklistGroups : [{ scope: null, matches: true, required: true, keys: checklist.map((item) => item.key) }];
  return <FormDialog title={t("Site visit questions")} onClose={onClose} isDirty={changed.length > 0} isSubmitDisabled={!changed.length} submitLabel={t("Save")}
    onSubmit={() => onSubmit(changed.map((item) => ({ key: item.key, answer: (drafts[item.key] ?? "").trim() })))}>
    {groups.map((group) => <section key={group.scope ?? ""} className={styles.questionGroup} aria-label={group.scope ?? t("General")}>
      {groups.length > 1 ? <h4 className={styles.groupTitle}>{group.scope ?? t("General")}{group.required ? null : <span className={styles.muted}> · {t("Optional")}</span>}</h4> : null}
      {group.keys.map((key) => checklist.find((item) => item.key === key)).filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) =>
        <TextAreaField key={item.key} label={item.question} maxLength={2000} value={drafts[item.key] ?? ""} onChange={(next) => setDrafts((current) => ({ ...current, [item.key]: next }))} />)}
    </section>)}
  </FormDialog>;
}

/** PLM-140: the kick-off took place; the render sign-off date agreed with the client is recorded with it. */
function KickoffDialog({ needsRenderDate, onClose, onSubmit }: { needsRenderDate: boolean; onClose: () => void; onSubmit: (value: { renderSignoffOn: string | null; note: string | null }) => Promise<unknown> }) {
  const t = useT();
  const calendar = useWorkingCalendar();
  const [renderOn, setRenderOn] = useState("");
  const [note, setNote] = useState("");
  const tomorrow = calendar.nextWorkingDayFromToday();
  return <FormDialog title={t("Record the kick-off")} onClose={onClose} isDirty={Boolean(renderOn || note.trim())} isSubmitDisabled={needsRenderDate && !renderOn} submitLabel={t("Record")}
    onSubmit={() => onSubmit({ renderSignoffOn: needsRenderDate ? renderOn : null, note: note.trim() || null })}>
    {needsRenderDate ? <DateField isRequired label={t("Render sign-off agreed for")} minValue={tomorrow} value={renderOn ? parseDate(renderOn) : null} onChange={(date) => setRenderOn(date?.toString() ?? "")} /> : null}
    <TextAreaField label={t("Note · optional")} maxLength={2000} onChange={setNote} value={note} />
  </FormDialog>;
}

/** PLM-142/143: the concept's or the renders' due date for this job. */
function DeadlineDialog({ title, onClose, onSubmit }: { title: string; onClose: () => void; onSubmit: (dueOn: string) => Promise<unknown> }) {
  const t = useT();
  const calendar = useWorkingCalendar();
  const [dueOn, setDueOn] = useState("");
  return <FormDialog title={title} onClose={onClose} isDirty={Boolean(dueOn)} isSubmitDisabled={!dueOn} submitLabel={t("Save")} onSubmit={() => onSubmit(dueOn)}>
    <DateField isRequired label={t("Due on")} minValue={calendar.today()} value={dueOn ? parseDate(dueOn) : null} onChange={(date) => setDueOn(date?.toString() ?? "")} />
  </FormDialog>;
}

/** PLM-143: the client's render sign-off: the day they signed, who signed and the signed file. */
function RenderSignOffDialog({ workspaceId, caseId, onClose, onSubmit }: { workspaceId: string; caseId: string; onClose: () => void;
  onSubmit: (value: { signedOn: string; signer: string; assetId: string; note: string | null }) => Promise<unknown> }) {
  const t = useT();
  const calendar = useWorkingCalendar();
  const today = calendar.today();
  const [signedOn, setSignedOn] = useState(today.toString());
  const [signer, setSigner] = useState("");
  const [file, setFile] = useState<CaseAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  return <FormDialog title={t("Record the render sign-off")} onClose={onClose} isDirty={Boolean(signer.trim() || file)} isSubmitDisabled={!signedOn || !signer.trim() || !file || uploading} submitLabel={t("Record")}
    error={error || undefined} onSubmit={() => onSubmit({ signedOn, signer: signer.trim(), assetId: file!.id, note: null })}>
    <DateField isRequired label={t("Signed on")} maxValue={today} value={signedOn ? parseDate(signedOn) : null} onChange={(date) => setSignedOn(date?.toString() ?? "")} />
    <TextInput isRequired label={t("Signed by")} maxLength={200} value={signer} onChange={setSigner} />
    {file ? <p className={styles.muted}>{t("Signed off: {name}", { name: file.name })}</p>
      : <AssetUpload workspaceId={workspaceId} caseId={caseId} multiple={false} label={t("Attach the signed renders")} onBusy={setUploading} onError={setError} onUploaded={setFile} />}
  </FormDialog>;
}

function AssignDialog({ members, onClose, onSubmit }: { members: Member[]; onClose: () => void; onSubmit: (membershipId: string) => Promise<unknown> }) {
  const t = useT();
  const [picked, setPicked] = useState<string | null>(null);
  return <FormDialog title={t("Assign Visualiser")} onClose={onClose} isDirty={Boolean(picked)} isSubmitDisabled={!picked} submitLabel={t("Assign")} onSubmit={() => onSubmit(picked!)}>
    <SelectField isRequired label={t("Visualiser")} items={members.map((member) => ({ id: member.id, label: member.displayName }))} selectedKey={picked} onSelectionChange={(key) => setPicked(String(key))} />
  </FormDialog>;
}

/** PLM-050/144: the showroom appointment on the firm's booking engine — only free slots for the designer are offered. */
function ShowroomSlotDialog({ title, workspaceId, caseId, locale, onClose, onSubmit }: { title: string; workspaceId: string; caseId: string; locale?: string; onClose: () => void;
  onSubmit: (slot: { start: string; end: string }, timezone: string) => Promise<unknown> }) {
  const t = useT();
  const [slots, setSlots] = useState<Slots | null>(null);
  const [error, setError] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { caseRequest<Slots>(workspaceId, caseId, "design-journey/material-selection/slots").then((value) => { setSlots(value); setDay(value.slots[0]?.date ?? null); }).catch((cause: Error) => setError(cause.message)); }, [workspaceId, caseId]);
  const zone = slots?.timezone ?? "UTC";
  const format = (iso: string, options: Intl.DateTimeFormatOptions) => { try { return new Intl.DateTimeFormat(locale, { timeZone: zone, ...options }).format(new Date(iso)); } catch { return iso; } };
  const days = [...new Set((slots?.slots ?? []).map((slot) => slot.date))];
  const chosen = slots?.slots.find((slot) => slot.start === picked) ?? null;
  return <FormDialog title={title} onClose={onClose} isDirty={Boolean(picked)} isSubmitDisabled={!chosen} submitLabel={t("Book")} error={error || undefined}
    onSubmit={() => onSubmit(chosen!, zone)}>
    {!slots ? <Skeleton lines={3} shape="rows" /> : !slots.slots.length ? <EmptyState illustration="calendar" title={t("No free slots in the next two weeks")} description={t("Free up the designer's calendar or add hours in Booking pages.")} /> : <>
      {slots.location ? <p className={styles.muted}>{slots.location}</p> : null}
      <SelectField isRequired label={t("Day")} items={days.map((date) => ({ id: date, label: format(`${date}T12:00:00Z`, { weekday: "short", day: "numeric", month: "short" }) }))} selectedKey={day} onSelectionChange={(key) => { setDay(String(key)); setPicked(null); }} />
      <SegmentedControl label={t("Time")} value={picked ?? ""} onChange={setPicked}
        options={slots.slots.filter((slot) => slot.date === day).map((slot) => ({ id: slot.start, label: format(slot.start, { hour: "numeric", minute: "2-digit" }) }))} />
      <p className={styles.muted}>{t("Times are in {zone}", { zone })}</p>
    </>}
  </FormDialog>;
}

export function ScheduleVisitDialog({ title, timezone, addressRequired = false, onClose, onSubmit }: { title: string; timezone: string; addressRequired?: boolean; onClose: () => void;
  onSubmit: (value: { startsAt: string; endsAt: string; timezone: string; address: string | null }) => Promise<unknown> }) {
  const t = useT();
  const calendar = useWorkingCalendar();
  const [value, setValue] = useState(() => ({ date: calendar.nextWorkingDayFromToday().toString(), time: "10:00", minutes: "90", address: "" }));
  const set = (key: keyof typeof value) => (next: string) => setValue((current) => ({ ...current, [key]: next }));
  const book = async () => {
    const startsAt = zonedToUtc(value.date, value.time, timezone);
    if (!startsAt) throw new Error(t("Choose the date and time."));
    await onSubmit({ startsAt, endsAt: new Date(Date.parse(startsAt) + Number(value.minutes) * 60000).toISOString(), timezone, address: value.address.trim() || null });
  };
  return <FormDialog title={title} onClose={onClose} isDirty={Boolean(value.address.trim())} isSubmitDisabled={addressRequired && !value.address.trim()} submitLabel={t("Book")} onSubmit={book}>
    <DateField isRequired label={t("Date")} description={t("Times are in {zone}", { zone: timezone })} value={value.date ? parseDate(value.date) : null} onChange={(date) => set("date")(date?.toString() ?? "")} />
    <FormRow>
      <TimeField isRequired label={t("Start")} granularity="minute" value={value.time ? parseTime(value.time) : null} onChange={(time) => set("time")(time?.toString().slice(0, 5) ?? "")} />
      <SelectField isRequired items={[60, 90, 120, 180].map((minutes) => ({ id: String(minutes), label: t("{count} min", { count: minutes }) }))} label={t("Length")} onSelectionChange={(key) => set("minutes")(String(key))} selectedKey={value.minutes} />
    </FormRow>
    <TextInput isRequired={addressRequired} label={addressRequired ? t("Client's address") : t("Address")} maxLength={500} onChange={set("address")} value={value.address} />
  </FormDialog>;
}

