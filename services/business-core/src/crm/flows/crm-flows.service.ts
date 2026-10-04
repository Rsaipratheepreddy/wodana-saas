import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { recordAudit } from "../../audit/record-audit";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { flowChecksum, validateFlowDefinition } from "./flow-definition";
import { ensureStarterFlows } from "./flow-store";

const PERMISSION = "crm.settings.manage";

type FlowRow = { id: string; code: string; name: string; status: string; version: number };
type VersionRow = { id: string; version: number; checksum: string; source: string; publishedAt: Date; publishedBy: string | null; definition?: unknown };

/**
 * Plan §5a, F2/F3: Settings › Sales › Flows. A firm lists its flows, reads a version, validates a draft, publishes a
 * new version (immutable, version-checked, idempotent on replay, audited) and points an enquiry type at a flow.
 * Starter flows are seeded on first read.
 */
@Injectable()
export class CrmFlowsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  list(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client) => {
      await ensureStarterFlows(client, workspaceId);
      const flows = (await client.query<FlowRow & { latest: VersionRow | null; usedBy: unknown[] }>(
        `SELECT flow.id, flow.code, flow.name, flow.status, flow.version,
                (SELECT jsonb_build_object('id', version.id, 'version', version.version, 'checksum', version.checksum, 'source', version.source,
                                           'publishedAt', version.published_at, 'publishedBy', account.display_name)
                   FROM crm_flow_versions version LEFT JOIN users account ON account.id = version.published_by
                  WHERE version.workspace_id = flow.workspace_id AND version.flow_id = flow.id ORDER BY version.version DESC LIMIT 1) AS latest,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('id', choice.id, 'code', choice.code, 'label', choice.label, 'version', choice.version) ORDER BY choice.position, choice.label)
                   FROM crm_taxonomy_options choice JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = choice.workspace_id AND taxonomy.id = choice.taxonomy_id AND taxonomy.code = 'enquiry_type'
                  WHERE choice.workspace_id = flow.workspace_id AND choice.status = 'active'
                    AND (choice.flow = flow.code
                         -- An unset or unknown flow runs the basic flow.
                         OR (flow.code = 'basic' AND NOT EXISTS (SELECT 1 FROM crm_flows other WHERE other.workspace_id = choice.workspace_id AND other.code = choice.flow AND other.status = 'active')))), '[]'::jsonb) AS "usedBy"
           FROM crm_flows flow WHERE flow.workspace_id = $1 ORDER BY flow.name`,
        [workspaceId])).rows;
      return { data: flows };
    });
  }

  get(actor: RequestActor, workspaceId: string, flowId: string, version?: number) {
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client) => {
      await ensureStarterFlows(client, workspaceId);
      const flow = await this.requireFlow(client, workspaceId, flowId, false);
      const versions = (await client.query<VersionRow>(
        `SELECT version.id, version.version, version.checksum, version.source, version.published_at AS "publishedAt", account.display_name AS "publishedBy"
           FROM crm_flow_versions version LEFT JOIN users account ON account.id = version.published_by
          WHERE version.workspace_id = $1 AND version.flow_id = $2 ORDER BY version.version DESC`,
        [workspaceId, flowId])).rows;
      const wanted = version ?? versions[0]?.version;
      const selected = (await client.query<{ definition: unknown }>(
        `SELECT definition FROM crm_flow_versions WHERE workspace_id = $1 AND flow_id = $2 AND version = $3`, [workspaceId, flowId, wanted])).rows[0];
      if (!selected) throw new NotFoundException("Flow version not found");
      return { ...flow, versions, selected: { ...versions.find((item) => item.version === wanted), definition: selected.definition } };
    });
  }

  /** Runs the publisher's validator on a draft without saving it. */
  validate(actor: RequestActor, workspaceId: string, definition: unknown) {
    return this.access.withPermission(actor, workspaceId, PERMISSION, async () => {
      const result = validateFlowDefinition(definition);
      return result.ok ? { valid: true, errors: [], checksum: flowChecksum(result.definition) } : { valid: false, errors: result.errors, checksum: null };
    });
  }

  /**
   * Publishes a new version (engine rule 3: a published flow is immutable). `expectedVersion` is the version the
   * editor started from; a replay of the same publish returns the version it created.
   */
  async publish(actor: RequestActor, workspaceId: string, flowId: string, input: { expectedVersion: number; definition: unknown }) {
    const result = validateFlowDefinition(input.definition);
    if (!result.ok) throw new UnprocessableEntityException({ message: "The flow cannot be published", errors: result.errors });
    const checksum = flowChecksum(result.definition);
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client, user) => {
      await ensureStarterFlows(client, workspaceId);
      const flow = await this.requireFlow(client, workspaceId, flowId, true);
      if (flow.status !== "active") throw new UnprocessableEntityException("Restore the flow before publishing it");
      const latest = (await client.query<{ id: string; version: number; checksum: string }>(
        `SELECT id, version, checksum FROM crm_flow_versions WHERE workspace_id = $1 AND flow_id = $2 ORDER BY version DESC LIMIT 1`, [workspaceId, flowId])).rows[0];
      const current = latest?.version ?? 0;
      if (current !== input.expectedVersion) {
        // The same publish sent twice: hand back what the first one created.
        if (latest && current === input.expectedVersion + 1 && latest.checksum === checksum) return this.versionOf(client, workspaceId, latest.id, false);
        throw new ConflictException("This flow changed in another window. Reload and try again.");
      }
      if (latest?.checksum === checksum) throw new UnprocessableEntityException("Nothing changed since the last version");
      const created = (await client.query<{ id: string }>(
        `INSERT INTO crm_flow_versions (workspace_id, flow_id, version, definition, checksum, source, published_by)
         VALUES ($1, $2, $3, $4::jsonb, $5, 'published', $6) RETURNING id`,
        [workspaceId, flowId, current + 1, JSON.stringify(result.definition), checksum, user.userId])).rows[0];
      await client.query(`UPDATE crm_flows SET version = version + 1, updated_by = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, flowId, user.userId]);
      await recordAudit(client, {
        workspaceId, actorUserId: user.userId, action: "crm.flow.published.v1", entityType: "crm_flow", entityId: flowId,
        before: latest ? { version: latest.version, checksum: latest.checksum } : null, after: { version: current + 1, versionId: created.id, checksum },
      });
      return this.versionOf(client, workspaceId, created.id, true);
    });
  }

  /** Points an enquiry type at a flow (version-checked against the enquiry type, audited). New jobs of that type follow it. */
  assignEnquiryType(actor: RequestActor, workspaceId: string, flowId: string, optionId: string, input: { version: number }) {
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client, user) => {
      const flow = await this.requireFlow(client, workspaceId, flowId, false);
      if (flow.status !== "active") throw new UnprocessableEntityException("Choose an active flow");
      const before = (await client.query<{ id: string; code: string; label: string; flow: string | null; version: number }>(
        `SELECT choice.id, choice.code, choice.label, choice.flow, choice.version FROM crm_taxonomy_options choice
           JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = choice.workspace_id AND taxonomy.id = choice.taxonomy_id AND taxonomy.code = 'enquiry_type'
          WHERE choice.workspace_id = $1 AND choice.id = $2 FOR UPDATE OF choice`, [workspaceId, optionId])).rows[0];
      if (!before) throw new NotFoundException("Enquiry type not found");
      if (before.flow === flow.code) return { ...before, flowId };
      if (before.version !== input.version) throw new ConflictException("This enquiry type changed in another window. Reload and try again.");
      const after = (await client.query<{ id: string; code: string; label: string; flow: string; version: number }>(
        `UPDATE crm_taxonomy_options SET flow = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2 AND version = $4
         RETURNING id, code, label, flow, version`, [workspaceId, optionId, flow.code, input.version])).rows[0];
      if (!after) throw new ConflictException("This enquiry type changed in another window. Reload and try again.");
      await recordAudit(client, {
        workspaceId, actorUserId: user.userId, action: "crm.enquiry_type.flow_changed.v1", entityType: "crm_taxonomy_option", entityId: optionId,
        before: { flow: before.flow }, after: { flow: after.flow, flowId },
      });
      return { ...after, flowId };
    });
  }

  private async requireFlow(client: PoolClient, workspaceId: string, flowId: string, lock: boolean) {
    const flow = (await client.query<FlowRow>(
      `SELECT id, code, name, status, version FROM crm_flows WHERE workspace_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [workspaceId, flowId])).rows[0];
    if (!flow) throw new NotFoundException("Flow not found");
    return flow;
  }

  private async versionOf(client: PoolClient, workspaceId: string, versionId: string, created: boolean) {
    const row = (await client.query<VersionRow & { flowId: string }>(
      `SELECT id, flow_id AS "flowId", version, checksum, source, published_at AS "publishedAt", definition FROM crm_flow_versions WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, versionId])).rows[0];
    return { ...row, created };
  }
}
