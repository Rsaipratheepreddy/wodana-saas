import { BadRequestException, ConflictException, Injectable, NotFoundException, HttpException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import { randomBytes } from "node:crypto";
import { RequestActor } from "../../auth/actor";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { stableHash, decodeCursor, encodeCursor } from "../shared/crm-types";
import { loadLeadOptions, validateLeadOptions } from "../leads/lead-options";
import { ListIntakeQueryDto } from "./dto/intake.dto";
import { CrmIntakeService } from "./crm-intake.service";
import { defaultLeadForm, parseLeadForm, validateFormAnswers, type LeadFormSchema } from "./lead-form-schema";

@Injectable()
export class LeadFormsService {
  constructor(private readonly db: DatabaseService, private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService, private readonly intake: CrmIntakeService) {}

  list(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async client => {
      const result = await client.query(`SELECT id, token, draft, published, status, version, updated_at AS "updatedAt"
        FROM crm_lead_forms WHERE workspace_id=$1 ORDER BY updated_at DESC`, [workspaceId]);
      return { data: result.rows };
    });
  }

  responses(actor: RequestActor, workspaceId: string, id: string, query: ListIntakeQueryDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async client => {
      const form = await client.query(`SELECT 1 FROM crm_lead_forms WHERE workspace_id=$1 AND id=$2`, [workspaceId, id]);
      if (!form.rowCount) throw new NotFoundException("Form not found");
      const cursor = decodeCursor(query.cursor);
      if (query.cursor && (!cursor || Number.isNaN(Date.parse(cursor.value)) || !/^[0-9a-f-]{36}$/i.test(cursor.id))) throw new BadRequestException("Invalid page cursor");
      const result = await client.query(`SELECT intake.id, enquiry.reference, intake.original_payload->'party'->>'displayName' AS name,
        intake.status, intake.received_at AS "receivedAt", intake.original_payload->'formAnswers' AS answers
        FROM crm_intake_events intake LEFT JOIN crm_enquiries enquiry ON enquiry.intake_event_id=intake.id AND enquiry.workspace_id=intake.workspace_id
        WHERE intake.workspace_id=$1 AND intake.original_payload->>'formId'=$2
          AND ($3::timestamptz IS NULL OR (intake.received_at,intake.id) < ($3::timestamptz,$4::uuid))
        ORDER BY intake.received_at DESC, intake.id DESC LIMIT $5`, [workspaceId, id, cursor?.value ?? null, cursor?.id ?? null, query.limit + 1]);
      const data = result.rows.slice(0, query.limit), last = data.at(-1);
      return { data, nextCursor: result.rows.length > query.limit && last ? encodeCursor({ value: new Date(last.receivedAt).toISOString(), id: last.id }) : null };
    });
  }

  create(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, user) => {
      const choices = await loadLeadOptions(client, workspaceId);
      const result = await client.query(`INSERT INTO crm_lead_forms (workspace_id,token,draft,created_by)
        VALUES ($1,$2,$3,$4) RETURNING id,token,draft,published,status,version,updated_at AS "updatedAt"`,
        [workspaceId, randomBytes(24).toString("base64url"), defaultLeadForm(choices), user.userId]);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "crm.lead_form.created.v1", entityType: "crm_lead_form", entityId: result.rows[0].id, after: { status: "draft" } });
      return result.rows[0];
    });
  }

  update(actor: RequestActor, workspaceId: string, id: string, input: { version: number; draft?: unknown; action?: string }) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, user) => {
      const found = await client.query(`SELECT * FROM crm_lead_forms WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [workspaceId, id]);
      if (!found.rowCount) throw new NotFoundException("Form not found");
      const before = found.rows[0];
      if (before.version !== input.version) throw new ConflictException("This form changed. Reload before saving");
      const publishing = input.action === "publish";
      const draft = parseLeadForm(input.draft ?? before.draft, publishing);
      const choices = await loadLeadOptions(client, workspaceId);
      for (const question of draft.questions) {
        if (question.field === "serviceType") question.options = choices.enquiryTypes;
        if (question.field === "budgetRange") question.options = choices.budgetRanges;
      }
      if (publishing) {
        await validateLeadOptions(client, workspaceId, { source: draft.source, channel: draft.channel, serviceType: choices.enquiryTypes[0]?.id });
        const configured = await client.query(`SELECT 1 FROM crm_assignment_policies WHERE workspace_id=$1 AND status='active'
          UNION ALL SELECT 1 FROM crm_queues WHERE workspace_id=$1 AND status='active' AND is_fallback LIMIT 1`, [workspaceId]);
        if (!configured.rowCount) throw new BadRequestException("Set up a default sales team or routing rule before publishing");
      }
      const result = await client.query(`UPDATE crm_lead_forms SET draft=$3, published=$4, status=$5,
        version=version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2
        RETURNING id,token,draft,published,status,version,updated_at AS "updatedAt"`,
        [workspaceId, id, draft, publishing ? draft : before.published,
          publishing ? "published" : input.action === "pause" ? "paused" : before.status]);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: `crm.lead_form.${publishing ? "published" : input.action === "pause" ? "paused" : "updated"}.v1`, entityType: "crm_lead_form", entityId: id, before: { version: before.version, status: before.status }, after: { version: result.rows[0].version, status: result.rows[0].status } });
      return result.rows[0];
    });
  }

  private resolve(token: string) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new NotFoundException("Form not found");
    return this.db.transaction(async client => {
      await client.query("SELECT set_config('app.current_lead_form_token',$1,true)", [token]);
      const result = await client.query(`SELECT id,workspace_id,published FROM crm_lead_forms
        WHERE token=$1 AND status='published' AND published IS NOT NULL`, [token]);
      if (!result.rowCount) throw new NotFoundException("This form is not accepting enquiries");
      return result.rows[0] as { id: string; workspace_id: string; published: LeadFormSchema };
    });
  }

  async publicForm(token: string) {
    const form = await this.resolve(token);
    const { title, description, questions } = form.published;
    return { title, description, revision: stableHash(form.published), questions: questions.map(({ field, ...question }) => question) };
  }

  async submit(token: string, input: { requestId: string; revision: string; answers: Record<string, unknown> }) {
    const form = await this.resolve(token);
    return this.db.tenantTransaction(form.workspace_id, "00000000-0000-0000-0000-000000000000", async client => {
      // Serialize submissions to enforce per-form limits and check publication atomically.
      const current = await client.query(`SELECT published FROM crm_lead_forms WHERE workspace_id=$1 AND id=$2 AND status='published' FOR UPDATE`, [form.workspace_id, form.id]);
      if (!current.rowCount) throw new NotFoundException("This form is not accepting enquiries");
      const schema = current.rows[0].published as LeadFormSchema;
      if (stableHash(schema) !== input.revision) throw new ConflictException("The form has changed. Reload it before submitting");
      const { fields, responses } = validateFormAnswers(schema, input.answers);
      const key = `lead-form:${form.id}:${input.requestId}`;
      const existing = await client.query(`SELECT payload_hash, original_payload FROM crm_intake_events WHERE workspace_id=$1 AND idempotency_key=$2`, [form.workspace_id, key]);
      if (existing.rowCount) {
        if (!isDeepStrictEqual(existing.rows[0].original_payload.formAnswers, responses)) throw new ConflictException("This submission was already received with different answers");
        return { received: true };
      }
      const contactFingerprint = fields.mobile?.replace(/\D/g, "") || fields.email?.trim().toLowerCase();
      if (!contactFingerprint) throw new BadRequestException("Enter an email or mobile number");
      const rate = await client.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE
          COALESCE(NULLIF(regexp_replace(original_payload->'party'->>'mobile', '[^0-9]', '', 'g'), ''), lower(original_payload->'party'->>'email'))=$3
        )::int AS contact
        FROM crm_intake_events WHERE workspace_id=$1 AND original_payload->>'formId'=$2 AND received_at > now()-interval '10 minutes'`, [form.workspace_id, form.id, contactFingerprint]);
      if (rate.rows[0].total >= 200 || rate.rows[0].contact >= 5) throw new HttpException("Too many submissions. Please try again later", 429);
      await this.intake.createFormIntake(client, form.workspace_id, key, {
        source: schema.source, channel: schema.channel, intakeMethod: "form", title: "",
        party: { displayName: fields.displayName, email: fields.email, mobile: fields.mobile },
        serviceType: fields.serviceType || "not_sure", summary: fields.summary,
        details: { location: fields.location, budgetRange: fields.budgetRange }, assignment: { mode: "automatic" },
        originalPayload: { origin: "customer_enquiry_form", formId: form.id, formTitle: schema.title, formRevision: input.revision, formAnswers: responses },
      });
      return { received: true };
    });
  }
}
