"use client";

import { useState } from "react";
import { Button, Form, InlineNotice, SelectField, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalProject } from "@/lib/client-portal/types";
import styles from "../portal.module.css";

/** Reporting a problem under warranty: where, which item (if they know) and what's wrong. */
export function ClaimForm({ project, api, onDone }: { project: PortalProject; api: PortalApi; onDone: () => void }) {
  const t = useT();
  const warranty = project.warranty!;
  const [areaId, setAreaId] = useState("");
  const [lineId, setLineId] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const lines = warranty.lines.filter((line) => !areaId || line.areaId === areaId);
  const send = async () => {
    if (!description.trim()) return setError(t("Say what's wrong."));
    setBusy(true); setError("");
    try { await api.command(id, { action: "warranty_claim", caseId: project.id, description: description.trim(), areaId: areaId || undefined, lineId: lineId || undefined }); onDone(); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {warranty.areas.length ? <SelectField label={t("Where")} placeholder={t("Anywhere")} selectedKey={areaId || null}
      onSelectionChange={(key) => { setAreaId(key ? String(key) : ""); setLineId(""); }} items={warranty.areas.map((area) => ({ id: area.id, label: area.name }))} /> : null}
    {lines.length ? <SelectField label={t("Which item (optional)")} placeholder={t("I'm not sure")} selectedKey={lineId || null}
      onSelectionChange={(key) => setLineId(key ? String(key) : "")} items={lines.map((line) => ({ id: line.id, label: line.title }))} /> : null}
    <TextAreaField label={t("What's wrong?")} value={description} onChange={setDescription} maxLength={2000} isRequired autoFocus />
    <div className={styles.choices}><Button type="submit" variant="primary" isLoading={busy}>{t("Send report")}</Button></div>
  </Form>;
}
