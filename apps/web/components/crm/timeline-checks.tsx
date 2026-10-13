"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CircleCheck, Clock3, Plus } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, FactRow, FormDialog, PageShell, SelectField, Skeleton, TextAreaField, useDesignSystem } from "@/design-system";
import { crmRequest, dateText } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { SideSection } from "./record/record-layout";
import { ResourceState, useCrmResource } from "./crm-workbench";
import styles from "./opportunity-sections.module.css";

/** A timeline question on an opportunity (PLM-155), as business-core reads it. */
export type TimelineCheck = {
  id: string; opportunityId: string; question: string; status: "open" | "answered" | "cancelled"; answer: string | null; dueAt: string; answeredAt: string | null;
  createdAt: string; version: number; teamCode: string | null; assigneeMembershipId: string; assigneeName: string | null; askerName: string | null; answeredByName: string | null;
  canAnswer?: boolean; canCancel?: boolean;
};
type Person = { membershipId: string; name: string; teams: Array<{ code: string; name: string }> };
type ChecksView = { opportunityId: string; targetCompletion: string | null; canAsk: boolean; people: Person[]; checks: TimelineCheck[] };
type CheckPage = TimelineCheck & { opportunity: { id: string; reference: string; title: string; client: string; targetCompletion: string | null; canOpen: boolean } };

