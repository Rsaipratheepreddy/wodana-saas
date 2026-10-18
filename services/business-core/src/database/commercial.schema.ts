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
  // What clients see (migration 0080). The brand itself is the tenant branding record.
  showProgress: boolean("show_progress").notNull().default(true),
  showDecisions: boolean("show_decisions").notNull().default(true),
  showPayments: boolean("show_payments").notNull().default(true),
  showDocuments: boolean("show_documents").notNull().default(true),
  showWarranty: boolean("show_warranty").notNull().default(true),
  showMessages: boolean("show_messages").notNull().default(true),
  progressStageNames: boolean("progress_stage_names").notNull().default(true),
  progressDates: boolean("progress_dates").notNull().default(true),
  progressUpdates: boolean("progress_updates").notNull().default(true),
  progressPhotos: boolean("progress_photos").notNull().default(true),
  showInvoiceAmounts: boolean("show_invoice_amounts").notNull().default(true),
  welcomeTitle: varchar("welcome_title", { length: 120 }).notNull().default(""),
  welcomeText: varchar("welcome_text", { length: 500 }).notNull().default(""),
  supportPhone: varchar("support_phone", { length: 20 }).notNull().default(""),
  supportEmail: varchar("support_email", { length: 254 }).notNull().default(""),
  supportWhatsapp: varchar("support_whatsapp", { length: 20 }).notNull().default(""),
  catalogueUrl: varchar("catalogue_url", { length: 500 }).notNull().default(""),
  updatedBy: uuid("updated_by"),
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
    email: varchar("email", { length: 254 }),
    confirmedName: varchar("confirmed_name", { length: 160 }),
    nameConfirmedAt: timestamp("name_confirmed_at", { withTimezone: true }),
    lastSignedInAt: timestamp("last_signed_in_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    channel: varchar("channel", { length: 10 }).notNull().default("whatsapp"),
    requester: varchar("requester", { length: 64 }),
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
  revokedReason: varchar("revoked_reason", { length: 40 }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: created(),
});
export const clientPortalProjectAccess = pgTable("client_portal_project_access", {
  workspaceId: uuid("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  sections: text("sections").array(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  pausedBy: uuid("paused_by"),
  version: integer("version").notNull().default(1),
  updatedBy: uuid("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const clientPortalCommands = pgTable("client_portal_commands", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  id: uuid("id").notNull(),
  grantId: uuid("grant_id"),
  action: varchar("action", { length: 40 }).notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  result: jsonb("result").notNull().default({}),
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
