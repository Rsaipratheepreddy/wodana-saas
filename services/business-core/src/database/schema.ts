import {
  AnyPgColumn,
  bigint,
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
    mfaSessionVersion: integer("mfa_session_version").notNull().default(0),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("users_primary_email_uidx").on(table.primaryEmail),
    check("users_mfa_session_version_check", sql`${table.mfaSessionVersion} >= 0`),
  ],
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
    check("platform_administrators_role_check", sql`${table.role} IN ('administrator', 'platform_security_owner', 'provisioning_operator', 'account_billing_operator', 'domain_operator', 'support_observer')`),
    check("platform_administrators_status_check", sql`${table.status} IN ('active', 'suspended')`),
  ],
);

export const platformOperatorChallenges = pgTable(
  "platform_operator_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    purpose: varchar("purpose", { length: 20 }).notNull(),
    credentialChangedAt: timestamp("credential_changed_at", { withTimezone: true }).notNull(),
    mfaSessionVersion: integer("mfa_session_version").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_operator_challenges_token_uidx").on(table.tokenHash),
    index("platform_operator_challenges_user_idx").on(table.userId, table.consumedAt, table.expiresAt),
    check("platform_operator_challenges_purpose_check", sql`${table.purpose} IN ('login', 'enroll')`),
    check("platform_operator_challenges_attempts_check", sql`${table.failedAttempts} >= 0 AND ${table.maxAttempts} BETWEEN 1 AND 20`),
    check("platform_operator_challenges_mfa_version_check", sql`${table.mfaSessionVersion} >= 0`),
  ],
);

export const platformOperatorSessions = pgTable(
  "platform_operator_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    credentialChangedAt: timestamp("credential_changed_at", { withTimezone: true }).notNull(),
    mfaSessionVersion: integer("mfa_session_version").notNull(),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_operator_sessions_token_uidx").on(table.tokenHash),
    index("platform_operator_sessions_user_idx").on(table.userId, table.revokedAt, table.expiresAt),
    check("platform_operator_sessions_mfa_version_check", sql`${table.mfaSessionVersion} >= 0`),
  ],
);

