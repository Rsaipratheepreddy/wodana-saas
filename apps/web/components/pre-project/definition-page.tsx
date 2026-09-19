"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button, Callout, ControlledModalDialog } from "@/design-system";
import { caseRequest } from "@/lib/pre-project/content";
import type { DefinitionPageData, DefinitionState, ReadinessState } from "@/lib/pre-project/definition";
import styles from "./definition-page.module.css";

const statusText: Record<string, string> = {
  awaiting_confirmation: "Awaiting client confirmation",
  confirmed: "Client confirmed",
  changes_requested: "Changes requested",
  superseded: "Outdated version",
};
const localDecisionTime = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000 + 999).toISOString().slice(0, 19);

export function DefinitionPage({ initial }: { initial: DefinitionPageData }) {
  if ("error" in initial) return <Callout tone="warning" title="Scope confirmation unavailable">{initial.error}</Callout>;
  return <DefinitionContent initial={initial} />;
}

function DefinitionContent({ initial }: { initial: Extract<DefinitionPageData, { workspaceId: string }> }) {
  const { workspaceId, caseId } = initial;
  const [definition, setDefinition] = useState(initial.definition);
  const [readiness, setReadiness] = useState(initial.readiness);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decision, setDecision] = useState<"confirmed" | "changes_requested">("confirmed");
  const [decisionBy, setDecisionBy] = useState("");
  const [channel, setChannel] = useState("meeting");
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const [decidedAt, setDecidedAt] = useState(localDecisionTime);
  const publishId = useRef(crypto.randomUUID());
  const decisionId = useRef(crypto.randomUUID());
  const current = definition.current;
  const requirements = `/workspace/pre-projects/cases/${caseId}/requirements`;

  async function reload() {
    const [nextDefinition, nextReadiness] = await Promise.all([
      caseRequest<DefinitionState>(workspaceId, caseId, "definition-baselines"),
      caseRequest<ReadinessState>(workspaceId, caseId, "readiness?target=pricing"),
    ]);
    setDefinition(nextDefinition);
    setReadiness(nextReadiness);
  }

  async function publish() {
    setBusy(true); setError(""); setNotice("");
    try {
      await caseRequest(workspaceId, caseId, "definition-baselines", "POST", { requestId: publishId.current, sourceHash: definition.draft.sourceHash, message: "" });
      await reload();
      publishId.current = crypto.randomUUID();
      setNotice("Current scope sent for client confirmation.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Scope could not be published."); }
    finally { setBusy(false); }
  }

  async function recordDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await caseRequest(workspaceId, caseId, `definition-baselines/${current.id}/decisions`, "POST", {
        requestId: decisionId.current, decision, decisionBy: decisionBy.trim(), channel,
        evidence: evidence.trim(), note: note.trim(), decidedAt: new Date(decidedAt).toISOString(),
      });
      await reload();
      decisionId.current = crypto.randomUUID();
      setDecisionOpen(false);
      setNotice(decision === "confirmed" ? "Client confirmation recorded." : "Client changes recorded.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Decision could not be recorded."); }
    finally { setBusy(false); }
  }

  const canPublish = definition.canPublish && definition.caseStatus === "active" && definition.draft.readyToPublish && !current?.current;
  const canRecord = definition.canRecordClientDecision && current?.current && current.status === "awaiting_confirmation";
  const included = current?.snapshot.definition.items.filter((item) => item.scopeStatus === "included") ?? [];
  const changes=definition.draft.changes;
  return <div className={styles.page}>
    {error && !decisionOpen ? <Callout tone="danger" title="Could not update scope">{error}</Callout> : null}
    {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
    <div className={styles.summary}>
      <div><strong>{current?.current ? statusText[current.status] : current ? "Scope changed since publication" : "Not published"}</strong><span>{current ? `Version ${current.number} · ${included.length} included item${included.length === 1 ? "" : "s"}` : "Complete the requirements before requesting client confirmation."}</span></div>
      <div className={styles.actions}>
        <Button size="compact" onPress={() => void reload().catch((failure) => setError(failure instanceof Error ? failure.message : "Could not refresh."))} isDisabled={busy}>Refresh</Button>
        {canPublish ? <Button size="compact" variant="primary" onPress={() => void publish()} isLoading={busy}>Send for confirmation</Button> : null}
        {canRecord ? <Button size="compact" onPress={() => { setError(""); setDecidedAt(localDecisionTime()); setDecisionOpen(true); }}>Record offline decision</Button> : null}
      </div>
    </div>

    {definition.draft.issues.length ? <section className={styles.section} aria-label="Scope to finish"><div className={styles.sectionTitle}><h2>Before sending</h2><Link href={requirements}>Open requirements</Link></div><ul className={styles.list}>{definition.draft.issues.map((issue, index) => <li key={`${issue.code}-${issue.scopeItemId ?? index}`}>{issue.detail}</li>)}</ul></section> : null}

    {changes?.total ? <section className={styles.section} aria-label="Changes since published scope"><div className={styles.sectionTitle}><h2>Changes since V{current?.number}</h2><span>{changes.total} update{changes.total===1?'':'s'}</span></div><ul className={styles.list}>
      {changes.briefChanged?<li>Client brief updated</li>:null}
      {changes.rooms.added.length?<li>Rooms added · {changes.rooms.added.join(', ')}</li>:null}
      {changes.rooms.changed.length?<li>Rooms updated · {changes.rooms.changed.join(', ')}</li>:null}
      {changes.rooms.removed.length?<li>Rooms removed · {changes.rooms.removed.join(', ')}</li>:null}
      {changes.items.added.length?<li>Scope added · {changes.items.added.join(', ')}</li>:null}
      {changes.items.changed.length?<li>Scope updated · {changes.items.changed.join(', ')}</li>:null}
      {changes.items.removed.length?<li>Scope removed · {changes.items.removed.join(', ')}</li>:null}
    </ul></section>:null}

    {current ? <section className={styles.section} aria-label="Published scope"><div className={styles.sectionTitle}><h2>Published scope · V{current.number}</h2><span>{new Date(current.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span></div>
      {current.decision ? <p className={styles.meta}>{statusText[current.status]} by {current.decision.decisionBy} · {current.decision.channel}{current.decision.note ? ` · ${current.decision.note}` : ""}</p> : <p className={styles.meta}>Shared for the client’s decision. A portal approver can confirm this exact version with verification.</p>}
      <details className={styles.details}><summary>Review the published items</summary><ul className={styles.items}>{current.snapshot.definition.items.map((item) => <li key={item.id}><span><strong>{item.title}</strong><small>{item.roomName ?? "Whole project"} · {item.scopeStatus}{item.quantity ? ` · ${item.quantity} ${item.unit}` : ""}</small></span>{item.specification?.refinedRequirement ? <p>{item.specification.refinedRequirement}</p> : null}</li>)}</ul></details>
    </section> : null}

    <section className={styles.section} aria-label="Quotation readiness"><div className={styles.sectionTitle}><h2>Quotation readiness</h2><span>{readiness.ready ? "Ready" : `${readiness.summary.blockerCount} to resolve`}</span></div>
      {!readiness.ready ? <ul className={styles.list}>{readiness.blockers.map((blocker, index) => <li key={`${blocker.code}-${blocker.scopeItemId ?? index}`}>{blocker.detail}</li>)}</ul> : <p className={styles.meta}>The current scope passes the pricing checks.</p>}
    </section>

    <ControlledModalDialog isOpen={decisionOpen} title="Record client decision" isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) setDecisionOpen(false); }} footer={<div className={styles.actions}><Button isDisabled={busy} onPress={() => setDecisionOpen(false)}>Cancel</Button><Button type="submit" form="definition-decision" variant="primary" isLoading={busy}>Save decision</Button></div>}>
      <form id="definition-decision" className={styles.form} onSubmit={(event) => void recordDecision(event)}>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <label>Decision<select value={decision} onChange={(event) => setDecision(event.target.value as typeof decision)}><option value="confirmed">Confirmed</option><option value="changes_requested">Changes requested</option></select></label>
        <label>Client name<input required maxLength={240} value={decisionBy} onChange={(event) => setDecisionBy(event.target.value)} /></label>
        <label>Received via<select value={channel} onChange={(event) => setChannel(event.target.value)}>{["meeting", "email", "phone", "whatsapp", "signed_document", "other"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label>When received<input required type="datetime-local" step="1" value={decidedAt} onChange={(event) => setDecidedAt(event.target.value)} /></label>
        <label>Evidence reference<input required maxLength={3000} placeholder="Email subject, meeting record or signed file reference" value={evidence} onChange={(event) => setEvidence(event.target.value)} /></label>
        <label>Remarks{decision === "changes_requested" ? " *" : ""}<textarea required={decision === "changes_requested"} maxLength={5000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </form>
    </ControlledModalDialog>
  </div>;
}
