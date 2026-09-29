"use client";

import { useState } from "react";
import { Button, Form, InlineNotice, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalProject } from "@/lib/client-portal/types";
import styles from "../portal.module.css";
import { AttachFiles } from "./attach-files";

/** A question about one of the team's days: it reaches the project manager, and the answer comes back under Messages. */
export function QuestionForm({ project, reportId, api, onDone }: { project: PortalProject; reportId: string; api: PortalApi; onDone: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const send = async () => {
    setBusy(true); setError("");
    try { await api.command(id, { action: "progress_question", caseId: project.id, reportId, text: text.trim(), uploadIds: uploads }); onDone(); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <TextAreaField label={t("Your question")} value={text} onChange={setText} maxLength={2000} isRequired autoFocus />
    <AttachFiles caseId={project.id} api={api} onChange={setUploads} onBusy={setUploading} photosOnly max={4} />
    <div className={styles.choices}><Button type="submit" variant="primary" isLoading={busy} isDisabled={!text.trim() || uploading}>{t("Send question")}</Button></div>
  </Form>;
}
