import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  CreateVendorDto,
  CreateVendorSiteDto,
  ListVendorsQueryDto,
  UpdateVendorDto,
  UpdateVendorSiteDto,
  VendorLifecycleDto,
  VendorSiteLifecycleDto,
} from "./vendor.dto";

type VendorRow = {
  id: string;
  code: string;
  displayName: string;
  legalName: string | null;
  capabilities: string[];
  registrationNumber: string | null;
  taxRegistrationNumber: string | null;
  defaultCurrency: string | null;
  website: string | null;
  notes: string;
  status: "draft" | "active" | "archived";
  archivedReason: string | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type SiteRow = {
  id: string;
  vendorId: string;
  name: string;
  siteType: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  isPrimary: boolean;
  status: "active" | "archived";
  archivedReason: string | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

const vendorSelect = `SELECT id,code,display_name AS "displayName",legal_name AS "legalName",capabilities,
  registration_number AS "registrationNumber",tax_registration_number AS "taxRegistrationNumber",
  default_currency AS "defaultCurrency",website,notes,status,archived_reason AS "archivedReason",
  archived_at AS "archivedAt",version,created_at AS "createdAt",updated_at AS "updatedAt"
  FROM workspace_vendors WHERE workspace_id=$1`;
const siteSelect = `SELECT id,vendor_id AS "vendorId",name,site_type AS "siteType",contact_name AS "contactName",
  email,phone,address_line1 AS "addressLine1",address_line2 AS "addressLine2",locality,region,
  postal_code AS "postalCode",country_code AS "countryCode",is_primary AS "isPrimary",status,
  archived_reason AS "archivedReason",archived_at AS "archivedAt",version,
  created_at AS "createdAt",updated_at AS "updatedAt"
  FROM workspace_vendor_sites WHERE workspace_id=$1`;

const nullable = (value: string | null | undefined) => value?.trim() || null;
const capabilities = (values: string[] | undefined) => [...new Set(values ?? [])].sort();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function throwVendorUniqueConflict(error: unknown): never {
  const constraint = (error as { constraint?: string }).constraint ?? "";
  if (constraint.includes("tax_registration"))
    throw new ConflictException("A vendor with this tax registration number already exists.");
  if (constraint.includes("registration"))
    throw new ConflictException("A vendor with this registration number already exists.");
  throw new ConflictException("A vendor with this code already exists.");
}

export function vendorCodeBase(name: string) {
  const code = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 72);
  return code || "VENDOR";
}

function encodeCursor(row: VendorRow) {
  return Buffer.from(JSON.stringify({ name: row.displayName.toLowerCase(), id: row.id })).toString("base64url");
}

function decodeCursor(value?: string): { name: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.name !== "string" || typeof parsed.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)) return null;
    return { name: parsed.name, id: parsed.id };
  } catch {
    return null;
  }
}

function vendorInput(input: CreateVendorDto | UpdateVendorDto) {
  return {
    displayName: input.displayName?.trim(),
    legalName: nullable(input.legalName),
    capabilities: input.capabilities === undefined ? undefined : capabilities(input.capabilities),
    registrationNumber: nullable(input.registrationNumber),
    taxRegistrationNumber: nullable(input.taxRegistrationNumber),
    defaultCurrency: input.defaultCurrency?.trim().toUpperCase() || null,
    website: nullable(input.website),
    notes: input.notes?.trim(),
  };
}

function siteInput(input: CreateVendorSiteDto | UpdateVendorSiteDto) {
  return {
    name: input.name?.trim(),
    siteType: input.siteType,
    contactName: nullable(input.contactName),
    email: input.email?.trim().toLowerCase() || null,
    phone: nullable(input.phone),
    addressLine1: nullable(input.addressLine1),
    addressLine2: nullable(input.addressLine2),
    locality: nullable(input.locality),
    region: nullable(input.region),
    postalCode: nullable(input.postalCode),
    countryCode: input.countryCode?.trim().toUpperCase() || null,
    isPrimary: input.isPrimary,
  };
}

@Injectable()
export class VendorDirectoryService {
  constructor(private readonly access: WorkspaceAccessService, private readonly events: CrmEventsService) {}

