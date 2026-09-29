"use client";

import { useEffect, useState } from "react";
import { FolderInput } from "lucide-react";
import { Button, ControlledModalDialog, InlineNotice, SelectField, Skeleton } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "../crm-inbox.module.css";

type Target = { caseId: string; title: string; projectReference: string | null };

/**
 * Save to project (IN-18): a client's photo or PDF from the chat is filed into one of that client's projects (its
 * case files, where the project's own uploads are), so site photos sent at 11 pm reach the project.
 */
export function SaveToProject({ workspaceId, conversationId, attachmentId, name }: { workspaceId: string; conversationId: string; attachmentId: string; name: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [fileId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!open || targets) return;
    let alive = true;
    crmRequest<{ items: Target[] }>(workspaceId, `conversations/${conversationId}/save-targets`)
      .then((result) => { if (!alive) return; setTargets(result.items); if (result.items.length === 1) setCaseId(result.items[0].caseId); })
      .catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [open, targets, workspaceId, conversationId]);
  const save = async () => {
    if (!caseId) return;
    setBusy(true); setError("");
    try { await crmRequest(workspaceId, `conversations/${conversationId}/attachments/${attachmentId}/save`, "POST", { caseId, fileId }); setSaved(true); setOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  if (saved) return <small className={styles.savedToProject}>{t("Saved to the project")}</small>;
  return <>
    <Button size="compact" variant="quiet" onPress={() => setOpen(true)}><FolderInput aria-hidden="true" size={14} />{t("Save to project")}</Button>
    {open ? <ControlledModalDialog isOpen size="md" title={t("Save {name} to a project", { name })} onOpenChange={(next) => { if (!next && !busy) setOpen(false); }}
      footer={<div className="wd-dialog-actions"><Button isDisabled={busy} onPress={() => setOpen(false)}>{t("Cancel")}</Button>
        <Button variant="primary" isLoading={busy} isDisabled={!caseId} onPress={() => void save()}>{t("Save")}</Button></div>}>
      {!targets && !error ? <Skeleton lines={2} /> : null}
      {targets && !targets.length ? <InlineNotice tone="info" message={t("This client has no project yet. Convert their enquiry first.")} /> : null}
      {targets?.length ? <SelectField label={t("Project")} isRequired placeholder={t("Choose a project")} selectedKey={caseId} onSelectionChange={(key) => setCaseId(key ? String(key) : null)}
        items={targets.map((target) => ({ id: target.caseId, label: target.projectReference ? `${target.projectReference} · ${target.title}` : target.title }))} /> : null}
      {error ? <InlineNotice tone="error" message={error} /> : null}
    </ControlledModalDialog> : null}
  </>;
}
