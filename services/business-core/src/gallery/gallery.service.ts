import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { effectivePortalBrand } from "../commercial/effective-brand";
import { LeadFormsService } from "../crm/intake/lead-forms.service";
import { DatabaseService } from "../database/database.service";
import { notifyUserInApp } from "../notifications/default-templates";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";

const MANAGE = ["workspace.settings.manage", "crm.settings.manage"];
const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STYLES = ["atelier", "minimal", "noir", "terrazzo", "nordic", "botanical", "coastal", "monochrome", "heritage", "linen", "studio", "marble"];
const KINDS = ["service", "product", "project", "testimonial"] as const;
const SECTION_KEYS = ["services", "products", "projects", "testimonials", "about", "contact"] as const;

type Settings = {
  slug: string; status: "draft" | "published"; style: string; accent: string | null; headline: string; intro: string; about: string; heroImageId: string | null;
  contactPhone: string; contactEmail: string; contactWhatsapp: string; contactAddress: string; leadFormId: string | null;
  enquirySource: string | null; enquiryChannel: string | null; showPrices: boolean; sections: Array<{ key: string; visible: boolean }>; version: number; publishedAt: string | null;
};
type Item = {
  id: string; kind: (typeof KINDS)[number]; title: string; subtitle: string; body: string; priceFrom: string | null; priceUnit: string; catalogItemId: string | null;
  rating: number | null; position: number; visible: boolean; version: number; images: Array<{ id: string; source: "gallery" | "catalog" }>;
};

/**
 * The company gallery (plan: Sales · gallery): a branded brochure the firm edits — services, products
 * (from the catalog or typed), recent projects and client feedback — shared by one link. Visitors add
 * items to a list and send it through the firm's own enquiry form; the picked items land on the
 * enquiry in Sales.
 */
