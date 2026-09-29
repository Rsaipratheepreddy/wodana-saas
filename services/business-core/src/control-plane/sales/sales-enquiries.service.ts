import {
  BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../database/database.service";
import { TransactionalEmailService } from "../../email/transactional-email.service";
import { OperatorNotificationsService } from "../operator-notifications.service";
import { SalesContactFormService } from "./sales-contact-form.service";
import type { AddSalesEnquiryNoteDto, AssignSalesEnquiryDto, ChangeSalesEnquiryStatusDto, SubmitSalesEnquiryDto } from "./sales-enquiries.dto";
import {
  DEFAULT_CONSENT_TEXT,
  nextSalesEnquiryStatuses,
  normalizeSubmission,
  planStatusChange,
  REQUESTER_LIMIT_PER_HOUR,
  SalesEnquiryRuleError,
  salesEnquiryReference,
  spamVerdict,
  toCsv,
  TOTAL_LIMIT_PER_HOUR,
  type NormalizedSubmission,
  type SalesEnquiryStatus,
} from "./sales-enquiry.domain";

type Db = Pick<PoolClient, "query">;

type EnquiryRow = {
  id: string; number: string; name: string; email: string; company: string | null; countryCode: string | null;
  phone: string | null; teamSize: string | null; teamSizeLabel: string | null; message: string | null;
  consentText: string; consentedAt: Date; status: SalesEnquiryStatus; assigneeUserId: string | null;
  assigneeName: string | null; source: string; pagePath: string | null; referrer: string | null;
  utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; utmTerm: string | null; utmContent: string | null;
  locale: string | null; formVersion: number; contactedAt: Date | null; qualifiedAt: Date | null; closedAt: Date | null;
  version: number; createdAt: Date; updatedAt: Date;
};

const COLUMNS = `enquiry.id, enquiry.number::text AS number, enquiry.name, enquiry.email::text AS email, enquiry.company,
  enquiry.country_code AS "countryCode", enquiry.phone, enquiry.team_size AS "teamSize", enquiry.team_size_label AS "teamSizeLabel",
  enquiry.message, enquiry.consent_text AS "consentText", enquiry.consented_at AS "consentedAt", enquiry.status,
  enquiry.assignee_user_id AS "assigneeUserId", assignee.display_name AS "assigneeName", enquiry.source,
  enquiry.page_path AS "pagePath", enquiry.referrer, enquiry.utm_source AS "utmSource", enquiry.utm_medium AS "utmMedium",
  enquiry.utm_campaign AS "utmCampaign", enquiry.utm_term AS "utmTerm", enquiry.utm_content AS "utmContent",
  enquiry.locale, enquiry.form_version AS "formVersion", enquiry.contacted_at AS "contactedAt",
  enquiry.qualified_at AS "qualifiedAt", enquiry.closed_at AS "closedAt", enquiry.version,
  enquiry.created_at AS "createdAt", enquiry.updated_at AS "updatedAt"`;

const FROM = `FROM sales_enquiries enquiry LEFT JOIN users assignee ON assignee.id = enquiry.assignee_user_id`;

/** Search across the reference, name, email and company; plain text, no pattern characters. */
const FILTER = `($1::text IS NULL OR enquiry.status = $1)
  AND ($2::text IS NULL OR position(lower($2) IN lower(concat_ws(' ', 'se-' || lpad(enquiry.number::text, 4, '0'),
      enquiry.name, enquiry.email::text, enquiry.company))) > 0)`;

function summary(row: EnquiryRow) {
  return {
    id: row.id,
    reference: salesEnquiryReference(row.number),
    name: row.name,
    email: row.email,
    company: row.company,
    countryCode: row.countryCode,
    phone: row.phone,
    teamSize: row.teamSizeLabel,
    status: row.status,
    assignee: row.assigneeUserId ? { userId: row.assigneeUserId, name: row.assigneeName } : null,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

const ruleError = (error: unknown): never => {
  if (error instanceof SalesEnquiryRuleError) throw new BadRequestException(error.message);
  throw error;
};

/**
 * Enquiries from Wodana's public "Contact sales" form: the public submission (spam checks, rate limit,
 * notices to the configured recipients) and the operator reads and commands (status, assignee, notes, export).
 * Every command is version-checked, idempotent and written to the operator audit.
 */
@Injectable()
export class SalesEnquiriesService {
  private readonly logger = new Logger(SalesEnquiriesService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly forms: SalesContactFormService,
    private readonly email: TransactionalEmailService,
    private readonly config: ConfigService,
    private readonly notifications: OperatorNotificationsService,
  ) {}

  /** The visitor's address: the web server's forwarded one when it proves itself, else the connection's. */
  requesterAddress(input: { requester?: string; internalToken?: string; remote?: string }) {
    const expected = this.config.get<string>("BUSINESS_CORE_INTERNAL_TOKEN", "");
    const supplied = input.internalToken ?? "";
    const trusted = Boolean(expected && supplied.length === expected.length
      && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)));
    return (trusted && input.requester?.trim() ? input.requester.trim() : input.remote)?.slice(0, 100);
  }

  /** The connection is kept only as a keyed hash, for the per-connection limit. */
  requesterHash(address: string | undefined | null) {
    const value = address?.trim();
    if (!value) return null;
    const secret = this.config.get<string>("SALES_ENQUIRY_SECRET") || this.config.get<string>("BUSINESS_CORE_INTERNAL_TOKEN") || "wodana-sales-enquiry";
    return createHmac("sha256", secret).update(`sales-enquiry:${value.slice(0, 100)}`).digest("hex");
  }

  async submit(input: SubmitSalesEnquiryDto, requesterAddress: string | undefined) {
    const verdict = spamVerdict({ website: input.website, elapsedMs: input.elapsedMs });
    if (verdict === "too_fast") throw new BadRequestException("Please check your details, then send again.");
    const id = randomUUID();
    const requester = this.requesterHash(requesterAddress);
    const outcome = await this.database.transaction(async (client) => {
      await client.query("SELECT set_config('app.current_sales_enquiry_id', $1, true)", [id]);
      const form = await this.forms.current(client);
      // A filled honeypot gets the same thank-you as everyone, and nothing is stored.
      if (verdict === "honeypot") return { form, created: null };
      let values: NormalizedSubmission;
      try { values = normalizeSubmission(form.configuration, input); } catch (error) { return ruleError(error); }
      const recent = (await client.query<{ fromRequester: number; total: number }>(
        `SELECT from_requester AS "fromRequester", total FROM sales_enquiry_recent_submissions($1, 60)`, [requester])).rows[0];
      if ((requester && recent.fromRequester >= REQUESTER_LIMIT_PER_HOUR) || recent.total >= TOTAL_LIMIT_PER_HOUR) {
        throw new HttpException({ message: "We've received several enquiries from this connection. Please try again later.", retryAfter: 3600 },
          HttpStatus.TOO_MANY_REQUESTS);
      }
      const inserted = await client.query<{ number: string }>(
        `INSERT INTO sales_enquiries (id, request_key, form_version, name, email, company, country_code, phone, team_size,
            team_size_label, message, consent_text, consented_at, source, page_path, referrer, utm_source, utm_medium,
            utm_campaign, utm_term, utm_content, locale, requester_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         ON CONFLICT (request_key) DO NOTHING RETURNING number::text`,
        [id, input.requestId, form.version, values.name, values.email, values.company, values.countryCode, values.phone,
          values.teamSize, values.teamSizeLabel, values.message, form.configuration.consentLabel ?? DEFAULT_CONSENT_TEXT,
          input.source ?? "website", clip(input.pagePath, 300), clip(input.referrer, 500), clip(input.utm?.source, 150),
          clip(input.utm?.medium, 150), clip(input.utm?.campaign, 150), clip(input.utm?.term, 150), clip(input.utm?.content, 150),
          clip(input.locale, 35), requester]);
      // A replayed request (same request id) was already received and told; nothing more to do.
      if (!inserted.rowCount) return { form, created: null };
      const reference = salesEnquiryReference(inserted.rows[0].number);
      await client.query(
        `INSERT INTO platform_operator_audit (actor_user_id, action, target_type, target_id, correlation_id, details)
         VALUES (NULL, 'sales_enquiry.received', 'sales_enquiry', $1, $2, $3::jsonb)`,
        [id, input.requestId, JSON.stringify({ reference, source: input.source ?? "website", formVersion: form.version })]);
      const subject = `New sales enquiry ${reference}: ${values.company ?? values.name}`.slice(0, 200);
      for (const recipient of form.configuration.recipients) {
        await client.query(
          `INSERT INTO sales_enquiry_notices (enquiry_id, recipient_email, subject) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id, recipient, subject]);
      }
      // Everyone in Wodana Control who follows enquiries sees it in the portal too.
      await this.notifications.notify(client, {
        permission: "sales.read", eventType: "sales_enquiry.received", sourceType: "sales_enquiry", sourceId: id,
        // Data only (reference, company, name): the portal words the event in the operator's language.
        title: `${reference} · ${values.company ?? values.name}`,
        body: values.company ? values.name : null,
        link: `/internal/sales-enquiries?enquiry=${id}`,
      });
      return { form, created: { reference } };
    });
    if (outcome.created) {
      void this.deliver(id).catch((error: unknown) => this.logger.error(`Sales enquiry notices failed: ${(error as Error).message}`));
    }
    return {
      received: true,
      thankYouTitle: outcome.form.configuration.thankYouTitle,
      thankYouMessage: outcome.form.configuration.thankYouMessage,
    };
  }

  /** Emails the pending notices of one enquiry (Wodana brand) and records each provider result. */
  async deliver(enquiryId: string) {
    const scoped = <T>(work: (client: PoolClient) => Promise<T>) => this.database.transaction(async (client) => {
      await client.query("SELECT set_config('app.current_sales_enquiry_id', $1, true)", [enquiryId]);
      return work(client);
    });
    const pending = await scoped(async (client) => {
      const enquiry = (await client.query<EnquiryRow>(`SELECT ${COLUMNS} ${FROM} WHERE enquiry.id = $1`, [enquiryId])).rows[0];
      const notices = await client.query<{ id: string; recipient: string; subject: string }>(
        `SELECT id, recipient_email::text AS recipient, subject FROM sales_enquiry_notices
          WHERE enquiry_id = $1 AND status = 'pending' ORDER BY recipient_email`, [enquiryId]);
      return { enquiry, notices: notices.rows };
    });
    if (!pending.enquiry) return;
    const body = noticeBody(pending.enquiry);
    for (const notice of pending.notices) {
      const result = await this.email.sendOperatorNotice({
        to: notice.recipient, subject: notice.subject, body, consolePath: `/internal/sales-enquiries?enquiry=${enquiryId}`,
      }).catch(() => ({ status: "failed" as const, provider: null, messageId: null, suppressedReason: undefined }));
      await scoped((client) => client.query(
        `UPDATE sales_enquiry_notices SET status = $2, provider = $3, provider_message_id = $4, suppressed_reason = $5,
            attempts = attempts + 1, last_attempted_at = now()
          WHERE id = $1`,
        [notice.id, result.status, result.provider, result.messageId, result.suppressedReason ?? null]));
    }
  }

  async list(operatorUserId: string, filter: { status?: string; search?: string }) {
    return this.database.actorTransaction(operatorUserId, async (client) => {
      const rows = await client.query<EnquiryRow>(
        `SELECT ${COLUMNS} ${FROM} WHERE ${FILTER} ORDER BY enquiry.created_at DESC LIMIT 1000`,
        [filter.status ?? null, filter.search?.trim() || null]);
      const counts = await client.query<{ status: SalesEnquiryStatus; count: number }>(
        `SELECT status, count(*)::integer AS count FROM sales_enquiries GROUP BY status`);
      const byStatus = Object.fromEntries(counts.rows.map((row) => [row.status, row.count])) as Partial<Record<SalesEnquiryStatus, number>>;
      return {
        enquiries: rows.rows.map(summary),
        counts: byStatus,
        total: counts.rows.reduce((sum, row) => sum + row.count, 0),
        observedAt: new Date().toISOString(),
      };
    });
  }

  /** One enquiry; opening it reads this operator's notice about it. */
  async detail(operatorUserId: string, id: string) {
    return this.database.actorTransaction(operatorUserId, async (client) => {
      const detail = await this.read(client, id);
      await this.notifications.markSourceRead(client, "sales_enquiry", id);
      return detail;
    });
  }

  async assignees(operatorUserId: string) {
    return this.database.actorTransaction(operatorUserId, async (client) => {
      const rows = await client.query<{ userId: string; name: string; email: string }>(
        `SELECT operator.user_id AS "userId", app_user.display_name AS name, app_user.primary_email::text AS email
           FROM platform_administrators operator JOIN users app_user ON app_user.id = operator.user_id
          WHERE operator.status = 'active' AND app_user.status = 'active'
          ORDER BY app_user.display_name, app_user.primary_email`);
      return { assignees: rows.rows };
    });
  }

  async changeStatus(operatorUserId: string, id: string, input: ChangeSalesEnquiryStatusDto) {
    return this.database.actorTransaction(operatorUserId, async (client) => {
      const current = await this.lock(client, id);
      let plan: ReturnType<typeof planStatusChange>;
      try { plan = planStatusChange(current.status, input.status as SalesEnquiryStatus); } catch (error) {
        if (error instanceof SalesEnquiryRuleError) throw new ConflictException(error.message);
        throw error;
      }
      // Asking for the status it already has is a replay: nothing changes.
      if (!plan) return this.read(client, id);
      if (current.version !== input.expectedVersion) throw new ConflictException("This enquiry changed. Refresh and try again.");
      await client.query(
        `UPDATE sales_enquiries SET status = $2::text,
            contacted_at = COALESCE(contacted_at, $3::timestamptz), qualified_at = COALESCE(qualified_at, $4::timestamptz),
            closed_at = CASE WHEN $2::text IN ('won', 'lost') THEN $5::timestamptz ELSE NULL END,
            version = version + 1, updated_by = $6
          WHERE id = $1`,
        [id, plan.status, plan.contactedAt, plan.qualifiedAt, plan.closedAt, operatorUserId]);
      await this.audit(client, operatorUserId, id, "sales_enquiry.status_changed",
        { from: current.status, to: plan.status, reason: input.reason?.trim() || null, reopened: plan.reopened });
      return this.read(client, id);
    });
  }

  async assign(operatorUserId: string, id: string, input: AssignSalesEnquiryDto) {
    return this.database.actorTransaction(operatorUserId, async (client) => {
      const current = await this.lock(client, id);
      if (current.assigneeUserId === input.assigneeUserId) return this.read(client, id);
      if (current.version !== input.expectedVersion) throw new ConflictException("This enquiry changed. Refresh and try again.");
      let assigneeName: string | null = null;
      if (input.assigneeUserId) {
        const assignee = await client.query<{ name: string }>(
          `SELECT app_user.display_name AS name FROM platform_administrators operator
             JOIN users app_user ON app_user.id = operator.user_id
            WHERE operator.user_id = $1 AND operator.status = 'active' AND app_user.status = 'active'`, [input.assigneeUserId]);
        if (!assignee.rowCount) throw new BadRequestException("Choose an active Wodana operator.");
        assigneeName = assignee.rows[0].name;
      }
      await client.query(
        `UPDATE sales_enquiries SET assignee_user_id = $2, version = version + 1, updated_by = $3 WHERE id = $1`,
        [id, input.assigneeUserId, operatorUserId]);
      await this.audit(client, operatorUserId, id, "sales_enquiry.assigned",
        { from: current.assigneeUserId, fromName: current.assigneeName, to: input.assigneeUserId, toName: assigneeName });
      return this.read(client, id);
    });
  }

  async addNote(operatorUserId: string, id: string, input: AddSalesEnquiryNoteDto) {
    return this.database.actorTransaction(operatorUserId, async (client) => {
      await this.lock(client, id);
      const inserted = await client.query(
        `INSERT INTO sales_enquiry_notes (id, enquiry_id, body, created_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING RETURNING id`, [input.noteId, id, input.body.trim(), operatorUserId]);
      if (!inserted.rowCount) {
        const existing = await client.query(
          `SELECT 1 FROM sales_enquiry_notes WHERE id = $1 AND enquiry_id = $2 AND created_by = $3`, [input.noteId, id, operatorUserId]);
        if (!existing.rowCount) throw new ConflictException("This note key was already used.");
      } else {
        await this.audit(client, operatorUserId, id, "sales_enquiry.note_added", { noteId: input.noteId });
      }
      return this.read(client, id);
    });
  }

  /** Everything the list shows, and every answer, as CSV. */
  async exportCsv(operatorUserId: string, filter: { status?: string; search?: string }) {
    const rows = await this.database.actorTransaction(operatorUserId, async (client) => {
      const result = await client.query<EnquiryRow>(
        `SELECT ${COLUMNS} ${FROM} WHERE ${FILTER} ORDER BY enquiry.created_at DESC`,
        [filter.status ?? null, filter.search?.trim() || null]);
      await client.query(
        `INSERT INTO platform_operator_audit (actor_user_id, action, target_type, target_id, correlation_id, details)
         VALUES ($1, 'sales_enquiry.exported', 'sales_enquiry', NULL, $2, $3::jsonb)`,
        [operatorUserId, randomUUID(), JSON.stringify({ rows: result.rowCount, status: filter.status ?? null, search: filter.search ?? null })]);
      return result.rows;
    });
    const header = ["Reference", "Received", "Status", "Name", "Email", "Company", "Country", "Phone", "Team size", "Message",
      "Assignee", "Source", "Page", "Referrer", "UTM source", "UTM medium", "UTM campaign", "UTM term", "UTM content",
      "Consent", "Contacted", "Qualified", "Closed"];
    const csv = toCsv(header, rows.map((row) => [salesEnquiryReference(row.number), row.createdAt, row.status, row.name, row.email,
      row.company, row.countryCode, row.phone, row.teamSizeLabel, row.message, row.assigneeName, row.source, row.pagePath,
      row.referrer, row.utmSource, row.utmMedium, row.utmCampaign, row.utmTerm, row.utmContent, row.consentText,
      row.contactedAt, row.qualifiedAt, row.closedAt]));
    return { csv, fileName: `sales-enquiries-${new Date().toISOString().slice(0, 10)}.csv` };
  }

  private async lock(client: Db, id: string) {
    const row = (await client.query<{ status: SalesEnquiryStatus; version: number; assigneeUserId: string | null; assigneeName: string | null }>(
      `SELECT enquiry.status, enquiry.version, enquiry.assignee_user_id AS "assigneeUserId", assignee.display_name AS "assigneeName"
         FROM sales_enquiries enquiry LEFT JOIN users assignee ON assignee.id = enquiry.assignee_user_id
        WHERE enquiry.id = $1 FOR UPDATE OF enquiry`, [id])).rows[0];
    if (!row) throw new NotFoundException("Enquiry not found.");
    return row;
  }

  private audit(client: Db, operatorUserId: string, id: string, action: string, details: Record<string, unknown>) {
    return client.query(
      `INSERT INTO platform_operator_audit (actor_user_id, action, target_type, target_id, correlation_id, details)
       VALUES ($1, $2, 'sales_enquiry', $3, $4, $5::jsonb)`,
      [operatorUserId, action, id, randomUUID(), JSON.stringify(details)]);
  }

  private async read(client: Db, id: string) {
    const row = (await client.query<EnquiryRow>(`SELECT ${COLUMNS} ${FROM} WHERE enquiry.id = $1`, [id])).rows[0];
    if (!row) throw new NotFoundException("Enquiry not found.");
    const notes = await client.query<{ id: string; body: string; authorName: string | null; createdAt: Date }>(
      `SELECT note.id, note.body, author.display_name AS "authorName", note.created_at AS "createdAt"
         FROM sales_enquiry_notes note LEFT JOIN users author ON author.id = note.created_by
        WHERE note.enquiry_id = $1 ORDER BY note.created_at DESC, note.id`, [id]);
    const history = await client.query<{ id: string; action: string; actorName: string | null; details: Record<string, unknown>; createdAt: Date }>(
      `SELECT audit.id, audit.action, actor.display_name AS "actorName", audit.details, audit.created_at AS "createdAt"
         FROM platform_operator_audit audit LEFT JOIN users actor ON actor.id = audit.actor_user_id
        WHERE audit.target_type = 'sales_enquiry' AND audit.target_id = $1 ORDER BY audit.created_at DESC, audit.id`, [id]);
    const notices = await client.query<{ id: string; recipient: string; status: string; lastAttemptedAt: Date | null }>(
      `SELECT id, recipient_email::text AS recipient, status, last_attempted_at AS "lastAttemptedAt"
         FROM sales_enquiry_notices WHERE enquiry_id = $1 ORDER BY recipient_email`, [id]);
    return {
      ...summary(row),
      message: row.message,
      teamSizeId: row.teamSize,
      consentText: row.consentText,
      consentedAt: row.consentedAt,
      pagePath: row.pagePath,
      referrer: row.referrer,
      utm: { source: row.utmSource, medium: row.utmMedium, campaign: row.utmCampaign, term: row.utmTerm, content: row.utmContent },
      locale: row.locale,
      formVersion: row.formVersion,
      contactedAt: row.contactedAt,
      qualifiedAt: row.qualifiedAt,
      closedAt: row.closedAt,
      nextStatuses: nextSalesEnquiryStatuses(row.status),
      notes: notes.rows,
      history: history.rows.map((event) => ({ ...event, action: event.action.replace(/^sales_enquiry\./, "") })),
      notices: notices.rows,
    };
  }
}

function clip(value: string | null | undefined, max: number) {
  const text = value?.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/** The notice for Wodana's sales team: who wrote, how to reach them, and what they asked. */
function noticeBody(enquiry: EnquiryRow) {
  let country = enquiry.countryCode;
  try { if (country) country = new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? country; } catch { /* keep the code */ }
  const who = [enquiry.name, enquiry.company].filter(Boolean).join(" · ");
  const reach = [enquiry.email, enquiry.phone].filter(Boolean).join(" · ");
  const about = [country, enquiry.teamSizeLabel ? `Team size ${enquiry.teamSizeLabel}` : null].filter(Boolean).join(" · ");
  return [who, reach, about, enquiry.message].filter(Boolean).join("\n\n");
}
