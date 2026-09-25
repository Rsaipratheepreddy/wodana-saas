"use client";

import { useState } from "react";
import { CalendarClock, CircleSlash, Mail, MessageCircle, MessageSquareText, Phone, PhoneMissed, ThumbsUp, Users, type LucideIcon } from "lucide-react";
import { Button, ControlledModalDialog, InlineNotice, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { logLeadContact, type ContactChannel, type ContactOutcome, type LoggedContact } from "@/lib/crm/contact";
import { CrmDateTimeField } from "./crm-date-time-field";
import styles from "./log-contact-dialog.module.css";

const CHANNEL_ICONS: Record<ContactChannel, LucideIcon> = { call: Phone, whatsapp: MessageCircle, email: Mail, meeting: Users, sms: MessageSquareText };
const OUTCOME_ICONS: Record<ContactOutcome, LucideIcon> = { no_answer: PhoneMissed, message_sent_no_reply: MessageSquareText, willing_to_talk: ThumbsUp, come_back_later: CalendarClock, not_interested: CircleSlash };
const OUTCOME_TONES: Partial<Record<ContactOutcome, string>> = { willing_to_talk: "success", come_back_later: "attention", not_interested: "danger" };

/** Tomorrow at 10:00 local time, as the field's yyyy-mm-ddThh:mm value. */
function tomorrowMorning(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T10:00`;
}

/** PLM-042: record one contact attempt; the outcome moves the enquiry to the right list. */
export function LogContactDialog({ workspaceId, lead, onClose, onLogged }: {
  workspaceId: string;
  lead: { id: string; version: number; name: string };
  onClose: () => void;
  onLogged: (saved: LoggedContact, outcome: ContactOutcome) => void;
}) {
  const t = useT();
  const [channel, setChannel] = useState<ContactChannel>("call");
  const [outcome, setOutcome] = useState<ContactOutcome | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const channels: Array<{ id: ContactChannel; label: string }> = [
    { id: "call", label: t("Call") }, { id: "whatsapp", label: t("WhatsApp") }, { id: "email", label: t("Email") }, { id: "meeting", label: t("Meeting") }, { id: "sms", label: t("SMS") },
  ];
  const outcomes: Array<{ id: ContactOutcome; label: string }> = [
    { id: "no_answer", label: t("No answer") },
    { id: "message_sent_no_reply", label: t("Message sent, no reply") },
    { id: "willing_to_talk", label: t("Willing to talk") },
    { id: "come_back_later", label: t("Come back later") },
    { id: "not_interested", label: t("Not interested") },
  ];
  const needsFollowUp = outcome === "come_back_later";
  const showFollowUp = outcome !== null && outcome !== "not_interested";

  const choose = (next: ContactOutcome) => {
    setOutcome(next); setError("");
    // Suggest a next step where one is expected; the person can change or clear it.
    if (!followUp && (next === "no_answer" || next === "message_sent_no_reply" || next === "come_back_later")) setFollowUp(tomorrowMorning());
  };

  const save = async () => {
    if (!outcome) { setError(t("Choose the outcome of this contact.")); return; }
    if (!note.trim()) { setError(t("Add a note about this contact.")); return; }
    if (outcome === "not_interested" && !reason.trim()) { setError(t("Add the reason the client is not interested.")); return; }
    const next = showFollowUp && followUp ? new Date(followUp) : null;
    if (needsFollowUp && (!next || next.getTime() <= Date.now())) { setError(t("Book a follow-up date in the future.")); return; }
    setSaving(true); setError("");
    try {
      const saved = await logLeadContact(workspaceId, lead.id, {
        version: lead.version, channel, outcome, note: note.trim(),
        ...(outcome === "not_interested" ? { reason: reason.trim() } : {}),
        ...(next ? { nextActionAt: next.toISOString() } : {}),
      });
      onLogged(saved, outcome);
    } catch (reasonError) { setError(reasonError instanceof Error ? reasonError.message : t("The contact could not be logged.")); }
    finally { setSaving(false); }
  };

  return <ControlledModalDialog
    description={lead.name}
    footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>{t("Cancel")}</Button><Button isLoading={saving} onPress={() => void save()} variant="primary">{t("Log contact")}</Button></div>}
    isDismissable={!saving}
    isOpen
    onOpenChange={(open) => { if (!open && !saving) onClose(); }}
    title={t("Log contact")}
  >
    <div className={styles.body}>
      <div className={styles.group} role="radiogroup" aria-label={t("How")}>
        <span className={styles.groupLabel}>{t("How")}</span>
        <div className={styles.channels}>{channels.map(({ id, label }) => {
          const Icon = CHANNEL_ICONS[id];
          return <button aria-checked={channel === id} className={styles.channel} key={id} onClick={() => setChannel(id)} role="radio" type="button"><Icon aria-hidden="true" size={14} />{label}</button>;
        })}</div>
      </div>
      <div className={styles.group} role="radiogroup" aria-label={t("Outcome")}>
        <span className={styles.groupLabel}>{t("Outcome")}</span>
        <div className={styles.outcomes}>{outcomes.map(({ id, label }) => {
          const Icon = OUTCOME_ICONS[id];
          return <button aria-checked={outcome === id} className={styles.outcome} data-tone={OUTCOME_TONES[id]} key={id} onClick={() => choose(id)} role="radio" type="button"><Icon aria-hidden="true" size={15} /><span>{label}</span></button>;
        })}</div>
      </div>
      <TextAreaField isRequired label={t("Note")} maxLength={4000} onChange={setNote} placeholder={t("What did you discuss?")} value={note} />
      {outcome === "not_interested" ? <TextInput isRequired label={t("Reason")} maxLength={160} onChange={setReason} value={reason} /> : null}
      {showFollowUp ? <CrmDateTimeField isRequired={needsFollowUp} label={needsFollowUp ? t("Come back on") : t("Next follow-up")} onChange={setFollowUp} value={followUp} /> : null}
      {error ? <InlineNotice message={error} tone="error" /> : null}
    </div>
  </ControlledModalDialog>;
}
