"use client";

import { useState } from "react";
import { EditableField, EditableFieldList, FactRow, FormDialog, MenuButton, PersonName, SelectField, TextAreaField, formatDate, useDesignSystem, type ActionItem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { caseRequest } from "@/lib/pre-project/content";
import type { DefinitionPageData } from "@/lib/pre-project/definition";
import type { PreProjectCase } from "@/lib/pre-project/types";
import type { CommercialState } from "@/lib/commercial/types";
import styles from "./case-overview.module.css";
import { DesignJourney } from "./design-journey";
import { casePriorityLabel, caseRiskLabel } from "./case-spine";
import { tKey, type MessageKey } from "@/lib/i18n/keys";

type Action = "hold" | "resume" | "cancel" | "reopen" | "set_phase";
const phases = ["discover", "define", "design", "price", "agree", "release"] as const;
const phaseLabel: Record<(typeof phases)[number], MessageKey> = { discover: tKey("Discovery"), define: tKey("Define scope"), design: tKey("Design"), price: tKey("Price"), agree: tKey("Agreement"), release: tKey("Release") };
const actionLabel: Record<Action, MessageKey> = { hold: tKey("Put on hold"), resume: tKey("Resume"), cancel: tKey("Cancel planning"), reopen: tKey("Reopen planning"), set_phase: tKey("Change stage") };
const actionNotice: Record<Action, MessageKey> = { hold: tKey("Put on hold recorded."), resume: tKey("Resume recorded."), cancel: tKey("Cancel planning recorded."), reopen: tKey("Reopen planning recorded."), set_phase: tKey("Change stage recorded.") };

export function CaseOverview({ record: initial, workspaceId, members, onUpdated }: {
  record: PreProjectCase;
  workspaceId: string;
  members: { id: string; displayName: string }[];
  progress?: DefinitionPageData;
  commercial?: CommercialState;
  onUpdated: (record: PreProjectCase) => void;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [record, setRecord] = useState(initial);
  const [action, setAction] = useState<Action | null>(null);
  const [phase, setPhase] = useState<PreProjectCase["phase"]>(initial.phase);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const phaseIndex = phases.indexOf(record.phase);
  const chosenPhaseIndex = phases.indexOf(phase);
  const reasonRequired = action === "hold" || action === "cancel" || action === "reopen" || (action === "set_phase" && (chosenPhaseIndex < phaseIndex || chosenPhaseIndex > phaseIndex + 1));
  const active = record.status === "active";
  const manageable = Boolean(record.canManageLifecycle) && ["draft", "active", "on_hold"].includes(record.status);
  const caseActions: ActionItem[] = record.canManageLifecycle && record.status !== "released" ? [
    ...(active ? [{ id: "set_phase", label: t("Change stage") }, { id: "hold", label: t("Put on hold") }] : []),
    ...(record.status === "on_hold" ? [{ id: "resume", label: t("Resume") }] : []),
    ...(record.status === "cancelled" ? [{ id: "reopen", label: t("Reopen") }] : []),
    ...(["draft", "active", "on_hold"].includes(record.status) ? [{ id: "cancel", label: t("Cancel planning"), tone: "danger" as const }] : []),
  ] : [];

  function update(next: PreProjectCase) {
    const updated = { ...next, canManageLifecycle: record.canManageLifecycle };
    setRecord(updated);
    setPhase(next.phase);
    onUpdated(updated);
  }

  // One detail changes in place; the others are sent as saved, with the case's version.
  async function saveProfile(changes: { ownerMembershipId?: string; targetDate?: string | null; priority?: PreProjectCase["priority"]; riskLevel?: PreProjectCase["riskLevel"] }) {
    setNotice("");
    const next = await caseRequest<PreProjectCase>(workspaceId, record.id, "profile", "PATCH", {
      requestId: crypto.randomUUID(), version: record.version,
      targetDate: record.targetDate ?? null, priority: record.priority, riskLevel: record.riskLevel,
      ...changes,
    });
    update(next);
  }

  async function transition() {
    if (!action || !record.canManageLifecycle || (reasonRequired && !reason.trim())) return;
    setError(""); setNotice("");
    const next = await caseRequest<PreProjectCase>(workspaceId, record.id, "lifecycle", "POST", {
      requestId: crypto.randomUUID(), version: record.version, action,
      ...(action === "set_phase" ? { phase } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
    update(next); setAction(null); setReason(""); setNotice(t(actionNotice[action]));
  }

  const closeAction = () => { setAction(null); setReason(""); };
  const date = (value: string) => formatDate(`${value}T00:00:00Z`, { locale, timeZone: "UTC" }, { day: "numeric", month: "short", year: "numeric" });
  return <div className={styles.page}>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
    <div className={styles.identity}>
      <div><h2>{t("Client details")}</h2>{!manageable && record.status !== "released" ? <span>{t("View only · the case owner or an admin can change details")}</span> : null}</div>
      {caseActions.length ? <div className={styles.identityActions}>
        <MenuButton items={caseActions} label={t("Project actions")} onAction={(id) => { setError(""); if (id === "set_phase") setPhase(record.phase); setAction(id as Action); }} />
      </div> : null}
    </div>
    <EditableFieldList className={styles.facts}>
      <FactRow label={t("Client")}>{record.customerName || t("Not specified")}</FactRow>
      {members.length ? <EditableField canEdit={manageable} kind="select" label={t("Owner")} value={record.ownerMembershipId ?? ""} display={<PersonName person={record.engagementOwnerName} fallback={t("Unassigned")} />}
        items={members.map((member) => ({ id: member.id, label: member.displayName }))} onSave={(ownerMembershipId) => saveProfile({ ownerMembershipId })} />
        : <FactRow label={t("Owner")}><PersonName person={record.engagementOwnerName} fallback={t("Unassigned")} /></FactRow>}
      <EditableField canEdit={manageable} kind="date" label={t("Target")} value={record.targetDate ?? ""} display={record.targetDate ? date(record.targetDate) : undefined} placeholder={t("Not set")}
        onSave={(targetDate) => saveProfile({ targetDate: targetDate || null })} />
      <EditableField canEdit={manageable} kind="select" label={t("Priority")} value={record.priority} items={(["low", "normal", "high", "urgent"] as const).map((value) => ({ id: value, label: t(casePriorityLabel[value]) }))}
        onSave={(priority) => saveProfile({ priority: priority as PreProjectCase["priority"] })} />
      <EditableField canEdit={manageable} kind="select" label={t("Risk")} value={record.riskLevel} items={(["none", "low", "medium", "high", "critical"] as const).map((value) => ({ id: value, label: t(caseRiskLabel[value]) }))}
        onSave={(riskLevel) => saveProfile({ riskLevel: riskLevel as PreProjectCase["riskLevel"] })} />
    </EditableFieldList>
    <DesignJourney workspaceId={workspaceId} caseId={record.id} />
    <span id="case-controls" />
    <FormDialog isOpen={Boolean(action)} title={action ? t(actionLabel[action]) : t("Case action")} onClose={closeAction} isDirty={Boolean(reason.trim())}
      submitLabel={action ? t(actionLabel[action]) : t("Save")} submitVariant={action === "cancel" ? "danger" : "primary"} isSubmitDisabled={action === "set_phase" && phase === record.phase}
      onSubmit={transition}>
      {action === "set_phase" ? <SelectField label={t("Stage")} isRequired items={phases.map((value) => ({ id: value, label: t(phaseLabel[value]) }))} selectedKey={phase} onSelectionChange={(key) => setPhase(String(key) as PreProjectCase["phase"])} /> : null}
      {action === "hold" || action === "cancel" || action === "reopen" || action === "set_phase" ? <TextAreaField label={t("Reason")} value={reason} onChange={setReason} isRequired={reasonRequired} maxLength={500} /> : null}
    </FormDialog>
  </div>;
}