export const platformOperatorAudit = pgTable(
  "platform_operator_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 100 }).notNull(),
    targetType: varchar("target_type", { length: 60 }),
    targetId: varchar("target_id", { length: 120 }),
    correlationId: varchar("correlation_id", { length: 120 }),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("platform_operator_audit_actor_created_idx").on(table.actorUserId, table.createdAt),
    check("platform_operator_audit_details_check", sql`jsonb_typeof(${table.details}) = 'object'`),
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
    authenticationMethods: jsonb("authentication_methods").$type<string[]>().notNull().default(["pwd"]),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    mfaSessionVersion: integer("mfa_session_version").notNull().default(0),
    mfaEnrollmentDeadline: timestamp("mfa_enrollment_deadline", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_refresh_sessions_token_uidx").on(table.tokenHash),
    index("auth_refresh_sessions_user_idx").on(table.userId),
    index("auth_refresh_sessions_family_idx").on(table.familyId),
    check(
      "auth_refresh_sessions_authentication_methods_check",
      sql`jsonb_typeof(${table.authenticationMethods}) = 'array'`,
    ),
    check(
      "auth_refresh_sessions_mfa_session_version_check",
      sql`${table.mfaSessionVersion} >= 0`,
    ),
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

export const userMfaCredentials = pgTable(
  "user_mfa_credentials",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    encryptedTotpSecret: text("encrypted_totp_secret").notNull(),
    encryptionNonce: varchar("encryption_nonce", { length: 32 }).notNull(),
    encryptionAuthTag: varchar("encryption_auth_tag", { length: 32 }).notNull(),
    encryptionKeyVersion: integer("encryption_key_version").notNull().default(1),
    setupExpiresAt: timestamp("setup_expires_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    lastUsedStep: bigint("last_used_step", { mode: "number" }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    check("user_mfa_credentials_key_version_check", sql`${table.encryptionKeyVersion} > 0`),
    check("user_mfa_credentials_failed_attempts_check", sql`${table.failedAttempts} >= 0`),
    check(
      "user_mfa_credentials_state_check",
      sql`NOT (${table.confirmedAt} IS NOT NULL AND ${table.disabledAt} IS NOT NULL)`,
    ),
  ],
);

export const userMfaRecoveryCodes = pgTable(
  "user_mfa_recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => userMfaCredentials.userId, { onDelete: "cascade" }),
    codeHash: char("code_hash", { length: 64 }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_mfa_recovery_codes_user_hash_uidx").on(table.userId, table.codeHash),
    index("user_mfa_recovery_codes_available_idx").on(table.userId, table.usedAt),
  ],
);

export const mfaEnrollmentRequirements = pgTable(
  "mfa_enrollment_requirements",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => customerAccounts.id, { onDelete: "cascade" }),
    requiredSince: timestamp("required_since", { withTimezone: true }).notNull().defaultNow(),
    graceExpiresAt: timestamp("grace_expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    primaryKey({ name: "mfa_enrollment_requirements_pk", columns: [table.userId, table.accountId] }),
    index("mfa_enrollment_requirements_account_idx").on(table.accountId, table.resolvedAt),
    check(
      "mfa_enrollment_requirements_grace_check",
      sql`${table.graceExpiresAt} >= ${table.requiredSince}`,
    ),
  ],
);

export const authMfaChallenges = pgTable(
  "auth_mfa_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    purpose: varchar("purpose", { length: 20 }).notNull().default("login"),
    credentialChangedAt: timestamp("credential_changed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("auth_mfa_challenges_token_uidx").on(table.tokenHash),
    index("auth_mfa_challenges_active_idx").on(table.userId, table.consumedAt, table.expiresAt),
    check("auth_mfa_challenges_purpose_check", sql`${table.purpose} IN ('login')`),
    check(
      "auth_mfa_challenges_attempts_check",
      sql`${table.failedAttempts} >= 0 AND ${table.maxAttempts} BETWEEN 1 AND 20`,
    ),
  ],
);

export const mfaSecurityEvents = pgTable(
  "mfa_security_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: varchar("ip_address", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("mfa_security_events_user_created_idx").on(table.userId, table.createdAt),
    index("mfa_security_events_workspace_created_idx").on(table.workspaceId, table.createdAt),
    check("mfa_security_events_metadata_check", sql`jsonb_typeof(${table.metadata}) = 'object'`),
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
    contractContactName: varchar("contract_contact_name", { length: 160 }),
    contractContactEmail: citext("contract_contact_email"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    organizationLimit: integer("organization_limit").notNull().default(1),
    securityPolicy: jsonb("security_policy").$type<Record<string, unknown>>().notNull().default({
      requireMfaForAdmins: true,
      requireMfaForAllUsers: false,
      recoveryCodeCount: 10,
      enrollmentGraceDays: 7,
    }),
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
    check(
      "customer_accounts_security_policy_check",
      sql`jsonb_typeof(${table.securityPolicy}) = 'object'
        AND jsonb_typeof(${table.securityPolicy}->'requireMfaForAdmins') = 'boolean'
        AND jsonb_typeof(${table.securityPolicy}->'requireMfaForAllUsers') = 'boolean'
        AND (${table.securityPolicy}->>'recoveryCodeCount')::integer BETWEEN 5 AND 20
        AND (${table.securityPolicy}->>'enrollmentGraceDays')::integer BETWEEN 0 AND 30`,
    ),
    check("customer_accounts_version_check", sql`${table.version} > 0`),
  ],
);

export const customerAccountContracts = pgTable("customer_account_contracts", {
  accountId: uuid("account_id").primaryKey().references(() => customerAccounts.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 30 }).notNull().default("trial_uncontracted"),
  planCode: varchar("plan_code", { length: 40 }).notNull(),
  planVersion: integer("plan_version").notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  billingCycle: varchar("billing_cycle", { length: 20 }).notNull(),
  seatLimit: integer("seat_limit").notNull(),
  projectLimit: integer("project_limit").notNull(),
  contractReference: varchar("contract_reference", { length: 160 }),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  ...auditColumns,
}, (table) => [
  check("customer_account_contracts_status_check", sql`${table.status} IN ('trial_uncontracted', 'contracted', 'expired')`),
  check("customer_account_contracts_cycle_check", sql`${table.billingCycle} IN ('monthly', 'yearly', 'custom')`),
  check("customer_account_contracts_limits_check", sql`${table.seatLimit} > 0 AND ${table.projectLimit} > 0`),
  check("customer_account_contracts_version_check", sql`${table.version} > 0`),
  check("customer_account_contracts_signed_check", sql`(${table.status} = 'contracted') = (${table.signedAt} IS NOT NULL)`),
]);

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

