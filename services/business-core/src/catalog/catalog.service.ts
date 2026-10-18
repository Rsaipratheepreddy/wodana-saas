import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PoolClient } from "pg";
import { RequestActor } from "../auth/actor";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  ArchiveCatalogDto,
  CreateCatalogDto,
  RecipePreviewDto,
  SaveCatalogRecordDto,
  OrganizeCatalogDto,
  ImportCatalogDto,
} from "./catalog.dto";
import { previewRecipe } from "./catalog-recipe";
import {
  CATALOG_STARTER,
  CATALOG_STARTER_GROUPS,
  EXECUTION_BASELINE,
  STARTER_VERSION,
  starterId,
} from "./catalog-starter";
import { catalogStructure } from "./catalog-structure";
import { catalogRecordsForViewer, isRestrictedCostRecord } from "./catalog-pricing-visibility";
import { catalogRecordRole } from "./catalog-record-model";
import { applySurveyMeasurement, type StoredRecipeSurvey } from "./catalog-recipe-measurement";

type Row = {
  catalogId: string | null;
  id: string;
  kind: string;
  code: string;
  name: string;
  content: Record<string, unknown>;
  version: number;
  archived: boolean;
  starterVersion: string | null;
  updatedAt: string;
  primaryAsset?: { id: string; recordId: string; name: string; mimeType: string; hasPreview: boolean } | null;
};
const select = `SELECT id,catalog_id AS "catalogId",kind,code,name,content,version,archived,starter_version AS "starterVersion",updated_at AS "updatedAt",
  (SELECT jsonb_build_object('id',asset.id,'recordId',asset.catalog_record_id,'name',asset.original_name,'mimeType',asset.mime_type,'hasPreview',asset.preview_key IS NOT NULL)
   FROM workspace_catalog_assets asset WHERE asset.workspace_id=workspace_catalog_records.workspace_id AND asset.catalog_record_id=workspace_catalog_records.id
     AND asset.status='active' AND asset.role='primary_image' ORDER BY asset.sort_order,asset.created_at,asset.id LIMIT 1) AS "primaryAsset"
  FROM workspace_catalog_records WHERE workspace_id=$1`;
