import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { preProjectCases } from "./pre-project.schema";
import { workspaces } from "./schema";
const scope = () => ({
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  caseId: uuid("case_id").notNull(),
});
const created = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const commercialCases = pgTable(
  "commercial_cases",
  {
    ...scope(),
    caseId: uuid("case_id").primaryKey(),
    revision: integer("revision").notNull().default(0),
    content: jsonb("content").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.caseId],
      foreignColumns: [preProjectCases.workspaceId, preProjectCases.id],
    }),
  ],
);
export const commercialPaymentTemplates = pgTable(
  "commercial_payment_templates",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: varchar("name", { length: 160 }).notNull(),
    version: integer("version").notNull().default(1),
    milestones: jsonb("milestones").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.workspaceId, t.name),
    check("commercial_payment_templates_status_check", sql`${t.status} IN ('active','archived')`),
  ],
);
export const clientPortalSettings = pgTable("client_portal_settings", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  version: integer("version").notNull().default(1),
  brand: jsonb("brand").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const clientPortalGrants = pgTable(
  "client_portal_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...scope(),
    name: varchar("name", { length: 160 }).notNull(),
    phone: varchar("phone", { length: 16 }).notNull(),
    role: varchar("role", { length: 16 }).notNull(),
    active: boolean("active").notNull().default(true),
    testContact: boolean("test_contact").notNull().default(false),
    createdAt: created(),
  },
  (t) => [
    unique().on(t.workspaceId, t.caseId, t.phone),
    check(
      "client_portal_grants_role_check",
      sql`${t.role} IN ('viewer','approver')`,
    ),
    foreignKey({
      columns: [t.workspaceId, t.caseId],
      foreignColumns: [preProjectCases.workspaceId, preProjectCases.id],
    }),
  ],
);
export const clientPortalChallenges = pgTable(
  "client_portal_challenges",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    phone: varchar("phone", { length: 16 }).notNull(),
    purpose: varchar("purpose", { length: 200 }).notNull(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    index("client_portal_challenge_rate_idx").on(
      t.workspaceId,
      t.phone,
      t.createdAt.desc(),
    ),
  ],
);
export const clientPortalSessions = pgTable("client_portal_sessions", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  phone: varchar("phone", { length: 16 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: created(),
});

export const commercialQuotationTemplates = pgTable("commercial_quotation_templates", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  name: varchar("name", { length: 160 }).notNull(),
  version: integer("version").notNull().default(1),
  content: jsonb("content").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.workspaceId, t.name),
  check("commercial_quotation_templates_status_check", sql`${t.status} IN ('active','archived')`),
]);