export const workspaceConfigurationRevisions = pgTable(
  "workspace_configuration_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    resourceType: varchar("resource_type", { length: 64 }).notNull(),
    resourceId: varchar("resource_id", { length: 160 }).notNull(),
    revisionNumber: integer("revision_number").notNull(),
    sourceVersion: integer("source_version").notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    sourceRevisionId: uuid("source_revision_id").references(
      (): AnyPgColumn => workspaceConfigurationRevisions.id,
      { onDelete: "set null" },
    ),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_configuration_revisions_unique").on(
      table.workspaceId,
      table.resourceType,
      table.resourceId,
      table.revisionNumber,
    ),
    index("workspace_configuration_revisions_history_idx").on(
      table.workspaceId,
      table.resourceType,
      table.resourceId,
      table.revisionNumber,
    ),
    check(
      "workspace_configuration_revisions_resource_type_check",
      sql`${table.resourceType} IN ('workspace_terminology','project_workflow_template','crm_taxonomy','crm_custom_field','crm_qualification_form','quotation_template','payment_template','workspace_team')`,
    ),
    check(
      "workspace_configuration_revisions_action_check",
      sql`${table.action} IN ('baseline','created','saved','archived','restored_default','rolled_back')`,
    ),
    check(
      "workspace_configuration_revisions_numbers_check",
      sql`${table.revisionNumber} > 0 AND ${table.sourceVersion} >= 0`,
    ),
    check(
      "workspace_configuration_revisions_snapshot_check",
      sql`jsonb_typeof(${table.snapshot}) = 'object'`,
    ),
  ],
);

