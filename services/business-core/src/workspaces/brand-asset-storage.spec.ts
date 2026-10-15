import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    // A browser upload carries its own body: a checksum signed into the link (the empty body's) would be refused.
    expect([...url.searchParams.keys()].filter((key) => key.toLowerCase().includes('checksum'))).toEqual([]);
  });

  it('writes a checksum-bearing system artifact outside tenant upload quota', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wodana-system-artifact-')); temporary.push(root);
    const service = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: root }));
    const body = Buffer.from('{"scope":"tenant_records_and_object_manifest"}');

    const result = await service.putSystemArtifact('tenant-exports/workspace/operation/export.json', body, 'application/json');

    expect(result).toEqual({ byteSize: body.byteLength, sha256: createHash('sha256').update(body).digest('hex') });
    expect((await service.read('tenant-exports/workspace/operation/export.json')).body).toEqual(body);
  });

  it('reserves quota, records the baseline scan and activates a managed object', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wodana-governed-asset-')); temporary.push(root);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM workspace_data_policies')) return { rowCount: 1, rows: [{ quota: '100', retentionDays: 30 }] };
      if (sql.includes('SELECT COALESCE(sum(byte_size)')) return { rowCount: 1, rows: [{ bytes: '10' }] };
      return { rowCount: 1, rows: [] };
    });
    const database = { tenantTransaction: vi.fn(async (_workspaceId: string, _actorId: string,
      work: (client: { query: typeof query }) => Promise<unknown>) => work({ query })) };
    const service = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: root }), database as never);
    const workspaceId = '00000000-0000-4000-8000-000000000001';

    await service.put(`projects/${workspaceId}/project/file`, Buffer.from('safe evidence'), 'text/plain');

    expect(database.tenantTransaction).toHaveBeenCalled();
    const reservation = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO workspace_stored_objects'));
    expect(reservation?.[1]?.slice(0, 4)).toEqual([workspaceId, `projects/${workspaceId}/project/file`, 13, 'text/plain']);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("status='active'"))).toBe(true);
  });

  it('rejects a managed upload before storage when it exceeds tenant quota', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wodana-quota-asset-')); temporary.push(root);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM workspace_data_policies')) return { rowCount: 1, rows: [{ quota: '100', retentionDays: 30 }] };
      if (sql.includes('SELECT COALESCE(sum(byte_size)')) return { rowCount: 1, rows: [{ bytes: '95' }] };
      return { rowCount: 1, rows: [] };
    });
    const database = { tenantTransaction: vi.fn(async (_workspaceId: string, _actorId: string,
      work: (client: { query: typeof query }) => Promise<unknown>) => work({ query })) };
    const service = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: root }), database as never);
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const key = `projects/${workspaceId}/project/file`;

    await expect(service.put(key, Buffer.from('safe evidence'), 'text/plain')).rejects.toMatchObject({ status: 413 });
    await expect(service.read(key)).rejects.toThrow();
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO workspace_stored_objects'))).toBe(false);
  });
});