  list(actor: RequestActor, workspaceId: string, query: ListVendorsQueryDto) {
    return this.access.withPermission(actor, workspaceId, "vendors.view", async (client) => {
      const cursor = decodeCursor(query.cursor);
      if (query.cursor && !cursor) throw new BadRequestException("Invalid vendor page cursor.");
      const values: unknown[] = [workspaceId];
      const clauses = ["workspace_id=$1"];
      if (query.status) {
        values.push(query.status);
        clauses.push(`status=$${values.length}`);
      } else clauses.push("status<>'archived'");
      if (query.capability) {
        values.push(query.capability);
        clauses.push(`$${values.length}=ANY(capabilities)`);
      }
      if (query.search) {
        values.push(query.search.trim().toLowerCase());
        clauses.push(`strpos(lower(display_name||' '||code||' '||coalesce(legal_name,'')||' '||coalesce(registration_number,'')||' '||coalesce(tax_registration_number,'')),$${values.length})>0`);
      }
      if (cursor) {
        values.push(cursor.name, cursor.id);
        clauses.push(`(lower(display_name),id)>($${values.length - 1},$${values.length}::uuid)`);
      }
      values.push(query.limit + 1);
      const rows = (await client.query<VendorRow>(
        `${vendorSelect.replace("WHERE workspace_id=$1", `WHERE ${clauses.join(" AND ")}`)} ORDER BY lower(display_name),id LIMIT $${values.length}`,
        values,
      )).rows;
      const more = rows.length > query.limit;
      const data = more ? rows.slice(0, query.limit) : rows;
      return { data, nextCursor: more ? encodeCursor(data[data.length - 1]!) : null };
    });
  }

  get(actor: RequestActor, workspaceId: string, vendorId: string) {
    return this.access.withPermission(actor, workspaceId, "vendors.view", (client) =>
      this.aggregate(client, workspaceId, vendorId));
  }

