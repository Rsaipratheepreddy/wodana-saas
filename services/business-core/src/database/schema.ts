import {
  AnyPgColumn,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const workspaceStatus = pgEnum("workspace_status", ["active", "suspended", "archived"]);
export const onboardingStatus = pgEnum("onboarding_status", [
  "not_started",
  "in_progress",
  "completed",
]);
export const userStatus = pgEnum("user_status", ["active", "suspended"]);
export const membershipStatus = pgEnum("membership_status", [
  "invited",
  "active",
  "suspended",
]);
export const entityStatus = pgEnum("entity_status", ["active", "archived"]);
export const unitSystem = pgEnum("unit_system", ["metric", "imperial", "mixed"]);
export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "cancelled",
  "expired",
]);
export const integrationStatus = pgEnum("integration_status", [
  "draft",
  "pending",
  "connected",
  "degraded",
  "revoked",
]);
export const syncDirection = pgEnum("sync_direction", [
  "inbound",
  "outbound",
  "bidirectional",
]);
export const processingStatus = pgEnum("processing_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "dead_letter",
]);
export const outboxStatus = pgEnum("outbox_status", [
  "pending",
  "published",
  "failed",
]);
export const brandAssetStatus = pgEnum("brand_asset_status", [
  "pending",
  "active",
  "replaced",
  "failed",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    primaryEmail: citext("primary_email").notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    preferredLocale: varchar("preferred_locale", { length: 35 }).notNull().default("en"),
    preferredTimezone: varchar("preferred_timezone", { length: 64 }).notNull().default("UTC"),
    status: userStatus("status").notNull().default("active"),
    ...auditColumns,
  },
  (table) => [uniqueIndex("users_primary_email_uidx").on(table.primaryEmail)],
);

export const platformAdministrators = pgTable(
  "platform_administrators",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 40 }).notNull().default("administrator"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("platform_administrators_role_check", sql`${table.role} IN ('administrator')`),
    check("platform_administrators_status_check", sql`${table.status} IN ('active', 'suspended')`),
  ],
);

export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerSubject: varchar("provider_subject", { length: 255 }).notNull(),
    emailAtProvider: citext("email_at_provider").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("user_identities_provider_subject_uidx").on(
      table.provider,
      table.providerSubject,
    ),
    index("user_identities_user_idx").on(table.userId),
  ],
);

export const localAuthCredentials = pgTable(
  "local_auth_credentials",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    passwordHash: varchar("password_hash", { length: 128 }).notNull(),
    passwordSalt: varchar("password_salt", { length: 64 }).notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...auditColumns,
  },
);

export const authRefreshSessions = pgTable(
  "auth_refresh_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBySessionId: uuid("replaced_by_session_id").references(
      (): AnyPgColumn => authRefreshSessions.id,
      { onDelete: "set null" },
    ),
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_refresh_sessions_token_uidx").on(table.tokenHash),
    index("auth_refresh_sessions_user_idx").on(table.userId),
    index("auth_refresh_sessions_family_idx").on(table.familyId),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_token_uidx").on(table.tokenHash),
    index("password_reset_tokens_user_idx").on(table.userId),
  ],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    status: workspaceStatus("status").notNull().default("active"),
    defaultCurrency: char("default_currency", { length: 3 }).notNull(),
    defaultLocale: varchar("default_locale", { length: 35 }).notNull().default("en"),
    defaultTimezone: varchar("default_timezone", { length: 64 }).notNull().default("UTC"),
    unitSystem: unitSystem("unit_system").notNull().default("metric"),
    weekStartsOn: smallint("week_starts_on").notNull().default(1),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [uniqueIndex("workspaces_slug_uidx").on(table.slug)],
);

