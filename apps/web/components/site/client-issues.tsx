"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Badge, Button, EmptyState, FormDialog, SegmentedControl, SelectField, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { PortalError, staffPortalApi } from "@/lib/client-portal/client";
import type { StaffIssue } from "@/lib/client-portal/types";
import { ClientFiles } from "@/components/client-activity/client-files";
import { useProjectFormat } from "../project-core/format";
import styles from "./site.module.css";

type Severity = NonNullable<StaffIssue["severity"]>;
type Data = { issues: StaffIssue[]; caseId: string; canTriage: boolean };
const valid = (next: Data | null) => (Array.isArray(next?.issues) ? next : null);

/** The issues the client reported in the portal while the work is on, for the project manager to triage. */
export function useClientIssues(workspaceId: string, projectId: string) {
  const t = useT();
  const api = useMemo(() => staffPortalApi(workspaceId, t), [workspaceId, t]);
  const [data, setData] = useState<Data | null>(null);
  const load = useCallback(async () => {
    try { const next = valid(await api.issues(projectId)); if (next) setData(next); } catch { /* Without the portal there are no client issues to show. */ }
  }, [api, projectId]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  /** Accepted as a snag (with a severity) or declined with why, for the client; a clash reloads the list. */
  const triage = useCallback(async (issue: StaffIssue, input: { decision: "accept"; severity: Severity; note: string } | { decision: "decline"; note: string }) => {
    try { const next = valid(await api.triageIssue(projectId, issue.id, { ...input, version: issue.version })); if (next) setData(next); }
    catch (cause) { if (cause instanceof PortalError && cause.status === 409) await load(); throw cause; }
  }, [api, projectId, load]);
  const fileUrl = useCallback((assetId: string, preview = false) => (data ? api.clientFile(data.caseId, assetId, preview) : ""), [api, data]);
  return { data, load, triage, fileUrl, toTriage: data?.issues.filter((issue) => issue.status === "to_triage").length ?? 0 };
}

export type ClientIssuesState = ReturnType<typeof useClientIssues>;

/** The client's issues, newest first: what, where, photos and who; the project manager accepts one as a snag or declines it. `openId` opens one. */
export function ClientIssues({ projectId, client, switcher, openId }: { projectId: string; client: ClientIssuesState; switcher: ReactNode; openId: string | null }) {
  const t = useT();
  const format = useProjectFormat();
  const [triaging, setTriaging] = useState<StaffIssue | null>(null);
  const [linked, setLinked] = useState(openId);
  const issues = client.data?.issues ?? [];
  const canTriage = Boolean(client.data?.canTriage);
  // A notice's link opens its issue: to triage when it's waiting, otherwise in the list.
  const target = linked ? issues.find((issue) => issue.id === linked) : undefined;
  if (target) { setLinked(null); if (canTriage && target.status === "to_triage") setTriaging(target); }
  useEffect(() => { if (openId) document.getElementById(`issue-${openId}`)?.scrollIntoView?.({ block: "center" }); }, [openId, client.data]);
  const statusLabel = { to_triage: t("To triage"), accepted: t("Accepted"), declined: t("Declined") };
  const tone = { to_triage: "info", accepted: "success", declined: "warning" } as const;
  const severity: Record<Severity, string> = { minor: t("Minor"), major: t("Major"), critical: t("Critical") };

  return <>
    <div className={styles.toolbar}>{switcher}</div>
    {!issues.length ? <EmptyState illustration={null} title={t("No issues from the client")} />
      : <section className={styles.stack} aria-label={t("Client issues")}><ul className={styles.reports}>{issues.map((issue) =>
        <li key={issue.id} id={`issue-${issue.id}`} className={styles.report} data-selected={openId === issue.id || undefined} aria-label={t("Issue {number}", { number: issue.number })}>
          <div className={styles.reportHead}>
            <strong>{t("Issue {number}", { number: issue.number })}</strong>
            <span className={styles.muted}>{[format.day(issue.raisedOn), issue.by, issue.area].filter(Boolean).join(" · ")}</span>
            <Badge tone={tone[issue.status]}>{statusLabel[issue.status]}</Badge>
            <span className={styles.spacer} />
            {issue.status === "to_triage" && canTriage ? <Button size="compact" onPress={() => setTriaging(issue)}>{t("Triage")}</Button> : null}
          </div>
          <p className={styles.body}>{issue.description}</p>
          <ClientFiles files={issue.files} url={client.fileUrl} />
          {issue.status === "accepted" ? <span className={styles.document}>
            <span className={styles.muted}>{[issue.severity ? severity[issue.severity] : null, issue.decidedBy, issue.reason].filter(Boolean).join(" · ")}</span>
            {issue.snagId ? <Link className={styles.link} href={`/workspace/projects/${projectId}/plan?item=${encodeURIComponent(issue.snagId)}`}>{t("Open the snag")}</Link> : null}
          </span> : null}
          {issue.status === "declined" ? <span className={styles.muted}>{t("{name}: {note}", { name: issue.decidedBy ?? "", note: issue.reason })}</span> : null}
        </li>)}</ul></section>}
    {triaging ? <TriageDialog issue={triaging} onClose={() => setTriaging(null)} onSave={async (input) => { await client.triage(triaging, input); setTriaging(null); }} /> : null}
  </>;
}

/** Accept as a snag in the project's work (how serious, and a note), or decline with the reason the client reads. */
function TriageDialog({ issue, onClose, onSave }: {
  issue: StaffIssue; onClose: () => void;
  onSave: (input: { decision: "accept"; severity: Severity; note: string } | { decision: "decline"; note: string }) => Promise<void>;
}) {
  const t = useT();
  const [decision, setDecision] = useState<"accept" | "decline">("accept");
  const [severity, setSeverity] = useState<Severity>("major");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try { await onSave(decision === "accept" ? { decision, severity, note: note.trim() } : { decision, note: note.trim() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
  };
  return <FormDialog size="md" title={t("Issue {number}", { number: issue.number })} onClose={onClose} error={error || undefined} isSubmitting={busy} isSubmitDisabled={decision === "decline" && !note.trim()} submitLabel={t("Save")} onSubmit={() => save()}>
      <p className={styles.body}>{issue.description}</p>
      <SegmentedControl label={t("Decision")} value={decision} onChange={(value) => setDecision(value as "accept" | "decline")}
        options={[{ id: "accept", label: t("Accept as a snag") }, { id: "decline", label: t("Decline") }]} />
      {decision === "accept" ? <SelectField label={t("Severity")} selectedKey={severity} onSelectionChange={(key) => setSeverity((key ?? "major") as Severity)}
        items={[{ id: "minor", label: t("Minor") }, { id: "major", label: t("Major") }, { id: "critical", label: t("Critical") }]} /> : null}
      <TextAreaField label={decision === "accept" ? t("Note") : t("Why it's declined")} isRequired={decision === "decline"} maxLength={1000} value={note} onChange={setNote} />
  </FormDialog>;
}
