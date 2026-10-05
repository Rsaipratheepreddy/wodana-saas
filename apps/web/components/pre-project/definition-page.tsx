"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, DateField, EmptyState, ErrorState, FormDialog, FormSection, InlineNotice, RecordTable, SelectField, TextInput, TextAreaField, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { caseRequest, scopeLabels } from "@/lib/pre-project/content";
import type { DefinitionPageData, DefinitionState } from "@/lib/pre-project/definition";
import styles from "./definition-page.module.css";
import { parseDateTime } from "@internationalized/date";
import { tKey } from "@/lib/i18n/keys";

const HISTORY_LABEL: Record<string, string> = { awaiting_confirmation: tKey("Waiting for the client"), confirmed: tKey("Signed off"), changes_requested: tKey("Asked for changes"), superseded: tKey("Out of date") };
const localDecisionTime = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000 + 999).toISOString().slice(0, 19);

export function DefinitionPage({ initial }: { initial: DefinitionPageData }) {
  const t = useT();
  if ("error" in initial) return <div className={styles.page}><ErrorState title={t("Scope sign-off didn't load")} description={initial.error} /></div>;
  return <ScopeSignOff initial={initial} />;
}

/**
 * Scope sign-off: the requirements in scope, as the client will see them, sent for the client to
 * confirm before the quote. Each send is a numbered version; the client's answer is recorded on it.
 */
