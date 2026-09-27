"use client";

import { useState } from "react";
import { Avatar, SelectField, InspectorSheet } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ProjectDetail } from "@/lib/project-core/types";
import styles from "./project-core.module.css";

type Run = (action: string, input?: Record<string, unknown>) => Promise<boolean>;
const NOBODY = "__nobody";

/** One named person per role. The project manager leads; the firm's role list lives in Settings → Projects. */
export function ProjectTeam({ detail, run, onClose }: { detail: ProjectDetail; run: Run; onClose: () => void }) {
  const t = useT();
  const [saving, setSaving] = useState<string | null>(null);
  const options = [{ id: NOBODY, label: t("Nobody") }, ...detail.members.map((member) => ({ id: member.membershipId, label: member.name }))];
  return <InspectorSheet isOpen title={t("Team")} onOpenChange={(open) => { if (!open) onClose(); }} size="sm">
    <ul className={styles.team}>
      {detail.team.map((role) => <li key={role.role}>
        {detail.canManage
          ? <SelectField label={t(role.label as never)} isDisabled={saving === role.role}
              selectedKey={role.member?.membershipId ?? NOBODY}
              onSelectionChange={async (key) => {
                const next = String(key) === NOBODY ? null : String(key);
                if (next === (role.member?.membershipId ?? null)) return;
                setSaving(role.role); await run("set_member", { role: role.role, membershipId: next }); setSaving(null);
              }}
              items={role.role === "project_manager" ? options.filter((option) => option.id !== NOBODY) : options} />
          : <div className={styles.teamRow}>
              <span className={styles.teamRole}>{t(role.label as never)}</span>
              {role.member ? <span className={styles.teamPerson}><Avatar name={role.member.name} seed={role.member.name} size="sm" />{role.member.name}</span> : <span className={styles.muted}>{t("Not named")}</span>}
            </div>}
      </li>)}
    </ul>
  </InspectorSheet>;
}
