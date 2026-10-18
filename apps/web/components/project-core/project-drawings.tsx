"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import { parseDate } from "@internationalized/date";
import {
  ActivityFeed, Badge, Button, DateField, EditableFieldList, EmptyState, ErrorState, FactRow, FileUploader, FormDialog, FormSection, GroupedTable, IconButton, InlineNotice, NumericInput, ReviewDialog, ReviewFiles,
  SegmentedControl, SelectField, Skeleton, TextAreaField, TextInput, TypeChip, type ActivityItem, type GroupedTableColumn, type ReviewFile,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type {
  DrawingCheck, DrawingFile, DrawingItem, DrawingReason, DrawingRevision, DrawingStatus, DrawingsState, MeasureLine, MeasureUnit, TechnicalMeasure,
} from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import styles from "./project-core.module.css";

const ACCEPT = "application/pdf,image/*";
const uuid = () => crypto.randomUUID();

/** The revision states; "uploaded" and "checked" read by the check the route asks for (on site, or against the design, PLM-149). */
export function useDrawingStatusLabels(check: DrawingCheck | null = "site") {
  const t = useT();
  return useMemo<Record<DrawingStatus, string>>(() => ({
    uploaded: check === "design" ? t("Waiting for the design check") : t("Waiting for the site check"),
    checked: check === "design" ? t("Matches the design") : t("Site check passed"), changes_needed: t("Changes needed"), sent: t("With the client"),
    approved: t("Approved by the client"), changes_requested: t("The client asked for changes"),
  }), [check, t]);
}

/**
 * The project's technical drawings (PLM-057 … 060, PLM-149), one revision at a time: the project manager or the factory
 * records the technical site measure first (when the route asks for it), the technical team uploads the drawings, the
 * drawer or the project manager records the site check (or the lead designer checks they match the design), and the
 * project manager (or the lead designer) sends them to the client and records the client's decision with the signed
 * file. The factory reads the approved ones. Each change reloads the project.
 */
export function ProjectDrawings({ workspaceId, projectId, version, onChanged }: { workspaceId: string; projectId: string; version: number; onChanged?: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<DrawingsState | null>(null);
  const labels = useDrawingStatusLabels(data?.check ?? (data?.needsSiteCheck ? "site" : null));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"check" | "decide" | "measure" | null>(null);
  const [deciding, setDeciding] = useState<DrawingItem | null>(null);
  const load = useCallback(async () => {
    try { setData(await api.drawings(projectId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The drawings didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, version]);

  /** One drawing command on the latest revision, version-checked against the drawings as read; a refusal is thrown to a dialog. */
  const command = useCallback(async (action: string, input: Record<string, unknown>, inDialog = false) => {
    if (!data) return false;
    setNotice("");
    try { await api.command(projectId, data.version, action, input); await load(); onChanged?.(); return true; }
    catch (cause) { if (inDialog) throw cause; setNotice(cause instanceof Error ? cause.message : t("Could not save.")); await load(); return false; }
  }, [api, data, load, onChanged, projectId, t]);

  const upload = async (files: File[], kind: "drawing" | "approval", revisionId: string) => {
    let state: DrawingsState | null = null;
    for (const file of files) state = await api.uploadDrawing(projectId, revisionId, uuid(), kind, file);
    if (state) setData(state);
    onChanged?.();
    return state;
  };
  const addDrawings = async (files: File[]) => {
    if (!data || !files.length) return;
    const latest = data.revisions[0];
    setBusy(true); setNotice("");
    try { await upload(files, "drawing", latest?.status === "uploaded" ? latest.id : uuid()); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : t("The file could not be uploaded.")); await load(); }
    finally { setBusy(false); }
  };

  if (error && !data) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!data) return <Skeleton lines={5} shape="rows" />;
  const latest = data.revisions[0] ?? null;
  const columns: GroupedTableColumn<DrawingFile>[] = [
    { id: "file", label: t("File"), width: "60%", render: (file) => <span className={styles.lineCell}>
      <a className={styles.detailLink} href={api.drawingUrl(projectId, file.id)} target="_blank" rel="noreferrer">{file.name}</a>
      {file.kind === "approval" ? <small>{t("Client's signed approval")}</small> : null}
    </span> },
    { id: "by", label: t("Added"), width: "40%", mobileHidden: true, render: (file) => <span className={styles.muted}>{[file.byName, format.when(file.at)].filter(Boolean).join(" · ")}</span> },
  ];

  const measure = data.measure ?? null;
  const design = data.check === "design";
  return <div className={styles.changes}>
    <div className={styles.scopeToolbar}>
      <div className={styles.toolbarActions}>
        {measure?.canRecord ? <Button size="compact" variant={measure.done ? undefined : "primary"} isDisabled={busy} onPress={() => setDialog("measure")}>
          {measure.measures.length ? t("Record a new measure") : t("Record the technical measure")}</Button> : null}
        {data.canUpload ? <FileUploader appearance="button" accept={ACCEPT} label={latest?.status === "uploaded" ? t("Add drawings") : latest ? t("Upload a new revision") : t("Upload drawings")}
          onFiles={(files) => void addDrawings(files)} /> : null}
        {data.canCheck ? <Button size="compact" isDisabled={busy} onPress={() => setDialog("check")}>{design ? t("Check against the design") : t("Record the site check")}</Button> : null}
        {data.canSend && latest ? <Button size="compact" variant="primary" isDisabled={busy} onPress={() => void command("send_drawings", { revisionId: latest.id })}>
          <Send aria-hidden="true" size={14} />{t("Send to the client")}</Button> : null}
        {data.canDecide ? <Button size="compact" variant="primary" onPress={() => setDialog("decide")}>{t("Record the client's decision")}</Button> : null}
      </div>
    </div>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    {measure?.required && !measure.done ? <InlineNotice tone="info" message={t("Shop drawings start after the technical site measure.")} /> : null}
    {measure?.measures[0] ? <MeasureFacts measure={measure.measures[0]} earlier={measure.measures.length - 1} fileUrl={(fileId) => api.measureFileUrl(projectId, fileId)} /> : null}
    {data.items?.length ? <DrawingItems items={data.items} approved={latest?.status === "approved" ? latest.number : null} canDecide={Boolean(data.canDecideItems)} onDecide={setDeciding} /> : null}
    {latest ? <RevisionFacts revision={latest} /> : null}
    {data.revisions.length
      ? <GroupedTable<DrawingFile> ariaLabel={t("Drawings")} columns={columns} selectable={false} getRowId={(file) => file.id} getRowLabel={(file) => file.name}
          sections={data.revisions.map((revision) => ({ id: revision.id, label: t("R{number} · {status}", { number: revision.number, status: labels[revision.status] }),
            rows: revision.files, emptyMessage: t("No files yet."), headerLabels: { file: "", by: format.when(revision.createdAt) } }))} />
      : <EmptyState illustration={null} title={t("No drawings yet")} description={data.canUpload ? t("Upload the technical drawings as PDFs or images.") : undefined} />}
    {deciding ? <DrawingNeedDialog item={deciding} onClose={() => setDeciding(null)} onSave={async (needed, reason) => {
      await command("set_drawing_need", { lineId: deciding.lineId, needed, reason }, true); setDeciding(null);
    }} /> : null}
    {dialog === "check" && latest ? <SiteCheckDialog revision={latest} design={design} files={latest.files.map((file) => ({ id: file.id, name: file.name, href: api.drawingUrl(projectId, file.id) }))} onClose={() => setDialog(null)}
      onSave={async (result, note) => { await command("check_drawings", { revisionId: latest.id, result, note }, true); setDialog(null); }} /> : null}
    {dialog === "measure" && measure ? <MeasureDialog unit={measure.unit} units={measure.units} today={format.today()} onClose={() => setDialog(null)}
      onSave={async (input, files) => {
        // The measure is recorded first; its photos then go on it (each replayed safely by its id).
        const measureId = uuid();
        await api.command(projectId, data.version, "record_technical_measure", { measureId, ...input });
        for (const file of files) await api.uploadMeasureFile(projectId, measureId, uuid(), file);
        await load(); onChanged?.(); setDialog(null);
      }} /> : null}
    {dialog === "decide" && latest ? <ClientDecisionDialog revision={latest} today={format.today()} onClose={() => setDialog(null)}
      onSave={async (input, files) => {
        // The signed approval goes on the revision first; the decision is then checked against the drawings as they are now.
        const fresh = files.length ? await upload(files, "approval", latest.id) : null;
        await api.command(projectId, (fresh ?? data).version, "decide_drawings", { revisionId: latest.id, ...input });
        await load(); onChanged?.(); setDialog(null);
      }} /> : null}
  </div>;
}

/** Where the latest revision stands, as its approval trail: the check, sending it, and the client's decision, each with who and when. */
function RevisionFacts({ revision }: { revision: DrawingRevision }) {
  const t = useT();
  const format = useProjectFormat();
  const items: ActivityItem[] = [
    ...(revision.siteCheck ? [{ id: "check", kind: "approval" as const, actor: revision.siteCheckedByName ?? "", action: revision.checkKind === "design" ? t("Design check") : t("Site check"),
      status: revision.siteCheck === "ok" ? { label: t("OK"), tone: "success" as const } : { label: t("Changes needed"), tone: "warning" as const },
      detail: revision.siteCheckNote || undefined, occurredAt: format.when(revision.siteCheckedAt) }] : []),
    ...(revision.sentAt ? [{ id: "sent", kind: "change" as const, actor: revision.sentByName ?? "", action: t("Sent to the client"), occurredAt: format.when(revision.sentAt) }] : []),
    ...(revision.decidedOn ? [{ id: "decision", kind: "approval" as const, actor: revision.decidedByName ?? "", action: t("Client's decision"),
      status: revision.status === "approved" ? { label: t("Approved"), tone: "success" as const } : { label: t("Changes asked"), tone: "warning" as const },
      detail: revision.decisionNote || undefined, occurredAt: format.day(revision.decidedOn),
      meta: [revision.decisionVia === "portal" ? t("In the client portal") : revision.decisionRecordedByName ? t("Recorded by {name}", { name: revision.decisionRecordedByName }) : ""].filter(Boolean) }] : []),
  ];
  return items.length ? <ActivityFeed items={items} /> : null;
}

/** PLM-149: the latest technical site measure: when and by whom, its dimensions, notes and photos. */
function MeasureFacts({ measure, earlier, fileUrl }: { measure: TechnicalMeasure; earlier: number; fileUrl: (fileId: string) => string }) {
  const t = useT();
  const format = useProjectFormat();
  const units = useUnitLabels();
  const columns: GroupedTableColumn<MeasureLine & { id: string }>[] = [
    { id: "area", label: t("Where"), width: "35%", render: (line) => <span className={styles.muted}>{line.area || "—"}</span> },
    { id: "label", label: t("Dimension"), width: "40%", render: (line) => line.label },
    { id: "value", label: t("Size"), width: "25%", align: "end", render: (line) => `${format.number(line.value)} ${units[line.unit]}` },
  ];
  return <>
    <EditableFieldList>
      <FactRow label={t("Technical site measure")}>{[format.day(measure.measuredOn), measure.byName, earlier ? t("{count} earlier", { count: earlier }) : ""].filter(Boolean).join(" · ")}</FactRow>
      {measure.note ? <FactRow label={t("Notes")}>{measure.note}</FactRow> : null}
    </EditableFieldList>
    {measure.files.length ? <ReviewFiles label={t("Photos and files")} files={measure.files.map((file) => ({ id: file.id, name: file.name, href: fileUrl(file.id) }))} /> : null}
    <GroupedTable<MeasureLine & { id: string }> ariaLabel={t("Technical site measure")} columns={columns} selectable={false} getRowId={(line) => line.id} getRowLabel={(line) => line.label}
      sections={[{ id: measure.id, label: t("Final site dimensions"), rows: measure.lines.map((line, index) => ({ ...line, id: `${measure.id}:${index}` })), emptyMessage: t("No dimensions yet.") }]} />
  </>;
}

function useUnitLabels() {
  const t = useT();
  return useMemo<Record<MeasureUnit, string>>(() => ({ mm: t("mm"), cm: t("cm"), m: t("m"), in: t("in"), ft: t("ft") }), [t]);
}

type DraftLine = { key: string; area: string; label: string; value: number | null; unit: MeasureUnit };

/** PLM-149: records the technical site measure: the day, each final dimension with its unit, notes and photos. Save bottom-end. */
function MeasureDialog({ unit, units, today, onClose, onSave }: {
  unit: MeasureUnit; units: MeasureUnit[]; today: string; onClose: () => void;
  onSave: (input: { measuredOn: string; note: string; lines: Array<{ area: string; label: string; value: number; unit: MeasureUnit }> }, files: File[]) => Promise<void>;
}) {
  const t = useT();
  const unitLabels = useUnitLabels();
  const blank = (area = ""): DraftLine => ({ key: uuid(), area, label: "", value: null, unit });
  const [measuredOn, setMeasuredOn] = useState(today);
  const [lines, setLines] = useState<DraftLine[]>([blank()]);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const set = (key: string, patch: Partial<DraftLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const filled = lines.filter((line) => line.label.trim() || line.value !== null);
  const valid = Boolean(measuredOn) && filled.length > 0 && filled.every((line) => line.label.trim() && line.value !== null && line.value > 0);
  return <FormDialog size="lg" title={t("Technical site measure")} onClose={onClose} isDirty={Boolean(filled.length || note.trim() || files.length)} isSubmitDisabled={!valid}
    submitLabel={t("Save")} onSubmit={() => onSave({ measuredOn, note: note.trim(),
      lines: filled.map((line) => ({ area: line.area.trim(), label: line.label.trim(), value: line.value!, unit: line.unit })) }, files)}>
    <FormSection>
      <DateField label={t("Measured on")} isRequired value={measuredOn ? parseDate(measuredOn) : null} maxValue={parseDate(today)}
        onChange={(value) => setMeasuredOn(value ? value.toString() : "")} />
      <div className={styles.measureLines}>
        {lines.map((line, index) => {
          // The first row carries the column labels; the others are named for screen readers.
          const name = (text: string) => (index === 0 ? { label: text } : { label: null, "aria-label": text });
          return <div key={line.key} className={styles.measureRow}>
          <TextInput {...name(t("Where"))} maxLength={120} value={line.area} onChange={(area) => set(line.key, { area })} />
          <TextInput {...name(t("Dimension"))} maxLength={120} value={line.label} onChange={(label) => set(line.key, { label })} />
          <NumericInput {...name(t("Size"))} minValue={0} formatOptions={{ maximumFractionDigits: 4 }}
            value={line.value ?? Number.NaN} onChange={(value) => set(line.key, { value: Number.isFinite(value) ? value : null })} />
          <SelectField {...name(t("Unit"))} accent="neutral" selectedKey={line.unit}
            items={units.map((id) => ({ id, label: unitLabels[id] }))} onSelectionChange={(key) => set(line.key, { unit: String(key) as MeasureUnit })} />
          <IconButton aria-label={t("Remove dimension {number}", { number: index + 1 })} size="compact" variant="quiet" isDisabled={lines.length === 1}
            onPress={() => setLines((current) => current.filter((item) => item.key !== line.key))}><Trash2 aria-hidden="true" size={14} /></IconButton>
          </div>;
        })}
        <div><Button size="compact" variant="quiet" isDisabled={lines.length >= 120} onPress={() => setLines((current) => [...current, blank(current[current.length - 1]?.area ?? "")])}>
          <Plus aria-hidden="true" size={14} />{t("Add dimension")}</Button></div>
      </div>
      <TextAreaField label={t("Notes")} maxLength={4000} value={note} onChange={setNote} />
      <FileUploader accept={ACCEPT} label={t("Photos and files")} onFiles={(added) => setFiles((current) => [...current, ...added].slice(0, 30))} />
    </FormSection>
  </FormDialog>;
}

/** The site (or design) check opens the revision's drawings; passing it is one choice, changes need what to change. */
function SiteCheckDialog({ revision, design, files, onClose, onSave }: { revision: DrawingRevision; design: boolean; files: ReviewFile[]; onClose: () => void; onSave: (result: "ok" | "changes", note: string) => Promise<void> }) {
  const t = useT();
  return <ReviewDialog title={design ? t("Design check for R{number}", { number: revision.number }) : t("Site check for R{number}", { number: revision.number })} files={files}
    confirmLabel={design ? t("Matches the design") : t("Site check passed")} returnLabel={t("Changes needed")}
    onConfirm={(note) => onSave("ok", note)} onReturn={(reason) => onSave("changes", reason)} onClose={onClose} />;
}

function ClientDecisionDialog({ revision, today, onClose, onSave }: {
  revision: DrawingRevision; today: string; onClose: () => void;
  onSave: (input: { decision: "approve" | "changes"; decidedOn: string; decidedBy: string; note: string }, files: File[]) => Promise<void>;
}) {
  const t = useT();
  const [decision, setDecision] = useState<"approve" | "changes">("approve");
  const [decidedOn, setDecidedOn] = useState(today);
  const [decidedBy, setDecidedBy] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const signed = revision.files.some((file) => file.kind === "approval");
  const valid = decidedBy.trim() && decidedOn && (decision === "changes" ? note.trim() : signed || files.length);
  return <FormDialog size="md" title={t("Client's decision on R{number}", { number: revision.number })} onClose={onClose} isDirty={Boolean(decidedBy.trim() || note.trim() || files.length)}
    isSubmitDisabled={!valid} submitLabel={t("Save")}
    onSubmit={() => onSave({ decision, decidedOn, decidedBy: decidedBy.trim(), note: note.trim() }, decision === "approve" ? files : [])}>
    <FormSection>
      <SegmentedControl label={t("Decision")} value={decision} onChange={(value) => setDecision(value as "approve" | "changes")}
        options={[{ id: "approve", label: t("Approved") }, { id: "changes", label: t("Changes asked") }]} />
      <DateField label={t("Decided on")} isRequired value={decidedOn ? parseDate(decidedOn) : null} maxValue={parseDate(today)}
        onChange={(value) => setDecidedOn(value ? value.toString() : "")} />
      <TextInput label={t("Decided by")} isRequired maxLength={200} value={decidedBy} onChange={setDecidedBy} />
      {decision === "approve" && !signed ? <FileUploader accept={ACCEPT} label={t("The client's signed approval")} onFiles={(added) => setFiles((current) => [...current, ...added].slice(0, 5))} /> : null}
      <TextAreaField label={decision === "changes" ? t("What the client wants changed") : t("Note")} isRequired={decision === "changes"} maxLength={1000} value={note} onChange={setNote} />
    </FormSection>
  </FormDialog>;
}

function useReasonLabels() {
  const t = useT();
  return useMemo<Record<DrawingReason, string>>(() => ({
    bespoke: t("Bespoke"), made_to_order: t("Made to order"), no_catalogue_drawing: t("No catalogue drawing"), catalogue_drawing: t("Catalogue drawing attached"),
  }), [t]);
}

/**
 * The items and whether each needs technical drawings (PLM-057): bespoke and made-to-order always; a standard item only
 * without a catalogue drawing (linked here); the team's decision, with who and why, wins over the rule.
 */
function DrawingItems({ items, approved, canDecide, onDecide }: { items: DrawingItem[]; approved: number | null; canDecide: boolean; onDecide: (item: DrawingItem) => void }) {
  const t = useT();
  const reasons = useReasonLabels();
  // An item that needs drawings is covered once the client approved the latest revision (the work orders read the same).
  const columns: GroupedTableColumn<DrawingItem>[] = [
    { id: "item", label: t("Item"), width: "40%", render: (item) => <span className={styles.lineCell}><span>{item.title}</span>{item.area ? <small>{item.area}</small> : null}</span> },
    { id: "drawings", label: t("Drawings"), width: "35%", render: (item) => <span className={styles.lineCell}>
      <span><Badge tone={item.needed && approved === null ? "warning" : "success"}>{!item.needed ? t("Not needed") : approved === null ? t("Needed") : t("Approved R{number}", { number: approved })}</Badge></span>
      {item.override ? <small>{[item.override.reason, item.override.byName].filter(Boolean).join(" · ")}</small> : <span><TypeChip>{reasons[item.rule.reason]}</TypeChip></span>}
    </span> },
    { id: "catalogue", label: t("Catalogue drawing"), width: canDecide ? "15%" : "25%", mobileHidden: true, render: (item) => item.catalogDrawingUrl
      ? <a className={styles.detailLink} href={item.catalogDrawingUrl} target="_blank" rel="noreferrer">{item.catalogName ?? t("Open the drawing")}</a> : <span className={styles.muted}>—</span> },
    ...(canDecide ? [{ id: "action", label: "", width: "10%", align: "end" as const, render: (item: DrawingItem) =>
      <Button size="compact" onPress={() => onDecide(item)}>{t("Change")}</Button> }] : []),
  ];
  return <GroupedTable<DrawingItem> ariaLabel={t("Items")} columns={columns} selectable={false} getRowId={(item) => item.lineId} getRowLabel={(item) => item.title}
    onRowAction={canDecide ? (item) => onDecide(item) : undefined}
    sections={[{ id: "items", label: t("Items"), rows: items, emptyMessage: t("No items yet."), headerLabels: { item: "", drawings: t("{count} need drawings", { count: items.filter((item) => item.needed).length }), catalogue: "", action: "" } }]} />;
}

/** Whether one item needs drawings: as the rule says, or the team's decision with the reason. */
function DrawingNeedDialog({ item, onClose, onSave }: { item: DrawingItem; onClose: () => void; onSave: (needed: boolean | null, reason: string) => Promise<void> }) {
  const t = useT();
  const reasons = useReasonLabels();
  const [choice, setChoice] = useState<"rule" | "needed" | "not_needed">(item.override ? (item.override.needed ? "needed" : "not_needed") : "rule");
  const [reason, setReason] = useState(item.override?.reason ?? "");
  const ruleLabel = t("As the rule says ({rule})", { rule: `${item.rule.needed ? t("Needed") : t("Not needed")} · ${reasons[item.rule.reason]}` });
  return <FormDialog size="md" title={item.title} onClose={onClose} isDirty={choice !== (item.override ? (item.override.needed ? "needed" : "not_needed") : "rule") || reason !== (item.override?.reason ?? "")}
    isSubmitDisabled={choice !== "rule" && !reason.trim()} submitLabel={t("Save")}
    onSubmit={() => onSave(choice === "rule" ? null : choice === "needed", choice === "rule" ? "" : reason.trim())}>
    <SegmentedControl label={t("Technical drawings")} value={choice} onChange={(value) => setChoice(value as typeof choice)}
      options={[{ id: "rule", label: ruleLabel }, { id: "needed", label: t("Needed") }, { id: "not_needed", label: t("Not needed") }]} />
    {choice !== "rule" ? <TextAreaField label={t("Why")} isRequired maxLength={500} value={reason} onChange={setReason} /> : null}
  </FormDialog>;
}
