"use client";

import { useMemo, useState } from "react";
import { CalendarClock, CircleSlash, Mail, MessageCircle, MessageSquareText, Phone, PhoneMissed, PhoneOff, ThumbsUp, Users, type LucideIcon } from "lucide-react";
import { FormDialog, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { logLeadContact, UNANSWERED_OUTCOMES, type ContactChannel, type ContactOutcome, type LoggedContact } from "@/lib/crm/contact";
import type { CrmSlaPolicy } from "@/lib/crm/leads";
import { deadlineText, quickFollowUps, salesHours, wallClock } from "@/lib/crm/sales-time";
import { zonedToUtc } from "@/lib/crm/zoned-time";
import { CrmDateTimeField } from "./crm-date-time-field";
import styles from "./log-contact-dialog.module.css";

const CHANNEL_ICONS: Record<ContactChannel, LucideIcon> = { call: Phone, whatsapp: MessageCircle, email: Mail, meeting: Users, sms: MessageSquareText };
const OUTCOME_ICONS: Record<ContactOutcome, LucideIcon> = { no_answer: PhoneMissed, message_sent_no_reply: MessageSquareText, willing_to_talk: ThumbsUp, come_back_later: CalendarClock, not_interested: CircleSlash, unreachable: PhoneOff };
const OUTCOME_TONES: Partial<Record<ContactOutcome, string>> = { willing_to_talk: "success", come_back_later: "attention", not_interested: "danger", unreachable: "danger" };

/**
 * PLM-042: record one contact attempt; the outcome moves the enquiry to the right list. S-16: a try
 * that reached nobody is one tap (the note is written for you), and the next try is one chip away,
 * inside Sales working hours.
 */
export function LogContactDialog({ workspaceId, lead, slaPolicies = [], onClose, onLogged }: {
  workspaceId: string;
  lead: { id: string; version: number; name: string };
  /** The Sales working hours come from the first-response policy. */
  slaPolicies?: CrmSlaPolicy[];
  onClose: () => void;
  onLogged: (saved: LoggedContact, outcome: ContactOutcome) => void;
}) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [channel, setChannel] = useState<ContactChannel>("call");
  const [outcome, setOutcome] = useState<ContactOutcome | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [followUp, setFollowUp] = useState("");
  const hours = useMemo(() => salesHours(slaPolicies, timeZone), [slaPolicies, timeZone]);
  const [now] = useState(() => new Date());
  const suggestions = useMemo(() => quickFollowUps(hours, now), [hours, now]);

  const channels: Array<{ id: ContactChannel; label: string }> = [
    { id: "call", label: t("Call") }, { id: "whatsapp", label: t("WhatsApp") }, { id: "email", label: t("Email") }, { id: "meeting", label: t("Meeting") }, { id: "sms", label: t("SMS") },
  ];
  const outcomes: Array<{ id: ContactOutcome; label: string }> = [
    { id: "no_answer", label: t("No answer") },
    { id: "message_sent_no_reply", label: t("Message sent, no reply") },
    { id: "willing_to_talk", label: t("Willing to talk") },
    { id: "come_back_later", label: t("Come back later") },
    { id: "not_interested", label: t("Not interested") },
    // S-28: closes an enquiry the client never answered, reported apart from "not interested".
    { id: "unreachable", label: t("Unreachable") },
  ];
  const unanswered = outcome !== null && UNANSWERED_OUTCOMES.includes(outcome);
  const needsFollowUp = outcome === "come_back_later";
  const showFollowUp = outcome !== null && outcome !== "not_interested" && outcome !== "unreachable";
  const chipLabel = (id: (typeof suggestions)[number]["id"], at: Date) => {
    const when = deadlineText(at.toISOString(), { locale, timeZone }, now);
    return id === "two_hours" ? t("In 2 h · {when}", { when }) : id === "next_day" ? t("Next working day · {when}", { when }) : t("In 3 days · {when}", { when });
  };

  const choose = (next: ContactOutcome) => {
    setOutcome(next);
    // Suggest a next step where one is expected; the person can change or clear it.
    if (!followUp && UNANSWERED_OUTCOMES.includes(next) && next !== "unreachable") setFollowUp(wallClock(suggestions[0].at, timeZone));
    if (!followUp && next === "come_back_later") setFollowUp(wallClock(suggestions[1].at, timeZone));
  };

  const save = async () => {
    if (!outcome) throw new Error(t("Choose the outcome of this contact."));
    if (!unanswered && !note.trim()) throw new Error(t("Add a note about this contact."));
    if (outcome === "not_interested" && !reason.trim()) throw new Error(t("Add the reason the client is not interested."));
    const [date = "", time = ""] = followUp.split("T");
    const nextAt = showFollowUp && date && time ? zonedToUtc(date, time, timeZone) : null;
    if (needsFollowUp && (!nextAt || Date.parse(nextAt) <= Date.now())) throw new Error(t("Book a follow-up date in the future."));
    const saved = await logLeadContact(workspaceId, lead.id, {
      version: lead.version, channel, outcome, note: note.trim(),
      ...(outcome === "not_interested" ? { reason: reason.trim() } : {}),
      ...(nextAt ? { nextActionAt: nextAt } : {}),
    });
    onLogged(saved, outcome);
  };

  return <FormDialog description={lead.name} isDirty={Boolean(outcome || note.trim() || reason.trim())} onClose={onClose} onSubmit={save} submitLabel={t("Log contact")} title={t("Log contact")}>
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
      <TextAreaField errorMessage={t("Add a note about this contact.")} isRequired={!unanswered} label={t("Note")} maxLength={4000} onChange={setNote} placeholder={unanswered ? t("Noted as an attempt if you leave it empty") : t("What did you discuss?")} value={note} />
      {outcome === "not_interested" ? <TextInput errorMessage={t("Add the reason the client is not interested.")} isRequired label={t("Reason")} maxLength={160} onChange={setReason} value={reason} /> : null}
      {showFollowUp ? <div className={styles.group}>
        <div className="wd-quick-picks" role="group" aria-label={t("Suggested times")}>
          {suggestions.map(({ id, at }) => {
            const value = wallClock(at, timeZone);
            return <button key={id} type="button" className="wd-chip" aria-pressed={followUp === value} onClick={() => setFollowUp(value)}>{chipLabel(id, at)}</button>;
          })}
        </div>
        <CrmDateTimeField isRequired={needsFollowUp} label={needsFollowUp ? t("Come back on") : t("Next follow-up")} onChange={setFollowUp} value={followUp} />
      </div> : null}
    </div>
  </FormDialog>;
}
