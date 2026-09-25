"use client";

import { parseDate, parseTime } from "@internationalized/date";
import { DateField, TimeField } from "@/design-system";
import styles from "./follow-up-editor.module.css";

export function CrmDateTimeField({ label, value = "", onChange, isRequired = false, isDisabled = false }: {
  label: string; value?: string; onChange: (value: string) => void; isRequired?: boolean; isDisabled?: boolean;
}) {
  const [date = "", time = ""] = value.split("T");
  return <div className={styles.dateFields}>
    <DateField label={`${label} date`} isRequired={isRequired} isDisabled={isDisabled} value={date ? parseDate(date) : null} onChange={next => onChange(`${next?.toString() ?? ""}T${time}`)} />
    <TimeField label={`${label} time`} isRequired={isRequired} isDisabled={isDisabled} granularity="minute" hourCycle={12} value={time ? parseTime(time) : null} onChange={next => onChange(`${date}T${next?.toString().slice(0, 5) ?? ""}`)} />
  </div>;
}
