import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable, Optional, PayloadTooLargeException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { DatabaseService } from "../database/database.service";
import { assertObjectSafe } from "./file-safety";

type StoredObject = {
  body: Buffer;
  byteSize: number;
  contentType?: string;
};

@Injectable()
export class BrandAssetStorageService {
  private readonly bucket?: string;
  private readonly dataClient?: S3Client;
  private readonly signingClient?: S3Client;
  private readonly localRoot: string;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly database?: DatabaseService,
  ) {
    this.bucket = config.get<string>("OBJECT_STORAGE_BUCKET") || undefined;
    this.localRoot = resolve(
      config.get<string>("BRAND_ASSET_STORAGE_DIR", ".data/workspace-brand-assets"),
    );
    if (!this.bucket) return;

    const region = config.get<string>("OBJECT_STORAGE_REGION", "us-east-1");
    const endpoint = config.get<string>("OBJECT_STORAGE_ENDPOINT") || undefined;
    const publicEndpoint = config.get<string>("OBJECT_STORAGE_PUBLIC_ENDPOINT") || endpoint;
    const forcePathStyle = config.get<string>("OBJECT_STORAGE_FORCE_PATH_STYLE", "false") === "true";
    const accessKeyId = config.get<string>("OBJECT_STORAGE_ACCESS_KEY_ID");
    const secretAccessKey = config.get<string>("OBJECT_STORAGE_SECRET_ACCESS_KEY");
    const credentials = accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;
    const common = { region, forcePathStyle, credentials };
    this.dataClient = new S3Client({ ...common, endpoint });
    this.signingClient = new S3Client({ ...common, endpoint: publicEndpoint });
  }

  get usesObjectStorage(): boolean {
    return Boolean(this.bucket && this.dataClient && this.signingClient);
  }

  async createUploadUrl(objectKey: string, contentType: string, expectedByteSize?: number): Promise<string | null> {
    if (!this.usesObjectStorage) return null;
    if (expectedByteSize !== undefined) await this.reserve(objectKey, expectedByteSize, contentType, "pending");
    return getSignedUrl(
      this.signingClient!,
      new PutObjectCommand({
        Bucket: this.bucket!,
        Key: objectKey,
        ContentType: contentType,
      }),
      { expiresIn: 5 * 60 },
    );
  }

  async writeLocal(objectKey: string, body: Buffer): Promise<void> {
    assertObjectSafe(body);
    if (this.usesObjectStorage) {
      throw new Error("Direct local uploads are disabled when object storage is configured");
    }
    await this.reserve(objectKey, body.byteLength, "application/octet-stream", "baseline_passed", body);
    try {
      const target = this.localPath(objectKey);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.upload`;
      await writeFile(temporary, body, { flag: "wx" });
      await rename(temporary, target);
      await this.activate(objectKey, body);
    } catch (error) {
      await this.fail(objectKey);
      throw error;
    }
  }

  async put(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    assertObjectSafe(body);
    await this.reserve(objectKey, body.byteLength, contentType, "baseline_passed", body);
    try {
      if (this.usesObjectStorage) {
        await this.dataClient!.send(new PutObjectCommand({
          Bucket: this.bucket!,
          Key: objectKey,
          Body: body,
          ContentType: contentType,
        }));
      } else {
        const target = this.localPath(objectKey);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, body);
      }
      await this.activate(objectKey, body);
    } catch (error) {
      await this.fail(objectKey);
      throw error;
    }
  }

  async putSystemArtifact(objectKey: string, body: Buffer, contentType: string): Promise<{ byteSize: number; sha256: string }> {
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (this.usesObjectStorage) {
      await this.dataClient!.send(new PutObjectCommand({
        Bucket: this.bucket!,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
      }));
    } else {
      const target = this.localPath(objectKey);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.artifact`;
      await writeFile(temporary, body, { flag: "wx" });
      await rename(temporary, target);
    }
    return { byteSize: body.byteLength, sha256 };
  }

  async confirmUpload(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    assertObjectSafe(body);
    await this.reserve(objectKey, body.byteLength, contentType, "baseline_passed", body);
    await this.activate(objectKey, body);
  }

  async read(objectKey: string): Promise<StoredObject> {
    if (this.usesObjectStorage) {
      const response = await this.dataClient!.send(new GetObjectCommand({
        Bucket: this.bucket!,
        Key: objectKey,
      }));
      if (!response.Body) throw new Error("Stored object has no body");
      const body = await this.toBuffer(response.Body as Readable | ReadableStream | Blob);
      return {
        body,
        byteSize: response.ContentLength ?? body.byteLength,
        contentType: response.ContentType,
      };
    }
    const target = this.localPath(objectKey);
    const [body, metadata] = await Promise.all([readFile(target), stat(target)]);
    return { body, byteSize: metadata.size };
  }

  async head(objectKey: string): Promise<{ byteSize: number; contentType?: string }> {
    if (this.usesObjectStorage) {
      const response = await this.dataClient!.send(new HeadObjectCommand({
        Bucket: this.bucket!,
        Key: objectKey,
      }));
      return { byteSize: response.ContentLength ?? 0, contentType: response.ContentType };
    }
    const metadata = await stat(this.localPath(objectKey));
    return { byteSize: metadata.size };
  }

  async remove(objectKey: string): Promise<void> {
    if (this.usesObjectStorage) {
      await this.dataClient!.send(new DeleteObjectCommand({
        Bucket: this.bucket!,
        Key: objectKey,
      }));
    } else {
      await rm(this.localPath(objectKey), { force: true });
    }
    await this.markRemoved(objectKey);
  }

  createLocalReadStream(objectKey: string) {
    if (this.usesObjectStorage) return null;
    return createReadStream(this.localPath(objectKey));
  }

  private localPath(objectKey: string): string {
    const target = resolve(this.localRoot, objectKey);
    if (target !== this.localRoot && !target.startsWith(`${this.localRoot}${sep}`)) {
      throw new Error("Invalid object key");
    }
    return target;
  }

  private workspaceId(objectKey: string) {
    return objectKey.match(/(?:^|\/)([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/|$)/i)?.[1] ?? null;
  }

  private async reserve(
    objectKey: string,
    byteSize: number,
    contentType: string,
    scannerStatus: "pending" | "baseline_passed",
    body?: Buffer,
  ) {
    const workspaceId = this.workspaceId(objectKey);
    if (!this.database || !workspaceId) return;
    await this.database.tenantTransaction(workspaceId, workspaceId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('workspace-storage:' || $1,0))", [workspaceId]);
      const policy = await client.query<{ quota: string; retentionDays: number }>(
        `SELECT storage_quota_bytes::text AS quota,retention_days AS "retentionDays"
         FROM workspace_data_policies WHERE workspace_id=$1`, [workspaceId],
      );
      const existing = await client.query<{ bytes: string }>(
        `WITH managed AS (
           SELECT object_key,byte_size::bigint AS byte_size FROM workspace_stored_objects
           WHERE workspace_id=$1 AND object_key<>$2 AND removed_at IS NULL
             AND (status='active' OR (status='pending' AND reservation_expires_at>now()))
         ), legacy AS (
           SELECT object_key,COALESCE(byte_size,expected_byte_size)::bigint AS byte_size
             FROM workspace_brand_assets WHERE workspace_id=$1 AND status IN ('pending','active') AND object_key<>$2
           UNION ALL SELECT object_key,byte_size::bigint FROM pre_project_brief_assets WHERE workspace_id=$1 AND object_key<>$2
           UNION ALL SELECT object_key,byte_size::bigint FROM workspace_catalog_assets WHERE workspace_id=$1 AND status='active' AND object_key<>$2
           UNION ALL SELECT object_key,byte_size::bigint FROM hrms_captures WHERE workspace_id=$1 AND object_key IS NOT NULL AND object_key<>$2
           UNION ALL SELECT 'projects/' || execution.workspace_id || '/' || execution.project_id || '/' || (attachment.value->>'id'),
             COALESCE((attachment.value->>'bytes')::bigint,0)
             FROM project_execution execution
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(execution.content->'files','[]'::jsonb)) AS attachment(value)
             WHERE execution.workspace_id=$1
               AND ('projects/' || execution.workspace_id || '/' || execution.project_id || '/' || (attachment.value->>'id'))<>$2
         ), files AS (
           SELECT object_key,byte_size FROM managed
           UNION ALL SELECT legacy.object_key,legacy.byte_size FROM legacy
           WHERE NOT EXISTS (SELECT 1 FROM managed WHERE managed.object_key=legacy.object_key)
         ) SELECT COALESCE(sum(byte_size),0)::text AS bytes FROM files`,
        [workspaceId, objectKey],
      );
      const used = Number(existing.rows[0]?.bytes ?? 0);
      const quota = policy.rowCount ? Number(policy.rows[0].quota) : null;
      if (quota !== null && used + byteSize > quota) {
        throw new PayloadTooLargeException({
          message: "This upload exceeds the organization's storage allowance",
          usedBytes: used,
          requestedBytes: byteSize,
          quotaBytes: quota,
        });
      }
      const retentionDays = policy.rows[0]?.retentionDays ?? null;
      await client.query(
        `INSERT INTO workspace_stored_objects
          (workspace_id,object_key,byte_size,content_type,sha256,status,scanner_status,reservation_expires_at,retention_until,removed_at)
         VALUES($1,$2,$3,$4,$5,'pending',$6,now()+interval '15 minutes',
           CASE WHEN $7::int IS NULL THEN NULL ELSE now()+($7*interval '1 day') END,NULL)
         ON CONFLICT(workspace_id,object_key) DO UPDATE SET
           byte_size=excluded.byte_size,content_type=excluded.content_type,sha256=excluded.sha256,
           status='pending',scanner_status=excluded.scanner_status,
           reservation_expires_at=excluded.reservation_expires_at,retention_until=excluded.retention_until,removed_at=NULL`,
        [workspaceId, objectKey, byteSize, contentType,
          body ? createHash("sha256").update(body).digest("hex") : null, scannerStatus, retentionDays],
      );
    });
  }

  private async activate(objectKey: string, body: Buffer) {
    const workspaceId = this.workspaceId(objectKey);
    if (!this.database || !workspaceId) return;
    await this.database.tenantTransaction(workspaceId, workspaceId, (client) => client.query(
      `UPDATE workspace_stored_objects SET status='active',scanner_status='baseline_passed',
         sha256=$3,reservation_expires_at=NULL WHERE workspace_id=$1 AND object_key=$2`,
      [workspaceId, objectKey, createHash("sha256").update(body).digest("hex")],
    ));
  }

  private async fail(objectKey: string) {
    const workspaceId = this.workspaceId(objectKey);
    if (!this.database || !workspaceId) return;
    await this.database.tenantTransaction(workspaceId, workspaceId, (client) => client.query(
      `UPDATE workspace_stored_objects SET status='failed',scanner_status='failed',reservation_expires_at=NULL
       WHERE workspace_id=$1 AND object_key=$2`, [workspaceId, objectKey],
    )).catch(() => undefined);
  }

  private async markRemoved(objectKey: string) {
    const workspaceId = this.workspaceId(objectKey);
    if (!this.database || !workspaceId) return;
    await this.database.tenantTransaction(workspaceId, workspaceId, (client) => client.query(
      `UPDATE workspace_stored_objects SET status='removed',removed_at=now(),reservation_expires_at=NULL
       WHERE workspace_id=$1 AND object_key=$2`, [workspaceId, objectKey],
    ));
  }

  private async toBuffer(body: Readable | ReadableStream | Blob): Promise<Buffer> {
    if (body instanceof Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return Buffer.concat(chunks);
    }
    if ("transformToByteArray" in (body as object)) {
      const bytes = await (body as unknown as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
      return Buffer.from(bytes);
    }
    if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
    throw new Error("Unsupported object-storage response body");
  }
}
