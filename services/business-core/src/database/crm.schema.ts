import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  check,
  customType,
  foreignKey,
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
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  businessUnits,
  currencies,
  legalEntities,
  users,
  workspaceMemberships,
  workspaceTeams,
  workspaces,
} from "./schema";

const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const versionColumn = {
  version: integer("version").notNull().default(1),
};

export const crmPartyType = pgEnum("crm_party_type", ["person", "organization", "household"]);
export const crmRecordStatus = pgEnum("crm_record_status", ["active", "merged", "archived"]);
export const crmContactPointType = pgEnum("crm_contact_point_type", [
  "email",
  "phone",
  "social",
  "other",
]);
export const crmConsentStatus = pgEnum("crm_consent_status", [
  "unknown",
  "granted",
  "denied",
  "withdrawn",
]);
export const crmIntakeStatus = pgEnum("crm_intake_status", [
  "received",
  "processing",
  "ready",
  "needs_review",
  "failed",
  "duplicate_candidate",
  "superseded",
]);
export const crmLeadStatus = pgEnum("crm_lead_status", [
  "new",
  "attempting_contact",
  "connected",
  "nurturing",
  "qualified",
  "disqualified",
  "paused",
]);
export const crmOpportunityStatus = pgEnum("crm_opportunity_status", [
  "open",
  "won",
  "lost",
  "abandoned",
]);
export const crmActivityType = pgEnum("crm_activity_type", [
  "task",
  "note",
  "call",
  "meeting",
  "email",
  "whatsapp",
  "sms",
  "portal",
  "other",
]);
export const crmActivityStatus = pgEnum("crm_activity_status", [
  "pending",
  "completed",
  "cancelled",
]);
export const crmMessageDirection = pgEnum("crm_message_direction", [
  "inbound",
  "outbound",
  "internal",
]);
export const crmMessageStatus = pgEnum("crm_message_status", [
  "draft",
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
]);
export const automationDefinitionStatus = pgEnum("automation_definition_status", [
  "draft",
  "active",
  "paused",
  "archived",
]);
export const automationRunStatus = pgEnum("automation_run_status", [
  "queued",
  "running",
  "waiting",
  "approval_required",
  "completed",
  "failed",
  "cancelled",
]);
export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "scheduled",
  "processing",
  "delivered",
  "failed",
  "cancelled",
  "suppressed",
]);

export const crmParties = pgTable(
  "crm_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id, { onDelete: "set null" }),
    businessUnitId: uuid("business_unit_id").references(() => businessUnits.id, { onDelete: "set null" }),
    type: crmPartyType("type").notNull(),
    displayName: varchar("display_name", { length: 240 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 240 }).notNull(),
    lifecycle: varchar("lifecycle", { length: 40 }).notNull().default("prospect"),
    status: crmRecordStatus("status").notNull().default("active"),
    ownerMembershipId: uuid("owner_membership_id").references(() => workspaceMemberships.id, { onDelete: "set null" }),
    preferredLocale: varchar("preferred_locale", { length: 35 }),
    preferredTimezone: varchar("preferred_timezone", { length: 64 }),
    mergedIntoPartyId: uuid("merged_into_party_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    index("crm_parties_workspace_name_idx").on(table.workspaceId, table.normalizedName),
    index("crm_parties_workspace_owner_idx").on(table.workspaceId, table.ownerMembershipId),
    index("crm_parties_workspace_lifecycle_idx").on(table.workspaceId, table.lifecycle),
    check("crm_parties_merge_target_check", sql`${table.status} <> 'merged' OR ${table.mergedIntoPartyId} IS NOT NULL`),
  ],
);

export const crmPersonProfiles = pgTable("crm_person_profiles", {
  partyId: uuid("party_id").primaryKey().references(() => crmParties.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  givenName: varchar("given_name", { length: 120 }),
  familyName: varchar("family_name", { length: 120 }),
  honorific: varchar("honorific", { length: 40 }),
  jobTitle: varchar("job_title", { length: 160 }),
  birthdayMonth: smallint("birthday_month"),
  birthdayDay: smallint("birthday_day"),
  ...auditColumns,
});

export const crmOrganizationProfiles = pgTable("crm_organization_profiles", {
  partyId: uuid("party_id").primaryKey().references(() => crmParties.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  legalName: varchar("legal_name", { length: 240 }),
  websiteDomain: varchar("website_domain", { length: 255 }),
  registrationNumber: varchar("registration_number", { length: 120 }),
  industry: varchar("industry", { length: 120 }),
  employeeBand: varchar("employee_band", { length: 40 }),
  ...auditColumns,
});

export const crmRelationships = pgTable(
  "crm_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    fromPartyId: uuid("from_party_id").notNull().references(() => crmParties.id, { onDelete: "cascade" }),
    toPartyId: uuid("to_party_id").notNull().references(() => crmParties.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 80 }).notNull(),
    label: varchar("label", { length: 120 }),
    isPrimary: boolean("is_primary").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    index("crm_relationships_from_idx").on(table.workspaceId, table.fromPartyId),
    index("crm_relationships_to_idx").on(table.workspaceId, table.toPartyId),
    uniqueIndex("crm_relationships_unique_uidx").on(table.workspaceId, table.fromPartyId, table.toPartyId, table.type),
    check("crm_relationships_not_self_check", sql`${table.fromPartyId} <> ${table.toPartyId}`),
  ],
);

export const crmContactPoints = pgTable(
  "crm_contact_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    partyId: uuid("party_id").notNull().references(() => crmParties.id, { onDelete: "cascade" }),
    type: crmContactPointType("type").notNull(),
    label: varchar("label", { length: 80 }),
    rawValue: varchar("raw_value", { length: 500 }).notNull(),
    normalizedValue: citext("normalized_value"),
    countryCode: varchar("country_code", { length: 2 }),
    isPrimary: boolean("is_primary").notNull().default(false),
    isVerified: boolean("is_verified").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    invalidReason: varchar("invalid_reason", { length: 120 }),
    status: crmRecordStatus("status").notNull().default("active"),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    index("crm_contact_points_party_idx").on(table.workspaceId, table.partyId),
    index("crm_contact_points_normalized_idx").on(table.workspaceId, table.type, table.normalizedValue),
  ],
);

export const crmAddresses = pgTable(
  "crm_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    partyId: uuid("party_id").notNull().references(() => crmParties.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 80 }),
    line1: varchar("line1", { length: 240 }),
    line2: varchar("line2", { length: 240 }),
    locality: varchar("locality", { length: 160 }),
    region: varchar("region", { length: 160 }),
    postalCode: varchar("postal_code", { length: 40 }),
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [index("crm_addresses_party_idx").on(table.workspaceId, table.partyId)],
);

export const crmConsents = pgTable(
  "crm_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    partyId: uuid("party_id").notNull().references(() => crmParties.id, { onDelete: "cascade" }),
    legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id, { onDelete: "set null" }),
    purpose: varchar("purpose", { length: 80 }).notNull(),
    channel: varchar("channel", { length: 40 }).notNull(),
    status: crmConsentStatus("status").notNull().default("unknown"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    jurisdiction: varchar("jurisdiction", { length: 20 }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("crm_consents_scope_uidx").on(table.workspaceId, table.partyId, table.legalEntityId, table.purpose, table.channel),
    index("crm_consents_party_idx").on(table.workspaceId, table.partyId),
  ],
);