function ScopeSignOff({ initial }: { initial: Extract<DefinitionPageData, { workspaceId: string }> }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
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
  const date = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(value));

  async function reload() {
    setDefinition(await caseRequest<DefinitionState>(workspaceId, caseId, "definition-baselines"));
  }

  async function publish() {
    setBusy(true); setError(""); setNotice("");
    try {
      await caseRequest(workspaceId, caseId, "definition-baselines", "POST", { requestId: publishId.current, sourceHash: definition.draft.sourceHash, message: "" });
      await reload();
      publishId.current = crypto.randomUUID();
      setNotice(t("Sent to the client for sign-off."));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("Could not send the scope.")); }
    finally { setBusy(false); }
  }

  async function recordDecision() {
    if (!current || !definition.canRecordClientDecision) return;
    if (!decidedAt || !decisionBy.trim() || !evidence.trim() || (decision === "changes_requested" && !note.trim()))
      throw new Error(t("Enter the client's name, when they answered and how. Say what they want changed."));
    setError(""); setNotice("");
    await caseRequest(workspaceId, caseId, `definition-baselines/${current.id}/decisions`, "POST", {
      requestId: decisionId.current, decision, decisionBy: decisionBy.trim(), channel,
      evidence: evidence.trim(), note: note.trim(), decidedAt: new Date(decidedAt).toISOString(),
    });
    await reload();
    decisionId.current = crypto.randomUUID();
    setDecisionOpen(false);
    setNotice(decision === "confirmed" ? t("Sign-off recorded.") : t("The client's changes are recorded."));
  }

  const canPublish = definition.canPublish && definition.caseStatus === "active" && definition.draft.readyToPublish && !current?.current;
  const canRecord = definition.canRecordClientDecision && current?.current && current.status === "awaiting_confirmation";
  const status = !current ? { tone: "neutral" as const, label: t("Not sent yet") }
    : !current.current ? { tone: "warning" as const, label: t("Changed since version {number} was sent", { number: current.number }) }
      : current.status === "confirmed" ? { tone: "success" as const, label: current.decision ? t("Signed off by {name}", { name: current.decision.decisionBy }) : t("Signed off") }
        : current.status === "changes_requested" ? { tone: "warning" as const, label: t("The client asked for changes") }
          : { tone: "info" as const, label: t("Waiting for the client") };
  const items = definition.draft.items ?? current?.snapshot.definition.items ?? [];
  const added = new Set(definition.draft.changes?.items.added ?? []);
  const changed = new Set(definition.draft.changes?.items.changed ?? []);
  const rows = [...items].sort((a, b) => Number(b.scopeStatus === "included") - Number(a.scopeStatus === "included") || (a.roomName ?? "").localeCompare(b.roomName ?? "") || a.title.localeCompare(b.title));
  const included = items.filter((item) => item.scopeStatus === "included").length;
  return <div className={styles.page}>
    <div className={styles.bar}>
      <Badge tone={status.tone}>{status.label}</Badge>
      <span className={styles.meta}>{current ? t("Version {number} · sent {date}", { number: current.number, date: date(current.publishedAt) }) : t("{count} in scope", { count: included })}</span>
      <span className={styles.spacer} />
      {canRecord ? <Button size="compact" onPress={() => { setError(""); setDecidedAt(localDecisionTime()); setDecisionOpen(true); }}>{t("Record the client's answer")}</Button> : null}
      {canPublish ? <Button size="compact" variant="primary" onPress={() => void publish()} isLoading={busy}>{current ? t("Send the updated scope") : t("Send to client for sign-off")}</Button>
        : !current?.current && !definition.canPublish ? <span className={styles.meta}>{t("Someone who can send quotes sends the scope")}</span>
          : !current?.current && definition.caseStatus !== "active" ? <span className={styles.meta}>{t("Resume the enquiry to send the scope")}</span> : null}
    </div>
    {error && !decisionOpen ? <InlineNotice tone="error" message={error} /> : null}
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    {current?.decision?.note && current.current ? <InlineNotice tone={current.status === "confirmed" ? "success" : "info"} message={current.decision.note} /> : null}
    {definition.draft.issues.length ? <section className={styles.issues} aria-label={t("Finish before sending")}>
      <h2>{t("Finish before sending")}</h2>
      <ul>{definition.draft.issues.map((issue, index) => <li key={`${issue.code}-${issue.scopeItemId ?? index}`}>{issue.detail}</li>)}</ul>
      <Link href={requirements}>{t("Open requirements")}</Link>
    </section> : null}
    {items.length ? <RecordTable ariaLabel={t("Scope")} data={rows} getRowId={(item) => item.id} showToolbar={false} showFooter={false} rowNumbers={false} selectable={false} wrapText
      columns={[
        { id: "title", header: t("Requirement"), size: 320, accessorFn: (item) => item.title, meta: { primary: true },
          cell: ({ row: { original: item } }) => <span className={styles.item}>{item.title}{added.has(item.title) ? <Badge tone="info">{t("New")}</Badge> : changed.has(item.title) ? <Badge tone="info">{t("Changed")}</Badge> : null}</span> },
        { id: "room", header: t("Area"), size: 180, accessorFn: (item) => item.roomName ?? t("General") },
        { id: "quantity", header: t("Qty"), size: 110, accessorFn: (item) => item.quantity, cell: ({ row: { original: item } }) => item.quantity === null ? "—" : `${new Intl.NumberFormat(locale).format(item.quantity)} ${item.unit}` },
        { id: "scope", header: t("Scope"), size: 150, accessorFn: (item) => item.scopeStatus,
          cell: ({ row: { original: item } }) => <Badge tone={item.scopeStatus === "included" ? "success" : item.scopeStatus === "undecided" ? "warning" : "neutral"}>{t((scopeLabels[item.scopeStatus] ?? item.scopeStatus) as never)}</Badge> },
      ]} /> : <EmptyState title={t("No requirements yet")} action={<Link className="wd-button" data-size="compact" data-variant="primary" href={requirements}>{t("Open requirements")}</Link>} />}
    {definition.history.length ? <section className={styles.history} aria-label={t("Sent versions")}>
      <h2>{t("Sent versions")}</h2>
      <ol>{definition.history.map((version) => <li key={version.id}>
        <strong>{t("Version {number}", { number: version.number })}</strong>
        <span>{date(version.publishedAt)}</span>
        <span>{t((HISTORY_LABEL[version.status] ?? version.status) as never)}{version.decision ? ` · ${version.decision.decisionBy}` : ""}</span>
      </li>)}</ol>
    </section> : null}

    {decisionOpen && <FormDialog title={t("Record the client's answer")} isDirty={Boolean(decisionBy || evidence || note)} onClose={() => setDecisionOpen(false)} submitLabel={t("Save")} onSubmit={recordDecision}>
      <FormSection>
        <SelectField label={t("Answer")} isRequired selectedKey={decision} onSelectionChange={key => key && setDecision(key as typeof decision)} items={[{id:"confirmed",label:t("Signed off")},{id:"changes_requested",label:t("Wants changes")}]} />
        <TextInput label={t("Client name")} isRequired maxLength={240} value={decisionBy} onChange={setDecisionBy} />
        <TextAreaField label={t("Remarks")} isRequired={decision === "changes_requested"} maxLength={5000} value={note} onChange={setNote} />
      </FormSection>
      <FormSection title={t("Proof")}>
        <SelectField label={t("Received by")} isRequired selectedKey={channel} onSelectionChange={key => key && setChannel(String(key))} items={[{id:"meeting",label:t("Meeting")},{id:"email",label:t("Email")},{id:"phone",label:t("Phone")},{id:"whatsapp",label:t("WhatsApp")},{id:"signed_document",label:t("Signed document")},{id:"other",label:t("Other")}]} />
        <DateField label={t("When")} isRequired granularity="second" value={decidedAt ? parseDateTime(decidedAt) : null} onChange={value => setDecidedAt(value?.toString() ?? "")} />
        <TextInput label={t("Evidence")} isRequired maxLength={3000} placeholder={t("Email, meeting note or signed file")} value={evidence} onChange={setEvidence} />
      </FormSection>
    </FormDialog>}
  </div>;
}
