import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
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
