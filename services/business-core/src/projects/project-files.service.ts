import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { HrmsAccessService } from "../hrms/hrms-access.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { ExecutionService } from "./execution.service";
import type { RequestActor } from "../auth/actor";
@Injectable()
export class ProjectFilesService {
  constructor(
    private readonly access: HrmsAccessService,
    private readonly execution: ExecutionService,
    private readonly storage: BrandAssetStorageService,
  ) {}
  list(actor: RequestActor, w: string, p: string) {
    return this.access.run(actor, w, async (ctx) => {
      this.access.require(ctx, "projects.view", "projects.manage");
      const project = await this.execution.row(ctx, p);
      const data = await this.execution.load(ctx, p);
      const collections: Array<{
        key: keyof typeof data;
        type: string;
        folder: string;
        label: string;
      }> = [
        { key: "tasks", type: "task", folder: "tasks", label: "Tasks" },
        { key: "reports", type: "daily_report", folder: "daily_reports", label: "Daily reports" },
        { key: "orders", type: "order", folder: "procurement", label: "Procurement" },
        { key: "documents", type: "document", folder: "documents", label: "Documents" },
        { key: "snags", type: "snag", folder: "snags", label: "Snags" },
        { key: "handovers", type: "handover", folder: "handover", label: "Handover" },
        { key: "dispatches", type: "dispatch", folder: "dispatches", label: "Dispatches" },
        { key: "commissioning", type: "commissioning", folder: "commissioning", label: "Commissioning" },
        { key: "technicalQueries", type: "technical_query", folder: "technical_queries", label: "Technical queries" },
        { key: "transmittals", type: "transmittal", folder: "transmittals", label: "Transmittals" },
        { key: "retentions", type: "retention", folder: "retentions", label: "Retentions" },
        { key: "supplierReturns", type: "supplier_return", folder: "supplier_returns", label: "Supplier returns" },
      ];
      const contexts = new Map<string, { recordType: string; folder: string; folderLabel: string; recordTitle: string }>();
      for (const collection of collections) {
        const records = data[collection.key];
        if (!Array.isArray(records)) continue;
        for (const item of records as unknown[]) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;
          if (typeof record.id !== "string") continue;
          const title = [record.title, record.number, record.reference, record.date, record.summary]
            .find((value) => typeof value === "string" && value.trim());
          contexts.set(record.id, {
            recordType: collection.type,
            folder: collection.folder,
            folderLabel: collection.label,
            recordTitle: typeof title === "string" ? title : collection.label,
          });
        }
      }

      const uploaderIds = [...new Set((data.files ?? []).map((file) => file.by).filter(Boolean))];
      const uploaders = uploaderIds.length
        ? await ctx.client.query<{ id: string; name: string }>(
            `SELECT membership.id, app_user.display_name AS name
             FROM workspace_memberships membership
             JOIN users app_user ON app_user.id = membership.user_id
             WHERE membership.workspace_id = $1 AND membership.id = ANY($2::uuid[])`,
            [w, uploaderIds],
          )
        : { rows: [] };
      const uploaderNames = new Map(uploaders.rows.map((row) => [row.id, row.name]));
      const projectFiles = (data.files ?? []).map((file) => {
        const context = contexts.get(file.recordId) ?? {
          recordType: "project_record",
          folder: "project_files",
          folderLabel: "Project files",
          recordTitle: "Project record",
        };
        return {
          id: file.id,
          source: "delivery" as const,
          ...context,
          recordId: file.recordId,
          name: file.name,
          mimeType: file.mimeType,
          bytes: file.bytes,
          uploadedBy: uploaderNames.get(file.by) ?? "Project team",
          uploadedAt: file.at,
        };
      });

      const preExecution = await ctx.client.query(
        `SELECT asset.id, asset.original_name AS name, asset.mime_type AS "mimeType",
                asset.byte_size AS bytes, creator.display_name AS "uploadedBy",
                asset.created_at AS "uploadedAt",
                COALESCE(design.folder, site.folder, brief.folder, 'pre_execution_uploads') AS folder,
                COALESCE(design."folderLabel", site."folderLabel", brief."folderLabel", 'Pre-execution uploads') AS "folderLabel",
                COALESCE(design."recordType", site."recordType", brief."recordType", 'pre_execution_file') AS "recordType",
                COALESCE(design."recordId", site."recordId", brief."recordId") AS "recordId",
                COALESCE(design."recordTitle", site."recordTitle", brief."recordTitle", 'Pre-execution file') AS "recordTitle"
         FROM pre_project_brief_assets asset
         JOIN users creator ON creator.id = asset.created_by
         LEFT JOIN LATERAL (
           SELECT 'designs'::text AS folder, COALESCE(folder.name, 'Designs') AS "folderLabel",
                  'design'::text AS "recordType", design.id::text AS "recordId", design.title AS "recordTitle"
           FROM pre_project_design_versions version
           JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.case_id = version.case_id AND design.id = version.design_id
           LEFT JOIN pre_project_design_folders folder ON folder.workspace_id = design.workspace_id AND folder.case_id = design.case_id AND folder.id = design.folder_id
           WHERE version.workspace_id = asset.workspace_id AND version.case_id = asset.case_id AND version.asset_id = asset.id
           ORDER BY version.number DESC LIMIT 1
         ) design ON true
         LEFT JOIN LATERAL (
           SELECT 'site_survey'::text AS folder, 'Site survey'::text AS "folderLabel",
                  record.kind::text AS "recordType", record.id::text AS "recordId", record.title AS "recordTitle"
           FROM pre_project_site_assets link
           JOIN pre_project_site_records record ON record.workspace_id = link.workspace_id AND record.case_id = link.case_id AND record.id = link.record_id
           WHERE link.workspace_id = asset.workspace_id AND link.case_id = asset.case_id AND link.asset_id = asset.id
           ORDER BY link.version DESC LIMIT 1
         ) site ON true
         LEFT JOIN LATERAL (
           SELECT 'requirements'::text AS folder, 'Requirements'::text AS "folderLabel",
                  entry.kind::text AS "recordType", entry.id::text AS "recordId", entry.title AS "recordTitle"
           FROM pre_project_entry_assets link
           JOIN pre_project_brief_entries entry ON entry.workspace_id = link.workspace_id AND entry.case_id = link.case_id AND entry.id = link.entry_id
           WHERE link.workspace_id = asset.workspace_id AND link.case_id = asset.case_id AND link.asset_id = asset.id
           ORDER BY entry.updated_at DESC LIMIT 1
         ) brief ON true
         WHERE asset.workspace_id = $1 AND asset.case_id = $2
         ORDER BY asset.created_at DESC, asset.id DESC LIMIT 2001`,
        [w, project.caseId],
      );
      const preExecutionTruncated = preExecution.rows.length > 2000;
      const items = [
        ...projectFiles,
        ...preExecution.rows.slice(0, 2000).map((file) => ({ ...file, source: "pre_execution" as const })),
      ].sort((left, right) => Date.parse(String(right.uploadedAt)) - Date.parse(String(left.uploadedAt)));
      const folders = [...new Map(items.map((item) => [item.folder, { id: item.folder, label: item.folderLabel }])).values()]
        .map((folder) => ({ ...folder, count: items.filter((item) => item.folder === folder.id).length }));
      return { items, folders, truncated: preExecutionTruncated };
    });
  }
  upload(
    actor: RequestActor,
    w: string,
    p: string,
    recordId: string,
    id: string,
    file: { buffer: Buffer; originalname: string },
  ) {
    if (!file?.buffer?.length || file.buffer.length > 10 * 1024 * 1024)
      throw new BadRequestException("Choose an image or PDF up to 10 MB.");
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw new BadRequestException("Use a stable file identifier.");
    return this.access.run(actor, w, async (ctx) => {
      await this.execution.row(ctx, p, true);
      const d = await this.execution.load(ctx, p),
        record = [
          ...d.tasks,
          ...d.reports,
          ...d.orders,
          ...d.documents,
          ...d.snags,
          ...d.handovers,
          ...(d.dispatches??[]),...(d.commissioning??[]),...(d.technicalQueries??[]),...(d.transmittals??[]),...(d.retentions??[]),...(d.supplierReturns??[]),
        ].find((x) => x.id === recordId);
      if (!record) throw new NotFoundException("Choose a project record.");
      const assignedDispatch = d.dispatches?.find(
        (dispatch) =>
          dispatch.id === recordId &&
          d.tasks.some(
            (task) =>
              task.id === dispatch.receivingTaskId &&
              (task.ownerId === ctx.membershipId ||
                task.assigneeIds.includes(ctx.membershipId)),
          ),
      );
      if (
        !ctx.permissions.has("projects.manage") &&
        !ctx.permissions.has("projects.buy") &&
        !ctx.permissions.has("projects.review") &&
        !d.tasks.some(
          (t) =>
            t.id === recordId &&
            (t.ownerId === ctx.membershipId ||
              t.assigneeIds.includes(ctx.membershipId)),
        ) &&
        !assignedDispatch &&
        ![...d.reports,...(d.commissioning??[]),...(d.technicalQueries??[])].some(
          (r) => r.id === recordId && r.authorId === ctx.membershipId,
        ) &&
        !d.snags.some(
          (snag) =>
            snag.id === recordId && snag.ownerId === ctx.membershipId,
        )
      )
        throw new ForbiddenException(
          "You cannot attach evidence to this record.",
        );
      const sha = createHash("sha256").update(file.buffer).digest("hex");
      d.files ??= [];
      const prior = d.files.find((f) => f.id === id);
      if (prior) {
        if (prior.sha256 !== sha || prior.recordId !== recordId)
          throw new ConflictException(
            "This upload identifier belongs to another file.",
          );
        return { file: prior, data: d };
      }
      const report = d.reports.find((r) => r.id === recordId);
      if (report && !["draft", "returned"].includes(report.status))
        throw new ConflictException(
          "Create a report correction before adding new evidence.",
        );
      const check=d.commissioning?.find(c=>c.id===recordId);if(check&&!['draft','returned'].includes(check.status))throw new ConflictException('Return the commissioning check before adding evidence.');
      if (d.files.length >= 1000)
        throw new BadRequestException(
          "This project has reached its file limit.",
        );
      let mimeType = "";
      if (file.buffer.subarray(0, 5).toString() === "%PDF-")
        mimeType = "application/pdf";
      else {
        const info = await sharp(file.buffer, {
          limitInputPixels: 40000000,
          animated: false,
        })
          .metadata()
          .catch(() => null);
        const types: Record<string, string> = {
          jpeg: "image/jpeg",
          png: "image/png",
          webp: "image/webp",
          gif: "image/gif",
        };
        if (!info?.format || !types[info.format])
          throw new BadRequestException("Use JPEG, PNG, WebP, GIF or PDF.");
        mimeType = types[info.format];
      }
      const name = file.originalname
          .replace(/[\x00-\x1f\x7f/\\]/g, "_")
          .slice(0, 240),
        key = `projects/${w}/${p}/${id}`;
      await this.storage.put(key, file.buffer, mimeType);
      const attachment = {
        id,
        recordId,
        name,
        mimeType,
        bytes: file.buffer.length,
        sha256: sha,
        by: ctx.membershipId,
        at: new Date().toISOString(),
      };
      d.files.push(attachment);
      d.audit.push({
        id: randomUUID(),
        at: attachment.at,
        author: "Project team",
        action: "file_attached",
        recordId,
        note: name,
      });
      await this.execution.store(ctx, p, d);
      return { file: attachment, data: d };
    });
  }
  read(actor: RequestActor, w: string, p: string, id: string) {
    return this.access.run(actor, w, async (ctx) => {
      this.access.require(ctx, "projects.view", "projects.manage");
      const project = await this.execution.row(ctx, p);
      const d = await this.execution.load(ctx, p),
        file = d.files?.find((f) => f.id === id);
      const preExecution = file ? null : (
        await ctx.client.query(
          `SELECT object_key AS key, mime_type AS "mimeType"
           FROM pre_project_brief_assets
           WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
          [w, project.caseId, id],
        )
      ).rows[0];
      if (!file && !preExecution) throw new NotFoundException("File not found.");
      const stored = await this.storage
        .read(file ? `projects/${w}/${p}/${id}` : preExecution.key)
        .catch(() => null);
      if (!stored) throw new NotFoundException("File storage is unavailable.");
      return { body: stored.body, mimeType: file?.mimeType ?? preExecution.mimeType };
    });
  }
}
