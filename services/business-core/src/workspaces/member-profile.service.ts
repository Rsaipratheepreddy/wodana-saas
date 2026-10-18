import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import sharp from "sharp";
import { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { BrandAssetStorageService } from "./brand-asset-storage.service";
import { WorkspaceAccessService } from "./workspace-access.service";

export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** A picture from the brand avatar set: `<role>-<f|m>` (packages/brand/avatars). */
export const AVATAR_PRESET_PATTERN = /^(owner|sales|designer|estimator|project_manager|site_supervisor|purchasing|finance|people|factory|carpenter|electrician|painter|installer|client|default)-[fm]$/;
/** A language, optionally with a region: "ar", "ar-AE", "en-001". */
export const LANGUAGE_LOCALE_PATTERN = /^[a-z]{2,3}(-([A-Z]{2}|\d{3}))?$/;
const PHOTO_TYPES: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

type ProfileRow = { avatarPreset: string | null; photoObjectKey: string | null; photoUpdatedAt: Date | null; version: number };

/** A person's photo or chosen default avatar inside one workspace. */
@Injectable()
export class MemberProfileService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly storage: BrandAssetStorageService,
  ) {}

  static photoUrl(workspaceId: string, userId: string, updatedAt: Date | null) {
    return updatedAt ? `/api/workspace/member-photo/${workspaceId}/${userId}?v=${updatedAt.getTime().toString(36)}` : null;
  }

  getMine(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.view(workspaceId, user.userId, await this.load(client, workspaceId, user.userId)));
  }

  async setAvatar(actor: RequestActor, workspaceId: string, input: { avatarPreset: string | null; version?: number }) {
    if (input.avatarPreset !== null && !AVATAR_PRESET_PATTERN.test(String(input.avatarPreset))) throw new BadRequestException("Choose one of the listed avatars");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const current = await this.load(client, workspaceId, user.userId, true);
      if (input.version !== undefined && current && current.version !== input.version) throw new ConflictException("Your profile changed in another window. Reload and try again.");
      if (current?.avatarPreset === input.avatarPreset) return this.view(workspaceId, user.userId, current);
      const saved = await this.upsert(client, workspaceId, user.userId, "avatar_preset = $3", [input.avatarPreset]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "member.avatar_changed", entityType: "workspace_member_profile", entityId: user.userId, before: { avatarPreset: current?.avatarPreset ?? null }, after: { avatarPreset: input.avatarPreset } });
      return this.view(workspaceId, user.userId, saved);
    });
  }

  /**
   * The person's interface language, saved on their user record so it follows them to every device and
   * workspace. Stored as the language with the workspace region ("ar-AE"); saving the same value is a no-op.
   */
  async setLanguage(actor: RequestActor, workspaceId: string, locale: string) {
    if (!LANGUAGE_LOCALE_PATTERN.test(locale)) throw new BadRequestException("Choose one of the listed languages");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const current = await client.query<{ preferredLocale: string }>(`SELECT preferred_locale AS "preferredLocale" FROM users WHERE id = $1 FOR UPDATE`, [user.userId]);
      const before = current.rows[0]?.preferredLocale ?? null;
      if (before === locale) return { preferredLocale: locale };
      await client.query(`UPDATE users SET preferred_locale = $2 WHERE id = $1`, [user.userId, locale]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "member.language_changed", entityType: "user", entityId: user.userId, before: { preferredLocale: before }, after: { preferredLocale: locale } });
      return { preferredLocale: locale };
    });
  }

  /** Sound and haptics on the person's devices (on by default), kept on their user record like their language. */
  async setFeedback(actor: RequestActor, workspaceId: string, enabled: boolean) {
    if (typeof enabled !== "boolean") throw new BadRequestException("Choose on or off");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const current = await client.query<{ enabled: boolean }>(`SELECT feedback_enabled AS enabled FROM users WHERE id = $1 FOR UPDATE`, [user.userId]);
      const before = current.rows[0]?.enabled ?? true;
      if (before === enabled) return { feedbackEnabled: enabled };
      await client.query(`UPDATE users SET feedback_enabled = $2 WHERE id = $1`, [user.userId, enabled]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "member.feedback_changed", entityType: "user", entityId: user.userId, before: { feedbackEnabled: before }, after: { feedbackEnabled: enabled } });
      return { feedbackEnabled: enabled };
    });
  }

  async uploadPhoto(actor: RequestActor, workspaceId: string, contentType: string, body: Buffer) {
    if (!body.byteLength) throw new BadRequestException("Choose a photo to upload");
    if (body.byteLength > PROFILE_PHOTO_MAX_BYTES) throw new BadRequestException("Photo must be 5 MB or smaller");
    const metadata = await sharp(body, { failOn: "warning" }).metadata().catch(() => null);
    const detected = metadata?.format ? PHOTO_TYPES[metadata.format] : undefined;
    if (!metadata?.width || !metadata.height || !detected || detected !== contentType) throw new BadRequestException("Use a PNG, JPG or WebP photo");
    if (metadata.width < 64 || metadata.height < 64) throw new BadRequestException("Photo must be at least 64 by 64 pixels");
    if (metadata.width > 8192 || metadata.height > 8192) throw new BadRequestException("Photo must not exceed 8192 by 8192 pixels");
    // One small square: faces crop from the centre, EXIF orientation applied and metadata dropped.
    const square = await sharp(body).rotate().resize({ width: 256, height: 256, fit: "cover", position: "attention" }).webp({ quality: 86 }).toBuffer();
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const current = await this.load(client, workspaceId, user.userId, true);
      const key = `member-photos/${workspaceId}/${user.userId}/${Date.now().toString(36)}.webp`;
      await this.storage.put(key, square, "image/webp");
      const saved = await this.upsert(client, workspaceId, user.userId, "photo_object_key = $3, photo_updated_at = now()", [key]);
      if (current?.photoObjectKey) await this.storage.remove(current.photoObjectKey).catch(() => undefined);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "member.photo_changed", entityType: "workspace_member_profile", entityId: user.userId, after: { byteSize: square.byteLength } });
      return this.view(workspaceId, user.userId, saved);
    });
  }

  removePhoto(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const current = await this.load(client, workspaceId, user.userId, true);
      if (!current?.photoObjectKey) return this.view(workspaceId, user.userId, current);
      const saved = await this.upsert(client, workspaceId, user.userId, "photo_object_key = NULL, photo_updated_at = NULL", []);
      await this.storage.remove(current.photoObjectKey).catch(() => undefined);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "member.photo_removed", entityType: "workspace_member_profile", entityId: user.userId });
      return this.view(workspaceId, user.userId, saved);
    });
  }

  /** Any member of the workspace may see a colleague's photo. */
  readPhoto(actor: RequestActor, workspaceId: string, userId: string) {
    return this.access.asMember(actor, workspaceId, async (client) => {
      const row = await this.load(client, workspaceId, userId);
      if (!row?.photoObjectKey) throw new NotFoundException("No photo");
      const stored = await this.storage.read(row.photoObjectKey).catch(() => null);
      if (!stored) throw new NotFoundException("No photo");
      return { body: stored.body, contentType: "image/webp", etag: row.photoUpdatedAt!.getTime().toString(36) };
    });
  }

  private async load(client: PoolClient, workspaceId: string, userId: string, lock = false) {
    const result = await client.query<ProfileRow>(
      `SELECT avatar_preset AS "avatarPreset", photo_object_key AS "photoObjectKey", photo_updated_at AS "photoUpdatedAt", version
       FROM workspace_member_profiles WHERE workspace_id = $1 AND user_id = $2 ${lock ? "FOR UPDATE" : ""}`,
      [workspaceId, userId],
    );
    return result.rows[0] ?? null;
  }

  private async upsert(client: PoolClient, workspaceId: string, userId: string, assignment: string, values: unknown[]) {
    const insertColumns = assignment.startsWith("avatar_preset") ? ["avatar_preset"] : assignment.startsWith("photo_object_key = $3") ? ["photo_object_key", "photo_updated_at"] : [];
    const insertValues = insertColumns.length === 1 ? ", $3" : insertColumns.length === 2 ? ", $3, now()" : "";
    const result = await client.query<ProfileRow>(
      `INSERT INTO workspace_member_profiles (workspace_id, user_id${insertColumns.map((column) => `, ${column}`).join("")})
       VALUES ($1, $2${insertValues})
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET ${assignment}, version = workspace_member_profiles.version + 1, updated_at = now()
       RETURNING avatar_preset AS "avatarPreset", photo_object_key AS "photoObjectKey", photo_updated_at AS "photoUpdatedAt", version`,
      [workspaceId, userId, ...values],
    );
    return result.rows[0];
  }

  private view(workspaceId: string, userId: string, row: ProfileRow | null) {
    return { avatarPreset: row?.avatarPreset ?? null, photoUrl: MemberProfileService.photoUrl(workspaceId, userId, row?.photoUpdatedAt ?? null), version: row?.version ?? 0 };
  }
}
