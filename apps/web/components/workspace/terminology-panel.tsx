"use client";

import { CheckCircle2, History, Pencil, RotateCcw } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Callout, ConfirmationDialog, ControlledModalDialog, InspectorSheet, TextInput, Skeleton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
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
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
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
      setError(t("Enter both the singular and plural names."));
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
      if (!response.ok) throw new Error(await responseMessage(response, t("The workspace language could not be saved.")));
      const saved = await response.json() as WorkspaceTerminologyItem;
      const next = {
        items: items.map((item) => item.key === saved.key ? saved : item),
        map: { ...(data?.map ?? {}), [saved.key]: { visibleName: saved.visibleName, visibleNamePlural: saved.visibleNamePlural } },
      };
      onChange(next);
      setEditing(null);
      setNotice(t("{name} language saved.", { name: saved.visibleName }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("The workspace language could not be saved."));
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
      if (!response.ok) throw new Error(await responseMessage(response, t("The workspace language could not be restored.")));
      const restored = await response.json() as WorkspaceTerminologyItem;
      onChange({
        items: items.map((item) => item.key === restored.key ? restored : item),
        map: { ...(data?.map ?? {}), [restored.key]: { visibleName: restored.visibleName, visibleNamePlural: restored.visibleNamePlural } },
      });
      setRestoreTarget(null);
      setNotice(t("{name} restored to the Wodana default.", { name: restored.defaultVisibleName }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("The workspace language could not be restored."));
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
      if (!response.ok) throw new Error(await responseMessage(response, t("Workspace language history could not be loaded.")));
      setRevisions(await response.json() as WorkspaceConfigurationRevision[]);
    } catch (failure) {
      setRevisions([]);
      setHistoryError(failure instanceof Error ? failure.message : t("Workspace language history could not be loaded."));
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
      if (!response.ok) throw new Error(await responseMessage(response, t("Workspace language could not be restored.")));
      const restored = await response.json() as WorkspaceTerminologyItem;
      onChange({
        items: items.map((item) => item.key === restored.key ? restored : item),
        map: { ...(data?.map ?? {}), [restored.key]: { visibleName: restored.visibleName, visibleNamePlural: restored.visibleNamePlural } },
      });
      setHistoryTarget(restored);
      setRollbackTarget(null);
      setNotice(t("{name} restored from history.", { name: restored.visibleName }));
      await loadHistory(restored);
    } catch (failure) {
      setHistoryError(failure instanceof Error ? failure.message : t("Workspace language could not be restored."));
      setRollbackTarget(null);
    } finally {
      setRollingBack(false);
    }
  };

  const revisionLabel = (revision: WorkspaceConfigurationRevision) => {
    const name = typeof revision.snapshot.visibleName === "string" ? revision.snapshot.visibleName : t("Wodana default");
    const plural = typeof revision.snapshot.visibleNamePlural === "string" ? revision.snapshot.visibleNamePlural : "";
    return plural && plural !== name ? `${name} / ${plural}` : name;
  };

  if (!data && !unavailable) return null;

  return <>
    <section aria-label={standalone ? t("Workspace terminology") : undefined} aria-labelledby={standalone ? undefined : "terminology-heading"} className={`${styles.detailSection} ${styles.terminologySection}`}>
      <header>
        <div>
          {standalone ? null : <><h2 id="terminology-heading">{t("Workspace language")}</h2><p className={styles.sectionHint}>{t("Use the words your team and clients already use. Existing records keep their data.")}</p></>}
        </div>
      </header>
      {unavailable ? <Callout title={t("Workspace language unavailable")} tone="warning">{t("Refresh this page to load terminology settings.")}</Callout> : null}
      {notice ? <p aria-live="polite" className={styles.organizationNotice}><CheckCircle2 aria-hidden="true" size={14} />{notice}</p> : null}
      {error ? <Callout title={t("Could not update workspace language")} tone="danger">{error}</Callout> : null}
      {data ? <ul aria-label={t("Workspace terminology")} className={styles.terminologyList}>
        {items.map((item) => <li key={item.key}>
          <div>
            <strong>{item.visibleName}</strong>
            <small>{item.visibleNamePlural} · {item.overridden ? t("standard: {name}", { name: itemLabel(item) }) : t("Wodana default")}</small>
          </div>
          <div className={styles.terminologyActions}>
            {item.overridden ? <Badge tone="neutral">{t("Custom")}</Badge> : null}
            {canManage ? <Button aria-label={t("Edit {name} language", { name: item.defaultVisibleName })} onPress={() => openEdit(item)} size="compact" variant="quiet"><Pencil aria-hidden="true" size={14} />{t("Edit")}</Button> : null}
          </div>
        </li>)}
      </ul> : null}
      {!canManage && data ? <p className={styles.permissionNote}>{t("Only workspace owners and administrators can change workspace language.")}</p> : null}
    </section>

    <ControlledModalDialog
      description={editing ? t("Choose how {name} appears across this workspace.", { name: itemLabel(editing) }) : undefined}
      footer={<div className="wd-dialog-actions">
        {editing ? <Button isDisabled={saving} onPress={() => void loadHistory(editing)} variant="quiet"><History aria-hidden="true" size={14} />{t("History")}</Button> : null}
        {editing?.overridden ? <Button isDisabled={saving} onPress={() => { setEditing(null); setRestoreTarget(editing); }} variant="quiet"><RotateCcw aria-hidden="true" size={14} />{t("Restore default")}</Button> : null}
        <span />
        <Button isDisabled={saving} onPress={() => setEditing(null)}>{t("Cancel")}</Button>
        <Button form="terminology-form" isLoading={saving} type="submit" variant="primary">{t("Save language")}</Button>
      </div>}
      isDismissable={!saving}
      isOpen={Boolean(editing)}
      onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}
      title={editing ? t("Edit {name}", { name: editing.defaultVisibleName }) : t("Edit workspace language")}
    >
      <form className={styles.terminologyForm} id="terminology-form" noValidate onSubmit={save}>
        {error ? <Callout title={t("Could not update workspace language")} tone="danger">{error}</Callout> : null}
        <TextInput description={t("Used when referring to one record.")} isRequired label={t("Singular")} onChange={(visibleName) => { setDraft((current) => current ? { ...current, visibleName } : current); setError(""); }} value={draft?.visibleName ?? ""} />
        <TextInput description={t("Used in navigation, lists, and counts.")} isRequired label={t("Plural")} onChange={(visibleNamePlural) => { setDraft((current) => current ? { ...current, visibleNamePlural } : current); setError(""); }} value={draft?.visibleNamePlural ?? ""} />
      </form>
    </ControlledModalDialog>

    <InspectorSheet
      description={historyTarget ? t("Review changes to {name}. Restoring a revision creates a new revision; it never erases history.", { name: itemLabel(historyTarget) }) : undefined}
      isOpen={Boolean(historyTarget)}
      onOpenChange={(open) => { if (!open && !rollingBack) setHistoryTarget(null); }}
      size="sm"
      title={historyTarget ? t("{name} history", { name: historyTarget.defaultVisibleName }) : t("Workspace language history")}
    >
      {historyLoading ? <Skeleton lines={3} /> : null}
      {historyError ? <Callout title={t("History unavailable")} tone="danger">{historyError}</Callout> : null}
      {!historyLoading && !historyError && !revisions.length ? <p className={styles.historyStatus}>{t("No changes have been saved yet.")}</p> : null}
      {revisions.length ? <ol className={styles.revisionList}>
        {revisions.map((revision) => {
          const current = items.find((item) => item.key === historyTarget?.key) ?? historyTarget;
          const isCurrent = current?.visibleName === revision.snapshot.visibleName
            && current?.visibleNamePlural === revision.snapshot.visibleNamePlural
            && current?.overridden === revision.snapshot.overridden;
          return <li key={revision.id}>
            <div className={styles.revisionHeading}>
              <strong>{revisionLabel(revision)}</strong>
              {isCurrent ? <Badge tone="neutral">{t("Current")}</Badge> : null}
            </div>
            <small>{t("Revision {number}", { number: revision.revisionNumber })} · {new Date(revision.createdAt).toLocaleString(locale, { timeZone })}</small>
            <p>{revision.changes.length ? (revision.changes.length === 1 ? t("1 changed field") : t("{count} changed fields", { count: revision.changes.length })) : t("No visible field changes")}</p>
            {canManage && !isCurrent ? <Button isDisabled={rollingBack} onPress={() => setRollbackTarget(revision)} size="compact" variant="quiet"><RotateCcw aria-hidden="true" size={14} />{t("Restore this revision")}</Button> : null}
          </li>;
        })}
      </ol> : null}
    </InspectorSheet>

    <ConfirmationDialog
      body={restoreTarget ? t("Restore {name} to the Wodana default? This changes the labels shown in this workspace.", { name: itemLabel(restoreTarget) }) : null}
      confirmLabel={restoring ? t("Restoring…") : t("Restore default")}
      isOpen={Boolean(restoreTarget)}
      onConfirm={() => void restore()}
      onOpenChange={(open) => { if (!open && !restoring) setRestoreTarget(null); }}
      title={t("Restore default language?")}
    />
    <ConfirmationDialog
      body={rollbackTarget ? t("Restore {name}? The current value stays in history and can be restored later.", { name: revisionLabel(rollbackTarget) }) : null}
      confirmLabel={rollingBack ? t("Restoring…") : t("Restore revision")}
      isOpen={Boolean(rollbackTarget)}
      onConfirm={() => void rollback()}
      onOpenChange={(open) => { if (!open && !rollingBack) setRollbackTarget(null); }}
      title={t("Restore this language revision?")}
    />
  </>;
}
