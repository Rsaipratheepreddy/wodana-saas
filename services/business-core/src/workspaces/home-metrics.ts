import { NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { currencyDecimals } from "../purchasing/orders";

// Structural copy of HomeMetrics in packages/contracts/src/home.ts (business-core does not depend on contracts).
type HomeMetricWeek = { start: string; value: string; count: number };
type HomeActivityEvent = { id: string; area: string; action: string; subject: string; actorName: string | null; at: string; href: string | null };
export type HomeMetrics = {
  generatedAt: string;
  timeZone: string;
  weekStartsOn: number;
  currency: string;
  enquiries?: { current: number; previous: number; weekly: HomeMetricWeek[] };
  quotes?: { issuedValue: string; previousIssuedValue: string; issuedCount: number; accepted: number; previousAccepted: number; awaiting: number; weekly: HomeMetricWeek[] };
  payments?: { received: string; previousReceived: string; due: string; weekly: HomeMetricWeek[] };
  projects?: { active: number; overdueTasks: number; onTrack: number; atRisk: number; late: number; weekly: HomeMetricWeek[] };
  activity?: HomeActivityEvent[];
  storage?: { usedBytes: string; quotaBytes: string | null; areas: { projects: string; planning: string; catalog: string; other: string } };
  followUps?: { open: number; overdue: number };
  orders?: { toReceive: number };
};

export type HomeMetricsAccess = {
  enquiries: boolean; quotes: boolean; payments: boolean; projects: boolean; manageProjects: boolean; activity: boolean; storage: boolean;
  followUps: boolean; orders: boolean;
};

type Db = Pick<PoolClient, "query">;
type WeekRow = { start: string; value: string | number; count: number | string };

/**
 * Local calendar of the workspace ($1 workspace, $2 now, $3 time zone, $4 week start 0=Sunday…6=Saturday):
 * `bounds` has this month so far and the same elapsed span of the previous month, `weeks` the last 8 local
 * weeks (oldest first, the current partial week last), `span` the earliest instant any section needs.
 */
const CALENDAR = `clock AS (
    SELECT $2::timestamptz AS now_at, ($2::timestamptz AT TIME ZONE $3::text) AS local_now
  ), bounds AS (
    SELECT clock.now_at, clock.local_now::date AS today,
      date_trunc('month', clock.local_now) AT TIME ZONE $3::text AS month_from,
      (date_trunc('month', clock.local_now) - interval '1 month') AT TIME ZONE $3::text AS previous_from,
      (clock.local_now - interval '1 month') AT TIME ZONE $3::text AS previous_to,
      clock.local_now::date - ((extract(dow FROM clock.local_now)::int - $4::int + 7) % 7) AS week_start
    FROM clock
  ), weeks AS (
    SELECT day::date AS start, day AT TIME ZONE $3::text AS from_at, (day + interval '7 days') AT TIME ZONE $3::text AS to_at
    FROM bounds CROSS JOIN LATERAL generate_series((bounds.week_start - 49)::timestamp, bounds.week_start::timestamp, interval '7 days') AS day
  ), span AS (
    SELECT least(bounds.previous_from, (SELECT min(weeks.from_at) FROM weeks)) AS from_at, bounds.now_at AS to_at FROM bounds
  )`;

/** Eight weekly buckets over the `events` CTE (columns `at`, `amount`), empty weeks included. */
const weekly = (value: string) => `(SELECT coalesce(json_agg(json_build_object('start', bucket.start::text, 'value', bucket.value, 'count', bucket.n) ORDER BY bucket.start), '[]'::json)
    FROM (SELECT weeks.start, count(event.at)::int AS n, ${value} AS value
          FROM weeks LEFT JOIN events event ON event.at >= weeks.from_at AND event.at < weeks.to_at
          GROUP BY weeks.start) bucket)`;
const COUNT_VALUE = "count(event.at)::text";
const MONEY_VALUE = "round(coalesce(sum(event.amount), 0), $6::int)::text";
/** An ISO timestamp kept in a JSON detail, or NULL when it is missing or malformed. */
const stamp = (expression: string) => `CASE WHEN ${expression} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (${expression})::timestamptz END`;

const weeks = (rows: unknown): HomeMetricWeek[] => (Array.isArray(rows) ? rows as WeekRow[] : [])
  .map((row) => ({ start: String(row.start), value: String(row.value), count: Number(row.count) }));
const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/** Coarse area of an audit action (else of the record it touched), used for the activity icon. */
export function activityArea(action: string, entityType = ""): string {
  const key = action.toLowerCase();
  if (key.startsWith("crm.")) return "sales";
  if (/^(pre_projects?|design|commercial)\./.test(key) || key.startsWith("quot")) return "planning";
  if (/^(projects?|project_[a-z_]+|work|work_order|site|handover|snag|factory|production_batch|purchase_order|goods_receipt|stock|warranty)\./.test(key)) return "projects";
  if (/^(receivables|finance|payables|client_invoice|invoice|supplier_invoice|supplier_payment|payment_run|petty_cash|accounting)\./.test(key)) return "finance";
  if (/^(hrms|member)\./.test(key) || /^workspace\.(member|invitation|owner_invit)/.test(key)) return "people";
  if (/^(workspace|role|business_unit|legal_entity|integration)\./.test(key)) return "settings";
  if (entityType.startsWith("crm_")) return "sales";
  if (entityType === "project") return "projects";
  if (entityType === "pre_project_case" || entityType === "commercial_case") return "planning";
  return "other";
}

function activityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  const id = encodeURIComponent(entityId);
  if (entityType === "crm_lead") return `/workspace/crm/leads?record=${id}`;
  if (entityType === "project") return `/workspace/projects/${id}/overview`;
  // A commercial case (quotation) is keyed by its pre-project case.
  if (entityType === "pre_project_case" || entityType === "commercial_case") return `/workspace/pre-projects/cases/${id}/overview`;
  return null;
}

