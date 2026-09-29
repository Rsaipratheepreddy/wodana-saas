"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { parseDate } from "@internationalized/date";
import { Plus, X } from "lucide-react";
import type { CrewDay, CrewPresence, HrmsBootstrap, HrmsCrewState } from "@wodana/contracts";
import {
  Button, ComboboxField, ControlledModalDialog, DataGrid, DateField, EmptyState, ErrorState, IconButton, InlineNotice, InspectorSheet, NoAccessState, NoResultsState,
  NumericInput, SegmentedControl, SelectField, TextAreaField, useDesignSystem, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { hrmsApi, type CrewDayList, type HrmsApi } from "@/lib/hrms/api";
import { hrmsHref } from "@/lib/hrms/sections";
import { HrmsError } from "@/lib/hrms/client";
import { dayCost, lineCost } from "@/lib/hrms/crew-cost";
import { CameraCapture, PositionStatus, usePosition, type Photo } from "./check-in";
import { EvidencePhoto, Facts } from "./hrms-controls";
import { useHrmsFormat } from "./hrms-format";
import { SheetStatus, useHrmsLabels, usePresenceLabels } from "./hrms-labels";
import styles from "./hrms.module.css";

const MIN_REASON = 3;
const PRESENCE: CrewPresence[] = ["present", "half_day", "absent"];

/** Who is looking: their user and membership, and what they may see and do with crew days. */
type Viewer = { userId: string | null; membershipId: string; evidence: boolean; broad: boolean };
type Loaded = { list: CrewDayList; crews: HrmsCrewState; boot: HrmsBootstrap };

const editable = (day: CrewDay) => (day.status === "draft" || day.status === "returned") && day.canMark !== false;
const newestFirst = (a: CrewDay, b: CrewDay) => b.workDate.localeCompare(a.workDate) || a.crewName.localeCompare(b.crewName);
/** Change responses don't carry what the viewer may do next; keep what the list said until it reloads. */
const merge = (days: CrewDay[], day: CrewDay) => {
  const before = days.find((item) => item.id === day.id);
  const next = { ...day, canMark: day.canMark ?? before?.canMark ?? true, canDecide: day.canDecide ?? false };
  return [next, ...days.filter((item) => item.id !== day.id)].sort(newestFirst);
};

function useCrewData(api: HrmsApi, projectId: string | null, boot?: HrmsBootstrap) {
  const t = useT();
  const format = useHrmsFormat();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const load = useCallback(async () => {
    try {
      const [list, crews, me] = await Promise.all([api.crewDays(projectId ? { projectId } : {}), api.crews(), boot ?? api.bootstrap()]);
      setData({ list, crews, boot: me }); setError(null);
    } catch (cause) {
      setError({ message: format.failure(cause, t("Crew days didn't load.")), denied: cause instanceof HrmsError && cause.status === 403 });
    }
  }, [api, projectId, boot, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const changed = useCallback((day: CrewDay) => {
    setData((current) => (current ? { ...current, list: { ...current.list, days: merge(current.list.days, day) } } : current));
    void load();
  }, [load]);
  return { data, error, load, changed };
}

/**
 * A project's crew days: who of each crew was on site each day, marked by the crew's lead or the
 * project's managers and site supervisors, sent with a group photo, and approved by someone else.
 */
export function ProjectCrewDays({ workspaceId, projectId, openId, switcher, me, onTeam }: {
  workspaceId: string; projectId: string; openId: string | null; switcher: ReactNode;
  /** The viewer's user id, and whether they're on the project's team (its managers and supervisors mark crew days). */
  me: string; onTeam: boolean;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const api = useMemo(() => hrmsApi(workspaceId), [workspaceId]);
  const { data, error, load, changed } = useCrewData(api, projectId);
  const [open, setOpen] = useState<string | null>(openId);
  const [search, setSearch] = useState("");
  const columns = useMemo<DataGridColumn<CrewDay>[]>(() => [
    { id: "date", header: t("Date"), accessorFn: (row) => row.workDate, size: 140, meta: { renderCell: (row) => format.day(row.workDate) } },
    { id: "crew", header: t("Crew"), accessorFn: (row) => row.crewName, size: 220, meta: { primary: true,
      renderCell: (row) => <span className={styles.nameCell}><span>{row.crewName}</span><small>{row.trade}</small></span> } },
    { id: "people", header: t("People"), accessorFn: (row) => row.present, size: 100, meta: { align: "end", renderCell: (row) => <span className={styles.number}>{format.number(row.present)}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 180, meta: { renderCell: (row) => <SheetStatus status={row.status} /> } },
    { id: "marked", header: t("Marked by"), accessorFn: (row) => row.markedByName, size: 180, meta: { mobileHidden: true } },
  ], [t, format]);
  if (error && !data) return <>{error.denied ? null : <div className={styles.toolbar}>{switcher}</div>}
    {error.denied ? <><div className={styles.toolbar}>{switcher}</div><NoAccessState /></> : <ErrorState description={error.message} onRetry={() => void load()} />}</>;
  const viewer: Viewer | null = data ? {
    userId: me, membershipId: data.boot.membershipId, evidence: data.boot.permissions.evidence,
    broad: data.crews.canManage || data.boot.permissions.manageProjects || onTeam,
  } : null;
  // The server says which crews this person may mark (their own crews, or all for a manager); older answers fall back to the same rule here.
  const markable = data && viewer ? data.crews.crews.filter((crew) => crew.active && (data.list.markableCrewIds ? data.list.markableCrewIds.includes(crew.id) : viewer.broad || crew.leadMembershipId === viewer.membershipId)) : [];
  const needle = search.trim().toLocaleLowerCase();
  const rows = (data?.list.days ?? []).filter((day) => !needle || `${day.crewName} ${day.trade} ${day.markedByName}`.toLocaleLowerCase().includes(needle));
  const mark = markable.length ? <Button variant="primary" onPress={() => setOpen("new")}><Plus aria-hidden="true" size={14} />{t("Mark crew day")}</Button> : undefined;
  // With no crews at all there's nothing to mark: the next step is adding the first crew, where crews are kept.
  const noCrews = Boolean(data && !data.crews.crews.some((crew) => crew.active));
  const empty = noCrews && data?.crews.canManage
    ? <EmptyState title={t("No crews yet")} action={<Link className="wd-button" data-variant="primary" href={hrmsHref("crews")}>{t("New crew")}</Link>} />
    : <EmptyState title={t("No crew days yet")} />;
  return <>
    <DataGrid<CrewDay> ariaLabel={t("Crew days")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!data} onRowAction={(row) => setOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search crew days")} rowNumbers={false} selectable={false} wrapText toolbarLeading={switcher} toolbarActions={mark}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : empty} />
    {data && viewer && open ? <CrewDayPanel api={api} data={data} viewer={viewer} projectId={projectId} markable={markable} open={open} showPlace={false}
      onOpen={setOpen} onChanged={changed} /> : null}
  </>;
}

/** The crew day a notice links to, opened over the Crews tab (the workshop's days have no project page). */
export function LinkedCrewDay({ api, boot, id, onClose }: { api: HrmsApi; boot: HrmsBootstrap; id: string; onClose: () => void }) {
  const t = useT();
  const { data, error, changed } = useCrewData(api, null, boot);
  const [open, setOpen] = useState<string | null>(id);
  if (error && !data) return <InlineNotice tone="error" message={error.message} />;
  if (!data) return null;
  if (!data.list.days.some((day) => day.id === id)) return <InlineNotice tone="info" message={t("This crew day isn't there any more.")} />;
  const viewer: Viewer = { userId: boot.employee?.userId ?? null, membershipId: boot.membershipId, evidence: boot.permissions.evidence,
    broad: data.crews.canManage || boot.permissions.manageProjects };
  const markable = data.crews.crews.filter((crew) => crew.active && (data.list.markableCrewIds ? data.list.markableCrewIds.includes(crew.id) : viewer.broad || crew.leadMembershipId === viewer.membershipId));
  return open ? <CrewDayPanel api={api} data={data} viewer={viewer} projectId={null} markable={markable} open={open} showPlace
    onOpen={(next) => { setOpen(next); if (!next) onClose(); }} onChanged={changed} /> : null;
}

/** One crew day: its form while it's being marked, else what was sent and, for the approver, the decision. */
function CrewDayPanel({ api, data, viewer, projectId, markable, open, showPlace, onOpen, onChanged }: {
  api: HrmsApi; data: Loaded; viewer: Viewer; projectId: string | null; markable: HrmsCrewState["crews"]; open: string; showPlace: boolean;
  onOpen: (id: string | null) => void; onChanged: (day: CrewDay) => void;
}) {
  const day = open === "new" ? null : data.list.days.find((item) => item.id === open) ?? null;
  if (open !== "new" && !day) return null;
  if (!day || editable(day))
    return <CrewDayForm key={open} api={api} day={day} crews={data.crews} markable={markable} projectId={day?.projectId ?? projectId} viewer={viewer}
      onClose={() => onOpen(null)} onSaved={onChanged} onSubmitted={(submitted) => { onChanged(submitted); onOpen(submitted.id); }} />;
  return <CrewDayView key={open} api={api} day={day} viewer={viewer} canSeeCosts={data.list.canSeeCosts} showPlace={showPlace} onClose={() => onOpen(null)} onChanged={onChanged} />;
}

type Row = { workerId: string; name: string; detail: string; presence: CrewPresence; overtime: number; extra: boolean };

/**
 * Marking a crew's day: the crew, the day (today unless it's marked afterwards; never ahead), each of its
 * workers there the whole day, half of it or not, with any overtime; someone from another crew can be added.
 * Saved as a draft, then submitted with a group photo and the phone's position.
 */
function CrewDayForm({ api, day, crews, markable, projectId, viewer, onClose, onSaved, onSubmitted }: {
  api: HrmsApi; day: CrewDay | null; crews: HrmsCrewState; markable: HrmsCrewState["crews"]; projectId: string | null; viewer: Viewer;
  onClose: () => void; onSaved: (day: CrewDay) => void; onSubmitted: (day: CrewDay) => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const presence = usePresenceLabels();
  const today = format.today();
  const [id] = useState(() => day?.id ?? crypto.randomUUID());
  const [saved, setSaved] = useState<CrewDay | null>(day);
  const workerRow = useCallback((workerId: string, crewId: string | null, presenceValue: CrewPresence = "present", overtime = 0): Row | null => {
    const worker = crews.workers.find((item) => item.id === workerId);
    if (!worker) return null;
    return { workerId, name: worker.name, detail: [worker.workerCode, worker.trade].filter(Boolean).join(" · "), presence: presenceValue, overtime, extra: worker.crewId !== crewId };
  }, [crews.workers]);
  const crewRows = useCallback((crewId: string | null) => (crewId ? crews.workers.filter((worker) => worker.active && worker.crewId === crewId)
    .map((worker) => workerRow(worker.id, crewId)).filter((row): row is Row => Boolean(row)) : []), [crews.workers, workerRow]);
  const initial = useMemo(() => {
    const crewId = day?.crewId ?? (markable.length === 1 ? markable[0].id : null);
    return {
      crewId, workDate: day?.workDate ?? today, note: day?.note ?? "",
      rows: day ? day.workers.map((line) => workerRow(line.workerId, day.crewId, line.presence, Number(line.overtimeHours)) ?? {
        workerId: line.workerId, name: line.name, detail: line.trade, presence: line.presence, overtime: Number(line.overtimeHours), extra: false,
      }) : crewRows(crewId),
    };
  }, [day, markable, today, workerRow, crewRows]);
  const [draft, setDraft] = useState(initial);
  const [adding, setAdding] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [submitting, setSubmitting] = useState<CrewDay | null>(null);
  const crewItems = [...markable, ...(day && !markable.some((crew) => crew.id === day.crewId) ? crews.crews.filter((crew) => crew.id === day.crewId) : [])]
    .map((crew) => ({ id: crew.id, label: crew.name, description: crew.trade }));
  const others = crews.workers.filter((worker) => worker.active && !draft.rows.some((row) => row.workerId === worker.id))
    .map((worker) => ({ id: worker.id, label: worker.name, description: [crews.crews.find((crew) => crew.id === worker.crewId)?.name, worker.trade].filter(Boolean).join(" · ") }));
  const future = draft.workDate > today;
  const someone = draft.rows.some((row) => row.presence !== "absent");
  const valid = Boolean(draft.crewId && draft.workDate) && !future && someone;
  const dirty = !saved || JSON.stringify(draft) !== JSON.stringify(initial);
  // Whoever saves the day marks it and submits it, so a day someone else marked is saved again first.
  const unsaved = dirty || !saved || saved.markedBy !== viewer.userId;
  const setRow = (workerId: string, patch: Partial<Row>) => setDraft((current) => ({ ...current, rows: current.rows.map((row) => (row.workerId === workerId ? { ...row, ...patch } : row)) }));
  const persist = async () => {
    const next = await api.saveCrewDay(id, {
      version: saved?.version ?? 0, crewId: draft.crewId!, projectId, workDate: draft.workDate, note: draft.note.trim(),
      workers: draft.rows.map((row) => ({ workerId: row.workerId, presence: row.presence, overtimeHours: row.overtime })),
    });
    setSaved(next);
    onSaved(next);
    return next;
  };
  const run = async (kind: "save" | "submit") => {
    setBusy(kind); setError("");
    try {
      const next = (kind === "save" ? dirty || !saved : unsaved) ? await persist() : saved!;
      if (kind === "save") onClose();
      else setSubmitting(next);
    } catch (cause) { setError(format.failure(cause, t("Could not save."))); }
    setBusy(null);
  };
  const title = day ? `${day.crewName} · ${format.date(day.workDate)}` : t("Mark crew day");
  return <InspectorSheet isOpen size="lg" title={title} isDirty={Boolean(saved) ? dirty && !busy : draft.rows.length > 0 && !busy} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={<div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button isLoading={busy === "save"} isDisabled={Boolean(busy) || !valid} onPress={() => void run("save")}>{t("Save draft")}</Button>
      <Button variant="primary" isLoading={busy === "submit"} isDisabled={Boolean(busy) || !valid} onPress={() => void run("submit")}>{t("Submit")}</Button>
    </div>}>
    <div className={styles.sheet}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {day?.decisionNote ? <InlineNotice tone="info" message={day.decidedByName ? t("Sent back by {name}: {note}", { name: day.decidedByName, note: day.decisionNote })
        : t("Sent back: {note}", { note: day.decisionNote })} /> : null}
      <div className={styles.pair}>
        <SelectField label={t("Crew")} isRequired placeholder={t("Choose")} selectedKey={draft.crewId} items={crewItems}
          onSelectionChange={(key) => { const crewId = key ? String(key) : null; if (crewId !== draft.crewId) setDraft((current) => ({ ...current, crewId, rows: crewRows(crewId) })); }} />
        <DateField label={t("Day")} isRequired maxValue={parseDate(today)} value={draft.workDate ? parseDate(draft.workDate) : null}
          onChange={(value) => setDraft((current) => ({ ...current, workDate: value ? value.toString() : "" }))}
          isInvalid={future} errorMessage={future ? t("A crew day can't be in the future.") : undefined} />
      </div>
      {draft.crewId ? <fieldset className={styles.crewGroup}>
        <legend>{t("Who was there")}</legend>
        {draft.rows.length ? <>
          <div className={styles.crewHead} aria-hidden="true"><span>{t("Worker")}</span><span>{t("Overtime")}</span></div>
          <ul className={styles.crewWorkers}>{draft.rows.map((row) => <li key={row.workerId}>
            <span className={styles.grow}><span>{row.name}</span>{row.detail ? <small>{row.detail}</small> : null}</span>
            <SegmentedControl label={t("{name} was", { name: row.name })} value={row.presence} onChange={(value) => setRow(row.workerId, { presence: value as CrewPresence })}
              options={PRESENCE.map((item) => ({ id: item, label: presence[item] }))} />
            <NumericInput aria-label={t("Overtime for {name}", { name: row.name })} label={null} minValue={0} maxValue={16} step={0.5} suffix={format.unit("hour")}
              value={row.overtime} onChange={(value) => setRow(row.workerId, { overtime: Number.isFinite(value) ? value : 0 })} />
            {row.extra ? <IconButton aria-label={t("Remove {name}", { name: row.name })} size="compact" variant="quiet"
              onPress={() => setDraft((current) => ({ ...current, rows: current.rows.filter((item) => item.workerId !== row.workerId) }))}><X aria-hidden="true" size={14} /></IconButton>
              : <span />}
          </li>)}</ul>
        </> : <p className={styles.muted}>{t("No workers in this crew")}</p>}
        {others.length ? <ComboboxField key={adding} label={t("Add a worker")} items={others} placeholder={t("Someone from another crew")}
          onSelectionChange={(key) => {
            const row = key ? workerRow(String(key), draft.crewId) : null;
            if (row) { setDraft((current) => ({ ...current, rows: [...current.rows, { ...row, extra: true }] })); setAdding((value) => value + 1); }
          }} /> : null}
        {draft.rows.length && !someone ? <p className={styles.muted} role="status">{t("Mark who was there.")}</p> : null}
      </fieldset> : null}
      <TextAreaField label={t("Note")} value={draft.note} onChange={(note) => setDraft((current) => ({ ...current, note }))} />
    </div>
    {submitting ? <SubmitCrewDayDialog api={api} day={submitting} today={today} onClose={() => setSubmitting(null)} onSubmitted={onSubmitted} /> : null}
  </InspectorSheet>;
}

/**
 * Sending the day for approval: a group photo from the back camera and the phone's position. Without them,
 * or when it's marked afterwards, a reason goes with it; the server may ask for one too and the same day
 * (and photo) is sent again with it.
 */
function SubmitCrewDayDialog({ api, day, today, onClose, onSubmitted }: {
  api: HrmsApi; day: CrewDay; today: string; onClose: () => void; onSubmitted: (day: CrewDay) => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const labels = useHrmsLabels();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const position = usePosition();
  const sent = useRef<{ blob: Blob; id: string } | null>(null);
  const [issues, setIssues] = useState<string[] | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needsReason = Boolean(issues?.length) || !photo || !position.value || day.workDate !== today;
  const ready = !busy && (!needsReason || reason.trim().length >= MIN_REASON);
  const submit = async () => {
    setBusy(true); setError("");
    let captureId: string | null = null;
    if (photo) {
      try {
        if (sent.current?.blob !== photo.blob) {
          const capture = crypto.randomUUID();
          await api.startCapture(capture);
          await api.uploadPhoto(capture, photo.blob);
          sent.current = { blob: photo.blob, id: capture };
        }
        captureId = sent.current.id;
      } catch (cause) {
        setError(t("The photo couldn't be sent: {reason}", { reason: format.failure(cause, t("Try again.")) }));
        setBusy(false);
        return;
      }
    }
    try {
      onSubmitted(await api.submitCrewDay(day.id, { version: day.version, captureId, position: position.value, exceptionReason: needsReason ? reason.trim() : "" }));
    } catch (cause) {
      if (cause instanceof HrmsError && cause.status === 400 && cause.issues.length) setIssues(cause.issues);
      else setError(format.failure(cause, t("Could not submit.")));
      setBusy(false);
    }
  };
  return <ControlledModalDialog isOpen size="md" title={t("Group photo")} isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button isDisabled={busy} onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!ready} onPress={() => void submit()}>{t("Submit")}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <CameraCapture facing="environment" photoLabel={t("Group photo")} onChange={(next) => { setPhoto(next); if (next) position.locate(); }}>
        <PositionStatus position={position} />
      </CameraCapture>
      {issues ? <InlineNotice tone="info" title={t("Needs a reason")} message={<ul className={styles.issues}>{issues.map((issue) => <li key={issue}>{labels.issue(issue)}</li>)}</ul>} /> : null}
      {needsReason ? <TextAreaField label={t("Reason for review")} isRequired value={reason} onChange={setReason} /> : null}
    </div>
  </ControlledModalDialog>;
}

/** A sent crew day: who was there, the photo and where it was taken, any reason; approved, what it cost. The approver decides here. */
function CrewDayView({ api, day, viewer, canSeeCosts, showPlace, onClose, onChanged }: {
  api: HrmsApi; day: CrewDay; viewer: Viewer; canSeeCosts: boolean; showPlace: boolean; onClose: () => void; onChanged: (day: CrewDay) => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const labels = useHrmsLabels();
  const presence = usePresenceLabels();
  const { locale } = useDesignSystem();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const money = (value: string | null, currency: string | null) => {
    if (value === null || !currency) return "";
    try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(value)); } catch { return `${currency} ${value}`; }
  };
  const decide = async (decision: "approve" | "return", note = "") => {
    setBusy(true); setError("");
    try { onChanged(await api.decideCrewDay(day.id, { version: day.version, decision, note })); setBusy(false); return true; }
    catch (cause) { setError(format.failure(cause, t("Could not save."))); setBusy(false); return false; }
  };
  const evidence = day.evidence ?? {};
  // The location shows on its own line; the other issues after it.
  const issues = (evidence.issues ?? []).filter((issue) => !(evidence.arrival && issue.startsWith("Location ")));
  const costs = canSeeCosts && day.status === "approved";
  const totals = costs ? dayCost(day.workers) : [];
  const photo = day.captureId && evidence.photoCaptured && (viewer.evidence || day.markedBy === viewer.userId);
  return <InspectorSheet isOpen size="md" title={`${day.crewName} · ${format.date(day.workDate)}`} description={day.trade} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={day.canDecide ? <div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button isDisabled={busy} onPress={() => setReturning(true)}>{t("Send back")}</Button>
      <Button variant="primary" isLoading={busy} onPress={() => void decide("approve")}>{t("Approve")}</Button></div> : null}>
    <div className={styles.sheet}>
      {error && !returning ? <InlineNotice tone="error" message={error} /> : null}
      <Facts items={[
        [t("Status"), <SheetStatus key="status" status={day.status} />],
        showPlace ? [t("Place"), day.projectName ?? t("Workshop")] : null,
        [t("Marked by"), [day.markedByName, format.moment(day.submittedAt)].filter(Boolean).join(" · ")],
        [t("People"), format.number(day.present)],
        evidence.arrival ? [t("Location"), labels.location(evidence.arrival.status)] : null,
        issues.length ? [t("Issues"), issues.map(labels.issue).join(", ")] : null,
        day.exceptionReason ? [t("Reason"), day.exceptionReason] : null,
        day.note ? [t("Note"), day.note] : null,
        day.decidedByName ? [day.status === "approved" ? t("Approved by") : t("Sent back by"), [day.decidedByName, format.moment(day.decidedAt)].filter(Boolean).join(" · ")] : null,
        day.decisionNote && day.status !== "submitted" ? [t("What to change"), day.decisionNote] : null,
      ]} />
      {photo ? <EvidencePhoto size="large" src={api.photoUrl(day.captureId!)} alt={t("Group photo of {crew}", { crew: day.crewName })} /> : null}
      <section className={styles.part} aria-label={t("Who was there")}>
        <h3 className={styles.subhead}>{t("Who was there")}</h3>
        <ul className={styles.list}>{day.workers.map((line) => {
          const overtime = Number(line.overtimeHours);
          return <li key={line.workerId}>
            <span className={styles.grow}><span>{line.name}</span>
              <small>{[presence[line.presence], overtime > 0 ? t("{time} overtime", { time: format.duration(Math.round(overtime * 60)) }) : "",
                costs && line.dayRate ? t("{amount} a day", { amount: money(line.dayRate, line.currency) }) : ""].filter(Boolean).join(" · ")}</small></span>
            {costs && line.dayRate ? <span className={styles.number}>{money(lineCost(line.dayRate, line.presence), line.currency)}</span> : null}
          </li>;
        })}</ul>
        {costs ? <p className={styles.total}><span>{t("Total")}</span>
          <span className={styles.number}>{totals.length ? totals.map((total) => money(total.amount, total.currency)).join(" + ") : t("No rate")}</span></p> : null}
      </section>
    </div>
    {returning ? <ReturnCrewDayDialog error={error} busy={busy} onClose={() => { setReturning(false); setError(""); }}
      onSend={async (note) => { if (await decide("return", note)) setReturning(false); }} /> : null}
  </InspectorSheet>;
}

/** Sending a day back to whoever marked it, saying what to change. */
function ReturnCrewDayDialog({ error, busy, onClose, onSend }: { error: string; busy: boolean; onClose: () => void; onSend: (note: string) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState("");
  return <ControlledModalDialog isOpen size="md" title={t("Send the crew day back")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={note.trim().length < MIN_REASON} onPress={() => void onSend(note.trim())}>{t("Send back")}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextAreaField label={t("What to change")} isRequired value={note} onChange={setNote} />
    </div>
  </ControlledModalDialog>;
}
