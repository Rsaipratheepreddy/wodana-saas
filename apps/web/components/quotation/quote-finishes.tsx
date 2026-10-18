"use client";

import { useState } from "react";
import { FormDialog, SelectField, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { BuilderLine, QuoteFinishes } from "@/lib/quotation/types";

const NONE = "__none";

/**
 * PLM-146: QS prices a line from the designer's specification: the finish it is for (its material column takes the
 * designer's words), or no finish.
 */
export function FinishPicker({ line, finishes, onClose, onPick }: { line: BuilderLine; finishes: QuoteFinishes; onClose: () => void; onPick: (entryId: string | null) => void }) {
  const t = useT();
  const linked = finishes.links.find((link) => link.lineId === line.id)?.entryId ?? null;
  const [choice, setChoice] = useState(linked ?? NONE);
  const items = [{ id: NONE, label: t("No finish") }, ...finishes.entries.map((entry) => ({ id: entry.id, label: entry.title,
    description: [entry.roomName, entry.categoryLabel, entry.specification].filter(Boolean).join(" · ") }))];
  return <FormDialog title={t("Price {name} from a finish", { name: line.title })} onClose={onClose} isDirty={choice !== (linked ?? NONE)} submitLabel={t("Save")}
    onSubmit={() => onPick(choice === NONE ? null : choice)}>
    <SelectField label={t("Finish")} items={items} selectedKey={choice} onSelectionChange={(key) => setChoice(String(key))} />
  </FormDialog>;
}

/** PLM-146: a budget range is given only when the client asks: say how they asked. */
export function BudgetRangeDialog({ onClose, onSave }: { onClose: () => void; onSave: (note: string) => Promise<unknown> }) {
  const t = useT();
  const [note, setNote] = useState("");
  return <FormDialog title={t("Mark as a budget range")} onClose={onClose} isDirty={Boolean(note.trim())} submitLabel={t("Save")} isSubmitDisabled={!note.trim()} onSubmit={() => onSave(note.trim())}>
    <TextAreaField isRequired label={t("How the client asked for it")} maxLength={1000} value={note} onChange={setNote} />
  </FormDialog>;
}
