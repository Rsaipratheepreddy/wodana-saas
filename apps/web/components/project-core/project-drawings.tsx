"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";
import { parseDate } from "@internationalized/date";
import {
  Button, DateField, EmptyState, ErrorState, FileUploader, FormDialog, FormSection, GroupedTable, InlineNotice, SegmentedControl, Skeleton, TextAreaField, TextInput,
  type GroupedTableColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { DrawingFile, DrawingRevision, DrawingStatus, DrawingsState } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import styles from "./project-core.module.css";

const ACCEPT = "application/pdf,image/*";
const uuid = () => crypto.randomUUID();

export function useDrawingStatusLabels() {
  const t = useT();
  return useMemo<Record<DrawingStatus, string>>(() => ({
    uploaded: t("Waiting for the site check"), checked: t("Site check passed"), changes_needed: t("Changes needed"), sent: t("With the client"),
    approved: t("Approved by the client"), changes_requested: t("The client asked for changes"),
  }), [t]);
}

/**
 * The project's technical drawings (PLM-057 … 060), one revision at a time: the technical team uploads them, the
 * drawer or the project manager records the site check, the project manager sends them to the client and records
 * the client's decision with the signed file. The factory reads the approved ones. Each change reloads the project.
 */
export function ProjectDrawings({ workspaceId, projectId, version, onChanged }: { workspaceId: string; projectId: string; version: number; onChanged?: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useDrawingStatusLabels();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<DrawingsState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"check" | "decide" | null>(null);
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

  return <div className={styles.changes}>
    <div className={styles.scopeToolbar}>
      <div className={styles.toolbarActions}>
        {data.canUpload ? <FileUploader appearance="button" accept={ACCEPT} label={latest?.status === "uploaded" ? t("Add drawings") : latest ? t("Upload a new revision") : t("Upload drawings")}
          onFiles={(files) => void addDrawings(files)} /> : null}
        {data.canCheck ? <Button size="compact" isDisabled={busy} onPress={() => setDialog("check")}>{t("Record the site check")}</Button> : null}
        {data.canSend && latest ? <Button size="compact" variant="primary" isDisabled={busy} onPress={() => void command("send_drawings", { revisionId: latest.id })}>
          <Send aria-hidden="true" size={14} />{t("Send to the client")}</Button> : null}
        {data.canDecide ? <Button size="compact" variant="primary" onPress={() => setDialog("decide")}>{t("Record the client's decision")}</Button> : null}
      </div>
    </div>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    {latest ? <RevisionFacts revision={latest} /> : null}
    {data.revisions.length
      ? <GroupedTable<DrawingFile> ariaLabel={t("Drawings")} columns={columns} selectable={false} getRowId={(file) => file.id} getRowLabel={(file) => file.name}
          sections={data.revisions.map((revision) => ({ id: revision.id, label: t("R{number} · {status}", { number: revision.number, status: labels[revision.status] }),
            rows: revision.files, emptyMessage: t("No files yet."), headerLabels: { file: "", by: format.when(revision.createdAt) } }))} />
      : <EmptyState illustration={null} title={t("No drawings yet")} description={data.canUpload ? t("Upload the technical drawings as PDFs or images.") : undefined} />}
    {dialog === "check" && latest ? <SiteCheckDialog revision={latest} onClose={() => setDialog(null)}
      onSave={async (result, note) => { await command("check_drawings", { revisionId: latest.id, result, note }, true); setDialog(null); }} /> : null}
    {dialog === "decide" && latest ? <ClientDecisionDialog revision={latest} today={format.today()} onClose={() => setDialog(null)}
      onSave={async (input, files) => {
        // The signed approval goes on the revision first; the decision is then checked against the drawings as they are now.
        const fresh = files.length ? await upload(files, "approval", latest.id) : null;
        await api.command(projectId, (fresh ?? data).version, "decide_drawings", { revisionId: latest.id, ...input });
        await load(); onChanged?.(); setDialog(null);
      }} /> : null}
  </div>;
}

/** Where the latest revision stands: its site check and the client's decision, with who and when. */
function RevisionFacts({ revision }: { revision: DrawingRevision }) {
  const t = useT();
  const format = useProjectFormat();
  const rows = [
    revision.siteCheck ? { key: "check", label: t("Site check"), value: revision.siteCheck === "ok" ? t("OK") : t("Changes needed"),
      meta: [revision.siteCheckNote, revision.siteCheckedByName, format.when(revision.siteCheckedAt)].filter(Boolean).join(" · ") } : null,
    revision.sentAt ? { key: "sent", label: t("Sent to the client"), value: format.when(revision.sentAt), meta: revision.sentByName ?? "" } : null,
    revision.decidedOn ? { key: "decision", label: t("Client's decision"), value: revision.status === "approved" ? t("Approved") : t("Changes asked"),
      meta: [revision.decidedByName, format.day(revision.decidedOn), revision.decisionVia === "portal" ? t("In the client portal") : revision.decisionRecordedByName
        ? t("Recorded by {name}", { name: revision.decisionRecordedByName }) : "", revision.decisionNote].filter(Boolean).join(" · ") } : null,
  ].filter((row): row is { key: string; label: string; value: string; meta: string } => Boolean(row));
  if (!rows.length) return null;
  return <dl className={styles.detailList}>
    {rows.map((row) => <div key={row.key}><dt>{row.label}</dt><dd>{row.value}{row.meta ? <small>{row.meta}</small> : null}</dd></div>)}
  </dl>;
}

function SiteCheckDialog({ revision, onClose, onSave }: { revision: DrawingRevision; onClose: () => void; onSave: (result: "ok" | "changes", note: string) => Promise<void> }) {
  const t = useT();
  const [result, setResult] = useState<"ok" | "changes">("ok");
  const [note, setNote] = useState("");
  return <FormDialog size="md" title={t("Site check for R{number}", { number: revision.number })} onClose={onClose} isDirty={Boolean(note.trim())}
    isSubmitDisabled={result === "changes" && !note.trim()} submitLabel={t("Save")} onSubmit={() => onSave(result, note.trim())}>
    <SegmentedControl label={t("Result")} value={result} onChange={(value) => setResult(value as "ok" | "changes")}
      options={[{ id: "ok", label: t("OK") }, { id: "changes", label: t("Changes needed") }]} />
    <TextAreaField label={result === "changes" ? t("What needs changing") : t("Note")} isRequired={result === "changes"} maxLength={1000} value={note} onChange={setNote} />
  </FormDialog>;
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
