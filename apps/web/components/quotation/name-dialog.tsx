"use client";

import { useState } from "react";
import { FormDialog, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";

/** Names something new (an area, a work package) without leaving the quote. */
export function NameDialog({ title, label, onClose, onSave }: { title: string; label: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState("");
  return <FormDialog size="md" title={title} onClose={onClose} isDirty={Boolean(name.trim())} isSubmitDisabled={!name.trim()} submitLabel={t("Add")} closeOnSuccess
    onSubmit={() => onSave(name.trim().slice(0, 120))}>
    <TextInput isRequired label={label} value={name} onChange={setName} maxLength={120} />
  </FormDialog>;
}
