"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { NotebookPen, Paperclip, X } from "lucide-react";
import {
  Badge, Button, ErrorState, FileUploader, Form, FormDialog, FormSection, IconButton, InlineNotice, InspectorSheet, Skeleton, Switch, TextAreaField, TextInput, useDesignSystem,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { minutesApi, type MinutesFile, type MinutesState } from "@/lib/meetings/client";
import styles from "./meeting-minutes.module.css";

const ACCEPT = "application/pdf,image/*";
const uuid = () => crypto.randomUUID();

/**
 * PLM-153: the minutes of a client meeting, wherever the meeting opens (the follow-up, the calendar, the design
 * journey): the text and files, shared with the client or kept internal, the client's comments with the team's
 * replies, and the earlier versions. One action: write or edit the minutes.
 */
export function MeetingMinutes({ workspaceId, activityId }: { workspaceId: string; activityId: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const api = useMemo(() => minutesApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<MinutesState | null>(null);
  const [failure, setFailure] = useState("");
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState(false);
  const load = useCallback(async () => {
    try { setState(await api.read(activityId)); setFailure(""); } catch (cause) { setFailure(cause instanceof Error ? cause.message : t("The minutes didn't load.")); }
  }, [api, activityId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

  if (failure && !state) return <ErrorState description={translateKnown(t, failure)} onRetry={() => void load()} />;
  if (!state) return <Skeleton lines={3} shape="rows" />;
  const { minutes, portal } = state;
  const files = minutes ? state.files.filter((file) => minutes.fileIds.includes(file.id)) : [];
  const canEdit = state.canWrite && !state.problem;
  // Where the client stands: the minutes reach them only through their portal.
  const reach = !minutes?.sharedAt ? null : !portal.caseId ? t("The client sees them once their project is in the portal.")
    : !portal.enabled || !portal.shown ? t("Meetings are hidden in this client's portal.")
    : !portal.contacts ? t("Nobody on the client's side has portal access yet. They'll see them once invited.") : null;
  return <section className={styles.minutes} aria-labelledby={`minutes-${activityId}`}>
    <div className={styles.header}>
      <h3 id={`minutes-${activityId}`}><NotebookPen aria-hidden="true" size={15} />{t("Minutes")}</h3>
      {minutes ? <Badge tone={minutes.sharedAt ? "success" : "neutral"}>{minutes.sharedAt ? t("Shared with the client") : t("Internal")}</Badge> : null}
      {canEdit ? <Button size="compact" variant={minutes ? "secondary" : "primary"} onPress={() => { setNotice(""); setEditing(true); }}>{minutes ? t("Edit minutes") : t("Write minutes")}</Button> : null}
    </div>
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    {!minutes ? <p className={styles.muted}>{state.problem ? translateKnown(t, state.problem) : t("No minutes yet.")}</p> : <>
      <p className={styles.meta}>{[minutes.title, t("R{number}", { number: minutes.revision }), minutes.updatedByName, when(minutes.updatedAt)].join(" · ")}</p>
      <p className={styles.text} dir="auto">{minutes.body}</p>
      {files.length ? <ul className={styles.files}>{files.map((file) => <li key={file.id}>
        <a href={api.fileUrl(activityId, file.id)} target="_blank" rel="noreferrer"><Paperclip aria-hidden="true" size={13} />{file.name}</a></li>)}</ul> : null}
      {reach ? <InlineNotice tone="info" message={reach} /> : null}
      {state.comments.length || minutes.sharedAt ? <Conversation state={state} when={when} canReply={state.canWrite && Boolean(minutes.sharedAt)}
        onReply={async (text) => setState(await api.reply(activityId, { commentId: uuid(), text }))} /> : null}
      {state.revisions.length > 1 ? <div>
        <Button size="compact" variant="quiet" onPress={() => setHistory(!history)}>{history ? t("Hide earlier versions") : state.revisions.length === 2 ? t("1 earlier version") : t("{count} earlier versions", { count: state.revisions.length - 1 })}</Button>
        {history ? <ol className={styles.history}>{state.revisions.slice(1).map((revision) => <li key={revision.revision}>
          <span className={styles.meta}>{[t("R{number}", { number: revision.revision }), revision.byName, when(revision.at), revision.shared ? t("Shared with the client") : t("Internal")].join(" · ")}</span>
          <span className={styles.text} dir="auto">{revision.body}</span>
        </li>)}</ol> : null}
      </div> : null}
    </>}
    {editing ? <MinutesDialog state={state} api={api} onClose={() => setEditing(false)} onSaved={(next) => {
      setState(next); setEditing(false);
      setNotice(next.told?.queued ? t("Shared. The client was told by email.") : next.minutes?.sharedAt ? t("Saved. The client sees them in the portal.") : t("Saved."));
    }} /> : null}
  </section>;
}

/** The client's comments and the team's replies, oldest first, with the reply box while the minutes are shared. */
function Conversation({ state, when, canReply, onReply }: { state: MinutesState; when: (iso: string) => string; canReply: boolean; onReply: (text: string) => Promise<void> }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    setBusy(true); setError("");
    try { await onReply(text.trim()); setText(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not send.")); } finally { setBusy(false); }
  };
  return <div className={styles.conversation}>
    {state.comments.length ? <ol className={styles.comments} aria-label={t("Comments")}>{state.comments.map((comment) => <li key={comment.id} data-client={comment.fromClient || undefined}>
      <span className={styles.meta}>{[comment.author, comment.fromClient ? t("Client") : "", when(comment.at)].filter(Boolean).join(" · ")}</span>
      <span className={styles.text} dir="auto">{comment.text}</span>
    </li>)}</ol> : null}
    {canReply ? <Form className={styles.reply} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {error ? <InlineNotice tone="error" message={translateKnown(t, error)} /> : null}
      <TextAreaField label={t("Reply to the client")} value={text} onChange={setText} maxLength={2000} />
      <div className={styles.replyActions}><Button size="compact" type="submit" isLoading={busy} isDisabled={!text.trim()}>{t("Send")}</Button></div>
    </Form> : null}
  </div>;
}

/** Writes or edits the minutes: a title, the text, photos and PDFs, and whether the client sees them. Save bottom-end. */
function MinutesDialog({ state, api, onClose, onSaved }: { state: MinutesState; api: ReturnType<typeof minutesApi>; onClose: () => void; onSaved: (next: MinutesState) => void }) {
  const t = useT();
  const minutes = state.minutes;
  const activityId = state.meeting.activityId;
  const [title, setTitle] = useState(minutes?.title ?? state.meeting.title);
  const [body, setBody] = useState(minutes?.body ?? "");
  const [shared, setShared] = useState(minutes ? Boolean(minutes.sharedAt) : true);
  const [kept, setKept] = useState<MinutesFile[]>(() => state.files.filter((file) => minutes?.fileIds.includes(file.id)));
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const [minutesId] = useState(() => minutes?.id ?? uuid());
  const add = async (files: File[]) => {
    setError("");
    for (const file of files) {
      setUploading((count) => count + 1);
      try { const stored = await api.upload(activityId, uuid(), file); setKept((current) => [...current.filter((item) => item.id !== stored.id), stored].slice(0, 20)); }
      catch (cause) { setError(cause instanceof Error ? cause.message : t("The file could not be uploaded.")); }
      finally { setUploading((count) => count - 1); }
    }
  };
  const dirty = title !== (minutes?.title ?? state.meeting.title) || body !== (minutes?.body ?? "") || shared !== (minutes ? Boolean(minutes.sharedAt) : true)
    || kept.map((file) => file.id).join() !== (minutes?.fileIds ?? []).join();
  return <FormDialog size="lg" title={minutes ? t("Edit minutes") : t("Write minutes")} onClose={onClose} isDirty={dirty} submitLabel={t("Save")}
    isSubmitDisabled={!title.trim() || !body.trim() || uploading > 0}
    onSubmit={async () => onSaved(await api.save(activityId, { minutesId, version: minutes?.version ?? 0, title: title.trim(), body: body.trim(), fileIds: kept.map((file) => file.id), shared }))}>
    <FormSection>
      {error ? <InlineNotice tone="error" message={translateKnown(t, error)} /> : null}
      <TextInput label={t("Title")} isRequired maxLength={200} value={title} onChange={setTitle} />
      <TextAreaField label={t("Minutes")} isRequired maxLength={20000} value={body} onChange={setBody} />
      {kept.length ? <ul className={styles.files}>{kept.map((file) => <li key={file.id}><Paperclip aria-hidden="true" size={13} /><span>{file.name}</span>
        <IconButton aria-label={t("Remove {name}", { name: file.name })} size="compact" variant="quiet" onPress={() => setKept((current) => current.filter((item) => item.id !== file.id))}>
          <X aria-hidden="true" size={13} /></IconButton></li>)}</ul> : null}
      {kept.length < 20 ? <FileUploader accept={ACCEPT} label={t("Photos and files")} onFiles={(files) => void add(files)} /> : null}
      <Switch isSelected={shared} onChange={setShared}>{t("Share with the client")}</Switch>
      {minutes?.sharedAt && shared ? <p className={styles.muted}>{t("The client sees your changes; the earlier version stays in the history.")}</p> : null}
    </FormSection>
  </FormDialog>;
}

/** The minutes of a meeting in a side sheet, for screens that list meetings without opening them (the design journey). */
export function MeetingMinutesSheet({ workspaceId, activityId, title, onClose }: { workspaceId: string; activityId: string; title: string; onClose: () => void }) {
  return <InspectorSheet isOpen size="md" title={title} onOpenChange={(open) => { if (!open) onClose(); }}>
    <MeetingMinutes workspaceId={workspaceId} activityId={activityId} />
  </InspectorSheet>;
}
