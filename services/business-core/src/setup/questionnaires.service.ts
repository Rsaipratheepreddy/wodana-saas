import { KIT_CONSULTATION_QUESTIONS } from "../crm/opportunities/consultation-questions";
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { canonicalHash } from "../crm/shared/crm-types";
import { normaliseSiteQuestions } from "../design/design-journey.domain";
import { UNRESOLVED_ENQUIRY_TYPE } from "../crm/leads/lead-options";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  healthCheck, isQuestionnairePurpose, KIT_QUESTIONS, normaliseQuestions, QUESTIONNAIRE_INFO, QUESTIONNAIRE_PURPOSES, type QuestionnairePurpose,
} from "./questionnaires.domain";
import { loadQuestionnaire, versionQuestions } from "./questionnaires.store";
import { normaliseInvoiceLayout, readInvoiceLayout } from "./document-layouts";
import { readCommissionTypes, saveCommissionTypes } from "./commission-types";
import { PUSH_EVENTS, readPushTemplates, savePushTemplates } from "../notifications/push-templates";
import { effectivePortalBrand } from "../commercial/effective-brand";

const MANAGE = "crm.settings.manage";

/**
 * §0.3 P3, Setup → Questionnaires: the firm's admin edits the questions asked at each step, checks them and publishes a
 * version, without a developer. A published version never changes; restoring an older one makes it the draft, and
 * publishing that is a new version. Every change is audited.
 */
@Injectable()
export class SetupQuestionnairesService {
  constructor(private readonly access: WorkspaceAccessService) {}

