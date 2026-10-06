"use client";

import { useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { UserPlus } from "lucide-react";
import { Button, ComboboxField, DateField, FileUploader, FormDialog, FormRow, MoreDetails, SelectField, Skeleton, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import { calendarDayKey } from "@/lib/crm/calendar";
import { atWallClock } from "@/lib/crm/zoned-time";
import { useT } from "@/lib/i18n/i18n-provider";
import { logisticsApi } from "@/lib/logistics/client";
import type { LogisticsOptions, PermitOwner, PermitsState, Worker } from "@/lib/logistics/types";
import { AddPersonDialog } from "./booking-dialog";

/**
 * Records the building permit collected (PLM-136: buildings can't be entered without one), on a project or a deal (it
 * shows on both): its type, reference, the days it's valid, the file, when and by whom it was collected. A planned
 * collection becomes the permit.
 */
export function RecordPermitDialog({ workspaceId, owner, permitId, today: todayProp, onClose, onSaved }: {
  workspaceId: string; owner: PermitOwner;
  /** The planned collection this records, when there is one. */
  permitId?: string | null;
  /** The workspace's day; its wall clock when left out. */
  today?: string; onClose: () => void; onSaved: (state: PermitsState) => void;
}) {
  const t = useT();
  const { timeZone } = useDesignSystem();
  const [today] = useState(() => todayProp ?? calendarDayKey(atWallClock(new Date(), timeZone)));
  const api = useMemo(() => logisticsApi(workspaceId), [workspaceId]);
  const [id] = useState(() => permitId ?? crypto.randomUUID());
  const [options, setOptions] = useState<LogisticsOptions | null>(null);
  const [failure, setFailure] = useState("");
  const [type, setType] = useState("");
  const [number, setNumber] = useState("");
  const [validFrom, setValidFrom] = useState<string | null>(today);
  const [validTo, setValidTo] = useState<string | null>(null);
  const [collectedOn, setCollectedOn] = useState<string | null>(today);
  const [collectedBy, setCollectedBy] = useState("none");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api.options(controller.signal).then(setOptions).catch((cause: Error) => { if (!controller.signal.aborted) setFailure(cause.message); });
    return () => controller.abort();
  }, [api]);
  const valid = Boolean(number.trim() && validFrom && validTo && validFrom <= validTo && file);
  return <>
    <FormDialog size="md" title={t("Record the building permit")} submitLabel={t("Save")} error={failure || undefined} onClose={onClose} isDirty={Boolean(number || file || note)}
      isSubmitDisabled={!valid} lead={!options && !failure ? <Skeleton lines={4} shape="form" /> : null}
      onSubmit={async () => {
        onSaved(await api.collectPermit(owner, id, { permitType: type.trim(), permitNumber: number.trim(), validFrom: validFrom!, validTo: validTo!, collectedOn: collectedOn ?? "",
          collectedByWorkerId: collectedBy === "none" ? "" : collectedBy, note: note.trim() }, file!));
      }}>
      <FormRow>
        <ComboboxField label={t("Permit type")} allowsCustomValue inputValue={type} onInputChange={setType} items={(options?.permitTypes ?? []).map((item) => ({ id: item, label: item }))}
          onSelectionChange={(key) => { if (key) setType(String(key)); }} placeholder={t("Building access, delivery…")} />
        <TextInput isRequired label={t("Permit reference")} value={number} onChange={setNumber} maxLength={80} />
      </FormRow>
      <FormRow>
        <DateField isRequired label={t("Valid from")} value={validFrom ? parseDate(validFrom) : null} onChange={(value) => setValidFrom(value ? value.toString() : null)} />
        <DateField isRequired label={t("Valid to")} minValue={validFrom ? parseDate(validFrom) : undefined} value={validTo ? parseDate(validTo) : null}
          onChange={(value) => setValidTo(value ? value.toString() : null)} />
      </FormRow>
      <FileUploader accept="application/pdf,image/*" appearance="button" multiple={false} label={file ? file.name : t("Attach the permit")} onFiles={(files) => setFile(files[0] ?? null)} />
      <FormRow>
        <DateField label={t("Collected on")} maxValue={parseDate(today)} value={collectedOn ? parseDate(collectedOn) : null} onChange={(value) => setCollectedOn(value ? value.toString() : null)} />
        <SelectField label={t("Collected by")} selectedKey={collectedBy} onSelectionChange={(key) => setCollectedBy(String(key ?? "none"))}
          items={[{ id: "none", label: t("Not recorded") }, ...(options?.workers ?? []).map((worker) => ({ id: worker.id, label: worker.name, description: worker.trade }))]} />
      </FormRow>
      {options?.canAddPeople ? <div><Button size="compact" variant="quiet" onPress={() => setAdding(true)}><UserPlus aria-hidden="true" size={14} />{t("Add person")}</Button></div> : null}
      <MoreDetails filled={note.trim() ? 1 : 0}><TextAreaField label={t("Note")} maxLength={500} value={note} onChange={setNote} /></MoreDetails>
    </FormDialog>
    {adding ? <AddPersonDialog workspaceId={workspaceId} trade={t("Installer")} crews={options?.crews ?? []} onClose={() => setAdding(false)}
      onSaved={(worker: Worker) => { setOptions((value) => (value ? { ...value, workers: [...value.workers, worker] } : value)); setCollectedBy(worker.id); setAdding(false); }} /> : null}
  </>;
}
