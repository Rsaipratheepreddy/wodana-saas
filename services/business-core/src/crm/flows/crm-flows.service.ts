import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { recordAudit } from "../../audit/record-audit";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { createHash } from "node:crypto";
import { flowChecksum, validateFlowDefinition } from "./flow-definition";
import { ensureStarterFlows } from "./flow-store";
import { FLOW_TEMPLATES, flowTemplate } from "./flow-templates";
import { STARTER_FLOWS } from "./starter-flows";
import { UNRESOLVED_ENQUIRY_TYPE } from "../leads/lead-options";

const PERMISSION = "crm.settings.manage";
/** Refusal for pointing the "Not sure yet" placeholder at a flow; the web shows it as is (an en.json key). */
export const NOT_SURE_IN_FLOW = "Not sure yet stays in the first column until the enquiry type is known, so it cannot follow a flow";

type FlowRow = { id: string; code: string; name: string; status: string; version: number };
/**
 * The code a new flow is stored under (enquiry types point at it): the name in lower-case letters, digits and _,
 * or a stable hash of the name when it has too few Latin letters (an Arabic name, for instance).
 */
export function flowCodeFor(name: string) {
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+/, "").slice(0, 40).replace(/_+$/, "");
  return slug.length >= 2 ? slug : `flow_${createHash("sha256").update(name.trim()).digest("hex").slice(0, 8)}`;
}

type VersionRow = { id: string; version: number; checksum: string; source: string; publishedAt: Date; publishedBy: string | null; definition?: unknown };

/**
 * Plan §5a, F2/F3: Flows. A firm lists its flows, creates one from a starter or a copy, reads a version, validates a
 * draft, publishes a new version (immutable, version-checked, idempotent on replay, audited) and points an enquiry
 * type at a flow. Starter flows are seeded on first read.
 */
