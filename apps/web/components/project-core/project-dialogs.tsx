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

/** PLM-068: the day the factory has the project, with a short note (a line, a shift). */
export function FactorySlotDialog({ slot, onClose, onSave }: { slot: { date: string; note: string } | null; onClose: () => void; onSave: (date: string, note: string) => Promise<void> }) {
  const t = useT();
  const [date, setDate] = useState(slot?.date ?? "");
  const [note, setNote] = useState(slot?.note ?? "");
  return <FormDialog size="md" title={t("Factory slot")} onClose={onClose} isDirty={date !== (slot?.date ?? "") || note !== (slot?.note ?? "")} isSubmitDisabled={!date}
    submitLabel={t("Save")} onSubmit={() => onSave(date, note.trim())}>
    <DateField label={t("Slot date")} isRequired value={date ? parseDate(date) : null} onChange={(value) => setDate(value ? value.toString() : "")} />
    <TextAreaField label={t("Note")} maxLength={500} value={note} onChange={setNote} />
  </FormDialog>;
}

/** PLM-069: the delivery day booked and the installation day, with a short note (the crane, the access, the crew). */
export function InstallationDialog({ current, onClose, onSave }: { current: { deliveryOn: string | null; installationOn: string | null; note: string } | null; onClose: () => void;
  onSave: (deliveryOn: string | null, installationOn: string, note: string) => Promise<void> }) {
  const t = useT();
  const [delivery, setDelivery] = useState(current?.deliveryOn ?? null);
  const [installation, setInstallation] = useState(current?.installationOn ?? "");
  const [note, setNote] = useState(current?.note ?? "");
  const valid = !delivery || !installation || delivery <= installation;
  return <FormDialog size="md" title={t("Delivery and installation")} onClose={onClose}
    isDirty={delivery !== (current?.deliveryOn ?? null) || installation !== (current?.installationOn ?? "") || note !== (current?.note ?? "")}
    isSubmitDisabled={!installation || !valid} submitLabel={t("Save")} onSubmit={() => onSave(delivery, installation, note.trim())}>
    <FormRow>
      <DateField label={t("Delivery day")} maxValue={installation ? parseDate(installation) : undefined} value={delivery ? parseDate(delivery) : null}
        onChange={(value) => setDelivery(value ? value.toString() : null)} isInvalid={!valid} errorMessage={valid ? undefined : t("Delivery can't be after the installation day.")} />
      <DateField label={t("Installation day")} isRequired value={installation ? parseDate(installation) : null} onChange={(value) => setInstallation(value ? value.toString() : "")} />
    </FormRow>
    <TextAreaField label={t("Note")} maxLength={500} value={note} onChange={setNote} />
  </FormDialog>;
}
