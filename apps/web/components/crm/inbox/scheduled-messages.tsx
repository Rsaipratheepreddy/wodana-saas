"use client";

import { useState } from "react";
import { Clock3, TriangleAlert } from "lucide-react";
import { Button, Checkbox, ControlledModalDialog, InlineNotice, TextAreaField, useConfirmationDialog, useDesignSystem, useReadOnlyReason } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { zonedToUtc } from "@/lib/crm/zoned-time";
import { useT } from "@/lib/i18n/i18n-provider";
import { CrmDateTimeField } from "../crm-date-time-field";
import styles from "../crm-inbox.module.css";

const timeout = () => AbortSignal.timeout(20_000);

/** A message someone scheduled in this chat ("Send later"), as the thread shows it until it goes. */
export type ScheduledMessage = {
  id: string; status: "scheduled" | "failed"; sendAt: string; bodyText: string | null; templateId: string | null; templateCode: string | null;
  templateParameters: string[]; renderedText: string; failureReason: string | null; createdByName: string | null; version: number;
};

/** "2026-09-30T14:00" for an instant, in the workspace's time zone (what the date and time fields hold). */
export function wallTime(value: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Whether free text could still go at `sendAt`: WhatsApp takes it only while its 24-hour window is open. */
export function windowOpenAt(windowClosesAt: string | null | undefined, sendAt: string) {
  return Boolean(windowClosesAt) && Date.parse(String(windowClosesAt)) > Date.parse(sendAt);
}

/**
 * "Send later": when a reply or a template goes, in the workspace's time zone. Free text only while WhatsApp's window
 * will still be open then (the server checks the same); a template at any time.
 */
export function ScheduleDialog({ title, initial, freeText, windowClosesAt, text, onTextChange, onClose, onSchedule, offerCancelOnReply = false }: {
  title: string; initial?: string; freeText: boolean; windowClosesAt?: string | null;
  /** Editing a scheduled free-text message: its words can change too. */
  text?: string; onTextChange?: (value: string) => void;
  onClose: () => void; onSchedule: (sendAt: string, options: { cancelOnReply: boolean }) => Promise<void>;
  /** Offer "Cancel if the client replies first" (a new message; X-1). */
  offerCancelOnReply?: boolean;
}) {
  const t = useT();
  const { timeZone } = useDesignSystem();
  const [cancelOnReply, setCancelOnReply] = useState(true);
  const [value, setValue] = useState(() => initial ?? wallTime(new Date(Date.now() + 3_600_000), timeZone));
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const submit = async () => {
    const [date, time] = value.split("T");
    const sendAt = date && time ? zonedToUtc(date, time, timeZone) : null;
    if (!sendAt || Date.parse(sendAt) < Date.now() + 60_000) { setError(t("Choose a time at least a minute from now")); return; }
    if (freeText && windowClosesAt !== undefined && !windowOpenAt(windowClosesAt, sendAt)) { setError(t("WhatsApp's 24-hour window will be closed by then. Choose an earlier time or a template.")); return; }
    if (onTextChange && !text?.trim()) { setError(t("Write a message")); return; }
    setSaving(true); setError("");
    try { await onSchedule(sendAt, { cancelOnReply }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t("The message could not be scheduled.")); }
    finally { setSaving(false); }
  };
  return <ControlledModalDialog isOpen title={title} onOpenChange={(open) => { if (!open && !saving) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>{t("Cancel")}</Button><Button variant="primary" isLoading={saving} onPress={() => void submit()}>{t("Schedule")}</Button></div>}>
    <div className={styles.templatePicker}>
      {onTextChange ? <TextAreaField label={t("Message")} value={text ?? ""} maxLength={4096} onChange={onTextChange} /> : null}
      <CrmDateTimeField label={t("Send at")} value={value} onChange={setValue} isRequired />
      {offerCancelOnReply ? <Checkbox isSelected={cancelOnReply} onChange={setCancelOnReply}>{t("Cancel it if the client replies first")}</Checkbox> : null}
      {error ? <InlineNotice tone="error" message={error} /> : null}
    </div>
  </ControlledModalDialog>;
}

/** The chat's messages waiting to go ("Scheduled for …"), with Edit and Cancel; one that couldn't go says why. */
export function ScheduledMessages({ workspaceId, conversationId, items, canSend, windowClosesAt, onChanged }: {
  workspaceId: string; conversationId: string; items: ScheduledMessage[]; canSend: boolean; windowClosesAt: string | null; onChanged: () => Promise<void>;
}) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const readOnly = useReadOnlyReason();
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);
  const [text, setText] = useState("");
  const [failure, setFailure] = useState("");
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  if (!items.length) return null;
  const when = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const path = (item: ScheduledMessage) => `conversations/${conversationId}/scheduled-messages/${item.id}`;
  const cancel = (item: ScheduledMessage) => requestConfirmation({
    title: item.status === "failed" ? t("Clear this message?") : t("Cancel this scheduled message?"), confirmLabel: item.status === "failed" ? t("Clear") : t("Cancel message"),
    body: t("It won't be sent."), onConfirm: async () => {
      setFailure("");
      try { await crmRequest(workspaceId, `${path(item)}/cancel`, "POST", { version: item.version }, timeout()); await onChanged(); }
      catch (error) { setFailure(error instanceof Error ? error.message : t("The scheduled message could not be cancelled.")); }
    },
  });
  return <section className={styles.scheduled} aria-label={t("Scheduled messages")}>
    {items.map((item) => <article key={item.id} className={styles.scheduledItem} data-state={item.status}>
      <header>{item.status === "failed" ? <TriangleAlert aria-hidden="true" size={14} /> : <Clock3 aria-hidden="true" size={14} />}
        <strong>{item.status === "failed" ? t("Not sent") : t("Scheduled for {time}", { time: when(item.sendAt) })}</strong>
        {item.createdByName ? <small>{item.createdByName}</small> : null}</header>
      <p dir="auto">{item.renderedText}</p>
      {item.status === "failed" && item.failureReason ? <small>{item.failureReason}</small> : null}
      {canSend && !readOnly ? <div className={styles.scheduledActions}>
        {item.status === "scheduled" ? <Button size="compact" variant="quiet" onPress={() => { setEditing(item); setText(item.bodyText ?? ""); }}>{t("Edit")}</Button> : null}
        <Button size="compact" variant="quiet" onPress={() => cancel(item)}>{item.status === "failed" ? t("Clear") : t("Cancel")}</Button>
      </div> : null}
    </article>)}
    {failure ? <p className={styles.error} role="alert">{failure}</p> : null}
    {editing ? <ScheduleDialog title={t("Edit scheduled message")} initial={wallTime(new Date(editing.sendAt), timeZone)} freeText={!editing.templateId} windowClosesAt={windowClosesAt}
      text={editing.templateId ? undefined : text} onTextChange={editing.templateId ? undefined : setText} onClose={() => setEditing(null)}
      onSchedule={async (sendAt) => {
        await crmRequest(workspaceId, path(editing), "PATCH", { version: editing.version, sendAt, ...(editing.templateId ? {} : { bodyText: text.trim() }) }, timeout());
        setEditing(null); await onChanged();
      }} /> : null}
    {confirmationDialog}
  </section>;
}