@Injectable()
export class CrmFlowsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  list(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client) => {
      await ensureStarterFlows(client, workspaceId);
      const flows = (await client.query<FlowRow & { latest: VersionRow | null; usedBy: unknown[]; runningJobs: number }>(
        `SELECT flow.id, flow.code, flow.name, flow.status, flow.version,
                (SELECT count(*)::int FROM crm_opportunities job JOIN crm_flow_versions pinned ON pinned.workspace_id = job.workspace_id AND pinned.id = job.flow_version_id
                  WHERE job.workspace_id = flow.workspace_id AND pinned.flow_id = flow.id AND job.status = 'open') AS "runningJobs",
                (SELECT jsonb_build_object('id', version.id, 'version', version.version, 'checksum', version.checksum, 'source', version.source,
                                           'publishedAt', version.published_at, 'publishedBy', account.display_name,
                                           -- The main line's step names, in order, so the list can say what the flow does.
                                           'steps', (SELECT COALESCE(jsonb_agg(item.step->>'name' ORDER BY item.position), '[]'::jsonb)
                                                       FROM jsonb_array_elements(COALESCE(version.definition->'steps', '[]'::jsonb)) WITH ORDINALITY AS item(step, position)))
                   FROM crm_flow_versions version LEFT JOIN users account ON account.id = version.published_by
                  WHERE version.workspace_id = flow.workspace_id AND version.flow_id = flow.id ORDER BY version.version DESC LIMIT 1) AS latest,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('id', choice.id, 'code', choice.code, 'label', choice.label, 'version', choice.version,
                                                    -- False when the type names no active flow and so runs the basic flow by default.
                                                    'assigned', COALESCE(choice.flow = flow.code, false)) ORDER BY choice.position, choice.label)
                   FROM crm_taxonomy_options choice JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = choice.workspace_id AND taxonomy.id = choice.taxonomy_id AND taxonomy.code = 'enquiry_type'
                  -- "Not sure yet" is the placeholder that cannot leave the first column (PLM-007): never in a flow.
                  WHERE choice.workspace_id = flow.workspace_id AND choice.status = 'active' AND choice.code <> $2
                    AND (choice.flow = flow.code
                         -- An unset or unknown flow runs the basic flow.
                         OR (flow.code = 'basic' AND NOT EXISTS (SELECT 1 FROM crm_flows other WHERE other.workspace_id = choice.workspace_id AND other.code = choice.flow AND other.status = 'active')))), '[]'::jsonb) AS "usedBy"
           FROM crm_flows flow WHERE flow.workspace_id = $1 ORDER BY flow.name`,
        [workspaceId, UNRESOLVED_ENQUIRY_TYPE])).rows;
      return { data: flows };
    });
  }

  /** The template library a new flow can start from (product content, the same for every firm). */
  templates(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, PERMISSION, async () => ({
      data: FLOW_TEMPLATES.map(({ key, name, description, group, suggestedEnquiryTypes, definition }) =>
        ({ key, name, description, group, suggestedEnquiryTypes, stepCount: definition.steps.length, definition })),
    }));
  }

  /**
   * A new flow from a starter flow, a library template or a copy of a version of one of the workspace's flows. Its
   * first version is the source definition (validated). The code comes from the name; the same create sent twice
   * returns the flow it made.
   */
  async create(actor: RequestActor, workspaceId: string, input: { name: string; starter?: string; templateKey?: string; sourceFlowId?: string; sourceVersion?: number }) {
    const name = input.name.trim();
    if (!name) throw new UnprocessableEntityException("Give the flow a name");
    if ([input.starter, input.templateKey, input.sourceFlowId].filter(Boolean).length !== 1)
      throw new UnprocessableEntityException("Start from a starter flow, a template or one of your flows");
    if (input.sourceVersion !== undefined && !input.sourceFlowId) throw new UnprocessableEntityException("Only a copied flow names a version");
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client, user) => {
      await ensureStarterFlows(client, workspaceId);
      let definition: unknown;
      let from: Record<string, unknown>;
      if (input.starter) {
        const starter = STARTER_FLOWS[input.starter];
        if (!starter) throw new UnprocessableEntityException("Choose a starter flow");
        definition = starter.definition;
        from = { starter: input.starter };
      } else if (input.templateKey) {
        const template = flowTemplate(input.templateKey);
        if (!template) throw new UnprocessableEntityException("Choose a template");
        definition = template.definition;
        from = { template: input.templateKey };
      } else {
        const source = await this.requireFlow(client, workspaceId, input.sourceFlowId!, false);
        const row = (await client.query<{ version: number; definition: unknown }>(
          `SELECT version, definition FROM crm_flow_versions WHERE workspace_id = $1 AND flow_id = $2 AND ($3::int IS NULL OR version = $3)
            ORDER BY version DESC LIMIT 1`, [workspaceId, source.id, input.sourceVersion ?? null])).rows[0];
        if (!row) throw new NotFoundException("Flow version not found");
        definition = row.definition;
        from = { flowId: source.id, version: row.version };
      }
      const result = validateFlowDefinition(definition);
      if (!result.ok) throw new UnprocessableEntityException({ message: "The source flow cannot be copied", errors: result.errors });
      const checksum = flowChecksum(result.definition);
      const code = flowCodeFor(name);
      const existing = (await client.query<FlowRow & { createdBy: string | null; firstChecksum: string | null }>(
        `SELECT flow.id, flow.code, flow.name, flow.status, flow.version, flow.created_by AS "createdBy",
                (SELECT version.checksum FROM crm_flow_versions version WHERE version.workspace_id = flow.workspace_id AND version.flow_id = flow.id AND version.version = 1) AS "firstChecksum"
           FROM crm_flows flow WHERE flow.workspace_id = $1 AND flow.code = $2 FOR UPDATE`, [workspaceId, code])).rows[0];
      if (existing) {
        // The same create sent twice: hand back the flow the first one made.
        if (existing.name === name && existing.firstChecksum === checksum && existing.createdBy === user.userId) {
          const { createdBy: _createdBy, firstChecksum: _firstChecksum, ...flow } = existing;
          return { ...flow, created: false };
        }
        throw new ConflictException("A flow with this name already exists. Choose another name.");
      }
      const flow = (await client.query<FlowRow>(
        `INSERT INTO crm_flows (workspace_id, code, name, created_by, updated_by) VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (workspace_id, code) DO NOTHING RETURNING id, code, name, status, version`, [workspaceId, code, name, user.userId])).rows[0];
      if (!flow) throw new ConflictException("A flow with this name already exists. Choose another name.");
      const version = (await client.query<{ id: string }>(
        `INSERT INTO crm_flow_versions (workspace_id, flow_id, version, definition, checksum, source, published_by)
         VALUES ($1, $2, 1, $3::jsonb, $4, 'published', $5) RETURNING id`,
        [workspaceId, flow.id, JSON.stringify(result.definition), checksum, user.userId])).rows[0];
      await recordAudit(client, {
        workspaceId, actorUserId: user.userId, action: "crm.flow.created.v1", entityType: "crm_flow", entityId: flow.id,
        after: { code, name, version: 1, versionId: version.id, checksum, from },
      });
      return { ...flow, created: true };
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
  async publish(actor: RequestActor, workspaceId: string, flowId: string, input: { expectedVersion: number; definition: unknown; name?: string }) {
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
      const name = input.name?.trim() || flow.name;
      const renamed = name !== flow.name;
      if (latest?.checksum === checksum) {
        if (!latest) throw new UnprocessableEntityException("Nothing changed since the last version");
        // A rename sent twice: the flow already has the name.
        if (!renamed && input.name !== undefined && input.name.trim() === flow.name) return this.versionOf(client, workspaceId, latest.id, false);
        if (!renamed) throw new UnprocessableEntityException("Nothing changed since the last version");
        // Only the name changed: the flow is renamed and its versions stay as they are.
        await client.query(`UPDATE crm_flows SET name = $3, updated_by = $4 WHERE workspace_id = $1 AND id = $2`, [workspaceId, flowId, name, user.userId]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "crm.flow.renamed.v1", entityType: "crm_flow", entityId: flowId, before: { name: flow.name }, after: { name } });
        return this.versionOf(client, workspaceId, latest.id, false);
      }
      const created = (await client.query<{ id: string }>(
        `INSERT INTO crm_flow_versions (workspace_id, flow_id, version, definition, checksum, source, published_by)
         VALUES ($1, $2, $3, $4::jsonb, $5, 'published', $6) RETURNING id`,
        [workspaceId, flowId, current + 1, JSON.stringify(result.definition), checksum, user.userId])).rows[0];
      await client.query(`UPDATE crm_flows SET version = version + 1, name = $4, updated_by = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, flowId, user.userId, name]);
      await recordAudit(client, {
        workspaceId, actorUserId: user.userId, action: "crm.flow.published.v1", entityType: "crm_flow", entityId: flowId,
        before: latest ? { version: latest.version, checksum: latest.checksum, ...(renamed ? { name: flow.name } : {}) } : null,
        after: { version: current + 1, versionId: created.id, checksum, ...(renamed ? { name } : {}) },
      });
      return this.versionOf(client, workspaceId, created.id, true);
    });
  }

  /** Points an enquiry type at a flow (version-checked against the enquiry type, audited). New jobs of that type follow it. */
  assignEnquiryType(actor: RequestActor, workspaceId: string, flowId: string, optionId: string, input: { version: number }) {
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client, user) => {
      const flow = await this.requireFlow(client, workspaceId, flowId, false);
      if (flow.status !== "active") throw new UnprocessableEntityException("Choose an active flow");
      const before = await this.lockEnquiryType(client, workspaceId, optionId);
      if (before.code === UNRESOLVED_ENQUIRY_TYPE) throw new UnprocessableEntityException(NOT_SURE_IN_FLOW);
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

  /**
   * Takes an enquiry type out of a flow (version-checked, audited): it names no flow and so runs the basic flow, and the
   * list shows it under "Not in a flow yet". Idempotent: a type that is not in this flow is returned unchanged.
   */
  unassignEnquiryType(actor: RequestActor, workspaceId: string, flowId: string, optionId: string, input: { version: number }) {
    return this.access.withPermission(actor, workspaceId, PERMISSION, async (client, user) => {
      const flow = await this.requireFlow(client, workspaceId, flowId, false);
      const before = await this.lockEnquiryType(client, workspaceId, optionId);
      if (before.flow !== flow.code) return { ...before, flowId: null };
      if (before.version !== input.version) throw new ConflictException("This enquiry type changed in another window. Reload and try again.");
      const after = (await client.query<{ id: string; code: string; label: string; flow: null; version: number }>(
        `UPDATE crm_taxonomy_options SET flow = NULL, version = version + 1 WHERE workspace_id = $1 AND id = $2 AND version = $3
         RETURNING id, code, label, flow, version`, [workspaceId, optionId, input.version])).rows[0];
      if (!after) throw new ConflictException("This enquiry type changed in another window. Reload and try again.");
      await recordAudit(client, {
        workspaceId, actorUserId: user.userId, action: "crm.enquiry_type.flow_changed.v1", entityType: "crm_taxonomy_option", entityId: optionId,
        before: { flow: before.flow }, after: { flow: null },
      });
      return { ...after, flowId: null };
    });
  }

  private async lockEnquiryType(client: PoolClient, workspaceId: string, optionId: string) {
    const row = (await client.query<{ id: string; code: string; label: string; flow: string | null; version: number }>(
      `SELECT choice.id, choice.code, choice.label, choice.flow, choice.version FROM crm_taxonomy_options choice
         JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = choice.workspace_id AND taxonomy.id = choice.taxonomy_id AND taxonomy.code = 'enquiry_type'
        WHERE choice.workspace_id = $1 AND choice.id = $2 FOR UPDATE OF choice`, [workspaceId, optionId])).rows[0];
    if (!row) throw new NotFoundException("Enquiry type not found");
    return row;
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
