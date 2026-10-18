"use client";

import { useState } from "react";
import { FormDialog, SegmentedControl, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { QuoteColumn } from "@/lib/quotation/types";

/** Adds one of the firm's own quote columns, or renames one. Every quote shows the firm's columns. */
export function ColumnDialog({ column, onClose, onSave }: { column?: QuoteColumn; onClose: () => void; onSave: (input: { name: string; kind: "text" | "number" }) => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState(column?.name ?? "");
  const [kind, setKind] = useState<"text" | "number">(column?.kind ?? "text");
  return <FormDialog size="md" title={column ? t("Rename column") : t("New column")} onClose={onClose} closeOnSuccess
    isDirty={name.trim() !== (column?.name ?? "")} isSubmitDisabled={!name.trim()} submitLabel={column ? t("Save") : t("Add column")}
    onSubmit={() => onSave({ name: name.trim().slice(0, 60), kind })}>
    <TextInput isRequired label={t("Name")} placeholder={t("e.g. Brand, Finish, Lead time")} value={name} onChange={setName} maxLength={60} />
    {column ? null : <SegmentedControl label={t("Type")} value={kind} onChange={(value) => setKind(value as "text" | "number")} options={[{ id: "text", label: t("Text") }, { id: "number", label: t("Number") }]} />}
  </FormDialog>;
}
