import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { tellSupplierOnHold } from "./supplier-controls.service";
import {
  APPROVALS, DEALS, PAYMENT_TERMS, cleanCategories, normalName, percent, readApproval, readDeal, readSupplier, readSuppliers, readTerms, retentionPercent, supplierCode,
  type Approval, type Deal, type PaymentTerms, type Supplier,
} from "./suppliers";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ImportRow = { key: string; name: string; categories: string; approval: string; deal: string; terms: string; contactName: string; phone: string; email: string; locality: string; notes: string; entityId: string | null };

/**
 * The supplier register: what each supplier supplies, whether it's approved (and preferred for which
 * categories), its payment terms, its discount or commission, and which of the firm's companies buy from
 * it. Approving is a separate permission from keeping the register, so nobody approves a supplier just
 * by adding it.
 */
@Injectable()
export class SuppliersService {
  constructor(private readonly access: WorkspaceAccessService) {}

  list(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "vendors.view", async (client, user) => this.state(client, workspaceId, user.userId));
  }

  save(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      const id = uuid(body.id, "Supplier");
      const current = await readSupplier(client, workspaceId, id, true);
      if (current && body.version !== current.version) throw new ConflictException("Someone else changed this supplier. Reload to see their changes.");
      const name = text(body.name, 240, "Name");
      if (!name) throw new BadRequestException("Name the supplier.");
      if ((await client.query(`SELECT 1 FROM workspace_vendors WHERE workspace_id = $1 AND id <> $2 AND status <> 'archived' AND lower(btrim(display_name)) = lower($3)`, [workspaceId, id, name])).rowCount)
        throw new ConflictException("Another supplier has this name.");
      const tax = text(body.taxRegistrationNumber, 120, "Tax number") || null;
      if (tax && (await client.query(`SELECT 1 FROM workspace_vendors WHERE workspace_id = $1 AND id <> $2 AND lower(btrim(tax_registration_number)) = lower($3)`, [workspaceId, id, tax])).rowCount)
        throw new ConflictException("Another supplier has this tax number.");
      const categories = cleanCategories(body.categories, await this.knownCategories(client, workspaceId));
      const terms = this.terms(body);
      const deal = this.deal(body);
      const currency = body.currency ? String(body.currency).toUpperCase() : null;
      if (currency && !/^[A-Z]{3}$/.test(currency)) throw new BadRequestException("Choose a currency.");
      const email = text(body.email, 320, "Email") || null;
      if (email && !EMAIL.test(email)) throw new BadRequestException("Enter a valid email.");
      const fields = { name, legalName: text(body.legalName, 240, "Legal name") || null, categories, ...terms, ...deal, tax, currency, notes: text(body.notes, 10000, "Notes") };
      // Preferred categories stay only while the supplier still has them.
      const preferred = (current?.preferredFor ?? []).filter((item) => categories.some((category) => category.toLocaleLowerCase() === item.toLocaleLowerCase()))
        .map((item) => categories.find((category) => category.toLocaleLowerCase() === item.toLocaleLowerCase())!);
      if (current) {
        await client.query(
          `UPDATE workspace_vendors SET display_name = $3, legal_name = $4, categories = $5, preferred_for = $6, payment_terms = $7, advance_percent = $8, credit_days = $9, terms_note = $10,
                  deal = $11, deal_percent = $12, deal_note = $13, tax_registration_number = $14, default_currency = $15, notes = $16, updated_by = $17, retention_percent = $18,
                  updated_at = now(), version = version + 1
            WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, id, name, fields.legalName, categories, preferred, terms.paymentTerms, terms.advancePercent, terms.creditDays, terms.termsNote,
            deal.deal, deal.dealPercent, deal.dealNote, tax, currency, fields.notes, user.userId, terms.retentionPercent]);
      } else {
        await client.query(
          `INSERT INTO workspace_vendors (workspace_id, id, code, display_name, legal_name, capabilities, categories, payment_terms, advance_percent, credit_days, terms_note,
                                          deal, deal_percent, deal_note, tax_registration_number, default_currency, notes, status, created_by, updated_by, retention_percent)
           VALUES ($1, $2, $3, $4, $5, '{materials}', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'active', $17, $17, $18)`,
          [workspaceId, id, await supplierCode(client, workspaceId, name), name, fields.legalName, categories, terms.paymentTerms, terms.advancePercent, terms.creditDays,
            terms.termsNote, deal.deal, deal.dealPercent, deal.dealNote, tax, currency, fields.notes, user.userId, terms.retentionPercent]);
      }
      await this.contact(client, workspaceId, id, body, user.userId);
      await this.entities(client, workspaceId, id, body.entityIds);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: current ? "supplier.changed" : "supplier.created", entityType: "supplier", entityId: id, before: current ?? null, after: fields });
      return { ...(await this.state(client, workspaceId, user.userId)), supplierId: id };
    });
  }

  /** Approve, refuse or hold a supplier, and name the categories it's the preferred supplier for. */
  approve(actor: RequestActor, workspaceId: string, supplierId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "vendors.approve", async (client, user) => {
      const current = await readSupplier(client, workspaceId, supplierId, true);
      if (!current) throw new NotFoundException("Supplier not found.");
      if (body.version !== current.version) throw new ConflictException("Someone else changed this supplier. Reload to see their changes.");
      const approval = oneOf(body.approval, APPROVALS, "Approval");
      const note = text(body.note, 500, "Note");
      if ((approval === "not_approved" || approval === "on_hold") && !note) throw new BadRequestException("Say why.");
      const preferred = approval === "approved" ? cleanCategories(body.preferredFor, current.categories) : [];
      const outside = preferred.find((item) => !current.categories.includes(item));
      if (outside) throw new BadRequestException(`${outside} isn't one of this supplier's categories.`);
      await client.query(
        `UPDATE workspace_vendors SET approval = $3::varchar, preferred_for = $4, approval_note = $5, approval_at = CASE WHEN $3::varchar = 'pending' THEN NULL ELSE now() END,
                approval_by = CASE WHEN $3::varchar = 'pending' THEN NULL ELSE $6::uuid END, updated_by = $6::uuid, updated_at = now(), version = version + 1
          WHERE workspace_id = $1 AND id = $2`, [workspaceId, supplierId, approval, preferred, note, user.userId]);
      // Going on hold (or refused) with orders still open: their buyers and the approvers hear, and those orders wait.
      if ((approval === "on_hold" || approval === "not_approved") && current.approval !== approval)
        await tellSupplierOnHold(client, workspaceId, supplierId, current.name, note, user.userId, `approval:${supplierId}:${current.version}`);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "supplier.approval_changed", entityType: "supplier", entityId: supplierId,
        before: { approval: current.approval, preferredFor: current.preferredFor }, after: { approval, preferredFor: preferred, note } });
      return this.state(client, workspaceId, user.userId);
    });
  }

  /** Stop using a supplier (with the reason), or bring it back. Its history stays. */
  archive(actor: RequestActor, workspaceId: string, supplierId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      const current = await readSupplier(client, workspaceId, supplierId, true);
      if (!current) throw new NotFoundException("Supplier not found.");
      if (body.version !== current.version) throw new ConflictException("Someone else changed this supplier. Reload to see their changes.");
      if (body.restore === true) {
        if (current.status !== "archived") throw new ConflictException("This supplier is in use.");
        if ((await client.query(`SELECT 1 FROM workspace_vendors WHERE workspace_id = $1 AND id <> $2 AND status <> 'archived' AND lower(btrim(display_name)) = lower(btrim($3))`, [workspaceId, supplierId, current.name])).rowCount)
          throw new ConflictException("Another supplier has this name now.");
        await client.query(`UPDATE workspace_vendors SET status = 'active', archived_reason = NULL, archived_at = NULL, archived_by = NULL, updated_by = $3, updated_at = now(), version = version + 1
          WHERE workspace_id = $1 AND id = $2`, [workspaceId, supplierId, user.userId]);
      } else {
        const reason = text(body.reason, 500, "Reason");
        if (!reason) throw new BadRequestException("Say why you're no longer using this supplier.");
        await client.query(`UPDATE workspace_vendors SET status = 'archived', archived_reason = $3, archived_at = now(), archived_by = $4, updated_by = $4, updated_at = now(), version = version + 1
          WHERE workspace_id = $1 AND id = $2`, [workspaceId, supplierId, reason, user.userId]);
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: body.restore === true ? "supplier.restored" : "supplier.archived", entityType: "supplier", entityId: supplierId, after: { reason: body.reason ?? null } });
      return this.state(client, workspaceId, user.userId);
    });
  }

  /**
   * Reads a supplier list the firm already keeps (one row per supplier, possibly on several sheets for
   * several companies). Rows with the same name become one supplier; a supplier already in the register
   * gains the new companies, categories and missing contact details, and keeps what it has. Approvals
   * come across only for someone who may approve suppliers. Shows what would happen, then does it.
   */
  importSuppliers(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      const rows = this.importRows(body.rows);
      const canApprove = await this.access.hasPermission(client, workspaceId, user.userId, "vendors.approve");
      const entities = new Set((await this.entitiesOf(client, workspaceId)).map((entity) => entity.id));
      const known = await this.knownCategories(client, workspaceId);
      const existing = new Map((await readSuppliers(client, workspaceId)).filter((item) => item.status !== "archived").map((item) => [normalName(item.name), item]));
      const groups = new Map<string, ImportRow[]>();
      for (const row of rows) groups.set(normalName(row.name), [...(groups.get(normalName(row.name)) ?? []), row]);
      const plan = [...groups.values()].map((group) => {
        const categories = cleanCategories(group.flatMap((row) => row.categories.split(",")), known);
        const approvals = group.map((row) => ({ ...readApproval(row.approval), categories: cleanCategories(row.categories.split(","), categories) }));
        const approval: Approval = approvals.some((item) => item.approval === "not_approved") ? "not_approved" : approvals.some((item) => item.approval === "approved") ? "approved" : "pending";
        const preferredFor = approval === "approved" ? cleanCategories(approvals.filter((item) => item.preferred).flatMap((item) => item.categories), categories) : [];
        const terms = group.map((row) => readTerms(row.terms)).find((item) => item.paymentTerms !== "upfront" || item.termsNote) ?? readTerms("");
        const deal = group.map((row) => readDeal(row.deal)).find((item) => item.deal !== "none") ?? readDeal("");
        const pick = (key: "contactName" | "phone" | "email" | "locality" | "notes") => group.map((row) => row[key].trim()).find(Boolean) ?? "";
        const email = pick("email");
        const entityIds = [...new Set(group.map((row) => row.entityId).filter((entity): entity is string => Boolean(entity && entities.has(entity))))];
        const match = existing.get(normalName(group[0].name));
        return {
          name: group[0].name.replace(/\s+/g, " ").trim(), rows: group.map((row) => row.key), existingId: match?.id ?? null, categories, approval: canApprove ? approval : "pending" as Approval,
          preferredFor: canApprove ? preferredFor : [], approvalSkipped: !canApprove && approval !== "pending", ...terms, ...deal,
          contactName: pick("contactName"), phone: pick("phone"), email: EMAIL.test(email) ? email : "", locality: pick("locality"), notes: pick("notes"), entityIds,
          action: (match ? "merge" : "create") as "merge" | "create",
        };
      });
      if (body.commit !== true) return { plan, canApprove };
      for (const item of plan) {
        const id = item.existingId ?? randomUUID();
        if (!item.existingId) {
          await client.query(
            `INSERT INTO workspace_vendors (workspace_id, id, code, display_name, capabilities, categories, approval, preferred_for, approval_at, approval_by, payment_terms, advance_percent,
                                            credit_days, terms_note, deal, deal_percent, deal_note, notes, status, created_by, updated_by)
             VALUES ($1, $2, $3, $4, '{materials}', $5, $6::varchar, $7, CASE WHEN $6::varchar = 'pending' THEN NULL ELSE now() END, CASE WHEN $6::varchar = 'pending' THEN NULL ELSE $17::uuid END,
                     $8, $9, $10, $11, $12, $13, $14, $15, 'active', $16, $16)`,
            [workspaceId, id, await supplierCode(client, workspaceId, item.name), item.name, item.categories, item.approval, item.preferredFor, item.paymentTerms, item.advancePercent,
              item.creditDays, item.termsNote, item.deal, item.dealPercent, item.dealNote, item.notes.slice(0, 10000), user.userId, user.userId]);
        } else {
          const current = (await readSupplier(client, workspaceId, id, true))!;
          const categories = cleanCategories([...current.categories, ...item.categories]);
          await client.query(`UPDATE workspace_vendors SET categories = $3, updated_by = $4, updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
            [workspaceId, id, categories, user.userId]);
        }
        await this.contact(client, workspaceId, id, item, user.userId, true);
        for (const entityId of item.entityIds)
          await client.query(`INSERT INTO vendor_legal_entities (workspace_id, vendor_id, legal_entity_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [workspaceId, id, entityId]);
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "supplier.imported", entityType: "supplier", entityId: workspaceId,
        after: { created: plan.filter((item) => item.action === "create").length, merged: plan.filter((item) => item.action === "merge").length } });
      return { ...(await this.state(client, workspaceId, user.userId)), imported: { created: plan.filter((item) => item.action === "create").length, merged: plan.filter((item) => item.action === "merge").length } };
    });
  }

  // ---------- helpers ----------
  private async state(client: Db, workspaceId: string, userId: string) {
    const suppliers = await readSuppliers(client, workspaceId);
    return {
      suppliers,
      categories: [...new Set(suppliers.flatMap((item) => item.categories))].sort((a, b) => a.localeCompare(b)),
      entities: await this.entitiesOf(client, workspaceId),
      canManage: await this.access.hasPermission(client, workspaceId, userId, "vendors.manage"),
      canApprove: await this.access.hasPermission(client, workspaceId, userId, "vendors.approve"),
    };
  }

  private async entitiesOf(client: Db, workspaceId: string) {
    return (await client.query<{ id: string; code: string; name: string }>(
      `SELECT id, code, display_name AS name FROM legal_entities WHERE workspace_id = $1 AND status = 'active' ORDER BY display_name`, [workspaceId])).rows;
  }

  private async knownCategories(client: Db, workspaceId: string) {
    return (await client.query<{ category: string }>(`SELECT DISTINCT unnest(categories) AS category FROM workspace_vendors WHERE workspace_id = $1`, [workspaceId])).rows.map((row) => row.category);
  }

  private terms(body: Record<string, unknown>) {
    const paymentTerms = oneOf(body.paymentTerms ?? "upfront", PAYMENT_TERMS, "Payment terms") as PaymentTerms;
    const advancePercent = paymentTerms === "split" ? percent(body.advancePercent, "The advance") : null;
    const days = paymentTerms === "credit" ? Number(body.creditDays) : null;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) throw new BadRequestException("Credit is a whole number of days, from 1 to 365.");
    return { paymentTerms, advancePercent, creditDays: days, termsNote: text(body.termsNote, 500, "Terms note"), retentionPercent: retentionPercent(body.retentionPercent) };
  }

  private deal(body: Record<string, unknown>) {
    const deal = oneOf(body.deal ?? "none", DEALS, "Deal") as Deal;
    const dealPercent = deal === "discount" || deal === "commission" ? percent(body.dealPercent, deal === "discount" ? "The discount" : "The commission") : null;
    return { deal, dealPercent, dealNote: text(body.dealNote, 500, "Deal note") };
  }

  /** The supplier's main contact (its primary location). An import only fills what's missing. */
  private async contact(client: Db, workspaceId: string, vendorId: string, body: Record<string, unknown> | { contactName: string; phone: string; email: string; locality: string }, userId: string, fillOnly = false) {
    const input = body as Record<string, unknown>;
    const value = { contactName: text(input.contactName, 180, "Contact") || null, phone: text(input.phone, 80, "Phone") || null, email: text(input.email, 320, "Email") || null, locality: text(input.locality, 160, "Location") || null };
    // The same phone number on two suppliers is usually the same supplier twice.
    const digits = (value.phone ?? "").replace(/\D/g, "");
    if (!fillOnly && digits.length >= 7 && (await client.query(
      `SELECT 1 FROM workspace_vendor_sites site JOIN workspace_vendors vendor ON vendor.workspace_id = site.workspace_id AND vendor.id = site.vendor_id
        WHERE site.workspace_id = $1 AND site.vendor_id <> $2 AND site.status = 'active' AND vendor.status <> 'archived' AND regexp_replace(coalesce(site.phone, ''), '\\D', '', 'g') = $3`,
      [workspaceId, vendorId, digits])).rowCount) throw new ConflictException("Another supplier has this phone number.");
    const site = (await client.query<{ id: string; contactName: string | null; phone: string | null; email: string | null; locality: string | null }>(
      `SELECT id, contact_name AS "contactName", phone, email, locality FROM workspace_vendor_sites WHERE workspace_id = $1 AND vendor_id = $2 AND status = 'active' AND is_primary FOR UPDATE`,
      [workspaceId, vendorId])).rows[0];
    if (!site) {
      if (!Object.values(value).some(Boolean)) return;
      await client.query(`INSERT INTO workspace_vendor_sites (workspace_id, vendor_id, id, name, site_type, contact_name, email, phone, locality, is_primary, created_by, updated_by)
        VALUES ($1, $2, $3, 'Main', 'office', $4, $5, $6, $7, true, $8, $8)`, [workspaceId, vendorId, randomUUID(), value.contactName, value.email, value.phone, value.locality, userId]);
      return;
    }
    const next = fillOnly ? { contactName: site.contactName ?? value.contactName, phone: site.phone ?? value.phone, email: site.email ?? value.email, locality: site.locality ?? value.locality } : value;
    await client.query(`UPDATE workspace_vendor_sites SET contact_name = $3, email = $4, phone = $5, locality = $6, updated_by = $7, updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, site.id, next.contactName, next.email, next.phone, next.locality, userId]);
  }

  private async entities(client: Db, workspaceId: string, vendorId: string, value: unknown) {
    if (value === undefined) return;
    const ids = Array.isArray(value) ? [...new Set(value.map((item) => uuid(item, "Company")))] : [];
    const known = new Set((await this.entitiesOf(client, workspaceId)).map((entity) => entity.id));
    const unknown = ids.find((id) => !known.has(id));
    if (unknown) throw new BadRequestException("Choose one of your companies.");
    await client.query(`DELETE FROM vendor_legal_entities WHERE workspace_id = $1 AND vendor_id = $2 AND NOT (legal_entity_id = ANY($3::uuid[]))`, [workspaceId, vendorId, ids]);
    for (const id of ids) await client.query(`INSERT INTO vendor_legal_entities (workspace_id, vendor_id, legal_entity_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [workspaceId, vendorId, id]);
  }

  private importRows(value: unknown): ImportRow[] {
    if (!Array.isArray(value) || !value.length) throw new BadRequestException("The file has no suppliers.");
    if (value.length > 3000) throw new BadRequestException("Import up to 3,000 rows at a time.");
    const cell = (raw: Record<string, unknown>, key: string, max: number) => (typeof raw[key] === "string" ? (raw[key] as string).replace(/\s+/g, " ").trim().slice(0, max) : "");
    return value.map((item, index) => {
      const raw = (item ?? {}) as Record<string, unknown>;
      const entityId = typeof raw.entityId === "string" && UUID.test(raw.entityId) ? raw.entityId : null;
      return { key: cell(raw, "key", 80) || String(index + 1), name: cell(raw, "name", 240), categories: cell(raw, "categories", 500), approval: cell(raw, "approval", 200),
        deal: cell(raw, "deal", 500), terms: cell(raw, "terms", 500), contactName: cell(raw, "contactName", 180), phone: cell(raw, "phone", 80), email: cell(raw, "email", 320),
        locality: cell(raw, "locality", 160), notes: cell(raw, "notes", 2000), entityId };
    }).filter((row) => row.name);
  }
}

export type SupplierState = Awaited<ReturnType<SuppliersService["list"]>>;
export type { Supplier };

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} is not valid.`);
  return value;
}

function text(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BadRequestException(`${label} is not valid.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BadRequestException(`${label} is too long (up to ${max} characters).`);
  return trimmed;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) throw new BadRequestException(`${label} is not valid.`);
  return value as T;
}

