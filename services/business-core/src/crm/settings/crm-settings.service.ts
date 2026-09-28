import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { validateQualificationQuestionDefinitions } from "../leads/qualification-evidence";
import { ArchiveSettingDto, CreateCustomFieldDto, CreateQualificationFormDto, CreateSavedViewDto, CreateTaxonomyDto, QualificationQuestionDto, SetCustomFieldValueDto, UpdateCustomFieldDto, UpdateQualificationFormDto, UpdateSavedViewDto, UpdateTaxonomyDto } from "./dto/settings.dto";
import { ConfigurationRevisionsService, type ConfigurationResourceType } from "../../workspaces/configuration-revisions.service";
import type { RestoreConfigurationRevisionDto } from "../../workspaces/dto/restore-configuration-revision.dto";
import { normaliseRoleCodes } from "../../workspaces/role-vocabulary";

type Row = Record<string, unknown>;

/** Roles a choice is limited to, stored in the one role vocabulary (lower-case, unique); none means everyone. */
function storedRoleCodes(codes: string[] | undefined) {
  const normalised = normaliseRoleCodes(codes);
  return normalised.length ? normalised : null;
}

@Injectable()
export class CrmSettingsService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
    private readonly revisions: ConfigurationRevisionsService = new ConfigurationRevisionsService(),
  ) {}

  history(actor: RequestActor, workspaceId: string, type: string, id: string) {
    const resourceType = this.revisionResourceType(type);
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", (client) =>
      this.revisions.history(client, workspaceId, resourceType, id));
  }

  list(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client) => {
      const taxonomies = await client.query(`SELECT taxonomy.id, taxonomy.code, taxonomy.name, taxonomy.status, taxonomy.version, COALESCE(jsonb_agg(jsonb_build_object('id', option.id, 'code', option.code, 'label', option.label, 'position', option.position, 'status', option.status, 'version', option.version) ORDER BY option.position) FILTER (WHERE option.id IS NOT NULL), '[]'::jsonb) AS options FROM crm_taxonomies taxonomy LEFT JOIN crm_taxonomy_options option ON option.taxonomy_id = taxonomy.id AND option.workspace_id = taxonomy.workspace_id WHERE taxonomy.workspace_id = $1 GROUP BY taxonomy.id ORDER BY taxonomy.name`, [workspaceId]);
      const fields = await client.query(`SELECT id, entity_type AS "entityType", key, label, data_type AS "dataType", required, searchable, configuration, status, visible, position, version FROM crm_custom_field_definitions WHERE workspace_id = $1 ORDER BY entity_type, label`, [workspaceId]);
      const forms = await client.query(`SELECT form.id, form.code, form.name, form.status, form.service_type AS "serviceType", form.version, COALESCE(jsonb_agg(jsonb_build_object('id', question.id, 'key', question.key, 'label', question.label, 'dataType', question.data_type, 'required', question.required, 'position', question.position, 'scoring', question.scoring, 'configuration', question.configuration) ORDER BY question.position) FILTER (WHERE question.id IS NOT NULL), '[]'::jsonb) AS questions FROM crm_qualification_forms form LEFT JOIN crm_qualification_questions question ON question.form_id = form.id AND question.workspace_id = form.workspace_id WHERE form.workspace_id = $1 GROUP BY form.id ORDER BY form.name`, [workspaceId]);
      const views = await client.query(`SELECT id, entity_type AS "entityType", name, owner_membership_id AS "ownerMembershipId", is_shared AS "isShared", definition, version FROM crm_saved_views WHERE workspace_id = $1 ORDER BY entity_type, name`, [workspaceId]);
      return { taxonomies: taxonomies.rows, customFields: fields.rows, qualificationForms: forms.rows, savedViews: views.rows };
    });
  }

  createTaxonomy(actor: RequestActor, workspaceId: string, input: CreateTaxonomyDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      if (["enquiry_type", "budget_range"].includes(input.code.toLowerCase()) && !input.options?.some(option => option.code.toLowerCase() === "not_sure")) throw new UnprocessableEntityException("Keep the Not sure yet option for enquiries");
      const codes = new Set(input.options?.map((option) => option.code));
      if (codes.size !== (input.options?.length ?? 0)) throw new UnprocessableEntityException("Taxonomy option codes must be unique");
      const result = await client.query(`INSERT INTO crm_taxonomies (workspace_id, code, name) VALUES ($1, lower($2), $3) RETURNING id, code, name, status, version`, [workspaceId, input.code, input.name]);
      const taxonomy = result.rows[0] as Row;
      const options: Row[] = [];
      for (const [index, option] of (input.options ?? []).entries()) {
        const created = await client.query(`INSERT INTO crm_taxonomy_options (workspace_id, taxonomy_id, code, label, position, allowed_role_codes) VALUES ($1,$2,lower($3),$4,$5,$6) RETURNING id, code, label, position, status, version`, [workspaceId, taxonomy.id, option.code, option.label, option.position ?? index, storedRoleCodes(option.allowedRoles)]);
        options.push(created.rows[0] as Row);
      }
      const response = { ...taxonomy, options };
      await this.revisions.record(client, {
        workspaceId, resourceType: "crm_taxonomy", resourceId: String(taxonomy.id),
        sourceVersion: Number(taxonomy.version), action: "created", snapshot: response,
        actorUserId: actorUser.userId,
      });
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.taxonomy.created.v1", entityType: "crm_taxonomy", entityId: String(taxonomy.id), after: response });
      return response;
    });
  }

  updateTaxonomy(actor: RequestActor, workspaceId: string, taxonomyId: string, input: UpdateTaxonomyDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const existing = await client.query<Row>(`SELECT * FROM crm_taxonomies WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, taxonomyId]);
      if (!existing.rowCount) throw new NotFoundException("Taxonomy not found");
      const before = await this.taxonomySnapshot(client, workspaceId, taxonomyId);
      if (Number(before.version) !== input.version) throw new ConflictException("Taxonomy changed; reload and try again");
      if (input.options && ["enquiry_type", "budget_range"].includes(String(before.code)) && !input.options.some(option => option.code.toLowerCase() === "not_sure")) throw new UnprocessableEntityException("Keep the Not sure yet option for enquiries");
      if (input.options) {
        const codes = new Set(input.options.map((option) => option.code));
        const positions = new Set(input.options.map((option, index) => option.position ?? index));
        if (codes.size !== input.options.length || positions.size !== input.options.length) throw new UnprocessableEntityException("Taxonomy option codes and positions must be unique");
      }
      const result = await client.query(`UPDATE crm_taxonomies SET name = COALESCE($1, name), status = COALESCE($2, status), version = version + 1, updated_at = now() WHERE workspace_id = $3 AND id = $4 AND version = $5 RETURNING id, code, name, status, version`, [input.name?.trim() ?? null, input.status ?? null, workspaceId, taxonomyId, input.version]);
      if (!result.rowCount) throw new ConflictException("Taxonomy changed; reload and try again");
      if (input.options) {
        await client.query(`UPDATE crm_taxonomy_options SET status = 'archived', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND taxonomy_id = $2 AND status = 'active'`, [workspaceId, taxonomyId]);
        for (const [index, option] of input.options.entries()) {
          await client.query(
            `INSERT INTO crm_taxonomy_options (workspace_id, taxonomy_id, code, label, position, status, allowed_role_codes)
             VALUES ($1,$2,lower($3),$4,$5,'active',$6)
             ON CONFLICT (workspace_id, taxonomy_id, code) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position, status = 'active',
               allowed_role_codes = CASE WHEN $7 THEN EXCLUDED.allowed_role_codes ELSE crm_taxonomy_options.allowed_role_codes END,
               version = crm_taxonomy_options.version + 1, updated_at = now()`,
            [workspaceId, taxonomyId, option.code, option.label, option.position ?? index, storedRoleCodes(option.allowedRoles), option.allowedRoles !== undefined],
          );
        }
      }
      const options = await client.query(`SELECT id, code, label, position, status, version FROM crm_taxonomy_options WHERE workspace_id = $1 AND taxonomy_id = $2 ORDER BY position, label`, [workspaceId, taxonomyId]);
      const response = { ...result.rows[0], options: options.rows };
      await this.revisions.ensureBaseline(client, {
        workspaceId, resourceType: "crm_taxonomy", resourceId: taxonomyId,
        sourceVersion: Number(before.version), snapshot: before, actorUserId: actorUser.userId,
      });
      await this.revisions.record(client, {
        workspaceId, resourceType: "crm_taxonomy", resourceId: taxonomyId,
        sourceVersion: Number(response.version), action: "saved", snapshot: response,
        actorUserId: actorUser.userId,
      });
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.taxonomy.updated.v1", entityType: "crm_taxonomy", entityId: taxonomyId, before, after: response });
      return response;
    });
  }

  createField(actor: RequestActor, workspaceId: string, input: CreateCustomFieldDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      this.validateFieldConfiguration(input);
      const result = await client.query(`INSERT INTO crm_custom_field_definitions (workspace_id, entity_type, key, label, data_type, required, searchable, configuration, visible, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, entity_type AS "entityType", key, label, data_type AS "dataType", required, searchable, configuration, status, visible, position, version`, [workspaceId, input.entityType, input.key, input.label.trim(), input.dataType, input.required ?? false, input.searchable ?? false, input.configuration ?? {}, input.visible ?? true, input.position ?? 0]);
      const response = result.rows[0] as Row;
      await this.revisions.record(client, {
        workspaceId, resourceType: "crm_custom_field", resourceId: String(response.id),
        sourceVersion: Number(response.version), action: "created", snapshot: response,
        actorUserId: actorUser.userId,
      });
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.custom_field.created.v1", entityType: "crm_custom_field", entityId: String(response.id), after: response });
      return response;
    });
  }

  updateField(actor: RequestActor, workspaceId: string, definitionId: string, input: UpdateCustomFieldDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const existing = await client.query<Row>(`SELECT * FROM crm_custom_field_definitions WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, definitionId]);
      if (!existing.rowCount) throw new NotFoundException("Custom field not found");
      const before = this.customFieldSnapshot(existing.rows[0]);
      if (Number(before.version) !== input.version) throw new ConflictException("Custom field changed; reload and try again");
      if (input.configuration) this.validateFieldConfiguration({ dataType: String(before.data_type), configuration: input.configuration });
      const result = await client.query(
        `UPDATE crm_custom_field_definitions SET label = COALESCE($1, label), required = COALESCE($2, required), searchable = COALESCE($3, searchable), configuration = COALESCE($4, configuration), status = COALESCE($5, status), visible = COALESCE($9, visible), position = COALESCE($10, position), version = version + 1, updated_at = now()
         WHERE workspace_id = $6 AND id = $7 AND version = $8
         RETURNING id, entity_type AS "entityType", key, label, data_type AS "dataType", required, searchable, configuration, status, visible, position, version`,
        [input.label?.trim() ?? null, input.required ?? null, input.searchable ?? null, input.configuration ?? null, input.status ?? null, workspaceId, definitionId, input.version, input.visible ?? null, input.position ?? null],
      );
      if (!result.rowCount) throw new ConflictException("Custom field changed; reload and try again");
      await this.revisions.ensureBaseline(client, {
        workspaceId, resourceType: "crm_custom_field", resourceId: definitionId,
        sourceVersion: Number(before.version), snapshot: before, actorUserId: actorUser.userId,
      });
      await this.revisions.record(client, {
        workspaceId, resourceType: "crm_custom_field", resourceId: definitionId,
        sourceVersion: Number(result.rows[0].version), action: "saved", snapshot: result.rows[0] as Row,
        actorUserId: actorUser.userId,
      });
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.custom_field.updated.v1", entityType: "crm_custom_field", entityId: definitionId, before, after: result.rows[0] as Row });
      return result.rows[0];
    });
  }

  setFieldValue(actor: RequestActor, workspaceId: string, definitionId: string, input: SetCustomFieldValueDto) {
    return this.access.withPermission(actor, workspaceId, "crm.parties.manage", async (client, actorUser) => {
      const definitionResult = await client.query<Row>(`SELECT * FROM crm_custom_field_definitions WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, definitionId]);
      if (!definitionResult.rowCount) throw new NotFoundException("Custom field not found");
      const definition = definitionResult.rows[0];
      if (definition.entity_type !== input.entityType) throw new UnprocessableEntityException("Custom field is not valid for this entity type");
      await this.requireEntity(client, workspaceId, input.entityType, input.entityId);
      const values = this.typedValue(String(definition.data_type), input.value);
      const result = await client.query(
        `INSERT INTO crm_custom_field_values (workspace_id, definition_id, entity_type, entity_id, value_text, value_number, value_boolean, value_timestamp, value_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (workspace_id, definition_id, entity_type, entity_id)
         DO UPDATE SET value_text=EXCLUDED.value_text,value_number=EXCLUDED.value_number,value_boolean=EXCLUDED.value_boolean,value_timestamp=EXCLUDED.value_timestamp,value_json=EXCLUDED.value_json,updated_at=now()
         RETURNING id, definition_id AS "definitionId", entity_type AS "entityType", entity_id AS "entityId", value_text AS "valueText", value_number AS "valueNumber", value_boolean AS "valueBoolean", value_timestamp AS "valueTimestamp", value_json AS "valueJson"`,
        [workspaceId, definitionId, input.entityType, input.entityId, values.text, values.number, values.boolean, values.timestamp, values.json],
      );
      const response = result.rows[0] as Row;
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.custom_field.value_set.v1", entityType: input.entityType, entityId: input.entityId, after: response });
      return response;
    });
  }

  createForm(actor: RequestActor, workspaceId: string, input: CreateQualificationFormDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      validateQualificationQuestionDefinitions(input.questions);
      const keys = new Set(input.questions.map((question) => question.key));
      const positions = new Set(input.questions.map((question) => question.position));
      if (keys.size !== input.questions.length || positions.size !== input.questions.length) throw new UnprocessableEntityException("Question keys and positions must be unique");
      const result = await client.query(`INSERT INTO crm_qualification_forms (workspace_id, code, name, service_type, purpose) VALUES ($1,lower($2),$3,$4,$5) RETURNING id, code, name, status, service_type AS "serviceType", purpose, version`, [workspaceId, input.code, input.name, input.serviceType?.trim() || null, input.purpose ?? "qualification"]);
      const form = result.rows[0] as Row;
      const questions: Row[] = [];
      for (const question of input.questions) {
        const created = await client.query(`INSERT INTO crm_qualification_questions (workspace_id, form_id, key, label, data_type, required, position, scoring, configuration) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, key, label, data_type AS "dataType", required, position, scoring, configuration`, [workspaceId, form.id, question.key, question.label, question.dataType, question.required ?? false, question.position, question.scoring ?? {}, question.configuration ?? {}]);
        questions.push(created.rows[0] as Row);
      }
      const response = { ...form, questions };
      await this.revisions.record(client, {
        workspaceId, resourceType: "crm_qualification_form", resourceId: String(form.id),
        sourceVersion: Number(form.version), action: "created", snapshot: response,
        actorUserId: actorUser.userId,
      });
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.qualification_form.created.v1", entityType: "crm_qualification_form", entityId: String(form.id), after: response });
      return response;
    });
  }

  updateForm(actor: RequestActor, workspaceId: string, formId: string, input: UpdateQualificationFormDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const existing = await client.query<Row>(`SELECT * FROM crm_qualification_forms WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, formId]);
      if (!existing.rowCount) throw new NotFoundException("Qualification form not found");
      const current = existing.rows[0];
      if (Number(current.version) !== input.version) throw new ConflictException("Qualification form changed; reload and try again");
      if (input.questions) {
        validateQualificationQuestionDefinitions(input.questions);
        const keys = new Set(input.questions.map((question) => question.key));
        const positions = new Set(input.questions.map((question) => question.position));
        if (keys.size !== input.questions.length || positions.size !== input.questions.length) throw new UnprocessableEntityException("Question keys and positions must be unique");
      }
      const resultingStatus = input.status ?? String(current.status);
      const resultingServiceType = input.serviceType !== undefined ? input.serviceType?.trim() || null : current.service_type as string | null;
      if (resultingStatus === "active") {
        const questionCount = input.questions?.length ?? Number((await client.query(
          `SELECT count(*)::int AS count FROM crm_qualification_questions WHERE workspace_id=$1 AND form_id=$2`,
          [workspaceId, formId],
        )).rows[0]?.count ?? 0);
        if (!questionCount) throw new UnprocessableEntityException("An active qualification form needs at least one question");
        const conflicting = await client.query(
          `SELECT 1 FROM crm_qualification_forms
           WHERE workspace_id=$1 AND id<>$2 AND status='active'
             AND service_type IS NOT DISTINCT FROM $3::text LIMIT 1`,
          [workspaceId, formId, resultingServiceType],
        );
        if (conflicting.rowCount) {
          throw new ConflictException("Only one active qualification form is allowed for each enquiry type");
        }
      }
      const before = await this.qualificationFormSnapshot(client, workspaceId, formId);
      let result;
      try {
        result = await client.query(
          `UPDATE crm_qualification_forms SET name = COALESCE($1, name), service_type = CASE WHEN $2::boolean THEN $3 ELSE service_type END, status = COALESCE($4, status), version = version + 1, updated_at = now()
           WHERE workspace_id = $5 AND id = $6 AND version = $7
           RETURNING id, code, name, status, service_type AS "serviceType", version`,
          [input.name?.trim() ?? null, input.serviceType !== undefined, resultingServiceType, input.status ?? null, workspaceId, formId, input.version],
        );
      } catch (error) {
        if ((error as { code?: string; constraint?: string }).code === "23505"
          && (error as { constraint?: string }).constraint === "crm_qualification_forms_active_scope_uidx") {
          throw new ConflictException("Only one active qualification form is allowed for each enquiry type");
        }
        throw error;
      }
      if (!result.rowCount) throw new ConflictException("Qualification form changed; reload and try again");
      if (input.questions) {
        await client.query(`UPDATE crm_qualification_questions SET position = position + 1000000, updated_at = now() WHERE workspace_id = $1 AND form_id = $2`, [workspaceId, formId]);
        const keys = input.questions.map((question) => question.key);
        await client.query(`DELETE FROM crm_qualification_questions WHERE workspace_id = $1 AND form_id = $2 AND NOT (key = ANY($3::text[]))`, [workspaceId, formId, keys]);
        for (const question of input.questions) {
          await client.query(
            `INSERT INTO crm_qualification_questions (workspace_id, form_id, key, label, data_type, required, position, scoring, configuration)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (workspace_id, form_id, key) DO UPDATE SET label = EXCLUDED.label, data_type = EXCLUDED.data_type, required = EXCLUDED.required, position = EXCLUDED.position, scoring = EXCLUDED.scoring, configuration = EXCLUDED.configuration, updated_at = now()`,
            [workspaceId, formId, question.key, question.label, question.dataType, question.required ?? false, question.position, question.scoring ?? {}, question.configuration ?? {}],
          );
        }
      }
      const questions = await client.query(`SELECT id, key, label, data_type AS "dataType", required, position, scoring, configuration FROM crm_qualification_questions WHERE workspace_id = $1 AND form_id = $2 ORDER BY position`, [workspaceId, formId]);
      const response = { ...result.rows[0], questions: questions.rows };
      await this.revisions.ensureBaseline(client, {
        workspaceId, resourceType: "crm_qualification_form", resourceId: formId,
        sourceVersion: Number(before.version), snapshot: before, actorUserId: actorUser.userId,
      });
      await this.revisions.record(client, {
        workspaceId, resourceType: "crm_qualification_form", resourceId: formId,
        sourceVersion: Number(response.version), action: "saved", snapshot: response,
        actorUserId: actorUser.userId,
      });
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.qualification_form.updated.v1", entityType: "crm_qualification_form", entityId: formId, before, after: response });
      return response;
    });
  }

  createView(actor: RequestActor, workspaceId: string, input: CreateSavedViewDto) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client, actorUser) => {
      const membership = await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, actorUser.userId]);
      if (input.isShared && !(await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.settings.manage"))) throw new UnprocessableEntityException("Only CRM administrators can create shared views");
      const result = await client.query(`INSERT INTO crm_saved_views (workspace_id, entity_type, name, owner_membership_id, is_shared, definition) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, entity_type AS "entityType", name, owner_membership_id AS "ownerMembershipId", is_shared AS "isShared", definition, version`, [workspaceId, input.entityType, input.name, membership.rows[0]?.id ?? null, input.isShared ?? false, input.definition]);
      const response = result.rows[0] as Row;
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.saved_view.created.v1", entityType: "crm_saved_view", entityId: String(response.id), after: response });
      return response;
    });
  }

  updateView(actor: RequestActor, workspaceId: string, viewId: string, input: UpdateSavedViewDto) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client, actorUser) => {
      const membership = await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, actorUser.userId]);
      const existing = await client.query<Row>(`SELECT * FROM crm_saved_views WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, viewId]);
      if (!existing.rowCount) throw new NotFoundException("Saved view not found");
      const before = existing.rows[0];
      const isAdministrator = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.settings.manage");
      if (String(before.owner_membership_id) !== membership.rows[0]?.id && !isAdministrator) throw new UnprocessableEntityException("You can only edit your own saved views");
      if ((Boolean(before.is_shared) || input.isShared) && !isAdministrator) throw new UnprocessableEntityException("Only CRM administrators can manage shared views");
      if (Number(before.version) !== input.version) throw new ConflictException("Saved view changed; reload and try again");
      const result = await client.query(`UPDATE crm_saved_views SET name = COALESCE($1, name), is_shared = COALESCE($2, is_shared), definition = COALESCE($3, definition), version = version + 1, updated_at = now() WHERE workspace_id = $4 AND id = $5 AND version = $6 RETURNING id, entity_type AS "entityType", name, owner_membership_id AS "ownerMembershipId", is_shared AS "isShared", definition, version`, [input.name?.trim() ?? null, input.isShared ?? null, input.definition ?? null, workspaceId, viewId, input.version]);
      if (!result.rowCount) throw new ConflictException("Saved view changed; reload and try again");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.saved_view.updated.v1", entityType: "crm_saved_view", entityId: viewId, before, after: result.rows[0] as Row });
      return result.rows[0];
    });
  }

  archive(actor: RequestActor, workspaceId: string, type: string, id: string, input: ArchiveSettingDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const tables: Record<string, string> = { taxonomy: "crm_taxonomies", "custom-field": "crm_custom_field_definitions", "qualification-form": "crm_qualification_forms" };
      const table = tables[type];
      if (!table) throw new UnprocessableEntityException("Setting type cannot be archived");
      const resourceType = this.revisionResourceType(type);
      const before = await this.settingSnapshot(client, workspaceId, type, id);
      if (Number(before.version) !== input.version) throw new ConflictException("Setting changed or was not found");
      await this.revisions.ensureBaseline(client, {
        workspaceId, resourceType, resourceId: id, sourceVersion: Number(before.version),
        snapshot: before, actorUserId: actorUser.userId,
      });
      const result = await client.query(`UPDATE ${table} SET status = 'archived', version = version + 1 WHERE workspace_id = $1 AND id = $2 AND version = $3 RETURNING id, status, version`, [workspaceId, id, input.version]);
      if (!result.rowCount) throw new ConflictException("Setting changed or was not found");
      const after = await this.settingSnapshot(client, workspaceId, type, id);
      await this.revisions.record(client, {
        workspaceId, resourceType, resourceId: id, sourceVersion: Number(after.version),
        action: "archived", snapshot: after, actorUserId: actorUser.userId,
      });
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.setting.archived.v1", entityType: type, entityId: id, before, after });
      return after;
    });
  }

  rollback(
    actor: RequestActor,
    workspaceId: string,
    type: string,
    id: string,
    input: RestoreConfigurationRevisionDto,
  ) {
    const resourceType = this.revisionResourceType(type);
    const tables: Record<string, string> = {
      taxonomy: "crm_taxonomies",
      "custom-field": "crm_custom_field_definitions",
      "qualification-form": "crm_qualification_forms",
    };
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      await client.query(`SELECT id FROM ${tables[type]} WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [workspaceId, id]);
      const before = await this.settingSnapshot(client, workspaceId, type, id);
      if (Number(before.version) !== input.version) throw new ConflictException("Setting changed; reload and try again");
      const revision = await this.revisions.requireRevision(client, workspaceId, resourceType, id, input.revisionId);
      await this.revisions.ensureBaseline(client, {
        workspaceId, resourceType, resourceId: id, sourceVersion: Number(before.version),
        snapshot: before, actorUserId: actorUser.userId,
      });
      if (type === "taxonomy") await this.restoreTaxonomy(client, workspaceId, id, input.version, before, revision.snapshot);
      else if (type === "custom-field") await this.restoreCustomField(client, workspaceId, id, input.version, before, revision.snapshot);
      else await this.restoreQualificationForm(client, workspaceId, id, input.version, before, revision.snapshot);
      const after = await this.settingSnapshot(client, workspaceId, type, id);
      await this.revisions.record(client, {
        workspaceId, resourceType, resourceId: id, sourceVersion: Number(after.version),
        action: "rolled_back", snapshot: after, actorUserId: actorUser.userId,
        sourceRevisionId: revision.id,
      });
      await this.events.record(client, {
        workspaceId, actorUserId: actorUser.userId, source: "user",
        action: "crm.setting.rolled_back.v1", entityType: type, entityId: id,
        before, after: { ...after, sourceRevisionId: revision.id },
      });
      return after;
    });
  }

  private revisionResourceType(type: string): ConfigurationResourceType {
    const resources: Record<string, ConfigurationResourceType> = {
      taxonomy: "crm_taxonomy",
      "custom-field": "crm_custom_field",
      "qualification-form": "crm_qualification_form",
    };
    if (!resources[type]) throw new UnprocessableEntityException("Setting type does not have revision history");
    return resources[type];
  }

  private async settingSnapshot(client: PoolClient, workspaceId: string, type: string, id: string): Promise<Row> {
    if (type === "taxonomy") return this.taxonomySnapshot(client, workspaceId, id);
    if (type === "custom-field") {
      const result = await client.query<Row>(`SELECT * FROM crm_custom_field_definitions WHERE workspace_id=$1 AND id=$2`, [workspaceId, id]);
      if (!result.rowCount) throw new NotFoundException("Custom field not found");
      return this.customFieldSnapshot(result.rows[0]);
    }
    if (type === "qualification-form") return this.qualificationFormSnapshot(client, workspaceId, id);
    throw new UnprocessableEntityException("Setting type cannot be revised");
  }

  private async taxonomySnapshot(client: PoolClient, workspaceId: string, id: string): Promise<Row> {
    const result = await client.query<Row>(
      `SELECT taxonomy.id,taxonomy.code,taxonomy.name,taxonomy.status,taxonomy.version,
              COALESCE(jsonb_agg(jsonb_build_object(
                'id',option.id,'code',option.code,'label',option.label,'position',option.position,
                'status',option.status,'version',option.version
              ) ORDER BY option.position,option.code) FILTER (WHERE option.id IS NOT NULL),'[]'::jsonb) AS options
       FROM crm_taxonomies taxonomy
       LEFT JOIN crm_taxonomy_options option ON option.workspace_id=taxonomy.workspace_id AND option.taxonomy_id=taxonomy.id
       WHERE taxonomy.workspace_id=$1 AND taxonomy.id=$2 GROUP BY taxonomy.id`,
      [workspaceId, id],
    );
    if (!result.rowCount) throw new NotFoundException("Taxonomy not found");
    return result.rows[0];
  }

  private customFieldSnapshot(row: Row): Row {
    return {
      id: row.id,
      entityType: row.entityType ?? row.entity_type,
      key: row.key,
      label: row.label,
      dataType: row.dataType ?? row.data_type,
      required: row.required,
      searchable: row.searchable,
      configuration: row.configuration ?? {},
      status: row.status,
      visible: row.visible ?? true,
      version: row.version,
    };
  }

  private async qualificationFormSnapshot(client: PoolClient, workspaceId: string, id: string): Promise<Row> {
    const result = await client.query<Row>(
      `SELECT form.id,form.code,form.name,form.status,form.service_type AS "serviceType",form.version,
              COALESCE(jsonb_agg(jsonb_build_object(
                'id',question.id,'key',question.key,'label',question.label,'dataType',question.data_type,
                'required',question.required,'position',question.position,'scoring',question.scoring,
                'configuration',question.configuration
              ) ORDER BY question.position) FILTER (WHERE question.id IS NOT NULL),'[]'::jsonb) AS questions
       FROM crm_qualification_forms form
       LEFT JOIN crm_qualification_questions question ON question.workspace_id=form.workspace_id AND question.form_id=form.id
       WHERE form.workspace_id=$1 AND form.id=$2 GROUP BY form.id`,
      [workspaceId, id],
    );
    if (!result.rowCount) throw new NotFoundException("Qualification form not found");
    return result.rows[0];
  }

  private async restoreTaxonomy(client: PoolClient, workspaceId: string, id: string, version: number, before: Row, target: Row) {
    if (target.code !== before.code || typeof target.name !== "string" || !["active", "archived"].includes(String(target.status))) {
      throw new UnprocessableEntityException("This taxonomy revision cannot be restored");
    }
    const options = Array.isArray(target.options) ? target.options as Row[] : [];
    if (options.some((option) => typeof option.code !== "string" || typeof option.label !== "string" || !Number.isInteger(option.position))) {
      throw new UnprocessableEntityException("This taxonomy revision has invalid options");
    }
    if (["enquiry_type", "budget_range"].includes(String(target.code)) && !options.some((option) => option.code === "not_sure" && option.status !== "archived")) {
      throw new UnprocessableEntityException("Keep the Not sure yet option for enquiries");
    }
    const updated = await client.query(
      `UPDATE crm_taxonomies SET name=$1,status=$2,version=version+1,updated_at=now()
       WHERE workspace_id=$3 AND id=$4 AND version=$5 RETURNING id`,
      [target.name, target.status, workspaceId, id, version],
    );
    if (!updated.rowCount) throw new ConflictException("Taxonomy changed; reload and try again");
    await client.query(
      `UPDATE crm_taxonomy_options SET status='archived',version=version+1,updated_at=now()
       WHERE workspace_id=$1 AND taxonomy_id=$2 AND status<>'archived'`,
      [workspaceId, id],
    );
    for (const option of options) {
      await client.query(
        `INSERT INTO crm_taxonomy_options(workspace_id,taxonomy_id,code,label,position,status)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(workspace_id,taxonomy_id,code) DO UPDATE SET
           label=EXCLUDED.label,position=EXCLUDED.position,status=EXCLUDED.status,
           version=crm_taxonomy_options.version+1,updated_at=now()`,
        [workspaceId, id, option.code, option.label, option.position, option.status === "archived" ? "archived" : "active"],
      );
    }
  }

  private async restoreCustomField(client: PoolClient, workspaceId: string, id: string, version: number, before: Row, target: Row) {
    if (
      target.key !== before.key || target.entityType !== before.entityType || target.dataType !== before.dataType ||
      typeof target.label !== "string" || typeof target.required !== "boolean" || typeof target.searchable !== "boolean" ||
      !target.configuration || typeof target.configuration !== "object" || Array.isArray(target.configuration) ||
      !["active", "archived"].includes(String(target.status))
    ) throw new UnprocessableEntityException("This custom-field revision cannot be restored");
    this.validateFieldConfiguration({ dataType: String(target.dataType), configuration: target.configuration as Record<string, unknown> });
    const result = await client.query(
      `UPDATE crm_custom_field_definitions
       SET label=$1,required=$2,searchable=$3,configuration=$4,status=$5,visible=COALESCE($9,visible),version=version+1,updated_at=now()
       WHERE workspace_id=$6 AND id=$7 AND version=$8 RETURNING id`,
      [target.label, target.required, target.searchable, target.configuration, target.status, workspaceId, id, version, typeof target.visible === "boolean" ? target.visible : null],
    );
    if (!result.rowCount) throw new ConflictException("Custom field changed; reload and try again");
  }

  private async restoreQualificationForm(client: PoolClient, workspaceId: string, id: string, version: number, before: Row, target: Row) {
    if (target.code !== before.code || typeof target.name !== "string" || !["draft", "active", "archived"].includes(String(target.status))) {
      throw new UnprocessableEntityException("This qualification-form revision cannot be restored");
    }
    const questions = Array.isArray(target.questions) ? target.questions as QualificationQuestionDto[] : [];
    validateQualificationQuestionDefinitions(questions);
    if (target.status === "active" && !questions.length) throw new UnprocessableEntityException("An active qualification form needs at least one question");
    if (target.status === "active") {
      const conflicting = await client.query(
        `SELECT 1 FROM crm_qualification_forms
         WHERE workspace_id=$1 AND id<>$2 AND status='active' AND service_type IS NOT DISTINCT FROM $3::text LIMIT 1`,
        [workspaceId, id, target.serviceType ?? null],
      );
      if (conflicting.rowCount) throw new ConflictException("Only one active qualification form is allowed for each enquiry type");
    }
    const updated = await client.query(
      `UPDATE crm_qualification_forms
       SET name=$1,service_type=$2,status=$3,version=version+1,updated_at=now()
       WHERE workspace_id=$4 AND id=$5 AND version=$6 RETURNING id`,
      [target.name, target.serviceType ?? null, target.status, workspaceId, id, version],
    );
    if (!updated.rowCount) throw new ConflictException("Qualification form changed; reload and try again");
    await client.query(`DELETE FROM crm_qualification_questions WHERE workspace_id=$1 AND form_id=$2`, [workspaceId, id]);
    for (const question of questions) {
      await client.query(
        `INSERT INTO crm_qualification_questions
          (workspace_id,form_id,key,label,data_type,required,position,scoring,configuration)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [workspaceId, id, question.key, question.label, question.dataType, question.required ?? false, question.position, question.scoring ?? {}, question.configuration ?? {}],
      );
    }
  }

  private validateFieldConfiguration(input: Pick<CreateCustomFieldDto, "dataType" | "configuration">) {
    if (["select", "multi_select"].includes(input.dataType)) {
      const options = input.configuration?.options;
      if (!Array.isArray(options) || !options.length || options.some((value) => typeof value !== "string")) throw new UnprocessableEntityException("Select fields require a string options array");
    }
  }
  private typedValue(type: string, value: unknown) {
    const result: { text: string | null; number: number | null; boolean: boolean | null; timestamp: Date | null; json: unknown | null } = { text: null, number: null, boolean: null, timestamp: null, json: null };
    if (["text", "select", "party_reference"].includes(type) && typeof value === "string") result.text = value;
    else if (type === "number" && typeof value === "number" && Number.isFinite(value)) result.number = value;
    else if (type === "boolean" && typeof value === "boolean") result.boolean = value;
    else if (["date", "datetime"].includes(type) && typeof value === "string" && !Number.isNaN(new Date(value).getTime())) result.timestamp = new Date(value);
    else if (type === "multi_select" && Array.isArray(value) && value.every((item) => typeof item === "string")) result.json = value;
    else throw new UnprocessableEntityException(`Value does not match ${type}`);
    return result;
  }
  private async requireEntity(client: PoolClient, workspaceId: string, type: string, id: string) {
    const tables: Record<string, string> = { party: "crm_parties", enquiry: "crm_enquiries", lead: "crm_leads", opportunity: "crm_opportunities", activity: "crm_activities" };
    const table = tables[type];
    if (!table) throw new UnprocessableEntityException("Unsupported custom-field entity");
    const result = await client.query(`SELECT 1 FROM ${table} WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
    if (!result.rowCount) throw new NotFoundException("Target record not found");
  }
}
