import { BadRequestException } from "@nestjs/common";

/**
 * Management dashboards (PLM-134): the shared filter bar and the SQL every KPI starts from.
 *
 * Every KPI query runs inside the member's tenant transaction (forced RLS), and starts with the same parameter list,
 * so one filter bar means the same thing on every figure:
 *   $1 workspace · $2 first day (local date, inclusive) · $3 last day (local date, inclusive) · $4 Account Manager
 *   (membership) · $5 enquiry type (code) · $6 design package (id) · $7 client type (code) · $8 source (code)
 *   · $9 channel (code) · $10 region (administrative area code, e.g. an emirate) · $11 legal entity (id) · $12 now.
 * The workspace's own time zone, week start and base currency come from the workspace (its region pack), never from
 * constants: periods are local calendar days, months and weeks.
 *
 * A filter applies to a record through the sales record it belongs to (the opportunity, else the enquiry):
 *   - Account Manager: the opportunity's owner, else the enquiry's owner;
 *   - enquiry type, client type, source, channel and region: the enquiry's (an opportunity opened without an
 *     enquiry has none, so it drops out when one of these is filtered);
 *   - package: the design journey's package, else the package chosen in discovery;
 *   - entity: the opportunity's legal entity, else the entity the enquiry came in for; money rows (receipts,
 *     invoices) use their own entity.
 * A record that can't carry a filtered attribute never matches it (it is not counted as "all").
 */
export type ReportFilters = {
  from: string; to: string;
  accountManager: string | null; enquiryType: string | null; package: string | null; clientType: string | null;
  source: string | null; channel: string | null; region: string | null; entity: string | null;
};

export const FILTER_KEYS = ["accountManager", "enquiryType", "package", "clientType", "source", "channel", "region", "entity"] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.:\- ]{0,99}$/;

const validDate = (value: string) => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** The local date today in a time zone (YYYY-MM-DD). */
export function localDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Reads the filter bar from a query string. The period defaults to the current month to date (local); a period is
 * at most 366 days and never starts after it ends. Unknown or malformed values are refused, never ignored.
 */
export function parseFilters(query: Record<string, unknown>, today: string): ReportFilters {
  const text = (key: string) => {
    const value = query[key];
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BadRequestException(`Invalid ${key} filter`);
    return value.trim() || null;
  };
  const from = text("from") ?? `${today.slice(0, 8)}01`;
  const to = text("to") ?? today;
  if (!validDate(from) || !validDate(to)) throw new BadRequestException("Choose a valid period");
  if (from > to) throw new BadRequestException("The period starts after it ends");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw new BadRequestException("Choose a period of a year or less");
  const id = (key: string) => {
    const value = text(key);
    if (value && !UUID.test(value)) throw new BadRequestException(`Invalid ${key} filter`);
    return value;
  };
  const code = (key: string) => {
    const value = text(key);
    if (value && !CODE.test(value)) throw new BadRequestException(`Invalid ${key} filter`);
    return value;
  };
  return {
    from, to,
    accountManager: id("accountManager"), enquiryType: code("enquiryType"), package: id("package"), clientType: code("clientType"),
    source: code("source"), channel: code("channel"), region: code("region"), entity: id("entity"),
  };
}

/** The parameter list every KPI query takes (see the module comment for the positions). */
export function scopeParams(workspaceId: string, filters: ReportFilters, now: Date): unknown[] {
  return [workspaceId, filters.from, filters.to, filters.accountManager, filters.enquiryType, filters.package, filters.clientType,
    filters.source, filters.channel, filters.region, filters.entity, now.toISOString()];
}

/**
 * `p`: the period and the workspace's calendar. from_at/to_at bound the chosen local days; series_from_at starts the
 * 12-month trend (the eleven months before the period's last month, and that month); week_from_at starts the 12-week
 * trend on the workspace's week start; today is the local date now.
 */
