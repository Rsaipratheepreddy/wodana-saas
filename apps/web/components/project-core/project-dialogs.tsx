"use client";

import { useState } from "react";
import { parseDate } from "@internationalized/date";
import { Checkbox, DateField, FormDialog, FormRow, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./project-core.module.css";

/** On hold, with why and when to look at it again. */
export function HoldDialog({ onClose, onSave }: { onClose: () => void; onSave: (reason: string, reviewOn: string | null) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [reviewOn, setReviewOn] = useState<string | null>(null);
  return <FormDialog size="md" title={t("Put on hold")} onClose={onClose} isDirty={Boolean(reason.trim())} isSubmitDisabled={!reason.trim()} submitLabel={t("Put on hold")}
    onSubmit={() => onSave(reason.trim(), reviewOn)}>
    <TextAreaField label={t("Why")} isRequired value={reason} onChange={setReason} />
    <DateField label={t("Review on")} value={reviewOn ? parseDate(reviewOn) : null} onChange={(value) => setReviewOn(value ? value.toString() : null)} />
  </FormDialog>;
}

/** Resuming: optionally move open work and the handover date later by the working days lost on hold. */
export function ResumeDialog({ hold, onClose, onSave }: { hold: { days: number; workingDays: number } | null; onClose: () => void; onSave: (shiftDates: boolean) => Promise<void> }) {
  const t = useT();
  const lost = hold?.workingDays ?? 0;
  const [shift, setShift] = useState(lost > 0);
  return <FormDialog size="md" title={t("Resume the project")} onClose={onClose} submitLabel={t("Resume")} onSubmit={() => onSave(shift && lost > 0)}>
    <p className={styles.dialogText}>{hold ? t("On hold for {days} days ({working} working days).", { days: hold.days, working: lost }) : t("On hold since today.")}</p>
    {lost > 0 ? <Checkbox isSelected={shift} onChange={setShift}>{t("Move open work and the handover date {count} working days later", { count: lost })}</Checkbox> : null}
  </FormDialog>;
}

/** The start and handover dates. */
export function DatesDialog({ startDate, promiseDate, onClose, onSave }: { startDate: string | null; promiseDate: string | null; onClose: () => void; onSave: (start: string | null, promise: string | null) => Promise<void> }) {
  const t = useT();
  const [start, setStart] = useState(startDate);
  const [promise, setPromise] = useState(promiseDate);
  const valid = !start || !promise || promise >= start;
  return <FormDialog size="md" title={t("Dates")} onClose={onClose} isDirty={start !== startDate || promise !== promiseDate} isSubmitDisabled={!valid} submitLabel={t("Save")}
    onSubmit={() => onSave(start, promise)}>
    <FormRow>
      <DateField label={t("Start date")} value={start ? parseDate(start) : null} onChange={(value) => setStart(value ? value.toString() : null)} />
      <DateField label={t("Handover date")} minValue={start ? parseDate(start) : undefined} value={promise ? parseDate(promise) : null} onChange={(value) => setPromise(value ? value.toString() : null)}
        isInvalid={!valid} errorMessage={valid ? undefined : t("The handover date can't be before the start date.")} />
    </FormRow>
  </FormDialog>;
}
