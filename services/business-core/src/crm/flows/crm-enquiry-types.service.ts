import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { recordAudit } from "../../audit/record-audit";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { UNRESOLVED_ENQUIRY_TYPE } from "../leads/lead-options";
import { loadFlowDetail } from "./crm-flows.service";
import { ensureEnquiryTypeFlows, flowCodeFor, freeFlowCode, repairStarterFlows } from "./enquiry-type-flows";
import { flowChecksum, validateFlowDefinition } from "./flow-definition";
import { flowTemplate } from "./flow-templates";
import { copyClosingRules, inferClosing, seedClosingRules, TEMPLATE_CLOSING } from "./flow-closing";
import { copyWonAreas } from "./flow-won-areas";
import { STARTER_FLOWS } from "./starter-flows";

const PERMISSION = "crm.settings.manage";
const TAKEN = "An enquiry type with this name already exists. Choose another name.";
const STALE = "This enquiry type changed in another window. Reload and try again.";

type TypeRow = { id: string; code: string; label: string; color: number | null; status: string; version: number; flowId: string | null };
export type CreateEnquiryTypeInput = { label: string; color?: number | null; templateKey?: string; copyFromTypeId?: string; blank?: boolean };
export type UpdateEnquiryTypeInput = { version: number; label?: string; color?: number | null; status?: "active" | "archived" };

const validColor = (color: number | null | undefined) => color === undefined || color === null || (Number.isInteger(color) && color >= 1 && color <= 6);

/**
 * Plan §5a: Enquiry types, each with its own steps (one enquiry type, one flow). A firm lists its types with a summary of
 * their steps, adds a type with its steps in one go (from a template, a copy of another type's steps, or blank), and
 * renames, recolours or archives a type. Archiving keeps the type's history; an archived type takes no new enquiries.
 * Steps are edited and published through the flow engine (`CrmFlowsService.publish`).
 */
@Injectable()
export class CrmEnquiryTypesService {
  constructor(private readonly access: WorkspaceAccessService) {}

