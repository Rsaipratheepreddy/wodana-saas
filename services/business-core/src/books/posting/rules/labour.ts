import { Dec } from "../../../catalog-core/decimal";
import { readProjectCosts } from "../../../project-core/project-money";
import type { BooksSettings, Db, PendingEvent } from "../../ledger/ledger";
import { ISSUE_RETRY_INTERVAL, isIssue, issue, Lines, projectCompany, role, type RuleAdapter, settingsFor, SINGLE_ENABLED } from "../support";

/**
 * Labour (P14, P14b): every labour cost the project's Money tab counts (crew days and site or factory labour, the
 * `crew:` and `labour:` entries of readProjectCosts) posts as labour cost against labour absorbed. When a rate
 * changes the entry's amount, only the difference posts, as the entry's next revision (source id = entry id +
 * ":" + revision; `costed` first, `recosted` after). Labour absorbed carries no project, so the project's cost is
 * exactly what its Money tab counts.
 */

export type LabourEvent = PendingEvent & { projectId: string; entryKey: string; delta: string; currency: string; description: string };

/** Projects with labour: approved crew days, site reports and factory hours, and those already posted. */
async function labourProjects(db: Db, workspaceId: string, from: string) {
  return (await db.query<{ projectId: string; entityId: string | null }>(
    `SELECT candidate.project_id AS "projectId", coalesce(${projectCompany("candidate.project_id")}, ${SINGLE_ENABLED}) AS "entityId"
       FROM (SELECT day.project_id FROM hrms_crew_days day WHERE day.workspace_id = $1 AND day.status = 'approved' AND day.project_id IS NOT NULL AND day.work_date >= $2::date
             UNION SELECT report.project_id FROM site_reports report WHERE report.workspace_id = $1 AND report.status = 'approved' AND report.report_date >= $2::date
             UNION SELECT work.project_id FROM work_order_reports report JOIN work_orders work ON work.workspace_id = report.workspace_id AND work.id = report.work_order_id
                    WHERE report.workspace_id = $1 AND report.status = 'approved' AND report.hours IS NOT NULL AND work.project_id IS NOT NULL
             UNION SELECT line.project_id FROM books_journals journal
                     JOIN books_journal_lines line ON line.workspace_id = journal.workspace_id AND line.journal_id = journal.id AND line.project_id IS NOT NULL
                    WHERE journal.workspace_id = $1 AND journal.source_type = 'labour') candidate
      ORDER BY candidate.project_id`, [workspaceId, from])).rows;
}

/** What each labour entry of a project has posted so far (in the workspace currency) and how many revisions. */
async function postedLabour(db: Db, workspaceId: string, projectId: string) {
  const rows = (await db.query<{ key: string; revisions: number; amount: string }>(
    `SELECT regexp_replace(journal.source_id, ':[0-9]+$', '') AS key, count(DISTINCT journal.id)::int AS revisions,
            sum(CASE WHEN line.debit > 0 THEN line.doc_amount ELSE -line.doc_amount END)::text AS amount
       FROM books_journals journal
       JOIN books_journal_lines line ON line.workspace_id = journal.workspace_id AND line.journal_id = journal.id AND line.project_id = $2
      WHERE journal.workspace_id = $1 AND journal.source_type = 'labour'
      GROUP BY 1`, [workspaceId, projectId])).rows;
  return new Map(rows.map((row) => [row.key, { revisions: row.revisions, amount: Dec.of(row.amount ?? "0") }]));
}

/** P14 labour costed; P14b a rate change posts only the difference. */
export const labourCosted: RuleAdapter<LabourEvent> = {
  rule: "P14",
  sourceType: "labour",
  pending: async (db, workspaceId, settings: readonly BooksSettings[], limit) => {
    if (limit <= 0 || !settings.length) return [];
    const starts = new Map(settings.map((item) => [item.legalEntityId, item.startDate]));
    const earliest = settings.map((item) => item.startDate).sort()[0];
    const events: LabourEvent[] = [];
    for (const project of await labourProjects(db, workspaceId, earliest)) {
      if (events.length >= limit) break;
      const start = project.entityId ? starts.get(project.entityId) : earliest;
      if (!start) continue; // a company without the Ledger
      const costs = await readProjectCosts(db, workspaceId, project.projectId);
      const posted = await postedLabour(db, workspaceId, project.projectId);
      const current = new Map(costs.entries.filter((entry) => entry.source === "labour" && entry.on >= start).map((entry) => [entry.key, entry]));
      for (const key of new Set([...current.keys(), ...posted.keys()])) {
        const entry = current.get(key);
        const before = posted.get(key) ?? { revisions: 0, amount: Dec.ZERO };
        const delta = Dec.of(entry?.amount ?? "0").sub(before.amount);
        if (delta.isZero()) continue;
        const sourceId = `${key}:${before.revisions + 1}`;
        events.push({
          sourceType: "labour", sourceId, sourceEvent: before.revisions ? "recosted" : "costed", legalEntityId: project.entityId,
          eventDate: entry?.on ?? (await firstPostedDay(db, workspaceId, key)) ?? start, label: entry ? `${entry.description}` : key,
          href: `/workspace/projects/${project.projectId}/money`, projectId: project.projectId, entryKey: key, delta: delta.toFixed(4), currency: costs.currency,
          description: entry?.description ?? "Labour no longer counted",
        });
      }
    }
    if (!events.length) return events;
    // Not again within the retry interval while an issue is open (the same rule as every other source).
    {
      const waiting = new Set((await db.query<{ id: string }>(
        `SELECT source_id AS id FROM books_posting_issues WHERE workspace_id = $1 AND source_type = 'labour' AND resolved_at IS NULL
            AND last_seen_at > now() - interval '${ISSUE_RETRY_INTERVAL}' AND source_id = ANY($2::text[])`,
        [workspaceId, events.map((event) => event.sourceId)])).rows.map((row) => row.id));
      return events.filter((event) => !waiting.has(event.sourceId)).sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.sourceId.localeCompare(b.sourceId)).slice(0, limit);
    }
  },
  build: async (db, workspaceId, event) => {
    const settings = await settingsFor(db, workspaceId, event.legalEntityId);
    if (isIssue(settings)) return settings;
    if (event.currency !== settings.functionalCurrency) {
      return issue("currency_mismatch", `Labour is valued in ${event.currency}; this company keeps its books in ${settings.functionalCurrency}.`);
    }
    const lines = new Lines(event.currency)
      .debit(role("cost_labour"), event.delta, { projectId: event.projectId, description: event.description })
      .credit(role("labour_absorbed"), event.delta, { description: event.description });
    if (lines.lines.length < 2) return issue("no_cost", "The labour change rounds to nothing.");
    return {
      legalEntityId: settings.legalEntityId, eventDate: event.eventDate, currency: event.currency, description: event.description, lines: lines.lines,
      source: { type: "labour", id: event.sourceId, event: event.sourceEvent, label: event.label, href: event.href },
    };
  },
};

async function firstPostedDay(db: Db, workspaceId: string, key: string) {
  return (await db.query<{ day: string | null }>(
    `SELECT min(event_date)::text AS day FROM books_journals WHERE workspace_id = $1 AND source_type = 'labour' AND regexp_replace(source_id, ':[0-9]+$', '') = $2`,
    [workspaceId, key])).rows[0]?.day ?? null;
}
