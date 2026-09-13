import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";

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

  constructor(private readonly config: ConfigService) {
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

  async createUploadUrl(objectKey: string, contentType: string): Promise<string | null> {
    if (!this.usesObjectStorage) return null;
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
    if (this.usesObjectStorage) {
      throw new Error("Direct local uploads are disabled when object storage is configured");
    }
    const target = this.localPath(objectKey);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.upload`;
    await writeFile(temporary, body, { flag: "wx" });
    await rename(temporary, target);
  }

  async put(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    if (this.usesObjectStorage) {
      await this.dataClient!.send(new PutObjectCommand({
        Bucket: this.bucket!,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
      }));
      return;
    }
    const target = this.localPath(objectKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
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
