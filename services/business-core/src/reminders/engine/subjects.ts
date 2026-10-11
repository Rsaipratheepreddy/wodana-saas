import type { ReminderAudience, ReminderKind, ReminderSubjectStatus } from "../reminders-contract";
import type { Db, ReminderSubjectRef } from "./engine";

/** A reminder subject as the engine and My day read it. */
export type SubjectRow = {
  id: string;
  kind: ReminderKind;
  sourceKey: string;
  sourceType: string;
  sourceId: string;
  jobId: string | null;
  projectId: string | null;
  caseId: string | null;
  partyId: string | null;
  audience: ReminderAudience;
  critical: boolean;
  ownerMembershipId: string | null;
  ccMembershipIds: string[];
  title: string;
  context: string;
  href: string;
  variables: Record<string, string>;
  dueAt: Date | null;
  dueRevision: number;
  status: ReminderSubjectStatus;
  snoozedUntil: Date | null;
  snoozeReason: string | null;
  remindersSent: number;
  escalationLevel: number;
  lastStepAt: Date | null;
  planKey: string | null;
  version: number;
};

/** The columns of `reminder_subjects subject` as a SubjectRow. */
export const SUBJECT_COLUMNS = `subject.id, subject.kind, subject.source_key AS "sourceKey", subject.source_type AS "sourceType", subject.source_id AS "sourceId",
  subject.job_id AS "jobId", subject.project_id AS "projectId", subject.case_id AS "caseId", subject.party_id AS "partyId", subject.audience, subject.critical,
  subject.owner_membership_id AS "ownerMembershipId", subject.cc_membership_ids AS "ccMembershipIds", subject.title, subject.context, subject.href, subject.variables,
  subject.due_at AS "dueAt", subject.due_revision AS "dueRevision", subject.status, subject.snoozed_until AS "snoozedUntil", subject.snooze_reason AS "snoozeReason",
  subject.reminders_sent AS "remindersSent", subject.escalation_level AS "escalationLevel", subject.last_step_at AS "lastStepAt", subject.plan_key AS "planKey", subject.version`;

export function subjectRef(subject: SubjectRow): ReminderSubjectRef {
  return { id: subject.id, kind: subject.kind, sourceKey: subject.sourceKey, sourceType: subject.sourceType, sourceId: subject.sourceId,
    partyId: subject.partyId, caseId: subject.caseId, projectId: subject.projectId };
}

export function normalizeSubject(row: SubjectRow): SubjectRow {
  return { ...row, dueRevision: Number(row.dueRevision), remindersSent: Number(row.remindersSent), escalationLevel: Number(row.escalationLevel),
    version: Number(row.version), ccMembershipIds: row.ccMembershipIds ?? [], variables: row.variables ?? {} };
}

export async function readSubjects(db: Db, workspaceId: string, where: string, params: unknown[]): Promise<SubjectRow[]> {
  return (await db.query<SubjectRow>(`SELECT ${SUBJECT_COLUMNS} FROM reminder_subjects subject WHERE subject.workspace_id = $1 AND ${where}`, [workspaceId, ...params])).rows
    .map(normalizeSubject);
}
