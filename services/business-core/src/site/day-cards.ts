import type { PoolClient } from "pg";
import { changeReference } from "../change-requests/change-request.domain";
import { readCalendar, workdays, type WorkCalendar } from "../project-core/work-calendar";

type Db = Pick<PoolClient, "query">;

/**
 * Daily progress as day cards: one card per project and day, the unit everyone reads. A card is read from the
 * report tables (nothing is stored twice): who reported and when, the crew on site by trade, the work done
 * (linked to the plan's tasks and their stage, and the scope installed), the photos, the issues with their owner,
 * due date and state, materials received or used (the report's own, deliveries received at the site that day and
 * stock issued to the project), tomorrow's plan, and the approval and client visibility of each report.
 *
 * Several people may report the same day (a report is one per person, project and day, so each keeps its own
 * author, approval and offline history): their reports merge into one card, each item keeping its report so the
 * card can say who reported it.
 */

export type DayStatus = "draft" | "submitted" | "approved" | "returned";
export type IssueSeverity = "minor" | "major" | "critical";
export type IssueRaised = "snag" | "material" | "change_request";

export type DayReport = {
  id: string; authorId: string; authorName: string; status: DayStatus; version: number;
  submittedAt: string | null; decidedAt: string | null; decidedByName: string | null; decisionNote: string;
  /** Submitted after the day's end-of-day time (or still not by then). */
  late: boolean;
  /** Written on a later day than the day it's for (a missed day, or a phone that synced later). */
  backdated: boolean;
  delivery: "pending" | "internal" | "sent"; sentAt: string | null;
  /** Sent, then taken off the client's page. */
  hidden: boolean;
  noWorkReason: string; notes: string; clientSummary: string;
  safety: "none" | "observation" | "incident"; safetyNote: string;
  forecast: "none" | "watch" | "blocked"; impact: string; recoveryOwnerName: string | null; recoveryOn: string | null;
  /** While submitted: who can approve it. */
  waitingFor: string[];
  reactions: { like: number; love: number };
};

export type DayWork = {
  id: string; reportId: string; kind: "task" | "installed"; title: string; workItemId: string | null; number: number | null;
  progress: number | null; previous: number | null; stageId: string | null; stageName: string | null; packageName: string | null; area: string | null;
  quantity: string | null; unit: string; note: string; hidden: boolean;
};
export type DayPhoto = { id: string; reportId: string; area: string | null; phase: "before" | "after" | null; pairId: string | null; forClient: boolean; shared: boolean };
export type DayIssue = {
  id: string; reportId: string; severity: IssueSeverity; description: string; internal: boolean; status: "open" | "resolved";
  ownerId: string | null; ownerName: string | null; dueOn: string | null; overdue: boolean;
  resolvedAt: string | null; resolvedByName: string | null; resolution: string;
  raised: IssueRaised | null; workItemId: string | null; workItemNumber: number | null; changeRequestId: string | null; changeRequestReference: string | null;
  version: number;
};
export type DayMaterial = {
  id: string; reportId: string | null; direction: "received" | "used"; description: string; quantity: string | null; unit: string;
  /** Written in the report, a delivery received at the site that day, or stock issued to the project that day. */
  source: "report" | "delivery" | "stock"; reference: string | null;
};
export type DayCrew = { trade: string; people: number; source: "report" | "crew_day" };
export type DayNext = { id: string; reportId: string; title: string; workItemId: string | null; hidden: boolean };

export type DayCard = {
  date: string;
  /** The day as one state: anything waiting for review first, then sent back, a draft, and approved only when every report is. */
  status: DayStatus;
  /** Some report of the day is on the client's page. */
  clientVisible: boolean;
  reports: DayReport[];
  crew: DayCrew[]; people: number;
  work: DayWork[]; photos: DayPhoto[]; issues: DayIssue[]; materials: DayMaterial[]; next: DayNext[];
  /** For the feed's filters. */
  stageIds: string[]; trades: string[];
};

export type DayFeed = {
  from: string; to: string; today: string;
  cards: DayCard[];
  /** Working days (the workspace's calendar) in the range, since site work started, with no submitted report; newest first. */
  missing: string[];
  stages: Array<{ id: string; name: string }>;
  trades: string[];
};

type ReportRow = Omit<DayReport, "waitingFor" | "reactions"> & { date: string };

