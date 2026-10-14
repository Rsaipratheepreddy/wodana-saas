"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Factory, Send } from "lucide-react";
import {
  Badge, Button, EmptyState, ErrorState, FormDialog, GroupedTable, InlineNotice, SegmentedControl, SelectField, Skeleton, TextAreaField, ToolbarSearch, useDesignSystem,
  type GroupedTableColumn, type GroupedTableSection,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { CaseRoom } from "@/lib/pre-project/content";
import {
  DRAWING_STATUS_LABEL, LOG_STATUS_LABEL, logStatusTone, ORIGIN_LABEL, scheduleApi, type DesignDrawing, type FinishEntry, type ScheduleSource, type ScheduleView, type ShopDrawing, type SpecificationState,
} from "@/lib/pre-project/finishes";
import { FinishSheet } from "./finish-sheet";
import styles from "./finishes.module.css";

type Mode = "design" | "installation" | "drawings";
const NO_ROOM = "__general";
const ALL = "__all";
const NO_SPECIFICATION = { gate: false, samplesStep: false, samplesApproved: false, final: true, problem: null, changed: [], handoff: null } satisfies SpecificationState;

/**
 * The finishes schedule (PLM-156) on the materials and decisions list: per room, a design view (what was specified and
 * approved, where it comes from, its sample, the client's signature, whether QS has it) and an installation view (what
 * goes where), with the drawings schedule beside them. The designer sends the finishes to QS (PLM-146) and the lead
 * designer shares the sample log with the factory. Read the same from the case, the job and (once shared) the Factory.
 */
export function FinishesSchedule({ source, rooms = [], onAddMaterials }: { source: ScheduleSource; rooms?: CaseRoom[]; onAddMaterials?: () => void }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const sourceKey = source.kind === "project" ? source.projectId : source.caseId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const api = useMemo(() => scheduleApi(source), [source.kind, source.workspaceId, sourceKey]);
  const [view, setView] = useState<ScheduleView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<Mode>("design");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"send" | "share" | null>(null);

  const load = useCallback(async () => {
    try { setView(await api.view()); setError(""); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("The finishes didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  if (error && !view) return <ErrorState title={t("The finishes didn't load")} description={error} onRetry={() => void load()} />;
  if (!view) return <Skeleton lines={6} shape="rows" />;

  const day = (iso: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)); } catch { return iso; } };
  const saved = (message: string, next: ScheduleView) => { setView((current) => ({ ...next, ...(current ? rightsOf(current) : {}) })); setNotice(message); setError(""); };
  const needle = search.trim().toLocaleLowerCase();
  const shown = view.entries.filter((entry) => (category === ALL || entry.categoryKey === category)
    && (!needle || `${entry.title} ${entry.current?.specification ?? ""} ${entry.current?.supplier ?? ""} ${entry.location} ${entry.roomName ?? ""}`.toLocaleLowerCase().includes(needle)));
  const sections: GroupedTableSection<FinishEntry>[] = [...new Map(shown.map((entry) => [entry.roomId ?? NO_ROOM, entry.roomName ?? t("Whole home")])).entries()]
    .sort(([a, left], [b, right]) => (a === NO_ROOM ? 1 : b === NO_ROOM ? -1 : left.localeCompare(right)))
    .map(([id, label]) => ({ id, label, rows: shown.filter((entry) => (entry.roomId ?? NO_ROOM) === id), emptyMessage: "" }));
  const open = view.entries.find((entry) => entry.id === openId) ?? null;
  // The factory's read has no QS side (PLM-156): no hand-off, no notices, no QS column.
  const spec = view.specification ?? NO_SPECIFICATION;

  const finishCell = (entry: FinishEntry) => <span className={styles.cell}><span>{entry.title}</span>
    {entry.current?.specification || entry.categoryLabel ? <small>{[entry.categoryLabel, entry.current?.specification].filter(Boolean).join(" · ")}</small> : null}</span>;
  const designColumns: GroupedTableColumn<FinishEntry>[] = [
    { id: "finish", label: t("Finish"), width: "34%", render: finishCell },
    { id: "from", label: t("Supplied from"), width: "20%", mobileHidden: true, render: (entry) => <span className={styles.cell}>
      <span>{entry.current?.origin ? t(ORIGIN_LABEL[entry.current.origin]) : "—"}</span>
      {entry.current?.supplier || entry.current?.sampleName ? <small>{[entry.current?.supplier, entry.current?.sampleName].filter(Boolean).join(" · ")}</small> : null}</span> },
    { id: "sample", label: t("Sample"), width: "9%", mobileHidden: true, render: (entry) => entry.current?.samplePhotoAssetId
      // eslint-disable-next-line @next/next/no-img-element
      ? <img className={styles.thumb} alt={entry.current.samplePhotoName ?? t("Sample photo")} src={api.assetUrl(view.caseId, entry.current.samplePhotoAssetId, true)} /> : null },
    { id: "status", label: t("Status"), width: "20%", render: (entry) => <span className={styles.inline}>
      <Badge tone={logStatusTone(entry.status)}>{t(LOG_STATUS_LABEL[entry.status])}</Badge>
      {entry.signature?.required ? <Badge tone={entry.signature.signed ? "success" : "warning"}>{entry.signature.signed ? t("Client signed") : t("Client to sign")}</Badge> : null}</span> },
    ...(view.specification ? [{ id: "qs", label: t("QS"), width: "17%", render: (entry: FinishEntry) => entry.priced?.stale ? <Badge tone="danger">{t("Price to check")}</Badge>
      : entry.changedSinceSent ? <Badge tone="warning">{t("Changed since sent")}</Badge> : entry.sentToQs ? <Badge tone="neutral">{t("Sent to QS")}</Badge> : <span className={styles.muted}>—</span> }] : []),
  ];
  const installColumns: GroupedTableColumn<FinishEntry>[] = [
    { id: "finish", label: t("Finish"), width: "32%", render: finishCell },
    { id: "where", label: t("Where it goes"), width: "22%", render: (entry) => entry.location || <span className={styles.muted}>—</span> },
    { id: "quantity", label: t("Quantity"), width: "14%", align: "end", render: (entry) => entry.current?.quantity ? <span className={styles.number}><bdi dir="ltr">{entry.current.quantity}</bdi> {entry.current.unit}</span> : "—" },
    { id: "note", label: t("Installation note"), width: "32%", mobileHidden: true, render: (entry) => entry.installNote || <span className={styles.muted}>—</span> },
  ];
  const categoryItems = [{ id: ALL, label: t("All categories") }, ...view.categories.map((item) => ({ id: item.key, label: item.label }))];
  const gate = view.procurement ?? null;

  return <section className={styles.schedule} aria-label={t("Finishes")}>
    <div className={styles.toolbar}>
      <SegmentedControl label={t("View")} value={mode} onChange={(value) => setMode(value as Mode)}
        options={[{ id: "design", label: t("Design") }, { id: "installation", label: t("Installation") }, { id: "drawings", label: t("Drawings") }]} />
      {mode !== "drawings" ? <>
        <ToolbarSearch label={t("Search finishes")} value={search} onChange={setSearch} />
        <SelectField aria-label={t("Category")} label={null} accent="neutral" items={categoryItems} selectedKey={category} onSelectionChange={(key) => setCategory(String(key))} />
      </> : null}
      <span className={styles.spacer} />
      {view.canShare && view.entries.length ? <Button size="compact" onPress={() => setDialog("share")}><Factory aria-hidden="true" size={14} />{t("Share with the factory")}</Button> : null}
      {view.canSendToQs && view.entries.length ? <Button size="compact" variant="primary" isDisabled={(spec.samplesStep && !spec.samplesApproved) || (Boolean(spec.handoff) && !spec.changed.length)}
        onPress={() => setDialog("send")}><Send aria-hidden="true" size={14} />{spec.handoff ? t("Send changes to QS") : t("Send to QS")}</Button> : null}
    </div>
    <p className={styles.facts}>
      {spec.handoff ? <span>{t("Sent to QS {date} by {name}", { date: day(spec.handoff.sentAt), name: spec.handoff.sentByName ?? "" })}</span>
        : spec.samplesStep && !spec.samplesApproved ? <span>{t("Goes to QS once the samples are approved")}</span> : null}
      {spec.gate ? <Badge tone={spec.final ? "success" : "warning"}>{spec.final ? t("Specification final") : t("Specification not final")}</Badge> : null}
      {view.share ? <span>{t("Shared with the factory {date}", { date: day(view.share.sharedAt) })}</span> : null}
      {gate ? <>
        <Badge tone={gate.payment ? "success" : "neutral"}>{gate.payment ? t("Payment in") : t("Payment not in")}</Badge>
        <Badge tone={gate.materials ? "success" : "neutral"}>{gate.materials ? t("Material list confirmed") : t("Material list not confirmed")}</Badge>
        {gate.signatures.required || gate.signatures.missing.length ? <Badge tone={gate.signatures.missing.length ? "warning" : "success"}>
          {gate.signatures.missing.length ? t("{count} to sign by the client", { count: gate.signatures.missing.length }) : t("Samples signed")}</Badge> : null}
      </> : null}
    </p>
    {spec.gate && spec.problem && spec.handoff ? <InlineNotice tone="info" message={spec.problem} /> : null}
    {gate?.signatures.missing.length ? <InlineNotice tone="info" message={t("Ordering waits for the client's signed samples or data sheets: {items}", { items: gate.signatures.missing.join(", ") })} /> : null}
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    {error ? <InlineNotice tone="error" message={error} /> : null}

    {mode === "drawings" ? <DrawingsSchedule designs={view.drawings.designs} shop={view.drawings.shop} day={day} projectId={view.project?.started ? view.project.id : null} />
      : !view.entries.length ? <EmptyState illustration="empty" title={t("No finishes yet")}
        action={onAddMaterials ? <Button variant="primary" onPress={onAddMaterials}>{t("Add the materials")}</Button>
          : source.kind !== "factory" ? <Link className="wd-button" data-variant="primary" href={`/workspace/pre-projects/cases/${view.caseId}/designs?stage=ledger`}>{t("Add the materials")}</Link> : undefined} />
      : !shown.length ? <EmptyState illustration={null} title={t("No finishes match")} action={<Button onPress={() => { setSearch(""); setCategory(ALL); }}>{t("Clear the filters")}</Button>} />
      : <GroupedTable<FinishEntry> ariaLabel={mode === "design" ? t("Finishes schedule") : t("Installation schedule")} columns={mode === "design" ? designColumns : installColumns}
        sections={sections} getRowId={(entry) => entry.id} getRowLabel={(entry) => entry.title} selectable={false} onRowAction={(entry) => setOpenId(entry.id)} />}

    {open ? <FinishSheet entry={open} view={view} rooms={rooms} api={api} onClose={() => setOpenId(null)} onSaved={(message, next) => saved(message, next)} /> : null}
    {dialog === "send" ? <NoteDialog title={spec.handoff ? t("Send the changed finishes to QS") : t("Send the finishes to QS")} submitLabel={t("Send to QS")}
      onClose={() => setDialog(null)} onSubmit={async (note) => { saved(t("Sent to QS."), await api.sendToQs(view.caseId, note)); setDialog(null); }} /> : null}
    {dialog === "share" ? <NoteDialog title={t("Share the sample log with the factory")} submitLabel={t("Share")}
      onClose={() => setDialog(null)} onSubmit={async (note) => { saved(t("Shared with the factory."), await api.share(view.caseId, note)); setDialog(null); }} /> : null}
  </section>;
}

const rightsOf = (view: ScheduleView) => ({ canEdit: view.canEdit, canManageMaterials: view.canManageMaterials, canSendToQs: view.canSendToQs, canRecordSignature: view.canRecordSignature,
  canShare: view.canShare });

/** A note with the hand-off (to QS, to the factory). */
function NoteDialog({ title, submitLabel, onClose, onSubmit }: { title: string; submitLabel: string; onClose: () => void; onSubmit: (note: string) => Promise<unknown> }) {
  const t = useT();
  const [note, setNote] = useState("");
  return <FormDialog title={title} onClose={onClose} submitLabel={submitLabel} isDirty={Boolean(note.trim())} onSubmit={() => onSubmit(note.trim())}>
    <TextAreaField label={t("Note")} maxLength={2000} value={note} onChange={setNote} />
  </FormDialog>;
}

/** The drawings schedule, read from the records: the design drawings with their latest revision, and the project's shop drawings. */
function DrawingsSchedule({ designs, shop, day, projectId }: { designs: DesignDrawing[]; shop: ShopDrawing[]; day: (iso: string) => string; projectId: string | null }) {
  const t = useT();
  type Row = { id: string; title: string; detail: string; revision: string; status: string | null; date: string | null };
  const rows: GroupedTableSection<Row>[] = [
    { id: "design", label: t("Design drawings"), emptyMessage: t("No design drawings yet."), rows: designs.map((drawing) => ({ id: drawing.id, title: drawing.title,
      detail: [drawing.roomName, drawing.stage].filter(Boolean).join(" · "), revision: drawing.revision ? `R${drawing.revision}` : "—", status: drawing.status, date: drawing.updatedAt })) },
    ...(projectId ? [{ id: "shop", label: t("Shop drawings"), emptyMessage: t("No shop drawings yet."), rows: shop.map((revision) => ({ id: revision.id,
      title: revision.files.map((file) => file.name).join(", ") || t("Revision {number}", { number: revision.number }), detail: "", revision: `R${revision.number}`, status: revision.status,
      date: revision.decidedOn ?? revision.sentAt })) }] : []),
  ];
  if (!designs.length && !shop.length) return <EmptyState illustration="empty" title={t("No drawings yet")}
    action={projectId ? <Link className="wd-button" data-variant="secondary" href={`/workspace/projects/${projectId}/scope?view=drawings`}>{t("Open the drawings")}</Link> : undefined} />;
  return <GroupedTable<Row> ariaLabel={t("Drawings schedule")} selectable={false} sections={rows} getRowId={(row) => row.id} getRowLabel={(row) => row.title} columns={[
    { id: "drawing", label: t("Drawing"), width: "46%", render: (row) => <span className={styles.cell}><span>{row.title}</span>{row.detail ? <small>{row.detail}</small> : null}</span> },
    { id: "revision", label: t("Revision"), width: "14%", render: (row) => <span className={styles.number}>{row.revision}</span> },
    { id: "status", label: t("Status"), width: "22%", render: (row) => row.status ? <Badge tone={row.status === "approved" ? "success" : "neutral"}>{DRAWING_STATUS_LABEL[row.status] ? t(DRAWING_STATUS_LABEL[row.status]) : row.status}</Badge> : "—" },
    { id: "date", label: t("Date"), width: "18%", mobileHidden: true, render: (row) => row.date ? day(row.date) : "—" },
  ]} />;
}
