import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { ArchiveSettingDto, CreateCustomFieldDto, CreateQualificationFormDto, CreateSavedViewDto, CreateTaxonomyDto, SetCustomFieldValueDto, UpdateCustomFieldDto, UpdateQualificationFormDto, UpdateSavedViewDto, UpdateTaxonomyDto } from "./dto/settings.dto";

type Row = Record<string, unknown>;
@Injectable()
export class CrmSettingsService {
  constructor(private readonly access: WorkspaceAccessService, private readonly events: CrmEventsService) {}

  list(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client) => {
      const taxonomies = await client.query(`SELECT taxonomy.id, taxonomy.code, taxonomy.name, taxonomy.status, taxonomy.version, COALESCE(jsonb_agg(jsonb_build_object('id', option.id, 'code', option.code, 'label', option.label, 'position', option.position, 'status', option.status, 'version', option.version) ORDER BY option.position) FILTER (WHERE option.id IS NOT NULL), '[]'::jsonb) AS options FROM crm_taxonomies taxonomy LEFT JOIN crm_taxonomy_options option ON option.taxonomy_id = taxonomy.id AND option.workspace_id = taxonomy.workspace_id WHERE taxonomy.workspace_id = $1 GROUP BY taxonomy.id ORDER BY taxonomy.name`, [workspaceId]);
      const fields = await client.query(`SELECT id, entity_type AS "entityType", key, label, data_type AS "dataType", required, searchable, configuration, status, version FROM crm_custom_field_definitions WHERE workspace_id = $1 ORDER BY entity_type, label`, [workspaceId]);
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
        const created = await client.query(`INSERT INTO crm_taxonomy_options (workspace_id, taxonomy_id, code, label, position) VALUES ($1,$2,lower($3),$4,$5) RETURNING id, code, label, position, status, version`, [workspaceId, taxonomy.id, option.code, option.label, option.position ?? index]);
        options.push(created.rows[0] as Row);
      }
      const response = { ...taxonomy, options };
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.taxonomy.created.v1", entityType: "crm_taxonomy", entityId: String(taxonomy.id), after: response });
      return response;
    });
  }

  updateTaxonomy(actor: RequestActor, workspaceId: string, taxonomyId: string, input: UpdateTaxonomyDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const existing = await client.query<Row>(`SELECT * FROM crm_taxonomies WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, taxonomyId]);
      if (!existing.rowCount) throw new NotFoundException("Taxonomy not found");
      const before = existing.rows[0];
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
            `INSERT INTO crm_taxonomy_options (workspace_id, taxonomy_id, code, label, position, status)
             VALUES ($1,$2,lower($3),$4,$5,'active')
             ON CONFLICT (workspace_id, taxonomy_id, code) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position, status = 'active', version = crm_taxonomy_options.version + 1, updated_at = now()`,
            [workspaceId, taxonomyId, option.code, option.label, option.position ?? index],
          );
        }
      }
      const options = await client.query(`SELECT id, code, label, position, status, version FROM crm_taxonomy_options WHERE workspace_id = $1 AND taxonomy_id = $2 ORDER BY position, label`, [workspaceId, taxonomyId]);
      const response = { ...result.rows[0], options: options.rows };
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.taxonomy.updated.v1", entityType: "crm_taxonomy", entityId: taxonomyId, before, after: response });
      return response;
    });
  }

  createField(actor: RequestActor, workspaceId: string, input: CreateCustomFieldDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      this.validateFieldConfiguration(input);
      const result = await client.query(`INSERT INTO crm_custom_field_definitions (workspace_id, entity_type, key, label, data_type, required, searchable, configuration) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, entity_type AS "entityType", key, label, data_type AS "dataType", required, searchable, configuration, status, version`, [workspaceId, input.entityType, input.key, input.label, input.dataType, input.required ?? false, input.searchable ?? false, input.configuration ?? {}]);
      const response = result.rows[0] as Row;
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.custom_field.created.v1", entityType: "crm_custom_field", entityId: String(response.id), after: response });
      return response;
    });
  }

  updateField(actor: RequestActor, workspaceId: string, definitionId: string, input: UpdateCustomFieldDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const existing = await client.query<Row>(`SELECT * FROM crm_custom_field_definitions WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, definitionId]);
      if (!existing.rowCount) throw new NotFoundException("Custom field not found");
      const before = existing.rows[0];
      if (Number(before.version) !== input.version) throw new ConflictException("Custom field changed; reload and try again");
      if (input.configuration) this.validateFieldConfiguration({ dataType: String(before.data_type), configuration: input.configuration });
      const result = await client.query(
        `UPDATE crm_custom_field_definitions SET label = COALESCE($1, label), required = COALESCE($2, required), searchable = COALESCE($3, searchable), configuration = COALESCE($4, configuration), status = COALESCE($5, status), version = version + 1, updated_at = now()
         WHERE workspace_id = $6 AND id = $7 AND version = $8
         RETURNING id, entity_type AS "entityType", key, label, data_type AS "dataType", required, searchable, configuration, status, version`,
        [input.label?.trim() ?? null, input.required ?? null, input.searchable ?? null, input.configuration ?? null, input.status ?? null, workspaceId, definitionId, input.version],
      );
      if (!result.rowCount) throw new ConflictException("Custom field changed; reload and try again");
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
      const keys = new Set(input.questions.map((question) => question.key));
      const positions = new Set(input.questions.map((question) => question.position));
      if (keys.size !== input.questions.length || positions.size !== input.questions.length) throw new UnprocessableEntityException("Question keys and positions must be unique");
      const result = await client.query(`INSERT INTO crm_qualification_forms (workspace_id, code, name, service_type) VALUES ($1,lower($2),$3,$4) RETURNING id, code, name, status, service_type AS "serviceType", version`, [workspaceId, input.code, input.name, input.serviceType ?? null]);
      const form = result.rows[0] as Row;
      const questions: Row[] = [];
      for (const question of input.questions) {
        const created = await client.query(`INSERT INTO crm_qualification_questions (workspace_id, form_id, key, label, data_type, required, position, scoring, configuration) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, key, label, data_type AS "dataType", required, position, scoring, configuration`, [workspaceId, form.id, question.key, question.label, question.dataType, question.required ?? false, question.position, question.scoring ?? {}, question.configuration ?? {}]);
        questions.push(created.rows[0] as Row);
      }
      const response = { ...form, questions };
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.qualification_form.created.v1", entityType: "crm_qualification_form", entityId: String(form.id), after: response });
      return response;
    });
  }

  updateForm(actor: RequestActor, workspaceId: string, formId: string, input: UpdateQualificationFormDto) {
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, actorUser) => {
      const existing = await client.query<Row>(`SELECT * FROM crm_qualification_forms WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, formId]);
      if (!existing.rowCount) throw new NotFoundException("Qualification form not found");
      const before = existing.rows[0];
      if (Number(before.version) !== input.version) throw new ConflictException("Qualification form changed; reload and try again");
      if (input.questions) {
        const keys = new Set(input.questions.map((question) => question.key));
        const positions = new Set(input.questions.map((question) => question.position));
        if (keys.size !== input.questions.length || positions.size !== input.questions.length) throw new UnprocessableEntityException("Question keys and positions must be unique");
      }
      const result = await client.query(
        `UPDATE crm_qualification_forms SET name = COALESCE($1, name), service_type = CASE WHEN $2::boolean THEN $3 ELSE service_type END, status = COALESCE($4, status), version = version + 1, updated_at = now()
         WHERE workspace_id = $5 AND id = $6 AND version = $7
         RETURNING id, code, name, status, service_type AS "serviceType", version`,
        [input.name?.trim() ?? null, input.serviceType !== undefined, input.serviceType?.trim() || null, input.status ?? null, workspaceId, formId, input.version],
      );
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
      const result = await client.query(`UPDATE ${table} SET status = 'archived', version = version + 1 WHERE workspace_id = $1 AND id = $2 AND version = $3 RETURNING id, status, version`, [workspaceId, id, input.version]);
      if (!result.rowCount) throw new ConflictException("Setting changed or was not found");
      await this.events.record(client, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.setting.archived.v1", entityType: type, entityId: id, after: result.rows[0] as Row });
      return result.rows[0];
    });
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