export const P = `p AS (
  SELECT $1::uuid AS ws, workspace.tz, workspace.currency, workspace.week_start,
         ($2::date)::timestamp AT TIME ZONE workspace.tz AS from_at,
         (($3::date) + 1)::timestamp AT TIME ZONE workspace.tz AS to_at,
         (date_trunc('month', ($3::date)::timestamp) - interval '11 months') AT TIME ZONE workspace.tz AS series_from_at,
         (($3::date) - ((extract(dow FROM ($3::date))::int - workspace.week_start + 7) % 7) - 77)::timestamp AT TIME ZONE workspace.tz AS week_from_at,
         $4::uuid AS am, $5::text AS enquiry_type, $6::uuid AS package_id, $7::text AS client_type, $8::text AS source,
         $9::text AS channel, $10::text AS region, $11::uuid AS entity_id, $12::timestamptz AS now_at,
         ($12::timestamptz AT TIME ZONE workspace.tz)::date AS today
    FROM (SELECT COALESCE(NULLIF(btrim(w.default_timezone), ''), 'UTC') AS tz, btrim(w.default_currency) AS currency,
                 CASE WHEN w.week_starts_on BETWEEN 0 AND 6 THEN w.week_starts_on::int ELSE 1 END AS week_start
            FROM workspaces w WHERE w.id = $1::uuid) workspace
)`;

/** A JSON timestamp (an ISO text written by the app) as timestamptz, or null when it isn't one. */
export const stamp = (expression: string) => `CASE WHEN ${expression} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (${expression})::timestamptz END`;

/** Money in the base currency, net of tax by `ratio` (a share before tax; NULL = can't be separated, kept as is). */
export const netMoney = (amount: string, currency: string, ratio: string) =>
  `CASE WHEN btrim(${currency}) = p.currency AND ${amount} IS NOT NULL THEN round(${amount} * COALESCE(${ratio}, 1), 6)::text END`;
/** The dims that say whether a money row counts (base currency) and whether its tax was separated. */
export const moneyDims = (currency: string, ratio: string) =>
  `'currency', CASE WHEN btrim(${currency}) = p.currency THEN 'base' ELSE 'other' END, 'tax', CASE WHEN ${ratio} IS NULL THEN 'gross' ELSE 'net' END`;

/** A timestamp's local month (YYYY-MM) and week start (YYYY-MM-DD) in the workspace's calendar. */
export const month = (expression: string) => `to_char(date_trunc('month', (${expression}) AT TIME ZONE p.tz), 'YYYY-MM')`;
export const week = (expression: string) =>
  `to_char(((${expression}) AT TIME ZONE p.tz)::date - ((extract(dow FROM ((${expression}) AT TIME ZONE p.tz))::int - p.week_start + 7) % 7), 'YYYY-MM-DD')`;

const NAME = (user: string) => `COALESCE(NULLIF(btrim(${user}.display_name), ''), ${user}.primary_email)`;

/**
 * A won deal is cancelled when its order was cancelled (on the deal, or by a full refund) or its job (the planning
 * case) was cancelled; the earlier of the two dates. Cancelled deals stay recorded and are reported apart from Won.
 * `o` is a crm_opportunities alias, `pc` its pre_project_cases row.
 */
export const dealCancelledAt = (o: string, pc: string) => `least(
    (SELECT f.cancelled_at FROM crm_deal_fulfilment f WHERE f.workspace_id = ${o}.workspace_id AND f.opportunity_id = ${o}.id),
    CASE WHEN ${pc}.status = 'cancelled' THEN ${pc}.cancelled_at END)`;
/** Whether an opportunity was ever won: Won, or one of its proposals has its payment proof. */
export const everWon = (o: string) => `(${o}.status = 'won' OR EXISTS (SELECT 1 FROM crm_opportunity_proposals won_proposal
    WHERE won_proposal.workspace_id = ${o}.workspace_id AND won_proposal.opportunity_id = ${o}.id AND won_proposal.won_at IS NOT NULL))`;

/**
 * Opportunities with what the filters read, already filtered: one row per opportunity (`oc`). The package is the
 * design journey's, else the one chosen in discovery; the client and the Account Manager are named for lists.
 * `cancelled_at` is set on a won deal that was cancelled (dealCancelledAt), with why.
 */