export const crmMergeOperations = pgTable(
  "crm_merge_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    survivorPartyId: uuid("survivor_party_id").notNull().references(() => crmParties.id),
    mergedPartyId: uuid("merged_party_id").notNull().references(() => crmParties.id),
    fieldDecisions: jsonb("field_decisions").$type<Record<string, unknown>>().notNull().default({}),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    performedBy: uuid("performed_by").references(() => users.id, { onDelete: "set null" }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("crm_merge_operations_party_idx").on(table.workspaceId, table.survivorPartyId, table.mergedPartyId),
    check("crm_merge_operations_distinct_check", sql`${table.survivorPartyId} <> ${table.mergedPartyId}`),
  ],
);

export const crmIntakeEvents = pgTable(
  "crm_intake_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id, { onDelete: "set null" }),
    businessUnitId: uuid("business_unit_id").references(() => businessUnits.id, { onDelete: "set null" }),
    source: varchar("source", { length: 100 }).notNull(),
    channel: varchar("channel", { length: 60 }).notNull(),
    intakeMethod: varchar("intake_method", { length: 40 }).notNull(),
    externalEventId: varchar("external_event_id", { length: 255 }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    payloadHashVersion: smallint("payload_hash_version").notNull().default(2),
    originalPayload: jsonb("original_payload").$type<Record<string, unknown>>().notNull(),
    payloadReference: varchar("payload_reference", { length: 500 }),
    status: crmIntakeStatus("status").notNull().default("received"),
    failureCode: varchar("failure_code", { length: 120 }),
    failureMessage: text("failure_message"),
    correlationId: uuid("correlation_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    resolutionType: varchar("resolution_type", { length: 40 }),
    resolvedPartyId: uuid("resolved_party_id").references(() => crmParties.id, { onDelete: "restrict" }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionEvidence: jsonb("resolution_evidence").$type<Record<string, unknown>>(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("crm_intake_events_idempotency_uidx").on(table.workspaceId, table.idempotencyKey),
    uniqueIndex("crm_intake_events_external_uidx").on(table.workspaceId, table.source, table.externalEventId),
    index("crm_intake_events_inbox_idx").on(table.workspaceId, table.status, table.receivedAt),
    index("crm_intake_events_resolution_idx").on(table.workspaceId, table.resolvedPartyId, table.resolvedAt).where(sql`${table.resolvedPartyId} IS NOT NULL`),
    check("crm_intake_events_payload_hash_version_check", sql`${table.payloadHashVersion} IN (1,2)`),
    check("crm_intake_events_resolution_type_check", sql`${table.resolutionType} IS NULL OR ${table.resolutionType} IN ('legacy_ready','verified_contact','new_identity','review_attach','review_create_new')`),
    check("crm_intake_events_resolution_evidence_check", sql`${table.resolutionEvidence} IS NULL OR jsonb_typeof(${table.resolutionEvidence}) = 'object'`),
    check("crm_intake_events_resolution_fields_check", sql`(
      ${table.resolutionType} IS NULL AND ${table.resolvedPartyId} IS NULL AND ${table.resolvedAt} IS NULL AND ${table.resolutionEvidence} IS NULL
    ) OR (
      ${table.resolutionType} IS NOT NULL AND ${table.resolvedPartyId} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL AND ${table.resolutionEvidence} IS NOT NULL
    )`),
    check("crm_intake_events_ready_resolution_check", sql`${table.status} <> 'ready' OR (${table.resolutionType} IS NOT NULL AND ${table.resolvedPartyId} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)`),
  ],
);

export const crmEnquiryCounters = pgTable("crm_enquiry_counters", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  lastValue: bigint("last_value", { mode: "bigint" }).notNull().default(0n),
}, table => [check("crm_enquiry_counters_last_value_check", sql`${table.lastValue} >= 0`)]);

export const crmEnquiries = pgTable(
  "crm_enquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    intakeEventId: uuid("intake_event_id").notNull().references(() => crmIntakeEvents.id),
    partyId: uuid("party_id").notNull().references(() => crmParties.id),
    reference: varchar("reference", { length: 40 }).notNull(),
    details: jsonb("details").notNull().default({}),
    title: varchar("title", { length: 240 }).notNull(),
    summary: text("summary"),
    serviceType: varchar("service_type", { length: 100 }),
    source: varchar("source", { length: 100 }).notNull(),
    channel: varchar("channel", { length: 60 }).notNull(),
    status: varchar("status", { length: 40 }).notNull().default("open"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    check("crm_enquiries_details_object", sql`jsonb_typeof(${table.details}) = 'object'`),
    index("crm_enquiries_reporting_idx").on(table.workspaceId, table.serviceType, table.receivedAt),
    uniqueIndex("crm_enquiries_reference_uidx").on(table.workspaceId, table.reference),
    uniqueIndex("crm_enquiries_intake_uidx").on(table.workspaceId, table.intakeEventId),
    index("crm_enquiries_party_idx").on(table.workspaceId, table.partyId, table.receivedAt),
  ],
);

export const crmAttributionTouches = pgTable(
  "crm_attribution_touches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    enquiryId: uuid("enquiry_id").notNull().references(() => crmEnquiries.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 100 }).notNull(),
    medium: varchar("medium", { length: 100 }),
    campaign: varchar("campaign", { length: 160 }),
    content: varchar("content", { length: 160 }),
    term: varchar("term", { length: 160 }),
    referrer: text("referrer"),
    externalClickId: varchar("external_click_id", { length: 255 }),
    touchedAt: timestamp("touched_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("crm_attribution_enquiry_idx").on(table.workspaceId, table.enquiryId, table.touchedAt)],
);

export const crmIdentityCandidates = pgTable(
  "crm_identity_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    intakeEventId: uuid("intake_event_id").notNull().references(() => crmIntakeEvents.id, { onDelete: "cascade" }),
    candidatePartyId: uuid("candidate_party_id").notNull().references(() => crmParties.id, { onDelete: "cascade" }),
    strength: varchar("strength", { length: 20 }).notNull(),
    score: numeric("score", { precision: 5, scale: 4 }).notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    decision: varchar("decision", { length: 30 }),
    resolvedPartyId: uuid("resolved_party_id").references(() => crmParties.id, { onDelete: "restrict" }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("crm_identity_candidate_uidx").on(table.workspaceId, table.intakeEventId, table.candidatePartyId),
    index("crm_identity_candidate_review_idx").on(table.workspaceId, table.status, table.createdAt),
    index("crm_identity_candidates_resolved_party_idx").on(table.workspaceId, table.resolvedPartyId, table.reviewedAt).where(sql`${table.resolvedPartyId} IS NOT NULL`),
    check("crm_identity_candidate_score_check", sql`${table.score} >= 0 AND ${table.score} <= 1`),
    check("crm_identity_candidates_strength_check", sql`${table.strength} IN ('exact','fuzzy')`),
    check("crm_identity_candidates_status_check", sql`${table.status} IN ('pending','accepted','rejected')`),
    check("crm_identity_candidates_reasons_check", sql`jsonb_typeof(${table.reasons}) = 'array'`),
    check("crm_identity_candidates_decision_check", sql`${table.decision} IS NULL OR ${table.decision} IN ('attach','create_new','reject','resolved_elsewhere')`),
    check("crm_identity_candidates_review_state_check", sql`(
      ${table.status} = 'pending' AND ${table.decision} IS NULL AND ${table.reviewedAt} IS NULL AND ${table.resolvedPartyId} IS NULL
    ) OR (
      ${table.status} = 'accepted' AND ${table.decision} = 'attach' AND ${table.reviewedAt} IS NOT NULL AND ${table.resolvedPartyId} IS NOT NULL
    ) OR (
      ${table.status} = 'rejected' AND ${table.decision} = 'reject' AND ${table.reviewedAt} IS NOT NULL AND ${table.resolvedPartyId} IS NULL
    ) OR (
      ${table.status} = 'rejected' AND ${table.decision} IN ('create_new','resolved_elsewhere') AND ${table.reviewedAt} IS NOT NULL AND ${table.resolvedPartyId} IS NOT NULL
    )`),
  ],
);

export const crmQueues = pgTable(
  "crm_queues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    businessUnitId: uuid("business_unit_id").references(() => businessUnits.id, { onDelete: "set null" }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    isFallback: boolean("is_fallback").notNull().default(false),
    takeoverAfterMinutes: integer("takeover_after_minutes"),
    roundRobinCursor: integer("round_robin_cursor").notNull().default(0),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("crm_queues_code_uidx").on(table.workspaceId, table.code),
    index("crm_queues_fallback_idx").on(table.workspaceId, table.isFallback),
    check("crm_queues_takeover_after_minutes_check", sql`${table.takeoverAfterMinutes} IS NULL OR ${table.takeoverAfterMinutes} BETWEEN 1 AND 10080`),
  ],
);

export const workspaceTeamQueueSettings = pgTable(
  "workspace_team_queue_settings",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => workspaceTeams.id, { onDelete: "cascade" }),
    queueId: uuid("queue_id").notNull().references(() => crmQueues.id, { onDelete: "cascade" }),
    capacity: integer("capacity").notNull().default(25),
    weight: integer("weight").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.queueId] }),
    index("workspace_team_queue_settings_queue_idx").on(table.workspaceId, table.queueId),
    check("workspace_team_queue_settings_capacity_check", sql`${table.capacity} BETWEEN 1 AND 10000`),
    check("workspace_team_queue_settings_weight_check", sql`${table.weight} BETWEEN 1 AND 100`),
  ],
);