export type DayCardRows = {
  today: string;
  reports: ReportRow[];
  workforce: Array<{ reportId: string; trade: string; people: number }>;
  crewDays: Array<{ date: string; trade: string; people: number }>;
  work: DayWork[];
  photos: DayPhoto[];
  issues: Array<Omit<DayIssue, "overdue">>;
  materials: Array<DayMaterial & { date: string; purchaseOrderId?: string | null; stockTransferId?: string | null }>;
  received: Array<{ date: string; id: string; kind: "order" | "transfer"; orderId: string | null; transferId: string | null; label: string }>;
  issued: Array<{ date: string; id: string; description: string; quantity: string; unit: string }>;
  next: DayNext[];
  reactions: Array<{ reportId: string; reaction: "like" | "love"; count: number }>;
  approvers: Array<{ userId: string; name: string }>;
};

const tradeKey = (trade: string) => trade.trim().toLowerCase();
const STATUS_ORDER: DayStatus[] = ["submitted", "returned", "draft", "approved"];

/** The day's state from its reports' states. */
export function dayStatus(statuses: DayStatus[]): DayStatus {
  return STATUS_ORDER.find((status) => statuses.includes(status)) ?? "draft";
}

/**
 * The crew on site by trade: a crew's day on the project (named people present, from HR) replaces the reports'
 * headcount for its trade that day, so nobody is counted twice; other trades add up across the day's reports.
 */
export function crewOfDay(reports: Array<{ trade: string; people: number }>, crewDays: Array<{ trade: string; people: number }>): DayCrew[] {
  const named = new Map<string, DayCrew>();
  for (const row of crewDays) {
    if (row.people <= 0) continue;
    const key = tradeKey(row.trade);
    const current = named.get(key);
    named.set(key, { trade: current?.trade ?? row.trade.trim(), people: (current?.people ?? 0) + row.people, source: "crew_day" });
  }
  const counted = new Map<string, DayCrew>();
  for (const row of reports) {
    const key = tradeKey(row.trade);
    if (named.has(key)) continue;
    const current = counted.get(key);
    counted.set(key, { trade: current?.trade ?? row.trade.trim(), people: (current?.people ?? 0) + row.people, source: "report" });
  }
  return [...named.values(), ...counted.values()].sort((a, b) => b.people - a.people || a.trade.localeCompare(b.trade));
}

/**
 * The working days of a range that ended without a submitted (or approved) report: from site work's start to its
 * finish, never after today, only days the workspace works (its calendar and holidays), and today only once the
 * day's report is due. Newest first.
 */
export function missingWorkDays(input: { from: string; to: string; today: string; startedOn: string | null; finishedOn: string | null; reported: Iterable<string>;
  calendar: WorkCalendar; todayPastDue: boolean }): string[] {
  if (!input.startedOn) return [];
  const math = workdays(input.calendar);
  const reported = new Set(input.reported);
  const first = [input.from, input.startedOn].sort().at(-1)!;
  const last = [input.to, input.today, input.finishedOn ?? input.today].sort()[0];
  const days: string[] = [];
  for (let at = Date.parse(`${last}T00:00:00Z`); at >= Date.parse(`${first}T00:00:00Z`) && days.length < 400; at -= 86_400_000) {
    const day = new Date(at).toISOString().slice(0, 10);
    if (!math.isWorking(day) || reported.has(day)) continue;
    if (day === input.today && !input.todayPastDue) continue;
    days.push(day);
  }
  return days;
}

