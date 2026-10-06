"use client";

import { useState } from "react";
import { Button, Form, InlineNotice, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import styles from "../portal.module.css";

/** The client asks for a change in their own words; the team works out its price and time and sends it back to decide. */
export function ChangeForm({ caseId, api, onDone }: { caseId: string; api: PortalApi; onDone: () => void }) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const [changeId] = useState(commandId);
  const send = async () => {
    setBusy(true); setError("");
    try { await api.command(id, { action: "change_raise", caseId, id: changeId, title: title.trim(), description: description.trim() }); onDone(); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <TextInput label={t("What would you like to change?")} value={title} onChange={setTitle} maxLength={240} isRequired autoFocus />
    <TextAreaField label={t("Details")} value={description} onChange={setDescription} maxLength={4000} />
    <div className={styles.choices}><Button type="submit" variant="primary" isLoading={busy} isDisabled={!title.trim()}>{t("Send to your team")}</Button></div>
  </Form>;
}
