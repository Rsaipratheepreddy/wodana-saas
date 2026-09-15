import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandAssetStorageService } from './brand-asset-storage.service';
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('release image and object storage compatibility', () => {
  it('processes and stores a photo while preventing reads outside the asset directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wodana-asset-release-')); temporary.push(root);
    const service = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: root }));
    const photo = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#d6b9f3' } }).png().toBuffer();
    const preview = await sharp(photo).resize({ width: 10 }).webp().toBuffer();
    await service.put('workspace/report/photo.webp', preview, 'image/webp');
    const stored = await service.read('workspace/report/photo.webp');
    expect(stored.body).toEqual(preview);
    expect(await sharp(stored.body).metadata()).toMatchObject({ width: 10, height: 5, format: 'webp' });
    await service.remove('workspace/report/photo.webp');
    await expect(service.read('workspace/report/photo.webp')).rejects.toThrow();
    await service.remove('workspace/report/photo.webp');
    await expect(service.read('../private-file')).rejects.toThrow('Invalid object key');
  });
  it('signs an upload for the configured public storage endpoint without contacting the provider', async () => {
    const service = new BrandAssetStorageService(new ConfigService({
      OBJECT_STORAGE_BUCKET: 'workspace-assets', OBJECT_STORAGE_REGION: 'me-central-1',
      OBJECT_STORAGE_ENDPOINT: 'https://storage-internal.example.com',
      OBJECT_STORAGE_PUBLIC_ENDPOINT: 'https://storage.example.com', OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'release-test-key', OBJECT_STORAGE_SECRET_ACCESS_KEY: 'release-test-secret',
    }));
    const url = new URL((await service.createUploadUrl('workspace/report/photo.png', 'image/png'))!);
    expect(url.origin).toBe('https://storage.example.com');
    expect(url.pathname).toBe('/workspace-assets/workspace/report/photo.png');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
  });
});