export const customerAccounts = pgTable(
  "customer_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalCustomerId: varchar("external_customer_id", { length: 160 }),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    organizationLimit: integer("organization_limit").notNull().default(1),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("customer_accounts_external_customer_uidx")
      .on(table.externalCustomerId)
      .where(sql`${table.externalCustomerId} IS NOT NULL`),
    check("customer_accounts_status_check", sql`${table.status} IN ('active', 'suspended', 'archived')`),
    check("customer_accounts_organization_limit_check", sql`${table.organizationLimit} > 0`),
    check("customer_accounts_version_check", sql`${table.version} > 0`),
  ],
);

export const customerAccountMemberships = pgTable(
  "customer_account_memberships",
  {
    accountId: uuid("account_id").notNull().references(() => customerAccounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 30 }).notNull().default("member"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => [
    primaryKey({ name: "customer_account_memberships_pk", columns: [table.accountId, table.userId] }),
    index("customer_account_memberships_user_idx").on(table.userId, table.status),
    check("customer_account_memberships_role_check", sql`${table.role} IN ('owner', 'administrator', 'member')`),
    check("customer_account_memberships_status_check", sql`${table.status} IN ('active', 'suspended')`),
  ],
);

export const customerAccountOrganizations = pgTable(
  "customer_account_organizations",
  {
    accountId: uuid("account_id").notNull().references(() => customerAccounts.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "customer_account_organizations_pk", columns: [table.accountId, table.workspaceId] }),
    uniqueIndex("customer_account_organizations_workspace_uidx").on(table.workspaceId),
    uniqueIndex("customer_account_default_organization_uidx")
      .on(table.accountId)
      .where(sql`${table.isDefault} = true`),
  ],
);

