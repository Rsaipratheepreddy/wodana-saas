import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { workspaceCatalogRecords } from "./catalog.schema";
import { crmOpportunities } from "./crm.schema";
import { users, workspaceMemberships, workspaces } from "./schema";

export const preProjectCases = pgTable("pre_project_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  opportunityId: uuid("opportunity_id").notNull().references(() => crmOpportunities.id),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  phase: varchar("phase", { length: 20 }).notNull().default("discover"),
  version: integer("version").notNull().default(1),
  ownerMembershipId: uuid("owner_membership_id"),
  targetDate: date("target_date"),
  priority: varchar("priority", { length: 16 }).notNull().default("normal"),
  riskLevel: varchar("risk_level", { length: 16 }).notNull().default("none"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  holdReason: varchar("hold_reason", { length: 500 }),
  heldAt: timestamp("held_at", { withTimezone: true }),
  heldBy: uuid("held_by").references(() => users.id),
  cancellationReason: varchar("cancellation_reason", { length: 500 }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releasedBy: uuid("released_by").references(() => users.id),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("pre_project_cases_workspace_id_id_key").on(table.workspaceId, table.id),
  uniqueIndex("pre_project_cases_workspace_id_opportunity_id_key").on(table.workspaceId, table.opportunityId),
  index("pre_project_cases_workspace_updated_idx").on(table.workspaceId, table.updatedAt.desc(), table.id.desc()),
  index("pre_project_cases_owner_status_idx").on(table.workspaceId, table.ownerMembershipId, table.status, table.updatedAt.desc()),
  index("pre_project_cases_target_date_idx").on(table.workspaceId, table.status, table.targetDate).where(sql`${table.targetDate} IS NOT NULL`),
  foreignKey({ name: "pre_project_cases_owner_membership_fk", columns: [table.workspaceId, table.ownerMembershipId], foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.id] }),
  check("pre_project_cases_status_check", sql`${table.status} IN ('draft', 'active', 'on_hold', 'released', 'cancelled')`),
  check("pre_project_cases_phase_check", sql`${table.phase} IN ('discover', 'define', 'design', 'price', 'agree', 'release')`),
  check("pre_project_cases_version_check", sql`${table.version} > 0`),
  check("pre_project_cases_priority_check", sql`${table.priority} IN ('low', 'normal', 'high', 'urgent')`),
  check("pre_project_cases_risk_check", sql`${table.riskLevel} IN ('none', 'low', 'medium', 'high', 'critical')`),
  check("pre_project_cases_hold_state_check", sql`(${table.status} = 'on_hold' AND ${table.heldAt} IS NOT NULL AND ${table.heldBy} IS NOT NULL AND ${table.holdReason} IS NOT NULL AND length(trim(${table.holdReason})) > 0) OR (${table.status} <> 'on_hold' AND ${table.heldAt} IS NULL AND ${table.heldBy} IS NULL AND ${table.holdReason} IS NULL)`),
  check("pre_project_cases_cancel_state_check", sql`(${table.status} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL AND ${table.cancellationReason} IS NOT NULL AND length(trim(${table.cancellationReason})) > 0) OR (${table.status} <> 'cancelled' AND ${table.cancelledAt} IS NULL AND ${table.cancelledBy} IS NULL AND ${table.cancellationReason} IS NULL)`),
  check("pre_project_cases_release_state_check", sql`(${table.status} = 'released' AND ${table.phase} = 'release' AND ${table.releasedAt} IS NOT NULL) OR (${table.status} <> 'released' AND ${table.releasedAt} IS NULL AND ${table.releasedBy} IS NULL)`),
]);

export const preProjectLifecycleCommands = pgTable("pre_project_lifecycle_commands", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull(),
  caseId: uuid("case_id").notNull(),
  action: varchar("action", { length: 40 }).notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.requestId] }),
  foreignKey({ columns: [table.workspaceId, table.caseId], foreignColumns: [preProjectCases.workspaceId, preProjectCases.id] }),
  index("pre_project_lifecycle_commands_case_idx").on(table.workspaceId, table.caseId, table.createdAt.desc()),
  check("pre_project_lifecycle_commands_action_check", sql`length(trim(${table.action})) > 0`),
  check("pre_project_lifecycle_commands_hash_check", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  check("pre_project_lifecycle_commands_response_check", sql`${table.responseBody} IS NULL OR jsonb_typeof(${table.responseBody}) = 'object'`),
]);

