"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { parseDate } from "@internationalized/date";
import { Plus, X } from "lucide-react";
import { Button, Checkbox, ControlledModalDialog, DateField, EmptyState, ErrorState, IconButton, InlineNotice, SegmentedControl, SelectField, Skeleton, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { siteApi } from "@/lib/site/client";
import { useLiveInvalidate } from "@/lib/workspace/live-events";
import type { Outlook, Safety, SiteReport, SiteState } from "@/lib/site/types";
import { ProjectCrewDays } from "../hrms/crew-days";
import { ProjectSiteAccess } from "../hrms/site-access";
import { useProjectFormat } from "../project-core/format";
import { PhotoPicker, SavedPhotos } from "../purchasing/delivery-photos";
import { ProjectArrivals } from "../purchasing/project-arrivals";
import { quantityText } from "../purchasing/order-labels";
import { ClientIssues, useClientIssues } from "./client-issues";
import styles from "./site.module.css";

const numeric = (value: string) => value.replace(/[^\d.-]/g, "");

type SiteView = "reports" | "crew-days" | "deliveries" | "access" | "issues";

/**
 * A project's site: whether site work is running, the reports waiting for approval, and the day-by-day
 * reports — who worked, what was installed, safety and whether the plan is at risk; and, beside them, each
 * crew's day (a notice's `?crewDay=` link opens that one) and the issues the client reported in the portal
 * (`?issue=` opens one).
 */
export function ProjectSite({ workspaceId, projectId, projectName = "" }: { workspaceId: string; projectId: string; projectName?: string }) {
  const t = useT();
  const params = useSearchParams();
  const linkedDay = params?.get("crewDay") ?? null;
  const linkedIssue = params?.get("issue") ?? null;
  const [view, setView] = useState<SiteView>(linkedDay ? "crew-days" : linkedIssue ? "issues" : params?.get("view") === "deliveries" ? "deliveries" : "reports");
  const issues = useClientIssues(workspaceId, projectId);
  const format = useProjectFormat();
  const api = useMemo(() => siteApi(workspaceId, projectId), [workspaceId, projectId]);
  const [state, setState] = useState<SiteState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Home's "Site report" opens a new report on arrival (`?new=report`) for someone who reports on this project.
  const [editing, setEditing] = useState<SiteReport | "new" | null>(() => params?.get("new") === "report" ? "new" : null);
  const [returning, setReturning] = useState<SiteReport | null>(null);
  const [rejecting, setRejecting] = useState<{ report: SiteReport; lineId: string; title: string } | null>(null);
  const load = useCallback(async () => {
    try { setState(await api.state()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The site didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // Someone else's report or approval on this project shows without a refresh (a report being edited stays put).
  useLiveInvalidate(workspaceId, [`project:${projectId}`], () => { if (!editing && !returning) void load(); });
  const run = async (action: string, input: Record<string, unknown> = {}) => {
    setNotice("");
    try { setState(await api.command(action, input)); return true; }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("Could not save."));
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      return false;
    }
  };
  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!state) return <Skeleton lines={6} shape="rows" />;
  const onTeam = state.canReport || state.canManage;
  const switcher = <SegmentedControl label={t("Show")} value={view} onChange={(value) => setView(value as SiteView)}
    options={[{ id: "reports", label: t("Reports") }, { id: "crew-days", label: t("Crew days") },
      // What's on its way to site, received where it arrives.
      ...(onTeam ? [{ id: "deliveries", label: t("Deliveries") }, { id: "access", label: t("Access") }] : []),
      // Only once the client has reported something (or a notice links here).
      ...(issues.data?.issues.length || view === "issues" ? [{ id: "issues", label: t("Client issues"), count: issues.toTriage || undefined }] : [])]} />;
  if (view === "crew-days") return <div className={styles.site}>
    <ProjectCrewDays workspaceId={workspaceId} projectId={projectId} openId={linkedDay} switcher={switcher} me={state.me} onTeam={onTeam} />
  </div>;
  if (view === "deliveries") return <div className={styles.site}>
    <ProjectArrivals workspaceId={workspaceId} projectId={projectId} switcher={switcher} />
  </div>;
  if (view === "issues") return <div className={styles.site}>
    <ClientIssues projectId={projectId} client={issues} switcher={switcher} openId={linkedIssue} />
  </div>;
  if (view === "access") return <div className={styles.site}>
    <ProjectSiteAccess workspaceId={workspaceId} projectId={projectId} projectName={projectName} members={state.members} switcher={switcher} />
  </div>;
  const running = Boolean(state.site.startedOn && !state.site.finishedOn);
  const waiting = state.canApprove ? state.reports.filter((report) => report.status === "submitted" && report.authorId !== state.me) : [];
  const safety: Record<Safety, string> = { none: t("No safety issue"), observation: t("Safety observation"), incident: t("Incident") };
  const outlook: Record<Outlook, string> = { none: "", watch: t("At risk"), blocked: t("Blocked") };
  const statusLabel = { draft: t("Draft"), submitted: t("Waiting for approval"), approved: t("Approved"), returned: t("Sent back") };
  // A submitted report says who it waits for.
  const statusOf = (report: SiteReport) => (report.status === "submitted" && report.waitingFor?.length ? t("Waiting for {who}", { who: report.waitingFor.join(", ") }) : statusLabel[report.status]);

  const card = (report: SiteReport) => <li key={report.id} className={styles.report}>
    <div className={styles.reportHead}>
      <strong>{format.day(report.reportDate)}</strong>
      <span className={styles.muted}>{report.authorName}</span>
      <span className={styles.status} data-status={report.status}>{statusOf(report)}</span>
      <span className={styles.spacer} />
      {report.authorId === state.me && ["draft", "returned"].includes(report.status) && state.canReport ? <Button size="compact" onPress={() => setEditing(report)}>{t("Open")}</Button> : null}
    </div>
    {report.status === "returned" && report.decisionNote ? <InlineNotice tone="info" message={t("Sent back by {name}: {note}", { name: report.decidedByName ?? "", note: report.decisionNote })} /> : null}
    <ul className={styles.facts}>
      {report.workforce.length ? <li>{report.workforce.map((row) => t("{trade} {people}", { trade: row.trade, people: row.people })).join(" · ")}</li> : null}
      {report.noWorkReason ? <li>{t("No work: {reason}", { reason: report.noWorkReason })}</li> : null}
      {report.lines.map((line) => <li key={line.id}>{Number(line.installed) < 0
        ? t("{item}: {quantity} taken back ({note})", { item: line.title, quantity: `${quantityText(line.installed.replace("-", ""))} ${line.unit}`.trim(), note: line.note })
        : t("{item}: {quantity} installed", { item: line.title, quantity: `${quantityText(line.installed)} ${line.unit}`.trim() })}
        {report.status === "approved" && state.canApprove && Number(line.installed) > 0
          ? <> <button type="button" className={styles.inlineAction} onClick={() => setRejecting({ report, lineId: line.id, title: line.title })}>{t("Not accepted")}</button></> : null}</li>)}
      {report.safety !== "none" ? <li className={report.safety === "incident" ? styles.alert : undefined}>{`${safety[report.safety]}: ${report.safetyNote}`}</li> : null}
      {report.forecast !== "none" ? <li className={report.forecast === "blocked" ? styles.alert : undefined}>
        {t("{state}: {impact} — {owner} by {date}", { state: outlook[report.forecast], impact: report.impact, owner: report.recoveryOwnerName ?? "", date: format.day(report.recoveryOn) })}</li> : null}
      {report.weather ? <li className={styles.muted}>{report.weather}</li> : null}
      {report.notes ? <li className={styles.muted}>{report.notes}</li> : null}
    </ul>
    <SavedPhotos photos={report.photos.map((photo) => ({ ...photo, byName: report.authorName, at: report.reportDate }))} url={api.photoUrl} />
    {/* The project manager chooses which photos of an approved report the client sees in the portal. */}
    {report.status === "approved" && state.canManage && report.photos.length ? <fieldset className={styles.group}>
      <legend>{t("Shown to the client")}</legend>
      {report.photos.map((photo, index) => <Checkbox key={photo.id} isSelected={Boolean(photo.shared)}
        onChange={(shared) => void run("share_photo", { photoId: photo.id, shared })}>{t("Photo {number}", { number: index + 1 })}</Checkbox>)}
    </fieldset> : null}
    {waiting.includes(report) ? <div className={styles.actions}>
      <Button size="compact" variant="quiet" onPress={() => setReturning(report)}>{t("Send back")}</Button>
      <Button size="compact" variant="primary" onPress={() => void run("approve", { reportId: report.id, version: report.version })}>{t("Approve")}</Button>
    </div> : null}
  </li>;

  return <div className={styles.site}>
    <div className={styles.toolbar}>
      {switcher}
      <span className={styles.muted}>{running ? t("Site work since {date}", { date: format.day(state.site.startedOn) })
        : state.site.finishedOn ? t("Site work {from} – {to}", { from: format.day(state.site.startedOn), to: format.day(state.site.finishedOn) }) : t("Site work hasn't started")}</span>
      <span className={styles.spacer} />
      {state.canManage ? <Button size="compact" onPress={() => void run(running ? "finish_site" : "start_site", { on: state.today })}>{running ? t("Finish site work") : t("Start site work")}</Button> : null}
      {state.canReport ? <Button size="compact" variant="primary" onPress={() => setEditing("new")}><Plus aria-hidden="true" size={14} />{t("New report")}</Button> : null}
    </div>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    {waiting.length ? <section className={styles.stack} aria-label={t("Waiting for your approval")}>
      <h3 className={styles.subhead}>{t("Waiting for your approval")}</h3>
      <ul className={styles.reports}>{waiting.map(card)}</ul>
    </section> : null}
    {!state.reports.length ? <EmptyState illustration={null} title={t("No site reports yet")} description={t("Each day on site: who worked, what was installed and photos.")} />
      : <section className={styles.stack} aria-label={t("Reports")}><ul className={styles.reports}>{state.reports.filter((report) => !waiting.includes(report)).map(card)}</ul></section>}
    {editing && (editing !== "new" || state.canReport) ? <ReportDialog state={state} report={editing === "new" ? null : editing} onClose={() => setEditing(null)}
      onSave={async (input, photos, submit) => {
        const id = editing === "new" ? crypto.randomUUID() : editing.id;
        const version = editing === "new" ? undefined : editing.version;
        if (!(await run("save_report", { id, ...input, ...(version ? { version } : {}) }))) return false;
        try { for (const file of photos) setState(await api.uploadPhoto(id, crypto.randomUUID(), file)); }
        catch (cause) { setNotice(cause instanceof Error ? cause.message : t("The photo could not be uploaded.")); return false; }
        if (submit) {
          const saved = (await api.state()).reports.find((report) => report.id === id);
          if (!saved || !(await run("submit", { reportId: id, version: saved.version }))) return false;
        }
        return true;
      }} /> : null}
    {returning ? <ReturnDialog onClose={() => setReturning(null)} onSave={async (note) => { if (await run("return", { reportId: returning.id, note, version: returning.version })) setReturning(null); }} /> : null}
    {rejecting ? <ReasonDialog title={t("{item} not accepted", { item: rejecting.title })} label={t("What isn't right")} action={t("Raise a snag")} onClose={() => setRejecting(null)}
      onSave={async (reason) => { if (await run("reject_installation", { reportId: rejecting.report.id, lineId: rejecting.lineId, reason })) setRejecting(null); }} /> : null}
  </div>;
}

type Draft = {
  reportDate: string; weather: string; workforce: Array<{ trade: string; people: string }>; lines: Array<{ boqLineId: string; installed: string; note: string }>;
  safety: Safety; safetyNote: string; forecast: Outlook; impact: string; recoveryOwnerId: string; recoveryOn: string | null; noWorkReason: string; notes: string;
};

/** A day's report: saved as a draft, or submitted for approval (with photos, or why no work was done). */
function ReportDialog({ state, report, onClose, onSave }: {
  state: SiteState; report: SiteReport | null; onClose: () => void; onSave: (input: Record<string, unknown>, photos: File[], submit: boolean) => Promise<boolean>;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [draft, setDraft] = useState<Draft>(() => ({
    reportDate: report?.reportDate ?? state.today, weather: report?.weather ?? "",
    workforce: report?.workforce.map((row) => ({ trade: row.trade, people: String(row.people) })) ?? [{ trade: "", people: "" }],
    lines: report?.lines.map((line) => ({ boqLineId: line.boqLineId, installed: quantityText(line.installed) || line.installed, note: line.note })) ?? [],
    safety: report?.safety ?? "none", safetyNote: report?.safetyNote ?? "", forecast: report?.forecast ?? "none", impact: report?.impact ?? "",
    recoveryOwnerId: report?.recoveryOwnerId ?? "", recoveryOn: report?.recoveryOn ?? null, noWorkReason: report?.noWorkReason ?? "", notes: report?.notes ?? "",
  }));
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  // A new report can start from my last one: the same crew, and the items I was installing that aren't finished.
  const previous = report ? null : state.reports.find((row) => row.authorId === state.me && row.reportDate < draft.reportDate && (row.workforce.length || row.lines.length)) ?? null;
  const unfinished = (previous?.lines ?? []).filter((line) => {
    const scope = state.lines.find((item) => item.id === line.boqLineId);
    return scope && Number(scope.installed) < Number(scope.quantity);
  });
  const repeat = () => set({
    workforce: previous!.workforce.map((row) => ({ trade: row.trade, people: String(row.people) })),
    lines: [...draft.lines.filter((line) => line.boqLineId), ...unfinished.filter((line) => !draft.lines.some((item) => item.boqLineId === line.boqLineId))
      .map((line) => ({ boqLineId: line.boqLineId, installed: "", note: "" }))],
  });
  const input = () => ({
    reportDate: draft.reportDate, weather: draft.weather.trim(), safety: draft.safety, safetyNote: draft.safetyNote.trim(), forecast: draft.forecast, impact: draft.impact.trim(),
    recoveryOwnerId: draft.recoveryOwnerId || null, recoveryOn: draft.recoveryOn, noWorkReason: draft.noWorkReason.trim(), notes: draft.notes.trim(),
    workforce: draft.workforce.filter((row) => row.trade.trim() || row.people).map((row) => ({ trade: row.trade.trim(), people: Number(row.people) })),
    lines: draft.lines.filter((line) => line.boqLineId && line.installed).map((line) => ({ boqLineId: line.boqLineId, installed: line.installed, note: line.note.trim() })),
  });
  const evidence = photos.length + (report?.photos.length ?? 0) > 0 || Boolean(draft.noWorkReason.trim());
  const safetyOk = draft.safety === "none" || draft.safetyNote.trim();
  const outlookOk = draft.forecast === "none" || (draft.impact.trim() && draft.recoveryOwnerId && draft.recoveryOn);
  const save = async (submit: boolean) => { setBusy(submit ? "submit" : "save"); if (await onSave(input(), photos, submit)) onClose(); setBusy(null); };
  const lineOptions = state.lines.map((line) => ({ id: line.id, label: `${line.title}${line.areaName ? ` · ${line.areaName}` : ""} (${quantityText(line.installed) || "0"} / ${quantityText(line.quantity)} ${line.unit})`.trim() }));
  return <ControlledModalDialog isOpen size="lg" title={report ? t("Report for {date}", { date: draft.reportDate }) : t("New report")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button isLoading={busy === "save"} isDisabled={Boolean(busy) || !safetyOk || !outlookOk} onPress={() => void save(false)}>{t("Save draft")}</Button>
      <Button variant="primary" isLoading={busy === "submit"} isDisabled={Boolean(busy) || !safetyOk || !outlookOk || !evidence} onPress={() => void save(true)}>{t("Submit")}</Button></div>}>
    <div className={styles.dialogBody}>
      <div className={styles.pair}>
        <DateField label={t("Day")} isRequired value={parseDate(draft.reportDate)} onChange={(value) => set({ reportDate: value ? value.toString() : state.today })} />
        <TextInput label={t("Weather")} value={draft.weather} onChange={(weather) => set({ weather })} />
      </div>
      {previous ? <div className={styles.row}>
        <Button size="compact" onPress={repeat}>{t("Same crew as {date}", { date: format.short(previous.reportDate) })}</Button>
        <span className={styles.muted}>{[previous.workforce.map((row) => `${row.trade} ${row.people}`).join(" · "), unfinished.length ? t("{count} items still going", { count: unfinished.length }) : ""].filter(Boolean).join(" · ")}</span>
      </div> : null}
      <fieldset className={styles.group}>
        <legend>{t("Who worked")}</legend>
        {draft.workforce.map((row, index) => <div key={index} className={styles.row}>
          <TextInput aria-label={t("Trade")} label={null} placeholder={t("Trade")} value={row.trade} onChange={(trade) => set({ workforce: draft.workforce.map((item, at) => (at === index ? { ...item, trade } : item)) })} />
          <TextInput aria-label={t("People")} label={null} placeholder={t("People")} inputMode="numeric" value={row.people}
            onChange={(people) => set({ workforce: draft.workforce.map((item, at) => (at === index ? { ...item, people: people.replace(/\D/g, "") } : item)) })} />
          <IconButton aria-label={t("Remove")} size="compact" variant="quiet" onPress={() => set({ workforce: draft.workforce.filter((_, at) => at !== index) })}><X aria-hidden="true" size={13} /></IconButton>
        </div>)}
        <Button size="compact" variant="quiet" onPress={() => set({ workforce: [...draft.workforce, { trade: "", people: "" }] })}><Plus aria-hidden="true" size={14} />{t("Add a trade")}</Button>
      </fieldset>
      <fieldset className={styles.group}>
        <legend>{t("Installed")}</legend>
        {draft.lines.map((line, index) => <div key={index} className={styles.row}>
          <SelectField aria-label={t("Item")} label={null} placeholder={t("Item")} selectedKey={line.boqLineId} items={lineOptions}
            onSelectionChange={(key) => set({ lines: draft.lines.map((item, at) => (at === index ? { ...item, boqLineId: key ? String(key) : "" } : item)) })} />
          <TextInput aria-label={t("Quantity installed")} label={null} placeholder={t("Quantity")} inputMode="decimal" value={line.installed}
            onChange={(installed) => set({ lines: draft.lines.map((item, at) => (at === index ? { ...item, installed: numeric(installed) } : item)) })} />
          <IconButton aria-label={t("Remove")} size="compact" variant="quiet" onPress={() => set({ lines: draft.lines.filter((_, at) => at !== index) })}><X aria-hidden="true" size={13} /></IconButton>
          {Number(line.installed) < 0 ? <TextInput label={t("Why it's taken back")} isRequired value={line.note}
            onChange={(note) => set({ lines: draft.lines.map((item, at) => (at === index ? { ...item, note } : item)) })} /> : null}
        </div>)}
        <Button size="compact" variant="quiet" onPress={() => set({ lines: [...draft.lines, { boqLineId: "", installed: "", note: "" }] })}><Plus aria-hidden="true" size={14} />{t("Add an item")}</Button>
      </fieldset>
      <div className={styles.pair}>
        <SelectField label={t("Safety")} selectedKey={draft.safety} onSelectionChange={(key) => set({ safety: (key ?? "none") as Safety })}
          items={[{ id: "none", label: t("No safety issue") }, { id: "observation", label: t("Safety observation") }, { id: "incident", label: t("Incident") }]} />
        <SelectField label={t("Outlook")} selectedKey={draft.forecast} onSelectionChange={(key) => set({ forecast: (key ?? "none") as Outlook })}
          items={[{ id: "none", label: t("On track") }, { id: "watch", label: t("At risk") }, { id: "blocked", label: t("Blocked") }]} />
      </div>
      {draft.safety !== "none" ? <TextAreaField label={t("What happened")} isRequired value={draft.safetyNote} onChange={(safetyNote) => set({ safetyNote })} /> : null}
      {draft.forecast !== "none" ? <>
        <TextAreaField label={t("What's at risk and how it's recovered")} isRequired value={draft.impact} onChange={(impact) => set({ impact })} />
        <div className={styles.pair}>
          <SelectField label={t("Who recovers it")} isRequired placeholder={t("Choose")} selectedKey={draft.recoveryOwnerId} onSelectionChange={(key) => set({ recoveryOwnerId: key ? String(key) : "" })}
            items={state.members.map((member) => ({ id: member.membershipId, label: member.name }))} />
          <DateField label={t("By")} isRequired value={draft.recoveryOn ? parseDate(draft.recoveryOn) : null} onChange={(value) => set({ recoveryOn: value ? value.toString() : null })} />
        </div>
      </> : null}
      <PhotoPicker files={photos} onChange={setPhotos} />
      {!photos.length && !report?.photos.length ? <TextInput label={t("If no work was done, why")} value={draft.noWorkReason} onChange={(noWorkReason) => set({ noWorkReason })} /> : null}
      <TextAreaField label={t("Notes")} value={draft.notes} onChange={(notes) => set({ notes })} />
    </div>
  </ControlledModalDialog>;
}

function ReturnDialog({ onClose, onSave }: { onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Send the report back")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!note.trim()} onPress={async () => { setBusy(true); await onSave(note.trim()); setBusy(false); }}>{t("Send back")}</Button></div>}>
    <TextAreaField label={t("What to change")} isRequired value={note} onChange={setNote} />
  </ControlledModalDialog>;
}

/** Why something isn't right: one required line of text, then the action. */
function ReasonDialog({ title, label, action, onClose, onSave }: { title: string; label: string; action: string; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={title} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!reason.trim()} onPress={async () => { setBusy(true); await onSave(reason.trim()); setBusy(false); }}>{action}</Button></div>}>
    <TextAreaField label={label} isRequired value={reason} onChange={setReason} autoFocus />
  </ControlledModalDialog>;
}
