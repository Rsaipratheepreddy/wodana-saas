"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button, Callout, DateField, SelectField, TextInput, TextAreaField } from "@/design-system";
import { caseRequest } from "@/lib/pre-project/content";
import type { DefinitionPageData, DefinitionState } from "@/lib/pre-project/definition";
import styles from "./definition-page.module.css";
import { parseDateTime } from "@internationalized/date";
import { CaseModal } from "./case-controls";

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
    const nextDefinition = await caseRequest<DefinitionState>(workspaceId, caseId, "definition-baselines");
    setDefinition(nextDefinition);
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
    if (!current || busy || !definition.canRecordClientDecision) return;
    if (!decidedAt || !decisionBy.trim() || !evidence.trim() || (decision === "changes_requested" && !note.trim())) {
      setError("Enter the client name, decision date and evidence. Include remarks for requested changes."); return;
    }
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
      <div><strong>{current?.current ? statusText[current.status] : current ? "Scope changed since publication" : "Not published"}</strong><span>{current ? `Version ${current.number} · ${included.length} included item${included.length === 1 ? "" : "s"}` : "Share a snapshot when the scope is ready for client confirmation."}</span></div>
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
      <section className={styles.details}><h3>Published requirements</h3><ul className={styles.items}>{current.snapshot.definition.items.map((item) => <li key={item.id}><span><strong>{item.title}</strong><small>{item.roomName ? `${item.roomName} · ` : ""}{item.scopeStatus}{item.quantity ? ` · ${item.quantity} ${item.unit}` : ""}</small></span>{(item.specification?.refinedRequirement || item.requirement) ? <p>{item.specification?.refinedRequirement || item.requirement}</p> : null}</li>)}</ul></section>
    </section> : null}

    {decisionOpen && <CaseModal title="Record client decision" busy={busy} dirty={Boolean(decisionBy || evidence || note)} onClose={() => setDecisionOpen(false)} footer={<div className={styles.actions}><Button type="submit" form="definition-decision" variant="primary" isLoading={busy}>Save decision</Button></div>}>
      <form id="definition-decision" className={styles.form} onSubmit={(event) => void recordDecision(event)}>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <div className={styles.formGrid}>
          <SelectField label="Decision" isDisabled={busy} selectedKey={decision} onSelectionChange={key => key && setDecision(key as typeof decision)} items={[{id:"confirmed",label:"Confirmed"},{id:"changes_requested",label:"Changes requested"}]} />
          <TextInput label="Client name" isRequired isDisabled={busy} maxLength={240} value={decisionBy} onChange={setDecisionBy} />
          <SelectField label="Received via" isDisabled={busy} selectedKey={channel} onSelectionChange={key => key && setChannel(String(key))} items={[{id:"meeting",label:"Meeting"},{id:"email",label:"Email"},{id:"phone",label:"Phone"},{id:"whatsapp",label:"WhatsApp"},{id:"signed_document",label:"Signed document"},{id:"other",label:"Other"}]} />
          <DateField label="When received" isRequired isDisabled={busy} granularity="second" hourCycle={24} value={decidedAt ? parseDateTime(decidedAt) : null} onChange={value => setDecidedAt(value?.toString() ?? "")} />
        </div>
        <TextInput label="Evidence reference" isRequired isDisabled={busy} maxLength={3000} placeholder="Email, meeting record or signed file reference" value={evidence} onChange={setEvidence} />
        <TextAreaField label="Remarks" isRequired={decision === "changes_requested"} isDisabled={busy} maxLength={5000} value={note} onChange={setNote} />
      </form>
    </CaseModal>}
  </div>;
}