// Definitions mirror the additive brief, design and specification migrations.
const caseColumns = () => ({ workspaceId: uuid("workspace_id").notNull(), caseId: uuid("case_id").notNull() });
const createdColumns = () => ({ createdBy: uuid("created_by").notNull().references(() => users.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow() });
/** Written by staff, or by a client portal contact (then no staff author; 0137_client_portal_v2). */
const clientAuthoredColumns = () => ({ createdBy: uuid("created_by").references(() => users.id), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  clientGrantId: uuid("client_grant_id") });
const caseForeignKey =(t: { workspaceId: import("drizzle-orm/pg-core").AnyPgColumn; caseId: import("drizzle-orm/pg-core").AnyPgColumn }) => foreignKey({ columns: [t.workspaceId, t.caseId], foreignColumns: [preProjectCases.workspaceId, preProjectCases.id] });

export const preProjectBriefs = pgTable("pre_project_briefs", {
  caseId: uuid("case_id").primaryKey(), workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  content: jsonb("content").notNull().default({}), version: integer("version").notNull().default(1),
  updatedBy: uuid("updated_by").notNull().references(() => users.id), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [caseForeignKey(t), check("pre_project_briefs_version_check", sql`${t.version}>0`)]);

export const preProjectRooms = pgTable("pre_project_rooms", {
  id: uuid("id").primaryKey(), ...caseColumns(), name: varchar("name", { length: 120 }).notNull(), version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), catalogRecordId: uuid("catalog_record_id"), catalogSnapshot: jsonb("catalog_snapshot"),
}, t => [caseForeignKey(t), unique().on(t.workspaceId,t.caseId,t.id), uniqueIndex("pre_project_rooms_name_key").on(t.workspaceId,t.caseId,sql`lower(${t.name})`),
  foreignKey({name:"pre_project_room_catalog_fk", columns:[t.workspaceId,t.catalogRecordId],foreignColumns:[workspaceCatalogRecords.workspaceId,workspaceCatalogRecords.id]}),
  check("pre_project_rooms_name_check",sql`length(trim(${t.name}))>0`),check("pre_project_rooms_version_check",sql`${t.version}>0`)]);

export const preProjectBriefEntries = pgTable("pre_project_brief_entries", {
  id:uuid("id").primaryKey(),...caseColumns(),roomId:uuid("room_id"),kind:varchar("kind",{length:20}).notNull(),title:varchar("title",{length:240}).notNull(),
  noteDocument:jsonb("note_document"),pinned:boolean("pinned").notNull().default(false),
  note:text("note").notNull().default(""),category:varchar("category",{length:60}).notNull().default("General"),priority:varchar("priority",{length:20}).notNull().default("preferred"),
  scopeStatus:varchar("scope_status",{length:20}).notNull().default("undecided"),reviewStatus:varchar("review_status",{length:20}).notNull().default("captured"),
  quantity:numeric("quantity",{precision:16,scale:4}),unit:varchar("unit",{length:20}).notNull().default("nos"),referenceUrl:varchar("reference_url",{length:2000}).notNull().default(""),
  avoid:text("avoid").notNull().default(""),source:varchar("source",{length:20}).notNull().default("team"),version:integer("version").notNull().default(1),...clientAuthoredColumns(),
  updatedBy:uuid("updated_by").references(()=>users.id),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),archivedAt:timestamp("archived_at",{withTimezone:true}),
},t=>[caseForeignKey(t),unique().on(t.workspaceId,t.caseId,t.id),
  foreignKey({columns:[t.workspaceId,t.caseId,t.roomId],foreignColumns:[preProjectRooms.workspaceId,preProjectRooms.caseId,preProjectRooms.id]}),
  index("pre_project_brief_entries_case_idx").on(t.workspaceId,t.caseId,t.updatedAt.desc()),
  check("pre_project_brief_entries_kind_check",sql`${t.kind} IN ('requirement','note','inspiration','file')`),check("pre_project_brief_entries_title_check",sql`length(trim(${t.title}))>0`),
  check("pre_project_brief_entries_priority_check",sql`${t.priority} IN ('must_have','preferred','optional')`),check("pre_project_brief_entries_scope_status_check",sql`${t.scopeStatus} IN ('included','excluded','undecided')`),
  check("pre_project_brief_entries_review_status_check",sql`${t.reviewStatus} IN ('captured','reviewed','clarification')`),check("pre_project_brief_entries_source_check",sql`${t.source} IN ('team','client')`),
  check("pre_project_brief_entries_quantity_check",sql`${t.quantity}>0`),check("pre_project_brief_entries_version_check",sql`${t.version}>0`)]);