export const OPPORTUNITIES = `oc AS (
  SELECT o.id AS opportunity_id, o.reference, o.title, o.status, o.stage_id, o.amount, btrim(o.currency_code) AS currency_code,
         o.owner_membership_id AS am, o.lead_id, o.closed_at, o.created_at, o.outcome_reason,
         CASE WHEN ${everWon("o")} THEN ${dealCancelledAt("o", "pc")} END AS cancelled_at,
         COALESCE(NULLIF(btrim((SELECT f.cancel_reason FROM crm_deal_fulfilment f WHERE f.workspace_id = o.workspace_id AND f.opportunity_id = o.id AND f.cancelled_at IS NOT NULL)), ''),
                  NULLIF(btrim(CASE WHEN pc.status = 'cancelled' THEN pc.cancellation_reason END), '')) AS cancel_reason,
         pc.id AS case_id, pc.status AS case_status, e.service_type AS enquiry_type,
         COALESCE(j.package_id, d.design_package_id) AS package_id, o.legal_entity_id AS entity_id,
         party.display_name AS client, ${NAME("am_user")} AS owner
    FROM crm_opportunities o CROSS JOIN p
    LEFT JOIN crm_leads l ON l.workspace_id = o.workspace_id AND l.id = o.lead_id
    LEFT JOIN crm_enquiries e ON e.workspace_id = o.workspace_id AND e.id = l.enquiry_id
    LEFT JOIN crm_opportunity_discovery d ON d.workspace_id = o.workspace_id AND d.opportunity_id = o.id
    LEFT JOIN pre_project_cases pc ON pc.workspace_id = o.workspace_id AND pc.opportunity_id = o.id
    LEFT JOIN design_journeys j ON j.workspace_id = o.workspace_id AND j.case_id = pc.id
    LEFT JOIN crm_parties party ON party.workspace_id = o.workspace_id AND party.id = o.party_id
    LEFT JOIN workspace_memberships am ON am.workspace_id = o.workspace_id AND am.id = o.owner_membership_id
    LEFT JOIN users am_user ON am_user.id = am.user_id
   WHERE o.workspace_id = p.ws
     AND (p.am IS NULL OR o.owner_membership_id = p.am)
     AND (p.enquiry_type IS NULL OR e.service_type = p.enquiry_type)
     AND (p.client_type IS NULL OR e.details->>'customerType' = p.client_type)
     AND (p.source IS NULL OR e.source = p.source)
     AND (p.channel IS NULL OR e.channel = p.channel)
     AND (p.region IS NULL OR e.details->>'emirate' = p.region)
     AND (p.package_id IS NULL OR COALESCE(j.package_id, d.design_package_id) = p.package_id)
)`;

/** As OPPORTUNITIES, with the entity filter too (records whose money has no entity of its own). */
export const OPPORTUNITY_ENTITY = `(p.entity_id IS NULL OR oc.entity_id = p.entity_id)`;

/** No filter that only an opportunity or an enquiry can carry is on (a record without either still counts then). */
export const NO_SALES_FILTERS = `(p.am IS NULL AND p.enquiry_type IS NULL AND p.client_type IS NULL AND p.source IS NULL AND p.channel IS NULL
  AND p.region IS NULL AND p.package_id IS NULL)`;

/**
 * Enquiries (leads) with what the filters read, already filtered, spam left out: one row per lead (`lc`). The lead's
 * opportunity (if it became one) gives the package and, first, the entity. Without the owner filter, a KPI applies the
 * Account Manager filter to whoever was responsible at the time (the response clock's owner, the owner a lead moved from).
 */
