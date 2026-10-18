"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseDate } from "@internationalized/date";
import type { AttendanceDay, AttendanceReview, HrmsBootstrap, LeaveRequest, TeamTimeWeek } from "@wodana/contracts";
import { ListTabs, Button, DataGrid, DateRangeField, EmptyState, ErrorState, InlineNotice, InspectorSheet, SelectField, TextAreaField, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi } from "@/lib/hrms/api";
import { addDays } from "@/lib/hrms/time";
import { dayWhere } from "./attendance-tab";
import { EvidencePhoto, Facts, download } from "./hrms-controls";
import { useHrmsFormat } from "./hrms-format";
import { DayStatus, LeaveStatus, ReviewStatus, dayState, useHrmsLabels } from "./hrms-labels";
import { TeamTime, TeamUtilisation, TimesheetSheet } from "./time-tab";
import styles from "./hrms.module.css";

type View = "today" | "approve" | "days" | "time" | "utilisation";
type Timesheet = TeamTimeWeek["people"][number];
type Approval = {
  key: string; id: string; kind: "leave" | "review" | "timesheet"; name: string; what: string; askedOn: string; reason: string;
  leave?: LeaveRequest; review?: AttendanceReview; timesheet?: Timesheet;
};
export type TeamOpen = { leave: string | null; review: string | null; timesheet: string | null };
const decidable = (row: Approval) => (row.leave?.canDecide ?? row.review?.canDecide ?? row.timesheet?.canDecide) === true;
const closed: TeamOpen = { leave: null, review: null, timesheet: null };

const MIN_REASON = 3;

/** My team: who's in today, the leave and attendance reviews waiting for my decision, and everyone's days for a period. */
export function TeamTab({ api, boot, open, onOpen }: { api: HrmsApi; boot: HrmsBootstrap; open: TeamOpen; onOpen: (open: Partial<TeamOpen>) => void }) {
  const t = useT();
  const linked = Boolean(open.leave || open.review || open.timesheet);
  const [view, setView] = useState<View>(linked ? "approve" : "today");
  const [following, setFollowing] = useState(linked);
  // A link to a request or review shows what's waiting.
  if (linked !== following) {
    setFollowing(linked);
    if (linked) setView("approve");
  }
  const approvals = useApprovals(api, boot);
  const count = approvals.rows?.filter(decidable).length ?? 0;
  const switcher = <ListTabs label={t("Show")} value={view} onChange={setView} items={[
    { id: "today", label: t("Today") }, { id: "approve", label: t("To approve"), count }, { id: "days", label: t("Days") },
    { id: "time", label: t("Time") }, { id: "utilisation", label: t("Utilisation") },
  ]} />;
  if (view === "approve") return <Approvals api={api} boot={boot} approvals={approvals} switcher={switcher} open={open} onOpen={onOpen} />;
  if (view === "days") return <TeamDays api={api} boot={boot} switcher={switcher} />;
  if (view === "time") return <TeamTime api={api} boot={boot} switcher={switcher} />;
  if (view === "utilisation") return <TeamUtilisation api={api} boot={boot} switcher={switcher} />;
  return <TeamToday api={api} boot={boot} switcher={switcher} />;
}

/** Everyone in my scope today: in or not, where or on what leave, since when and for how long. */
function TeamToday({ api, boot, switcher }: { api: HrmsApi; boot: HrmsBootstrap; switcher: ReactNode }) {
  const t = useT();
  const { mode: modeName } = useHrmsLabels();
  const format = useHrmsFormat();
  const today = format.today(boot.workspace.timezone);
  const [days, setDays] = useState<AttendanceDay[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setDays((await api.history({ from: today, to: today, scope: "team" })).days); setError(""); } catch (cause) { setError(format.failure(cause, t("The team didn't load."))); }
  }, [api, today, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const columns = useMemo<DataGridColumn<AttendanceDay>[]>(() => [
    { id: "person", header: t("Person"), accessorFn: (row) => row.name, size: 220 },
    { id: "status", header: t("Status"), accessorFn: (row) => dayState(row), size: 160, meta: { renderCell: (row) => <DayStatus state={dayState(row)} /> } },
    { id: "where", header: t("Where"), accessorFn: (row) => dayWhere(row, modeName), size: 220, meta: { mobileHidden: true } },
    { id: "in", header: t("In"), accessorFn: (row) => row.firstIn ?? "", size: 100, meta: { renderCell: (row) => <span className={styles.number}>{format.time(row.firstIn, row.timezone)}</span> } },
    { id: "hours", header: t("Hours"), accessorFn: (row) => row.elapsedMinutes, size: 100, meta: { renderCell: (row) => <span className={styles.number}>{format.duration(row.elapsedMinutes)}</span> } },
  ], [t, format]);
  if (error && !days) return <><div className={styles.toolbar}>{switcher}</div><ErrorState description={error} onRetry={() => void load()} /></>;
  return <DataGrid<AttendanceDay> ariaLabel={t("Team today")} columns={columns} data={[...(days ?? [])].sort((a, b) => a.name.localeCompare(b.name))}
    getRowId={(row) => row.membershipId} isLoading={!days} rowNumbers={false} selectable={false} wrapText searchLabel={t("Search people")} toolbarLeading={switcher}
    emptyContent={<EmptyState title={t("No one to show")} />} />;
}