export const crmQueueMembers = pgTable(
  "crm_queue_members",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    queueId: uuid("queue_id").notNull().references(() => crmQueues.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => workspaceMemberships.id, { onDelete: "cascade" }),
    capacity: integer("capacity").notNull().default(20),
    weight: integer("weight").notNull().default(1),
    isAvailable: boolean("is_available").notNull().default(true),
    skills: jsonb("skills").$type<string[]>().notNull().default([]),
    languages: jsonb("languages").$type<string[]>().notNull().default([]),
    territories: jsonb("territories").$type<string[]>().notNull().default([]),
    unavailableUntil: timestamp("unavailable_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.queueId, table.membershipId] }),
    index("crm_queue_members_member_idx").on(table.workspaceId, table.membershipId),
    check("crm_queue_members_capacity_check", sql`${table.capacity} > 0 AND ${table.weight} > 0`),
  ],
);

export const crmAssignmentPolicies = pgTable(
  "crm_assignment_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    priority: integer("priority").notNull().default(100),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    fallbackQueueId: uuid("fallback_queue_id").references(() => crmQueues.id, { onDelete: "set null" }),
    preserveRelationshipOwner: boolean("preserve_relationship_owner").notNull().default(true),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [index("crm_assignment_policies_priority_idx").on(table.workspaceId, table.status, table.priority)],
);

export const crmAssignmentRules = pgTable(
  "crm_assignment_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    policyId: uuid("policy_id").notNull().references(() => crmAssignmentPolicies.id, { onDelete: "cascade" }),
    queueId: uuid("queue_id").notNull().references(() => crmQueues.id),
    name: varchar("name", { length: 160 }).notNull(),
    priority: integer("priority").notNull().default(100),
    conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default({}),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [index("crm_assignment_rules_policy_idx").on(table.workspaceId, table.policyId, table.priority)],
);

export const crmLeads = pgTable(
  "crm_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    enquiryId: uuid("enquiry_id").notNull().references(() => crmEnquiries.id),
    partyId: uuid("party_id").notNull().references(() => crmParties.id),
    ownerMembershipId: uuid("owner_membership_id").references(() => workspaceMemberships.id, { onDelete: "set null" }),
    queueId: uuid("queue_id").references(() => crmQueues.id, { onDelete: "set null" }),
    status: crmLeadStatus("status").notNull().default("new"),
    priority: varchar("priority", { length: 20 }).notNull().default("normal"),
    fitScore: numeric("fit_score", { precision: 5, scale: 2 }),
    engagementScore: numeric("engagement_score", { precision: 5, scale: 2 }),
    disqualificationReason: varchar("disqualification_reason", { length: 160 }),
    pausedReason: varchar("paused_reason", { length: 160 }),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    ownershipDueAt: timestamp("ownership_due_at", { withTimezone: true }),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
    qualificationEvidence: jsonb("qualification_evidence").$type<Record<string, unknown>>(),
    qualificationEvidenceHash: varchar("qualification_evidence_hash", { length: 64 }),
    qualifiedBy: uuid("qualified_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("crm_leads_enquiry_uidx").on(table.workspaceId, table.enquiryId),
    index("crm_leads_owner_status_idx").on(table.workspaceId, table.ownerMembershipId, table.status),
    index("crm_leads_queue_status_idx").on(table.workspaceId, table.queueId, table.status),
    index("crm_leads_next_action_idx").on(table.workspaceId, table.nextActionAt),
    index("crm_leads_ownership_due_idx").on(table.workspaceId, table.ownershipDueAt).where(sql`${table.ownershipDueAt} IS NOT NULL`),
    check("crm_leads_qualification_evidence_check", sql`${table.qualificationEvidence} IS NULL OR jsonb_typeof(${table.qualificationEvidence}) = 'object'`),
    check("crm_leads_qualification_hash_check", sql`${table.qualificationEvidenceHash} IS NULL OR ${table.qualificationEvidenceHash} ~ '^[0-9a-f]{64}$'`),
    check("crm_leads_qualification_state_check", sql`(
      ${table.status} = 'qualified' AND ${table.qualifiedAt} IS NOT NULL
      AND ${table.qualificationEvidence} IS NOT NULL AND ${table.qualificationEvidenceHash} IS NOT NULL
    ) OR (
      ${table.status} <> 'qualified' AND ${table.qualifiedAt} IS NULL
      AND ${table.qualificationEvidence} IS NULL AND ${table.qualificationEvidenceHash} IS NULL AND ${table.qualifiedBy} IS NULL
    )`),
  ],
);

