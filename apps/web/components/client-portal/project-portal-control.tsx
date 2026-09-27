"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Checkbox, ControlledModalDialog, InlineNotice, Switch } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { staffPortalApi } from "@/lib/client-portal/client";
import type { PortalSection, ProjectPortal } from "@/lib/client-portal/types";
import { ClientContacts } from "./client-contacts";
import { usePortalLabels } from "./portal-labels";
import styles from "./staff.module.css";

/**
 * A project's place in the client portal: which of the workspace's sections this client sees, pausing it,
 * and who can sign in. Shown on the project's Updates.
 */
export function ProjectPortalControl({ workspaceId, projectId, locale }: { workspaceId: string; projectId: string; locale?: string }) {
  const t = useT();
  const labels = usePortalLabels();
  const api = useMemo(() => staffPortalApi(workspaceId), [workspaceId]);
  const [portal, setPortal] = useState<ProjectPortal | null>(null);
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<PortalSection[]>([]);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setPortal(await api.project(projectId)); } catch { setPortal(null); }
  }, [api, projectId]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (!portal) return null;
  const shown = portal.access.sections ?? portal.sections;
  const summary = !portal.enabled ? t("Off for the workspace") : portal.access.paused ? t("Paused") : shown.length ? shown.map((section) => labels.sections[section]).join(", ") : t("Nothing shared");
  const edit = () => { setSections(portal.access.sections ?? portal.sections); setPaused(portal.access.paused); setError(""); setOpen(true); };
  const save = async () => {
    setBusy(true); setError("");
    try {
      // Every workspace section chosen means "follow the workspace", so new sections appear for this client too.
      const all = portal.sections.every((section) => sections.includes(section));
      setPortal(await api.saveProject(projectId, { version: portal.access.version, sections: all ? null : sections, paused }));
      setOpen(false);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const contacts = portal.contacts.filter((contact) => contact.active).length;
  return <div className={styles.control}>
    <div className={styles.controlText}>
      <span className={styles.controlTitle}>{t("Client portal")}</span>
      <span className={styles.muted}>{summary} · {contacts === 1 ? t("1 contact") : t("{count} contacts", { count: contacts })}</span>
    </div>
    <Button size="compact" onPress={edit}>{portal.canManage ? t("Manage") : t("View")}</Button>
    {open ? <ControlledModalDialog isOpen onOpenChange={setOpen} size="lg" title={t("Client portal")}
      footer={portal.canManage ? <div className="wd-dialog-actions"><Button onPress={() => setOpen(false)}>{t("Cancel")}</Button>
        <Button variant="primary" isLoading={busy} onPress={() => void save()}>{t("Save")}</Button></div> : undefined}>
      <div className={styles.stack}>
        {error ? <InlineNotice tone="error" message={error} /> : null}
        <Switch isDisabled={!portal.canManage} isSelected={paused} onChange={setPaused}>{t("Pause for this project")}</Switch>
        <fieldset className={styles.sections} disabled={paused || !portal.canManage}>
          <legend>{t("This client sees")}</legend>
          {portal.sections.map((section) => <Checkbox key={section} isDisabled={paused || !portal.canManage} isSelected={sections.includes(section)}
            onChange={(on) => setSections((current) => (on ? [...current, section] : current.filter((item) => item !== section)))}>{labels.sections[section]}</Checkbox>)}
        </fieldset>
        <ClientContacts workspaceId={workspaceId} caseId={portal.caseId} portalSlug={null} portalEnabled={portal.enabled} locale={locale} onChanged={load} />
      </div>
    </ControlledModalDialog> : null}
  </div>;
}