const payload = (row: Row) => ({
  ...row.content,
  recordType: catalogRecordRole({ kind: row.kind, configuration: row.content.configuration as Record<string, unknown> | undefined }),
  catalogId: row.catalogId ?? undefined,
  id: row.id,
  kind: row.kind,
  code: row.code,
  name: row.name,
  version: row.version,
  archived: row.archived,
  starterVersion: row.starterVersion,
  updatedAt: row.updatedAt,
  primaryAsset: row.primaryAsset ?? null,
});
const writable = (input: SaveCatalogRecordDto) => {
  const {
    catalogId: _catalogId,
    id: _id,
    version: _version,
    kind: _kind,
    code: _code,
    name: _name,
    ...content
  } = input;
  return content;
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
// One validator is shared by the editor, starter installation and future imports.
export function validateCatalogRecord(input: SaveCatalogRecordDto) {
  const definition = catalogStructure[input.kind];
  if (!definition)
    throw new BadRequestException("Choose a supported master group.");
  if (
    input.commerce &&
    !["work", "variant", "material", "service", "sku", "hardware", "consumable", "custom"].includes(input.kind)
  )
    throw new BadRequestException(
      "Pricing mode belongs to a sellable catalog item or variant.",
    );
  if (input.provenance && input.kind === "catalog_group")
    throw new BadRequestException(
      "Import provenance belongs to catalog records, not the catalog itself.",
    );
  if (!["material", "sku"].includes(input.kind) && input.sizes.length)
    throw new BadRequestException("Size options belong to materials or SKUs.");
  if (
    input.kind !== "unit" &&
    (input.dimension !== "none" || input.baseFactor != null)
  )
    throw new BadRequestException("Unit conversions belong to units.");
  if (
    input.kind === "unit" &&
    (input.dimension === "none" ||
      (!["pack", "reference"].includes(input.dimension) && input.baseFactor == null))
  )
    throw new BadRequestException(
      "Choose a dimension and conversion factor for this unit.",
    );
  if (["pack", "reference"].includes(input.dimension) && input.baseFactor != null)
    throw new BadRequestException(
      "Pack and reference units do not have a universal conversion factor.",
    );
  if (
    input.specificationStatus === "reference" &&
    input.kind === "material" &&
    !input.sources.length
  )
    throw new BadRequestException("Reference materials need a source.");
  for (const size of input.sizes) {
    if (
      ![
        size.lengthMm,
        size.widthMm,
        size.thicknessMm,
        size.diameterMm,
        size.packQuantity,
      ].some((v) => v != null)
    )
      throw new BadRequestException(
        "Every size needs a dimension or pack quantity.",
      );
    if (Boolean(size.packQuantity) !== Boolean(size.packUnit))
      throw new BadRequestException("Enter both pack quantity and pack unit.");
  }
  for (const values of [
    input.attributes.map((a) => a.name),
    input.sizes.map((s) => s.label),
    input.links.map((l) => `${l.relation}:${l.targetId}`),
  ]) {
    if (
      new Set(values.map((v) => v.trim().toLowerCase())).size !== values.length
    )
      throw new BadRequestException(
        "Remove duplicate attributes, sizes or linked records.",
      );
  }
  for (const l of input.links)
    if (
      !definition.links.some((d) => d.relation === l.relation) ||
      l.targetId === input.id
    )
      throw new BadRequestException(
        "This relationship is not valid for this record type.",
      );
  for (const relation of definition.links) {
    const count = input.links.filter(
      (l) => l.relation === relation.relation,
    ).length;
    if (!relation.multiple && count > 1)
      throw new BadRequestException(
        `Select only one ${relation.label.toLowerCase()}.`,
      );
    if (relation.required && !count && input.specificationStatus === "workspace_verified")
      throw new BadRequestException(
        `Choose a ${relation.label.toLowerCase()}.`,
      );
  }
  const config = input.configuration ?? {};
  if (input.kind === "record_group" && config.defaultKind &&
    (!catalogStructure[String(config.defaultKind)] || ["catalog_group", "record_group"].includes(String(config.defaultKind))))
    throw new BadRequestException("Choose a record type for this group.");
  for (const [key, value] of Object.entries(config)) {
    const field = definition.fields.find((f) => f.key === key);
    if (!field)
      throw new BadRequestException(`Unknown configuration field: ${key}.`);
    if (field.type === "number") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (field.min != null && value < field.min) ||
        (field.max != null && value > field.max)
      )
        throw new BadRequestException(
          `Enter a valid ${field.label.toLowerCase()}.`,
        );
    } else {
      if (typeof value !== "string" || !value.trim() || value.length > 2000)
        throw new BadRequestException(
          `Enter text for ${field.label.toLowerCase()}.`,
        );
      if (field.type === "select" && !field.options?.includes(value))
        throw new BadRequestException(
          `Choose a valid ${field.label.toLowerCase()}.`,
        );
      if (
        field.type === "date" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        throw new BadRequestException(
          `Enter a valid ${field.label.toLowerCase()}.`,
        );
    }
  }
  if (config.currency && !/^[A-Z]{3}$/.test(String(config.currency)))
    throw new BadRequestException("Use a three-letter ISO currency code.");
  if (
    config.effectiveFrom &&
    config.effectiveTo &&
    config.effectiveTo < config.effectiveFrom
  )
    throw new BadRequestException(
      "Effective end date must not precede the start date.",
    );
  if (
    config.minDistanceKm != null &&
    config.maxDistanceKm != null &&
    Number(config.minDistanceKm) >= Number(config.maxDistanceKm)
  )
    throw new BadRequestException(
      "Distance upper bound must exceed the lower bound.",
    );
  if (
    input.kind === "construction" &&
    ["component", "operation", "charge"].includes(String(config.recordRole)) &&
    !input.links.some((l) => l.relation === "parent")
  )
    throw new BadRequestException(
      "Choose the parent construction template for this component.",
    );
  if (input.kind === "rate_card") {
    if (!input.links.some(link=>link.relation==='unit'))
      throw new BadRequestException('Choose a measurement unit for this price.');
    const targets = input.links.filter(
      (l) => !["unit", "rate_zone", "catalog_group", "record_group"].includes(l.relation),
    );
    if (targets.length !== 1)
      throw new BadRequestException(
        "A price book entry must price exactly one product, process, resource or service.",
      );
    if (
      config.amount == null ||
      !config.currency ||
      !config.effectiveFrom ||
      !config.costIncludes ||
      config.costIncludes === "unconfirmed" ||
      !config.taxIncluded ||
      !config.priceType
    )
      throw new BadRequestException(
        "Set a rate, currency, effective date, price type, cost inclusions and tax treatment.",
      );
  }
  if (input.specificationStatus === "workspace_verified") {
    if (
      input.kind === "sku" &&
      (!config.manufacturerCode ||
        !input.links.some((l) => l.relation === "brand"))
    )
      throw new BadRequestException(
        "A verified SKU needs its actual manufacturer code and brand.",
      );
    if (
      input.kind === "tax" &&
      (!config.effectiveFrom ||
        !config.classification ||
        !config.treatment ||
        config.treatment === "unconfigured" ||
        (["standard", "zero_rated"].includes(String(config.treatment)) &&
          config.approvedPercent == null))
    )
      throw new BadRequestException(
        "Validate the tax treatment, classification, rate and effective date first.",
      );
    if (input.kind === "wastage_rule" && config.approvedPercent == null)
      throw new BadRequestException(
        "Set a workspace allowance before verifying this rule.",
      );
    if (input.kind === "commercial_rule" && config.approvedValue == null)
      throw new BadRequestException(
        "Set a workspace value before verifying this rule.",
      );
  }
  if (
    input.kind === "tax" &&
    config.treatment === "zero_rated" &&
    config.approvedPercent != null &&
    config.approvedPercent !== 0
  )
    throw new BadRequestException(
      "A zero-rated tax code must have a zero rate.",
    );
  if (
    input.kind === "commercial_rule" &&
    config.ruleGroup === "Margin" &&
    config.approvedValue != null &&
    Number(config.approvedValue) >= 100
  )
    throw new BadRequestException(
      "Gross margin must be less than 100 percent.",
    );
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly events: CrmEventsService,
  ) {}
  importRecords(actor: RequestActor, workspaceId: string, input: ImportCatalogDto) {
    return this.access.withPermissions(actor, workspaceId, ["catalog.view", "catalog.manage"], async (client, user) => {
      if (input.records.some((record) => isRestrictedCostRecord(record)) &&
        !(await this.access.hasPermission(client, workspaceId, user.userId, "supplier_offers.manage")))
        throw new ForbiddenException("Supplier cost management permission is required for purchase and internal rates.");
      await this.lock(client, workspaceId);
      await this.assertCatalog(client, workspaceId, input.catalogId);
      if (!input.records.length || input.records.length > 500) throw new BadRequestException("Import between 1 and 500 records at a time.");
      const existing = (await client.query<Row>(select, [workspaceId])).rows;
      const additions: SaveCatalogRecordDto[] = [];
      const ids = new Set<string>(), codes = new Set<string>(), names = new Set<string>(), sourceKeys = new Set<string>();
      for (const row of input.records) {
        if (row.catalogId !== input.catalogId || row.kind === "catalog_group" || row.version !== 0)
          throw new BadRequestException("Imports add new records to the chosen catalog. Existing records cannot be overwritten.");
        try { validateCatalogRecord(row); } catch (error) {
          throw new BadRequestException(`${row.name}: ${error instanceof Error ? error.message : "Invalid record."}`);
        }
        const code = `${row.kind}:${row.code}`, name = `${row.kind}:${row.name.toLowerCase()}`;
        if (ids.has(row.id) || codes.has(code) || names.has(name)) throw new BadRequestException(`Duplicate import record: ${row.name}.`);
        ids.add(row.id); codes.add(code); names.add(name);
        if (row.provenance) {
          const sourceKey = `${row.provenance.namespace}:${row.provenance.sourceKey}`;
          if (sourceKeys.has(sourceKey)) throw new BadRequestException(`Duplicate import source key: ${row.name}.`);
          sourceKeys.add(sourceKey);
        }
        const same = existing.find(r=>r.id===row.id);
        if (same) {
          if (same.archived || same.catalogId!==input.catalogId || same.kind!==row.kind || same.code!==row.code || same.name!==row.name || canonical(same.content)!==canonical(writable(row)))
            throw new ConflictException(`${row.name} changed since review. Reload records and review this import again.`);
          continue; // An identical retry after a lost response is safe and adds no duplicate.
        }
        if (existing.some(r=>r.catalogId===input.catalogId&&r.kind===row.kind&&(r.code===row.code||r.name.toLowerCase()===row.name.toLowerCase())))
          throw new ConflictException(`${row.name} already exists. Reload records and review this import again.`);
        if (row.provenance && existing.some(r => {
          const provenance = r.content.provenance as SaveCatalogRecordDto["provenance"] | undefined;
          return r.catalogId === input.catalogId && provenance?.namespace === row.provenance!.namespace && provenance.sourceKey === row.provenance!.sourceKey;
        }))
          throw new ConflictException(`${row.name} has already been reviewed from this source. Reload records and review this import again.`);
        additions.push(row);
      }
      const references = new Map(input.references.map(r=>[r.id,r.version]));
      for (const targetId of new Set(input.records.flatMap(r=>r.links.map(l=>l.targetId)).filter(id=>!ids.has(id)))) {
        const target = existing.find(r=>r.id===targetId);
        if (!target || references.get(targetId)!==target.version)
          throw new ConflictException("A linked record changed or is missing. Reload records and review this import again.");
      }
      if (input.dryRun) await client.query("SAVEPOINT catalog_import_preview");
      for (const row of additions) await client.query(
        "INSERT INTO workspace_catalog_records(workspace_id,id,kind,code,name,content,created_by,updated_by,catalog_id) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8)",
        [workspaceId,row.id,row.kind,row.code,row.name,writable(row),user.userId,input.catalogId],
      );
      // Insert the complete graph before checking it, so forward references and cycles
      // are validated just like existing records. The tenant transaction is atomic.
      for (const row of additions) await this.links(client, workspaceId, row);
      for (const row of input.records) {
        try { await this.validateLinks(client,workspaceId,row); } catch (error) {
          throw new BadRequestException(`${row.name}: ${error instanceof Error ? error.message : "Invalid connection."}`);
        }
      }
      const saved = (await client.query<Row>(`${select} AND id=ANY($2::uuid[])`,[workspaceId,[...ids]])).rows.map(payload);
      if (input.dryRun) {
        await client.query("ROLLBACK TO SAVEPOINT catalog_import_preview");
        await client.query("RELEASE SAVEPOINT catalog_import_preview");
      } else for (const row of additions) await this.events.record(client,{
        workspaceId,actorUserId:user.userId,source:"user",action:"catalog.record.imported.v1",entityType:"catalog_record",entityId:row.id,before:null,after:saved.find(r=>r.id===row.id),
      });
      return {created:additions.length,reused:input.records.length-additions.length,preview:input.dryRun,items:input.dryRun?[]:saved};
    });
  }
  preview(actor: RequestActor, workspaceId: string, input: RecipePreviewDto) {
    return this.access.withPermission(
      actor,
      workspaceId,
      "catalog.view",
      async (client, user) => {
        let resolvedInput = input;
        let measurementSource: ReturnType<typeof applySurveyMeasurement>["source"] = null;
        let measurementChanges: string[] = [];
        if (input.survey) {
          if (!(await this.access.hasPermission(client, workspaceId, user.userId, "pre_projects.view")))
            throw new ForbiddenException("Pre-execution access is required to use survey measurements.");
          const survey = await client.query<{
            id: string;
            version: number;
            status: string;
            entryId: string | null;
            dimensions: StoredRecipeSurvey["dimensions"];
          }>(
            `SELECT id::text,version,status,entry_id::text AS "entryId",
                    COALESCE(content->'dimensions','[]'::jsonb) AS dimensions
               FROM pre_project_site_records
              WHERE workspace_id=$1 AND case_id=$2 AND id=$3 AND kind='measurement'`,
            [workspaceId, input.survey.caseId, input.survey.measurementId],
          );
          if (!survey.rows[0])
            throw new BadRequestException("Choose a measurement from this pre-execution.");
          const applied = applySurveyMeasurement(input, survey.rows[0]);
          resolvedInput = applied.input;
          measurementSource = applied.source;
          measurementChanges = applied.changes;
        }
        const records = (
          await client.query<Row>(select, [workspaceId])
        ).rows.map((row) => ({
          ...row.content,
          links:row.content.links as {relation:string;targetId:string}[],
          catalogId: row.catalogId ?? undefined,
          id: row.id,
          kind: row.kind,
          code: row.code,
          name: row.name,
          version: row.version,
          archived: row.archived,
        })) as Parameters<typeof previewRecipe>[0];
        const template = records.find((r) => r.id === resolvedInput.templateId) as
          | ((typeof records)[number] & { catalogId?: string })
          | undefined;
        const owner = template?.catalogId
          ? (
              await client.query<Row>(
                `${select} AND id=$2 AND kind='catalog_group' AND NOT archived`,
                [workspaceId, template.catalogId],
              )
            ).rows[0]
          : undefined;
        if (!owner)
          throw new BadRequestException(
            "Choose a recipe in an active catalog.",
          );
        const preview = previewRecipe(
          records.filter(
            (r) => (r as typeof template)?.catalogId === template!.catalogId,
          ),
          resolvedInput,
        );
        return {
          ...preview,
          measurementSource,
          changes: [...measurementChanges, ...preview.changes],
        };
      },
    );
  }
  list(actor: RequestActor, workspaceId: string, options: { overview?: boolean; catalogId?: string } = {}) {
    return this.access.withPermission(
      actor,
      workspaceId,
      "catalog.view",
      async (client, user) => {
        const canManage = await this.access.hasPermission(
          client,
          workspaceId,
          user.userId,
          "catalog.manage",
        );
        const canViewCosts = await this.access.hasPermission(
          client,
          workspaceId,
          user.userId,
          "supplier_offers.view",
        );
        const items = (
          await client.query<Row>(`${select}${options.catalogId ? " AND (catalog_id=$2 OR kind='catalog_group')" : ""}${options.overview ? " AND kind IN ('catalog_group','room','work','variant','unit')" : ""} ORDER BY kind,name`, options.catalogId ? [workspaceId, options.catalogId] : [workspaceId])
        ).rows.map(payload);
        const workspace = (await client.query<{ defaultCurrency: string }>(
          `SELECT default_currency AS "defaultCurrency" FROM workspaces WHERE id=$1`, [workspaceId],
        )).rows[0];
        const legalEntities = (await client.query<{ id: string; name: string; baseCurrency: string }>(
          `SELECT id,display_name AS name,base_currency AS "baseCurrency" FROM legal_entities
           WHERE workspace_id=$1 AND status='active' ORDER BY display_name`, [workspaceId],
        )).rows;
        const catalogCounts = options.overview ? (await client.query<{
          catalogId: string; kind: string; count: number;
        }>(`SELECT catalog_id AS "catalogId",kind,count(*)::int AS count
              FROM workspace_catalog_records
             WHERE workspace_id=$1 AND catalog_id IS NOT NULL AND NOT archived
             GROUP BY catalog_id,kind`, [workspaceId])).rows : undefined;
        return {
          workspaceId,
          overview: Boolean(options.overview),
          currency: workspace?.defaultCurrency,
          legalEntities,
          canManage,
          canViewCosts,
          priceVisibility: canViewCosts ? "selling_and_cost" : "selling_only",
          items: catalogRecordsForViewer(items, canViewCosts),
          catalogCounts,
          componentCounts: options.overview ? (await client.query(`SELECT link.target_id AS id, count(*)::int AS count FROM workspace_catalog_links link JOIN workspace_catalog_records record ON record.workspace_id=link.workspace_id AND record.id=link.record_id WHERE link.workspace_id=$1 AND link.relation='work' AND NOT record.archived AND record.kind='construction' AND record.content->'configuration'->>'recordRole'='component' GROUP BY link.target_id`, [workspaceId])).rows : undefined,
          starter: {
            version: STARTER_VERSION,
            count: CATALOG_STARTER.length,
            market: "Interior specification, factory and on-site masters; workspace rates and approval values remain configurable",
          },
        };
      },
    );
  }
  save(actor: RequestActor, workspaceId: string, input: SaveCatalogRecordDto) {
    return this.access.withPermissions(
      actor,
      workspaceId,
      ["catalog.view", "catalog.manage"],
      async (client, user) => {
        await this.lock(client, workspaceId);
        validateCatalogRecord(input);
        if (isRestrictedCostRecord(input) &&
          !(await this.access.hasPermission(client, workspaceId, user.userId, "supplier_offers.manage")))
          throw new ForbiddenException("Supplier cost management permission is required for purchase and internal rates.");
        const current = (
          await client.query<Row>(`${select} AND id=$2`, [
            workspaceId,
            input.id,
          ])
        ).rows[0];
        if (input.kind !== "catalog_group") {
          const catalogId =
            input.catalogId ??
            current?.catalogId ??
            (await this.defaultCatalog(client, workspaceId, user.userId));
          if (current && current.catalogId !== catalogId)
            throw new BadRequestException(
              "Records cannot move between catalogs. Copy the catalog or create an item in the target catalog.",
            );
          await this.assertCatalog(client, workspaceId, catalogId);
          input = { ...input, catalogId };
        } else if (input.catalogId) {
          throw new BadRequestException("A catalog cannot belong to another catalog.");
        } else if (!current)
          throw new BadRequestException(
            "Create catalogs with the catalog setup action.",
          );
        if (
          current &&
          input.version === 0 &&
          !current.archived &&
          current.kind === input.kind &&
          current.code === input.code &&
          current.name === input.name &&
          canonical(current.content) === canonical(writable(input))
        )
          return payload(current);
        if ((current?.version ?? 0) !== input.version)
          throw new ConflictException(
            "This record changed. Your form is still available; reload the latest record before saving again.",
          );
        if (!current && input.version > 0)
          throw new NotFoundException("Catalog record not found.");
        if (current?.archived)
          throw new ConflictException("Restore this record before editing it.");
        if (
          current &&
          (current.kind !== input.kind || current.code !== input.code)
        )
          throw new BadRequestException(
            "Record type and code are permanent. Create a new record to change them.",
          );
        if (current?.kind === "unit" &&
          (current.content.dimension !== input.dimension || current.content.baseFactor !== input.baseFactor)) {
          const used = await client.query(
            "SELECT 1 FROM workspace_catalog_links WHERE workspace_id=$1 AND target_id=$2 LIMIT 1",
            [workspaceId, input.id],
          );
          if (used.rowCount) throw new ConflictException(
            "This unit is already linked to records. Create a new unit to change its measurement or conversion. You can still rename this unit.",
          );
        }
        const duplicate = await client.query(
          `SELECT 1 FROM workspace_catalog_records WHERE workspace_id=$1 AND kind=$2 AND id<>$3 AND catalog_id IS NOT DISTINCT FROM $6::uuid AND (code=$4 OR lower(name)=lower($5))`,
          [
            workspaceId,
            input.kind,
            input.id,
            input.code,
            input.name,
            input.catalogId ?? null,
          ],
        );
        if (duplicate.rowCount)
          throw new ConflictException(
            "This name or code already exists, including archived records. Use the existing record or a distinct product name.",
          );
        if (input.provenance) {
          const duplicateSource = await client.query(
            `SELECT 1 FROM workspace_catalog_records
             WHERE workspace_id=$1 AND catalog_id=$2 AND id<>$3
               AND content->'provenance'->>'namespace'=$4
               AND content->'provenance'->>'sourceKey'=$5`,
            [
              workspaceId,
              input.catalogId,
              input.id,
              input.provenance.namespace,
              input.provenance.sourceKey,
            ],
          );
          if (duplicateSource.rowCount)
            throw new ConflictException(
              "This source row is already linked to another catalog record.",
            );
        }
        await this.validateLinks(client, workspaceId, input);
        await client.query(
          `INSERT INTO workspace_catalog_records(workspace_id,id,kind,code,name,content,created_by,updated_by,catalog_id) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8)
        ON CONFLICT(workspace_id,id) DO UPDATE SET name=EXCLUDED.name,content=EXCLUDED.content,version=workspace_catalog_records.version+1,updated_by=EXCLUDED.updated_by,updated_at=now()`,
          [
            workspaceId,
            input.id,
            input.kind,
            input.code,
            input.name,
            writable(input),
            user.userId,
            input.catalogId ?? null,
          ],
        );
        await this.links(client, workspaceId, input);
        const saved = (
          await client.query<Row>(`${select} AND id=$2`, [
            workspaceId,
            input.id,
          ])
        ).rows[0];
        await this.events.record(client, {
          workspaceId,
          actorUserId: user.userId,
          source: "user",
          action: current
            ? "catalog.record.updated.v1"
            : "catalog.record.created.v1",
          entityType: "catalog_record",
          entityId: input.id,
          before: current ? payload(current) : null,
          after: payload(saved),
        });
        return payload(saved);
      },
    );
  }
  archive(
    actor: RequestActor,
    workspaceId: string,
    id: string,
    input: ArchiveCatalogDto,
  ) {
    return this.access.withPermissions(
      actor,
      workspaceId,
      ["catalog.view", "catalog.manage"],
      async (client, user) => {
        await this.lock(client, workspaceId);
        const current = (
          await client.query<Row>(`${select} AND id=$2`, [workspaceId, id])
        ).rows[0];
        if (!current) throw new NotFoundException("Catalog record not found.");
        if (isRestrictedCostRecord(payload(current)) &&
          !(await this.access.hasPermission(client, workspaceId, user.userId, "supplier_offers.manage")))
          throw new ForbiddenException("Supplier cost management permission is required for purchase and internal rates.");
        if (current.version !== input.version)
          throw new ConflictException(
            "This record changed. Refresh the catalog before trying again.",
          );
        if (input.archived && current.kind === "catalog_group") {
          const owned = await client.query("SELECT 1 FROM workspace_catalog_records WHERE workspace_id=$1 AND catalog_id=$2 AND NOT archived LIMIT 1", [workspaceId,id]);
          if (owned.rowCount) throw new ConflictException("Archive the records and groups in this catalog first.");
        }
        if (!input.archived && current.catalogId) await this.assertCatalog(client, workspaceId, current.catalogId);
        if (input.archived) {
          const activeOffers = await client.query(
            `SELECT 1 FROM workspace_supplier_offers
             WHERE workspace_id=$1 AND status='active' AND (catalog_record_id=$2 OR unit_record_id=$2) LIMIT 1`,
            [workspaceId, id],
          );
          if (activeOffers.rowCount)
            throw new ConflictException("Archive active supplier offers using this catalog record first.");
          const used = await client.query<{ name: string }>(
            `SELECT r.name FROM workspace_catalog_links l JOIN workspace_catalog_records r ON r.workspace_id=l.workspace_id AND r.id=l.record_id WHERE l.workspace_id=$1 AND l.target_id=$2 AND NOT r.archived LIMIT 3`,
            [workspaceId, id],
          );
          if (used.rowCount)
            throw new ConflictException(
              `Used by ${used.rows.map((r) => r.name).join(", ")}. Remove those active links before archiving.`,
            );
        } else {
          const record = {
            ...current.content,
            catalogId: current.catalogId ?? undefined,
            id,
            kind: current.kind,
            code: current.code,
            name: current.name,
            version: current.version,
          } as SaveCatalogRecordDto;
          await this.validateLinks(client, workspaceId, record);
        }
        await client.query(
          `UPDATE workspace_catalog_records SET archived=$3,version=version+1,updated_by=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2`,
          [workspaceId, id, input.archived, user.userId],
        );
        const saved = (
          await client.query<Row>(`${select} AND id=$2`, [workspaceId, id])
        ).rows[0];
        await this.events.record(client, {
          workspaceId,
          actorUserId: user.userId,
          source: "user",
          action: input.archived
            ? "catalog.record.archived.v1"
            : "catalog.record.restored.v1",
          entityType: "catalog_record",
          entityId: id,
          before: payload(current),
          after: payload(saved),
        });
        return payload(saved);
      },
    );
  }
  organize(actor: RequestActor, workspaceId: string, input: OrganizeCatalogDto) {
    return this.access.withPermissions(actor, workspaceId, ["catalog.view", "catalog.manage"], async (client,user) => {
      await this.lock(client, workspaceId);
      await this.assertCatalog(client, workspaceId, input.catalogId);
      const ids = input.records.map(r=>r.id);
      if (!ids.length || new Set(ids).size !== ids.length) throw new BadRequestException("Select distinct records to organise.");
      const existing = (await client.query<Row>(`${select} AND id=ANY($2::uuid[])`,[workspaceId,ids])).rows;
      if (existing.length !== ids.length || existing.some(r=>r.catalogId !== input.catalogId || r.archived))
        throw new BadRequestException("Choose active records from this catalog.");
      if (input.records.some(v=>existing.find(r=>r.id===v.id)?.version !== v.version))
        throw new ConflictException("A selected record changed. Refresh before trying again.");
      if (input.action === "reorder" ? existing.some(r=>r.kind!=="record_group") : existing.some(r=>["record_group","catalog_group"].includes(r.kind)))
        throw new BadRequestException("Choose groups to reorder, or master records to move.");
      if (input.groupId) {
        const target = (await client.query<Row>(`${select} AND id=$2`,[workspaceId,input.groupId])).rows[0];
        if (!target || target.kind!=="record_group" || target.catalogId!==input.catalogId || target.archived)
          throw new BadRequestException("Choose an active group in this catalog.");
      }
      const saved = [];
      // The permission callback is a single transaction. Validate the whole selection before writing.
      for (const [index,version] of input.records.entries()) {
        const row=existing.find(r=>r.id===version.id)!;
        const content = input.action === "reorder"
          ? {...row.content,configuration:{...(row.content.configuration as object ?? {}),sortOrder:(index+1)*10}}
          : {...row.content,links:[...(row.content.links as {relation:string;targetId:string}[]).filter(l=>l.relation!=="record_group"),...(input.groupId?[{relation:"record_group",targetId:input.groupId}]:[])]};
        if (canonical(content) === canonical(row.content)) { saved.push(payload(row)); continue; }
        await client.query("UPDATE workspace_catalog_records SET content=$3,version=version+1,updated_by=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2",[workspaceId,row.id,content,user.userId]);
        if (input.action === "move") {
          await client.query("DELETE FROM workspace_catalog_links WHERE workspace_id=$1 AND record_id=$2 AND relation='record_group'",[workspaceId,row.id]);
          if (input.groupId) await client.query("INSERT INTO workspace_catalog_links(workspace_id,record_id,relation,target_id) VALUES($1,$2,'record_group',$3)",[workspaceId,row.id,input.groupId]);
        }
        const updated=(await client.query<Row>(`${select} AND id=$2`,[workspaceId,row.id])).rows[0];
        await this.events.record(client,{workspaceId,actorUserId:user.userId,source:"user",action:"catalog.record.updated.v1",entityType:"catalog_record",entityId:row.id,before:payload(row),after:payload(updated)});
        saved.push(payload(updated));
      }
      return saved;
    });
  }
  installStarter(actor: RequestActor, workspaceId: string, catalogId?: string) {
    return this.access.withPermissions(
      actor,
      workspaceId,
      ["catalog.view", "catalog.manage"],
      async (client, user) => {
        await this.lock(client, workspaceId);
        catalogId =
          catalogId ??
          (await this.defaultCatalog(client, workspaceId, user.userId));
        await this.assertCatalog(client, workspaceId, catalogId);
        const existing = (
          await client.query<Row>(`${select} AND catalog_id=$2`, [
            workspaceId,
            catalogId,
          ])
        ).rows;
        const ids = new Map<string, string>();
        const created: SaveCatalogRecordDto[] = [];
        const upgraded: SaveCatalogRecordDto[] = [];
        for (const row of CATALOG_STARTER) {
          validateCatalogRecord(row);
          const same = existing.find(
            (r) =>
              r.id === row.id ||
              (r.kind === row.kind &&
                (r.code === row.code ||
                  r.name.toLowerCase() === row.name.toLowerCase())),
          );
          if (same) {
            ids.set(row.id, same.id);
            const baseline = EXECUTION_BASELINE.find((r) => r.id === same.id);
            if (
              baseline &&
              same.version === 1 &&
              !same.archived &&
              same.starterVersion === "interiors-execution-2026-09-07" &&
              same.name === baseline.name &&
              same.code === baseline.code &&
              canonical(same.content) === canonical(writable(baseline))
            )
              upgraded.push({ ...row, id: same.id, version: same.version });
            continue;
          }
          const scopedId = starterId(
            `catalog:${catalogId}:${row.kind}:${row.code}`,
          );
          ids.set(row.id, scopedId);
          created.push({ ...row, id: scopedId });
        }
        // Only byte-equivalent, unedited v1 execution starters receive the recipe extension.
        // Workspace edits and archived records remain untouched.
        const unavailable = new Set(
          existing.filter((r) => r.archived).map((r) => r.id),
        );
        const install = created.map((row) => ({
          ...row,
          catalogId,
          links: row.links.map((l) => ({
            ...l,
            targetId: ids.get(l.targetId)!,
          })),
        }));
        const upgrades = upgraded.map((row) => ({
          ...row,
          catalogId,
          links: row.links.map((l) => ({
            ...l,
            targetId: ids.get(l.targetId)!,
          })),
        }));
        if (
          [...install, ...upgrades].some((row) =>
            row.links.some((l) => !l.targetId || unavailable.has(l.targetId)),
          )
        )
          throw new ConflictException(
            "A starter dependency is archived. Restore the referenced master before adding missing starter data.",
          );
        for (const row of install)
          await client.query(
            `INSERT INTO workspace_catalog_records(workspace_id,id,kind,code,name,content,starter_version,created_by,updated_by,catalog_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)`,
            [
              workspaceId,
              row.id,
              row.kind,
              row.code,
              row.name,
              writable(row),
              STARTER_VERSION,
              user.userId,
              catalogId,
            ],
          );
        for (const row of install) {
          await this.validateLinks(client, workspaceId, row);
          await this.links(client, workspaceId, row);
        }
        for (const row of upgrades) {
          await this.validateLinks(client, workspaceId, row);
          await client.query(
            "UPDATE workspace_catalog_records SET content=$3,starter_version=$4,version=version+1,updated_by=$5,updated_at=now() WHERE workspace_id=$1 AND id=$2",
            [
              workspaceId,
              row.id,
              writable(row),
              STARTER_VERSION,
              user.userId,
              catalogId,
            ],
          );
          await this.links(client, workspaceId, row);
        }
        let organised = 0;
        for (const record of existing) {
          if (record.kind === "record_group" || !record.starterVersion || record.version !== 1 || record.archived) continue;
          const links = (record.content.links ?? []) as {relation:string;targetId:string}[];
          if (links.some(l=>l.relation === "record_group")) continue;
          const group = CATALOG_STARTER_GROUPS.find(g=>g.kinds.includes(record.kind));
          const template = CATALOG_STARTER.find(r=>r.kind === "record_group" && r.code === group?.code);
          const targetId = template && ids.get(template.id);
          if (!targetId || unavailable.has(targetId)) continue;
          const content = {...record.content,links:[...links,{relation:"record_group",targetId}]};
          await client.query("UPDATE workspace_catalog_records SET content=$3,version=version+1,updated_by=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2",[workspaceId,record.id,content,user.userId]);
          await client.query("INSERT INTO workspace_catalog_links(workspace_id,record_id,relation,target_id) VALUES($1,$2,'record_group',$3)",[workspaceId,record.id,targetId]);
          organised++;
        }
        if (install.length || upgrades.length || organised)
          await this.events.record(client, {
            workspaceId,
            actorUserId: user.userId,
            source: "user",
            action: "catalog.starter.installed.v1",
            entityType: "workspace",
            entityId: workspaceId,
            after: {
              starterVersion: STARTER_VERSION,
              created: install.length,
              updated: upgrades.length,
            organised,
              preserved: existing.length - upgrades.length,
            },
          });
        return {
          created: install.length,
          updated: upgrades.length,
          organised,
          preserved: existing.length - upgrades.length,
          starterVersion: STARTER_VERSION,
        };
      },
    );
  }
  createCatalog(
    actor: RequestActor,
    workspaceId: string,
    input: CreateCatalogDto,
  ) {
    return this.access.withPermissions(
      actor,
      workspaceId,
      ["catalog.view", "catalog.manage"],
      async (client, user) => {
        await this.lock(client, workspaceId);
        const existing = (
          await client.query<Row>(`${select} AND id=$2`, [
            workspaceId,
            input.id,
          ])
        ).rows[0];
        if (existing) {
          if (
            existing.kind !== "catalog_group" ||
            existing.name !== input.name ||
            existing.archived
          )
            throw new ConflictException(
              "This catalog identifier is already in use.",
            );
          return payload(existing);
        }
        if (
          (
            await client.query(
              "SELECT 1 FROM workspace_catalog_records WHERE workspace_id=$1 AND kind='catalog_group' AND lower(name)=lower($2)",
              [workspaceId, input.name],
            )
          ).rowCount
        )
          throw new ConflictException(
            "A catalog with this name already exists.",
          );
        let source: SaveCatalogRecordDto[] = input.starter
          ? CATALOG_STARTER
          : [];
        if (input.sourceCatalogId) {
          await this.assertCatalog(client, workspaceId, input.sourceCatalogId);
          source = (
            await client.query<Row>(
              `${select} AND catalog_id=$2 AND NOT archived`,
              [workspaceId, input.sourceCatalogId],
            )
          ).rows.map((r) => ({
            ...r.content,
            id: r.id,
            kind: r.kind,
            code: r.code,
            name: r.name,
            version: 0,
          })) as SaveCatalogRecordDto[];
        }
        await this.insertCatalog(
          client,
          workspaceId,
          user.userId,
          input.id,
          input.name,
          input.description,
        );
        const ids = new Map(source.map((r) => [r.id, randomUUID()]));
        const copies = source.map((r) => ({
          ...r,
          id: ids.get(r.id)!,
          catalogId: input.id,
          version: 0,
          links: r.links
            .filter((l) => l.relation !== "catalog_group")
            .map((l) => ({ ...l, targetId: ids.get(l.targetId)! })),
        }));
        if (copies.some((r) => r.links.some((l) => !l.targetId)))
          throw new ConflictException(
            "The source catalog has an unavailable dependency. Restore it before copying.",
          );
        for (const r of copies) {
          validateCatalogRecord(r);
          await client.query(
            `INSERT INTO workspace_catalog_records(workspace_id,id,catalog_id,kind,code,name,content,created_by,updated_by,starter_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)`,
            [
              workspaceId,
              r.id,
              input.id,
              r.kind,
              r.code,
              r.name,
              writable(r),
              user.userId,
              input.sourceCatalogId ? null : STARTER_VERSION,
            ],
          );
        }
        for (const r of copies) await this.links(client, workspaceId, r);
        const saved = (
          await client.query<Row>(`${select} AND id=$2`, [
            workspaceId,
            input.id,
          ])
        ).rows[0];
        await this.events.record(client, {
          workspaceId,
          actorUserId: user.userId,
          source: "user",
          action: "catalog.created.v1",
          entityType: "catalog",
          entityId: input.id,
          after: {
            ...payload(saved),
            sourceCatalogId: input.sourceCatalogId ?? null,
            records: copies.length,
          },
        });
        return payload(saved);
      },
    );
  }
  private async assertCatalog(
    client: PoolClient,
    workspaceId: string,
    id: string,
  ) {
    if (
      !(
        await client.query(
          `${select} AND id=$2 AND kind='catalog_group' AND NOT archived`,
          [workspaceId, id],
        )
      ).rowCount
    )
      throw new BadRequestException(
        "Choose an active catalog in this workspace.",
      );
  }
  private async insertCatalog(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    id: string,
    name: string,
    description = "",
  ) {
    await client.query(
      `INSERT INTO workspace_catalog_records(workspace_id,id,kind,code,name,content,created_by,updated_by) VALUES($1,$2,'catalog_group',$3,$4,$5,$6,$6)`,
      [
        workspaceId,
        id,
        `CAT_${id.replaceAll("-", "").toUpperCase()}`,
        name,
        {
          description,
          market: "CUSTOM",
          aliases: [],
          attributes: [],
          sizes: [],
          sources: [],
          links: [],
          specificationStatus: "needs_specification",
          dimension: "none",
          configuration: {},
        },
        userId,
      ],
    );
  }
  private async defaultCatalog(
    client: PoolClient,
    workspaceId: string,
    userId: string,
  ) {
    const row = (
      await client.query<Row>(
        `${select} AND kind='catalog_group' AND NOT archived ORDER BY created_at,id LIMIT 1`,
        [workspaceId],
      )
    ).rows[0];
    if (row) return row.id;
    const id = randomUUID();
    await this.insertCatalog(client, workspaceId, userId, id, "Master Data");
    return id;
  }
  private lock(client: PoolClient, workspaceId: string) {
    return client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`catalog:${workspaceId}`],
    );
  }
  private async validateLinks(
    client: PoolClient,
    workspaceId: string,
    input: SaveCatalogRecordDto,
  ) {
    if (!input.links.length) return;
    const targets = (
      await client.query<{
        id: string;
        kind: string;
        archived: boolean;
        catalogId: string | null;
        content: Record<string, unknown>;
      }>(
        `SELECT id,kind,archived,content,catalog_id AS "catalogId" FROM workspace_catalog_records WHERE workspace_id=$1 AND id=ANY($2::uuid[])`,
        [workspaceId, input.links.map((l) => l.targetId)],
      )
    ).rows;
    for (const l of input.links)
      if (
        !targets.some(
          (r) =>
            r.id === l.targetId &&
            (l.relation === "related" ? !["catalog_group", "record_group"].includes(r.kind) : r.kind === (l.relation === "parent" ? input.kind : l.relation)) &&
            !r.archived,
        )
      )
        throw new BadRequestException(
          `Choose an active ${l.relation} from this workspace.`,
        );
    if (input.catalogId && targets.some((t) => t.catalogId !== input.catalogId))
      throw new BadRequestException(
        "Linked records must belong to the same catalog.",
      );
    const parent = input.links.find((l) => l.relation === "parent");
    if (parent) {
      const cycle = await client.query(
        `WITH RECURSIVE ancestors(id) AS (
        SELECT target_id FROM workspace_catalog_links WHERE workspace_id=$1 AND record_id=$2 AND relation='parent'
        UNION SELECT l.target_id FROM workspace_catalog_links l JOIN ancestors a ON l.record_id=a.id WHERE l.workspace_id=$1 AND l.relation='parent'
      ) SELECT 1 FROM ancestors WHERE id=$3 LIMIT 1`,
        [workspaceId, parent.targetId, input.id],
      );
      if (cycle.rowCount)
        throw new BadRequestException(
          "A parent link cannot create a circular hierarchy.",
        );
    }
  }
  private async links(
    client: PoolClient,
    workspaceId: string,
    input: SaveCatalogRecordDto,
  ) {
    await client.query(
      "DELETE FROM workspace_catalog_links WHERE workspace_id=$1 AND record_id=$2",
      [workspaceId, input.id],
    );
    for (const l of input.links)
      await client.query(
        "INSERT INTO workspace_catalog_links(workspace_id,record_id,relation,target_id) VALUES($1,$2,$3,$4)",
        [workspaceId, input.id, l.relation, l.targetId],
      );
  }
}