export const preProjectBriefAssets = pgTable("pre_project_brief_assets",{
  id:uuid("id").primaryKey(),...caseColumns(),originalName:varchar("original_name",{length:240}).notNull(),mimeType:varchar("mime_type",{length:100}).notNull(),byteSize:integer("byte_size").notNull(),
  objectKey:text("object_key").notNull().unique(),previewKey:text("preview_key"),sha256:varchar("sha256",{length:64}).notNull(),...clientAuthoredColumns(),
},t=>[caseForeignKey(t),unique().on(t.workspaceId,t.caseId,t.id),check("pre_project_brief_assets_byte_size_check",sql`${t.byteSize}>0 AND ${t.byteSize}<=20971520`)]);

export const preProjectEntryAssets = pgTable("pre_project_entry_assets",{
  ...caseColumns(),entryId:uuid("entry_id").notNull(),assetId:uuid("asset_id").notNull(),
},t=>[primaryKey({columns:[t.entryId,t.assetId]}),
  foreignKey({columns:[t.workspaceId,t.caseId,t.entryId],foreignColumns:[preProjectBriefEntries.workspaceId,preProjectBriefEntries.caseId,preProjectBriefEntries.id]}),
  foreignKey({columns:[t.workspaceId,t.caseId,t.assetId],foreignColumns:[preProjectBriefAssets.workspaceId,preProjectBriefAssets.caseId,preProjectBriefAssets.id]})]);

export const preProjectScopeLinks = pgTable("pre_project_scope_links",{
  ...caseColumns(),entryId:uuid("entry_id").notNull(),role:varchar("role",{length:20}).notNull(),recordId:uuid("record_id").notNull(),snapshot:jsonb("snapshot").notNull(),
},t=>[primaryKey({columns:[t.workspaceId,t.entryId,t.role]}),
  foreignKey({columns:[t.workspaceId,t.caseId,t.entryId],foreignColumns:[preProjectBriefEntries.workspaceId,preProjectBriefEntries.caseId,preProjectBriefEntries.id]}),
  foreignKey({columns:[t.workspaceId,t.recordId],foreignColumns:[workspaceCatalogRecords.workspaceId,workspaceCatalogRecords.id]}),
  check("pre_project_scope_links_role_check",sql`${t.role} IN ('work','variant','material','brand','finish','unit','execution')`)]);

export const oneTreeNodes = pgTable("one_tree_nodes", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull(),
  caseId: uuid("case_id").notNull(),
  parentId: uuid("parent_id"),
  kind: varchar("kind", { length: 12 }).notNull(),
  sourceType: varchar("source_type", { length: 20 }).notNull(),
  sourceId: uuid("source_id").notNull(),
  status: varchar("status", { length: 12 }).notNull().default("active"),
  version: integer("version").notNull().default(1),
  replacesNodeId: uuid("replaces_node_id"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, t => [
  unique().on(t.workspaceId, t.id),
  unique().on(t.workspaceId, t.caseId, t.sourceType, t.sourceId),
  foreignKey({ columns: [t.workspaceId, t.caseId], foreignColumns: [preProjectCases.workspaceId, preProjectCases.id] }),
  foreignKey({ columns: [t.workspaceId, t.parentId], foreignColumns: [t.workspaceId, t.id] }),
  foreignKey({ columns: [t.workspaceId, t.replacesNodeId], foreignColumns: [t.workspaceId, t.id] }),
  index("one_tree_nodes_job_idx").on(t.workspaceId, t.jobId, t.kind, t.status, t.createdAt, t.id),
  index("one_tree_nodes_case_idx").on(t.workspaceId, t.caseId, t.parentId, t.kind, t.status),
  check("one_tree_nodes_kind_check", sql`${t.kind} IN ('site','room','zone','item')`),
  check("one_tree_nodes_source_type_check", sql`${t.sourceType} IN ('case','room','brief_entry','manual')`),
  check("one_tree_nodes_status_check", sql`${t.status} IN ('active','archived')`),
  check("one_tree_nodes_version_check", sql`${t.version}>0`),
]);

export const oneTreeNodeRevisions = pgTable("one_tree_node_revisions", {
  workspaceId: uuid("workspace_id").notNull(),
  nodeId: uuid("node_id").notNull(),
  revision: integer("revision").notNull(),
  sourceVersion: integer("source_version").notNull(),
  sourceHash: varchar("source_hash", { length: 64 }).notNull(),
  label: varchar("label", { length: 240 }).notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.workspaceId, t.nodeId, t.revision] }),
  unique().on(t.workspaceId, t.nodeId, t.sourceHash),
  foreignKey({ columns: [t.workspaceId, t.nodeId], foreignColumns: [oneTreeNodes.workspaceId, oneTreeNodes.id] }),
  index("one_tree_node_revisions_latest_idx").on(t.workspaceId, t.nodeId, t.revision.desc()),
  check("one_tree_node_revisions_source_version_check", sql`${t.sourceVersion}>=0`),
]);