/** The cards from their rows: one per day with a report, newest first. Pure (the unit tests read it directly). */
export function buildDayCards(rows: DayCardRows): DayCard[] {
  const byDate = new Map<string, ReportRow[]>();
  for (const report of rows.reports) byDate.set(report.date, [...(byDate.get(report.date) ?? []), report]);
  const of = <T extends { reportId: string | null }>(list: T[], ids: Set<string>) => list.filter((item) => item.reportId !== null && ids.has(item.reportId));
  const cards: DayCard[] = [];
  for (const [date, reports] of [...byDate].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))) {
    const ids = new Set(reports.map((report) => report.id));
    const dayReports: DayReport[] = reports.map(({ date: _date, ...report }) => ({
      ...report,
      waitingFor: report.status === "submitted" ? rows.approvers.filter((person) => person.userId !== report.authorId).map((person) => person.name) : [],
      reactions: {
        like: rows.reactions.find((item) => item.reportId === report.id && item.reaction === "like")?.count ?? 0,
        love: rows.reactions.find((item) => item.reportId === report.id && item.reaction === "love")?.count ?? 0,
      },
    }));
    const crew = crewOfDay(rows.workforce.filter((row) => ids.has(row.reportId)), rows.crewDays.filter((row) => row.date === date));
    const work = of(rows.work, ids);
    const issues = of(rows.issues, ids).map((issue) => ({ ...issue, overdue: issue.status === "open" && Boolean(issue.dueOn && issue.dueOn < rows.today) }))
      // Open first, the most serious first; resolved ones last.
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1) || severityRank(b.severity) - severityRank(a.severity));
    const written = of(rows.materials, ids);
    // A delivery the report already names isn't listed twice.
    const linkedOrders = new Set(written.map((item) => item.purchaseOrderId).filter(Boolean));
    const linkedTransfers = new Set(written.map((item) => item.stockTransferId).filter(Boolean));
    const materials: DayMaterial[] = [
      ...written.map(({ date: _date, purchaseOrderId: _order, stockTransferId: _transfer, ...item }) => item),
      ...rows.received.filter((row) => row.date === date && !(row.orderId && linkedOrders.has(row.orderId)) && !(row.transferId && linkedTransfers.has(row.transferId)))
        .map((row) => ({ id: row.id, reportId: null, direction: "received" as const, description: row.label, quantity: null, unit: "", source: "delivery" as const, reference: row.label })),
      ...rows.issued.filter((row) => row.date === date)
        .map((row) => ({ id: row.id, reportId: null, direction: "used" as const, description: row.description, quantity: row.quantity, unit: row.unit, source: "stock" as const, reference: null })),
    ];
    const statuses = dayReports.map((report) => report.status);
    cards.push({
      date, status: dayStatus(statuses),
      clientVisible: dayReports.some((report) => report.delivery === "sent" && !report.hidden),
      reports: dayReports, crew, people: crew.reduce((sum, row) => sum + row.people, 0),
      work, photos: of(rows.photos, ids), issues, materials, next: of(rows.next, ids),
      stageIds: [...new Set(work.map((item) => item.stageId).filter((id): id is string => Boolean(id)))],
      trades: crew.map((row) => row.trade),
    });
  }
  return cards;
}

function severityRank(severity: IssueSeverity) {
  return severity === "critical" ? 2 : severity === "major" ? 1 : 0;
}