export const crmLeadQualificationValues = pgTable(
  "crm_lead_qualification_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => crmLeads.id, { onDelete: "cascade" }),
    questionKey: varchar("question_key", { length: 100 }).notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    capturedBy: uuid("captured_by").references(() => users.id, { onDelete: "set null" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("crm_lead_qualification_value_uidx").on(table.workspaceId, table.leadId, table.questionKey)],
);

export const crmAssignmentHistory = pgTable(
  "crm_assignment_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => crmLeads.id, { onDelete: "cascade" }),
    previousOwnerMembershipId: uuid("previous_owner_membership_id").references(() => workspaceMemberships.id, { onDelete: "set null" }),
    ownerMembershipId: uuid("owner_membership_id").references(() => workspaceMemberships.id, { onDelete: "set null" }),
    queueId: uuid("queue_id").references(() => crmQueues.id, { onDelete: "set null" }),
    assignmentMethod: varchar("assignment_method", { length: 40 }).notNull(),
    ruleId: uuid("rule_id").references(() => crmAssignmentRules.id, { onDelete: "set null" }),
    explanation: jsonb("explanation").$type<Record<string, unknown>>().notNull().default({}),
    reason: text("reason"),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("crm_assignment_history_lead_idx").on(table.workspaceId, table.leadId, table.assignedAt)],
);

export const crmSlaPolicies = pgTable(
  "crm_sla_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    warningAfterMinutes: integer("warning_after_minutes").notNull(),
    breachAfterMinutes: integer("breach_after_minutes").notNull(),
    calculationMode: varchar("calculation_mode", { length: 20 }).notNull().default("elapsed"),
    scheduleVersion: smallint("schedule_version").notNull().default(1),
    schedule: jsonb("schedule").$type<Record<string, unknown>>().notNull().default({}),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    check("crm_sla_policy_minutes_check", sql`${table.warningAfterMinutes} >= 0 AND ${table.breachAfterMinutes} > ${table.warningAfterMinutes}`),
    check("crm_sla_policy_calculation_mode_check", sql`${table.calculationMode} IN ('elapsed','business')`),
    check("crm_sla_policy_schedule_version_check", sql`${table.scheduleVersion} = 1`),
    check("crm_sla_policy_schedule_object_check", sql`jsonb_typeof(${table.schedule}) = 'object'`),
    uniqueIndex("crm_sla_policies_active_event_uidx").on(table.workspaceId, table.eventType).where(sql`${table.status} = 'active'`),
  ],
);

