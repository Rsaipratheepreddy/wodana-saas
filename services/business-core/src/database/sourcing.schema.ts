import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users, workspaces } from "./schema";

export const workspaceVendors = pgTable(
  "workspace_vendors",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    id: uuid("id").notNull(),
    code: varchar("code", { length: 80 }).notNull(),
    displayName: varchar("display_name", { length: 240 }).notNull(),
    legalName: varchar("legal_name", { length: 240 }),
    capabilities: varchar("capabilities", { length: 24 }).array().notNull().default(sql`'{}'::varchar[]`),
    registrationNumber: varchar("registration_number", { length: 120 }),
    taxRegistrationNumber: varchar("tax_registration_number", { length: 120 }),
    defaultCurrency: char("default_currency", { length: 3 }),
    website: varchar("website", { length: 500 }),
    notes: text("notes").notNull().default(""),
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    archivedReason: varchar("archived_reason", { length: 500 }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "workspace_vendors_pk", columns: [table.workspaceId, table.id] }),
    uniqueIndex("workspace_vendors_code_uidx").on(table.workspaceId, sql`lower(${table.code})`),
    uniqueIndex("workspace_vendors_registration_uidx")
      .on(table.workspaceId, sql`lower(btrim(${table.registrationNumber}))`)
      .where(sql`${table.registrationNumber} IS NOT NULL`),
    uniqueIndex("workspace_vendors_tax_registration_uidx")
      .on(table.workspaceId, sql`lower(btrim(${table.taxRegistrationNumber}))`)
      .where(sql`${table.taxRegistrationNumber} IS NOT NULL`),
    index("workspace_vendors_name_idx").on(table.workspaceId, sql`lower(${table.displayName})`, table.id),
    index("workspace_vendors_status_idx").on(table.workspaceId, table.status, table.updatedAt),
    check("workspace_vendors_code_check", sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,79}$'`),
    check("workspace_vendors_name_check", sql`length(btrim(${table.displayName})) BETWEEN 1 AND 240`),
    check("workspace_vendors_status_check", sql`${table.status} IN ('draft','active','archived')`),
    check(
      "workspace_vendors_capabilities_check",
      sql`${table.capabilities} <@ ARRAY['materials','services','subcontracting','manufacturing','logistics','other']::varchar[]`,
    ),
    check("workspace_vendors_active_capability_check", sql`${table.status} <> 'active' OR cardinality(${table.capabilities}) > 0`),
    check("workspace_vendors_currency_check", sql`${table.defaultCurrency} IS NULL OR ${table.defaultCurrency} ~ '^[A-Z]{3}$'`),
    check(
      "workspace_vendors_archive_check",
      sql`(${table.status} = 'archived' AND ${table.archivedReason} IS NOT NULL AND ${table.archivedAt} IS NOT NULL AND ${table.archivedBy} IS NOT NULL) OR (${table.status} <> 'archived' AND ${table.archivedReason} IS NULL AND ${table.archivedAt} IS NULL AND ${table.archivedBy} IS NULL)`,
    ),
    check("workspace_vendors_version_check", sql`${table.version} > 0`),
  ],
);

export const workspaceVendorSites = pgTable(
  "workspace_vendor_sites",
  {
    workspaceId: uuid("workspace_id").notNull(),
    vendorId: uuid("vendor_id").notNull(),
    id: uuid("id").notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    siteType: varchar("site_type", { length: 20 }).notNull(),
    contactName: varchar("contact_name", { length: 180 }),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 80 }),
    addressLine1: varchar("address_line1", { length: 240 }),
    addressLine2: varchar("address_line2", { length: 240 }),
    locality: varchar("locality", { length: 160 }),
    region: varchar("region", { length: 160 }),
    postalCode: varchar("postal_code", { length: 40 }),
    countryCode: char("country_code", { length: 2 }),
    isPrimary: boolean("is_primary").notNull().default(false),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    archivedReason: varchar("archived_reason", { length: 500 }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: uuid("archived_by").references(() => users.id),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "workspace_vendor_sites_pk", columns: [table.workspaceId, table.id] }),
    foreignKey({
      name: "workspace_vendor_sites_vendor_fk",
      columns: [table.workspaceId, table.vendorId],
      foreignColumns: [workspaceVendors.workspaceId, workspaceVendors.id],
    }).onDelete("cascade"),
    uniqueIndex("workspace_vendor_sites_primary_uidx")
      .on(table.workspaceId, table.vendorId)
      .where(sql`${table.status} = 'active' AND ${table.isPrimary}`),
    index("workspace_vendor_sites_vendor_idx").on(table.workspaceId, table.vendorId, table.status, table.name),
    check("workspace_vendor_sites_name_check", sql`length(btrim(${table.name})) BETWEEN 1 AND 180`),
    check("workspace_vendor_sites_type_check", sql`${table.siteType} IN ('branch','store','office','warehouse','factory','other')`),
    check("workspace_vendor_sites_status_check", sql`${table.status} IN ('active','archived')`),
    check("workspace_vendor_sites_country_check", sql`${table.countryCode} IS NULL OR ${table.countryCode} ~ '^[A-Z]{2}$'`),
    check(
      "workspace_vendor_sites_archive_check",
      sql`(${table.status} = 'archived' AND NOT ${table.isPrimary} AND ${table.archivedReason} IS NOT NULL AND ${table.archivedAt} IS NOT NULL AND ${table.archivedBy} IS NOT NULL) OR (${table.status} = 'active' AND ${table.archivedReason} IS NULL AND ${table.archivedAt} IS NULL AND ${table.archivedBy} IS NULL)`,
    ),
    check("workspace_vendor_sites_version_check", sql`${table.version} > 0`),
  ],
);
