"use client";

import { useState } from "react";
import { Button, ControlledModalDialog, InlineNotice, SegmentedControl, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { QuoteColumn } from "@/lib/quotation/types";
import styles from "./quote-builder.module.css";

/** Adds one of the firm's own quote columns, or renames one. Every quote shows the firm's columns. */
export function ColumnDialog({ column, onClose, onSave }: { column?: QuoteColumn; onClose: () => void; onSave: (input: { name: string; kind: "text" | "number" }) => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState(column?.name ?? "");
  const [kind, setKind] = useState<"text" | "number">(column?.kind ?? "text");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await onSave({ name: name.trim().slice(0, 60), kind }); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
  };
  return <ControlledModalDialog isOpen size="md" title={column ? t("Rename column") : t("New column")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className={styles.formActions}><span className={styles.spacer} /><Button size="compact" onPress={onClose}>{t("Cancel")}</Button>
      <Button size="compact" variant="primary" isLoading={busy} isDisabled={!name.trim()} onPress={() => void save()}>{column ? t("Save") : t("Add column")}</Button></div>}>
    <form className={styles.dialogForm} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextInput autoFocus label={t("Name")} placeholder={t("e.g. Brand, Finish, Lead time")} value={name} onChange={setName} maxLength={60} />
      {column ? null : <SegmentedControl label={t("Type")} value={kind} onChange={(value) => setKind(value as "text" | "number")} options={[{ id: "text", label: t("Text") }, { id: "number", label: t("Number") }]} />}
    </form>
  </ControlledModalDialog>;
}
