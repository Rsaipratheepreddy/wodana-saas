"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Circle, CircleDot, Minus } from "lucide-react";
import { Button, Checkbox, ConfirmationDialog, FormDialog, IconMenuButton, InlineNotice, ReasonDialog as SharedReasonDialog, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ProjectApi } from "@/lib/project-core/client";
import type { CloseOut, EvaluatedCheck, ProjectDetail, ProjectOverview, ProjectStage } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import styles from "./project-core.module.css";

type Run = (action: string, input?: Record<string, unknown>, options?: { inDialog?: boolean }) => Promise<boolean>;

/**
 * The project's stages top to bottom. The current one is open and lists what it needs to finish —
 * ticked by a person, or read from the records (a named role, a verified payment) — with who acts. Each
 * stage shows when its planned work runs, and says when it's past its plan. Finished stages open to show
 * who did what. Under the last stage, what still has to be settled before the project can close.
 */
export function ProjectStages({ detail, run, onTeam, plan, today, api }: {
  detail: ProjectDetail; run: Run; onTeam: () => void; caseHref?: (section: string) => string;
  plan?: ProjectOverview["stagePlan"]; today?: string; api?: ProjectApi;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState<{ action: "skip_stage" | "reopen_stage"; stage: ProjectStage } | null>(null);
  const [finishing, setFinishing] = useState<ProjectStage | null>(null);
  const roleLabel = (key: string | null) => detail.roles.find((role) => role.key === key)?.label ?? "";
  const running = detail.project.status === "active";
  const last = detail.stages.at(-1);
  const closing = running && last?.status === "current" && detail.canClose;

  return <>
    <ol className={styles.stages} aria-label={t("Stages")}>
      {detail.stages.map((stage) => {
        const expanded = stage.status === "current" || open === stage.id;
        const Mark = stage.status === "done" ? Check : stage.status === "current" ? CircleDot : stage.status === "skipped" ? Minus : Circle;
        const window = plan?.[stage.id];
        const late = today && window?.end && window.open > 0 && window.end < today && (stage.status === "current" || stage.status === "upcoming")
          ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${window.end}T00:00:00Z`)) / 86_400_000) : 0;
        const who = stage.owner?.name ?? (stage.ownerRole ? t("{role} · not named", { role: t(roleLabel(stage.ownerRole) as never) }) : "");
        const planned = window?.start && (stage.status === "current" || stage.status === "upcoming")
          ? `${format.short(window.start)}${window.end && window.end !== window.start ? ` – ${format.short(window.end)}` : ""}` : "";
        const meta = stage.status === "done" ? t("Done {date}", { date: format.when(stage.completedAt) })
            + (stage.finishedAutomatically ? ` · ${t("Finished by itself")}` : stage.completedByName ? ` · ${stage.completedByName}` : "")
          : stage.status === "skipped" ? t("Skipped · {reason}", { reason: stage.skipReason ?? "" })
          : [planned, who].filter(Boolean).join(" · ");
        const head = <>
          <Mark aria-hidden="true" size={16} className={styles.stageMark} />
          <span className={styles.stageName}>{t(stage.name as never)}</span>
          {late ? <span className={styles.stageLate}>{late === 1 ? t("1 day late") : t("{count} days late", { count: late })}</span> : null}
          <span className={styles.stageMeta}>{meta}</span>
        </>;
        return <li key={stage.id} data-status={stage.status} aria-current={stage.status === "current" ? "step" : undefined}>
          {stage.status === "done" || stage.status === "skipped"
            ? <button type="button" className={styles.stageHead} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : stage.id)}>{head}<ChevronDown aria-hidden="true" size={14} className={styles.chevron} /></button>
            : <div className={styles.stageHead}>{head}{stage.status === "current" && detail.canManage && running
              ? <IconMenuButton ariaLabel={t("Stage actions")} onAction={(id) => setReason({ action: id as "skip_stage" | "reopen_stage", stage })}
                  items={[{ id: "skip_stage", label: t("Skip this stage") }, ...(stage.position > 0 ? [{ id: "reopen_stage", label: t("Go back a stage") }] : [])]} /> : null}</div>}
          {expanded && stage.checks.length ? <ul className={styles.checks} aria-label={t("What {stage} needs", { stage: stage.name })}>
            {stage.checks.map((check) => <CheckRow key={check.key} check={check} stage={stage} run={run} projectId={detail.project.id} onTeam={onTeam} roleLabel={roleLabel} running={running} />)}
          </ul> : null}
          {stage.status === "current" && stage.canWork && running ? <div className={styles.stageActions}>
            <Button size="compact" variant="primary" isDisabled={!stage.ready} onPress={() => setFinishing(stage)}>{t("Finish {stage}", { stage: t(stage.name as never) })}</Button>
            {!stage.ready ? <span className={styles.muted}>{t("{count} still needed", { count: stage.checks.filter((check) => !check.passed).length })}</span> : null}
          </div> : null}
          {stage === last && closing && api ? <CloseOutList api={api} projectId={detail.project.id} /> : null}
        </li>;
      })}
    </ol>
    {finishing ? <FinishStageDialog detail={detail} stage={finishing} run={run} onClose={() => setFinishing(null)} /> : null}
    {reason ? <ReasonDialog title={reason.action === "skip_stage" ? t("Skip {stage}", { stage: reason.stage.name }) : t("Go back a stage")}
      label={reason.action === "skip_stage" ? t("Why doesn't it apply") : t("Why")}
      onClose={() => setReason(null)}
      onSave={async (text) => { await run(reason.action, { stageId: reason.stage.id, reason: text }, { inDialog: true }); setReason(null); }} /> : null}
  </>;
}

export function CheckRow({ check, stage, run, projectId, onTeam, roleLabel, running, showFix = true }: {
  check: EvaluatedCheck; stage: ProjectStage; run: Run; projectId: string; onTeam: () => void; roleLabel: (key: string | null) => string; running: boolean;
  /** False when the next-step card's own button already does this check's fix, so it isn't offered twice. */
  showFix?: boolean;
}) {
  const t = useT();
  const format = useProjectFormat();
  const live = stage.status === "current" && running;
  const projectHref = `/workspace/projects/${projectId}`;
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
    : check.kind === "role_assigned" ? t("{role} named", { role: t(roleLabel(check.role ?? null) as never) })
    : check.kind === "material_list_signed_off" ? t("Client signed off the material list")
    : check.kind === "everything_ordered" ? t("Everything is ordered")
    : check.kind === "everything_made" ? t("Everything is made and checked")
    : check.kind === "snags_closed" ? t("All snags closed")
    : check.kind === "no_critical_snags" ? t("No critical snag open")
    : check.kind === "handover_accepted" ? t("The client accepted the handover")
    : check.kind === "drawings_uploaded" ? t("Technical drawings uploaded")
    : check.kind === "drawings_site_checked" ? t("Technical site check passed")
    : check.kind === "technical_measure_done" ? t("Technical site measure done")
    : check.kind === "drawings_design_checked" ? t("Drawings match the design")
    : check.kind === "drawings_client_approved" ? t("Client approved the drawings")
    : check.kind === "factory_slot_booked" ? t("Factory slot booked")
    : check.kind === "installation_scheduled" ? t("Installation scheduled")
    : check.kind === "goods_delivered" ? t("Everything delivered")
    : check.kind === "installation_done" ? t("Installation signed off")
    : check.kind === "permit_collected" ? t("Building permit collected")
    : t("Production payment verified");
  // Each fix opens where it's done, filtered to this project.
  const fix = check.passed || !live || !showFix ? null
    : check.kind === "payment_verified" ? <Link href={`${projectHref}/money?view=client`}>{t("Open payments")}</Link>
    : check.kind === "material_list_signed_off" ? <Link href={`${projectHref}/scope?view=materials`}>{t("Open the material list")}</Link>
    : check.kind === "everything_ordered" ? <Link href={`/workspace/purchasing?project=${projectId}`}>{t("Open what to order")}</Link>
    : check.kind === "everything_made" ? <Link href={`/workspace/factory?project=${projectId}`}>{t("Open the factory")}</Link>
    : check.kind === "snags_closed" || check.kind === "no_critical_snags" ? <Link href={`${projectHref}/plan?filter=snags`}>{t("Open snags")}</Link>
    : check.kind === "handover_accepted" ? <Link href={`${projectHref}/handover`}>{t("Open the handover")}</Link>
    : check.kind === "drawings_uploaded" || check.kind === "drawings_site_checked" || check.kind === "drawings_client_approved" || check.kind === "technical_measure_done"
      || check.kind === "drawings_design_checked" ? <Link href={`${projectHref}/scope?view=drawings`}>{t("Open the drawings")}</Link>
    // The slot and the installation are booked from the project's details (or its next step).
    : check.kind === "factory_slot_booked" || check.kind === "installation_scheduled" || check.kind === "permit_collected" ? null
    : check.kind === "goods_delivered" ? <Link href={`/workspace/inventory?project=${projectId}`}>{t("Open stock")}</Link>
    : check.kind === "installation_done" ? <Link href={`${projectHref}/site`}>{t("Open the site")}</Link>
    : <Button size="compact" variant="quiet" onPress={onTeam}>{t("Name someone")}</Button>;
  return <li data-passed={check.passed || undefined} data-auto>
    <span className={styles.autoMark} aria-hidden="true">{check.passed ? <Check size={13} strokeWidth={2.5} /> : null}</span>
    <span>{text}</span>
    {fix}
  </li>;
}

/** What the project still owes before it can close (the last stage finishing completes it): each opens where it's settled. */
export function CloseOutList({ api, projectId }: { api: ProjectApi; projectId: string }) {
  const t = useT();
  const [closeOut, setCloseOut] = useState<CloseOut | null>(null);
  useEffect(() => {
    let alive = true;
    api.closeOut(projectId).then((value) => { if (alive) setCloseOut(value); }).catch(() => undefined);
    return () => { alive = false; };
  }, [api, projectId]);
  if (!closeOut) return null;
  const rows = [
    ...closeOut.owedOrders.map((order) => ({ key: `o${order.id}`, text: t("{order} still owes goods · {supplier}", { order: order.number, supplier: order.supplierName }), href: `/workspace/purchasing/orders?order=${order.id}` })),
    ...closeOut.inspections.map((row) => ({ key: `i${row.id}`, text: t("Delivery {number} waits for inspection", { number: row.number }), href: `/workspace/purchasing?project=${projectId}` })),
    ...closeOut.moves.map((row) => ({ key: `m${row.id}`, text: t("Move {number} is on its way", { number: row.number }), href: `/workspace/inventory?project=${projectId}` })),
    ...closeOut.siteStock.map((row, index) => ({ key: `s${index}`, text: t("{quantity} {unit} of {item} at {place}", { quantity: row.quantity, unit: row.unit, item: row.itemName, place: row.locationName }), href: `/workspace/inventory?project=${projectId}` })),
    // PLM-070: the project can't be handed over as complete while a snag is open.
    ...(closeOut.openSnags ?? []).map((snag) => ({ key: `n${snag.id}`, text: t("Snag #{number} · {title}", { number: snag.number, title: snag.title }), href: `/workspace/projects/${projectId}/plan?filter=snags` })),
    ...(closeOut.openWork ? [{ key: "work", text: t("{count} open tasks", { count: closeOut.openWork }), href: `/workspace/projects/${projectId}/plan` }] : []),
  ];
  if (!rows.length) return null;
  return <div className={styles.closeOut}>
    <h3>{t("Before the project closes")}</h3>
    <ul className={styles.closeList}>{rows.map((row) => <li key={row.key}><Link href={row.href}>{row.text}</Link></li>)}</ul>
  </div>;
}

/** Skipping or going back a stage needs the reason: the shared reason dialog, saved with Save. */
export function ReasonDialog({ title, label, onClose, onSave }: { title: string; label: string; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  return <SharedReasonDialog title={title} label={label} confirmLabel={t("Save")} onClose={onClose} onConfirm={onSave} />;
}

/** Finishing a stage moves the project on, so it asks first and says what comes next. */
export function FinishStageDialog({ detail, stage, run, onClose }: { detail: ProjectDetail; stage: ProjectStage; run: Run; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const following = detail.stages.find((item) => item.position > stage.position && item.status === "upcoming");
  const name = t(stage.name as never);
  return <ConfirmationDialog isOpen confirmVariant="primary" isConfirming={busy} title={t("Finish {stage}?", { stage: name })}
    body={<>{following ? t("The project moves on to {stage}.", { stage: t(following.name as never) }) : t("This is the last stage.")}{error ? <InlineNotice tone="error" message={error} /> : null}</>}
    confirmLabel={t("Finish {stage}", { stage: name })} onOpenChange={(isOpen) => { if (!isOpen && !busy) onClose(); }}
    onConfirm={async () => { setBusy(true); setError(""); try { if (await run("complete_stage", { stageId: stage.id }, { inDialog: true })) onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); } finally { setBusy(false); } }} />;
}

/** Confirming a step is recorded with the person's name, so the header's one-click confirm asks first. */
export function ConfirmCheckDialog({ stage, checkKey, label, run, onClose }: { stage: ProjectStage; checkKey: string; label: string; run: Run; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <ConfirmationDialog isOpen confirmVariant="primary" isConfirming={busy} title={t("Confirm: {check}", { check: label })}
    body={<>{t("Your name and the time are recorded.")}{error ? <InlineNotice tone="error" message={error} /> : null}</>} confirmLabel={t("Confirm")} onOpenChange={(isOpen) => { if (!isOpen && !busy) onClose(); }}
    onConfirm={async () => { setBusy(true); setError(""); try { if (await run("confirm_check", { stageId: stage.id, checkKey }, { inDialog: true })) onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); } finally { setBusy(false); } }} />;
}
