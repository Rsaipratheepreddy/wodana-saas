import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemberProfileService } from "./member-profile.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("member profile: avatar and photo", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withMember(work: (client: PoolClient, ids: { workspaceId: string; userId: string; service: MemberProfileService; stored: Map<string, Buffer> }) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), userId = randomUUID();
    const stored = new Map<string, Buffer>();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Tester')", [userId, `p-${userId.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Profile',$2,'USD',$3)", [workspaceId, `pr-${workspaceId.slice(0, 8)}`, userId]);
      await client.query("SET LOCAL session_replication_role = origin");
      const access = { asMember: (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId }) };
      const storage = {
        put: async (key: string, body: Buffer) => { stored.set(key, body); },
        remove: async (key: string) => { stored.delete(key); },
        read: async (key: string) => ({ body: stored.get(key)!, byteSize: stored.get(key)!.byteLength }),
      };
      await work(client, { workspaceId, userId, service: new MemberProfileService(access as never, storage as never), stored });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  it("chooses an avatar, checks the version and audits the change", async () => {
    await withMember(async (client, { workspaceId, service }) => {
      expect(await service.getMine(actor, workspaceId)).toEqual({ avatarPreset: null, photoUrl: null, version: 0 });
      const chosen = await service.setAvatar(actor, workspaceId, { avatarPreset: "sales-f" });
      expect(chosen).toMatchObject({ avatarPreset: "sales-f", version: 1 });
      // Same choice again is a no-op (idempotent), a stale version is refused.
      expect(await service.setAvatar(actor, workspaceId, { avatarPreset: "sales-f", version: 1 })).toMatchObject({ version: 1 });
      await expect(service.setAvatar(actor, workspaceId, { avatarPreset: "owner-m", version: 0 })).rejects.toThrow(/another window/);
      await expect(service.setAvatar(actor, workspaceId, { avatarPreset: "b03" })).rejects.toThrow(/listed avatars/);
      const audit = await client.query("SELECT action FROM audit_events WHERE workspace_id=$1", [workspaceId]);
      expect(audit.rows).toEqual([{ action: "member.avatar_changed" }]);
    });
  });

  it("saves the interface language on the user, once, and audits it", async () => {
    await withMember(async (client, { workspaceId, userId, service }) => {
      await expect(service.setLanguage(actor, workspaceId, "arabic")).rejects.toThrow(/listed languages/);
      expect(await service.setLanguage(actor, workspaceId, "ar-AE")).toEqual({ preferredLocale: "ar-AE" });
      expect(await service.setLanguage(actor, workspaceId, "ar-AE")).toEqual({ preferredLocale: "ar-AE" });
      const user = await client.query("SELECT preferred_locale FROM users WHERE id=$1", [userId]);
      expect(user.rows[0].preferred_locale).toBe("ar-AE");
      const audit = await client.query("SELECT action, before, after FROM audit_events WHERE workspace_id=$1", [workspaceId]);
      expect(audit.rows).toEqual([{ action: "member.language_changed", before: { preferredLocale: "en" }, after: { preferredLocale: "ar-AE" } }]);
    });
  });

  it("stores a square photo, replaces the old file, and removes it", async () => {
    await withMember(async (_client, { workspaceId, userId, service, stored }) => {
      const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#c0a080" } }).png().toBuffer();
      await expect(service.uploadPhoto(actor, workspaceId, "image/jpeg", png)).rejects.toThrow(/PNG, JPG or WebP/);
      await expect(service.uploadPhoto(actor, workspaceId, "image/png", Buffer.from("not an image"))).rejects.toThrow(/PNG, JPG or WebP/);
      const first = await service.uploadPhoto(actor, workspaceId, "image/png", png);
      expect(first.photoUrl).toMatch(new RegExp(`/api/workspace/member-photo/${workspaceId}/${userId}\\?v=`));
      const [key] = [...stored.keys()];
      expect(key.startsWith(`member-photos/${workspaceId}/`)).toBe(true);
      expect(await sharp(stored.get(key)!).metadata()).toMatchObject({ width: 256, height: 256, format: "webp" });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await service.uploadPhoto(actor, workspaceId, "image/png", png);
      expect(stored.size).toBe(1);
      expect((await service.readPhoto(actor, workspaceId, userId)).contentType).toBe("image/webp");
      const removed = await service.removePhoto(actor, workspaceId);
      expect(removed.photoUrl).toBeNull();
      expect(stored.size).toBe(0);
      await expect(service.readPhoto(actor, workspaceId, userId)).rejects.toThrow(/No photo/);
    });
  });
});