function useApprovals(api: HrmsApi, boot: HrmsBootstrap) {
  const t = useT();
  const format = useHrmsFormat();
  const labels = useHrmsLabels();
  const today = format.today(boot.workspace.timezone);
  const [data, setData] = useState<{ reviews: AttendanceReview[]; requests: LeaveRequest[]; weeks: TeamTimeWeek[] } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      // Timesheets wait a week at most before they're chased: this week's and last week's.
      const [reviews, requests, ...weeks] = await Promise.all([api.reviews("team"), api.leaveRequests("team"),
        api.teamTime(today).catch(() => null), api.teamTime(addDays(today, -7)).catch(() => null)]);
      setData({ reviews, requests, weeks: weeks.filter((week): week is TeamTimeWeek => Boolean(week?.people)) }); setError("");
    } catch (cause) { setError(format.failure(cause, t("What's waiting didn't load."))); }
  }, [api, today, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const rows = useMemo<Approval[] | null>(() => data ? [
    ...data.requests.map((leave) => {
      const what = [leave.leaveTypeName, format.range(leave.startDate, leave.endDate), leave.dayPart !== "full" ? labels.part(leave.dayPart) : ""].filter(Boolean).join(" · ");
      return { key: `leave:${leave.id}`, id: leave.id, kind: "leave" as const, name: leave.name, what: leave.status === "cancellation_pending" ? t("Cancel: {leave}", { leave: what }) : what,
        askedOn: leave.createdAt, reason: leave.status === "cancellation_pending" ? leave.cancellationReason ?? leave.reason : leave.reason, leave };
    }),
    ...data.reviews.map((review) => ({ key: `review:${review.id}`, id: review.id, kind: "review" as const, name: review.name ?? "",
      what: [labels.review(review.kind), review.requestedAt ? format.moment(review.requestedAt) : ""].filter(Boolean).join(" · "), askedOn: review.createdAt, reason: review.reason, review })),
    ...[...new Map(data.weeks.flatMap((week) => week.people.filter((person) => person.timesheet?.status === "submitted").map((person) => [person.timesheet!.id, {
      key: `timesheet:${person.timesheet!.id}`, id: person.timesheet!.id, kind: "timesheet" as const, name: person.name,
      what: t("Hours, {dates}", { dates: format.range(week.weekStart, addDays(week.weekStart, 6)) }), askedOn: person.timesheet!.submittedAt ?? "",
      reason: format.duration(person.totalMinutes), timesheet: person,
    }] as const))).values()],
  ] : null, [data, format, labels, t]);
  return { rows, error, reload: load };
}

