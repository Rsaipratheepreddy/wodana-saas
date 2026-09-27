"use client";

import { useState } from "react";
import { Button, ControlledModalDialog, InlineNotice, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./quote-builder.module.css";

/** Names something new (an area, a work package) without leaving the quote. */
export function NameDialog({ title, label, onClose, onSave }: { title: string; label: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    const value = name.trim().slice(0, 120);
    if (!value || busy) return;
    setBusy(true);
    try { await onSave(value); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
  };
  return <ControlledModalDialog isOpen size="md" title={title} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className={styles.formActions}><span className={styles.spacer} /><Button size="compact" onPress={onClose}>{t("Cancel")}</Button>
      <Button size="compact" variant="primary" isLoading={busy} isDisabled={!name.trim()} onPress={() => void save()}>{t("Add")}</Button></div>}>
    <form className={styles.dialogForm} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextInput autoFocus label={label} value={name} onChange={setName} maxLength={120} />
    </form>
  </ControlledModalDialog>;
}