/** The workspace's date, minutes into its day, and when the day's report is due. */
async function clockOf(db: Db, workspaceId: string) {
  return (await db.query<{ today: string; minutes: number; dueTime: string }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today,
            (extract(hour FROM now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC')) * 60
              + extract(minute FROM now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC')))::int AS minutes,
            coalesce((SELECT to_char(report_due_time, 'HH24:MI') FROM workspace_project_settings WHERE workspace_id = workspaces.id), '18:00') AS "dueTime"
       FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
}

const DAY = 86_400_000;
export const shiftDay = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY).toISOString().slice(0, 10);
/** The longest range one read covers (a quarter): a progress report or "earlier" goes in steps. */
export const MAX_RANGE_DAYS = 92;

/**
 * A project's day cards for a range of days (or its latest `latest` days with a report), with the missing working
 * days and what the feed filters by. Reads only; access is the caller's.
 */
export async function readDayFeed(db: Db, workspaceId: string, projectId: string, input: { from?: string | null; to?: string | null; latest?: number | null;
  approvers?: Array<{ userId: string; name: string }>; sentOnly?: boolean } = {}): Promise<DayFeed> {
  const clock = await clockOf(db, workspaceId);
  const today = clock.today;
  let to = input.to && input.to < today ? input.to : today;
  let from = input.from ?? shiftDay(to, -27);
  if (input.latest) {
    const days = (await db.query<{ day: string }>(
      `SELECT DISTINCT report_date::text AS day FROM site_reports WHERE workspace_id = $1 AND project_id = $2 AND report_date <= $3::date
          AND ($4::boolean = false OR (delivery = 'sent' AND client_hidden_at IS NULL)) ORDER BY day DESC LIMIT $5`,
      [workspaceId, projectId, today, input.sentOnly === true, Math.min(Math.max(1, input.latest), 31)])).rows.map((row) => row.day);
    to = days[0] ?? today;
    from = days.at(-1) ?? today;
  }
  if (from > to) from = to;
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > (MAX_RANGE_DAYS - 1) * DAY) from = shiftDay(to, -(MAX_RANGE_DAYS - 1));
  const project = (await db.query<{ caseId: string; started: string | null; finished: string | null }>(
    `SELECT case_id AS "caseId", site_started_on::text AS started, site_finished_on::text AS finished FROM delivery_projects WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, projectId])).rows[0];
  const reports = (await db.query<ReportRow & { submittedAt: Date | string | null; decidedAt: Date | string | null; sentAt: Date | string | null }>(
    `SELECT report.id, report.report_date::text AS date, report.author_id AS "authorId", author.display_name AS "authorName", report.status, report.version,
            report.submitted_at AS "submittedAt", report.decided_at AS "decidedAt", decider.display_name AS "decidedByName", report.decision_note AS "decisionNote",
            coalesce(report.submitted_at > ((report.report_date + settings.due) AT TIME ZONE zone.name),
                     report.status = 'draft' AND now() > ((report.report_date + settings.due) AT TIME ZONE zone.name)) AS late,
            ((report.created_at AT TIME ZONE zone.name)::date > report.report_date) AS backdated,
            report.delivery, report.sent_at AS "sentAt", (report.client_hidden_at IS NOT NULL) AS hidden,
            report.no_work_reason AS "noWorkReason", report.notes, report.client_summary AS "clientSummary", report.safety, report.safety_note AS "safetyNote",
            report.forecast, report.impact, owner_user.display_name AS "recoveryOwnerName", report.recovery_on::text AS "recoveryOn"
       FROM site_reports report
       JOIN workspaces workspace ON workspace.id = report.workspace_id
       CROSS JOIN LATERAL (SELECT coalesce(nullif(workspace.default_timezone, ''), 'UTC') AS name) zone
       CROSS JOIN LATERAL (SELECT coalesce((SELECT report_due_time FROM workspace_project_settings WHERE workspace_id = report.workspace_id), time '18:00') AS due) settings
       JOIN users author ON author.id = report.author_id
       LEFT JOIN users decider ON decider.id = report.decided_by
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = report.workspace_id AND owner.id = report.recovery_owner_id
       LEFT JOIN users owner_user ON owner_user.id = owner.user_id
      WHERE report.workspace_id = $1 AND report.project_id = $2 AND report.report_date BETWEEN $3::date AND $4::date
        AND ($5::boolean = false OR (report.delivery = 'sent' AND report.client_hidden_at IS NULL))
      ORDER BY report.report_date DESC, report.created_at`, [workspaceId, projectId, from, to, input.sentOnly === true])).rows
    .map((row) => ({ ...row, late: Boolean(row.late), backdated: Boolean(row.backdated), hidden: Boolean(row.hidden),
      submittedAt: iso(row.submittedAt), decidedAt: iso(row.decidedAt), sentAt: iso(row.sentAt) }));
  const ids = reports.map((report) => report.id);
  const workforce = (await db.query<{ reportId: string; trade: string; people: number }>(
    `SELECT report_id AS "reportId", trade, people FROM site_report_workforce WHERE workspace_id = $1 AND report_id = ANY($2::uuid[]) ORDER BY trade`, [workspaceId, ids])).rows;
  const crewDays = (await db.query<{ date: string; trade: string; people: number }>(
    `SELECT day.work_date::text AS date, crew.trade, count(*) FILTER (WHERE worker.presence IN ('present', 'half_day'))::int AS people
       FROM hrms_crew_days day
       JOIN hrms_crews crew ON crew.workspace_id = day.workspace_id AND crew.id = day.crew_id
       JOIN hrms_crew_day_workers worker ON worker.workspace_id = day.workspace_id AND worker.crew_day_id = day.id
      WHERE day.workspace_id = $1 AND day.project_id = $2 AND day.work_date BETWEEN $3::date AND $4::date AND day.status IN ('submitted', 'approved')
      GROUP BY day.work_date, crew.trade`, [workspaceId, projectId, from, to])).rows;
  const tasks = (await db.query<DayWork>(
    `SELECT entry.id, entry.report_id AS "reportId", 'task' AS kind, item.title, entry.work_item_id AS "workItemId", item.number, entry.progress, entry.previous,
            item.stage_id AS "stageId", stage.name AS "stageName", package.name AS "packageName", NULL AS area, NULL AS quantity, '' AS unit, entry.note, entry.hidden
       FROM site_report_tasks entry
       JOIN work_items item ON item.workspace_id = entry.workspace_id AND item.id = entry.work_item_id
       LEFT JOIN project_stages stage ON stage.workspace_id = item.workspace_id AND stage.id = item.stage_id
       LEFT JOIN project_packages package ON package.workspace_id = item.workspace_id AND package.id = item.package_id
      WHERE entry.workspace_id = $1 AND entry.report_id = ANY($2::uuid[]) ORDER BY entry.position, item.number`, [workspaceId, ids])).rows;
  const installed = (await db.query<DayWork>(
    `SELECT entry.id, entry.report_id AS "reportId", 'installed' AS kind, line.title, NULL AS "workItemId", NULL::int AS number, NULL::int AS progress, NULL::int AS previous,
            NULL AS "stageId", NULL AS "stageName", package.name AS "packageName", room.name AS area, entry.installed::text AS quantity, line.unit, entry.note, false AS hidden
       FROM site_report_lines entry
       JOIN project_boq_lines line ON line.workspace_id = entry.workspace_id AND line.id = entry.boq_line_id
       LEFT JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = line.package_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = $3 AND room.id = line.area_id
      WHERE entry.workspace_id = $1 AND entry.report_id = ANY($2::uuid[]) ORDER BY line.position`, [workspaceId, ids, project?.caseId ?? null])).rows;
  const photos = (await db.query<DayPhoto>(
    `SELECT photo.id, photo.report_id AS "reportId", room.name AS area, photo.phase, photo.pair_id AS "pairId", photo.for_client AS "forClient", photo.shared_at IS NOT NULL AS shared
       FROM site_report_photos photo
       LEFT JOIN pre_project_rooms room ON room.workspace_id = photo.workspace_id AND room.case_id = $3 AND room.id = photo.area_id
      WHERE photo.workspace_id = $1 AND photo.report_id = ANY($2::uuid[]) AND photo.mime_type LIKE 'image/%' ORDER BY photo.position, photo.created_at`,
    [workspaceId, ids, project?.caseId ?? null])).rows;
  const issues = (await db.query<Omit<DayIssue, "overdue" | "changeRequestReference"> & { changeRequestNumber: number | null; resolvedAt: Date | string | null }>(
    `SELECT issue.id, issue.report_id AS "reportId", issue.severity, issue.description, issue.internal, issue.status, issue.owner_membership_id AS "ownerId",
            owner_user.display_name AS "ownerName", issue.due_on::text AS "dueOn", issue.resolved_at AS "resolvedAt", resolver.display_name AS "resolvedByName", issue.resolution,
            issue.raised, issue.work_item_id AS "workItemId", item.number AS "workItemNumber", issue.change_request_id AS "changeRequestId", change.number AS "changeRequestNumber", issue.version
       FROM site_report_issues issue
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = issue.workspace_id AND owner.id = issue.owner_membership_id
       LEFT JOIN users owner_user ON owner_user.id = owner.user_id
       LEFT JOIN users resolver ON resolver.id = issue.resolved_by
       LEFT JOIN work_items item ON item.workspace_id = issue.workspace_id AND item.id = issue.work_item_id
       LEFT JOIN change_requests change ON change.workspace_id = issue.workspace_id AND change.id = issue.change_request_id
      WHERE issue.workspace_id = $1 AND issue.report_id = ANY($2::uuid[]) ORDER BY issue.position`, [workspaceId, ids])).rows
    .map(({ changeRequestNumber, ...issue }) => ({ ...issue, resolvedAt: iso(issue.resolvedAt), changeRequestReference: changeRequestNumber ? changeReference(changeRequestNumber) : null }));
  const materials = (await db.query<DayMaterial & { date: string; purchaseOrderId: string | null; stockTransferId: string | null }>(
    `SELECT material.id, material.report_id AS "reportId", report.report_date::text AS date, material.direction, material.description, material.quantity::text AS quantity, material.unit,
            'report' AS source, coalesce(purchase.number::text, 'Move ' || transfer.number) AS reference, material.purchase_order_id AS "purchaseOrderId", material.stock_transfer_id AS "stockTransferId"
       FROM site_report_materials material
       JOIN site_reports report ON report.workspace_id = material.workspace_id AND report.id = material.report_id
       LEFT JOIN purchase_orders purchase ON purchase.workspace_id = material.workspace_id AND purchase.id = material.purchase_order_id
       LEFT JOIN stock_transfers transfer ON transfer.workspace_id = material.workspace_id AND transfer.id = material.stock_transfer_id
      WHERE material.workspace_id = $1 AND material.report_id = ANY($2::uuid[]) ORDER BY material.position`, [workspaceId, ids])).rows;
  const days = [...new Set(reports.map((report) => report.date))];
  const received = days.length ? (await db.query<DayCardRows["received"][number]>(
    `SELECT receipt.received_on::text AS date, receipt.id, 'order' AS kind, receipt.order_id AS "orderId", NULL::uuid AS "transferId",
            purchase.number || ' · ' || vendor.display_name AS label
       FROM goods_receipts receipt
       JOIN stock_locations place ON place.workspace_id = receipt.workspace_id AND place.id = receipt.location_id AND place.kind = 'site' AND place.project_id = $2
       JOIN purchase_orders purchase ON purchase.workspace_id = receipt.workspace_id AND purchase.id = receipt.order_id
       JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
      WHERE receipt.workspace_id = $1 AND receipt.received_on = ANY($3::date[])
     UNION ALL
     SELECT transfer.received_on::text, transfer.id, 'transfer', NULL::uuid, transfer.id, 'Move ' || transfer.number
       FROM stock_transfers transfer
       JOIN stock_locations place ON place.workspace_id = transfer.workspace_id AND place.id = transfer.to_location_id AND place.kind = 'site' AND place.project_id = $2
      WHERE transfer.workspace_id = $1 AND transfer.status = 'received' AND transfer.received_on = ANY($3::date[])`, [workspaceId, projectId, days])).rows : [];
  // Stock issued to the project at its site that day, other than what approved installation took (that's the "installed" work).
  const issued = days.length ? (await db.query<DayCardRows["issued"][number]>(
    `SELECT movement.moved_on::text AS date, min(movement.id::text) AS id, item.name AS description, (-sum(movement.quantity))::numeric(18, 4)::text AS quantity, item.unit
       FROM stock_movements movement
       JOIN stock_items item ON item.workspace_id = movement.workspace_id AND item.id = movement.item_id
       JOIN stock_locations place ON place.workspace_id = movement.workspace_id AND place.id = movement.location_id AND place.kind = 'site' AND place.project_id = $2
      WHERE movement.workspace_id = $1 AND movement.kind = 'issue' AND movement.site_report_line_id IS NULL AND movement.moved_on = ANY($3::date[])
      GROUP BY movement.moved_on, item.id, item.name, item.unit HAVING sum(movement.quantity) < 0`, [workspaceId, projectId, days])).rows : [];
  const next = (await db.query<DayNext>(
    `SELECT id, report_id AS "reportId", title, work_item_id AS "workItemId", hidden FROM site_report_next WHERE workspace_id = $1 AND report_id = ANY($2::uuid[]) ORDER BY position`,
    [workspaceId, ids])).rows;
  const reactions = (await db.query<{ reportId: string; reaction: "like" | "love"; count: number }>(
    `SELECT report_id AS "reportId", reaction, count(*)::int AS count FROM site_report_reactions WHERE workspace_id = $1 AND report_id = ANY($2::uuid[]) GROUP BY report_id, reaction`,
    [workspaceId, ids])).rows;
  const cards = buildDayCards({ today, reports, workforce, crewDays, work: [...tasks, ...installed], photos, issues, materials, received, issued, next, reactions,
    approvers: input.approvers ?? [] });
  const [hour, minute] = clock.dueTime.split(":").map(Number);
  const reported = (await db.query<{ day: string }>(
    `SELECT DISTINCT report_date::text AS day FROM site_reports WHERE workspace_id = $1 AND project_id = $2 AND status IN ('submitted', 'approved') AND report_date BETWEEN $3::date AND $4::date`,
    [workspaceId, projectId, from, to])).rows.map((row) => row.day);
  const missing = input.sentOnly ? [] : missingWorkDays({ from, to, today, startedOn: project?.started ?? null, finishedOn: project?.finished ?? null, reported,
    calendar: await readCalendar(db, workspaceId), todayPastDue: clock.minutes >= hour * 60 + minute });
  const stages = (await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM project_stages WHERE workspace_id = $1 AND project_id = $2 AND status <> 'skipped' ORDER BY position`, [workspaceId, projectId])).rows;
  const trades = [...new Set(cards.flatMap((card) => card.trades))].sort((a, b) => a.localeCompare(b));
  return { from, to, today, cards, missing, stages, trades };
}

function iso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}
