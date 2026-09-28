"use client";

import { ArrowRight } from "lucide-react";
import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Badge, Button, ControlledModalDialog, ErrorState, InlineNotice, InspectorSheet, SelectField, Skeleton, Tabs, TextAreaField, type TabItem,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { ConsoleRequestError } from "@/lib/internal/console";
import { salesApi, type SalesAssignee, type SalesEnquiryDetail, type SalesEnquiryHistoryEvent, type SalesEnquiryStatus, type SalesEnquirySummary } from "@/lib/internal/sales";
import { useConsoleFormat } from "./labels";
import { useCountryName, useSalesLabels } from "./sales-labels";
import styles from "./sales.module.css";

const NONE = "__none";
type Command = (current: SalesEnquiryDetail) => Promise<SalesEnquiryDetail>;

/** One enquiry in a drawer: the answers and next step, the operators' notes, and everything that happened to it. */
export function SalesEnquiryInspector({ id, fallback, canManage, onClose, onChanged }: {
  id: string; fallback?: SalesEnquirySummary; canManage: boolean; onClose: () => void; onChanged: (detail: SalesEnquiryDetail) => void;
}) {
  const t = useT();
  const labels = useSalesLabels();
  const [detail, setDetail] = useState<SalesEnquiryDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [assignees, setAssignees] = useState<SalesAssignee[]>([]);
  const [losing, setLosing] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [noteId, setNoteId] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    try { setDetail(await salesApi.enquiry(id)); setError(""); }
    catch (cause) { setError((cause as Error).message || t("The enquiry didn't load.")); }
  }, [id, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useEffect(() => {
    let live = true;
    salesApi.assignees().then((result) => { if (live) setAssignees(result.assignees); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  /** Runs one command against the version on screen; a stale version reloads the record and says so. */
  const run = async (command: Command) => {
    if (!detail) return false;
    setBusy(true); setNotice("");
    try { const next = await command(detail); setDetail(next); onChanged(next); return true; }
    catch (cause) {
      if (cause instanceof ConsoleRequestError && cause.status === 409) { setNotice(t("This enquiry changed. Try again.")); await load(); }
      else setNotice((cause as Error).message || t("The change could not be saved."));
      return false;
    } finally { setBusy(false); }
  };
  const changeStatus = (status: SalesEnquiryStatus, reason?: string) =>
    run((current) => salesApi.changeStatus(current.id, { expectedVersion: current.version, status, ...(reason ? { reason } : {}) }));
  const addNote = async () => {
    const body = noteBody.trim();
    if (!body) return;
    if (await run((current) => salesApi.addNote(current.id, { noteId, body }))) { setNoteBody(""); setNoteId(crypto.randomUUID()); }
  };

  const head = detail ?? fallback;
  const items: TabItem[] = detail ? [
    { id: "details", label: t("Details"), panel: <DetailsPanel detail={detail} assignees={assignees} busy={busy} canManage={canManage}
      onStatus={(status) => void changeStatus(status)} onLose={() => setLosing(true)}
      onAssign={(assigneeUserId) => void run((current) => salesApi.assign(current.id, { expectedVersion: current.version, assigneeUserId }))} /> },
    { id: "notes", label: t("Notes"), count: detail.notes.length, panel: <NotesPanel detail={detail} busy={busy} canManage={canManage}
      body={noteBody} onBody={setNoteBody} onAdd={() => void addNote()} /> },
    { id: "history", label: t("History"), panel: <HistoryPanel detail={detail} /> },
  ] : [];

  return <>
    <InspectorSheet isOpen onOpenChange={(open) => { if (!open) onClose(); }} size="md" title={head ? `${head.reference} · ${head.name}` : t("Enquiry")}>
      {error && !detail ? <ErrorState description={error} onRetry={() => void load()} /> : !detail ? <Skeleton lines={8} shape="facts" /> : <div className={styles.stack}>
        {notice ? <InlineNotice tone="error" message={notice} /> : null}
        <Tabs defaultSelectedKey="details" items={items} />
      </div>}
    </InspectorSheet>
    {losing ? <LostDialog busy={busy} error={notice} onClose={() => setLosing(false)}
      onConfirm={async (reason) => { if (await changeStatus("lost", reason)) setLosing(false); }} /> : null}
  </>;
}

function DetailsPanel({ detail, assignees, busy, canManage, onStatus, onLose, onAssign }: {
  detail: SalesEnquiryDetail; assignees: SalesAssignee[]; busy: boolean; canManage: boolean;
  onStatus: (status: SalesEnquiryStatus) => void; onLose: () => void; onAssign: (assigneeUserId: string | null) => void;
}) {
  const t = useT();
  const labels = useSalesLabels();
  const format = useConsoleFormat();
  const countryName = useCountryName();
  const status = labels.status[detail.status];
  const closed = detail.status === "won" || detail.status === "lost";
  // The way forward: contacted, qualified or won (a closed enquiry goes back to where it stood).
  const forward = detail.nextStatuses.find((next): next is Exclude<SalesEnquiryStatus, "new" | "lost"> => next !== "lost" && next !== "new");
  const current = detail.assignee?.userId ?? null;
  const known = assignees.some((operator) => operator.userId === current);
  const operators = [
    { id: NONE, label: t("Unassigned") },
    ...assignees.map((operator) => ({ id: operator.userId, label: operator.name, description: operator.email })),
    ...(current && !known ? [{ id: current, label: detail.assignee?.name ?? t("Operator") }] : []),
  ];
  const when = (value: string) => <span title={format.dateTime(value)}>{format.dateTime(value)}</span>;
  const facts: Array<[string, ReactNode]> = [
    [t("Name"), detail.name],
    [t("Work email"), <a className={styles.ltr} href={`mailto:${detail.email}`} key="email">{detail.email}</a>],
    [t("Phone"), detail.phone ? <a className={styles.ltr} href={`tel:${detail.phone}`} key="phone">{detail.phone}</a> : null],
    [t("Company"), detail.company],
    [t("Country"), countryName(detail.countryCode)],
    [t("Team size"), detail.teamSize],
    [t("Message"), detail.message ? <span className={styles.message} key="message">{detail.message}</span> : null],
    [t("Received"), when(detail.createdAt)],
    [t("Source"), detail.source],
    [t("Page"), detail.pagePath ? <span className={styles.ltr} key="page">{detail.pagePath}</span> : null],
    [t("Referrer"), detail.referrer ? <span className={styles.ltr} key="referrer">{detail.referrer}</span> : null],
    [t("UTM source"), detail.utm.source],
    [t("UTM medium"), detail.utm.medium],
    [t("UTM campaign"), detail.utm.campaign],
    [t("UTM term"), detail.utm.term],
    [t("UTM content"), detail.utm.content],
    [t("Consent"), <Fragment key="consent">{detail.consentText} · {format.dateTime(detail.consentedAt)}</Fragment>],
    [t("Form version"), String(detail.formVersion)],
  ];
  return <div className={styles.stack}>
    <div className={styles.statusRow}>
      <Badge tone={status.tone}>{status.label}</Badge>
      {canManage ? <div className={styles.actions}>
        {forward ? <Button size="compact" variant="primary" isDisabled={busy} onPress={() => onStatus(forward)}>{closed ? labels.reopen : labels.move[forward]}</Button> : null}
        {detail.nextStatuses.includes("lost") ? <Button size="compact" isDisabled={busy} onPress={onLose}>{labels.move.lost}</Button> : null}
      </div> : null}
    </div>
    <SelectField label={t("Assignee")} accent="neutral" items={operators} selectedKey={current ?? NONE} isDisabled={!canManage || busy}
      onSelectionChange={(key) => { const next = !key || key === NONE ? null : String(key); if (next !== current) onAssign(next); }} />
    <dl className={styles.facts}>
      {facts.filter(([, value]) => value).map(([label, value]) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}
    </dl>
    <section className={styles.stack} aria-label={t("Notified")}>
      <h3 className={styles.subhead}>{t("Notified")}</h3>
      {detail.notices.length ? <ul className={styles.list}>{detail.notices.map((item) => {
        const delivery = labels.notice[item.status] ?? { label: item.status, tone: "neutral" as const };
        return <li className={styles.noticeRow} key={item.id}>
          <span className={styles.ltr}>{item.recipient}</span><Badge tone={delivery.tone}>{delivery.label}</Badge>
          {item.lastAttemptedAt ? <small className={styles.muted} title={format.dateTime(item.lastAttemptedAt)}>{format.relative(item.lastAttemptedAt)}</small> : null}
        </li>;
      })}</ul> : <p className={styles.muted}>{t("No recipients")}</p>}
    </section>
  </div>;
}

function NotesPanel({ detail, busy, canManage, body, onBody, onAdd }: {
  detail: SalesEnquiryDetail; busy: boolean; canManage: boolean; body: string; onBody: (value: string) => void; onAdd: () => void;
}) {
  const t = useT();
  const format = useConsoleFormat();
  return <div className={styles.stack}>
    {canManage ? <div className={styles.noteForm}>
      <TextAreaField label={t("Note")} value={body} onChange={onBody} isDisabled={busy} />
      <Button size="compact" variant="primary" isDisabled={!body.trim() || busy} onPress={onAdd}>{t("Add note")}</Button>
    </div> : null}
    {detail.notes.length ? <ul className={styles.list}>{detail.notes.map((note) => <li key={note.id}>
      <span className={styles.meta}><strong>{note.authorName ?? t("Operator")}</strong><span title={format.dateTime(note.createdAt)}>{format.relative(note.createdAt)}</span></span>
      <p className={styles.body}>{note.body}</p>
    </li>)}</ul> : <p className={styles.muted}>{t("No notes yet")}</p>}
  </div>;
}

function HistoryPanel({ detail }: { detail: SalesEnquiryDetail }) {
  const t = useT();
  const labels = useSalesLabels();
  const format = useConsoleFormat();
  const statusLabel = (value: string | null | undefined) => (value && value in labels.status ? labels.status[value as SalesEnquiryStatus].label : value ?? "");
  const change = (event: SalesEnquiryHistoryEvent): ReactNode => {
    if (event.action === "status_changed") return <span className={styles.change}>
      <span>{statusLabel(event.details.from)}</span><ArrowRight aria-hidden="true" size={12} /><span>{statusLabel(event.details.to)}</span>
      {event.details.reason ? <span className={styles.muted}>· {event.details.reason}</span> : null}
    </span>;
    if (event.action === "assigned") return <span className={styles.change}>
      <span>{event.details.fromName ?? t("Unassigned")}</span><ArrowRight aria-hidden="true" size={12} /><span>{event.details.toName ?? t("Unassigned")}</span>
    </span>;
    return null;
  };
  return detail.history.length ? <ul className={styles.list}>{detail.history.map((event) => <li key={event.id}>
    <span className={styles.meta}>
      <strong>{labels.action[event.action] ?? event.action}</strong>
      <span>{event.actorName ?? (event.action === "received" ? t("Website") : t("Operator"))}</span>
      <span title={format.dateTime(event.createdAt)}>{format.relative(event.createdAt)}</span>
    </span>
    {change(event)}
  </li>)}</ul> : <p className={styles.muted}>{t("No history yet")}</p>;
}

/** Closing an enquiry as lost: the reason is optional but kept in the history. Save is bottom-end. */
function LostDialog({ busy, error, onClose, onConfirm }: { busy: boolean; error: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const t = useT();
  const labels = useSalesLabels();
  const [reason, setReason] = useState("");
  return <ControlledModalDialog isOpen size="md" title={labels.move.lost} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button isDisabled={busy} onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} onPress={() => void onConfirm(reason.trim())}>{labels.move.lost}</Button></div>}>
    <div className={styles.stack}>
      <TextAreaField label={t("Reason")} description={t("Optional")} value={reason} onChange={setReason} />
      {error ? <InlineNotice tone="error" message={error} /> : null}
    </div>
  </ControlledModalDialog>;
}
