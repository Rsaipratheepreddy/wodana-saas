"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Plus, X } from "lucide-react";
import {
  AutosaveState, Badge, Button, DateField, FileUploader, FormDialog, FormSection, IconButton, InlineNotice, MoreDetails, SegmentedControl, SelectField, Switch, TextAreaField, TextInput,
  useFormDraft,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { SiteApi } from "@/lib/site/client";
import { shrinkPhoto } from "@/lib/site/shrink-photo";
import type { Outlook, PhotoPhase, Safety, Severity, SiteReport, SiteState } from "@/lib/site/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import styles from "./daily-capture.module.css";

/** The quick steps for a task's progress; "Started" is recorded as 10. */
export const STEPS = [10, 25, 50, 75, 100] as const;
const numeric = (value: string) => value.replace(/[^\d.-]/g, "");

type Draft = {
  reportDate: string;
  tasks: Record<string, { progress: number; note: string }>;
  next: Array<{ workItemId: string | null; title: string }>;
  crew: Array<{ trade: string; people: string; hours: string }>;
  issues: Array<{ id: string; severity: Severity; description: string; internal: boolean; ownerId: string; dueOn: string | null }>;
  materials: Array<{ direction: "received" | "used"; description: string; quantity: string; unit: string; delivery: string }>;
  lines: Array<{ boqLineId: string; installed: string; note: string }>;
  photos: Record<string, { areaId: string | null; phase: PhotoPhase | null; pairId: string | null }>;
  noWork: boolean; noWorkReason: string; weather: string; safety: Safety; safetyNote: string; forecast: Outlook; impact: string; recoveryOwnerId: string; recoveryOn: string | null; notes: string;
};

/** A report as the form edits it: from its saved rows, or (new) from today's plan and the last crew. */
function draftOf(state: SiteState, report: SiteReport | null, day: string | null = null): Draft {
  const done = new Set(Object.values(report?.tasks ?? []).filter((task) => task.progress === 100).map((task) => task.workItemId));
  return {
    reportDate: report?.reportDate ?? day ?? state.today,
    tasks: Object.fromEntries((report?.tasks ?? []).map((task) => [task.workItemId, { progress: task.progress, note: task.note }])),
    next: report?.next?.length ? report.next.map((item) => ({ workItemId: item.workItemId, title: item.title }))
      : (state.plan?.tomorrow.tasks ?? []).filter((task) => !done.has(task.id)).map((task) => ({ workItemId: task.id, title: task.title })),
    crew: (report ? report.workforce : state.crew ?? []).map((row) => ({ trade: row.trade, people: String(row.people), hours: row.hours ? String(Number(row.hours)) : "" })),
    issues: (report?.issues ?? []).map((issue) => ({ id: issue.id, severity: issue.severity, description: issue.description, internal: issue.internal, ownerId: issue.ownerId ?? "",
      dueOn: issue.dueOn ?? null })),
    materials: (report?.materials ?? []).map((item) => ({ direction: item.direction, description: item.description, quantity: item.quantity ? quantityText(item.quantity) : "", unit: item.unit,
      delivery: item.purchaseOrderId ? `order:${item.purchaseOrderId}` : item.stockTransferId ? `transfer:${item.stockTransferId}` : "" })),
    lines: (report?.lines ?? []).map((line) => ({ boqLineId: line.boqLineId, installed: quantityText(line.installed) || line.installed, note: line.note })),
    photos: Object.fromEntries((report?.photos ?? []).map((photo) => [photo.id, { areaId: photo.areaId ?? null, phase: photo.phase ?? null, pairId: photo.pairId ?? null }])),
    noWork: Boolean(report?.noWorkReason), noWorkReason: report?.noWorkReason ?? "", weather: report?.weather ?? "", safety: report?.safety ?? "none", safetyNote: report?.safetyNote ?? "",
    forecast: report?.forecast ?? "none", impact: report?.impact ?? "", recoveryOwnerId: report?.recoveryOwnerId ?? "", recoveryOn: report?.recoveryOn ?? null, notes: report?.notes ?? "",
  };
}

/**
 * What goes to the server. A part still being filled in (a trade without people, a safety event without what happened)
 * is left out of an autosave, so the draft saves as the person types; submitting checks everything.
 */
function payloadOf(draft: Draft) {
  const safetyOk = draft.safety === "none" || Boolean(draft.safetyNote.trim());
  const outlookOk = draft.forecast === "none" || Boolean(draft.impact.trim() && draft.recoveryOwnerId && draft.recoveryOn);
  return {
    reportDate: draft.reportDate, weather: draft.weather.trim(), notes: draft.notes.trim(), noWorkReason: draft.noWork ? draft.noWorkReason.trim() : "",
    safety: safetyOk ? draft.safety : "none", safetyNote: safetyOk ? draft.safetyNote.trim() : "",
    forecast: outlookOk ? draft.forecast : "none", impact: outlookOk ? draft.impact.trim() : "", recoveryOwnerId: outlookOk && draft.forecast !== "none" ? draft.recoveryOwnerId : null,
    recoveryOn: outlookOk && draft.forecast !== "none" ? draft.recoveryOn : null,
    workforce: draft.crew.filter((row) => row.trade.trim() && Number(row.people) > 0).map((row) => ({ trade: row.trade.trim(), people: Number(row.people), hours: row.hours ? Number(row.hours) : null })),
    tasks: Object.entries(draft.tasks).map(([workItemId, entry]) => ({ workItemId, progress: entry.progress, note: entry.note.trim() })),
    next: draft.next.filter((item) => item.title.trim()).map((item) => ({ workItemId: item.workItemId, title: item.title.trim() })),
    issues: draft.issues.filter((issue) => issue.description.trim()).map((issue) => ({ ...issue, description: issue.description.trim(), ownerId: issue.ownerId || null })),
    materials: draft.materials.filter((item) => item.description.trim()).map((item) => ({ direction: item.direction, description: item.description.trim(), quantity: item.quantity || null, unit: item.unit.trim(),
      purchaseOrderId: item.delivery.startsWith("order:") ? item.delivery.slice(6) : null, stockTransferId: item.delivery.startsWith("transfer:") ? item.delivery.slice(9) : null })),
    lines: draft.lines.filter((line) => line.boqLineId && line.installed && (Number(line.installed) > 0 || line.note.trim())).map((line) => ({ ...line, note: line.note.trim() })),
    photos: Object.entries(draft.photos).map(([id, tags]) => ({ id, ...tags })),
  };
}

type Pending = { id: string; file: File; preview: string; tags: { areaId: string | null; phase: PhotoPhase | null; pairId: string | null } };

/**
 * The day's report, phone-first and about two minutes: today's planned work with one tap each, photos by room
 * (compressed on the device, before/after paired), the crew (yesterday's, ready), issues with a snag or material
 * request a tap away, and tomorrow from the plan. It saves itself as a draft while it's written, and keeps what's
 * typed on this device, so a lost connection loses nothing.
 */
export function DailyCapture({ workspaceId, projectId, api, state, report, day = null, onState, onClose }: {
  workspaceId: string; projectId: string; api: SiteApi; state: SiteState; report: SiteReport | null;
  /** A new report for a missed day (backdated); today otherwise. */
  day?: string | null;
  onState: (state: SiteState) => void; onClose: () => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  // One id for the report this form writes, fixed when it opens (a new day gets its own).
  const [reportId] = useState(() => report?.id ?? crypto.randomUUID());
  const saved = state.reports.find((row) => row.id === reportId) ?? null;
  const version = useRef<number | null>(saved?.version ?? null);
  const initial = useMemo(() => draftOf(state, report, day), []); // eslint-disable-line react-hooks/exhaustive-deps -- the form opens once
  const [draft, setDraft] = useState<Draft>(initial);
  const lastSent = useRef(JSON.stringify(payloadOf(initial)));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [problem, setProblem] = useState("");
  // The row Add (or Enter) just made under Tomorrow takes the cursor, so what's typed next lands in it.
  const [nextFocus, setNextFocus] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [raising, setRaising] = useState<string | null>(null);
  const drafts = useFormDraft(`site-report:${workspaceId}:${projectId}:${reportId}`, draft, { isDirty: JSON.stringify(draft) !== JSON.stringify(initial), restore: setDraft });
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const addNext = () => { setNextFocus(draft.next.length); set({ next: [...draft.next, { workItemId: null, title: "" }] }); };
  const saving = useRef<Promise<boolean> | null>(null);

  /** Saves the draft now if it changed (one save at a time); true when the server has it. */
  const save = useCallback(async (force = false): Promise<boolean> => {
    if (saving.current) await saving.current;
    const body = payloadOf(draft);
    const serialized = JSON.stringify(body);
    if (!force && serialized === lastSent.current && version.current !== null) return true;
    const run = (async () => {
      setStatus("saving");
      try {
        const next = await api.command("save_report", { id: reportId, ...body, ...(version.current !== null ? { version: version.current } : {}) });
        version.current = next.reports.find((row) => row.id === reportId)?.version ?? version.current;
        lastSent.current = serialized;
        onState(next);
        setStatus("saved"); setProblem("");
        return true;
      } catch (cause) {
        setStatus("error");
        setProblem(cause instanceof Error ? cause.message : t("Could not save."));
        // Someone (or another tab) saved it first: take their version, keep these changes, and save again next time.
        if (cause instanceof Error && "status" in cause && cause.status === 409) {
          const fresh = await api.state().catch(() => null);
          if (fresh) { version.current = fresh.reports.find((row) => row.id === reportId)?.version ?? version.current; onState(fresh); }
        }
        return false;
      }
    })();
    saving.current = run;
    const result = await run;
    saving.current = null;
    return result;
  }, [api, draft, onState, reportId, t]);

  // Saves itself a moment after each change.
  useEffect(() => {
    if (JSON.stringify(payloadOf(draft)) === lastSent.current) return;
    const timer = window.setTimeout(() => { void save(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [draft, save]);

  const areas = state.areas ?? [];
  const today = state.plan?.today ?? [];
  const extra = (saved?.tasks ?? report?.tasks ?? []).filter((task) => !today.some((item) => item.id === task.workItemId));
  const photos = saved?.photos ?? report?.photos ?? [];
  const hasPhotos = photos.length + pending.length > 0;
  const evidence = hasPhotos || (draft.noWork && draft.noWorkReason.trim());
  const steps = [{ id: "10", label: t("Started") }, { id: "25", label: "25%" }, { id: "50", label: "50%" }, { id: "75", label: "75%" }, { id: "100", label: t("Done") }];

  const choose = (workItemId: string, progress: number) => setDraft((current) => {
    const tasks = { ...current.tasks, [workItemId]: { progress, note: current.tasks[workItemId]?.note ?? "" } };
    // Finished today: it isn't tomorrow's work any more.
    const next = progress === 100 ? current.next.filter((item) => item.workItemId !== workItemId) : current.next;
    return { ...current, tasks, next };
  });
  const clear = (workItemId: string) => setDraft((current) => { const tasks = { ...current.tasks }; delete tasks[workItemId]; return { ...current, tasks }; });

  const addPhotos = async (files: File[]) => {
    const room = 20 - photos.length - pending.length;
    const chosen = files.filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, room));
    if (!chosen.length) return;
    const added = await Promise.all(chosen.map(async (file) => {
      const small = await shrinkPhoto(file);
      return { id: crypto.randomUUID(), file: small, preview: URL.createObjectURL(small), tags: { areaId: null, phase: null, pairId: null } } as Pending;
    }));
    setPending((current) => [...current, ...added]);
    // The report must exist before its photos; then each goes up once, by its id.
    if (!(await save(version.current === null))) return;
    for (const photo of added) {
      try {
        const next = await api.uploadPhoto(reportId, photo.id, photo.file, photo.tags);
        version.current = next.reports.find((row) => row.id === reportId)?.version ?? version.current;
        onState(next);
        setPending((current) => current.filter((item) => item.id !== photo.id));
        URL.revokeObjectURL(photo.preview);
      } catch (cause) { setProblem(cause instanceof Error ? cause.message : t("The photo could not be uploaded.")); }
    }
    // Rooms and pairs chosen while they were uploading go with the next save.
    await save(true);
  };
  const tag = (id: string, patch: Partial<Draft["photos"][string]>) => setDraft((current) => {
    const photosDraft = { ...current.photos, [id]: { ...(current.photos[id] ?? { areaId: null, phase: null, pairId: null }), ...patch } };
    // A pair points both ways; the other half takes the opposite phase and the same room.
    if (patch.pairId !== undefined) {
      for (const [other, tags] of Object.entries(photosDraft)) if (other !== id && (tags.pairId === id || other === patch.pairId)) photosDraft[other] = { ...tags, pairId: other === patch.pairId ? id : null };
      if (patch.pairId && !photosDraft[patch.pairId]) photosDraft[patch.pairId] = { areaId: null, phase: null, pairId: id };
      if (patch.pairId) {
        const mine = photosDraft[id];
        photosDraft[patch.pairId] = { ...photosDraft[patch.pairId], areaId: photosDraft[patch.pairId].areaId ?? mine.areaId,
          phase: photosDraft[patch.pairId].phase ?? (mine.phase === "before" ? "after" : mine.phase === "after" ? "before" : null) };
      }
    }
    return { ...current, photos: photosDraft };
  });

  const raise = async (issueId: string, kind: "snag" | "material" | "change_request") => {
    setRaising(`${issueId}:${kind}`); setProblem("");
    try {
      if (await save(true)) {
        // A snag is placed in the room the day's photos were tagged to.
        const photoArea = Object.values(draft.photos).find((tags) => tags.areaId)?.areaId ?? null;
        onState(await api.command("raise_issue", { issueId, kind, ...(kind === "snag" && photoArea ? { areaId: photoArea } : {}) }));
      }
    } catch (cause) { setProblem(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setRaising(null); }
  };

  /** A photo taken by mistake comes off the report (its tags with it). */
  const removePhoto = async (photoId: string) => {
    setProblem("");
    try {
      if (!(await save())) return;
      const next = await api.command("remove_photo", { reportId, photoId, version: version.current });
      version.current = next.reports.find((row) => row.id === reportId)?.version ?? version.current;
      onState(next);
      setDraft((current) => { const photosDraft = { ...current.photos }; delete photosDraft[photoId]; return { ...current, photos: photosDraft }; });
    } catch (cause) { setProblem(cause instanceof Error ? cause.message : t("Could not save.")); }
  };

  const submit = async () => {
    if (!evidence) throw new Error(t("Add a photo, or say why no work was done, to submit."));
    if (draft.safety !== "none" && !draft.safetyNote.trim()) throw new Error(t("Say what happened on safety."));
    if (draft.forecast !== "none" && !(draft.impact.trim() && draft.recoveryOwnerId && draft.recoveryOn)) throw new Error(t("An outlook at risk needs what, who recovers it and by when."));
    if (pending.length) throw new Error(t("Wait for the photos to finish uploading."));
    if (!(await save(true))) throw new Error(problem || t("Could not save."));
    const current = (await api.state()).reports.find((row) => row.id === reportId);
    if (!current) throw new Error(t("Could not save."));
    onState(await api.command("submit", { reportId, version: current.version }));
    drafts.clear();
    onClose();
  };

  const issueRow = (issue: Draft["issues"][number], index: number) => {
    const serverIssue = (saved?.issues ?? []).find((item) => item.id === issue.id);
    const update = (patch: Partial<Draft["issues"][number]>) => set({ issues: draft.issues.map((item, at) => (at === index ? { ...item, ...patch } : item)) });
    return <li key={issue.id} className={styles.issue}>
      <div className={styles.issueHead}>
        <SegmentedControl label={t("How serious")} value={issue.severity} onChange={(value) => update({ severity: value as Severity })}
          options={[{ id: "minor", label: t("Minor") }, { id: "major", label: t("Major") }, { id: "critical", label: t("Critical") }]} />
        <IconButton aria-label={t("Remove")} size="compact" variant="quiet" onPress={() => set({ issues: draft.issues.filter((_, at) => at !== index) })}><X aria-hidden="true" size={14} /></IconButton>
      </div>
      <TextAreaField aria-label={t("What's wrong")} label={null} placeholder={t("What's wrong")} value={issue.description} onChange={(description) => update({ description })} />
      <div className={styles.issueOwner}>
        <SelectField aria-label={t("Owner")} label={null} placeholder={t("Owner")} accent="neutral" selectedKey={issue.ownerId}
          items={[{ id: "", label: t("No owner") }, ...state.members.map((member) => ({ id: member.membershipId, label: member.name }))]}
          onSelectionChange={(key) => update({ ownerId: key ? String(key) : "" })} />
        <DateField aria-label={t("Due")} label={null} value={issue.dueOn ? parseDate(issue.dueOn) : null} onChange={(value) => update({ dueOn: value ? value.toString() : null })} />
      </div>
      <div className={styles.issueFoot}>
        <Switch isSelected={!issue.internal} onChange={(value) => update({ internal: !value })}>{t("The client can read this")}</Switch>
        {serverIssue?.raised ? <Badge tone="info">{serverIssue.raised === "snag" ? t("Snag #{number}", { number: serverIssue.workItemNumber ?? "" })
          : serverIssue.raised === "change_request" ? t("Change request raised") : t("Material requested · #{number}", { number: serverIssue.workItemNumber ?? "" })}</Badge>
          : <>
            <Button size="compact" variant="quiet" isDisabled={!issue.description.trim() || Boolean(raising)} isLoading={raising === `${issue.id}:snag`} onPress={() => void raise(issue.id, "snag")}>{t("Raise a snag")}</Button>
            <Button size="compact" variant="quiet" isDisabled={!issue.description.trim() || Boolean(raising)} isLoading={raising === `${issue.id}:change_request`}
              onPress={() => void raise(issue.id, "change_request")}>{t("Raise a change request")}</Button>
            <Button size="compact" variant="quiet" isDisabled={!issue.description.trim() || Boolean(raising)} isLoading={raising === `${issue.id}:material`} onPress={() => void raise(issue.id, "material")}>{t("Request material")}</Button>
          </>}
      </div>
    </li>;
  };

  const photoTile = (id: string, src: string, name: string, busy: boolean) => {
    const tags = draft.photos[id] ?? { areaId: null, phase: null, pairId: null };
    const others = [...photos.map((photo) => photo.id), ...pending.map((photo) => photo.id)].filter((other) => other !== id);
    return <li key={id} className={styles.photo} data-busy={busy || undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a private report photo, or a local preview before upload */}
      <img src={src} alt={name} />
      {!busy ? <IconButton className={styles.photoRemove} aria-label={t("Remove photo")} size="compact" variant="quiet" onPress={() => void removePhoto(id)}><X aria-hidden="true" size={14} /></IconButton> : null}
      <div className={styles.photoTags}>
        {areas.length ? <SelectField aria-label={t("Room or area")} label={null} placeholder={t("Room or area")} accent="neutral" selectedKey={tags.areaId ?? ""}
          items={[{ id: "", label: t("No room") }, ...areas.map((area) => ({ id: area.id, label: area.name }))]} onSelectionChange={(key) => tag(id, { areaId: key ? String(key) : null })} /> : null}
        <SegmentedControl label={t("Before or after")} value={tags.phase ?? ""} onChange={(value) => tag(id, { phase: (value || null) as PhotoPhase | null })}
          options={[{ id: "", label: t("Photo") }, { id: "before", label: t("Before") }, { id: "after", label: t("After") }]} />
        {tags.phase && others.length ? <SelectField aria-label={t("Pairs with")} label={null} placeholder={t("Pairs with")} accent="neutral" selectedKey={tags.pairId ?? ""}
          items={[{ id: "", label: t("No pair") }, ...others.map((other, index) => ({ id: other, label: t("Photo {number}", { number: index + 1 }) }))]}
          onSelectionChange={(key) => tag(id, { pairId: key ? String(key) : null })} /> : null}
      </div>
    </li>;
  };

  return <FormDialog size="lg" title={report ? t("Report for {date}", { date: format.day(draft.reportDate) }) : t("Today's report")} onClose={onClose} submitLabel={t("Submit")}
    cancelLabel={t("Close")} onSubmit={submit} isSubmitDisabled={!evidence || Boolean(pending.length)} draft={drafts} secondaryAction={<AutosaveState state={status} />}
    error={problem || undefined} errorTitle={t("Not saved yet")}>
    <FormRowDate value={draft.reportDate} today={state.today} onChange={(reportDate) => set({ reportDate })} isDisabled={Boolean(saved && saved.status !== "draft" && saved.status !== "returned")} />
    {saved?.status === "returned" && saved.decisionNote ? <InlineNotice tone="info" message={t("Sent back by {name}: {note}", { name: saved.decidedByName ?? "", note: saved.decisionNote })} /> : null}

    <FormSection title={t("Today's work")}>
      {today.length || extra.length ? <ul className={styles.tasks}>
        {[...today.map((task) => ({ id: task.id, number: task.number, title: task.title, progress: task.progress, done: task.status === "done", overdue: task.overdue, meta: [task.packageName, task.dueDate ? t("Due {date}", { date: format.short(task.dueDate) }) : null] })),
          ...extra.map((task) => ({ id: task.workItemId, number: task.number, title: task.title, progress: task.previous, done: false, overdue: false, meta: [] as Array<string | null> }))].map((task) => {
          const chosen = draft.tasks[task.id];
          return <li key={task.id} className={styles.task}>
            <div className={styles.taskHead}>
              <span className={styles.taskTitle}>{task.title}</span>
              {task.overdue ? <Badge tone="warning">{t("Late")}</Badge> : null}
              {task.done && !chosen ? <Badge tone="success">{t("Done")}</Badge> : null}
              <span className={styles.muted}>{[...task.meta, task.progress && !task.done ? t("Now {percent}%", { percent: task.progress }) : null].filter(Boolean).join(" · ")}</span>
            </div>
            {task.done && !chosen ? null : <div className={styles.taskSteps}>
              <SegmentedControl label={t("How far {task} got", { task: task.title })} value={chosen ? String(chosen.progress >= 100 ? 100 : STEPS.filter((step) => step <= chosen.progress).at(-1) ?? 10) : ""}
                onChange={(value) => choose(task.id, Number(value))} options={steps} />
              {chosen ? <Button size="compact" variant="quiet" onPress={() => clear(task.id)}>{t("Clear")}</Button> : null}
              {chosen && noteFor !== task.id && !chosen.note ? <Button size="compact" variant="quiet" onPress={() => setNoteFor(task.id)}>{t("Add a note")}</Button> : null}
            </div>}
            {chosen && (noteFor === task.id || chosen.note) ? <TextInput aria-label={t("Note on {task}", { task: task.title })} label={null} placeholder={t("A note (optional)")} value={chosen.note}
              onChange={(note) => set({ tasks: { ...draft.tasks, [task.id]: { ...chosen, note } } })} /> : null}
          </li>;
        })}
      </ul> : <p className={styles.muted}>{t("Nothing is planned for today on the plan.")}</p>}
    </FormSection>

    <FormSection title={t("Photos")}>
      {photos.length || pending.length ? <ul className={styles.photos}>
        {photos.map((photo) => photoTile(photo.id, api.photoUrl(photo.id), photo.name, false))}
        {pending.map((photo) => photoTile(photo.id, photo.preview, photo.file.name, true))}
      </ul> : null}
      <FileUploader appearance="button" accept="image/*" label={photos.length || pending.length ? t("Add more photos") : t("Add photos")} onFiles={(files) => void addPhotos(files)} />
    </FormSection>

    <FormSection title={t("Crew")}>
      {draft.crew.map((row, index) => <div key={index} className={styles.crew}>
        <TextInput aria-label={t("Trade")} label={null} placeholder={t("Trade")} value={row.trade} onChange={(trade) => set({ crew: draft.crew.map((item, at) => (at === index ? { ...item, trade } : item)) })} />
        <TextInput aria-label={t("People")} label={null} placeholder={t("People")} inputMode="numeric" value={row.people}
          onChange={(people) => set({ crew: draft.crew.map((item, at) => (at === index ? { ...item, people: people.replace(/\D/g, "") } : item)) })} />
        <TextInput aria-label={t("Hours")} label={null} placeholder={t("Hours")} inputMode="decimal" value={row.hours}
          onChange={(hours) => set({ crew: draft.crew.map((item, at) => (at === index ? { ...item, hours: numeric(hours) } : item)) })} />
        <IconButton aria-label={t("Remove")} size="compact" variant="quiet" onPress={() => set({ crew: draft.crew.filter((_, at) => at !== index) })}><X aria-hidden="true" size={13} /></IconButton>
      </div>)}
      <Button className={styles.addLine} size="compact" variant="quiet" onPress={() => set({ crew: [...draft.crew, { trade: "", people: "", hours: "" }] })}><Plus aria-hidden="true" size={14} />{t("Add a trade")}</Button>
    </FormSection>

    <FormSection title={t("Issues")}>
      {draft.issues.length ? <ul className={styles.issues}>{draft.issues.map(issueRow)}</ul> : null}
      <Button className={styles.addLine} size="compact" variant="quiet" onPress={() => set({ issues: [...draft.issues, { id: crypto.randomUUID(), severity: "minor", description: "", internal: true, ownerId: "", dueOn: null }] })}>
        <Plus aria-hidden="true" size={14} />{t("Add an issue")}</Button>
    </FormSection>

    <FormSection title={t("Tomorrow")}>
      {draft.next.length ? <ul className={styles.next}>{draft.next.map((item, index) => <li key={`${item.workItemId ?? "text"}-${index}`}>
        {item.workItemId ? <span>{item.title}</span>
          : <TextInput aria-label={t("Planned for tomorrow")} label={null} placeholder={t("Planned for tomorrow")} value={item.title} autoFocus={nextFocus === index}
            onChange={(title) => set({ next: draft.next.map((entry, at) => (at === index ? { ...entry, title } : entry)) })}
            // Enter starts the next line (it never submits the report); on an empty line it does nothing.
            onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); if (item.title.trim()) addNext(); }} />}
        <IconButton aria-label={t("Remove")} size="compact" variant="quiet" onPress={() => set({ next: draft.next.filter((_, at) => at !== index) })}><X aria-hidden="true" size={13} /></IconButton>
      </li>)}</ul> : null}
      <Button className={styles.addLine} size="compact" variant="quiet" onPress={addNext}><Plus aria-hidden="true" size={14} />{t("Add")}</Button>
    </FormSection>

    <Switch isSelected={draft.noWork} onChange={(noWork) => set({ noWork })}>{t("No work today")}</Switch>
    {draft.noWork ? <TextInput label={t("Why")} isRequired value={draft.noWorkReason} onChange={(noWorkReason) => set({ noWorkReason })} /> : null}
    {!evidence ? <InlineNotice tone="info" message={t("Add a photo, or say why no work was done, to submit.")} /> : null}

    <MoreDetails filled={[draft.materials.length, draft.lines.length, draft.weather, draft.safety !== "none", draft.forecast !== "none", draft.notes].filter(Boolean).length}>
      <FormSection title={t("Materials")}>
        {draft.materials.map((item, index) => {
          const update = (patch: Partial<Draft["materials"][number]>) => set({ materials: draft.materials.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)) });
          return <div key={index} className={styles.material}>
            <SegmentedControl label={t("Received or used")} value={item.direction} onChange={(value) => update({ direction: value as "received" | "used" })}
              options={[{ id: "received", label: t("Received") }, { id: "used", label: t("Used") }]} />
            <TextInput aria-label={t("Material")} label={null} placeholder={t("Material")} value={item.description} onChange={(description) => update({ description })} />
            <TextInput aria-label={t("Quantity")} label={null} placeholder={t("Quantity")} inputMode="decimal" value={item.quantity} onChange={(quantity) => update({ quantity: numeric(quantity) })} />
            <TextInput aria-label={t("Unit")} label={null} placeholder={t("Unit")} value={item.unit} onChange={(unit) => update({ unit })} />
            {state.deliveries?.length ? <SelectField aria-label={t("Delivery")} label={null} placeholder={t("Delivery")} accent="neutral" selectedKey={item.delivery}
              items={[{ id: "", label: t("No delivery") }, ...state.deliveries.map((delivery) => ({ id: `${delivery.kind}:${delivery.id}`, label: delivery.label }))]}
              onSelectionChange={(key) => update({ delivery: key ? String(key) : "" })} /> : null}
            <IconButton aria-label={t("Remove")} size="compact" variant="quiet" onPress={() => set({ materials: draft.materials.filter((_, at) => at !== index) })}><X aria-hidden="true" size={13} /></IconButton>
          </div>;
        })}
        <Button className={styles.addLine} size="compact" variant="quiet" onPress={() => set({ materials: [...draft.materials, { direction: "received", description: "", quantity: "", unit: "", delivery: "" }] })}>
          <Plus aria-hidden="true" size={14} />{t("Add a material")}</Button>
      </FormSection>
      <FormSection title={t("Installed")}>
        {draft.lines.map((line, index) => <div key={index} className={styles.crew}>
          <SelectField aria-label={t("Item")} label={null} placeholder={t("Item")} selectedKey={line.boqLineId}
            items={state.lines.map((item) => ({ id: item.id, label: `${item.title}${item.areaName ? ` · ${item.areaName}` : ""} (${quantityText(item.installed) || "0"} / ${quantityText(item.quantity)} ${item.unit})`.trim() }))}
            onSelectionChange={(key) => set({ lines: draft.lines.map((item, at) => (at === index ? { ...item, boqLineId: key ? String(key) : "" } : item)) })} />
          <TextInput aria-label={t("Quantity installed")} label={null} placeholder={t("Quantity")} inputMode="decimal" value={line.installed}
            onChange={(installed) => set({ lines: draft.lines.map((item, at) => (at === index ? { ...item, installed: numeric(installed) } : item)) })} />
          <IconButton aria-label={t("Remove")} size="compact" variant="quiet" onPress={() => set({ lines: draft.lines.filter((_, at) => at !== index) })}><X aria-hidden="true" size={13} /></IconButton>
          {Number(line.installed) < 0 ? <TextInput label={t("Why it's taken back")} isRequired value={line.note}
            onChange={(note) => set({ lines: draft.lines.map((item, at) => (at === index ? { ...item, note } : item)) })} /> : null}
        </div>)}
        {state.lines.length ? <Button className={styles.addLine} size="compact" variant="quiet" onPress={() => set({ lines: [...draft.lines, { boqLineId: "", installed: "", note: "" }] })}>
          <Plus aria-hidden="true" size={14} />{t("Add an item")}</Button> : null}
      </FormSection>
      <FormSection title={t("Conditions")}>
        <TextInput label={t("Weather")} value={draft.weather} onChange={(weather) => set({ weather })} />
        <SelectField label={t("Safety")} selectedKey={draft.safety} onSelectionChange={(key) => set({ safety: (key ?? "none") as Safety })}
          items={[{ id: "none", label: t("No safety issue") }, { id: "observation", label: t("Safety observation") }, { id: "incident", label: t("Incident") }]} />
        {draft.safety !== "none" ? <TextAreaField label={t("What happened")} isRequired value={draft.safetyNote} onChange={(safetyNote) => set({ safetyNote })} /> : null}
        <SelectField label={t("Outlook")} selectedKey={draft.forecast} onSelectionChange={(key) => set({ forecast: (key ?? "none") as Outlook })}
          items={[{ id: "none", label: t("On track") }, { id: "watch", label: t("At risk") }, { id: "blocked", label: t("Blocked") }]} />
        {draft.forecast !== "none" ? <>
          <TextAreaField label={t("What's at risk and how it's recovered")} isRequired value={draft.impact} onChange={(impact) => set({ impact })} />
          <SelectField label={t("Who recovers it")} isRequired placeholder={t("Choose")} selectedKey={draft.recoveryOwnerId} onSelectionChange={(key) => set({ recoveryOwnerId: key ? String(key) : "" })}
            items={state.members.map((member) => ({ id: member.membershipId, label: member.name }))} />
          <DateField label={t("By")} isRequired value={draft.recoveryOn ? parseDate(draft.recoveryOn) : null} onChange={(value) => set({ recoveryOn: value ? value.toString() : null })} />
        </> : null}
        <TextAreaField label={t("Notes for the team")} value={draft.notes} onChange={(notes) => set({ notes })} />
      </FormSection>
    </MoreDetails>
  </FormDialog>;
}

/** The day of the report (today unless it's for a day that was missed). */
function FormRowDate({ value, today, onChange, isDisabled }: { value: string; today: string; onChange: (value: string) => void; isDisabled: boolean }) {
  const t = useT();
  return <DateField label={t("Day")} isRequired isDisabled={isDisabled} value={parseDate(value)} maxValue={parseDate(today)} onChange={(next) => onChange(next ? next.toString() : today)} />;
}
