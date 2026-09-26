"use client";

import { useState, type FormEvent } from "react";
import { Button, ControlledModalDialog, Form, MenuButton, SelectField, TextAreaField, TextInput, type ActionItem } from "@/design-system";
import { caseRequest } from "@/lib/pre-project/content";
import type { DefinitionPageData } from "@/lib/pre-project/definition";
import type { PreProjectCase } from "@/lib/pre-project/types";
import type { CommercialState } from "@/lib/commercial/types";
import styles from "./case-overview.module.css";
import { DesignJourney } from "./design-journey";

type Action = "hold" | "resume" | "cancel" | "reopen" | "set_phase";
const phases = ["discover", "define", "design", "price", "agree", "release"] as const;
const phaseLabel: Record<(typeof phases)[number], string> = { discover: "Discovery", define: "Define scope", design: "Design", price: "Price", agree: "Agreement", release: "Release" };
const actionLabel: Record<Action, string> = { hold: "Put on hold", resume: "Resume", cancel: "Cancel project planning", reopen: "Reopen project planning", set_phase: "Change stage" };

export function CaseOverview({ record: initial, workspaceId, members, onUpdated }: {
  record: PreProjectCase;
  workspaceId: string;
  members: { id: string; displayName: string }[];
  progress?: DefinitionPageData;
  commercial?: CommercialState;
  onUpdated: (record: PreProjectCase) => void;
}) {
  const [record, setRecord] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [owner, setOwner] = useState(initial.ownerMembershipId ?? "");
  const [targetDate, setTargetDate] = useState(initial.targetDate ?? "");
  const [priority, setPriority] = useState(initial.priority);
  const [risk, setRisk] = useState(initial.riskLevel);
  const [action, setAction] = useState<Action | null>(null);
  const [phase, setPhase] = useState<PreProjectCase["phase"]>(initial.phase);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const changed = owner !== (record.ownerMembershipId ?? "") || targetDate !== (record.targetDate ?? "") || priority !== record.priority || risk !== record.riskLevel;
  const phaseIndex = phases.indexOf(record.phase);
  const chosenPhaseIndex = phases.indexOf(phase);
  const reasonRequired = action === "hold" || action === "cancel" || action === "reopen" || (action === "set_phase" && (chosenPhaseIndex < phaseIndex || chosenPhaseIndex > phaseIndex + 1));
  const active = record.status === "active";
  const manageable = Boolean(record.canManageLifecycle) && ["draft", "active", "on_hold"].includes(record.status);
  const caseActions: ActionItem[] = record.canManageLifecycle && record.status !== "released" ? [
    ...(active ? [{ id: "set_phase", label: "Change stage" }, { id: "hold", label: "Put on hold" }] : []),
    ...(record.status === "on_hold" ? [{ id: "resume", label: "Resume" }] : []),
    ...(record.status === "cancelled" ? [{ id: "reopen", label: "Reopen" }] : []),
    ...(["draft", "active", "on_hold"].includes(record.status) ? [{ id: "cancel", label: "Cancel project planning", tone: "danger" as const }] : []),
  ] : [];

  function update(next: PreProjectCase) {
    const updated = { ...next, canManageLifecycle: record.canManageLifecycle };
    setRecord(updated);
    setOwner(next.ownerMembershipId ?? "");
    setTargetDate(next.targetDate ?? "");
    setPriority(next.priority);
    setRisk(next.riskLevel);
    setPhase(next.phase);
    onUpdated(updated);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed || !manageable) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await caseRequest<PreProjectCase>(workspaceId, record.id, "profile", "PATCH", {
        requestId: crypto.randomUUID(), version: record.version,
        ...(owner && owner !== record.ownerMembershipId ? { ownerMembershipId: owner } : {}),
        targetDate: targetDate || null, priority, riskLevel: risk,
      });
      update(next); setEditing(false); setNotice("Project details updated.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update the case."); }
    finally { setBusy(false); }
  }

  async function transition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || !record.canManageLifecycle || (reasonRequired && !reason.trim())) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await caseRequest<PreProjectCase>(workspaceId, record.id, "lifecycle", "POST", {
        requestId: crypto.randomUUID(), version: record.version, action,
        ...(action === "set_phase" ? { phase } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      update(next); setAction(null); setReason(""); setEditing(false); setNotice(`${actionLabel[action]} recorded.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not change the case."); }
    finally { setBusy(false); }
  }

  return <div className={styles.page}>
    {error && !action ? <p role="alert" className={styles.error}>{error}</p> : null}
    {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
    <div className={styles.identity}>
      <div><h2>Client details</h2>{!manageable && record.status !== "released" ? <span>View only · ask a project manager to change details</span> : null}</div>
      {manageable && !editing ? <div className={styles.identityActions}>
        <Button size="compact" onPress={() => { setError(""); setEditing(true); }}>Edit details</Button>
        {caseActions.length ? <MenuButton items={caseActions} label="Project actions" onAction={(id) => { setError(""); if (id === "set_phase") setPhase(record.phase); setAction(id as Action); }} /> : null}
      </div> : null}
    </div>
    {editing ? <Form className={styles.form} onSubmit={(event) => void saveProfile(event)}>
      {members.length ? <SelectField label="Project owner" items={members.map((member) => ({ id: member.id, label: member.displayName }))} selectedKey={owner} onSelectionChange={(key) => setOwner(String(key))} isRequired /> : null}
      <TextInput label="Target date" inputType="date" value={targetDate} onChange={setTargetDate} />
      <SelectField label="Priority" items={["low", "normal", "high", "urgent"].map((value) => ({ id: value, label: value[0].toUpperCase() + value.slice(1) }))} selectedKey={priority} onSelectionChange={(key) => setPriority(String(key) as PreProjectCase["priority"])} />
      <SelectField label="Risk" items={["none", "low", "medium", "high", "critical"].map((value) => ({ id: value, label: value[0].toUpperCase() + value.slice(1) }))} selectedKey={risk} onSelectionChange={(key) => setRisk(String(key) as PreProjectCase["riskLevel"])} />
      <div className={styles.formActions}><Button size="compact" onPress={() => setEditing(false)} isDisabled={busy}>Cancel</Button><Button type="submit" size="compact" variant="primary" isDisabled={!changed} isLoading={busy}>Save details</Button></div>
    </Form> : <dl className={styles.facts}>
      <div><dt>Client</dt><dd>{record.customerName || "Not specified"}</dd></div>
      <div><dt>Owner</dt><dd>{record.engagementOwnerName ?? "Unassigned"}</dd></div>
      <div><dt>Target</dt><dd>{record.targetDate ? new Date(`${record.targetDate}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Not set"}</dd></div>
    </dl>}
    <DesignJourney workspaceId={workspaceId} caseId={record.id} />
    <span id="case-controls" />
    <ControlledModalDialog isOpen={Boolean(action)} title={action ? actionLabel[action] : "Case action"} isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) { setAction(null); setReason(""); } }} footer={<div className={styles.formActions}><Button isDisabled={busy} onPress={() => { setAction(null); setReason(""); }}>Close</Button><Button type="submit" form="case-lifecycle" variant="primary" isLoading={busy} isDisabled={action === "set_phase" && phase === record.phase}>{action ? actionLabel[action] : "Save"}</Button></div>}>
      <Form id="case-lifecycle" className={styles.form} onSubmit={(event) => void transition(event)}>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {action === "set_phase" ? <SelectField label="Stage" items={phases.map((value) => ({ id: value, label: phaseLabel[value] }))} selectedKey={phase} onSelectionChange={(key) => setPhase(String(key) as PreProjectCase["phase"])} /> : null}
        {action === "hold" || action === "cancel" || action === "reopen" || action === "set_phase" ? <TextAreaField label="Reason" value={reason} onChange={setReason} isRequired={reasonRequired} maxLength={500} /> : null}
      </Form>
    </ControlledModalDialog>
  </div>;
}