@Injectable()
export class GalleryService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly database: DatabaseService,
    private readonly storage: BrandAssetStorageService,
    private readonly forms: LeadFormsService,
  ) {}

  // ---------- owner ----------
  get(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const settings = await ensureGallery(client, workspaceId);
      return {
        settings, items: await readItems(client, workspaceId, false),
        forms: (await client.query(`SELECT id, coalesce(published->>'title', draft->>'title', 'Enquiry form') AS title, status FROM crm_lead_forms WHERE workspace_id = $1 ORDER BY created_at`, [workspaceId])).rows,
        brand: await effectivePortalBrand(client, workspaceId, null),
        currency: (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? "",
        canManage: await this.canManage(client, workspaceId, user.userId),
      };
    });
  }

  saveSettings(actor: RequestActor, workspaceId: string, input: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const current = await ensureGallery(client, workspaceId);
      if (Number(input.version) !== current.version) throw new ConflictException("Someone changed the gallery. Reload to see the latest.");
      const next: Settings = { ...current };
      const text = (key: keyof Settings, max: number) => {
        if (input[key] === undefined) return;
        if (typeof input[key] !== "string") throw new BadRequestException(`${String(key)} must be text.`);
        const value = (input[key] as string).trim();
        if (value.length > max) throw new BadRequestException(`Keep ${String(key)} under ${max} characters.`);
        (next as Record<string, unknown>)[key] = value;
      };
      text("headline", 200); text("intro", 2000); text("about", 6000);
      text("contactPhone", 40); text("contactEmail", 200); text("contactWhatsapp", 40); text("contactAddress", 400);
      if (input.slug !== undefined) {
        const slug = String(input.slug).trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug)) throw new BadRequestException("Use 3–60 lowercase letters, numbers and dashes for the link.");
        if ((await client.query<{ taken: boolean }>(`SELECT gallery_slug_taken($1, $2) AS taken`, [slug, workspaceId])).rows[0].taken) throw new ConflictException("That link is taken. Try another.");
        next.slug = slug;
      }
      if (input.style !== undefined) { if (!STYLES.includes(String(input.style))) throw new BadRequestException("Choose one of the styles."); next.style = String(input.style); }
      if (input.accent !== undefined) {
        if (input.accent !== null && (typeof input.accent !== "string" || !/^#[0-9a-f]{6}$/i.test(input.accent))) throw new BadRequestException("Choose a colour like #1f6f5c.");
        next.accent = input.accent as string | null;
      }
      if (input.showPrices !== undefined) { if (typeof input.showPrices !== "boolean") throw new BadRequestException("Expected yes or no."); next.showPrices = input.showPrices; }
      if (input.leadFormId !== undefined) {
        next.leadFormId = input.leadFormId === null ? null : String(input.leadFormId);
        if (next.leadFormId && !(await client.query(`SELECT 1 FROM crm_lead_forms WHERE workspace_id = $1 AND id = $2`, [workspaceId, next.leadFormId])).rowCount) throw new BadRequestException("Choose one of your enquiry forms.");
      }
      for (const key of ["enquirySource", "enquiryChannel"] as const)
        if (input[key] !== undefined) next[key] = input[key] === null || input[key] === "" ? null : String(input[key]).slice(0, 80);
      if (input.sections !== undefined) {
        if (!Array.isArray(input.sections)) throw new BadRequestException("Send the sections in order.");
        const sections = input.sections.map((raw) => ({ key: String((raw as { key?: unknown }).key), visible: (raw as { visible?: unknown }).visible !== false }));
        if (sections.length !== SECTION_KEYS.length || !SECTION_KEYS.every((key) => sections.some((section) => section.key === key))) throw new BadRequestException("Keep every section in the list.");
        next.sections = sections;
      }
      if (input.heroImageId !== undefined) {
        next.heroImageId = input.heroImageId === null ? null : String(input.heroImageId);
        if (next.heroImageId && !(await client.query(`SELECT 1 FROM workspace_gallery_images WHERE workspace_id = $1 AND id = $2 AND item_id IS NULL`, [workspaceId, next.heroImageId])).rowCount) throw new BadRequestException("Upload the cover image first.");
      }
      let published = false;
      if (input.status !== undefined) {
        if (!["draft", "published"].includes(String(input.status))) throw new BadRequestException("Choose draft or published.");
        published = input.status === "published" && current.status !== "published";
        next.status = input.status as Settings["status"];
        if (published && !next.leadFormId) throw new BadRequestException("Choose the enquiry form visitors will send before publishing.");
        if (published && !(await client.query(`SELECT 1 FROM crm_lead_forms WHERE workspace_id = $1 AND id = $2 AND status = 'published'`, [workspaceId, next.leadFormId])).rowCount) throw new BadRequestException("Publish that enquiry form first (Sales → Forms).");
      }
      await client.query(
        `UPDATE workspace_galleries SET slug = $2, status = $3, style = $4, accent = $5, headline = $6, intro = $7, about = $8, hero_image_id = $9, contact_phone = $10,
                contact_email = $11, contact_whatsapp = $12, contact_address = $13, lead_form_id = $14, enquiry_source = $15, enquiry_channel = $16, show_prices = $17,
                sections = $18::jsonb, version = version + 1, updated_by = $19, updated_at = now(), published_at = CASE WHEN $20 THEN now() ELSE published_at END
          WHERE workspace_id = $1`,
        [workspaceId, next.slug, next.status, next.style, next.accent, next.headline, next.intro, next.about, next.heroImageId, next.contactPhone, next.contactEmail,
          next.contactWhatsapp, next.contactAddress, next.leadFormId, next.enquirySource, next.enquiryChannel, next.showPrices, JSON.stringify(next.sections), user.userId, published]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "gallery.settings_changed.v1", entityType: "workspace", entityId: workspaceId, before: current, after: next });
      if (published) await this.tellPublished(client, workspaceId, user.userId);
      return ensureGallery(client, workspaceId);
    });
  }

  saveItem(actor: RequestActor, workspaceId: string, input: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, MANAGE, async (client, user) => {
      await ensureGallery(client, workspaceId);
      const id = uuid(input.id, "Item");
      const current = (await client.query<{ version: number; kind: string }>(`SELECT version, kind FROM workspace_gallery_items WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id])).rows[0];
      if (current && input.version !== undefined && Number(input.version) !== current.version) throw new ConflictException("Someone changed this item. Reload to see the latest.");
      const kind = current?.kind ?? String(input.kind ?? "");
      if (!(KINDS as readonly string[]).includes(kind)) throw new BadRequestException("Choose service, product, project or testimonial.");
      const str = (key: string, max: number, required = false) => {
        const value = typeof input[key] === "string" ? (input[key] as string).trim() : "";
        if (required && !value) throw new BadRequestException(kind === "testimonial" ? "Add who said it." : "Give it a name.");
        if (value.length > max) throw new BadRequestException(`Keep ${key} under ${max} characters.`);
        return value;
      };
      const title = str("title", 200, true), subtitle = str("subtitle", 300), body = str("body", 6000), priceUnit = str("priceUnit", 40);
      const priceFrom = input.priceFrom === null || input.priceFrom === undefined || input.priceFrom === "" ? null : String(input.priceFrom);
      if (priceFrom !== null && !/^\d+(\.\d{1,2})?$/.test(priceFrom)) throw new BadRequestException("Enter a price like 1500 or 1500.50.");
      const rating = input.rating === null || input.rating === undefined ? null : Number(input.rating);
      if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new BadRequestException("A rating is 1 to 5.");
      const catalogItemId = input.catalogItemId ? uuid(input.catalogItemId, "Catalog item") : null;
      if (catalogItemId && !(await client.query(`SELECT 1 FROM catalog_items WHERE workspace_id = $1 AND id = $2`, [workspaceId, catalogItemId])).rowCount) throw new BadRequestException("Choose an item from your catalog.");
      const visible = input.visible === undefined ? true : input.visible === true;
      if (current) await client.query(
        `UPDATE workspace_gallery_items SET title = $3, subtitle = $4, body = $5, price_from = $6, price_unit = $7, catalog_item_id = $8, rating = $9, visible = $10, version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, title, subtitle, body, priceFrom, priceUnit, catalogItemId, kind === "testimonial" ? rating : null, visible]);
      else {
        const position = Number((await client.query<{ next: number }>(`SELECT coalesce(max(position), -1) + 1 AS next FROM workspace_gallery_items WHERE workspace_id = $1 AND kind = $2`, [workspaceId, kind])).rows[0].next);
        await client.query(
          `INSERT INTO workspace_gallery_items (id, workspace_id, kind, title, subtitle, body, price_from, price_unit, catalog_item_id, rating, position, visible, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [id, workspaceId, kind, title, subtitle, body, priceFrom, priceUnit, catalogItemId, kind === "testimonial" ? rating : null, position, visible, user.userId]);
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: current ? "gallery.item_changed.v1" : "gallery.item_added.v1", entityType: "gallery_item", entityId: id, after: { kind, title } });
      return { items: await readItems(client, workspaceId, false) };
    });
  }

  removeItem(actor: RequestActor, workspaceId: string, itemId: string) {
    return this.access.withAnyPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const images = (await client.query<{ objectKey: string; previewKey: string | null }>(`SELECT object_key AS "objectKey", preview_key AS "previewKey" FROM workspace_gallery_images WHERE workspace_id = $1 AND item_id = $2`, [workspaceId, itemId])).rows;
      const removed = await client.query(`DELETE FROM workspace_gallery_items WHERE workspace_id = $1 AND id = $2`, [workspaceId, itemId]);
      if (removed.rowCount) await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "gallery.item_removed.v1", entityType: "gallery_item", entityId: itemId });
      for (const image of images) { await this.storage.remove(image.objectKey).catch(() => undefined); if (image.previewKey) await this.storage.remove(image.previewKey).catch(() => undefined); }
      return { items: await readItems(client, workspaceId, false) };
    });
  }

  reorder(actor: RequestActor, workspaceId: string, input: { kind?: unknown; ids?: unknown }) {
    return this.access.withAnyPermission(actor, workspaceId, MANAGE, async (client) => {
      if (!Array.isArray(input.ids) || input.ids.length > 500 || input.ids.some((id) => typeof id !== "string" || !UUID.test(id))) throw new BadRequestException("Send the items in their new order.");
      await client.query(`UPDATE workspace_gallery_items item SET position = ordered.position - 1 FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, position) WHERE item.workspace_id = $1 AND item.id = ordered.id`, [workspaceId, input.ids]);
      return { items: await readItems(client, workspaceId, false) };
    });
  }

  /** Adds catalog items as gallery products (their pictures come from the catalog); ones already shown are skipped. */
  importCatalog(actor: RequestActor, workspaceId: string, input: { itemIds?: unknown }) {
    return this.access.withAnyPermission(actor, workspaceId, MANAGE, async (client, user) => {
      await ensureGallery(client, workspaceId);
      if (!Array.isArray(input.itemIds) || !input.itemIds.length || input.itemIds.length > 200 || input.itemIds.some((id) => typeof id !== "string" || !UUID.test(id))) throw new BadRequestException("Choose catalog items to add.");
      const currency = (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? "";
      const rows = (await client.query<{ id: string; name: string; description: string | null; unit: string; category: string | null; price: string | null }>(
        `SELECT item.id, item.name, item.description, item.unit_code AS unit, category.name AS category,
                (SELECT coalesce(entry.price, entry.rate)::text FROM price_entries entry JOIN price_books book ON book.id = entry.price_book_id
                  WHERE entry.item_id = item.id AND entry.variant_id IS NULL AND entry.status = 'active' AND book.status = 'active' AND book.currency = $3 ORDER BY book.effective_from DESC LIMIT 1) AS price
           FROM catalog_items item LEFT JOIN catalog_categories category ON category.id = item.category_id
          WHERE item.workspace_id = $1 AND item.id = ANY($2::uuid[]) AND item.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM workspace_gallery_items gallery WHERE gallery.workspace_id = item.workspace_id AND gallery.catalog_item_id = item.id)`,
        [workspaceId, input.itemIds, currency])).rows;
      let position = Number((await client.query<{ next: number }>(`SELECT coalesce(max(position), -1) + 1 AS next FROM workspace_gallery_items WHERE workspace_id = $1 AND kind = 'product'`, [workspaceId])).rows[0].next);
      for (const row of rows)
        await client.query(`INSERT INTO workspace_gallery_items (id, workspace_id, kind, title, subtitle, body, price_from, price_unit, catalog_item_id, position, created_by) VALUES (gen_random_uuid(), $1, 'product', $2, $3, $4, $5, $6, $7, $8, $9)`,
          [workspaceId, row.name.slice(0, 200), row.category ?? "", row.description ?? "", row.price === null ? null : Number(row.price).toFixed(2), row.unit, row.id, position++, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "gallery.catalog_imported.v1", entityType: "workspace", entityId: workspaceId, after: { added: rows.length } });
      return { items: await readItems(client, workspaceId, false), added: rows.length };
    });
  }

  async uploadImage(actor: RequestActor, workspaceId: string, imageId: string, itemId: string | null, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/")) throw new BadRequestException("Choose an image (JPG, PNG or WebP).");
    return this.access.withAnyPermission(actor, workspaceId, MANAGE, async (client, user) => {
      await ensureGallery(client, workspaceId);
      if (itemId && !(await client.query(`SELECT 1 FROM workspace_gallery_items WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, itemId])).rowCount) throw new NotFoundException("Gallery item not found.");
      const existing = (await client.query<{ sha256: string }>(`SELECT sha256 FROM workspace_gallery_images WHERE workspace_id = $1 AND id = $2`, [workspaceId, imageId])).rows[0];
      if (existing) { if (existing.sha256 !== prepared.digest) throw new ConflictException("This upload id belongs to another image."); return { id: imageId }; }
      const count = Number((await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM workspace_gallery_images WHERE workspace_id = $1 AND item_id IS NOT DISTINCT FROM $2`, [workspaceId, itemId])).rows[0].n);
      if (count >= 20) throw new BadRequestException("Use up to 20 pictures here.");
      const key = `gallery/${workspaceId}/${imageId}`;
      await this.storage.put(`${key}/original`, prepared.body, prepared.mimeType);
      if (prepared.preview) await this.storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
      await client.query(`INSERT INTO workspace_gallery_images (id, workspace_id, item_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, sort_order, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [imageId, workspaceId, itemId, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null, prepared.digest, count, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "gallery.image_added.v1", entityType: "workspace", entityId: workspaceId, after: { imageId, itemId } });
      return { id: imageId };
    });
  }

  removeImage(actor: RequestActor, workspaceId: string, imageId: string) {
    return this.access.withAnyPermission(actor, workspaceId, MANAGE, async (client, user) => {
      const row = (await client.query<{ objectKey: string; previewKey: string | null }>(`DELETE FROM workspace_gallery_images WHERE workspace_id = $1 AND id = $2 RETURNING object_key AS "objectKey", preview_key AS "previewKey"`, [workspaceId, imageId])).rows[0];
      await client.query(`UPDATE workspace_galleries SET hero_image_id = NULL WHERE workspace_id = $1 AND hero_image_id = $2`, [workspaceId, imageId]);
      if (row) {
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "gallery.image_removed.v1", entityType: "workspace", entityId: workspaceId, after: { imageId } });
        await this.storage.remove(row.objectKey).catch(() => undefined);
        if (row.previewKey) await this.storage.remove(row.previewKey).catch(() => undefined);
      }
      return { items: await readItems(client, workspaceId, false), settings: await ensureGallery(client, workspaceId) };
    });
  }

  /** An image for the owner's editor (drafts included). */
  ownerImage(actor: RequestActor, workspaceId: string, imageId: string, preview: boolean) {
    return this.access.asMember(actor, workspaceId, async (client) => readImage(client, this.storage, workspaceId, imageId, preview, false));
  }

  // ---------- public ----------
  /** The published gallery by its link, with the enquiry form's questions. */
  async publicGallery(slug: string) {
    const workspaceId = await this.published(slug);
    const content = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const settings = await ensureGallery(client, workspaceId);
      const form = settings.leadFormId ? (await client.query<{ token: string }>(`SELECT token FROM crm_lead_forms WHERE workspace_id = $1 AND id = $2 AND status = 'published'`, [workspaceId, settings.leadFormId])).rows[0] : undefined;
      const { leadFormId: _form, enquirySource: _source, enquiryChannel: _channel, version: _version, status: _status, ...visible } = settings;
      return {
        settings: visible, items: await readItems(client, workspaceId, true), brand: await effectivePortalBrand(client, workspaceId, null),
        currency: (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? "",
        formToken: form?.token ?? null,
      };
    });
    const { formToken, ...rest } = content;
    const form = formToken ? await this.forms.publicForm(formToken).catch(() => null) : null;
    return { ...rest, form };
  }

  async publicImage(slug: string, imageId: string, preview: boolean) {
    const workspaceId = await this.published(slug);
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) => readImage(client, this.storage, workspaceId, imageId, preview, true));
  }

  /** A visitor's list sent through the firm's own enquiry form; the picked items go on the enquiry. */
  async publicEnquiry(slug: string, input: { requestId?: unknown; revision?: unknown; answers?: unknown; phoneCountryCodes?: unknown; serviceConsent?: unknown; selection?: unknown }) {
    const workspaceId = await this.published(slug);
    const found = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const settings = await ensureGallery(client, workspaceId);
      const token = settings.leadFormId ? (await client.query<{ token: string }>(`SELECT token FROM crm_lead_forms WHERE workspace_id = $1 AND id = $2 AND status = 'published'`, [workspaceId, settings.leadFormId])).rows[0]?.token : undefined;
      const titles = Array.isArray(input.selection) ? (await client.query<{ title: string }>(
        `SELECT title FROM workspace_gallery_items WHERE workspace_id = $1 AND visible AND id = ANY($2::uuid[]) ORDER BY kind, position`,
        [workspaceId, input.selection.filter((id): id is string => typeof id === "string" && UUID.test(id)).slice(0, 50)])).rows.map((row) => row.title) : [];
      return { token, titles, source: settings.enquirySource, channel: settings.enquiryChannel };
    });
    if (!found.token) throw new NotFoundException("This gallery isn't taking enquiries right now.");
    if (typeof input.requestId !== "string" || !UUID.test(input.requestId) || typeof input.revision !== "string" || !input.answers || typeof input.answers !== "object") throw new BadRequestException("Fill in the form and try again.");
    return this.forms.submit(found.token, {
      requestId: input.requestId, revision: input.revision, answers: input.answers as Record<string, unknown>,
      phoneCountryCodes: input.phoneCountryCodes && typeof input.phoneCountryCodes === "object" ? input.phoneCountryCodes as Record<string, string> : undefined,
      serviceConsent: input.serviceConsent === true,
      link: { ...(found.source ? { source: found.source } : {}), ...(found.channel ? { channel: found.channel } : {}), placement: "gallery" },
      selection: found.titles,
    });
  }

  private async published(slug: string) {
    if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/i.test(slug)) throw new NotFoundException("Gallery not found.");
    const workspaceId = (await this.database.query<{ id: string | null }>(`SELECT public_gallery_workspace($1) AS id`, [slug])).rows[0]?.id;
    if (!workspaceId) throw new NotFoundException("Gallery not found.");
    return workspaceId;
  }

  private async canManage(client: PoolClient, workspaceId: string, userId: string) {
    for (const code of MANAGE) if (await this.access.hasPermission(client, workspaceId, userId, code)) return true;
    return false;
  }

  private async tellPublished(client: PoolClient, workspaceId: string, actorUserId: string) {
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorUserId])).rows[0]?.name ?? "Someone";
    const managers = (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = assigned.role_id
         JOIN permissions permission ON permission.id = granted.permission_id
        WHERE membership.workspace_id = $1 AND membership.status = 'active' AND permission.code = ANY($2::text[]) LIMIT 30`, [workspaceId, MANAGE])).rows;
    const stamp = Date.now();
    for (const manager of managers.filter((row) => row.userId !== actorUserId))
      await notifyUserInApp(client, { workspaceId, recipientUserId: manager.userId, code: "gallery.published", eventType: "gallery.published", variables: { actor }, deepLink: "/workspace/gallery", idempotencyKey: `gallery.published:${stamp}:${manager.userId}` });
  }
}

/** The gallery row, created on first use with a link from the workspace's own slug. */
async function ensureGallery(client: PoolClient, workspaceId: string): Promise<Settings> {
  const read = () => client.query<Settings>(
    `SELECT slug, status, style, accent, headline, intro, about, hero_image_id AS "heroImageId", contact_phone AS "contactPhone", contact_email AS "contactEmail",
            contact_whatsapp AS "contactWhatsapp", contact_address AS "contactAddress", lead_form_id AS "leadFormId", enquiry_source AS "enquirySource",
            enquiry_channel AS "enquiryChannel", show_prices AS "showPrices", sections, version, published_at AS "publishedAt"
       FROM workspace_galleries WHERE workspace_id = $1`, [workspaceId]);
  const found = (await read()).rows[0];
  if (found) return found;
  const workspace = (await client.query<{ slug: string; name: string }>(`SELECT slug, name FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  let base = (workspace?.slug ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  if (base.length < 3) base = `studio-${workspaceId.slice(0, 8)}`;
  let slug = base;
  for (let n = 2; (await client.query<{ taken: boolean }>(`SELECT gallery_slug_taken($1, $2) AS taken`, [slug, workspaceId])).rows[0].taken; n += 1) slug = `${base}-${n}`;
  const form = (await client.query<{ id: string }>(`SELECT id FROM crm_lead_forms WHERE workspace_id = $1 AND status = 'published' ORDER BY created_at LIMIT 1`, [workspaceId])).rows[0];
  await client.query(`INSERT INTO workspace_galleries (workspace_id, slug, headline, lead_form_id) VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id) DO NOTHING`, [workspaceId, slug, workspace?.name ?? "", form?.id ?? null]);
  return (await read()).rows[0];
}

async function readItems(client: PoolClient, workspaceId: string, publicOnly: boolean): Promise<Item[]> {
  return (await client.query<Item>(
    `SELECT item.id, item.kind, item.title, item.subtitle, item.body, item.price_from::text AS "priceFrom", item.price_unit AS "priceUnit", item.catalog_item_id AS "catalogItemId",
            item.rating, item.position, item.visible, item.version,
            coalesce((SELECT jsonb_agg(jsonb_build_object('id', image.id, 'source', 'gallery') ORDER BY image.sort_order, image.created_at) FROM workspace_gallery_images image
                       WHERE image.workspace_id = item.workspace_id AND image.item_id = item.id), '[]'::jsonb)
            || coalesce((SELECT jsonb_agg(jsonb_build_object('id', picture.id, 'source', 'catalog') ORDER BY picture.sort_order, picture.created_at) FROM catalog_item_images picture
                       WHERE picture.workspace_id = item.workspace_id AND picture.item_id = item.catalog_item_id), '[]'::jsonb) AS images
       FROM workspace_gallery_items item
      WHERE item.workspace_id = $1 AND ($2 = false OR item.visible)
      ORDER BY item.kind, item.position, item.created_at`, [workspaceId, publicOnly])).rows;
}

/** A gallery picture, or the catalog picture of an item shown in the gallery (public reads only visible items). */
async function readImage(client: PoolClient, storage: BrandAssetStorageService, workspaceId: string, imageId: string, preview: boolean, publicOnly: boolean) {
  if (!UUID.test(imageId)) throw new NotFoundException("Image not found.");
  const row = (await client.query<{ objectKey: string; previewKey: string | null; mimeType: string }>(
    `SELECT image.object_key AS "objectKey", image.preview_key AS "previewKey", image.mime_type AS "mimeType" FROM workspace_gallery_images image
       LEFT JOIN workspace_gallery_items item ON item.workspace_id = image.workspace_id AND item.id = image.item_id
      WHERE image.workspace_id = $1 AND image.id = $2 AND ($3 = false OR image.item_id IS NULL OR item.visible)
     UNION ALL
     SELECT picture.object_key, picture.preview_key, picture.mime_type FROM catalog_item_images picture
      WHERE picture.workspace_id = $1 AND picture.id = $2
        AND EXISTS (SELECT 1 FROM workspace_gallery_items item WHERE item.workspace_id = picture.workspace_id AND item.catalog_item_id = picture.item_id AND ($3 = false OR item.visible))
     LIMIT 1`, [workspaceId, imageId, publicOnly])).rows[0];
  if (!row) throw new NotFoundException("Image not found.");
  const key = preview && row.previewKey ? row.previewKey : row.objectKey;
  const stored = await storage.read(key).catch(() => null);
  if (!stored) throw new NotFoundException("Image not found.");
  return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mimeType };
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} id is invalid.`);
  return value.toLowerCase();
}