export const preProjectDesignFolders = pgTable("pre_project_design_folders",{
 reviewerId:uuid("reviewer_id"),approvedVersions:jsonb("approved_versions"),approvedAt:timestamp("approved_at",{withTimezone:true}),
 id:uuid("id").primaryKey(),...caseColumns(),name:varchar("name",{length:160}).notNull(),description:text("description").notNull().default(""),roomId:uuid("room_id"),scopeEntryId:uuid("scope_entry_id"),version:integer("version").notNull().default(1),...createdColumns(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[unique().on(t.workspaceId,t.caseId,t.id),uniqueIndex("pre_project_design_folders_name_key").on(t.workspaceId,t.caseId,sql`lower(${t.name})`),
 index("pre_project_design_folders_context_idx").on(t.workspaceId,t.caseId,t.roomId,t.scopeEntryId),
 foreignKey({columns:[t.workspaceId,t.caseId],foreignColumns:[preProjectCases.workspaceId,preProjectCases.id]}),foreignKey({columns:[t.workspaceId,t.caseId,t.roomId],foreignColumns:[preProjectRooms.workspaceId,preProjectRooms.caseId,preProjectRooms.id]}),foreignKey({columns:[t.workspaceId,t.caseId,t.scopeEntryId],foreignColumns:[preProjectBriefEntries.workspaceId,preProjectBriefEntries.caseId,preProjectBriefEntries.id]}),check("pre_project_design_folders_name_check",sql`length(trim(${t.name}))>0`),check("pre_project_design_folders_version_check",sql`${t.version}>0`)]);

export const preProjectDesigns = pgTable("pre_project_designs",{
  folderId:uuid("folder_id"),
  id:uuid("id").primaryKey(),...caseColumns(),roomId:uuid("room_id"),scopeEntryId:uuid("scope_entry_id"),title:varchar("title",{length:240}).notNull(),documentType:varchar("document_type",{length:60}).notNull(),stage:varchar("stage",{length:30}),
  description:text("description").notNull().default(""),version:integer("version").notNull().default(1),archivedAt:timestamp("archived_at",{withTimezone:true}),...createdColumns(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[foreignKey({columns:[t.workspaceId,t.caseId,t.folderId],foreignColumns:[preProjectDesignFolders.workspaceId,preProjectDesignFolders.caseId,preProjectDesignFolders.id]}),caseForeignKey(t),unique().on(t.workspaceId,t.caseId,t.id),index("pre_project_designs_case_idx").on(t.workspaceId,t.caseId,t.updatedAt.desc()),
  foreignKey({columns:[t.workspaceId,t.caseId,t.roomId],foreignColumns:[preProjectRooms.workspaceId,preProjectRooms.caseId,preProjectRooms.id]}),
  foreignKey({columns:[t.workspaceId,t.caseId,t.scopeEntryId],foreignColumns:[preProjectBriefEntries.workspaceId,preProjectBriefEntries.caseId,preProjectBriefEntries.id]}),
  check("pre_project_designs_title_check",sql`length(trim(${t.title}))>0`),check("pre_project_designs_version_check",sql`${t.version}>0`)]);

export const preProjectDesignVersions = pgTable("pre_project_design_versions",{
  reviewerId:uuid("reviewer_id").references(()=>users.id),
  id:uuid("id").primaryKey(),...caseColumns(),designId:uuid("design_id").notNull(),number:integer("number").notNull(),assetId:uuid("asset_id").notNull(),note:text("note").notNull().default(""),
  includedClientRounds:smallint("included_client_rounds"),clientReviewExpiresAt:timestamp("client_review_expires_at",{withTimezone:true}),status:varchar("status",{length:30}).notNull().default("draft"),...createdColumns(),
},t=>[unique().on(t.workspaceId,t.caseId,t.designId,t.id),unique().on(t.designId,t.number),uniqueIndex("pre_project_design_versions_case_id_key").on(t.workspaceId,t.caseId,t.id),
  index("pre_project_design_versions_review_expiry_idx").on(t.workspaceId,t.status,t.clientReviewExpiresAt).where(sql`${t.status}='client_review'`),
  foreignKey({columns:[t.workspaceId,t.caseId,t.designId],foreignColumns:[preProjectDesigns.workspaceId,preProjectDesigns.caseId,preProjectDesigns.id]}),
  foreignKey({columns:[t.workspaceId,t.caseId,t.assetId],foreignColumns:[preProjectBriefAssets.workspaceId,preProjectBriefAssets.caseId,preProjectBriefAssets.id]}),
  check("pre_project_design_versions_number_check",sql`${t.number}>0`),check("pre_project_design_versions_client_rounds_check",sql`${t.includedClientRounds} IS NULL OR ${t.includedClientRounds} BETWEEN 0 AND 99`),check("pre_project_design_versions_status_check",sql`${t.status} IN ('draft','internal_review','internal_approved','client_review','approved','changes_requested','rejected')`)]);

export const preProjectDesignActivity = pgTable("pre_project_design_activity",{
  reviewerId:uuid("reviewer_id").references(()=>users.id),decisionSource:varchar("decision_source",{length:30}),decisionAt:timestamp("decision_at",{withTimezone:true}),
  id:uuid("id").primaryKey(),...caseColumns(),designId:uuid("design_id").notNull(),versionId:uuid("version_id").notNull(),action:varchar("action",{length:30}).notNull(),note:text("note").notNull().default(""),decisionBy:varchar("decision_by",{length:240}).notNull().default(""),...createdColumns(),
},t=>[foreignKey({columns:[t.workspaceId,t.caseId,t.designId,t.versionId],foreignColumns:[preProjectDesignVersions.workspaceId,preProjectDesignVersions.caseId,preProjectDesignVersions.designId,preProjectDesignVersions.id]}),
  index("pre_project_design_activity_idx").on(t.workspaceId,t.caseId,t.designId,t.createdAt),check("pre_project_design_activity_action_check",sql`${t.action} IN ('comment','internal_review','internal_approved','client_review','approved','changes_requested')`)]);

export const preProjectItemSpecifications = pgTable("pre_project_item_specifications",{
  ...caseColumns(),entryId:uuid("entry_id").notNull(),version:integer("version").notNull(),content:jsonb("content").notNull(),...createdColumns(),
},t=>[primaryKey({columns:[t.workspaceId,t.caseId,t.entryId,t.version]}),check("pre_project_item_specifications_version_check",sql`${t.version}>0`),
  foreignKey({columns:[t.workspaceId,t.caseId,t.entryId],foreignColumns:[preProjectBriefEntries.workspaceId,preProjectBriefEntries.caseId,preProjectBriefEntries.id]})]);

export const preProjectSpecificationCatalogRefs = pgTable("pre_project_specification_catalog_refs",{
  ...caseColumns(),entryId:uuid("entry_id").notNull(),version:integer("version").notNull(),recordId:uuid("record_id").notNull(),
},t=>[primaryKey({columns:[t.workspaceId,t.caseId,t.entryId,t.version,t.recordId]}),
  foreignKey({columns:[t.workspaceId,t.caseId,t.entryId,t.version],foreignColumns:[preProjectItemSpecifications.workspaceId,preProjectItemSpecifications.caseId,preProjectItemSpecifications.entryId,preProjectItemSpecifications.version]}),
  foreignKey({columns:[t.workspaceId,t.recordId],foreignColumns:[workspaceCatalogRecords.workspaceId,workspaceCatalogRecords.id]})]);

export const preProjectItemDesignRefs = pgTable("pre_project_item_design_refs",{
  ...caseColumns(),entryId:uuid("entry_id").notNull(),version:integer("version").notNull(),designVersionId:uuid("design_version_id").notNull(),usage:varchar("usage",{length:10}).notNull(),sheet:varchar("sheet",{length:120}).notNull().default(""),
},t=>[primaryKey({columns:[t.workspaceId,t.caseId,t.entryId,t.version,t.designVersionId]}),
  foreignKey({columns:[t.workspaceId,t.caseId,t.entryId,t.version],foreignColumns:[preProjectItemSpecifications.workspaceId,preProjectItemSpecifications.caseId,preProjectItemSpecifications.entryId,preProjectItemSpecifications.version]}),
  foreignKey({columns:[t.workspaceId,t.caseId,t.designVersionId],foreignColumns:[preProjectDesignVersions.workspaceId,preProjectDesignVersions.caseId,preProjectDesignVersions.id]}),check("pre_project_item_design_refs_usage_check",sql`${t.usage} IN ('2d','3d','reference')`)]);

export const preProjectDesignThreads=pgTable('pre_project_design_threads',{
 anchor:jsonb('anchor'),mentions:jsonb('mentions').notNull().default([]),
 id:uuid('id').primaryKey(),...caseColumns(),designId:uuid('design_id').notNull(),versionId:uuid('version_id').notNull(),title:varchar('title',{length:240}).notNull(),blocking:boolean('blocking').notNull().default(false),status:varchar('status',{length:12}).notNull().default('open'),version:integer('version').notNull().default(1),...createdColumns(),resolvedBy:uuid('resolved_by').references(()=>users.id),resolvedAt:timestamp('resolved_at',{withTimezone:true}),
},t=>[unique().on(t.workspaceId,t.caseId,t.designId,t.id),foreignKey({columns:[t.workspaceId,t.caseId,t.designId,t.versionId],foreignColumns:[preProjectDesignVersions.workspaceId,preProjectDesignVersions.caseId,preProjectDesignVersions.designId,preProjectDesignVersions.id]}),index('pre_project_design_threads_revision_idx').on(t.workspaceId,t.caseId,t.designId,t.versionId)]);
export const preProjectDesignMessages=pgTable('pre_project_design_messages',{
 id:uuid('id').primaryKey(),...caseColumns(),designId:uuid('design_id').notNull(),threadId:uuid('thread_id').notNull(),body:text('body').notNull(),...createdColumns(),
},t=>[foreignKey({columns:[t.workspaceId,t.caseId,t.designId,t.threadId],foreignColumns:[preProjectDesignThreads.workspaceId,preProjectDesignThreads.caseId,preProjectDesignThreads.designId,preProjectDesignThreads.id]}),index('pre_project_design_messages_thread_idx').on(t.workspaceId,t.threadId,t.createdAt)]);

export const preProjectAssetMarkups=pgTable("pre_project_asset_markups",{
 ...caseColumns(),assetId:uuid("asset_id").primaryKey(),sourceAssetId:uuid("source_asset_id").notNull(),strokes:jsonb("strokes").notNull(),inputHash:varchar("input_hash",{length:64}).notNull(),
},t=>[foreignKey({columns:[t.workspaceId,t.caseId,t.assetId],foreignColumns:[preProjectBriefAssets.workspaceId,preProjectBriefAssets.caseId,preProjectBriefAssets.id]}),foreignKey({columns:[t.workspaceId,t.caseId,t.sourceAssetId],foreignColumns:[preProjectBriefAssets.workspaceId,preProjectBriefAssets.caseId,preProjectBriefAssets.id]}),check("asset_markup_distinct",sql`${t.assetId}<>${t.sourceAssetId}`),check("asset_markup_strokes",sql`jsonb_typeof(${t.strokes})='array' AND jsonb_array_length(${t.strokes}) BETWEEN 1 AND 100`),index("asset_markup_source_idx").on(t.workspaceId,t.caseId,t.sourceAssetId)]);