export const leadsCte = (ownerFilter = true) => `lc AS (
  SELECT l.id AS lead_id, l.status, l.created_at, l.owner_membership_id AS am, l.next_action_at, l.duplicate_of_lead_id,
         l.closed_at, l.disqualification_reason,
         e.reference, COALESCE(NULLIF(btrim(e.title), ''), e.reference) AS title, e.source, e.channel, e.original_source,
         e.service_type AS enquiry_type, party.display_name AS client, ${NAME("am_user")} AS owner, o.id AS opportunity_id
    FROM crm_leads l CROSS JOIN p
    JOIN crm_enquiries e ON e.workspace_id = l.workspace_id AND e.id = l.enquiry_id
    LEFT JOIN crm_intake_events intake ON intake.workspace_id = l.workspace_id AND intake.id = e.intake_event_id
    LEFT JOIN LATERAL (SELECT o.id, o.legal_entity_id FROM crm_opportunities o WHERE o.workspace_id = l.workspace_id AND o.lead_id = l.id
                        ORDER BY o.created_at, o.id LIMIT 1) o ON true
    LEFT JOIN crm_opportunity_discovery d ON d.workspace_id = l.workspace_id AND d.opportunity_id = o.id
    LEFT JOIN pre_project_cases pc ON pc.workspace_id = l.workspace_id AND pc.opportunity_id = o.id
    LEFT JOIN design_journeys j ON j.workspace_id = l.workspace_id AND j.case_id = pc.id
    LEFT JOIN crm_parties party ON party.workspace_id = l.workspace_id AND party.id = l.party_id
    LEFT JOIN workspace_memberships am ON am.workspace_id = l.workspace_id AND am.id = l.owner_membership_id
    LEFT JOIN users am_user ON am_user.id = am.user_id
   WHERE l.workspace_id = p.ws AND l.spam_at IS NULL
     ${ownerFilter ? "AND (p.am IS NULL OR l.owner_membership_id = p.am)" : ""}
     AND (p.enquiry_type IS NULL OR e.service_type = p.enquiry_type)
     AND (p.client_type IS NULL OR e.details->>'customerType' = p.client_type)
     AND (p.source IS NULL OR e.source = p.source)
     AND (p.channel IS NULL OR e.channel = p.channel)
     AND (p.region IS NULL OR e.details->>'emirate' = p.region)
     AND (p.package_id IS NULL OR COALESCE(j.package_id, d.design_package_id) = p.package_id)
     AND (p.entity_id IS NULL OR COALESCE(o.legal_entity_id, intake.legal_entity_id) = p.entity_id)
)`;
export const LEADS = leadsCte(true);

/**
 * The share of a quotation's value that is before tax: from the sealed pricing when the quotation started a project
 * (exact, line rates included), else the quotation's own tax rate. Used as `<amount> * ratio` for amounts that carry
 * tax (accepted values, payments). `quote` is a commercial_quotes alias.
 */
export const netRatio = (quote: string) => `COALESCE(
  (SELECT CASE WHEN (seal.snapshot->'pricing'->>'total')::numeric > 0
               THEN (seal.snapshot->'pricing'->>'net')::numeric / (seal.snapshot->'pricing'->>'total')::numeric END
     FROM project_scope_seals seal JOIN delivery_projects sealed ON sealed.workspace_id = seal.workspace_id AND sealed.id = seal.project_id
    WHERE seal.workspace_id = ${quote}.workspace_id AND sealed.case_id = ${quote}.case_id AND seal.quote_id = ${quote}.id
      AND (seal.snapshot->'pricing'->>'net') ~ '^-?[0-9]+(\\.[0-9]+)?$' AND (seal.snapshot->'pricing'->>'total') ~ '^-?[0-9]+(\\.[0-9]+)?$'
    ORDER BY seal.sealed_at DESC LIMIT 1),
  100 / (100 + ${quote}.tax_rate))`;

/** Links to the record behind a figure (the web routes). */
export const href = {
  lead: (id: string) => `/workspace/crm/leads?lead=${id}`,
  opportunity: (id: string) => `/workspace/crm/opportunities?record=${id}`,
  case: (id: string, section = "") => `/workspace/pre-projects/cases/${id}${section ? `/${section}` : ""}`,
  project: (id: string) => `/workspace/projects/${id}/overview`,
  invoice: (id: string) => `/workspace/finance/client-invoices?invoice=${id}`,
  financeRequest: (id: string) => `/workspace/finance/requests?request=${id}`,
  quote: (caseId: string, quoteId: string) => `/workspace/pre-projects/cases/${caseId}/quotations?quote=${encodeURIComponent(quoteId)}`,
};