function validTimeZone(value: string | null | undefined) {
  const zone = value?.trim() || "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return zone; } catch { return "UTC"; }
}

/**
 * Live Home metrics. Every query runs inside the caller's tenant RLS transaction, is bound to the workspace,
 * aggregates in SQL (no per-row queries) and buckets months and weeks in the workspace's own time zone
 * and week start. Sections the caller may not see are neither queried nor returned.
 */
export async function readHomeMetrics(client: Db, workspaceId: string, membershipId: string, access: HomeMetricsAccess, now: Date = new Date()): Promise<HomeMetrics> {
  const workspace = (await client.query<{ timeZone: string | null; weekStartsOn: number | string | null; currency: string }>(
    `SELECT default_timezone AS "timeZone", week_starts_on AS "weekStartsOn", btrim(default_currency) AS currency FROM workspaces WHERE id=$1`,
    [workspaceId],
  )).rows[0];
  if (!workspace) throw new NotFoundException("Workspace not found");
  const timeZone = validTimeZone(workspace.timeZone);
  const start = Number(workspace.weekStartsOn);
  const weekStartsOn = Number.isInteger(start) && start >= 0 && start <= 6 ? start : 1;
  const currency = workspace.currency.trim();
  const decimals = currencyDecimals(currency);
  const at = now.toISOString();
  const calendar = [workspaceId, at, timeZone, weekStartsOn];
  const result: HomeMetrics = { generatedAt: at, timeZone, weekStartsOn, currency };

  if (access.enquiries) {
    const row = (await client.query<{ current: number; previous: number; weekly: unknown }>(
      `WITH ${CALENDAR}, events AS (
         SELECT lead.created_at AS at, NULL::numeric AS amount FROM crm_leads lead CROSS JOIN span
         WHERE lead.workspace_id=$1 AND lead.created_at >= span.from_at AND lead.created_at < span.to_at
       )
       SELECT (SELECT count(*) FROM events CROSS JOIN bounds WHERE events.at >= bounds.month_from)::int AS current,
              (SELECT count(*) FROM events CROSS JOIN bounds WHERE events.at >= bounds.previous_from AND events.at < bounds.previous_to)::int AS previous,
              ${weekly(COUNT_VALUE)} AS weekly`,
      calendar,
    )).rows[0];
    result.enquiries = { current: Number(row?.current ?? 0), previous: Number(row?.previous ?? 0), weekly: weeks(row?.weekly) };
  }

  if (access.quotes) {
    // Issued = sent to the client (issuedAt), superseded revisions left out so a revised offer counts once.
    // Values include only quotations in the workspace currency; counts include every quotation.
    // Awaiting = issued and not yet decided by the client, on a case that is still open.
    const row = (await client.query<{ issuedValue: string; previousIssuedValue: string; issuedCount: number; accepted: number; previousAccepted: number; awaiting: number; weekly: unknown }>(
      `WITH ${CALENDAR}, quotes AS (
         SELECT ${stamp("quote.detail->>'issuedAt'")} AS issued_at,
                CASE WHEN quote.status='accepted' THEN ${stamp("quote.detail->>'decidedAt'")} END AS accepted_at,
                CASE WHEN btrim(quote.currency)=$5 THEN quote.total END AS amount, quote.status
         FROM commercial_quotes quote
         WHERE quote.workspace_id=$1 AND quote.kind='quotation'
           AND quote.status IN ('issued','accepted','changes_requested','declined','superseded','withdrawn')
       ), events AS (
         SELECT quotes.issued_at AS at, quotes.amount FROM quotes CROSS JOIN span
         WHERE quotes.status<>'superseded' AND quotes.issued_at >= span.from_at AND quotes.issued_at < span.to_at
       )
       SELECT round(coalesce((SELECT sum(events.amount) FROM events CROSS JOIN bounds WHERE events.at >= bounds.month_from), 0), $6::int)::text AS "issuedValue",
              round(coalesce((SELECT sum(events.amount) FROM events CROSS JOIN bounds WHERE events.at >= bounds.previous_from AND events.at < bounds.previous_to), 0), $6::int)::text AS "previousIssuedValue",
              (SELECT count(*) FROM events CROSS JOIN bounds WHERE events.at >= bounds.month_from)::int AS "issuedCount",
              (SELECT count(*) FROM quotes CROSS JOIN bounds WHERE quotes.accepted_at >= bounds.month_from AND quotes.accepted_at < bounds.now_at)::int AS accepted,
              (SELECT count(*) FROM quotes CROSS JOIN bounds WHERE quotes.accepted_at >= bounds.previous_from AND quotes.accepted_at < bounds.previous_to)::int AS "previousAccepted",
              (SELECT count(*) FROM commercial_quotes waiting
                 JOIN pre_project_cases pre_case ON pre_case.workspace_id=waiting.workspace_id AND pre_case.id=waiting.case_id
                WHERE waiting.workspace_id=$1 AND waiting.kind='quotation' AND waiting.status='issued' AND pre_case.status<>'cancelled')::int AS awaiting,
              ${weekly(MONEY_VALUE)} AS weekly`,
      [...calendar, currency, decimals],
    )).rows[0];
    result.quotes = {
      issuedValue: String(row?.issuedValue ?? "0"), previousIssuedValue: String(row?.previousIssuedValue ?? "0"),
      issuedCount: Number(row?.issuedCount ?? 0), accepted: Number(row?.accepted ?? 0), previousAccepted: Number(row?.previousAccepted ?? 0),
      awaiting: Number(row?.awaiting ?? 0), weekly: weeks(row?.weekly),
    };
  }

  if (access.payments) {
    // Received = finance-verified client receipts, dated when finance verified them (or reported, for older rows).
    // Due = what is still open on this month's live invoices and on not-yet-invoiced milestones due this month.
    const row = (await client.query<{ received: string; previousReceived: string; due: string; weekly: unknown }>(
      `WITH ${CALENDAR}, events AS (
         SELECT received.at, receipt.amount FROM commercial_receipts receipt
         CROSS JOIN LATERAL (SELECT ${stamp("coalesce(nullif(receipt.detail->>'verifiedAt',''), receipt.detail->>'reportedAt')")} AS at) received
         CROSS JOIN span
         WHERE receipt.workspace_id=$1 AND receipt.status='finance_verified' AND btrim(receipt.currency)=$5
           AND received.at >= span.from_at AND received.at < span.to_at
       ), month AS (
         SELECT date_trunc('month', clock.local_now)::date AS first_day, (date_trunc('month', clock.local_now) + interval '1 month')::date AS next_first FROM clock
       ), due_items AS (
         SELECT invoice.case_id, invoice.payment_id::text AS payment_id, invoice.total AS amount
         FROM client_invoices invoice CROSS JOIN month
         WHERE invoice.workspace_id=$1 AND invoice.status='issued' AND btrim(invoice.currency)=$5
           AND invoice.due_date >= month.first_day AND invoice.due_date < month.next_first
         UNION ALL
         SELECT payment.case_id, payment.id, payment.amount
         FROM commercial_payments payment CROSS JOIN month
         JOIN pre_project_cases pre_case ON pre_case.workspace_id=payment.workspace_id AND pre_case.id=payment.case_id AND pre_case.status<>'cancelled'
         LEFT JOIN commercial_quotes quote ON quote.workspace_id=payment.workspace_id AND quote.case_id=payment.case_id AND quote.id=payment.source_quote_id
         WHERE payment.workspace_id=$1 AND payment.amount > 0 AND payment.due_date >= month.first_day AND payment.due_date < month.next_first
           AND coalesce(nullif(btrim(payment.currency), ''), btrim(quote.currency), $5)=$5
           AND NOT EXISTS (SELECT 1 FROM client_invoices invoice WHERE invoice.workspace_id=payment.workspace_id
             AND invoice.case_id=payment.case_id AND invoice.payment_id=payment.id AND invoice.status='issued')
           AND NOT EXISTS (SELECT 1 FROM delivery_projects project WHERE project.workspace_id=payment.workspace_id
             AND project.case_id=payment.case_id AND project.status='cancelled')
       ), open_items AS (
         SELECT greatest(item.amount - CASE
             WHEN allocated.amount IS NOT NULL THEN allocated.amount
             WHEN payment.status='verified' AND NOT coalesce(jsonb_typeof(cases.content->'financeContext')='object', false) THEN payment.amount
             ELSE 0 END, 0) AS balance
         FROM due_items item
         LEFT JOIN commercial_payments payment ON payment.workspace_id=$1 AND payment.case_id=item.case_id AND payment.id=item.payment_id
         LEFT JOIN commercial_cases cases ON cases.workspace_id=$1 AND cases.case_id=item.case_id
         LEFT JOIN LATERAL (
           SELECT sum(allocation.amount) AS amount FROM commercial_allocations allocation
           JOIN commercial_receipts receipt ON receipt.workspace_id=allocation.workspace_id AND receipt.case_id=allocation.case_id
             AND receipt.id=allocation.receipt_id AND receipt.status='finance_verified'
           WHERE allocation.workspace_id=$1 AND allocation.case_id=item.case_id AND allocation.payment_id=item.payment_id
             AND allocation.detail->>'reversedAt' IS NULL
         ) allocated ON true
       )
       SELECT round(coalesce((SELECT sum(events.amount) FROM events CROSS JOIN bounds WHERE events.at >= bounds.month_from), 0), $6::int)::text AS received,
              round(coalesce((SELECT sum(events.amount) FROM events CROSS JOIN bounds WHERE events.at >= bounds.previous_from AND events.at < bounds.previous_to), 0), $6::int)::text AS "previousReceived",
              round(coalesce((SELECT sum(open_items.balance) FROM open_items), 0), $6::int)::text AS due,
              ${weekly(MONEY_VALUE)} AS weekly`,
      [...calendar, currency, decimals],
    )).rows[0];
    result.payments = {
      received: String(row?.received ?? "0"), previousReceived: String(row?.previousReceived ?? "0"), due: String(row?.due ?? "0"), weekly: weeks(row?.weekly),
    };
  }

  if (access.projects) {
    // The project-core list's scope: started projects, all of them with projects.manage, otherwise the ones the
    // member is assigned to. Of the active ones: late = off track or past the promised date (local today);
    // at risk = not late and marked at risk; on track = the rest. Overdue = open tasks (and subtasks) due before today.
    const row = (await client.query<{ active: number; overdueTasks: number; late: number; atRisk: number; onTrack: number; weekly: unknown }>(
      `WITH ${CALENDAR}, visible AS (
         SELECT project.id, project.status, project.health, project.promise_date, project.started_at FROM delivery_projects project
         WHERE project.workspace_id=$1 AND project.started_at IS NOT NULL AND ($6::boolean OR EXISTS (
           SELECT 1 FROM project_assignments assignment WHERE assignment.workspace_id=project.workspace_id
           AND assignment.project_id=project.id AND assignment.membership_id=$5 AND assignment.active))
       ), health AS (
         SELECT visible.id, visible.health='off_track' OR coalesce(visible.promise_date < bounds.today, false) AS late,
                visible.health='at_risk' AS at_risk
         FROM visible CROSS JOIN bounds WHERE visible.status='active'
       ), overdue AS (
         SELECT count(*)::int AS n FROM work_items item JOIN health ON health.id=item.project_id CROSS JOIN bounds
         WHERE item.workspace_id=$1 AND item.type='task' AND item.status NOT IN ('done','cancelled') AND item.due_date < bounds.today
       ), events AS (
         SELECT visible.started_at AS at, NULL::numeric AS amount FROM visible CROSS JOIN span
         WHERE visible.started_at >= span.from_at AND visible.started_at < span.to_at
       )
       SELECT (SELECT count(*) FROM health)::int AS active,
              (SELECT n FROM overdue) AS "overdueTasks",
              (SELECT count(*) FILTER (WHERE late) FROM health)::int AS late,
              (SELECT count(*) FILTER (WHERE NOT late AND at_risk) FROM health)::int AS "atRisk",
              (SELECT count(*) FILTER (WHERE NOT late AND NOT at_risk) FROM health)::int AS "onTrack",
              ${weekly(COUNT_VALUE)} AS weekly`,
      [...calendar, membershipId, access.manageProjects],
    )).rows[0];
    result.projects = {
      active: Number(row?.active ?? 0), overdueTasks: Number(row?.overdueTasks ?? 0),
      onTrack: Number(row?.onTrack ?? 0), atRisk: Number(row?.atRisk ?? 0), late: Number(row?.late ?? 0), weekly: weeks(row?.weekly),
    };
  }

  if (access.activity) {
    // The newest audited changes, never sign-in, MFA, session or platform-operator events; a record changed several
    // times in a row shows once, with its latest change (read from a bounded window of the newest events).
    const rows = (await client.query<{ id: string; action: string; entityType: string; entityId: string | null; at: Date | string; actorName: string | null; subject: string | null }>(
      `WITH newest AS (
         SELECT event.id, event.action, event.entity_type, event.entity_id, event.before, event.after, event.occurred_at, event.actor_user_id
         FROM audit_events event
         WHERE event.workspace_id=$1
           AND event.action !~ '^(security|auth|mfa|operator|support|platform|session)[._]'
           AND event.entity_type NOT LIKE 'auth%' AND event.entity_type NOT LIKE 'mfa%'
         ORDER BY event.occurred_at DESC, event.id DESC LIMIT 200
       ), latest AS (
         SELECT DISTINCT ON (newest.entity_type, coalesce(newest.entity_id::text, newest.id::text)) newest.*
         FROM newest ORDER BY newest.entity_type, coalesce(newest.entity_id::text, newest.id::text), newest.occurred_at DESC, newest.id DESC
       ), recent AS (
         SELECT * FROM latest ORDER BY occurred_at DESC, id DESC LIMIT 6
       )
       SELECT recent.id, recent.action, recent.entity_type AS "entityType", recent.entity_id::text AS "entityId", recent.occurred_at AS at,
              app_user.display_name AS "actorName",
              left(coalesce(project.name, opportunity.title, lead_party.display_name,
                nullif(recent.after->>'name',''), nullif(recent.after->>'title',''), nullif(recent.after->>'number',''),
                nullif(recent.before->>'name',''), nullif(recent.before->>'title',''), ''), 160) AS subject
       FROM recent
       LEFT JOIN users app_user ON app_user.id=recent.actor_user_id
       LEFT JOIN delivery_projects project ON recent.entity_type='project' AND project.workspace_id=$1 AND project.id=recent.entity_id
       LEFT JOIN pre_project_cases pre_case ON recent.entity_type IN ('pre_project_case','commercial_case')
         AND pre_case.workspace_id=$1 AND pre_case.id=recent.entity_id
       LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id=$1 AND opportunity.id=pre_case.opportunity_id
       LEFT JOIN crm_leads lead ON recent.entity_type='crm_lead' AND lead.workspace_id=$1 AND lead.id=recent.entity_id
       LEFT JOIN crm_parties lead_party ON lead_party.workspace_id=$1 AND lead_party.id=lead.party_id
       ORDER BY recent.occurred_at DESC, recent.id DESC`,
      [workspaceId],
    )).rows;
    result.activity = rows.map((row) => ({
      id: row.id, area: activityArea(row.action, row.entityType), action: row.action, subject: row.subject ?? "",
      actorName: row.actorName ?? null, at: iso(row.at), href: activityHref(row.entityType, row.entityId),
    }));
  }

  if (access.storage) {
    // Exactly the files the upload allowance counts (brand-asset-storage reserve()): managed objects plus the
    // legacy tables, de-duplicated by object key. Managed objects are classified by their key prefix.
    const row = (await client.query<{ used: string; projects: string; planning: string; catalog: string; other: string; quota: string | null }>(
      `WITH managed AS (
         SELECT object_key, byte_size::bigint AS byte_size FROM workspace_stored_objects
         WHERE workspace_id=$1 AND removed_at IS NULL
           AND (status='active' OR (status='pending' AND reservation_expires_at>now()))
       ), legacy AS (
         SELECT object_key, COALESCE(byte_size,expected_byte_size)::bigint AS byte_size, 'other' AS area
           FROM workspace_brand_assets WHERE workspace_id=$1 AND status IN ('pending','active')
         UNION ALL SELECT object_key, byte_size::bigint, 'planning' FROM pre_project_brief_assets WHERE workspace_id=$1
         UNION ALL SELECT object_key, byte_size::bigint, 'catalog' FROM workspace_catalog_assets WHERE workspace_id=$1 AND status='active'
         UNION ALL SELECT object_key, byte_size::bigint, 'other' FROM hrms_captures WHERE workspace_id=$1 AND object_key IS NOT NULL
         UNION ALL SELECT 'projects/' || execution.workspace_id || '/' || execution.project_id || '/' || (attachment.value->>'id'),
           COALESCE((attachment.value->>'bytes')::bigint,0), 'projects'
           FROM project_execution execution
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(execution.content->'files','[]'::jsonb)) AS attachment(value)
           WHERE execution.workspace_id=$1
       ), files AS (
         SELECT object_key, byte_size, CASE
             WHEN object_key LIKE 'projects/%' OR object_key LIKE 'site/%' OR object_key LIKE 'handover/%' THEN 'projects'
             WHEN object_key LIKE 'pre-projects/%' THEN 'planning'
             WHEN object_key LIKE 'catalog/%' OR object_key LIKE 'catalog-items/%' THEN 'catalog'
             ELSE 'other' END AS area
         FROM managed
         UNION ALL SELECT legacy.object_key, legacy.byte_size, legacy.area FROM legacy
         WHERE NOT EXISTS (SELECT 1 FROM managed WHERE managed.object_key=legacy.object_key)
       )
       SELECT COALESCE(sum(byte_size),0)::text AS used,
              COALESCE(sum(byte_size) FILTER (WHERE area='projects'),0)::text AS projects,
              COALESCE(sum(byte_size) FILTER (WHERE area='planning'),0)::text AS planning,
              COALESCE(sum(byte_size) FILTER (WHERE area='catalog'),0)::text AS catalog,
              COALESCE(sum(byte_size) FILTER (WHERE area='other'),0)::text AS other,
              (SELECT storage_quota_bytes::text FROM workspace_data_policies WHERE workspace_id=$1) AS quota
       FROM files`,
      [workspaceId],
    )).rows[0];
    result.storage = {
      usedBytes: String(row?.used ?? "0"), quotaBytes: row?.quota ?? null,
      areas: { projects: String(row?.projects ?? "0"), planning: String(row?.planning ?? "0"), catalog: String(row?.catalog ?? "0"), other: String(row?.other ?? "0") },
    };
  }

  if (access.followUps) {
    // The follow-ups list's "To do": every open reminder in the workspace (notes are not reminders); overdue = due before now.
    const row = (await client.query<{ open: number; overdue: number }>(
      `SELECT count(*)::int AS open, count(*) FILTER (WHERE activity.due_at < $2::timestamptz)::int AS overdue
       FROM crm_activities activity WHERE activity.workspace_id=$1 AND activity.status='pending' AND activity.type <> 'note'`,
      [workspaceId, at],
    )).rows[0];
    result.followUps = { open: Number(row?.open ?? 0), overdue: Number(row?.overdue ?? 0) };
  }

  if (access.orders) {
    // Orders placed with a supplier that have not fully arrived yet (the purchasing reminders' open orders).
    const row = (await client.query<{ toReceive: number }>(
      `SELECT count(*)::int AS "toReceive" FROM purchase_orders purchase
       WHERE purchase.workspace_id=$1 AND purchase.status IN ('sent', 'confirmed', 'partly_received')`,
      [workspaceId],
    )).rows[0];
    result.orders = { toReceive: Number(row?.toReceive ?? 0) };
  }

  return result;
}
