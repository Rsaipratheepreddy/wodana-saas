"use client";

import { CheckCircle2, History, Pencil, RotateCcw } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Callout, ConfirmationDialog, ControlledModalDialog, InspectorSheet, TextInput, Skeleton } from "@/design-system";
import type { WorkspaceConfigurationRevision, WorkspaceTerminologyData, WorkspaceTerminologyItem } from "@/lib/workspace/company-profile";
import styles from "./company-profile.module.css";

type Draft = { visibleName: string; visibleNamePlural: string };

function asDraft(item: WorkspaceTerminologyItem): Draft {
  return { visibleName: item.visibleName, visibleNamePlural: item.visibleNamePlural };
}

function responseMessage(response: Response, fallback: string) {
  return response.json()
    .then((payload: { message?: string } | null) => payload?.message ?? fallback)
    .catch(() => fallback);
}

function itemLabel(item: WorkspaceTerminologyItem) {
  return item.defaultVisibleNamePlural === item.defaultVisibleName
    ? item.defaultVisibleName
    : `${item.defaultVisibleName} / ${item.defaultVisibleNamePlural}`;
}

export function TerminologyPanel({
  canManage,
  data,
  standalone = false,
  unavailable,
  workspaceId,
  onChange,
}: {
  canManage: boolean;
  data: WorkspaceTerminologyData | null;
  standalone?: boolean;
  unavailable?: boolean;
  workspaceId: string;
  onChange: (data: WorkspaceTerminologyData) => void;
}) {
  const [editing, setEditing] = useState<WorkspaceTerminologyItem | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<WorkspaceTerminologyItem | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<WorkspaceTerminologyItem | null>(null);
  const [revisions, setRevisions] = useState<WorkspaceConfigurationRevision[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [rollbackTarget, setRollbackTarget] = useState<WorkspaceConfigurationRevision | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const items = useMemo(() => data?.items ?? [], [data]);

  const openEdit = (item: WorkspaceTerminologyItem) => {
    setEditing(item);
    setDraft(asDraft(item));
    setError("");
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || !draft || saving) return;
    const visibleName = draft.visibleName.trim();
    const visibleNamePlural = draft.visibleNamePlural.trim();
    if (!visibleName || !visibleNamePlural) {
      setError("Enter both the singular and plural names.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/workspace/terminology/${editing.key}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, version: editing.version, visibleName, visibleNamePlural }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The workspace language could not be saved."));
      const saved = await response.json() as WorkspaceTerminologyItem;
      const next = {
        items: items.map((item) => item.key === saved.key ? saved : item),
        map: { ...(data?.map ?? {}), [saved.key]: { visibleName: saved.visibleName, visibleNamePlural: saved.visibleNamePlural } },
      };
      onChange(next);
      setEditing(null);
      setNotice(`${saved.visibleName} language saved.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The workspace language could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const restore = async () => {
    if (!restoreTarget || restoring) return;
    setRestoring(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/workspace/terminology/${restoreTarget.key}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, version: restoreTarget.version }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The workspace language could not be restored."));
      const restored = await response.json() as WorkspaceTerminologyItem;
      onChange({
        items: items.map((item) => item.key === restored.key ? restored : item),
        map: { ...(data?.map ?? {}), [restored.key]: { visibleName: restored.visibleName, visibleNamePlural: restored.visibleNamePlural } },
      });
      setRestoreTarget(null);
      setNotice(`${restored.defaultVisibleName} restored to the Wodana default.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The workspace language could not be restored.");
      setRestoreTarget(null);
    } finally {
      setRestoring(false);
    }
  };

  const loadHistory = async (item: WorkspaceTerminologyItem) => {
    setEditing(null);
    setHistoryTarget(item);
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetch(`/api/workspace/terminology/${item.key}/history?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (!response.ok) throw new Error(await responseMessage(response, "Workspace language history could not be loaded."));
      setRevisions(await response.json() as WorkspaceConfigurationRevision[]);
    } catch (failure) {
      setRevisions([]);
      setHistoryError(failure instanceof Error ? failure.message : "Workspace language history could not be loaded.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const rollback = async () => {
    if (!historyTarget || !rollbackTarget || rollingBack) return;
    setRollingBack(true);
    setHistoryError("");
    try {
      const current = items.find((item) => item.key === historyTarget.key) ?? historyTarget;
      const response = await fetch(`/api/workspace/terminology/${historyTarget.key}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, revisionId: rollbackTarget.id, version: current.version }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "Workspace language could not be restored."));
      const restored = await response.json() as WorkspaceTerminologyItem;
      onChange({
        items: items.map((item) => item.key === restored.key ? restored : item),
        map: { ...(data?.map ?? {}), [restored.key]: { visibleName: restored.visibleName, visibleNamePlural: restored.visibleNamePlural } },
      });
      setHistoryTarget(restored);
      setRollbackTarget(null);
      setNotice(`${restored.visibleName} restored from history.`);
      await loadHistory(restored);
    } catch (failure) {
      setHistoryError(failure instanceof Error ? failure.message : "Workspace language could not be restored.");
      setRollbackTarget(null);
    } finally {
      setRollingBack(false);
    }
  };

  const revisionLabel = (revision: WorkspaceConfigurationRevision) => {
    const name = typeof revision.snapshot.visibleName === "string" ? revision.snapshot.visibleName : "Wodana default";
    const plural = typeof revision.snapshot.visibleNamePlural === "string" ? revision.snapshot.visibleNamePlural : "";
    return plural && plural !== name ? `${name} / ${plural}` : name;
  };

  if (!data && !unavailable) return null;

  return <>
    <section aria-label={standalone ? "Workspace terminology" : undefined} aria-labelledby={standalone ? undefined : "terminology-heading"} className={`${styles.detailSection} ${styles.terminologySection}`}>
      <header>
        <div>
          {standalone ? null : <><h2 id="terminology-heading">Workspace language</h2><p className={styles.sectionHint}>Use the words your team and clients already use. Existing records keep their data.</p></>}
        </div>
      </header>
      {unavailable ? <Callout title="Workspace language unavailable" tone="warning">Refresh this page to load terminology settings.</Callout> : null}
      {notice ? <p aria-live="polite" className={styles.organizationNotice}><CheckCircle2 aria-hidden="true" size={14} />{notice}</p> : null}
      {error ? <Callout title="Could not update workspace language" tone="danger">{error}</Callout> : null}
      {data ? <ul aria-label="Workspace terminology" className={styles.terminologyList}>
        {items.map((item) => <li key={item.key}>
          <div>
            <strong>{item.visibleName}</strong>
            <small>{item.visibleNamePlural} · {item.overridden ? `standard: ${itemLabel(item)}` : "Wodana default"}</small>
          </div>
          <div className={styles.terminologyActions}>
            {item.overridden ? <Badge tone="neutral">Custom</Badge> : null}
            {canManage ? <Button aria-label={`Edit ${item.defaultVisibleName} language`} onPress={() => openEdit(item)} size="compact" variant="quiet"><Pencil aria-hidden="true" size={14} />Edit</Button> : null}
          </div>
        </li>)}
      </ul> : null}
      {!canManage && data ? <p className={styles.permissionNote}>Only workspace owners and administrators can change workspace language.</p> : null}
    </section>

    <ControlledModalDialog
      description={editing ? `Choose how ${itemLabel(editing)} appears across this workspace.` : undefined}
      footer={<div className="wd-dialog-actions">
        {editing ? <Button isDisabled={saving} onPress={() => void loadHistory(editing)} variant="quiet"><History aria-hidden="true" size={14} />History</Button> : null}
        {editing?.overridden ? <Button isDisabled={saving} onPress={() => { setEditing(null); setRestoreTarget(editing); }} variant="quiet"><RotateCcw aria-hidden="true" size={14} />Restore default</Button> : null}
        <span />
        <Button isDisabled={saving} onPress={() => setEditing(null)}>Cancel</Button>
        <Button form="terminology-form" isLoading={saving} type="submit" variant="primary">Save language</Button>
      </div>}
      isDismissable={!saving}
      isOpen={Boolean(editing)}
      onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}
      title={editing ? `Edit ${editing.defaultVisibleName}` : "Edit workspace language"}
    >
      <form className={styles.terminologyForm} id="terminology-form" noValidate onSubmit={save}>
        {error ? <Callout title="Could not update workspace language" tone="danger">{error}</Callout> : null}
        <TextInput description="Used when referring to one record." isRequired label="Singular" onChange={(visibleName) => { setDraft((current) => current ? { ...current, visibleName } : current); setError(""); }} value={draft?.visibleName ?? ""} />
        <TextInput description="Used in navigation, lists, and counts." isRequired label="Plural" onChange={(visibleNamePlural) => { setDraft((current) => current ? { ...current, visibleNamePlural } : current); setError(""); }} value={draft?.visibleNamePlural ?? ""} />
      </form>
    </ControlledModalDialog>

    <InspectorSheet
      description={historyTarget ? `Review changes to ${itemLabel(historyTarget)}. Restoring a revision creates a new revision; it never erases history.` : undefined}
      isOpen={Boolean(historyTarget)}
      onOpenChange={(open) => { if (!open && !rollingBack) setHistoryTarget(null); }}
      size="sm"
      title={historyTarget ? `${historyTarget.defaultVisibleName} history` : "Workspace language history"}
    >
      {historyLoading ? <Skeleton lines={3} /> : null}
      {historyError ? <Callout title="History unavailable" tone="danger">{historyError}</Callout> : null}
      {!historyLoading && !historyError && !revisions.length ? <p className={styles.historyStatus}>No changes have been saved yet.</p> : null}
      {revisions.length ? <ol className={styles.revisionList}>
        {revisions.map((revision) => {
          const current = items.find((item) => item.key === historyTarget?.key) ?? historyTarget;
          const isCurrent = current?.visibleName === revision.snapshot.visibleName
            && current?.visibleNamePlural === revision.snapshot.visibleNamePlural
            && current?.overridden === revision.snapshot.overridden;
          return <li key={revision.id}>
            <div className={styles.revisionHeading}>
              <strong>{revisionLabel(revision)}</strong>
              {isCurrent ? <Badge tone="neutral">Current</Badge> : null}
            </div>
            <small>Revision {revision.revisionNumber} · {new Date(revision.createdAt).toLocaleString()}</small>
            <p>{revision.changes.length ? `${revision.changes.length} changed ${revision.changes.length === 1 ? "field" : "fields"}` : "No visible field changes"}</p>
            {canManage && !isCurrent ? <Button isDisabled={rollingBack} onPress={() => setRollbackTarget(revision)} size="compact" variant="quiet"><RotateCcw aria-hidden="true" size={14} />Restore this revision</Button> : null}
          </li>;
        })}
      </ol> : null}
    </InspectorSheet>

    <ConfirmationDialog
      body={restoreTarget ? <>Restore <strong>{itemLabel(restoreTarget)}</strong> to the Wodana default? This changes the labels shown in this workspace.</> : null}
      confirmLabel={restoring ? "Restoring…" : "Restore default"}
      isOpen={Boolean(restoreTarget)}
      onConfirm={() => void restore()}
      onOpenChange={(open) => { if (!open && !restoring) setRestoreTarget(null); }}
      title="Restore default language?"
    />
    <ConfirmationDialog
      body={rollbackTarget ? <>Restore <strong>{revisionLabel(rollbackTarget)}</strong>? The current value stays in history and can be restored later.</> : null}
      confirmLabel={rollingBack ? "Restoring…" : "Restore revision"}
      isOpen={Boolean(rollbackTarget)}
      onConfirm={() => void rollback()}
      onOpenChange={(open) => { if (!open && !rollingBack) setRollbackTarget(null); }}
      title="Restore this language revision?"
    />
  </>;
}
