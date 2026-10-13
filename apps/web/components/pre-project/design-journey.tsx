"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Check, CheckCircle2, NotebookPen, Play, UserPlus } from "lucide-react";
import { parseDate, parseTime } from "@internationalized/date";
import {
  Badge, Button, DateField, EmptyState, FormDialog, FormRow, InlineNotice, PersonName, SegmentedControl, SelectField, Skeleton, TextAreaField, TextInput, TimeField, useWorkingCalendar,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { caseRequest } from "@/lib/pre-project/content";
import { revisionDetail } from "@/lib/pre-project/design-decisions";
import type { JourneyStageView, JourneyView as JourneyData } from "@/lib/pre-project/design-workspace";
import { zonedToUtc } from "@/lib/crm/zoned-time";
import { factoryApi } from "@/lib/factory/client";
import { SampleRequests } from "../factory/samples";
import { MeetingMinutesSheet } from "../meetings/meeting-minutes";
import styles from "./design-journey.module.css";

export type JourneyStage = JourneyStageView;
export type JourneyView = JourneyData;
type StageCode = JourneyStageView["stage"];
type Dialog = { kind: "close_inspiration" | "schedule" | "schedule_materials" | "not_required" | "confirm_materials" | "assign"; stage: JourneyStage } | null;
type Slots = { configured: boolean; slots: Array<{ start: string; end: string; date: string }>; timezone: string | null; durationMinutes: number | null; location: string | null };

/** PLM-047–053, 080/081: the stages of a case, each with its owner, deadline, revision counter and next action. */
export function DesignJourney({ workspaceId, caseId, locale, members = [] }: { workspaceId: string; caseId: string; locale?: string; members?: Array<{ id: string; displayName: string }> }) {
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
    inspiration: t("Inspiration"), site_visit: t("Site visit"), concepts: t("Concepts"), space_planning: t("Space planning"),
    material_selection: t("Material selection"), renders: t("3D renders"), approval: t("Design approval"),
  };
  const time = (iso: string, withDay = true) => { try { return new Intl.DateTimeFormat(locale, { timeZone: view.timezone, ...(withDay ? { weekday: "short", day: "numeric", month: "short" } : {}), hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch { return iso; } };
  const day = (iso: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone: view.timezone, day: "numeric", month: "short" }).format(new Date(iso)); } catch { return iso; } };
  const calendarDay = (ymd: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${ymd}T00:00:00Z`)); } catch { return ymd; } };
  const keepFlags = (next: JourneyView): JourneyView => ({ ...next, canStart: view.canStart, canManage: view.canManage, canEdit: view.canEdit, canReview: view.canReview, canRecordClient: view.canRecordClient });
  const saved = (message: string, next: JourneyView) => { setDialog(null); setNotice(message); setFailure(""); setView(keepFlags(next)); };
  const siteAndMaterials = (view.journey?.kind ?? view.startsAs) === "site_and_materials";
  const post = (path: string, body: Record<string, unknown>) => caseRequest<JourneyView>(workspaceId, caseId, path, "POST", body);
  const start = async () => {
    setStarting(true); setFailure("");
    try { saved(siteAndMaterials ? t("Site visit started.") : t("Design stages started."), await post("design-journey/start", {})); }
    catch (error) { setFailure(error instanceof Error ? error.message : t("The design stages could not start.")); }
    finally { setStarting(false); }
  };
  const done = view.stages.filter((stage) => stage.status === "done").length;
  const ledger = view.ledger;
  const outcomeLine = (stage: JourneyStage) => {
    if (stage.outcome === "not_required") return `${t("Not required for this order")}${stage.completedByName ? ` · ${stage.completedByName}` : ""}`;
    if (stage.outcome === "skipped") return t("Skipped");
    if (stage.stage === "approval" && view.journey?.approvedOn) return [t("Approved {date}", { date: calendarDay(view.journey.approvedOn) }), view.journey.approvalSigner, view.journey.approvalAssetName].filter(Boolean).join(" · ");
    if (stage.stage === "concepts" && stage.outcome === "chosen" && stage.note) return stage.note;
    return null;
  };
  const designLink = (stage: string) => `/workspace/pre-projects/cases/${caseId}/designs?stage=${stage}`;

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
    {!view.journey ? <EmptyState illustration="calendar" title={siteAndMaterials ? t("Site visit hasn't started") : t("Design hasn't started")} description={siteAndMaterials ? t("Start it once the order needs measuring.") : t("Design starts once the design deposit is paid.")} /> : <ol className={styles.timeline}>
      {view.stages.map((stage) => {
        const revision = revisionDetail(stage.revisions);
        const ended = stage.status === "done" ? outcomeLine(stage) : null;
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
                {stage.ownerName ? <span><PersonName person={stage.ownerName} /></span> : stage.stage === "renders" ? <span>{t("No Visualiser yet")}</span> : null}
                {stage.scheduledAt ? <span>{stage.stage === "material_selection" ? t("Appointment {when}", { when: time(stage.scheduledAt) }) : t("Visit {when}", { when: time(stage.scheduledAt) })}</span> : null}
                {stage.stage === "material_selection" && !stage.scheduledAt ? <span>{t("Reminder every day until booked")}</span> : null}
                {stage.stage === "material_selection" && ledger ? <span>{t("{count} materials · {waiting} waiting for the client", { count: ledger.materials, waiting: ledger.waiting })}</span> : null}
                {stage.stage === "inspiration" && !stage.dueAt ? <span>{t("Timer starts with the first inspiration")}</span> : null}
                {view.canManage && stage.clientDueAt ? <span>{t("Client deadline {date}", { date: day(stage.clientDueAt) })}</span> : null}
              </p>
              <div className={styles.actions}>
                {stage.stage === "inspiration" ? <Button size="compact" variant="secondary" onPress={() => setDialog({ kind: "close_inspiration", stage })}>{t("Close inspiration")}</Button> : null}
                {stage.stage === "site_visit" ? <>
                  <Button size="compact" variant="secondary" onPress={() => setDialog({ kind: "schedule", stage })}><CalendarPlus aria-hidden="true" size={13} />{stage.scheduledAt ? t("Reschedule") : t("Book visit")}</Button>
                  <Link className="wd-button" data-size="compact" data-variant="primary" href={`/workspace/pre-projects/cases/${caseId}/site`}><CheckCircle2 aria-hidden="true" size={13} />{t("Open the visit")}</Link>
                </> : null}
                {["concepts", "space_planning", "renders"].includes(stage.stage) ? <Link className="wd-button" data-size="compact" data-variant="secondary" href={designLink(stage.stage)}>{t("Open {stage}", { stage: labels[stage.stage] })}</Link> : null}
                {stage.stage === "renders" && view.canReview && members.length ? <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "assign", stage })}><UserPlus aria-hidden="true" size={13} />{stage.ownerName ? t("Change Visualiser") : t("Assign Visualiser")}</Button> : null}
                {stage.stage === "material_selection" ? <>
                  <Button size="compact" variant={stage.scheduledAt ? "secondary" : "primary"} onPress={() => setDialog({ kind: "schedule_materials", stage })}><CalendarPlus aria-hidden="true" size={13} />{stage.scheduledAt ? t("Reschedule") : t("Book appointment")}</Button>
                  <Link className="wd-button" data-size="compact" data-variant="secondary" href={designLink("ledger")}>{t("Material list")}</Link>
                  {ledger?.materials ? <Button size="compact" variant="secondary" isDisabled={ledger.waiting > 0} onPress={() => setDialog({ kind: "confirm_materials", stage })}>{t("Confirm material list")}</Button> : null}
                  {siteAndMaterials && !stage.progress?.total && !ledger?.materials ? <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "not_required", stage })}>{t("Not required for this order")}</Button> : null}
                </> : null}
                {stage.stage === "approval" ? <Link className="wd-button" data-size="compact" data-variant="primary" href={designLink("approval")}>{t("Record the approval")}</Link> : null}
              </div>
            </> : null}
            {/* PLM-153: the minutes of the stage's meeting with the client, once it is booked. */}
            {stage.activityId && stage.scheduledAt && stage.status !== "locked" ? <div className={styles.actions}>
              <Button size="compact" variant="quiet" onPress={() => setMinutes(stage)}><NotebookPen aria-hidden="true" size={13} />{t("Minutes")}</Button>
            </div> : null}
            {stage.stage === "material_selection" && stage.status !== "locked" ? <SampleRequests api={samplesApi} caseId={caseId} /> : null}
          </div>
        </li>;
      })}
    </ol>}
    {view.journey?.estimateDueAt && view.stages.find((stage) => stage.stage === "approval")?.status === "done" ? <p className={styles.muted}>{t("Estimate due {date}", { date: time(view.journey.estimateDueAt) })} · <Link href={`/workspace/pre-projects/cases/${caseId}/quotations`}>{view.journey.estimateQuoteId ? t("Open the estimate") : t("Open quotations")}</Link></p> : null}
    {minutes?.activityId ? <MeetingMinutesSheet workspaceId={workspaceId} activityId={minutes.activityId} title={labels[minutes.stage] ?? minutes.label} onClose={() => setMinutes(null)} /> : null}
    {dialog?.kind === "close_inspiration" ?<CloseInspirationDialog onClose={() => setDialog(null)} onSubmit={async (note) => saved(t("Inspiration closed. The site visit is next."), await post("design-journey/inspiration/close", { version: dialog.stage.version, note: note || null }))} /> : null}
    {dialog?.kind === "schedule" ? <ScheduleVisitDialog title={t("Book site visit")} timezone={view.timezone} onClose={() => setDialog(null)} onSubmit={async (value) => saved(t("Site visit booked. The Account Manager has been invited."), await post("design-journey/site-visit/schedule", { version: dialog.stage.version, ...value }))} /> : null}
    {dialog?.kind === "schedule_materials" ? (view.showroomBooking
      ? <ShowroomSlotDialog workspaceId={workspaceId} caseId={caseId} locale={locale} onClose={() => setDialog(null)} onSubmit={async (slot, timezone) => saved(t("Material selection booked. The design team has been invited."), await post("design-journey/material-selection/schedule", { version: dialog.stage.version, startsAt: slot.start, endsAt: slot.end, timezone }))} />
      : <ScheduleVisitDialog title={t("Book material selection")} timezone={view.timezone} onClose={() => setDialog(null)} onSubmit={async (value) => saved(t("Material selection booked. The design team has been invited."), await post("design-journey/material-selection/schedule", { version: dialog.stage.version, ...value }))} />) : null}
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

function AssignDialog({ members, onClose, onSubmit }: { members: Array<{ id: string; displayName: string }>; onClose: () => void; onSubmit: (membershipId: string) => Promise<unknown> }) {
  const t = useT();
  const [picked, setPicked] = useState<string | null>(null);
  return <FormDialog title={t("Assign Visualiser")} onClose={onClose} isDirty={Boolean(picked)} isSubmitDisabled={!picked} submitLabel={t("Assign")} onSubmit={() => onSubmit(picked!)}>
    <SelectField isRequired label={t("Visualiser")} items={members.map((member) => ({ id: member.id, label: member.displayName }))} selectedKey={picked} onSelectionChange={(key) => setPicked(String(key))} />
  </FormDialog>;
}

/** PLM-050: the showroom appointment on the firm's booking engine — only free slots for the designer are offered. */
function ShowroomSlotDialog({ workspaceId, caseId, locale, onClose, onSubmit }: { workspaceId: string; caseId: string; locale?: string; onClose: () => void;
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
  return <FormDialog title={t("Book material selection")} onClose={onClose} isDirty={Boolean(picked)} isSubmitDisabled={!chosen} submitLabel={t("Book")} error={error || undefined}
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

export function ScheduleVisitDialog({ title, timezone, onClose, onSubmit }: { title: string; timezone: string; onClose: () => void; onSubmit: (value: { startsAt: string; endsAt: string; timezone: string; address: string | null }) => Promise<unknown> }) {
  const t = useT();
  const calendar = useWorkingCalendar();
  const [value, setValue] = useState(() => ({ date: calendar.nextWorkingDayFromToday().toString(), time: "10:00", minutes: "90", address: "" }));
  const set = (key: keyof typeof value) => (next: string) => setValue((current) => ({ ...current, [key]: next }));
  const book = async () => {
    const startsAt = zonedToUtc(value.date, value.time, timezone);
    if (!startsAt) throw new Error(t("Choose the date and time."));
    await onSubmit({ startsAt, endsAt: new Date(Date.parse(startsAt) + Number(value.minutes) * 60000).toISOString(), timezone, address: value.address.trim() || null });
  };
  return <FormDialog title={title} onClose={onClose} isDirty={Boolean(value.address.trim())} submitLabel={t("Book")} onSubmit={book}>
    <DateField isRequired label={t("Date")} description={t("Times are in {zone}", { zone: timezone })} value={value.date ? parseDate(value.date) : null} onChange={(date) => set("date")(date?.toString() ?? "")} />
    <FormRow>
      <TimeField isRequired label={t("Start")} granularity="minute" value={value.time ? parseTime(value.time) : null} onChange={(time) => set("time")(time?.toString().slice(0, 5) ?? "")} />
      <SelectField isRequired items={[60, 90, 120, 180].map((minutes) => ({ id: String(minutes), label: t("{count} min", { count: minutes }) }))} label={t("Length")} onSelectionChange={(key) => set("minutes")(String(key))} selectedKey={value.minutes} />
    </FormRow>
    <TextInput label={t("Address")} maxLength={500} onChange={set("address")} value={value.address} />
  </FormDialog>;
}