export const projectWorkflowTemplates = pgTable(
  "project_workflow_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: varchar("description", { length: 1000 }).notNull().default(""),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    isDefault: boolean("is_default").notNull().default(false),
    version: integer("version").notNull().default(1),
    stages: jsonb("stages").$type<Record<string, unknown>[]>().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("project_workflow_templates_workspace_id").on(table.workspaceId, table.id),
    uniqueIndex("project_workflow_templates_active_code_uidx")
      .on(table.workspaceId, table.code)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("project_workflow_templates_default_uidx")
      .on(table.workspaceId)
      .where(sql`${table.status} = 'active' AND ${table.isDefault} = true`),
    index("project_workflow_templates_list_idx").on(
      table.workspaceId,
      table.status,
      table.isDefault,
      table.name,
    ),
    check(
      "project_workflow_templates_code_check",
      sql`${table.code} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      "project_workflow_templates_name_check",
      sql`length(btrim(${table.name})) BETWEEN 1 AND 120`,
    ),
    check(
      "project_workflow_templates_status_check",
      sql`${table.status} IN ('active','archived')`,
    ),
    check("project_workflow_templates_version_check", sql`${table.version} > 0`),
    check(
      "project_workflow_templates_stages_check",
      sql`jsonb_typeof(${table.stages}) = 'array' AND jsonb_array_length(${table.stages}) BETWEEN 2 AND 18`,
    ),
    check(
      "project_workflow_templates_default_check",
      sql`${table.status} = 'active' OR ${table.isDefault} = false`,
    ),
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
    primaryColor: varchar("primary_color", { length: 7 }),
    secondaryColor: varchar("secondary_color", { length: 7 }),
    headingFont: varchar("heading_font", { length: 40 }),
    bodyFont: varchar("body_font", { length: 40 }),
    logoUrl: text("logo_url"),
    logoAssetId: uuid("logo_asset_id").references(() => workspaceBrandAssets.id, {
      onDelete: "set null",
    }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("tenant_login_branding_slug_uidx").on(table.loginSlug),
    check(
      "tenant_login_branding_primary_color_check",
      sql`${table.primaryColor} IS NULL OR ${table.primaryColor} ~ '^#[0-9A-F]{6}$'`,
    ),
    check(
      "tenant_login_branding_secondary_color_check",
      sql`${table.secondaryColor} IS NULL OR ${table.secondaryColor} ~ '^#[0-9A-F]{6}$'`,
    ),
    check(
      "tenant_login_branding_heading_font_check",
      sql`${table.headingFont} IS NULL OR ${table.headingFont} IN ('alta')`,
    ),
    check(
      "tenant_login_branding_body_font_check",
      sql`${table.bodyFont} IS NULL OR ${table.bodyFont} IN ('montserrat')`,
    ),
  ],
);

export const workspaceDomains = pgTable(
  "workspace_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    hostname: varchar("hostname", { length: 253 }).notNull(),
    requestKey: varchar("request_key", { length: 160 }).notNull(),
    challengeValue: varchar("challenge_value", { length: 96 }).notNull(),
    challengeExpiresAt: timestamp("challenge_expires_at", { withTimezone: true }).notNull(),
    dnsStatus: varchar("dns_status", { length: 20 }).notNull().default("pending"),
    dnsVerifiedAt: timestamp("dns_verified_at", { withTimezone: true }),
    certificateStatus: varchar("certificate_status", { length: 24 }).notNull().default("not_requested"),
    certificateExpiresAt: timestamp("certificate_expires_at", { withTimezone: true }),
    routingStatus: varchar("routing_status", { length: 20 }).notNull().default("not_requested"),
    routingActivatedAt: timestamp("routing_activated_at", { withTimezone: true }),
    rollbackStatus: varchar("rollback_status", { length: 20 }).notNull().default("none"),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
    version: integer("version").notNull().default(1),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("workspace_domains_live_hostname_uidx").on(table.hostname).where(sql`${table.removedAt} IS NULL`),
    uniqueIndex("workspace_domains_request_key_uidx").on(table.workspaceId, table.requestKey),
    index("workspace_domains_workspace_idx").on(table.workspaceId, table.createdAt),
    check("workspace_domains_dns_status_check", sql`${table.dnsStatus} IN ('pending', 'verified', 'expired', 'failed')`),
    check("workspace_domains_certificate_status_check", sql`${table.certificateStatus} IN ('not_requested', 'manual_setup_required', 'pending', 'issued', 'expired', 'failed')`),
    check("workspace_domains_routing_status_check", sql`${table.routingStatus} IN ('not_requested', 'pending', 'active', 'failed')`),
    check("workspace_domains_rollback_status_check", sql`${table.rollbackStatus} IN ('none', 'pending', 'completed', 'failed')`),
    check("workspace_domains_version_check", sql`${table.version} > 0`),
    check("workspace_domains_activation_check", sql`${table.routingStatus} <> 'active' OR (${table.dnsStatus} = 'verified' AND ${table.certificateStatus} = 'issued' AND ${table.routingActivatedAt} IS NOT NULL AND ${table.removedAt} IS NULL)`),
    check("workspace_domains_certificate_check", sql`${table.certificateStatus} NOT IN ('pending', 'issued') OR ${table.dnsVerifiedAt} IS NOT NULL`),
  ],
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

export const tenantSetupProfiles = pgTable(
  "tenant_setup_profiles",
  {
    kind: varchar("kind", { length: 20 }).notNull(),
    code: varchar("code", { length: 40 }).notNull(),
    version: integer("version").notNull(),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull(),
    selectable: boolean("selectable").notNull().default(true),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "tenant_setup_profiles_pk", columns: [table.kind, table.code, table.version] }),
    check("tenant_setup_profiles_kind_check", sql`${table.kind} IN ('region', 'firm_kit', 'plan')`),
    check("tenant_setup_profiles_version_check", sql`${table.version} > 0`),
    check("tenant_setup_profiles_configuration_check", sql`jsonb_typeof(${table.configuration}) = 'object'`),
  ],
);

export const tenantProvisioningDrafts = pgTable(
  "tenant_provisioning_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalTenantId: varchar("external_tenant_id", { length: 160 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    provisionIdempotencyKey: varchar("provision_idempotency_key", { length: 160 }),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    account: jsonb("account").$type<Record<string, unknown>>().notNull(),
    organization: jsonb("organization").$type<Record<string, unknown>>().notNull(),
    owner: jsonb("owner").$type<Record<string, unknown>>().notNull(),
    defaults: jsonb("defaults").$type<Record<string, unknown>>().notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    version: integer("version").notNull().default(1),
    reservationExpiresAt: timestamp("reservation_expires_at", { withTimezone: true }).notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("tenant_provisioning_drafts_external_uidx").on(table.externalTenantId),
    uniqueIndex("tenant_provisioning_drafts_key_uidx").on(table.idempotencyKey),
    uniqueIndex("tenant_provisioning_drafts_provision_key_uidx").on(table.provisionIdempotencyKey)
      .where(sql`${table.provisionIdempotencyKey} IS NOT NULL`),
    uniqueIndex("tenant_provisioning_drafts_live_slug_uidx").on(table.slug)
      .where(sql`${table.status} IN ('draft', 'provisioning', 'failed', 'provisioned')`),
    index("tenant_provisioning_drafts_status_idx").on(table.status, table.createdAt),
    check("tenant_provisioning_drafts_status_check", sql`${table.status} IN ('draft', 'provisioning', 'provisioned', 'failed', 'expired')`),
    check("tenant_provisioning_drafts_version_check", sql`${table.version} > 0`),
    check("tenant_provisioning_drafts_json_check", sql`jsonb_typeof(${table.account}) = 'object' AND jsonb_typeof(${table.organization}) = 'object' AND jsonb_typeof(${table.owner}) = 'object' AND jsonb_typeof(${table.defaults}) = 'object'`),
  ],
);

export const workspaceSetupVersions = pgTable("workspace_setup_versions", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  regionCode: varchar("region_code", { length: 40 }).notNull(),
  regionVersion: integer("region_version").notNull(),
  firmKitCode: varchar("firm_kit_code", { length: 40 }).notNull(),
  firmKitVersion: integer("firm_kit_version").notNull(),
  planCode: varchar("plan_code", { length: 40 }).notNull(),
  planVersion: integer("plan_version").notNull(),
  configurationSnapshot: jsonb("configuration_snapshot").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("workspace_setup_versions_snapshot_check", sql`jsonb_typeof(${table.configurationSnapshot}) = 'object'`)]);

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
    homeLayout: jsonb("home_layout"),
    homeLayoutVersion: integer("home_layout_version").notNull().default(0),
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

export const workspaceInvitationDelivery = pgTable("workspace_invitation_delivery", {
  invitationId: uuid("invitation_id").primaryKey().references(() => workspaceInvitations.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 }).notNull().default("not_requested"),
  attempts: integer("attempts").notNull().default(0),
  provider: varchar("provider", { length: 40 }),
  providerMessageId: varchar("provider_message_id", { length: 255 }),
  lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("workspace_invitation_delivery_status_check", sql`${table.status} IN ('not_requested', 'pending', 'sent', 'not_configured', 'failed')`),
  check("workspace_invitation_delivery_attempts_check", sql`${table.attempts} >= 0`),
]);

export const workspaceInvitationDeliveryCommands = pgTable("workspace_invitation_delivery_commands", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  invitationId: uuid("invitation_id").notNull().references(() => workspaceInvitations.id, { onDelete: "cascade" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  providerMessageId: varchar("provider_message_id", { length: 255 }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("workspace_invitation_delivery_commands_key_uidx").on(table.invitationId, table.idempotencyKey),
  check("workspace_invitation_delivery_commands_status_check", sql`${table.status} IN ('pending', 'sent', 'not_configured', 'failed', 'superseded')`),
]);

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

export const invitationTeams = pgTable(
  "invitation_teams",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    invitationId: uuid("invitation_id").notNull().references(() => workspaceInvitations.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => workspaceTeams.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.invitationId, table.teamId] })],
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

export const workspaceTeamRoles = pgTable(
  "workspace_team_roles",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => workspaceTeams.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.roleId] }), index("workspace_team_roles_role_idx").on(table.workspaceId, table.roleId)],
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