  create(actor: RequestActor, workspaceId: string, input: CreateVendorDto) {
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      await this.lock(client, workspaceId);
      const normalized = vendorInput(input);
      const existing = (await client.query<VendorRow>(`${vendorSelect} AND id=$2`, [workspaceId, input.id])).rows[0];
      if (existing) {
        const matches = (!input.code || existing.code === input.code) && same(
          {
            displayName: existing.displayName, legalName: existing.legalName,
            capabilities: existing.capabilities, registrationNumber: existing.registrationNumber,
            taxRegistrationNumber: existing.taxRegistrationNumber, defaultCurrency: existing.defaultCurrency,
            website: existing.website, notes: existing.notes, status: existing.status,
          },
          { ...normalized, capabilities: normalized.capabilities ?? [], notes: normalized.notes ?? "", status: "draft" },
        );
        if (!matches) throw new ConflictException("This vendor identifier is already in use.");
        return this.aggregate(client, workspaceId, input.id);
      }
      const code = input.code ?? await this.nextCode(client, workspaceId, input.displayName);
      try {
        await client.query(
          `INSERT INTO workspace_vendors(workspace_id,id,code,display_name,legal_name,capabilities,
            registration_number,tax_registration_number,default_currency,website,notes,created_by,updated_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
          [workspaceId, input.id, code, normalized.displayName, normalized.legalName, normalized.capabilities ?? [],
            normalized.registrationNumber, normalized.taxRegistrationNumber, normalized.defaultCurrency,
            normalized.website, normalized.notes ?? "", user.userId],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throwVendorUniqueConflict(error);
        throw error;
      }
      const after = await this.aggregate(client, workspaceId, input.id);
      await this.record(client, workspaceId, user.userId, "vendor.created.v1", input.id, null, after);
      return after;
    });
  }

  update(actor: RequestActor, workspaceId: string, vendorId: string, input: UpdateVendorDto) {
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      const before = await this.vendor(client, workspaceId, vendorId, true);
      if (before.status === "archived") throw new ConflictException("Restore this vendor before editing it.");
      if (before.version !== input.version) throw new ConflictException("This vendor changed. Reload it and try again.");
      const patch = vendorInput(input);
      const next = {
        displayName: patch.displayName ?? before.displayName,
        legalName: input.legalName === undefined ? before.legalName : patch.legalName,
        capabilities: patch.capabilities ?? before.capabilities,
        registrationNumber: input.registrationNumber === undefined ? before.registrationNumber : patch.registrationNumber,
        taxRegistrationNumber: input.taxRegistrationNumber === undefined ? before.taxRegistrationNumber : patch.taxRegistrationNumber,
        defaultCurrency: input.defaultCurrency === undefined ? before.defaultCurrency : patch.defaultCurrency,
        website: input.website === undefined ? before.website : patch.website,
        notes: patch.notes ?? before.notes,
      };
      if (before.status === "active" && !next.capabilities.length)
        throw new BadRequestException("An active vendor needs at least one capability.");
      const comparable = ({ displayName, legalName, capabilities, registrationNumber, taxRegistrationNumber, defaultCurrency, website, notes }: typeof next) =>
        ({ displayName, legalName, capabilities, registrationNumber, taxRegistrationNumber, defaultCurrency, website, notes });
      if (same(comparable(next), comparable(before))) return this.aggregate(client, workspaceId, vendorId);
      try {
        await client.query(
          `UPDATE workspace_vendors SET display_name=$3,legal_name=$4,capabilities=$5,registration_number=$6,
            tax_registration_number=$7,default_currency=$8,website=$9,notes=$10,version=version+1,
            updated_by=$11,updated_at=now() WHERE workspace_id=$1 AND id=$2`,
          [workspaceId, vendorId, next.displayName, next.legalName, next.capabilities, next.registrationNumber,
            next.taxRegistrationNumber, next.defaultCurrency, next.website, next.notes, user.userId],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throwVendorUniqueConflict(error);
        throw error;
      }
      const after = await this.aggregate(client, workspaceId, vendorId);
      await this.record(client, workspaceId, user.userId, "vendor.updated.v1", vendorId, before, after);
      return after;
    });
  }

  lifecycle(actor: RequestActor, workspaceId: string, vendorId: string, input: VendorLifecycleDto) {
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      const before = await this.vendor(client, workspaceId, vendorId, true);
      if (before.version !== input.version) throw new ConflictException("This vendor changed. Reload it and try again.");
      let event: string;
      if (input.action === "activate") {
        if (before.status !== "draft") throw new ConflictException("Only a draft vendor can be activated.");
        if (!before.capabilities.length) throw new BadRequestException("Choose at least one vendor capability before activation.");
        await client.query(`UPDATE workspace_vendors SET status='active',version=version+1,updated_by=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, vendorId, user.userId]);
        event = "vendor.activated.v1";
      } else if (input.action === "archive") {
        if (before.status === "archived") throw new ConflictException("This vendor is already archived.");
        const reason = input.reason?.trim();
        if (!reason) throw new BadRequestException("Explain why this vendor is being archived.");
        const activeOffers = await client.query(`SELECT 1 FROM workspace_supplier_offers WHERE workspace_id=$1 AND vendor_id=$2 AND status='active' LIMIT 1`, [workspaceId, vendorId]);
        if (activeOffers.rowCount) throw new ConflictException("Archive this vendor's active supplier offers first.");
        await client.query(`UPDATE workspace_vendors SET status='archived',archived_reason=$3,archived_at=now(),archived_by=$4,version=version+1,updated_by=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, vendorId, reason, user.userId]);
        event = "vendor.archived.v1";
      } else {
        if (before.status !== "archived") throw new ConflictException("Only an archived vendor can be restored.");
        const reason = input.reason?.trim();
        if (!reason) throw new BadRequestException("Explain why this vendor is being restored.");
        await client.query(`UPDATE workspace_vendors SET status='draft',archived_reason=NULL,archived_at=NULL,archived_by=NULL,version=version+1,updated_by=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2`, [workspaceId, vendorId, user.userId]);
        event = "vendor.restored.v1";
      }
      const after = await this.aggregate(client, workspaceId, vendorId);
      await this.record(client, workspaceId, user.userId, event, vendorId, before, { ...after, reason: input.reason?.trim() || null });
      return after;
    });
  }

  createSite(actor: RequestActor, workspaceId: string, vendorId: string, input: CreateVendorSiteDto) {
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      await this.lock(client, workspaceId);
      const vendor = await this.vendor(client, workspaceId, vendorId, true);
      if (vendor.status === "archived") throw new ConflictException("Restore this vendor before adding a location.");
      const normalized = { ...siteInput(input), isPrimary: input.isPrimary === true };
      const existing = (await client.query<SiteRow>(`${siteSelect} AND id=$2`, [workspaceId, input.id])).rows[0];
      if (existing) {
        if (existing.vendorId !== vendorId || existing.status !== "active" || !same(
          { name: existing.name, siteType: existing.siteType, contactName: existing.contactName, email: existing.email,
            phone: existing.phone, addressLine1: existing.addressLine1, addressLine2: existing.addressLine2,
            locality: existing.locality, region: existing.region, postalCode: existing.postalCode,
            countryCode: existing.countryCode, isPrimary: existing.isPrimary },
          normalized,
        )) throw new ConflictException("This vendor location identifier is already in use.");
        return this.aggregate(client, workspaceId, vendorId);
      }
      const before = await this.aggregate(client, workspaceId, vendorId);
      if (normalized.isPrimary) await this.clearPrimary(client, workspaceId, vendorId, input.id, user.userId);
      await client.query(
        `INSERT INTO workspace_vendor_sites(workspace_id,vendor_id,id,name,site_type,contact_name,email,phone,
          address_line1,address_line2,locality,region,postal_code,country_code,is_primary,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
        [workspaceId, vendorId, input.id, normalized.name, normalized.siteType, normalized.contactName,
          normalized.email, normalized.phone, normalized.addressLine1, normalized.addressLine2, normalized.locality,
          normalized.region, normalized.postalCode, normalized.countryCode, normalized.isPrimary ?? false, user.userId],
      );
      const after = await this.aggregate(client, workspaceId, vendorId);
      await this.record(client, workspaceId, user.userId, "vendor.site_created.v1", input.id, before, after);
      return after;
    });
  }

  updateSite(actor: RequestActor, workspaceId: string, vendorId: string, siteId: string, input: UpdateVendorSiteDto) {
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      await this.lock(client, workspaceId);
      const vendor = await this.vendor(client, workspaceId, vendorId, true);
      if (vendor.status === "archived") throw new ConflictException("Restore this vendor before editing a location.");
      const current = await this.site(client, workspaceId, vendorId, siteId, true);
      if (current.status === "archived") throw new ConflictException("Restore this vendor location before editing it.");
      if (current.version !== input.version) throw new ConflictException("This vendor location changed. Reload it and try again.");
      const patch = siteInput(input);
      const next = {
        name: patch.name ?? current.name,
        siteType: patch.siteType ?? current.siteType,
        contactName: input.contactName === undefined ? current.contactName : patch.contactName,
        email: input.email === undefined ? current.email : patch.email,
        phone: input.phone === undefined ? current.phone : patch.phone,
        addressLine1: input.addressLine1 === undefined ? current.addressLine1 : patch.addressLine1,
        addressLine2: input.addressLine2 === undefined ? current.addressLine2 : patch.addressLine2,
        locality: input.locality === undefined ? current.locality : patch.locality,
        region: input.region === undefined ? current.region : patch.region,
        postalCode: input.postalCode === undefined ? current.postalCode : patch.postalCode,
        countryCode: input.countryCode === undefined ? current.countryCode : patch.countryCode,
        isPrimary: patch.isPrimary ?? current.isPrimary,
      };
      const before = await this.aggregate(client, workspaceId, vendorId);
      if (same(next, {
        name: current.name, siteType: current.siteType, contactName: current.contactName, email: current.email,
        phone: current.phone, addressLine1: current.addressLine1, addressLine2: current.addressLine2,
        locality: current.locality, region: current.region, postalCode: current.postalCode,
        countryCode: current.countryCode, isPrimary: current.isPrimary,
      })) return before;
      if (next.isPrimary) await this.clearPrimary(client, workspaceId, vendorId, siteId, user.userId);
      await client.query(
        `UPDATE workspace_vendor_sites SET name=$4,site_type=$5,contact_name=$6,email=$7,phone=$8,
          address_line1=$9,address_line2=$10,locality=$11,region=$12,postal_code=$13,country_code=$14,
          is_primary=$15,version=version+1,updated_by=$16,updated_at=now()
         WHERE workspace_id=$1 AND vendor_id=$2 AND id=$3`,
        [workspaceId, vendorId, siteId, next.name, next.siteType, next.contactName, next.email, next.phone,
          next.addressLine1, next.addressLine2, next.locality, next.region, next.postalCode, next.countryCode,
          next.isPrimary, user.userId],
      );
      const after = await this.aggregate(client, workspaceId, vendorId);
      await this.record(client, workspaceId, user.userId, "vendor.site_updated.v1", siteId, before, after);
      return after;
    });
  }

  siteLifecycle(actor: RequestActor, workspaceId: string, vendorId: string, siteId: string, input: VendorSiteLifecycleDto) {
    return this.access.withPermission(actor, workspaceId, "vendors.manage", async (client, user) => {
      const reason = input.reason?.trim();
      if (!reason) throw new BadRequestException("Explain this vendor location change.");
      await this.lock(client, workspaceId);
      const vendor = await this.vendor(client, workspaceId, vendorId, true);
      if (vendor.status === "archived") throw new ConflictException("Restore this vendor before changing a location.");
      const current = await this.site(client, workspaceId, vendorId, siteId, true);
      if (current.version !== input.version) throw new ConflictException("This vendor location changed. Reload it and try again.");
      const before = await this.aggregate(client, workspaceId, vendorId);
      if (input.action === "archive") {
        if (current.status === "archived") throw new ConflictException("This vendor location is already archived.");
        const activeOffers = await client.query(`SELECT 1 FROM workspace_supplier_offers WHERE workspace_id=$1 AND vendor_id=$2 AND vendor_site_id=$3 AND status='active' LIMIT 1`, [workspaceId, vendorId, siteId]);
        if (activeOffers.rowCount) throw new ConflictException("Archive this location's active supplier offers first.");
        await client.query(`UPDATE workspace_vendor_sites SET status='archived',is_primary=false,archived_reason=$4,archived_at=now(),archived_by=$5,version=version+1,updated_by=$5,updated_at=now() WHERE workspace_id=$1 AND vendor_id=$2 AND id=$3`, [workspaceId, vendorId, siteId, reason, user.userId]);
      } else {
        if (current.status !== "archived") throw new ConflictException("Only an archived vendor location can be restored.");
        await client.query(`UPDATE workspace_vendor_sites SET status='active',is_primary=false,archived_reason=NULL,archived_at=NULL,archived_by=NULL,version=version+1,updated_by=$4,updated_at=now() WHERE workspace_id=$1 AND vendor_id=$2 AND id=$3`, [workspaceId, vendorId, siteId, user.userId]);
      }
      const after = await this.aggregate(client, workspaceId, vendorId);
      await this.record(client, workspaceId, user.userId,
        input.action === "archive" ? "vendor.site_archived.v1" : "vendor.site_restored.v1",
        siteId, before, { ...after, reason });
      return after;
    });
  }

  private async aggregate(client: PoolClient, workspaceId: string, vendorId: string) {
    const vendor = await this.vendor(client, workspaceId, vendorId);
    const sites = (await client.query<SiteRow>(`${siteSelect} AND vendor_id=$2 ORDER BY status='active' DESC,is_primary DESC,lower(name),id`, [workspaceId, vendorId])).rows;
    return { ...vendor, sites };
  }

  private async vendor(client: PoolClient, workspaceId: string, vendorId: string, lock = false) {
    const row = (await client.query<VendorRow>(`${vendorSelect} AND id=$2${lock ? " FOR UPDATE" : ""}`, [workspaceId, vendorId])).rows[0];
    if (!row) throw new NotFoundException("Vendor not found.");
    return row;
  }

  private async site(client: PoolClient, workspaceId: string, vendorId: string, siteId: string, lock = false) {
    const row = (await client.query<SiteRow>(`${siteSelect} AND vendor_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [workspaceId, vendorId, siteId])).rows[0];
    if (!row) throw new NotFoundException("Vendor location not found.");
    return row;
  }

  private async nextCode(client: PoolClient, workspaceId: string, name: string) {
    const base = vendorCodeBase(name);
    const rows = (await client.query<{ code: string }>(`SELECT code FROM workspace_vendors WHERE workspace_id=$1 AND (code=$2 OR code LIKE $2||'\\_%' ESCAPE '\\')`, [workspaceId, base])).rows;
    const used = new Set(rows.map((row) => row.code));
    if (!used.has(base)) return base;
    for (let suffix = 2; suffix < 100000; suffix += 1) {
      const code = `${base.slice(0, 79 - String(suffix).length)}_${suffix}`;
      if (!used.has(code)) return code;
    }
    throw new ConflictException("A unique vendor code could not be generated.");
  }

  private lock(client: PoolClient, workspaceId: string) {
    return client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`vendors:${workspaceId}`]);
  }

  private clearPrimary(client: PoolClient, workspaceId: string, vendorId: string, exceptId: string, userId: string) {
    return client.query(`UPDATE workspace_vendor_sites SET is_primary=false,version=version+1,updated_by=$4,updated_at=now() WHERE workspace_id=$1 AND vendor_id=$2 AND id<>$3 AND status='active' AND is_primary`, [workspaceId, vendorId, exceptId, userId]);
  }

  private record(client: PoolClient, workspaceId: string, actorUserId: string, action: string,
    entityId: string, before: unknown, after: unknown) {
    return this.events.record(client, { workspaceId, actorUserId, source: "user", action,
      entityType: action.startsWith("vendor.site_") ? "vendor_site" : "vendor", entityId,
      before: before === null ? null : before as Record<string, unknown>,
      after: after === null ? null : after as Record<string, unknown> });
  }
}
