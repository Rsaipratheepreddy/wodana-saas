"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button, ControlledModalDialog, DateField, TextAreaField, TextInput } from "@/design-system";
import { parseDate } from "@internationalized/date";
import type { ProjectState } from "@/lib/projects/execution";
import styles from "./project-workflow-strip.module.css";

const gateLabels: Record<string, string> = {
  project_manager_assigned: "Assign a project manager",
  tasks_planned: "Plan and assign tasks",
  site_visit_recorded: "Record the site visit and confirmed design scope",
  production_plan_ready: "Make production packages ready",
  all_tasks_closed: "Complete the remaining tasks",
  all_snags_closed: "Close the remaining snags",
  all_handovers_accepted: "Accept every handover",
  finance_closed: "Reconcile the final account",
};

export function ProjectWorkflowStrip({
  state,
  busy,
  run,
}: {
  state: ProjectState;
  busy: boolean;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
}) {
  const [visitOpen, setVisitOpen] = useState(false);
  const [visitDate, setVisitDate] = useState("");
  const [scopeSummary, setScopeSummary] = useState("");
  const [feeReviewNote, setFeeReviewNote] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const workflow = state.data.workflow;
  const summary = state.workflowSummary;
  if (!workflow || !summary) return null;
  const next = summary.nextStage;
  const final = next?.key === workflow.template.stages.at(-1)?.key;
  const unmet = summary.exitGates.filter((gate) => !gate.passed).map((gate) => gateLabels[gate.key] ?? gate.key.replaceAll("_", " "));
  const ownerMissing = Boolean(summary.ownerRole && !summary.ownerId);
  const onHold = Boolean(state.data.controls?.onHold);
  const canAct = final ? state.canReview : state.canManage;
  const releaseIndex = workflow.template.stages.findIndex((stage) => stage.releaseStart);
  const currentIndex = workflow.template.stages.findIndex((stage) => stage.key === summary.currentStageKey);
  const beforePalmRelease = workflow.template.code === "palm_design_build_delivery" &&
    (releaseIndex < 0 || currentIndex < releaseIndex);
  const commercialOkay = state.commercialReady || beforePalmRelease;
  const canAdvance = Boolean(next && canAct && commercialOkay && !summary.nextBlocker && !busy && !onHold && !ownerMissing && !unmet.length);
  const planningCarriedForward = releaseIndex > 0 && currentIndex >= releaseIndex;
  const reason = summary.nextBlocker ?? (!commercialOkay ? "Complete commercial release first"
    : onHold ? "Release the project hold first"
    : ownerMissing ? `Assign the ${summary.ownerRole?.replaceAll("_", " ")} role`
    : unmet[0] ?? "");

  return <section className={styles.strip} aria-label="Project stage">
    <div className={styles.copy}>
      <span className={styles.eyebrow}>PROJECT FLOW</span>
      <div className={styles.stages}>
        <strong>{summary.currentStageName}</strong>
        {next ? <><ArrowRight size={14} aria-hidden="true" /><span>{next.name}</span></> : <span>Project complete</span>}
      </div>
      {reason ? <small className={styles.reason} dir="auto">{reason}{unmet.length > 1 ? ` · ${unmet.length - 1} more checks` : ""}</small>
        : planningCarriedForward && workflow.template.code !== "palm_design_build_delivery" ? <small dir="auto">Approved planning and quotation are linked in the <Link href={`/workspace/pre-projects/cases/${state.caseId}/overview`}>source case</Link>.</small>
        : null}
    </div>
    {summary.currentStageKey === "site_visit" && state.canManage ? <Button size="compact" isDisabled={busy || onHold} onPress={() => {
      setVisitDate(state.data.siteVisit?.visitedOn ?? "");
      setScopeSummary(state.data.siteVisit?.scopeSummary ?? "");
      setFeeReviewNote(state.data.siteVisit?.feeReviewNote ?? "");
      setEvidenceReference(state.data.siteVisit?.evidenceReference ?? "");
      setVisitOpen(true);
    }}>{state.data.siteVisit ? "Edit site visit" : "Record site visit"}</Button> : null}
    {next && canAct ? <Button
      isDisabled={!canAdvance}
      onPress={() => void run(final ? "complete_project" : "workflow_transition", final ? {} : { toStageKey: next.key, note: "" })}
      size="compact"
      variant="primary"
    >{final ? "Complete project" : `Move to ${next.name}`}</Button> : null}
    <ControlledModalDialog isOpen={visitOpen} onOpenChange={setVisitOpen} title="Site visit & design scope" size="md" footer={<>
      <Button isDisabled={busy} onPress={() => setVisitOpen(false)}>Cancel</Button>
      <Button variant="primary" isDisabled={busy || !visitDate || !scopeSummary.trim() || !evidenceReference.trim()} onPress={() => void run("record_site_visit", { visitedOn: visitDate, scopeSummary, feeReviewNote, evidenceReference }).then(saved => { if (saved) setVisitOpen(false); })}>Save visit</Button>
    </>}>
      <p>After the first paid agreement, capture what the site visit confirmed. If the design fee changes, review it through the commercial agreement before further paid work.</p>
      <DateField label="Visit date" value={visitDate ? parseDate(visitDate) : null} onChange={value => setVisitDate(value?.toString() ?? "")} />
      <TextAreaField label="Confirmed design scope" isRequired value={scopeSummary} onChange={setScopeSummary} />
      <TextInput label="Visit evidence reference" description="Meeting notes, report or document reference" isRequired value={evidenceReference} onChange={setEvidenceReference} />
      <TextAreaField label="Fee or scope change to review" value={feeReviewNote} onChange={setFeeReviewNote} />
      <p>If the visit changes the agreed design fee, record the change under <Link href={`/workspace/projects/${state.id}?tab=planning&planningTab=change-requests`}>Planning → Changes</Link> so it stays with this Deal File.</p>
    </ControlledModalDialog>
  </section>;
}