export const crmSlaInstances = pgTable(
  "crm_sla_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    policyId: uuid("policy_id").notNull().references(() => crmSlaPolicies.id),
    leadId: uuid("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 60 }).notNull(),
    targetId: uuid("target_id").notNull(),
    eventType: varchar("event_type", { length: 80 }).notNull().default("first_response"),
    cycle: integer("cycle").notNull().default(1),
    calculationMode: varchar("calculation_mode", { length: 20 }).notNull().default("elapsed"),
    policySnapshot: jsonb("policy_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    warningAt: timestamp("warning_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    warnedAt: timestamp("warned_at", { withTimezone: true }),
    breachedAt: timestamp("breached_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pausedFromStatus: varchar("paused_from_status", { length: 30 }),
    remainingWarningMinutes: integer("remaining_warning_minutes"),
    remainingBreachMinutes: integer("remaining_breach_minutes"),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    totalPausedMinutes: integer("total_paused_minutes").notNull().default(0),
    stopReason: varchar("stop_reason", { length: 120 }),
    responseEvidence: jsonb("response_evidence").$type<Record<string, unknown>>(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    responseSourceType: varchar("response_source_type", { length: 30 }),
    responseSourceId: uuid("response_source_id"),
    responseActorUserId: uuid("response_actor_user_id").references(() => users.id, { onDelete: "set null" }),
    ownerMembershipId: uuid("owner_membership_id").references(() => workspaceMemberships.id, { onDelete: "set null" }),
    queueId: uuid("queue_id").references(() => crmQueues.id, { onDelete: "set null" }),
    responseElapsedMinutes: integer("response_elapsed_minutes"),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    unique("crm_sla_instances_workspace_id_id").on(table.workspaceId, table.id),
    index("crm_sla_instances_due_idx").on(table.workspaceId, table.status, table.dueAt),
    uniqueIndex("crm_sla_instances_cycle_uidx").on(table.workspaceId, table.targetType, table.targetId, table.eventType, table.cycle),
    check("crm_sla_instances_cycle_check", sql`${table.cycle} > 0`),
    check("crm_sla_instances_calculation_mode_check", sql`${table.calculationMode} IN ('elapsed','business')`),
    check("crm_sla_instances_policy_snapshot_check", sql`jsonb_typeof(${table.policySnapshot}) = 'object'`),
    check("crm_sla_instances_paused_minutes_check", sql`${table.totalPausedMinutes} >= 0`),
    check("crm_sla_instances_response_evidence_check", sql`${table.responseEvidence} IS NULL OR jsonb_typeof(${table.responseEvidence}) = 'object'`),
    check("crm_sla_instances_paused_from_status_check", sql`${table.pausedFromStatus} IS NULL OR ${table.pausedFromStatus} IN ('active','warning')`),
    check("crm_sla_instances_remaining_warning_check", sql`${table.remainingWarningMinutes} IS NULL OR ${table.remainingWarningMinutes} >= 0`),
    check("crm_sla_instances_remaining_breach_check", sql`${table.remainingBreachMinutes} IS NULL OR ${table.remainingBreachMinutes} >= 0`),
    check("crm_sla_instances_pause_state_check", sql`(
      ${table.status} = 'paused' AND ${table.pausedAt} IS NOT NULL AND ${table.pausedFromStatus} IS NOT NULL
      AND ${table.remainingWarningMinutes} IS NOT NULL AND ${table.remainingBreachMinutes} IS NOT NULL
    ) OR (
      ${table.status} <> 'paused' AND ${table.pausedAt} IS NULL AND ${table.pausedFromStatus} IS NULL
      AND ${table.remainingWarningMinutes} IS NULL AND ${table.remainingBreachMinutes} IS NULL
    )`),
    check("crm_sla_instances_response_source_type_check", sql`${table.responseSourceType} IS NULL OR ${table.responseSourceType} IN ('message','activity','lead_status')`),
    check("crm_sla_instances_response_fields_check", sql`(
      ${table.respondedAt} IS NULL AND ${table.responseSourceType} IS NULL AND ${table.responseSourceId} IS NULL AND ${table.responseActorUserId} IS NULL
    ) OR (
      ${table.respondedAt} IS NOT NULL AND ${table.responseSourceType} IS NOT NULL AND ${table.responseSourceId} IS NOT NULL
    )`),
    check("crm_sla_instances_response_elapsed_minutes_check", sql`${table.responseElapsedMinutes} IS NULL OR ${table.responseElapsedMinutes} >= 0`),
    index("crm_sla_instances_response_reporting_idx").on(table.workspaceId, table.eventType, table.respondedAt).where(sql`${table.respondedAt} IS NOT NULL`),
    index("crm_sla_instances_accountability_idx").on(table.workspaceId, table.ownerMembershipId, table.queueId, table.startedAt),
  ],
);

export const crmSlaHistory = pgTable(
  "crm_sla_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id").notNull(),
    transition: varchar("transition", { length: 40 }).notNull(),
    fromStatus: varchar("from_status", { length: 30 }),
    toStatus: varchar("to_status", { length: 30 }).notNull(),
    reason: varchar("reason", { length: 1_000 }).notNull().default(""),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "crm_sla_history_instance_fk",
      columns: [table.workspaceId, table.instanceId],
      foreignColumns: [crmSlaInstances.workspaceId, crmSlaInstances.id],
    }).onDelete("restrict"),
    index("crm_sla_history_instance_idx").on(table.workspaceId, table.instanceId, table.occurredAt),
    check("crm_sla_history_transition_check", sql`${table.transition} IN ('migrated','started','warning','breached','paused','resumed','stopped','response_recorded','ownership_changed')`),
    check("crm_sla_history_from_status_check", sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('active','warning','breached','paused','stopped')`),
    check("crm_sla_history_to_status_check", sql`${table.toStatus} IN ('active','warning','breached','paused','stopped')`),
    check("crm_sla_history_evidence_check", sql`jsonb_typeof(${table.evidence}) = 'object'`),
  ],
);

export const crmActivities = pgTable(
  "crm_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    partyId: uuid("party_id").references(() => crmParties.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id"),
    slaInstanceId: uuid("sla_instance_id"),
    interactionDirection: varchar("interaction_direction", { length: 20 }),
    type: crmActivityType("type").notNull(),
    status: crmActivityStatus("status").notNull().default("pending"),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description"),
    ownerMembershipId: uuid("owner_membership_id").references(() => workspaceMemberships.id, { onDelete: "set null" }),
    priority: varchar("priority", { length: 20 }).notNull().default("normal"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completionOutcome: varchar("completion_outcome", { length: 120 }),
    isNextAction: boolean("is_next_action").notNull().default(false),
    customerVisible: boolean("customer_visible").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    foreignKey({
      name: "crm_activities_sla_instance_fk",
      columns: [table.workspaceId, table.slaInstanceId],
      foreignColumns: [crmSlaInstances.workspaceId, crmSlaInstances.id],
    }).onDelete("restrict"),
    uniqueIndex("crm_activities_sla_instance_uidx").on(table.workspaceId, table.slaInstanceId).where(sql`${table.slaInstanceId} IS NOT NULL`),
    check("crm_activities_interaction_direction_check", sql`${table.interactionDirection} IS NULL OR ${table.interactionDirection} IN ('inbound','outbound','internal')`),
    index("crm_activities_response_evidence_idx").on(table.workspaceId, table.leadId, table.interactionDirection, table.completedAt).where(sql`${table.status} = 'completed'`),
    index("crm_activities_owner_due_idx").on(table.workspaceId, table.ownerMembershipId, table.status, table.dueAt),
    index("crm_activities_lead_idx").on(table.workspaceId, table.leadId, table.createdAt),
    index("crm_activities_party_idx").on(table.workspaceId, table.partyId, table.createdAt),
  ],
);

export const crmAppointments = pgTable(
  "crm_appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id").notNull().references(() => crmActivities.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    location: jsonb("location").$type<Record<string, unknown>>().notNull().default({}),
    attendeePartyIds: jsonb("attendee_party_ids").$type<string[]>().notNull().default([]),
    attendeeMembershipIds: jsonb("attendee_membership_ids").$type<string[]>().notNull().default([]),
    externalCalendarReferences: jsonb("external_calendar_references").$type<Record<string, unknown>[]>().notNull().default([]),
    attendanceStatus: varchar("attendance_status", { length: 30 }).notNull().default("scheduled"),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("crm_appointments_activity_uidx").on(table.workspaceId, table.activityId),
    check("crm_appointments_time_check", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const crmConversations = pgTable(
  "crm_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    partyId: uuid("party_id").references(() => crmParties.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => crmLeads.id, { onDelete: "set null" }),
    channel: varchar("channel", { length: 40 }).notNull(),
    providerThreadId: varchar("provider_thread_id", { length: 500 }),
    subject: varchar("subject", { length: 500 }),
    status: varchar("status", { length: 30 }).notNull().default("open"),
    ownerMembershipId: uuid("owner_membership_id").references(() => workspaceMemberships.id, { onDelete: "set null" }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    unreadCount: integer("unread_count").notNull().default(0),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    index("crm_conversations_owner_idx").on(table.workspaceId, table.ownerMembershipId, table.lastMessageAt),
    uniqueIndex("crm_conversations_provider_uidx").on(table.workspaceId, table.channel, table.providerThreadId),
  ],
);

export const crmConversationParticipants = pgTable(
  "crm_conversation_participants",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull().references(() => crmConversations.id, { onDelete: "cascade" }),
    participantType: varchar("participant_type", { length: 30 }).notNull(),
    participantId: uuid("participant_id").notNull(),
    role: varchar("role", { length: 30 }).notNull().default("participant"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.participantType, table.participantId] })],
);

export const crmMessages = pgTable(
  "crm_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull().references(() => crmConversations.id, { onDelete: "cascade" }),
    direction: crmMessageDirection("direction").notNull(),
    status: crmMessageStatus("status").notNull().default("draft"),
    senderType: varchar("sender_type", { length: 30 }).notNull(),
    senderId: uuid("sender_id"),
    authorship: varchar("authorship", { length: 20 }).notNull().default("automation"),
    providerMessageId: varchar("provider_message_id", { length: 500 }),
    destinationReference: varchar("destination_reference", { length: 500 }),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    failureCode: varchar("failure_code", { length: 120 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    index("crm_messages_conversation_idx").on(table.workspaceId, table.conversationId, table.createdAt),
    uniqueIndex("crm_messages_provider_uidx").on(table.workspaceId, table.providerMessageId),
    check("crm_messages_authorship_check", sql`${table.authorship} IN ('human','automation','provider')`),
    check("crm_messages_human_author_check", sql`${table.authorship} <> 'human' OR (${table.senderType} = 'user' AND ${table.senderId} IS NOT NULL)`),
    index("crm_messages_response_evidence_idx").on(table.workspaceId, table.conversationId, table.direction, table.authorship, table.sentAt).where(sql`${table.direction} = 'outbound'`),
  ],
);

export const crmMessageAttachments = pgTable(
  "crm_message_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull().references(() => crmMessages.id, { onDelete: "cascade" }),
    objectKey: varchar("object_key", { length: 500 }).notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 120 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    checksum: varchar("checksum", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("crm_message_attachments_message_idx").on(table.workspaceId, table.messageId)],
);

export const crmSequences = pgTable(
  "crm_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    exitConditions: jsonb("exit_conditions").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [index("crm_sequences_status_idx").on(table.workspaceId, table.status)],
);

export const crmSequenceSteps = pgTable(
  "crm_sequence_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    sequenceId: uuid("sequence_id").notNull().references(() => crmSequences.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    type: varchar("type", { length: 40 }).notNull(),
    delayMinutes: integer("delay_minutes").notNull().default(0),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("crm_sequence_steps_position_uidx").on(table.workspaceId, table.sequenceId, table.position)],
);

export const crmSequenceEnrollments = pgTable(
  "crm_sequence_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    sequenceId: uuid("sequence_id").notNull().references(() => crmSequences.id),
    partyId: uuid("party_id").notNull().references(() => crmParties.id),
    leadId: uuid("lead_id").references(() => crmLeads.id, { onDelete: "set null" }),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    currentStep: integer("current_step").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    exitReason: varchar("exit_reason", { length: 80 }),
    enrolledBy: uuid("enrolled_by").references(() => users.id, { onDelete: "set null" }),
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [index("crm_sequence_enrollments_due_idx").on(table.workspaceId, table.status, table.nextRunAt)],
);

export const crmPipelines = pgTable(
  "crm_pipelines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    isDefault: boolean("is_default").notNull().default(false),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [uniqueIndex("crm_pipelines_code_uidx").on(table.workspaceId, table.code)],
);

export const crmPipelineStages = pgTable(
  "crm_pipeline_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id").notNull().references(() => crmPipelines.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    position: integer("position").notNull(),
    probability: numeric("probability", { precision: 5, scale: 2 }).notNull().default("0"),
    forecastCategory: varchar("forecast_category", { length: 40 }).notNull().default("pipeline"),
    entryRequirements: jsonb("entry_requirements").$type<Record<string, unknown>>().notNull().default({}),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("crm_pipeline_stages_code_uidx").on(table.workspaceId, table.pipelineId, table.code),
    uniqueIndex("crm_pipeline_stages_position_uidx").on(table.workspaceId, table.pipelineId, table.position),
    check("crm_pipeline_stage_probability_check", sql`${table.probability} >= 0 AND ${table.probability} <= 100`),
  ],
);

export const crmOpportunityCounters = pgTable("crm_opportunity_counters", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  lastValue: bigint("last_value", { mode: "bigint" }).notNull().default(0n),
}, table => [check("crm_opportunity_counters_last_value_check", sql`${table.lastValue} >= 0`)]);

export const crmOpportunities = pgTable(
  "crm_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    reference: varchar("reference", { length: 40 }).notNull(),
    legalEntityId: uuid("legal_entity_id").references(() => legalEntities.id, { onDelete: "set null" }),
    businessUnitId: uuid("business_unit_id").references(() => businessUnits.id, { onDelete: "set null" }),
    partyId: uuid("party_id").notNull().references(() => crmParties.id),
    leadId: uuid("lead_id").references(() => crmLeads.id, { onDelete: "set null" }),
    pipelineId: uuid("pipeline_id").notNull().references(() => crmPipelines.id),
    stageId: uuid("stage_id").notNull().references(() => crmPipelineStages.id),
    ownerMembershipId: uuid("owner_membership_id").references(() => workspaceMemberships.id, { onDelete: "set null" }),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description"),
    status: crmOpportunityStatus("status").notNull().default("open"),
    amount: numeric("amount", { precision: 20, scale: 4 }),
    currencyCode: varchar("currency_code", { length: 3 }).references(() => currencies.code),
    probability: numeric("probability", { precision: 5, scale: 2 }),
    forecastCategory: varchar("forecast_category", { length: 40 }).notNull().default("pipeline"),
    expectedCloseAt: timestamp("expected_close_at", { withTimezone: true }),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    pausedReason: varchar("paused_reason", { length: 160 }),
    outcomeReason: varchar("outcome_reason", { length: 160 }),
    competitor: varchar("competitor", { length: 160 }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reportingCurrencyCode: varchar("reporting_currency_code", { length: 3 }).references(() => currencies.code),
    reportingAmount: numeric("reporting_amount", { precision: 20, scale: 4 }),
    exchangeRate: numeric("exchange_rate", { precision: 24, scale: 12 }),
    exchangeRateAt: timestamp("exchange_rate_at", { withTimezone: true }),
    conversionOrigin: varchar("conversion_origin", { length: 30 }),
    conversionRequestHash: varchar("conversion_request_hash", { length: 64 }),
    qualificationEvidence: jsonb("qualification_evidence").$type<Record<string, unknown>>(),
    qualificationEvidenceHash: varchar("qualification_evidence_hash", { length: 64 }),
    convertedBy: uuid("converted_by").references(() => users.id, { onDelete: "set null" }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    index("crm_opportunities_stage_idx").on(table.workspaceId, table.pipelineId, table.stageId, table.status),
    index("crm_opportunities_owner_idx").on(table.workspaceId, table.ownerMembershipId, table.status),
    index("crm_opportunities_party_idx").on(table.workspaceId, table.partyId, table.createdAt),
    uniqueIndex("crm_opportunities_reference_uidx").on(table.workspaceId, table.reference),
    uniqueIndex("crm_opportunities_lead_uidx").on(table.workspaceId, table.leadId).where(sql`${table.leadId} IS NOT NULL`),
    check("crm_opportunities_amount_currency_check", sql`(${table.amount} IS NULL AND ${table.currencyCode} IS NULL) OR (${table.amount} IS NOT NULL AND ${table.currencyCode} IS NOT NULL)`),
    check("crm_opportunities_probability_check", sql`${table.probability} IS NULL OR (${table.probability} >= 0 AND ${table.probability} <= 100)`),
    check("crm_opportunities_conversion_origin_check", sql`${table.conversionOrigin} IS NULL OR ${table.conversionOrigin} IN ('legacy','lead_qualification','pre_project_start')`),
    check("crm_opportunities_conversion_request_hash_check", sql`${table.conversionRequestHash} IS NULL OR ${table.conversionRequestHash} ~ '^[0-9a-f]{64}$'`),
    check("crm_opportunities_qualification_evidence_check", sql`${table.qualificationEvidence} IS NULL OR jsonb_typeof(${table.qualificationEvidence}) = 'object'`),
    check("crm_opportunities_qualification_hash_check", sql`${table.qualificationEvidenceHash} IS NULL OR ${table.qualificationEvidenceHash} ~ '^[0-9a-f]{64}$'`),
    check("crm_opportunities_lead_conversion_check", sql`${table.leadId} IS NULL OR (
      ${table.conversionOrigin} IS NOT NULL AND ${table.conversionRequestHash} IS NOT NULL
      AND ${table.qualificationEvidence} IS NOT NULL AND ${table.qualificationEvidenceHash} IS NOT NULL
      AND ${table.convertedAt} IS NOT NULL
    )`),
  ],
);

export const crmOpportunityStakeholders = pgTable(
  "crm_opportunity_stakeholders",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").notNull().references(() => crmOpportunities.id, { onDelete: "cascade" }),
    partyId: uuid("party_id").notNull().references(() => crmParties.id),
    role: varchar("role", { length: 80 }).notNull(),
    influence: varchar("influence", { length: 30 }),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.opportunityId, table.partyId, table.role] })],
);

export const crmOpportunityTeam = pgTable(
  "crm_opportunity_team",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").notNull().references(() => crmOpportunities.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => workspaceMemberships.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.opportunityId, table.membershipId, table.role] })],
);

export const crmStageHistory = pgTable(
  "crm_stage_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").notNull().references(() => crmOpportunities.id, { onDelete: "cascade" }),
    fromStageId: uuid("from_stage_id").references(() => crmPipelineStages.id, { onDelete: "set null" }),
    toStageId: uuid("to_stage_id").references(() => crmPipelineStages.id, { onDelete: "set null" }),
    fromStatus: crmOpportunityStatus("from_status"),
    toStatus: crmOpportunityStatus("to_status").notNull(),
    reason: text("reason"),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("crm_stage_history_opportunity_idx").on(table.workspaceId, table.opportunityId, table.changedAt)],
);

export const crmForecastSnapshots = pgTable(
  "crm_forecast_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").notNull().references(() => crmOpportunities.id, { onDelete: "cascade" }),
    ownerMembershipId: uuid("owner_membership_id").references(() => workspaceMemberships.id, { onDelete: "set null" }),
    stageId: uuid("stage_id").references(() => crmPipelineStages.id, { onDelete: "set null" }),
    status: crmOpportunityStatus("status").notNull(),
    amount: numeric("amount", { precision: 20, scale: 4 }),
    currencyCode: varchar("currency_code", { length: 3 }),
    reportingAmount: numeric("reporting_amount", { precision: 20, scale: 4 }),
    reportingCurrencyCode: varchar("reporting_currency_code", { length: 3 }),
    probability: numeric("probability", { precision: 5, scale: 2 }),
    snapshotReason: varchar("snapshot_reason", { length: 80 }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("crm_forecast_snapshots_time_idx").on(table.workspaceId, table.capturedAt)],
);

export const crmProjectLinks = pgTable(
  "crm_project_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").notNull().references(() => crmOpportunities.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    mode: varchar("mode", { length: 30 }).notNull().default("pre_sales"),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ...versionColumn,
  },
  (table) => [
    uniqueIndex("crm_project_links_opportunity_uidx").on(table.workspaceId, table.opportunityId),
    uniqueIndex("crm_project_links_project_uidx").on(table.workspaceId, table.projectId),
  ],
);

export const crmTaxonomies = pgTable(
  "crm_taxonomies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [uniqueIndex("crm_taxonomies_code_uidx").on(table.workspaceId, table.code)],
);

export const crmTaxonomyOptions = pgTable(
  "crm_taxonomy_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    taxonomyId: uuid("taxonomy_id").notNull().references(() => crmTaxonomies.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 80 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    position: integer("position").notNull().default(0),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [uniqueIndex("crm_taxonomy_options_code_uidx").on(table.workspaceId, table.taxonomyId, table.code)],
);

export const crmCustomFieldDefinitions = pgTable(
  "crm_custom_field_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 60 }).notNull(),
    key: varchar("key", { length: 80 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    dataType: varchar("data_type", { length: 30 }).notNull(),
    required: boolean("required").notNull().default(false),
    searchable: boolean("searchable").notNull().default(false),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [uniqueIndex("crm_custom_field_definitions_key_uidx").on(table.workspaceId, table.entityType, table.key)],
);

export const crmCustomFieldValues = pgTable(
  "crm_custom_field_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id").notNull().references(() => crmCustomFieldDefinitions.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 60 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    valueText: text("value_text"),
    valueNumber: numeric("value_number", { precision: 30, scale: 10 }),
    valueBoolean: boolean("value_boolean"),
    valueTimestamp: timestamp("value_timestamp", { withTimezone: true }),
    valueJson: jsonb("value_json").$type<unknown>(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("crm_custom_field_values_entity_uidx").on(table.workspaceId, table.definitionId, table.entityType, table.entityId),
    index("crm_custom_field_values_text_idx").on(table.workspaceId, table.definitionId, table.valueText),
    check("crm_custom_field_values_one_value_check", sql`num_nonnulls(${table.valueText}, ${table.valueNumber}, ${table.valueBoolean}, ${table.valueTimestamp}, ${table.valueJson}) = 1`),
  ],
);

export const crmQualificationForms = pgTable(
  "crm_qualification_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    serviceType: varchar("service_type", { length: 100 }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("crm_qualification_forms_code_uidx").on(table.workspaceId, table.code),
    uniqueIndex("crm_qualification_forms_active_scope_uidx")
      .on(table.workspaceId, sql`COALESCE(${table.serviceType}, '')`).where(sql`${table.status} = 'active'`),
    check("crm_qualification_forms_status_check", sql`${table.status} IN ('draft','active','archived')`),
  ],
);

export const crmQualificationQuestions = pgTable(
  "crm_qualification_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    formId: uuid("form_id").notNull().references(() => crmQualificationForms.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 100 }).notNull(),
    label: varchar("label", { length: 240 }).notNull(),
    dataType: varchar("data_type", { length: 30 }).notNull(),
    required: boolean("required").notNull().default(false),
    position: integer("position").notNull(),
    scoring: jsonb("scoring").$type<Record<string, unknown>>().notNull().default({}),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("crm_qualification_questions_key_uidx").on(table.workspaceId, table.formId, table.key),
    uniqueIndex("crm_qualification_questions_position_uidx").on(table.workspaceId, table.formId, table.position),
    check("crm_qualification_questions_data_type_check", sql`${table.dataType} IN ('text','number','boolean','date','select','multi_select')`),
    check("crm_qualification_questions_scoring_check", sql`jsonb_typeof(${table.scoring}) = 'object'`),
    check("crm_qualification_questions_configuration_check", sql`jsonb_typeof(${table.configuration}) = 'object'`),
  ],
);

export const crmSavedViews = pgTable(
  "crm_saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 60 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    ownerMembershipId: uuid("owner_membership_id").references(() => workspaceMemberships.id, { onDelete: "cascade" }),
    isShared: boolean("is_shared").notNull().default(false),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [index("crm_saved_views_owner_idx").on(table.workspaceId, table.entityType, table.ownerMembershipId)],
);

export const automationDefinitions = pgTable(
  "automation_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 100 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    status: automationDefinitionStatus("status").notNull().default("draft"),
    activeVersionId: uuid("active_version_id"),
    runOncePerAggregate: boolean("run_once_per_aggregate").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [uniqueIndex("automation_definitions_code_uidx").on(table.workspaceId, table.code)],
);

export const automationVersions = pgTable(
  "automation_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id").notNull().references(() => automationDefinitions.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    checksum: varchar("checksum", { length: 64 }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("automation_versions_number_uidx").on(table.workspaceId, table.definitionId, table.versionNumber)],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id").notNull().references(() => automationDefinitions.id),
    versionId: uuid("version_id").notNull().references(() => automationVersions.id),
    triggerEventId: uuid("trigger_event_id").notNull(),
    aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    status: automationRunStatus("status").notNull().default("queued"),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    currentStepKey: varchar("current_step_key", { length: 100 }),
    correlationId: uuid("correlation_id").notNull(),
    causationId: uuid("causation_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureCode: varchar("failure_code", { length: 120 }),
    failureMessage: text("failure_message"),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("automation_runs_trigger_uidx").on(table.workspaceId, table.definitionId, table.triggerEventId, table.aggregateId),
    index("automation_runs_status_idx").on(table.workspaceId, table.status, table.createdAt),
  ],
);

export const automationStepRuns = pgTable(
  "automation_step_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => automationRuns.id, { onDelete: "cascade" }),
    stepKey: varchar("step_key", { length: 100 }).notNull(),
    attempt: integer("attempt").notNull().default(1),
    status: varchar("status", { length: 30 }).notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown>>(),
    error: jsonb("error").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("automation_step_runs_attempt_uidx").on(table.workspaceId, table.runId, table.stepKey, table.attempt)],
);

export const automationWaits = pgTable(
  "automation_waits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => automationRuns.id, { onDelete: "cascade" }),
    stepKey: varchar("step_key", { length: 100 }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("waiting"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [index("automation_waits_due_idx").on(table.status, table.dueAt)],
);

export const automationApprovals = pgTable(
  "automation_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => automationRuns.id, { onDelete: "cascade" }),
    stepKey: varchar("step_key", { length: 100 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    proposedAction: jsonb("proposed_action").$type<Record<string, unknown>>().notNull(),
    requestedFromMembershipId: uuid("requested_from_membership_id").references(() => workspaceMemberships.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decisionReason: text("decision_reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [index("automation_approvals_pending_idx").on(table.workspaceId, table.status, table.createdAt)],
);

export const notificationPolicies = pgTable(
  "notification_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    channels: jsonb("channels").$type<string[]>().notNull(),
    conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default({}),
    quietHours: jsonb("quiet_hours").$type<Record<string, unknown>>().notNull().default({}),
    frequencyLimit: jsonb("frequency_limit").$type<Record<string, unknown>>().notNull().default({}),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [index("notification_policies_event_idx").on(table.workspaceId, table.eventType, table.status)],
);

export const notificationTemplates = pgTable(
  "notification_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 100 }).notNull(),
    channel: varchar("channel", { length: 40 }).notNull(),
    locale: varchar("locale", { length: 35 }).notNull(),
    versionNumber: integer("version_number").notNull().default(1),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    subjectTemplate: text("subject_template"),
    bodyTemplate: text("body_template").notNull(),
    variables: jsonb("variables").$type<string[]>().notNull().default([]),
    providerTemplateId: varchar("provider_template_id", { length: 255 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    ...auditColumns,
  },
  (table) => [uniqueIndex("notification_templates_version_uidx").on(table.workspaceId, table.code, table.channel, table.locale, table.versionNumber)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    policyId: uuid("policy_id").references(() => notificationPolicies.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => notificationTemplates.id, { onDelete: "set null" }),
    recipientType: varchar("recipient_type", { length: 30 }).notNull(),
    recipientId: uuid("recipient_id").notNull(),
    channel: varchar("channel", { length: 40 }).notNull(),
    eventType: varchar("event_type", { length: 120 }).notNull().default("service"),
    status: notificationStatus("status").notNull().default("pending"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    subject: text("subject"),
    body: text("body").notNull(),
    deepLink: text("deep_link"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    correlationId: uuid("correlation_id").notNull(),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    suppressedReason: varchar("suppressed_reason", { length: 120 }),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("notifications_idempotency_uidx").on(table.workspaceId, table.idempotencyKey),
    index("notifications_delivery_idx").on(table.status, table.scheduledFor),
    index("notifications_recovery_idx").on(table.workspaceId, table.status, table.processingStartedAt),
    index("notifications_recipient_idx").on(table.workspaceId, table.recipientType, table.recipientId, table.createdAt),
    index("notifications_frequency_idx").on(table.workspaceId, table.policyId, table.recipientType, table.recipientId, table.channel, table.createdAt),
  ],
);

export const notificationDeliveryAttempts = pgTable(
  "notification_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    notificationId: uuid("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    provider: varchar("provider", { length: 60 }).notNull(),
    status: varchar("status", { length: 30 }).notNull(),
    providerMessageId: varchar("provider_message_id", { length: 500 }),
    errorCode: varchar("error_code", { length: 120 }),
    errorMessage: text("error_message"),
    retryAt: timestamp("retry_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("notification_delivery_attempt_uidx").on(table.workspaceId, table.notificationId, table.attempt)],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    recipientType: varchar("recipient_type", { length: 30 }).notNull(),
    recipientId: uuid("recipient_id").notNull(),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    channel: varchar("channel", { length: 40 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    quietHours: jsonb("quiet_hours").$type<Record<string, unknown>>().notNull().default({}),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [uniqueIndex("notification_preferences_scope_uidx").on(table.workspaceId, table.recipientType, table.recipientId, table.eventType, table.channel)],
);

export const notificationDeviceConsents = pgTable(
  "notification_device_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    installationId: uuid("installation_id").notNull(),
    lastRequestId: uuid("last_request_id").notNull(),
    platform: varchar("platform", { length: 30 }).notNull(),
    permissionStatus: varchar("permission_status", { length: 30 }).notNull(),
    locale: varchar("locale", { length: 35 }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    permissionUpdatedAt: timestamp("permission_updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [uniqueIndex("notification_device_consents_installation_uidx").on(table.workspaceId, table.userId, table.installationId)],
);

export const deviceEndpoints = pgTable(
  "device_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    installationId: uuid("installation_id").notNull(),
    lastRequestId: uuid("last_request_id").notNull(),
    platform: varchar("platform", { length: 30 }).notNull(),
    tokenType: varchar("token_type", { length: 20 }).notNull().default("expo"),
    consentId: uuid("consent_id").references(() => notificationDeviceConsents.id, { onDelete: "set null" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    encryptedTokenReference: varchar("encrypted_token_reference", { length: 500 }).notNull(),
    locale: varchar("locale", { length: 35 }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...versionColumn,
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("device_endpoints_token_uidx").on(table.workspaceId, table.tokenHash),
    uniqueIndex("device_endpoints_installation_uidx").on(table.workspaceId, table.userId, table.installationId),
  ],
);

export type CrmParty = typeof crmParties.$inferSelect;
export type CrmLead = typeof crmLeads.$inferSelect;
export type CrmOpportunity = typeof crmOpportunities.$inferSelect;

export const crmLeadForms = pgTable("crm_lead_forms", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 64 }).notNull().unique(),
  draft: jsonb("draft").notNull(), published: jsonb("published"),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").references(() => users.id),
  ...auditColumns,
}, table => [index("crm_lead_forms_workspace_idx").on(table.workspaceId, table.updatedAt), check("crm_lead_forms_status_check", sql`${table.status} IN ('draft','published','paused')`)]);