  /** Every questionnaire the firm uses: its own (draft, published version) and the two edited where they're used. */
  list(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client) => {
      const own = await Promise.all(QUESTIONNAIRE_PURPOSES.map(async (purpose) => {
        const stored = await loadQuestionnaire(client, workspaceId, purpose);
        const published = await versionQuestions(client, workspaceId, purpose, stored.publishedNumber) ?? KIT_QUESTIONS[purpose];
        return { purpose, name: QUESTIONNAIRE_INFO[purpose].name, step: QUESTIONNAIRE_INFO[purpose].step, questions: published.length,
          required: published.filter((question) => question.required).length, version: stored.publishedNumber,
          draftChanged: canonicalHash(stored.draft) !== canonicalHash(published), updatedAt: stored.updatedAt };
      }));
      const consultation = (await client.query<{ questions: number; required: number }>(
        `SELECT count(*)::int AS questions, count(*) FILTER (WHERE question.required)::int AS required FROM crm_qualification_forms form
           JOIN crm_qualification_questions question ON question.workspace_id = form.workspace_id AND question.form_id = form.id
          WHERE form.workspace_id = $1 AND form.purpose = 'discovery' AND form.status = 'active'`, [workspaceId])).rows[0];
      const site = normaliseSiteQuestions((await client.query<{ questions: unknown }>(`SELECT site_visit_questions AS questions FROM workspace_design_settings WHERE workspace_id = $1`,
        [workspaceId])).rows[0]?.questions);
      return {
        questionnaires: own,
        // Edited where they're used (their screens carry rooms, scopes and enquiry types); listed here so every question the firm asks is in one place.
        elsewhere: [
          // With no consultation form of its own the firm asks the kit's (all optional).
          { key: "consultation", name: "Consultation", step: "Asked at the intro meeting", questions: consultation?.questions || KIT_CONSULTATION_QUESTIONS.length, required: consultation?.required ?? 0, href: "/workspace/enquiry-types" },
          { key: "site_visit", name: "Site visit", step: "Answered on the site measure", questions: site.length, required: site.filter((question) => question.required).length, href: "/workspace/settings/design-packages" },
        ],
      };
    });
  }

  async get(actor: RequestActor, workspaceId: string, purpose: string) {
    const which = this.purpose(purpose);
    return this.access.withPermission(actor, workspaceId, MANAGE, (client) => this.read(client, workspaceId, which));
  }

  /** Saves the draft (version-checked; saving the same questions again changes nothing). */
  async saveDraft(actor: RequestActor, workspaceId: string, purpose: string, input: { revision: number; questions: unknown }) {
    const which = this.purpose(purpose);
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const before = await this.lock(client, workspaceId, which, input.revision);
      const questions = normaliseQuestions(input.questions);
      if (Array.isArray(input.questions) && questions.length < input.questions.length) throw new UnprocessableEntityException("Give every question a label, and each one its own.");
      if (canonicalHash(questions) === canonicalHash(before.draft)) return this.read(client, workspaceId, which);
      await client.query(
        `INSERT INTO setup_questionnaires (workspace_id, purpose, draft, revision, updated_by, updated_at) VALUES ($1, $2, $3::jsonb, 1, $4, now())
         ON CONFLICT (workspace_id, purpose) DO UPDATE SET draft = excluded.draft, revision = setup_questionnaires.revision + 1, updated_by = excluded.updated_by, updated_at = now()`,
        [workspaceId, which, JSON.stringify(questions), user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "setup.questionnaire_draft_saved.v1", entityType: "setup_questionnaire", entityId: workspaceId,
        before: { purpose: which, questions: before.draft }, after: { purpose: which, questions } });
      return this.read(client, workspaceId, which);
    });
  }

  /** Publishes the draft as the next version once its health check passes; new jobs answer it, running jobs keep theirs. */
  async publish(actor: RequestActor, workspaceId: string, purpose: string, input: { revision: number; note?: string | null }) {
    const which = this.purpose(purpose);
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const before = await this.lock(client, workspaceId, which, input.revision);
      const problems = healthCheck(before.draft);
      if (problems.length) throw new UnprocessableEntityException(problems.join(" "));
      const published = await versionQuestions(client, workspaceId, which, before.publishedNumber) ?? KIT_QUESTIONS[which];
      if (before.publishedNumber > 0 && canonicalHash(published) === canonicalHash(before.draft)) throw new ConflictException("Nothing has changed since the last version.");
      const number = before.publishedNumber + 1;
      await client.query(
        `INSERT INTO setup_questionnaires (workspace_id, purpose, draft, revision, updated_by, updated_at) VALUES ($1, $2, $3::jsonb, 1, $4, now())
         ON CONFLICT (workspace_id, purpose) DO NOTHING`, [workspaceId, which, JSON.stringify(before.draft), user.userId]);
      await client.query(`INSERT INTO setup_questionnaire_versions (workspace_id, purpose, number, questions, note, published_by) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [workspaceId, which, number, JSON.stringify(before.draft), (input.note ?? "").trim().slice(0, 500), user.userId]);
      await client.query(`UPDATE setup_questionnaires SET published_number = $3, revision = revision + 1, updated_by = $4, updated_at = now() WHERE workspace_id = $1 AND purpose = $2`,
        [workspaceId, which, number, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "setup.questionnaire_published.v1", entityType: "setup_questionnaire", entityId: workspaceId,
        before: { purpose: which, version: before.publishedNumber }, after: { purpose: which, version: number, questions: before.draft, note: input.note ?? null } });
      return this.read(client, workspaceId, which);
    });
  }

  /** Makes an older version (0 = the kit's questions) the draft; publishing it is a new version. */
  async restore(actor: RequestActor, workspaceId: string, purpose: string, input: { revision: number; number: number }) {
    const which = this.purpose(purpose);
    if (!Number.isInteger(input.number) || input.number < 0) throw new BadRequestException("Choose a version.");
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const before = await this.lock(client, workspaceId, which, input.revision);
      const questions = await versionQuestions(client, workspaceId, which, input.number);
      if (!questions) throw new NotFoundException("Version not found.");
      await client.query(
        `INSERT INTO setup_questionnaires (workspace_id, purpose, draft, revision, updated_by, updated_at) VALUES ($1, $2, $3::jsonb, 1, $4, now())
         ON CONFLICT (workspace_id, purpose) DO UPDATE SET draft = excluded.draft, revision = setup_questionnaires.revision + 1, updated_by = excluded.updated_by, updated_at = now()`,
        [workspaceId, which, JSON.stringify(questions), user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "setup.questionnaire_restored.v1", entityType: "setup_questionnaire", entityId: workspaceId,
        before: { purpose: which, questions: before.draft }, after: { purpose: which, from: input.number, questions } });
      return this.read(client, workspaceId, which);
    });
  }

  /** §0.3 P3/P4: the firm's invoice layout (configuration; amounts are always the system's). */
  invoiceLayout(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, MANAGE, (client) => readInvoiceLayout(client, workspaceId));
  }

  async saveInvoiceLayout(actor: RequestActor, workspaceId: string, input: { revision?: unknown; layout?: unknown }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      await client.query(`SELECT 1 FROM setup_document_layouts WHERE workspace_id = $1 AND kind = 'client_invoice' FOR UPDATE`, [workspaceId]);
      const before = await readInvoiceLayout(client, workspaceId);
      if (Number(input.revision) !== before.revision) throw new ConflictException("The invoice layout changed in another window. Reload and try again.");
      const layout = normaliseInvoiceLayout(input.layout);
      if (canonicalHash(layout) === canonicalHash(before.layout)) return before;
      await client.query(
        `INSERT INTO setup_document_layouts (workspace_id, kind, layout, revision, updated_by, updated_at) VALUES ($1, 'client_invoice', $2::jsonb, 1, $3, now())
         ON CONFLICT (workspace_id, kind) DO UPDATE SET layout = excluded.layout, revision = setup_document_layouts.revision + 1, updated_by = excluded.updated_by, updated_at = now()`,
        [workspaceId, JSON.stringify(layout), user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "setup.invoice_layout_saved.v1", entityType: "setup_document_layout", entityId: workspaceId,
        before: before.layout, after: layout });
      return readInvoiceLayout(client, workspaceId);
    });
  }

  /** §0.3 Push like a delivery app: each moment's push as the firm words it, with what it may use (facts, buttons, a sample). */
  pushTemplates(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client) => {
      const { templates, version } = await readPushTemplates(client, workspaceId);
      const brand = (await effectivePortalBrand(client, workspaceId)).name ?? "";
      return { version, templates: templates.map((template) => {
        const event = PUSH_EVENTS.find((item) => item.key === template.key)!;
        return { ...template, audience: event.audience, label: event.label, variables: event.variables, actions: event.actions,
          sample: { ...event.sample, ...(event.variables.includes("brand") && brand ? { brand } : {}) },
          kit: { title: event.title, body: event.body, action: event.action } };
      }) };
    });
  }

  savePushTemplates(actor: RequestActor, workspaceId: string, input: { version?: unknown; templates?: unknown }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('setup_push_templates:' || $1))`, [workspaceId]);
      const result = await savePushTemplates(client, workspaceId, user.userId, input);
      if (result.changed) await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "setup.push_templates_saved.v1", entityType: "setup_push_templates", entityId: workspaceId,
        before: result.before.templates, after: result.after.templates });
      return { version: result.after.version };
    });
  }

  /** §0.3 P3: the firm's commission types (anyone in the workspace reads them: the deal file offers them). */
  commissionTypes(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, (client) => readCommissionTypes(client, workspaceId));
  }

  saveCommissionTypes(actor: RequestActor, workspaceId: string, input: { version?: unknown; types?: unknown }) {
    return this.access.withPermission(actor, workspaceId, MANAGE, async (client, user) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('setup_commission_types:' || $1))`, [workspaceId]);
      const result = await saveCommissionTypes(client, workspaceId, user.userId, input);
      if (result.changed) await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "setup.commission_types_saved.v1", entityType: "setup_commission_types", entityId: workspaceId,
        before: result.before.types, after: result.after.types });
      return result.after;
    });
  }

  private purpose(value: string): QuestionnairePurpose {
    if (!isQuestionnairePurpose(value)) throw new NotFoundException("Questionnaire not found.");
    return value;
  }

  /** The stored questionnaire, locked, after checking the caller saw its latest revision. */
  private async lock(client: PoolClient, workspaceId: string, purpose: QuestionnairePurpose, revision: number) {
    await client.query(`SELECT 1 FROM setup_questionnaires WHERE workspace_id = $1 AND purpose = $2 FOR UPDATE`, [workspaceId, purpose]);
    const stored = await loadQuestionnaire(client, workspaceId, purpose);
    if (stored.revision !== revision) throw new ConflictException("These questions changed in another window. Reload and try again.");
    return stored;
  }

  private async read(client: PoolClient, workspaceId: string, purpose: QuestionnairePurpose) {
    const stored = await loadQuestionnaire(client, workspaceId, purpose);
    const versions = (await client.query<{ number: number; note: string; publishedAt: Date; by: string | null; questions: unknown }>(
      `SELECT version.number, version.note, version.published_at AS "publishedAt", person.display_name AS by, version.questions
         FROM setup_questionnaire_versions version LEFT JOIN users person ON person.id = version.published_by
        WHERE version.workspace_id = $1 AND version.purpose = $2 ORDER BY version.number DESC`, [workspaceId, purpose])).rows;
    const published = await versionQuestions(client, workspaceId, purpose, stored.publishedNumber) ?? KIT_QUESTIONS[purpose];
    const types = (await client.query<{ code: string; name: string }>(
      `SELECT choice.code, choice.label AS name FROM crm_taxonomy_options choice
         JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = choice.workspace_id AND taxonomy.id = choice.taxonomy_id AND taxonomy.code = 'enquiry_type'
        WHERE choice.workspace_id = $1 AND choice.status = 'active' AND choice.code <> $2 ORDER BY choice.position, choice.label`, [workspaceId, UNRESOLVED_ENQUIRY_TYPE])).rows;
    return {
      purpose, name: QUESTIONNAIRE_INFO[purpose].name, step: QUESTIONNAIRE_INFO[purpose].step,
      revision: stored.revision, draft: stored.draft, version: stored.publishedNumber,
      draftChanged: canonicalHash(stored.draft) !== canonicalHash(published),
      problems: healthCheck(stored.draft),
      versions: versions.map((version) => ({ number: version.number, note: version.note, publishedAt: new Date(version.publishedAt).toISOString(), by: version.by,
        questions: normaliseQuestions(version.questions).length })),
      kit: KIT_QUESTIONS[purpose],
      jobTypes: types.map((type) => ({ id: type.code, label: type.name })),
    };
  }
}
