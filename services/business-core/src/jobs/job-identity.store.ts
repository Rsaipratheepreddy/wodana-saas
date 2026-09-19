import { ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { JobLineageLink, JobLineageRecordType } from "./job-lineage";

export type JobIdentity = { id: string; reference: string; workspaceId: string };

type Source = JobLineageLink;
type Row = Record<string, unknown>;

function key(source: Source): string {
  return `${source.type}:${source.type === "quote" ? `${source.caseId}:` : ""}${source.id}`;
}

async function activeLink(
  client: PoolClient,
  workspaceId: string,
  source: Source,
): Promise<JobIdentity | undefined> {
  const result = await client.query<JobIdentity & { status: string }>(
    `SELECT identity.id, identity.reference, identity.workspace_id AS "workspaceId", link.status
       FROM job_identity_links link
       JOIN job_identities identity ON identity.workspace_id=link.workspace_id AND identity.id=link.job_id
      WHERE link.workspace_id=$1 AND link.source_key=$2`,
    [workspaceId, key(source)],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  if (row.status !== "active") throw new ConflictException("The Job link needs reviewed repair.");
  return { id: row.id, reference: row.reference, workspaceId: row.workspaceId };
}

async function attach(
  client: PoolClient,
  workspaceId: string,
  job: JobIdentity,
  source: Source,
  actorUserId: string | null,
  reason: string,
  requestKey: string | null,
): Promise<void> {
  const inserted = await client.query<{ id: string; version: number }>(
    `INSERT INTO job_identity_links(workspace_id,job_id,record_type,record_id,case_id)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(workspace_id,source_key) DO NOTHING RETURNING id,version`,
    [workspaceId, job.id, source.type, source.id, source.caseId ?? null],
  );
  if (!inserted.rowCount) {
    const linked = await activeLink(client, workspaceId, source);
    if (!linked || linked.id !== job.id)
      throw new ConflictException("The source record belongs to a different Job or needs reviewed repair.");
    return;
  }
  await client.query(
    `INSERT INTO job_identity_link_events(workspace_id,link_id,job_id,event_type,link_version,actor_user_id,reason,request_key)
     VALUES($1,$2,$3,'attached',$4,$5,$6,$7)`,
    [workspaceId, inserted.rows[0].id, job.id, inserted.rows[0].version, actorUserId, reason, requestKey],
  );
}

async function createRoot(
  client: PoolClient,
  workspaceId: string,
  source: Source & { type: "enquiry" | "opportunity" },
  actorUserId: string | null,
  reason: string,
  requestKey: string | null,
): Promise<JobIdentity> {
  const existing = await activeLink(client, workspaceId, source);
  if (existing) return existing;
  const prior = await client.query<JobIdentity>(
    `SELECT id,reference,workspace_id AS "workspaceId" FROM job_identities
      WHERE workspace_id=$1 AND root_type=$2 AND root_id=$3`,
    [workspaceId, source.type, source.id],
  );
  let job = prior.rows[0];
  if (!job) {
    const counter = await client.query<{ last_number: string }>(
      `INSERT INTO job_reference_counters(workspace_id,last_number) VALUES($1,1)
       ON CONFLICT(workspace_id) DO UPDATE SET last_number=job_reference_counters.last_number+1,updated_at=now()
       RETURNING last_number::text`,
      [workspaceId],
    );
    const reference = `J-${counter.rows[0].last_number.padStart(6, "0")}`;
    const inserted = await client.query<JobIdentity>(
      `INSERT INTO job_identities(workspace_id,reference,root_type,root_id,created_by)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(workspace_id,root_type,root_id) DO NOTHING
       RETURNING id,reference,workspace_id AS "workspaceId"`,
      [workspaceId, reference, source.type, source.id, actorUserId],
    );
    job = inserted.rows[0] ?? (await client.query<JobIdentity>(
      `SELECT id,reference,workspace_id AS "workspaceId" FROM job_identities
        WHERE workspace_id=$1 AND root_type=$2 AND root_id=$3`,
      [workspaceId, source.type, source.id],
    )).rows[0];
    if (!job) throw new ConflictException("Job identity could not be reserved. Retry the command.");
  }
  await attach(client, workspaceId, job, source, actorUserId, reason, requestKey);
  return job;
}

async function sourceRow(
  client: PoolClient,
  workspaceId: string,
  source: Source,
): Promise<Row> {
  const queries: Record<JobLineageRecordType, { sql: string; params: unknown[] }> = {
    enquiry: {
      sql: `SELECT party_id::text AS "partyId" FROM crm_enquiries WHERE workspace_id=$1 AND id=$2`,
      params: [workspaceId, source.id],
    },
    lead: {
      sql: `SELECT lead.enquiry_id::text AS "parentId",lead.party_id::text AS "partyId",
                   enquiry.party_id::text AS "parentPartyId"
              FROM crm_leads lead JOIN crm_enquiries enquiry
                ON enquiry.workspace_id=lead.workspace_id AND enquiry.id=lead.enquiry_id
             WHERE lead.workspace_id=$1 AND lead.id=$2`,
      params: [workspaceId, source.id],
    },
    opportunity: {
      sql: `SELECT opportunity.lead_id::text AS "parentId",opportunity.party_id::text AS "partyId",
                   lead.party_id::text AS "parentPartyId"
              FROM crm_opportunities opportunity
              LEFT JOIN crm_leads lead ON lead.workspace_id=opportunity.workspace_id AND lead.id=opportunity.lead_id
             WHERE opportunity.workspace_id=$1 AND opportunity.id=$2`,
      params: [workspaceId, source.id],
    },
    case: {
      sql: `SELECT opportunity_id::text AS "parentId" FROM pre_project_cases WHERE workspace_id=$1 AND id=$2`,
      params: [workspaceId, source.id],
    },
    quote: {
      sql: `SELECT case_id::text AS "parentId",
                   (SELECT count(*)::int FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(content->'quotes')='array' THEN content->'quotes' ELSE '[]'::jsonb END
                   ) quote WHERE quote->>'id'=$3) AS "matches"
              FROM commercial_cases WHERE workspace_id=$1 AND case_id=$2`,
      params: [workspaceId, source.caseId, source.id],
    },
    project: {
      sql: `SELECT case_id::text AS "parentId" FROM delivery_projects WHERE workspace_id=$1 AND id=$2`,
      params: [workspaceId, source.id],
    },
  };
  const query = queries[source.type];
  const result = await client.query<Row>(query.sql, query.params);
  const row = result.rows[0];
  if (!row) throw new NotFoundException("Job source record not found in this workspace.");
  if (source.type === "quote" && Number(row.matches) !== 1)
    throw new ConflictException("Quote identity is missing or ambiguous in the commercial case.");
  if ((source.type === "lead" || source.type === "opportunity") && row.parentId && row.partyId !== row.parentPartyId)
    throw new ConflictException("Job source and parent customer do not match.");
  if (source.type === "opportunity" && row.parentId && !row.parentPartyId)
    throw new ConflictException("The opportunity's lead is missing in this workspace.");
  return row;
}

/**
 * Idempotently resolve or create one Job from the authoritative source chain.
 * Call only inside the source command's tenant transaction; a failed attach
 * rolls that command back. Existing source facts and old routes are untouched.
 */
export async function ensureJobForSource(
  client: PoolClient,
  workspaceId: string,
  source: Source,
  actorUserId: string | null,
  reason = "source_command",
  requestKey: string | null = null,
): Promise<JobIdentity> {
  const existing = await activeLink(client, workspaceId, source);
  if (existing) return existing;
  const row = await sourceRow(client, workspaceId, source);
  if (source.type === "enquiry" || (source.type === "opportunity" && !row.parentId))
    return createRoot(client, workspaceId, source as Source & { type: "enquiry" | "opportunity" }, actorUserId, reason, requestKey);

  const parent: Source = source.type === "quote"
    ? { type: "case", id: String(row.parentId) }
    : source.type === "lead"
      ? { type: "enquiry", id: String(row.parentId) }
      : source.type === "opportunity"
        ? { type: "lead", id: String(row.parentId) }
        : source.type === "case"
          ? { type: "opportunity", id: String(row.parentId) }
          : { type: "case", id: String(row.parentId) };
  if (!row.parentId || row.parentId === "undefined" || row.parentId === "null")
    throw new ConflictException("Job source parent is missing in this workspace.");
  const job = await ensureJobForSource(client, workspaceId, parent, actorUserId, reason, requestKey);
  await attach(client, workspaceId, job, source, actorUserId, reason, requestKey);
  return job;
}

/**
 * Narrow repair: restore a missing or previously detached link only when the
 * authoritative source chain still resolves to this Job. A link assigned to a
 * different Job is never silently moved here (merge/split is out of scope).
 */
export async function repairJobSourceLink(
  client: PoolClient,
  workspaceId: string,
  jobId: string,
  source: Source,
  actorUserId: string,
  expectedVersion: number,
  requestKey: string,
  reason: string,
): Promise<{ jobId: string; source: Source; version: number; repaired: boolean }> {
  const target = await client.query<{ id: string; root_type: string; root_id: string }>(
    `SELECT id,root_type,root_id::text FROM job_identities WHERE workspace_id=$1 AND id=$2`,
    [workspaceId, jobId],
  );
  if (!target.rows[0]) throw new NotFoundException("Job not found.");
  const existing = await client.query<{ id: string; job_id: string; status: string; version: number }>(
    `SELECT id,job_id,status,version FROM job_identity_links
      WHERE workspace_id=$1 AND source_key=$2 FOR UPDATE`,
    [workspaceId, key(source)],
  );
  const link = existing.rows[0];
  if (link?.job_id && link.job_id !== jobId)
    throw new ConflictException("This source belongs to another Job; a reviewed merge/split is required.");
  if (link?.status === "active") {
    const replay = await client.query<{ reason: string }>(
      `SELECT reason FROM job_identity_link_events
        WHERE workspace_id=$1 AND link_id=$2 AND request_key=$3 ORDER BY occurred_at DESC LIMIT 1`,
      [workspaceId, link.id, requestKey],
    );
    if (replay.rows[0]?.reason === reason)
      return { jobId, source, version: link.version, repaired: false };
    throw new ConflictException("The Job link is already active; refresh before repairing.");
  }
  if (link && link.version !== expectedVersion)
    throw new ConflictException("The Job link changed; refresh before repairing.");
  if (!link && expectedVersion !== 0)
    throw new ConflictException("The missing Job link has no version; use expectedVersion 0.");

  const row = await sourceRow(client, workspaceId, source);
  if (source.type === "enquiry" || (source.type === "opportunity" && !row.parentId)) {
    if (target.rows[0].root_type !== source.type || target.rows[0].root_id !== source.id)
      throw new ConflictException("This root source belongs to another Job.");
  } else {
    const parent: Source = source.type === "quote"
      ? { type: "case", id: String(row.parentId) }
      : source.type === "lead"
        ? { type: "enquiry", id: String(row.parentId) }
        : source.type === "opportunity"
          ? { type: "lead", id: String(row.parentId) }
          : source.type === "case"
            ? { type: "opportunity", id: String(row.parentId) }
            : { type: "case", id: String(row.parentId) };
    if (!row.parentId) throw new ConflictException("The Job source parent is missing.");
    const parentJob = await ensureJobForSource(client, workspaceId, parent, actorUserId, reason, requestKey);
    if (parentJob.id !== jobId) throw new ConflictException("The source's parent belongs to another Job.");
  }
  if (!link) {
    const linked = await ensureJobForSource(client, workspaceId, source, actorUserId, reason, requestKey);
    if (linked.id !== jobId) throw new ConflictException("The source lineage belongs to another Job.");
    return { jobId, source, version: 1, repaired: true };
  }
  const updated = await client.query<{ version: number }>(
    `UPDATE job_identity_links SET status='active',detached_at=NULL,version=version+1,job_id=$3
      WHERE workspace_id=$1 AND id=$2 AND status='detached' AND version=$4
      RETURNING version`,
    [workspaceId, link.id, jobId, expectedVersion],
  );
  if (!updated.rows[0]) throw new ConflictException("The Job link changed; refresh before repairing.");
  await client.query(
    `INSERT INTO job_identity_link_events(workspace_id,link_id,job_id,event_type,link_version,actor_user_id,reason,request_key)
     VALUES($1,$2,$3,'reattached',$4,$5,$6,$7)`,
    [workspaceId, link.id, jobId, updated.rows[0].version, actorUserId, reason, requestKey],
  );
  return { jobId, source, version: updated.rows[0].version, repaired: true };
}
