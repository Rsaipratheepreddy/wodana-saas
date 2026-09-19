"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Badge, Button, Callout, ControlledModalDialog, Form, SelectField, StageTracker, TextAreaField, TextInput, type WorkflowStage } from "@/design-system";
import { qualificationEvidenceRows, qualificationEvidenceSnapshot } from "@/lib/crm/qualification-fields";
import { caseRequest } from "@/lib/pre-project/content";
import type { DefinitionPageData, ReadinessState } from "@/lib/pre-project/definition";
import type { PreProjectCase } from "@/lib/pre-project/types";
import type { CommercialState } from "@/lib/commercial/types";
import { PreExecutionFlow } from "@/components/commercial/pre-execution-flow";
import styles from "./case-overview.module.css";

type Action = "hold" | "resume" | "cancel" | "reopen" | "set_phase";
const phases = ["discover", "define", "design", "price", "agree", "release"] as const;
const phaseLabel: Record<(typeof phases)[number], string> = { discover: "Discovery", define: "Define scope", design: "Design", price: "Price", agree: "Agreement", release: "Release" };
const actionLabel: Record<Action, string> = { hold: "Put on hold", resume: "Resume", cancel: "Cancel case", reopen: "Reopen case", set_phase: "Change stage" };

type ReadinessAction = NonNullable<ReadinessState["blockers"][number]["action"]>;

function readinessHref(caseId: string, action?: ReadinessAction) {
  const root = `/workspace/pre-projects/cases/${caseId}`;
  if (!action) return `${root}/requirements`;
  if (action.targetType === "engagement") return `${root}/overview#case-controls`;
  if (action.targetType === "definition") return `${root}/definition`;
  if (action.targetType === "design") return `${root}/designs`;
  if (action.targetType === "site") return `${root}/site`;
  if (["RECORD_MEASUREMENT", "VERIFY_MEASUREMENT", "ADD_MEASUREMENT_EVIDENCE"].includes(action.code))
    return `${root}/requirements?tab=measurements`;
  return `${root}/requirements`;
}

function preparationStages(definition: Extract<DefinitionPageData, { workspaceId: string }>): WorkflowStage[] {
  const { readiness } = definition;
  const requirementsComplete = readiness.summary.includedItemCount > 0
    && readiness.summary.readyItemCount === readiness.summary.includedItemCount;
  const scopeConfirmed = definition.definition.confirmed;
  return [
    { id: "requirements", label: "Requirements", state: requirementsComplete ? "complete" : "current" },
    { id: "confirmation", label: "Client confirmation", state: scopeConfirmed ? "complete" : requirementsComplete ? "current" : "upcoming" },
    { id: "pricing", label: "Ready to price", state: readiness.ready ? "complete" : scopeConfirmed ? "current" : "upcoming" },
  ];
}

