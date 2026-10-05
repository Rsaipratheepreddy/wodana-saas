import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DEFAULT_REQUIREMENTS, isRequirableKey, loadRequirementRows, REQUIRED_AT, rulesByType, type RequiredAt } from "../leads/enquiry-problems";
import { loadLeadOptions, UNRESOLVED_ENQUIRY_TYPE } from "../leads/lead-options";
import { RequestActor } from "../../auth/actor";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { enquiryCustomValuesSql, enquiryFieldDefinitions, normalizeCustomValues, OPTIONAL_ENQUIRY_FIELDS, writeEnquiryCustomValues } from "./enquiry-fields";

type Setting = { visible: boolean; version: number };

/**
 * The fields an enquiry captures: the fixed ones (some can be hidden) and the workspace's custom
 * enquiry fields. Visibility decides what the enquiry list, record and forms offer.
 */
@Injectable()
export class EnquiryFieldsService {
  constructor(private readonly access: WorkspaceAccessService, private readonly events: CrmEventsService) {}

  list(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", async (client) => {
      const settings = await client.query<{ fieldKey: string } & Setting>(`SELECT field_key AS "fieldKey", visible, version FROM crm_enquiry_field_settings WHERE workspace_id=$1`, [workspaceId]);
      const saved = new Map(settings.rows.map(row => [row.fieldKey, row]));
      const custom = await client.query(`SELECT id, key, label, data_type AS "dataType", configuration, visible, position, version,
          (SELECT count(*)::int FROM crm_custom_field_values value WHERE value.workspace_id=field.workspace_id AND value.definition_id=field.id) AS "valueCount"
        FROM crm_custom_field_definitions field WHERE workspace_id=$1 AND entity_type='enquiry' AND status='active' ORDER BY position, label`, [workspaceId]);
      return {
        system: Object.fromEntries(OPTIONAL_ENQUIRY_FIELDS.map(key => [key, { visible: saved.get(key)?.visible ?? true, version: saved.get(key)?.version ?? 0 }])),
        custom: custom.rows,
      };
    });
  }

  async setSystemVisibility(actor: RequestActor, workspaceId: string, key: string, input: { visible: boolean; version: number }) {
    if (!(OPTIONAL_ENQUIRY_FIELDS as readonly string[]).includes(key)) throw new NotFoundException("This field is always shown");
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, user) => {
      const result = input.version === 0
        ? await client.query<Setting>(`INSERT INTO crm_enquiry_field_settings (workspace_id, field_key, visible, updated_by) VALUES ($1,$2,$3,$4)
            ON CONFLICT (workspace_id, field_key) DO NOTHING RETURNING visible, version`, [workspaceId, key, input.visible, user.userId])
        : await client.query<Setting>(`UPDATE crm_enquiry_field_settings SET visible=$3, version=version+1, updated_by=$4, updated_at=now()
            WHERE workspace_id=$1 AND field_key=$2 AND version=$5 RETURNING visible, version`, [workspaceId, key, input.visible, user.userId, input.version]);
      if (!result.rowCount) throw new ConflictException("This field changed. Reload and try again");
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "crm.enquiry_field.visibility_changed.v1", entityType: "crm_enquiry_field_settings", entityId: workspaceId, after: { key, ...result.rows[0] } });
      return { key, ...result.rows[0] };
    });
  }

  /**
   * PLM-096: the fields each enquiry type requires, and from which gate (create, convert, book the intro). `rules`
   * are the effective rules (product defaults for a type the firm has not configured); `versions` the stored rows.
   */
  requirements(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.view", (client) => this.requirementState(client, workspaceId));
  }

  /**
   * Sets one field's requirement for several enquiry types at once: validated, version-checked per row, idempotent
   * (an unchanged value writes nothing) and audited. A type's first save stores its whole default set with it.
   */
  async setRequirement(actor: RequestActor, workspaceId: string, fieldKey: string, input: { types: Array<{ enquiryType: string; requiredAt: string; version: number }> }) {
    if (!isRequirableKey(fieldKey)) throw new NotFoundException("This field can't be required here");
    return this.access.withPermission(actor, workspaceId, "crm.settings.manage", async (client, user) => {
      const options = await loadLeadOptions(client, workspaceId);
      const types = new Set(options.enquiryTypes.map((type) => type.id).filter((id) => id !== UNRESOLVED_ENQUIRY_TYPE));
      if (fieldKey.startsWith("cf:")) {
        const field = await client.query(`SELECT 1 FROM crm_custom_field_definitions WHERE workspace_id = $1 AND id = $2 AND entity_type = 'enquiry' AND status = 'active'`, [workspaceId, fieldKey.slice(3)]);
        if (!field.rowCount) throw new NotFoundException("This field is no longer in use");
      }
      for (const entry of input.types) {
        if (!types.has(entry.enquiryType)) throw new UnprocessableEntityException(`Unknown enquiry type: ${entry.enquiryType}`);
        if (!(REQUIRED_AT as readonly string[]).includes(entry.requiredAt)) throw new UnprocessableEntityException("Choose when the field is required");
        // The enquiry form saves the firm's own fields after the enquiry exists, so they can't be required to create it.
        if (fieldKey.startsWith("cf:") && entry.requiredAt === "create") throw new UnprocessableEntityException("A custom field can be required from conversion on");
      }
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('crm_enquiry_requirements:' || $1::text, 0))`, [workspaceId]);
      const before = await loadRequirementRows(client, workspaceId);
      const stored = (type: string) => before.filter((row) => row.enquiryType === type);
      const changes: Array<{ enquiryType: string; from: RequiredAt | null; to: RequiredAt }> = [];
      for (const entry of input.types) {
        const rows = stored(entry.enquiryType);
        const current = rows.find((row) => row.fieldKey === fieldKey);
        const effective = rulesByType(before, [entry.enquiryType])[entry.enquiryType][fieldKey] ?? "never";
        if (effective === entry.requiredAt) continue;
        if ((current?.version ?? 0) !== entry.version) throw new ConflictException("These requirements changed. Reload and try again");
        if (!rows.length) {
          // The type's first save: its defaults become rows, so nothing it relied on changes silently.
          for (const [key, at] of Object.entries(DEFAULT_REQUIREMENTS)) if (key !== fieldKey) {
            await client.query(`INSERT INTO crm_enquiry_requirements (workspace_id, enquiry_type, field_key, required_at, updated_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
              [workspaceId, entry.enquiryType, key, at, user.userId]);
          }
        }
        const saved = current
          ? await client.query(`UPDATE crm_enquiry_requirements SET required_at = $4, version = version + 1, updated_by = $5, updated_at = now()
              WHERE workspace_id = $1 AND enquiry_type = $2 AND field_key = $3 AND version = $6`, [workspaceId, entry.enquiryType, fieldKey, entry.requiredAt, user.userId, entry.version])
          : await client.query(`INSERT INTO crm_enquiry_requirements (workspace_id, enquiry_type, field_key, required_at, updated_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
              [workspaceId, entry.enquiryType, fieldKey, entry.requiredAt, user.userId]);
        if (!saved.rowCount) throw new ConflictException("These requirements changed. Reload and try again");
        changes.push({ enquiryType: entry.enquiryType, from: effective, to: entry.requiredAt as RequiredAt });
      }
      if (changes.length) {
        await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "crm.enquiry_requirements.updated.v1", entityType: "workspace", entityId: workspaceId,
          before: { fieldKey, types: changes.map(({ enquiryType, from }) => ({ enquiryType, requiredAt: from })) }, after: { fieldKey, types: changes.map(({ enquiryType, to }) => ({ enquiryType, requiredAt: to })) } });
      }
      return this.requirementState(client, workspaceId);
    });
  }

  private async requirementState(client: PoolClient, workspaceId: string) {
    const options = await loadLeadOptions(client, workspaceId);
    const rows = await loadRequirementRows(client, workspaceId);
    const versions: Record<string, Record<string, number>> = {};
    for (const row of rows) versions[row.enquiryType] = { ...(versions[row.enquiryType] ?? {}), [row.fieldKey]: Number(row.version) };
    return { rules: rulesByType(rows, options.enquiryTypes.map((type) => type.id)), versions };
  }

  /** Staff set or clear an enquiry's own-field values; the enquiry is reached through its lead. */
  setLeadValues(actor: RequestActor, workspaceId: string, leadId: string, input: { values: Record<string, unknown> }) {
    return this.access.withPermission(actor, workspaceId, "crm.leads.manage", async (client, user) => {
      const lead = await client.query<{ enquiryId: string }>(`SELECT enquiry_id AS "enquiryId" FROM crm_leads WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [workspaceId, leadId]);
      if (!lead.rowCount) throw new NotFoundException("Enquiry not found");
      const enquiryId = lead.rows[0].enquiryId;
      const ids = Object.keys(input.values ?? {});
      if (ids.length > 200) throw new ConflictException("Too many fields in one save");
      const before = await client.query(`SELECT ${enquiryCustomValuesSql("$1", "$2")} AS values`, [workspaceId, enquiryId]);
      const { set, clear } = normalizeCustomValues(await enquiryFieldDefinitions(client, workspaceId, ids), input.values ?? {});
      await writeEnquiryCustomValues(client, workspaceId, enquiryId, set);
      if (clear.length) await client.query(`DELETE FROM crm_custom_field_values WHERE workspace_id=$1 AND entity_type='enquiry' AND entity_id=$2 AND definition_id = ANY($3::uuid[])`, [workspaceId, enquiryId, clear]);
      const after = await client.query(`SELECT ${enquiryCustomValuesSql("$1", "$2")} AS values`, [workspaceId, enquiryId]);
      await client.query(`UPDATE crm_enquiries SET updated_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, enquiryId]);
      await this.events.record(client, { workspaceId, actorUserId: user.userId, source: "user", action: "crm.enquiry.fields_updated.v1", entityType: "crm_enquiry", entityId: enquiryId, before: before.rows[0].values, after: after.rows[0].values });
      return { leadId, customFields: after.rows[0].values };
    });
  }
}
