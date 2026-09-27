"use client";

import { useState } from "react";
import { Button, InlineNotice, RadioSet, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalQuestion } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import styles from "../portal.module.css";

/** A question the team asked, with the answers they offered; answered once. */
export function QuestionSheet({ question, caseId, api, format, onDecided }: {
  question: PortalQuestion; caseId: string; api: PortalApi; format: PortalFormat; onDecided: () => void;
}) {
  const t = useT();
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const send = async () => {
    setBusy(true); setError("");
    try { await api.command(id, { action: "request_answer", caseId, requestId: question.id, choiceId: choice, note: note.trim() }); onDecided(); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <div className={styles.sheet}>
    {question.detail ? <p className={styles.body}>{question.detail}</p> : null}
    <p className={styles.muted}>{[question.target, question.dueDate ? t("Please answer by {date}", { date: format.date(question.dueDate) }) : ""].filter(Boolean).join(" · ")}</p>
    {question.decision ? <p className={styles.body}><strong>{question.decision.choiceLabel}</strong>{question.decision.note ? ` · ${question.decision.note}` : ""}</p> : null}
    {question.canDecide ? <>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <RadioSet label={t("Your answer")} value={choice} onChange={setChoice} items={question.choices.map((item) => ({ id: item.id, label: item.label }))} isRequired />
      <TextAreaField label={t("Anything to add? (optional)")} value={note} onChange={setNote} maxLength={6000} />
      <div className={styles.choices}><Button variant="primary" isDisabled={!choice} isLoading={busy} onPress={() => void send()}>{t("Send")}</Button></div>
    </> : null}
  </div>;
}
