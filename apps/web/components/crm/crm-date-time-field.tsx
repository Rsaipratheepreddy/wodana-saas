"use client";

import { parseDate, parseTime } from "@internationalized/date";
import { DateField, TimeField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./follow-up-editor.module.css";

export function CrmDateTimeField({ label, value = "", onChange, isRequired = false, isDisabled = false }: {
  label: string; value?: string; onChange: (value: string) => void; isRequired?: boolean; isDisabled?: boolean;
}) {
  const t = useT();
  const [date = "", time = ""] = value.split("T");
  return <div className={styles.dateFields}>
    <DateField label={t("{label} date", { label })} isRequired={isRequired} isDisabled={isDisabled} value={date ? parseDate(date) : null} onChange={next => onChange(`${next?.toString() ?? ""}T${time}`)} />
    <TimeField label={t("{label} time", { label })} isRequired={isRequired} isDisabled={isDisabled} granularity="minute" hourCycle={12} value={time ? parseTime(time) : null} onChange={next => onChange(`${date}T${next?.toString().slice(0, 5) ?? ""}`)} />
  </div>;
}