/** Leave, attendance reviews and timesheets I can decide, oldest first; each opens with what it rests on to approve, or reject or send back with a reason. */
function Approvals({ api, boot, approvals, switcher, open, onOpen }: {
  api: HrmsApi; boot: HrmsBootstrap; approvals: ReturnType<typeof useApprovals>; switcher: ReactNode; open: TeamOpen; onOpen: (open: Partial<TeamOpen>) => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const waiting = (approvals.rows ?? []).filter(decidable).sort((a, b) => a.askedOn.localeCompare(b.askedOn));
  const columns = useMemo<DataGridColumn<Approval>[]>(() => [
    { id: "person", header: t("Person"), accessorFn: (row) => row.name, size: 200, meta: { primary: true } },
    { id: "what", header: t("What"), accessorFn: (row) => row.what, size: 280 },
    { id: "asked", header: t("Asked on"), accessorFn: (row) => row.askedOn, size: 160, meta: { mobileHidden: true, renderCell: (row) => format.moment(row.askedOn) } },
    { id: "reason", header: t("Reason"), accessorFn: (row) => row.reason, size: 260, meta: { mobileHidden: true } },
  ], [t, format]);
  if (approvals.error && !approvals.rows) return <><div className={styles.toolbar}>{switcher}</div><ErrorState description={approvals.error} onRetry={() => void approvals.reload()} /></>;
  // A link may point at something already decided: it opens to show how.
  const item = approvals.rows?.find((row) => (open.leave ? row.kind === "leave" && row.id === open.leave
    : open.timesheet ? row.kind === "timesheet" && row.id === open.timesheet : row.kind === "review" && row.id === open.review)) ?? null;
  return <>
    <DataGrid<Approval> ariaLabel={t("To approve")} columns={columns} data={waiting} getRowId={(row) => row.key} isLoading={!approvals.rows}
      onRowAction={(row) => onOpen({ ...closed, [row.kind]: row.id })} rowNumbers={false} selectable={false} wrapText
      searchLabel={t("Search requests")} toolbarLeading={switcher} emptyContent={<EmptyState title={t("Nothing to approve")} />} />
    {item?.timesheet ? <TimesheetSheet api={api} week={item.timesheet} canDecide={item.timesheet.canDecide} onClose={() => onOpen(closed)}
      onDecided={() => { onOpen(closed); void approvals.reload(); }} />
      : item ? <ApprovalSheet api={api} boot={boot} item={item} onClose={() => onOpen(closed)} onDecided={() => { onOpen(closed); void approvals.reload(); }} /> : null}
  </>;
}

/** A leave request or attendance review with what it rests on; approved or rejected, always with a reason. */
function ApprovalSheet({ api, boot, item, onClose, onDecided }: { api: HrmsApi; boot: HrmsBootstrap; item: Approval; onClose: () => void; onDecided: () => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const labels = useHrmsLabels();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  const { leave, review } = item;
  const deciding = (leave?.canDecide ?? review?.canDecide) === true;
  const decide = async (decision: "approve" | "reject") => {
    setBusy(decision); setError("");
    try {
      if (leave) await api.decideLeave(leave.id, { decision, reason: reason.trim() });
      else if (review) await api.decideReview(review.id, { decision, reason: reason.trim() });
      onDecided();
    } catch (cause) { setError(format.failure(cause, t("Could not save."))); setBusy(null); }
  };
  const short = reason.trim().length < MIN_REASON;
  const evidence = review?.evidence;
  // The location is shown on its own; the other issues after it.
  const issues = (evidence?.issues ?? []).filter((issue) => !(evidence?.arrival && issue.startsWith("Location ")));
  return <InspectorSheet isOpen size="md" title={item.name} isDirty={Boolean(reason.trim()) && !busy} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={deciding ? <div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button isLoading={busy === "reject"} isDisabled={short || Boolean(busy)} onPress={() => void decide("reject")}>{t("Reject")}</Button>
      <Button variant="primary" isLoading={busy === "approve"} isDisabled={short || Boolean(busy)} onPress={() => void decide("approve")}>{t("Approve")}</Button>
    </div> : null}>
    <div className={styles.sheet}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {leave ? <Facts items={[
        [t("Status"), <LeaveStatus key="status" status={leave.status} />],
        [t("Type"), leave.leaveTypeName],
        [t("Dates"), format.range(leave.startDate, leave.endDate)],
        [t("Days"), [format.days(leave.days), leave.dayPart !== "full" ? labels.part(leave.dayPart) : ""].filter(Boolean).join(" · ")],
        [t("Reason"), leave.reason],
        leave.cancellationReason ? [t("Why cancel"), leave.cancellationReason] : null,
        [t("Asked on"), format.moment(leave.createdAt)],
        leave.decisionReason ? [t("Decision"), leave.decisionReason] : null,
      ]} /> : null}
      {review ? <Facts items={[
        [t("Status"), <ReviewStatus key="status" status={review.status} />],
        [t("What"), labels.review(review.kind)],
        review.originalAt ? [t("Recorded"), format.moment(review.originalAt)] : null,
        review.requestedAt ? [review.kind === "missing_checkout" ? t("Checked out at") : t("Correct time"), format.moment(review.requestedAt)] : null,
        [t("Reason"), review.reason],
        [t("Asked on"), format.moment(review.createdAt)],
        evidence?.arrival ? [t("Location"), labels.location(evidence.arrival.status)] : null,
        issues.length ? [t("Issues"), issues.map(labels.issue).join(", ")] : null,
        evidence?.exceptionReason && evidence.exceptionReason !== review.reason ? [t("Exception reason"), evidence.exceptionReason] : null,
        review.decisionReason ? [t("Decision"), review.decisionReason] : null,
      ]} /> : null}
      {review?.captureId && evidence?.photoCaptured && boot.permissions.evidence
        ? <EvidencePhoto size="large" src={api.photoUrl(review.captureId)} alt={t("Photo from {name}", { name: item.name })} /> : null}
      {deciding ? <TextAreaField label={t("Reason for your decision")} isRequired value={reason} onChange={setReason} /> : null}
    </div>
  </InspectorSheet>;
}

/** Everyone's days for a period, one person or all, and the same as a CSV. */
function TeamDays({ api, boot, switcher }: { api: HrmsApi; boot: HrmsBootstrap; switcher: ReactNode }) {
  const t = useT();
  const { mode: modeName } = useHrmsLabels();
  const format = useHrmsFormat();
  const today = format.today(boot.workspace.timezone);
  const [range, setRange] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const [person, setPerson] = useState("all");
  const [days, setDays] = useState<{ key: string; rows: AttendanceDay[] } | null>(null);
  const [error, setError] = useState("");
  const key = `${range.from}:${range.to}`;
  const load = useCallback(async () => {
    try { setDays({ key, rows: (await api.history({ from: range.from, to: range.to, scope: "team" })).days }); setError(""); }
    catch (cause) { setError(format.failure(cause, t("The team's days didn't load."))); }
  }, [api, key, range, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const loaded = days?.key === key ? days.rows : null;
  const people = useMemo(() => [...new Map((loaded ?? []).map((day) => [day.membershipId, day.name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [loaded]);
  const rows = (loaded ?? []).filter((day) => person === "all" || day.membershipId === person).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  const columns = useMemo<DataGridColumn<AttendanceDay>[]>(() => [
    { id: "date", header: t("Date"), accessorFn: (row) => row.date, size: 140, meta: { renderCell: (row) => format.day(row.date) } },
    { id: "person", header: t("Person"), accessorFn: (row) => row.name, size: 200 },
    { id: "in", header: t("In"), accessorFn: (row) => row.firstIn ?? "", size: 100, meta: { renderCell: (row) => <span className={styles.number}>{format.time(row.firstIn, row.timezone)}</span> } },
    { id: "out", header: t("Out"), accessorFn: (row) => row.lastOut ?? "", size: 100, meta: { renderCell: (row) => <span className={styles.number}>{format.time(row.lastOut, row.timezone)}</span> } },
    { id: "hours", header: t("Hours"), accessorFn: (row) => row.elapsedMinutes, size: 100, meta: { renderCell: (row) => <span className={styles.number}>{format.duration(row.elapsedMinutes)}</span> } },
    { id: "where", header: t("Where"), accessorFn: (row) => dayWhere(row, modeName), size: 200, meta: { mobileHidden: true } },
    { id: "status", header: t("Status"), accessorFn: (row) => dayState(row), size: 160, meta: { renderCell: (row) => <DayStatus state={dayState(row)} /> } },
  ], [t, format]);
  const tools = <div className={styles.toolbar}>
    {switcher}
    <DateRangeField label={t("Dates")} value={{ start: parseDate(range.from), end: parseDate(range.to) }}
      onChange={(value) => { if (value) setRange({ from: value.start.toString(), to: value.end.toString() }); }} />
    <SelectField label={t("Person")} selectedKey={person} onSelectionChange={(value) => setPerson(value ? String(value) : "all")}
      items={[{ id: "all", label: t("Everyone") }, ...people.map(([id, name]) => ({ id, label: name }))]} />
  </div>;
  if (error && !loaded) return <>{tools}<ErrorState description={error} onRetry={() => void load()} /></>;
  return <DataGrid<AttendanceDay> ariaLabel={t("Team days")} columns={columns} data={rows} getRowId={(row) => `${row.membershipId}:${row.date}`} isLoading={!loaded}
    rowNumbers={false} selectable={false} wrapText searchLabel={t("Search days")} toolbarLeading={tools}
    onExport={() => download(api.exportUrl({ from: range.from, to: range.to, scope: "team", membershipId: person === "all" ? null : person }))}
    emptyContent={<EmptyState title={t("No days in this period")} />} />;
}