export const organizationRequests = pgTable(
  "organization_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => customerAccounts.id, { onDelete: "cascade" }),
    sourceWorkspaceId: uuid("source_workspace_id").notNull().references(() => workspaces.id),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull(),
    reason: varchar("reason", { length: 500 }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    decisionReason: varchar("decision_reason", { length: 500 }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    approvedWorkspaceId: uuid("approved_workspace_id").references(() => workspaces.id),
    version: integer("version").notNull().default(1),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("organization_requests_account_idempotency_uidx").on(table.accountId, table.idempotencyKey),
    uniqueIndex("organization_requests_pending_slug_uidx")
      .on(table.accountId, sql`lower(${table.slug})`)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("organization_requests_approved_workspace_uidx")
      .on(table.approvedWorkspaceId)
      .where(sql`${table.approvedWorkspaceId} IS NOT NULL`),
    index("organization_requests_review_queue_idx").on(table.status, table.createdAt),
    check("organization_requests_status_check", sql`${table.status} IN ('pending', 'approved', 'rejected', 'cancelled')`),
    check("organization_requests_slug_check", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check("organization_requests_configuration_check", sql`jsonb_typeof(${table.configuration}) = 'object'`),
    check("organization_requests_version_check", sql`${table.version} > 0`),
  ],
);

export const workspaceTerminology = pgTable(
  "workspace_terminology",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 64 }).notNull(),
    visibleName: varchar("visible_name", { length: 60 }).notNull(),
    visibleNamePlural: varchar("visible_name_plural", { length: 60 }).notNull(),
    version: integer("version").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...auditColumns,
  },
  (table) => [
    primaryKey({ name: "workspace_terminology_pk", columns: [table.workspaceId, table.key] }),
    check("workspace_terminology_key_check", sql`${table.key} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check(
      "workspace_terminology_visible_name_check",
      sql`length(btrim(${table.visibleName})) BETWEEN 1 AND 60 AND length(btrim(${table.visibleNamePlural})) BETWEEN 1 AND 60`,
    ),
    check("workspace_terminology_version_check", sql`${table.version} > 0`),
    index("workspace_terminology_updated_idx").on(table.workspaceId, table.updatedAt),
  ],
);

export const workspaceSubscriptions = pgTable(
  "workspace_subscriptions",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    planCode: varchar("plan_code", { length: 30 }).notNull().default("starter"),
    status: varchar("status", { length: 30 }).notNull().default("trial"),
    billingCycle: varchar("billing_cycle", { length: 20 }).notNull().default("monthly"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
    currency: char("currency", { length: 3 }).notNull(),
    seatLimit: integer("seat_limit").notNull().default(5),
    projectLimit: integer("project_limit").notNull().default(25),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    renewsAt: timestamp("renews_at", { withTimezone: true }),
    note: text("note"),
    version: integer("version").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("workspace_subscriptions_plan_check", sql`${table.planCode} IN ('starter', 'pro', 'enterprise')`),
    check("workspace_subscriptions_status_check", sql`${table.status} IN ('trial', 'active', 'past_due', 'cancelled')`),
    check("workspace_subscriptions_cycle_check", sql`${table.billingCycle} IN ('monthly', 'yearly', 'custom')`),
    check("workspace_subscriptions_amount_check", sql`${table.amount} >= 0`),
    check("workspace_subscriptions_limits_check", sql`${table.seatLimit} > 0 AND ${table.projectLimit} > 0`),
  ],
);

export const tenantLoginBranding = pgTable(
  "tenant_login_branding",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    loginSlug: varchar("login_slug", { length: 80 }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    logoUrl: text("logo_url"),
    logoAssetId: uuid("logo_asset_id").references(() => workspaceBrandAssets.id, {
      onDelete: "set null",
    }),
    ...auditColumns,
  },
  (table) => [uniqueIndex("tenant_login_branding_slug_uidx").on(table.loginSlug)],
);

export const workspaceBrandAssets = pgTable(
  "workspace_brand_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 64 }).notNull(),
    expectedByteSize: integer("expected_byte_size").notNull(),
    byteSize: integer("byte_size"),
    width: integer("width"),
    height: integer("height"),
    variants: jsonb("variants").$type<Record<string, string>>().notNull().default({}),
    status: brandAssetStatus("status").notNull().default("pending"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true }).notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("workspace_brand_assets_object_key_uidx").on(table.objectKey),
    index("workspace_brand_assets_workspace_status_idx").on(table.workspaceId, table.status),
    check(
      "workspace_brand_assets_expected_size_check",
      sql`${table.expectedByteSize} > 0 AND ${table.expectedByteSize} <= 5242880`,
    ),
  ],
);

export const workspaceOnboarding = pgTable(
  "workspace_onboarding",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    status: onboardingStatus("status").notNull().default("not_started"),
    currentStep: varchar("current_step", { length: 64 }).notNull().default("workspace_profile"),
    completedSteps: jsonb("completed_steps").$type<string[]>().notNull().default([]),
    version: integer("version").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    check(
      "workspace_onboarding_step_check",
      sql`${table.currentStep} IN ('workspace_profile', 'organization', 'team', 'integrations', 'complete')`,
    ),
    check(
      "workspace_onboarding_completed_steps_array_check",
      sql`jsonb_typeof(${table.completedSteps}) = 'array'`,
    ),
  ],
);

export const tenantProvisioningRequests = pgTable(
  "tenant_provisioning_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalTenantId: varchar("external_tenant_id", { length: 160 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tenant_provisioning_external_tenant_uidx").on(table.externalTenantId),
    uniqueIndex("tenant_provisioning_idempotency_key_uidx").on(table.idempotencyKey),
    uniqueIndex("tenant_provisioning_workspace_uidx").on(table.workspaceId),
  ],
);

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: membershipStatus("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("workspace_memberships_workspace_user_uidx").on(
      table.workspaceId,
      table.userId,
    ),
    index("workspace_memberships_user_idx").on(table.userId),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    version: integer("version").notNull().default(1),
    ...auditColumns,
  },
  (table) => [uniqueIndex("roles_workspace_code_uidx").on(table.workspaceId, table.code)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 120 }).notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("permissions_code_uidx").on(table.code)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const memberRoles = pgTable(
  "member_roles",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => workspaceMemberships.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.membershipId, table.roleId] })],
);

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: citext("email").notNull(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    status: invitationStatus("status").notNull().default("pending"),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("workspace_invitations_token_uidx").on(table.tokenHash),
    index("workspace_invitations_workspace_email_idx").on(table.workspaceId, table.email),
  ],
);

export const invitationRoles = pgTable(
  "invitation_roles",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => workspaceInvitations.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.invitationId, table.roleId] })],
);

export const legalEntities = pgTable(
  "legal_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 24 }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    registeredName: varchar("registered_name", { length: 200 }).notNull(),
    countryCode: char("country_code", { length: 2 }).notNull(),
    baseCurrency: char("base_currency", { length: 3 }).notNull(),
    locale: varchar("locale", { length: 35 }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    taxRegistrationNumber: varchar("tax_registration_number", { length: 100 }),
    registrationNumber: varchar("registration_number", { length: 100 }),
    address: jsonb("address").$type<Record<string, unknown>>().notNull().default({}),
    status: entityStatus("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("legal_entities_workspace_code_uidx").on(table.workspaceId, table.code),
    index("legal_entities_workspace_idx").on(table.workspaceId),
  ],
);

export const businessUnits = pgTable(
  "business_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id, { onDelete: "cascade" }),
    parentBusinessUnitId: uuid("parent_business_unit_id").references(
      (): AnyPgColumn => businessUnits.id,
      { onDelete: "set null" },
    ),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    type: varchar("type", { length: 40 }).notNull().default("studio"),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    color: varchar("color", { length: 7 }).notNull().default("#64748B"),
    status: entityStatus("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("business_units_workspace_code_uidx").on(table.workspaceId, table.code),
    index("business_units_legal_entity_idx").on(table.legalEntityId),
  ],
);

export const workspaceTeams = pgTable(
  "workspace_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessUnitId: uuid("business_unit_id")
      .notNull()
      .references(() => businessUnits.id, { onDelete: "restrict" }),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: varchar("description", { length: 500 }),
    status: entityStatus("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("workspace_teams_workspace_code_uidx").on(table.workspaceId, table.code),
    index("workspace_teams_business_unit_idx").on(table.businessUnitId),
  ],
);

export const workspaceTeamMembers = pgTable(
  "workspace_team_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => workspaceTeams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => workspaceMemberships.id, { onDelete: "cascade" }),
    isLead: boolean("is_lead").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.membershipId] }),
    index("workspace_team_members_membership_idx").on(table.membershipId),
    uniqueIndex("workspace_team_single_lead_uidx").on(table.teamId).where(sql`${table.isLead} = true`),
  ],
);

export const currencies = pgTable("currencies", {
  code: char("code", { length: 3 }).primaryKey(),
  numericCode: char("numeric_code", { length: 3 }),
  name: varchar("name", { length: 120 }).notNull(),
  minorUnit: smallint("minor_unit").notNull(),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    baseCurrency: char("base_currency", { length: 3 }).notNull(),
    quoteCurrency: char("quote_currency", { length: 3 }).notNull(),
    rate: numeric("rate", { precision: 24, scale: 12 }).notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    source: varchar("source", { length: 80 }).notNull(),
    isManual: boolean("is_manual").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("exchange_rates_natural_uidx").on(
      table.workspaceId,
      table.baseCurrency,
      table.quoteCurrency,
      table.effectiveAt,
      table.source,
    ),
  ],
);

export const taxProfiles = pgTable(
  "tax_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    jurisdictionCode: varchar("jurisdiction_code", { length: 32 }).notNull(),
    scheme: varchar("scheme", { length: 40 }).notNull(),
    registrationNumber: varchar("registration_number", { length: 100 }),
    pricesIncludeTax: boolean("prices_include_tax").notNull().default(false),
    roundingMode: varchar("rounding_mode", { length: 40 }).notNull().default("half_up"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    status: entityStatus("status").notNull().default("active"),
    ...auditColumns,
  },
  (table) => [index("tax_profiles_legal_entity_idx").on(table.legalEntityId)],
);

export const documentSequences = pgTable(
  "document_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id, { onDelete: "cascade" }),
    documentType: varchar("document_type", { length: 64 }).notNull(),
    prefix: varchar("prefix", { length: 40 }).notNull(),
    nextNumber: integer("next_number").notNull().default(1),
    padding: smallint("padding").notNull().default(5),
    resetPolicy: varchar("reset_policy", { length: 20 }).notNull().default("annual"),
    version: integer("version").notNull().default(1),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("document_sequences_entity_type_uidx").on(
      table.legalEntityId,
      table.documentType,
    ),
  ],
);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id, {
      onDelete: "set null",
    }),
    provider: varchar("provider", { length: 50 }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    externalAccountId: varchar("external_account_id", { length: 255 }),
    externalDomain: varchar("external_domain", { length: 255 }),
    status: integrationStatus("status").notNull().default("draft"),
    grantedScopes: jsonb("granted_scopes").$type<string[]>().notNull().default([]),
    secretReference: varchar("secret_reference", { length: 500 }),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    connectedBy: uuid("connected_by").references(() => users.id),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...auditColumns,
  },
  (table) => [
    index("integration_connections_workspace_provider_idx").on(
      table.workspaceId,
      table.provider,
    ),
    uniqueIndex("integration_connections_active_domain_uidx")
      .on(table.workspaceId, table.provider, table.legalEntityId, table.externalDomain)
      .where(sql`${table.externalDomain} IS NOT NULL AND ${table.status} <> 'revoked'`),
  ],
);

export const integrationResources = pgTable(
  "integration_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    resourceType: varchar("resource_type", { length: 50 }).notNull(),
    externalId: varchar("external_id", { length: 500 }).notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    direction: syncDirection("direction").notNull().default("inbound"),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("integration_resources_connection_external_uidx").on(
      table.connectionId,
      table.resourceType,
      table.externalId,
    ),
  ],
);

export const syncCursors = pgTable(
  "sync_cursors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").references(() => integrationResources.id, {
      onDelete: "cascade",
    }),
    cursorType: varchar("cursor_type", { length: 50 }).notNull(),
    cursorValue: text("cursor_value").notNull(),
    channelId: varchar("channel_id", { length: 255 }),
    channelExpiresAt: timestamp("channel_expires_at", { withTimezone: true }),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [index("sync_cursors_connection_idx").on(table.connectionId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    source: varchar("source", { length: 30 }).notNull(),
    action: varchar("action", { length: 120 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    correlationId: uuid("correlation_id").notNull(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_workspace_occurred_idx").on(table.workspaceId, table.occurredAt),
    index("audit_events_entity_idx").on(table.workspaceId, table.entityType, table.entityId),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    key: varchar("key", { length: 160 }).notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("idempotency_keys_workspace_key_uidx").on(table.workspaceId, table.key)],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("outbox_events_pending_idx").on(table.status, table.availableAt)],
);

export const webhookInbox = pgTable(
  "webhook_inbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references(() => integrationConnections.id, {
      onDelete: "set null",
    }),
    provider: varchar("provider", { length: 50 }).notNull(),
    externalEventId: varchar("external_event_id", { length: 255 }).notNull(),
    payloadHash: char("payload_hash", { length: 64 }).notNull(),
    signatureVerified: boolean("signature_verified").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: processingStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("webhook_inbox_provider_event_uidx").on(
      table.workspaceId,
      table.provider,
      table.externalEventId,
    ),
    index("webhook_inbox_pending_idx").on(table.status, table.receivedAt),
  ],
);

export type Workspace = typeof workspaces.$inferSelect;
export type LegalEntity = typeof legalEntities.$inferSelect;
export type IntegrationConnection = typeof integrationConnections.$inferSelect;
