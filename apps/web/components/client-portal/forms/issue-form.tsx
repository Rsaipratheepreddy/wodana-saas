"use client";

import { useState } from "react";
import { Button, Form, InlineNotice, SelectField, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalProject } from "@/lib/client-portal/types";
import styles from "../portal.module.css";
import { AttachFiles } from "./attach-files";

/** Something wrong while the work is on (a chipped panel): a photo, where it is and what's wrong. The project manager takes it from there. */
export function IssueForm({ project, api, onDone }: { project: PortalProject; api: PortalApi; onDone: () => void }) {
  const t = useT();
  const [areaId, setAreaId] = useState("");
  const [description, setDescription] = useState("");
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const send = async () => {
    setBusy(true); setError("");
    try { await api.command(id, { action: "report_issue", caseId: project.id, description: description.trim(), areaId: areaId || undefined, uploadIds: uploads }); onDone(); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <AttachFiles caseId={project.id} api={api} onChange={setUploads} onBusy={setUploading} photosOnly max={6} />
    {project.rooms.length ? <SelectField label={t("Where")} placeholder={t("Anywhere")} selectedKey={areaId || null} onSelectionChange={(key) => setAreaId(key ? String(key) : "")}
      items={project.rooms.map((room) => ({ id: room.id, label: room.name }))} /> : null}
    <TextAreaField label={t("What's wrong?")} value={description} onChange={setDescription} maxLength={2000} isRequired autoFocus />
    <div className={styles.choices}><Button type="submit" variant="primary" isLoading={busy} isDisabled={!description.trim() || uploading}>{t("Send report")}</Button></div>
  </Form>;
}
