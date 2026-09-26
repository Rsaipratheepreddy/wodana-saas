"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Circle, CircleDot, Minus } from "lucide-react";
import { Button, Checkbox, ControlledModalDialog, IconMenuButton, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { EvaluatedCheck, ProjectDetail, ProjectStage } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import styles from "./project-core.module.css";

type Run = (action: string, input?: Record<string, unknown>) => Promise<boolean>;

/**
 * The project's stages top to bottom. The current one is open and lists what it needs to finish —
 * ticked by a person, or read from the records (a named role, a verified payment). Finished stages
 * open to show who did what.
 */
export function ProjectStages({ detail, run, caseHref, onTeam }: { detail: ProjectDetail; run: Run; caseHref: (section: string) => string; onTeam: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState<{ action: "skip_stage" | "reopen_stage"; stage: ProjectStage } | null>(null);
  const roleLabel = (key: string | null) => detail.roles.find((role) => role.key === key)?.label ?? "";
  const running = detail.project.status === "active";

  return <>
    <ol className={styles.stages} aria-label={t("Stages")}>
      {detail.stages.map((stage) => {
        const expanded = stage.status === "current" || open === stage.id;
        const Mark = stage.status === "done" ? Check : stage.status === "current" ? CircleDot : stage.status === "skipped" ? Minus : Circle;
        const meta = stage.status === "done" ? t("Done {date}", { date: format.when(stage.completedAt) }) + (stage.completedByName ? ` · ${stage.completedByName}` : "")
          : stage.status === "skipped" ? t("Skipped · {reason}", { reason: stage.skipReason ?? "" })
          : stage.owner?.name ?? (stage.ownerRole ? t("{role} · not named", { role: roleLabel(stage.ownerRole) }) : "");
        const head = <>
          <Mark aria-hidden="true" size={16} className={styles.stageMark} />
          <span className={styles.stageName}>{t(stage.name as never)}</span>
          <span className={styles.stageMeta}>{meta}</span>
        </>;
        return <li key={stage.id} data-status={stage.status} aria-current={stage.status === "current" ? "step" : undefined}>
          {stage.status === "done" || stage.status === "skipped"
            ? <button type="button" className={styles.stageHead} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : stage.id)}>{head}<ChevronDown aria-hidden="true" size={14} className={styles.chevron} /></button>
            : <div className={styles.stageHead}>{head}{stage.status === "current" && detail.canManage && running
              ? <IconMenuButton ariaLabel={t("Stage actions")} onAction={(id) => setReason({ action: id as "skip_stage" | "reopen_stage", stage })}
                  items={[{ id: "skip_stage", label: t("Skip this stage") }, ...(stage.position > 0 ? [{ id: "reopen_stage", label: t("Go back a stage") }] : [])]} /> : null}</div>}
          {expanded && stage.checks.length ? <ul className={styles.checks} aria-label={t("What {stage} needs", { stage: stage.name })}>
            {stage.checks.map((check) => <CheckRow key={check.key} check={check} stage={stage} run={run} caseHref={caseHref} onTeam={onTeam} roleLabel={roleLabel} running={running} />)}
          </ul> : null}
          {stage.status === "current" && stage.canWork && running ? <div className={styles.stageActions}>
            <Button size="compact" variant="primary" isDisabled={!stage.ready} onPress={() => void run("complete_stage", { stageId: stage.id })}>{t("Finish {stage}", { stage: stage.name })}</Button>
          </div> : null}
        </li>;
      })}
    </ol>
    {reason ? <ReasonDialog title={reason.action === "skip_stage" ? t("Skip {stage}", { stage: reason.stage.name }) : t("Go back a stage")}
      label={reason.action === "skip_stage" ? t("Why doesn't it apply") : t("Why")}
      onClose={() => setReason(null)}
      onSave={async (text) => { if (await run(reason.action, { stageId: reason.stage.id, reason: text })) setReason(null); }} /> : null}
  </>;
}

function CheckRow({ check, stage, run, caseHref, onTeam, roleLabel, running }: {
  check: EvaluatedCheck; stage: ProjectStage; run: Run; caseHref: (section: string) => string; onTeam: () => void; roleLabel: (key: string | null) => string; running: boolean;
}) {
  const t = useT();
  const format = useProjectFormat();
  const live = stage.status === "current" && running;
  if (check.kind === "confirm") {
    const by = check.confirmedBy ? `${check.confirmedBy} · ${format.when(check.confirmedAt)}` : "";
    return <li data-passed={check.passed || undefined}>
      <Checkbox isSelected={check.passed} isDisabled={!live || !stage.canWork}
        onChange={(on) => void run(on ? "confirm_check" : "unconfirm_check", { stageId: stage.id, checkKey: check.key })}>{t(check.label as never)}</Checkbox>
      {by ? <small>{by}{check.note ? ` · ${check.note}` : ""}</small> : null}
    </li>;
  }
  // Read from the records: never ticked by hand.
  const text = check.kind === "lead_assigned" ? t("Project manager named")
    : check.kind === "role_assigned" ? t("{role} named", { role: roleLabel(check.role ?? null) })
    : t("Production payment verified");
  const fix = check.passed || !live ? null
    : check.kind === "payment_verified" ? <Link href={caseHref("payment-plan")}>{t("Open payments")}</Link>
    : <button type="button" className={styles.linkButton} onClick={onTeam}>{t("Name someone")}</button>;
  return <li data-passed={check.passed || undefined} data-auto>
    <span className={styles.autoMark} aria-hidden="true">{check.passed ? <Check size={13} strokeWidth={2.5} /> : null}</span>
    <span>{text}</span>
    {fix}
  </li>;
}

function ReasonDialog({ title, label, onClose, onSave }: { title: string; label: string; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={title} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!text.trim()} onPress={async () => { setBusy(true); await onSave(text.trim()); setBusy(false); }}>{t("Save")}</Button></div>}>
    <TextAreaField label={label} isRequired value={text} onChange={setText} autoFocus />
  </ControlledModalDialog>;
}