export function CaseOverview({ record: initial, workspaceId, members, progress, commercial, onUpdated }: {
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
  const qualificationEvidence = qualificationEvidenceSnapshot(record.qualificationEvidence);
  const qualificationRows = qualificationEvidenceRows(qualificationEvidence);
  const preparation = progress && !("error" in progress) ? progress : null;
  const readiness = preparation?.readiness;
  const firstBlocker = readiness?.blockers[0];
  const nextAction = firstBlocker?.action;
  const nextActionAllowed = nextAction?.targetType !== "engagement" || Boolean(record.canManageLifecycle);
  const preparationTitle = readiness?.ready
    ? "Ready to build the quotation"
    : readiness?.summary.includedItemCount === 0
      ? "Add the first scope item"
      : `${readiness?.summary.blockerCount ?? 0} blocker${readiness?.summary.blockerCount === 1 ? "" : "s"} before pricing`;

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
      update(next); setEditing(false); setNotice("Case details updated.");
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
      <div><h1>{record.title}</h1><span>{record.customerName}</span></div>
      {manageable && !editing ? <Button size="compact" onPress={() => { setError(""); setEditing(true); }}>Edit case</Button> : null}
    </div>
    {editing ? <Form className={styles.form} onSubmit={(event) => void saveProfile(event)}>
      {members.length ? <SelectField label="Case owner" items={members.map((member) => ({ id: member.id, label: member.displayName }))} selectedKey={owner} onSelectionChange={(key) => setOwner(String(key))} isRequired /> : null}
      <TextInput label="Target date" inputType="date" value={targetDate} onChange={setTargetDate} />
      <SelectField label="Priority" items={["low", "normal", "high", "urgent"].map((value) => ({ id: value, label: value[0].toUpperCase() + value.slice(1) }))} selectedKey={priority} onSelectionChange={(key) => setPriority(String(key) as PreProjectCase["priority"])} />
      <SelectField label="Risk" items={["none", "low", "medium", "high", "critical"].map((value) => ({ id: value, label: value[0].toUpperCase() + value.slice(1) }))} selectedKey={risk} onSelectionChange={(key) => setRisk(String(key) as PreProjectCase["riskLevel"])} />
      <div className={styles.formActions}><Button size="compact" onPress={() => setEditing(false)} isDisabled={busy}>Cancel</Button><Button type="submit" size="compact" variant="primary" isDisabled={!changed} isLoading={busy}>Save case</Button></div>
    </Form> : <dl className={styles.facts}>
      <div><dt>Owner</dt><dd>{record.engagementOwnerName ?? "Unassigned"}</dd></div>
      <div><dt>Target</dt><dd>{record.targetDate ? new Date(`${record.targetDate}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Not set"}</dd></div>
      <div><dt>Priority</dt><dd>{record.priority}</dd></div>
      <div><dt>Risk</dt><dd>{record.riskLevel}</dd></div>
      <div><dt>Stage</dt><dd>{phaseLabel[record.phase]}</dd></div>
      <div><dt>Status</dt><dd>{record.status.replaceAll("_", " ")}</dd></div>
    </dl>}
    {record.holdReason ? <p className={styles.context}>On hold: {record.holdReason}</p> : null}
    {record.cancellationReason ? <p className={styles.context}>Cancelled: {record.cancellationReason}</p> : null}
    {record.description ? <p className={styles.context}>{record.description}</p> : null}
    {progress && "error" in progress ? <Callout tone="warning" title="Preparation status unavailable">{progress.error}</Callout> : null}
    {preparation && readiness ? <section className={styles.pulse} aria-labelledby="preparation-pulse-title">
      <div className={styles.pulseHeading}>
        <div><span className={styles.kicker}>Preparation pulse</span><h2 id="preparation-pulse-title">{preparationTitle}</h2><p>{readiness.ready ? "The confirmed scope passes the current pricing checks. AI assistance remains optional inside the quotation studio." : readiness.summary.includedItemCount ? `${readiness.summary.readyItemCount} of ${readiness.summary.includedItemCount} included items currently pass their item checks. Resolve the ordered blockers below.` : "Add and review the first requirement before confirming scope or pricing."}</p></div>
        <Badge tone={readiness.ready ? "success" : "warning"}>{readiness.ready ? "Pricing ready" : "Action needed"}</Badge>
      </div>
      <StageTracker ariaLabel="Pre-execution preparation path" stages={preparationStages(preparation)} />
      <dl className={styles.pulseFacts}>
        <div><dt>Included scope</dt><dd>{readiness.summary.includedItemCount || "None"}</dd></div>
        <div><dt>Items ready</dt><dd>{readiness.summary.readyItemCount} of {readiness.summary.includedItemCount}</dd></div>
        <div><dt>Open warnings</dt><dd>{readiness.summary.warningCount}</dd></div>
        <div><dt>Client scope</dt><dd>{preparation.definition.confirmed ? "Confirmed" : preparation.definition.current?.status.replaceAll("_", " ") ?? "Not sent"}</dd></div>
      </dl>
      {!readiness.ready && readiness.blockers.length ? <ol className={styles.blockers} aria-label="Preparation blockers">{readiness.blockers.slice(0, 3).map((blocker, index) => <li key={`${blocker.code}-${blocker.scopeItemId ?? index}`}><span>{index + 1}</span><div><strong>{blocker.label}</strong><p>{blocker.detail}</p></div></li>)}</ol> : null}
      <div className={styles.pulseAction}>{readiness.ready ? <Link href={`/workspace/pre-projects/cases/${record.id}/quotations`}>Open quotations</Link> : nextActionAllowed ? <Link href={readinessHref(record.id, nextAction)}>{nextAction?.label ?? "Open requirements"}</Link> : <span>Ask a case manager to {nextAction?.label.toLocaleLowerCase()}.</span>}{readiness.blockers.length > 3 ? <span>+{readiness.blockers.length - 3} more in scope confirmation</span> : null}</div>
    </section> : null}
    {commercial ? <PreExecutionFlow state={commercial} section="overview" root={`/workspace/pre-projects/cases/${record.id}`} /> : null}
    {qualificationEvidence ? <section className={styles.handoff} aria-labelledby="crm-handoff-title">
      <Callout title="CRM handoff preserved">Customer identity and the exact qualification decision remain linked to this case. Discovery can add detail without rewriting the original enquiry.</Callout>
      <div className={styles.handoffHeading}><h2 id="crm-handoff-title">Confirmed at qualification</h2><span>{qualificationEvidence.form?.name ?? "No configured form"}</span></div>
      {qualificationRows.length ? <dl className={styles.handoffFacts}>{qualificationRows.map(answer => <div key={answer.key}><dt>{answer.label}</dt><dd>{answer.value}</dd></div>)}</dl> : <p className={styles.context}>No qualification answers were required for this enquiry.</p>}
    </section> : null}
    <div className={styles.links}>{record.leadId ? <Link href={`/workspace/crm/leads?lead=${record.leadId}`}>Original enquiry</Link> : null}<Link href={`/workspace/crm/opportunities?record=${record.opportunityId}`}>CRM opportunity</Link><Link href={`/workspace/pre-projects/cases/${record.id}/requirements`}>Requirements</Link><Link href={`/workspace/pre-projects/cases/${record.id}/definition`}>Scope confirmation</Link><Link href={`/workspace/pre-projects/cases/${record.id}/quotations`}>Quotations</Link></div>
    {record.canManageLifecycle && record.status !== "released" ? <div className={styles.controls} id="case-controls">
      {active ? <><Button size="compact" onPress={() => { setPhase(record.phase); setAction("set_phase"); setError(""); }}>Change stage</Button><Button size="compact" onPress={() => { setAction("hold"); setError(""); }}>Put on hold</Button></> : null}
      {record.status === "on_hold" ? <Button size="compact" onPress={() => { setAction("resume"); setError(""); }}>Resume</Button> : null}
      {record.status === "cancelled" ? <Button size="compact" onPress={() => { setAction("reopen"); setError(""); }}>Reopen</Button> : null}
      {["draft", "active", "on_hold"].includes(record.status) ? <Button size="compact" onPress={() => { setAction("cancel"); setError(""); }}>Cancel case</Button> : null}
    </div> : null}
    <ControlledModalDialog isOpen={Boolean(action)} title={action ? actionLabel[action] : "Case action"} isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) { setAction(null); setReason(""); } }} footer={<div className={styles.formActions}><Button isDisabled={busy} onPress={() => { setAction(null); setReason(""); }}>Close</Button><Button type="submit" form="case-lifecycle" variant="primary" isLoading={busy} isDisabled={action === "set_phase" && phase === record.phase}>{action ? actionLabel[action] : "Save"}</Button></div>}>
      <Form id="case-lifecycle" className={styles.form} onSubmit={(event) => void transition(event)}>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {action === "set_phase" ? <SelectField label="Stage" items={phases.map((value) => ({ id: value, label: phaseLabel[value] }))} selectedKey={phase} onSelectionChange={(key) => setPhase(String(key) as PreProjectCase["phase"])} /> : null}
        {action === "hold" || action === "cancel" || action === "reopen" || action === "set_phase" ? <TextAreaField label="Reason" value={reason} onChange={setReason} isRequired={reasonRequired} maxLength={500} /> : null}
      </Form>
    </ControlledModalDialog>
  </div>;
}