/** A date without a time ("15 Jan 2027"): the client's target is a day. */
const dayText = (value: string, locale: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : value;

const newRequestId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * The opportunity's timeline checks (PLM-155): Sales don't promise timelines. "Ask" puts one question to one person of
 * the teams the firm chose, due by the end of the working day; each check shows who answers it, by when, and the answer.
 */
export function TimelineChecks({ workspaceId, opportunityId }: { workspaceId: string; opportunityId: string }) {
  const t = useT();
  const zoned = useDesignSystem();
  const resource = useCrmResource<ChecksView>(workspaceId, `opportunities/${opportunityId}/timeline-checks`);
  const [asking, setAsking] = useState(false);
  const [answering, setAnswering] = useState<TimelineCheck | null>(null);
  const [failure, setFailure] = useState("");
  const view = resource.data && Array.isArray(resource.data.checks) ? resource.data : null;
  const cancel = async (check: TimelineCheck) => {
    setFailure("");
    try { await crmRequest(workspaceId, `timeline-checks/${check.id}/cancel`, "POST", { version: check.version }); resource.refresh(); }
    catch (error) { setFailure(error instanceof Error ? error.message : t("The question could not be cancelled.")); }
  };
  return <SideSection title={t("Timeline checks")} action={view?.canAsk ? <Button size="compact" variant="quiet" onPress={() => setAsking(true)}><Plus aria-hidden="true" size={14} />{t("Ask")}</Button> : null}>
    {resource.failure ? <ResourceState loading={false} failure={resource.failure} retry={resource.refresh} /> : resource.loading && !view ? <Skeleton lines={2} />
      : view?.checks.length ? <ul className={styles.activity}>{view.checks.map((check) => <li key={check.id} data-status={check.status === "answered" ? "completed" : check.status === "open" ? "pending" : "cancelled"}>
        <span className={styles.activityMark} aria-hidden="true">{check.status === "answered" ? <CircleCheck size={14} /> : <Clock3 size={14} />}</span>
        <span className={styles.activityText}>
          <span className={styles.value}>{check.question}</span>
          <small>{[check.assigneeName ?? t("A team member"), check.status === "answered" ? t("Answered {date}", { date: dateText(check.answeredAt, zoned) })
            : check.status === "cancelled" ? t("Cancelled") : t("Due {date}", { date: dateText(check.dueAt, zoned) })].join(" · ")}</small>
          {check.answer ? <span>{check.answer}</span> : null}
          {check.status === "open" && (check.canAnswer || check.canCancel) ? <span className={styles.activityActions}>
            {check.canAnswer ? <Button size="compact" variant="quiet" onPress={() => setAnswering(check)}>{t("Answer")}</Button> : null}
            {check.canCancel ? <Button size="compact" variant="quiet" onPress={() => void cancel(check)}>{t("Cancel question")}</Button> : null}
          </span> : null}
        </span>
      </li>)}</ul> : <p className={styles.missing}>{view?.targetCompletion ? t("Client's target: {date}", { date: dayText(view.targetCompletion, zoned.locale) }) : t("No timeline questions yet")}</p>}
    {failure ? <p role="alert">{failure}</p> : null}
    {asking && view ? <AskDialog workspaceId={workspaceId} opportunityId={opportunityId} view={view} onClose={() => setAsking(false)} onSaved={() => { setAsking(false); resource.refresh(); }} /> : null}
    {answering ? <AnswerDialog workspaceId={workspaceId} check={answering} onClose={() => setAnswering(null)} onSaved={() => { setAnswering(null); resource.refresh(); }} /> : null}
  </SideSection>;
}

function AskDialog({ workspaceId, opportunityId, view, onClose, onSaved }: { workspaceId: string; opportunityId: string; view: ChecksView; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const zoned = useDesignSystem();
  const requestId = useMemo(newRequestId, []);
  const [assignee, setAssignee] = useState("");
  const [question, setQuestion] = useState(view.targetCompletion ? t("Can we meet the client's target of {date}?", { date: dayText(view.targetCompletion, zoned.locale) }) : "");
  const items = view.people.map((person) => ({ id: person.membershipId, label: person.teams.length ? `${person.name} · ${person.teams.map((team) => team.name).join(", ")}` : person.name }));
  return <FormDialog title={t("Ask about the timeline")} onClose={onClose} submitLabel={t("Ask")} isDirty={Boolean(assignee || question.trim())} isSubmitDisabled={!assignee || !question.trim()}
    onSubmit={async () => { await crmRequest(workspaceId, `opportunities/${opportunityId}/timeline-checks`, "POST", { requestId, assigneeMembershipId: assignee, question: question.trim() }); onSaved(); }}>
    {items.length ? <SelectField label={t("Ask")} isRequired placeholder={t("Choose who answers")} items={items} selectedKey={assignee || null} onSelectionChange={(key) => setAssignee(key ? String(key) : "")} />
      : <EmptyState illustration={null} title={t("Nobody is in the teams that answer timeline questions")} action={<Link href="/workspace/crm/leads?section=assignment">{t("Open Sales settings")}</Link>} />}
    <TextAreaField label={t("Question")} isRequired value={question} onChange={setQuestion} maxLength={2000} />
  </FormDialog>;
}

function AnswerDialog({ workspaceId, check, onClose, onSaved }: { workspaceId: string; check: TimelineCheck; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [answer, setAnswer] = useState("");
  return <FormDialog title={t("Answer the timeline question")} description={check.question} onClose={onClose} submitLabel={t("Send answer")} isDirty={Boolean(answer.trim())} isSubmitDisabled={!answer.trim()}
    onSubmit={async () => { await crmRequest(workspaceId, `timeline-checks/${check.id}/answer`, "POST", { version: check.version, answer: answer.trim() }); onSaved(); }}>
    <TextAreaField label={t("Answer")} isRequired autoFocus value={answer} onChange={setAnswer} maxLength={4000} />
  </FormDialog>;
}

/**
 * The page a timeline question's notice and reminder open (PLM-155): the question, the client and their target date,
 * and the answer box, for the person asked even when they don't open opportunities.
 */
export function TimelineCheckPage({ workspaceId, checkId }: { workspaceId: string; checkId: string }) {
  const t = useT();
  const zoned = useDesignSystem();
  const resource = useCrmResource<CheckPage>(workspaceId, `timeline-checks/${checkId}`);
  const [answering, setAnswering] = useState(false);
  const check = resource.data;
  return <PageShell kind="record" title={t("Timeline question")}
    action={check?.canAnswer ? <Button variant="primary" onPress={() => setAnswering(true)}>{t("Answer")}</Button> : undefined}>
    {resource.failure ? <ErrorState title={t("This question didn't load")} description={resource.failure} onRetry={resource.refresh} />
      : !check ? <Skeleton lines={4} shape="form" /> : <div className={styles.cardBody}>
        <p>{check.question}</p>
        <FactRow label={t("Client")}>{check.opportunity.canOpen ? <Link href={`/workspace/crm/opportunities?record=${check.opportunity.id}`}>{check.opportunity.client}</Link> : check.opportunity.client}</FactRow>
        <FactRow label={t("Opportunity")}>{check.opportunity.reference}</FactRow>
        {check.opportunity.targetCompletion ? <FactRow label={t("Client's target completion")}>{dayText(check.opportunity.targetCompletion, zoned.locale)}</FactRow> : null}
        <FactRow label={t("Asked by")}>{check.askerName ?? t("A team member")}</FactRow>
        <FactRow label={t("Status")}>{check.status === "answered" ? <Badge tone="success">{t("Answered")}</Badge> : check.status === "cancelled" ? <Badge tone="neutral">{t("Cancelled")}</Badge>
          : <Badge tone="warning">{t("Due {date}", { date: dateText(check.dueAt, zoned) })}</Badge>}</FactRow>
        {check.answer ? <FactRow label={t("Answer")}>{check.answer}</FactRow> : null}
      </div>}
    {answering && check ? <AnswerDialog workspaceId={workspaceId} check={check} onClose={() => setAnswering(false)} onSaved={() => { setAnswering(false); resource.refresh(); }} /> : null}
  </PageShell>;
}
