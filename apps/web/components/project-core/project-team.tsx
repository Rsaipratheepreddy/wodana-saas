"use client";

import { useState } from "react";
import { Avatar, Button, SelectField, InspectorSheet, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ProjectDetail } from "@/lib/project-core/types";
import styles from "./project-core.module.css";

type Run = (action: string, input?: Record<string, unknown>, options?: { inDialog?: boolean }) => Promise<boolean>;
const NOBODY = "__nobody";
const NOT_APPLICABLE = "__not_applicable";

/**
 * One named person per role, or "Not applicable" for this project. The project manager leads; the firm's role list
 * lives in Settings → Projects. The team carries over from the enquiry and the opportunity when the project starts.
 * A note names the people outside Wodana who do the work (installers, subcontractors).
 */
export function ProjectTeam({ detail, run, onClose }: { detail: ProjectDetail; run: Run; onClose: () => void }) {
  const t = useT();
  const [saving, setSaving] = useState<string | null>(null);
  const [note, setNote] = useState(detail.teamNote ?? "");
  const options = [{ id: NOBODY, label: t("Nobody") }, { id: NOT_APPLICABLE, label: t("Not applicable") },
    ...detail.members.map((member) => ({ id: member.membershipId, label: member.name }))];
  const noteChanged = note.trim() !== (detail.teamNote ?? "");
  return <InspectorSheet isOpen title={t("Team")} onOpenChange={(open) => { if (!open) onClose(); }} size="sm">
    <div className={styles.sheetBody}>
      <ul className={styles.team}>
        {detail.team.map((role) => <li key={role.role}>
          {detail.canManage
            ? <SelectField label={t(role.label as never)} isDisabled={saving === role.role}
                selectedKey={role.member?.membershipId ?? (role.notApplicable ? NOT_APPLICABLE : NOBODY)}
                onSelectionChange={async (key) => {
                  const chosen = String(key);
                  const current = role.member?.membershipId ?? (role.notApplicable ? NOT_APPLICABLE : NOBODY);
                  if (chosen === current) return;
                  setSaving(role.role);
                  await run("set_member", chosen === NOT_APPLICABLE ? { role: role.role, notApplicable: true } : { role: role.role, membershipId: chosen === NOBODY ? null : chosen });
                  setSaving(null);
                }}
                items={role.role === "project_manager" ? options.filter((option) => option.id !== NOBODY && option.id !== NOT_APPLICABLE) : options} />
            : <div className={styles.teamRow}>
                <span className={styles.teamRole}>{t(role.label as never)}</span>
                {role.member ? <span className={styles.teamPerson}><Avatar name={role.member.name} seed={role.member.name} size="sm" />{role.member.name}</span>
                  : <span className={styles.muted}>{role.notApplicable ? t("Not applicable") : t("Not named")}</span>}
              </div>}
        </li>)}
      </ul>
      {detail.canManage
        ? <div className={styles.sheetBody}>
            <TextAreaField label={t("External people")} value={note} onChange={setNote} maxLength={1000} />
            {noteChanged ? <div className="wd-dialog-actions">
              <Button size="compact" variant="primary" isLoading={saving === "note"}
                onPress={async () => { setSaving("note"); await run("set_team_note", { note: note.trim() }); setSaving(null); }}>{t("Save")}</Button>
            </div> : null}
          </div>
        : detail.teamNote ? <div className={styles.teamRow}><span className={styles.teamRole}>{t("External people")}</span><span dir="auto">{detail.teamNote}</span></div> : null}
    </div>
  </InspectorSheet>;
}