  list(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client, user) => {
      await ensureEnquiryTypeFlows(client, workspaceId, { actorUserId: user.userId });
      const rows = (await client.query(
        `SELECT choice.id, choice.code, choice.label, choice.color, choice.status, choice.version, flow.id AS "flowId",
                -- Open jobs of this type, whichever version of its steps they run.
                (SELECT count(*)::int FROM crm_opportunities job
                   JOIN crm_leads lead ON lead.workspace_id = job.workspace_id AND lead.id = job.lead_id
                   JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
                  WHERE job.workspace_id = choice.workspace_id AND job.status = 'open' AND enquiry.service_type = choice.code) AS "runningJobs",
                (SELECT jsonb_build_object('id', version.id, 'version', version.version, 'source', version.source,
                                           'publishedAt', version.published_at, 'publishedBy', account.display_name,
                                           'steps', (SELECT COALESCE(jsonb_agg(item.step->>'name' ORDER BY item.position), '[]'::jsonb)
                                                       FROM jsonb_array_elements(COALESCE(version.definition->'steps', '[]'::jsonb)) WITH ORDINALITY AS item(step, position)))
                   FROM crm_flow_versions version LEFT JOIN users account ON account.id = version.published_by
                  WHERE version.workspace_id = flow.workspace_id AND version.flow_id = flow.id ORDER BY version.version DESC LIMIT 1) AS latest
           FROM crm_taxonomy_options choice
           JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = choice.workspace_id AND taxonomy.id = choice.taxonomy_id AND taxonomy.code = 'enquiry_type'
           LEFT JOIN crm_flows flow ON flow.workspace_id = choice.workspace_id AND flow.enquiry_type_option_id = choice.id
          WHERE choice.workspace_id = $1 AND choice.status = 'active' AND choice.code <> $2
          ORDER BY choice.position, choice.label`,
        [workspaceId, UNRESOLVED_ENQUIRY_TYPE])).rows;
      return { data: rows };
    });
  }

  /**
   * QA-002: the operator's repair for a workspace provisioned before enquiry types started from their flows: each type
   * still on its untouched Basic copy takes the flow named for it (type code → design, fit_out, furniture). Audited and
   * idempotent; `dryRun` lists what would change.
   */
  repairStarterFlows(actor: RequestActor, workspaceId: string, wanted: Record<string, string>, dryRun = false) {
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client, user) =>
      repairStarterFlows(client, workspaceId, new Map(Object.entries(wanted)), { actorUserId: user.userId, dryRun }));
  }

  /** The type with its steps: the flow's versions and one version's definition (the latest when none is named). */
  get(actor: RequestActor, workspaceId: string, optionId: string, version?: number) {
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client, user) => {
      await ensureEnquiryTypeFlows(client, workspaceId, { actorUserId: user.userId });
      const type = await this.requireType(client, workspaceId, optionId, false);
      if (!type.flowId) throw new NotFoundException("Enquiry type not found");
      const { id, code, label, color, status, version: typeVersion } = type;
      return { ...await loadFlowDetail(client, workspaceId, type.flowId, version), enquiryType: { id, code, label, color, status, version: typeVersion } };
    });
  }

  /**
   * A new enquiry type and its steps, in one transaction. The type's code comes from its name; the same create sent
   * twice returns the type the first one made; a name another type has is refused.
   */
  async create(actor: RequestActor, workspaceId: string, input: CreateEnquiryTypeInput) {
    const label = input.label.trim();
    if (!label) throw new UnprocessableEntityException("Give the enquiry type a name");
    if (!validColor(input.color)) throw new UnprocessableEntityException("Choose one of the colours");
    if ([input.templateKey, input.copyFromTypeId, input.blank].filter(Boolean).length !== 1)
      throw new UnprocessableEntityException("Start from a template, another enquiry type or blank");
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client, user) => {
      await ensureEnquiryTypeFlows(client, workspaceId, { actorUserId: user.userId });
      let definition: unknown;
      let from: Record<string, unknown>;
      if (input.templateKey) {
        const template = flowTemplate(input.templateKey);
        if (!template) throw new UnprocessableEntityException("Choose a template");
        definition = template.definition;
        from = { template: input.templateKey };
      } else if (input.copyFromTypeId) {
        const source = await this.requireType(client, workspaceId, input.copyFromTypeId, false);
        const row = source.flowId ? (await client.query<{ version: number; definition: unknown }>(
          `SELECT version, definition FROM crm_flow_versions WHERE workspace_id = $1 AND flow_id = $2 ORDER BY version DESC LIMIT 1`, [workspaceId, source.flowId])).rows[0] : undefined;
        if (!row) throw new NotFoundException("Enquiry type not found");
        definition = row.definition;
        from = { enquiryTypeId: source.id, flowId: source.flowId, version: row.version };
      } else {
        definition = STARTER_FLOWS.basic.definition;
        from = { blank: true };
      }
      const result = validateFlowDefinition(definition);
      if (!result.ok) throw new UnprocessableEntityException({ message: "These steps cannot be copied", errors: result.errors });
      const checksum = flowChecksum(result.definition);
      const taxonomy = await this.lockTaxonomy(client, workspaceId);
      const code = flowCodeFor(label);
      const existing = (await client.query<TypeRow & { createdBy: string | null; firstChecksum: string | null }>(
        `SELECT choice.id, choice.code, choice.label, choice.color, choice.status, choice.version, flow.id AS "flowId", flow.created_by AS "createdBy",
                (SELECT version.checksum FROM crm_flow_versions version WHERE version.workspace_id = flow.workspace_id AND version.flow_id = flow.id AND version.version = 1) AS "firstChecksum"
           FROM crm_taxonomy_options choice
           LEFT JOIN crm_flows flow ON flow.workspace_id = choice.workspace_id AND flow.enquiry_type_option_id = choice.id
          WHERE choice.workspace_id = $1 AND choice.taxonomy_id = $2 AND (choice.code = $3 OR (choice.status = 'active' AND lower(choice.label) = lower($4)))
          ORDER BY (choice.code = $3) DESC LIMIT 1`,
        [workspaceId, taxonomy.id, code, label])).rows[0];
      if (existing) {
        // The same create sent twice: hand back the type the first one made.
        if (existing.status === "active" && existing.label === label && existing.firstChecksum === checksum && existing.createdBy === user.userId) {
          const { createdBy: _createdBy, firstChecksum: _firstChecksum, ...type } = existing;
          return { ...type, created: false };
        }
        throw new ConflictException(TAKEN);
      }
      const option = (await client.query<{ id: string; version: number; position: number }>(
        `INSERT INTO crm_taxonomy_options (workspace_id, taxonomy_id, code, label, position, color)
         VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(position), -1) + 1 FROM crm_taxonomy_options WHERE workspace_id = $1 AND taxonomy_id = $2), $5)
         ON CONFLICT (workspace_id, taxonomy_id, code) DO NOTHING RETURNING id, version, position`,
        [workspaceId, taxonomy.id, code, label, input.color ?? null])).rows[0];
      if (!option) throw new ConflictException(TAKEN);
      const flowCode = await freeFlowCode(client, workspaceId, code);
      const flow = (await client.query<{ id: string }>(
        `INSERT INTO crm_flows (workspace_id, code, name, enquiry_type_option_id, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [workspaceId, flowCode, label.slice(0, 120), option.id, user.userId])).rows[0];
      const version = (await client.query<{ id: string }>(
        `INSERT INTO crm_flow_versions (workspace_id, flow_id, version, definition, checksum, source, published_by)
         VALUES ($1, $2, 1, $3::jsonb, $4, 'published', $5) RETURNING id`,
        [workspaceId, flow.id, JSON.stringify(result.definition), checksum, user.userId])).rows[0];
      await client.query(`UPDATE crm_taxonomy_options SET flow = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, option.id, flowCode]);
      // PLM-102: the type closes deals the way its template or the type it was copied from does.
      const sourceFlowId = typeof from.flowId === "string" ? from.flowId : null;
      if (sourceFlowId) await copyClosingRules(client, workspaceId, sourceFlowId, flow.id, user.userId);
      if (sourceFlowId) await copyWonAreas(client, workspaceId, sourceFlowId, flow.id, user.userId);
      else await seedClosingRules(client, workspaceId, flow.id, (input.templateKey ? TEMPLATE_CLOSING[input.templateKey] : undefined) ?? inferClosing(result.definition), user.userId);
      await client.query(`UPDATE crm_taxonomies SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, taxonomy.id]);
      await recordAudit(client, {
        workspaceId, actorUserId: user.userId, action: "crm.enquiry_type.created.v1", entityType: "crm_taxonomy_option", entityId: option.id,
        after: { code, label, color: input.color ?? null, position: option.position, flowId: flow.id, flow: flowCode, versionId: version.id, checksum, from },
      });
      return { id: option.id, code, label, color: input.color ?? null, status: "active", version: option.version, flowId: flow.id, created: true };
    });
  }

  /** Renames, recolours, archives or restores a type (version-checked, audited). The same change sent twice changes nothing. */
  async update(actor: RequestActor, workspaceId: string, optionId: string, input: UpdateEnquiryTypeInput) {
    const label = input.label?.trim();
    if (input.label !== undefined && !label) throw new UnprocessableEntityException("Give the enquiry type a name");
    if (!validColor(input.color)) throw new UnprocessableEntityException("Choose one of the colours");
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client, user) => {
      const before = await this.requireType(client, workspaceId, optionId, true);
      if (before.code === UNRESOLVED_ENQUIRY_TYPE) throw new UnprocessableEntityException("Keep the Not sure yet option for enquiries");
      const next = { label: label ?? before.label, color: input.color === undefined ? before.color : input.color, status: input.status ?? before.status };
      const unchanged = next.label === before.label && next.color === before.color && next.status === before.status;
      // Nothing to change, or the same change sent again after it was saved.
      if (unchanged && (before.version === input.version || before.version === input.version + 1)) return before;
      if (before.version !== input.version) throw new ConflictException(STALE);
      if (next.label !== before.label || (next.status === "active" && before.status !== "active")) {
        const clash = await client.query(
          `SELECT 1 FROM crm_taxonomy_options other JOIN crm_taxonomy_options self ON self.workspace_id = other.workspace_id AND self.taxonomy_id = other.taxonomy_id
            WHERE self.workspace_id = $1 AND self.id = $2 AND other.id <> self.id AND other.status = 'active' AND lower(other.label) = lower($3)`,
          [workspaceId, optionId, next.label]);
        if (clash.rowCount) throw new ConflictException(TAKEN);
      }
      const after = (await client.query<TypeRow>(
        `UPDATE crm_taxonomy_options SET label = $3, color = $4, status = $5, version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND id = $2 AND version = $6 RETURNING id, code, label, color, status, version`,
        [workspaceId, optionId, next.label, next.color, next.status, input.version])).rows[0];
      if (!after) throw new ConflictException(STALE);
      await client.query(`UPDATE crm_taxonomies SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = (SELECT taxonomy_id FROM crm_taxonomy_options WHERE workspace_id = $1 AND id = $2)`, [workspaceId, optionId]);
      const { flowId, ...previous } = before;
      await recordAudit(client, {
        workspaceId, actorUserId: user.userId, action: before.status !== after.status ? (after.status === "archived" ? "crm.enquiry_type.archived.v1" : "crm.enquiry_type.restored.v1") : "crm.enquiry_type.updated.v1",
        entityType: "crm_taxonomy_option", entityId: optionId, before: previous, after,
      });
      // A restored type that never had steps gets them now.
      if (after.status === "active") await ensureEnquiryTypeFlows(client, workspaceId, { actorUserId: user.userId, fromBasic: new Set([optionId]) });
      return { ...after, flowId };
    });
  }

  private async requireType(client: PoolClient, workspaceId: string, optionId: string, lock: boolean) {
    const row = (await client.query<TypeRow>(
      `SELECT choice.id, choice.code, choice.label, choice.color, choice.status, choice.version, flow.id AS "flowId"
         FROM crm_taxonomy_options choice
         JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = choice.workspace_id AND taxonomy.id = choice.taxonomy_id AND taxonomy.code = 'enquiry_type'
         LEFT JOIN crm_flows flow ON flow.workspace_id = choice.workspace_id AND flow.enquiry_type_option_id = choice.id
        WHERE choice.workspace_id = $1 AND choice.id = $2${lock ? " FOR UPDATE OF choice" : ""}`, [workspaceId, optionId])).rows[0];
    if (!row) throw new NotFoundException("Enquiry type not found");
    return row;
  }

  /** The workspace's enquiry-type list, locked; created with its "Not sure yet" placeholder when the firm has none yet. */
  private async lockTaxonomy(client: PoolClient, workspaceId: string) {
    const existing = (await client.query<{ id: string }>(
      `SELECT id FROM crm_taxonomies WHERE workspace_id = $1 AND code = 'enquiry_type' FOR UPDATE`, [workspaceId])).rows[0];
    if (existing) return existing;
    const created = (await client.query<{ id: string }>(
      `INSERT INTO crm_taxonomies (workspace_id, code, name) VALUES ($1, 'enquiry_type', 'Enquiry types')
       ON CONFLICT DO NOTHING RETURNING id`, [workspaceId])).rows[0]
      ?? (await client.query<{ id: string }>(`SELECT id FROM crm_taxonomies WHERE workspace_id = $1 AND code = 'enquiry_type' FOR UPDATE`, [workspaceId])).rows[0];
    await client.query(
      `INSERT INTO crm_taxonomy_options (workspace_id, taxonomy_id, code, label, position) VALUES ($1, $2, $3, 'Not sure yet', 0)
       ON CONFLICT (workspace_id, taxonomy_id, code) DO NOTHING`, [workspaceId, created.id, UNRESOLVED_ENQUIRY_TYPE]);
    return created;
  }
}
