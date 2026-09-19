import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, timestamp, unique, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './schema';
import { preProjectBriefAssets, preProjectBriefEntries, preProjectCases, preProjectItemSpecifications, preProjectRooms } from './pre-project.schema';

const scope=()=>({workspaceId:uuid('workspace_id').notNull(),caseId:uuid('case_id').notNull()});
const creator=()=>({createdBy:uuid('created_by').notNull().references(()=>users.id),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()});
export const preProjectSiteRecords=pgTable('pre_project_site_records',{
 id:uuid('id').primaryKey(),...scope(),siteId:uuid('site_id'),kind:varchar('kind',{length:20}).notNull(),roomId:uuid('room_id'),entryId:uuid('entry_id'),visitId:uuid('visit_id'),
 title:varchar('title',{length:240}).notNull(),status:varchar('status',{length:24}).notNull(),version:integer('version').notNull(),content:jsonb('content').notNull(),...creator(),updatedBy:uuid('updated_by').notNull().references(()=>users.id),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[unique().on(t.workspaceId,t.caseId,t.id),
 foreignKey({columns:[t.workspaceId,t.caseId],foreignColumns:[preProjectCases.workspaceId,preProjectCases.id]}),
 foreignKey({columns:[t.workspaceId,t.caseId,t.roomId],foreignColumns:[preProjectRooms.workspaceId,preProjectRooms.caseId,preProjectRooms.id]}),
 foreignKey({columns:[t.workspaceId,t.caseId,t.entryId],foreignColumns:[preProjectBriefEntries.workspaceId,preProjectBriefEntries.caseId,preProjectBriefEntries.id]}),
 foreignKey({columns:[t.workspaceId,t.caseId,t.visitId],foreignColumns:[t.workspaceId,t.caseId,t.id]}),
 index('pre_project_site_case_idx').on(t.workspaceId,t.caseId,t.kind,t.updatedAt.desc()),
 uniqueIndex('pre_project_site_item_measurement_key').on(t.workspaceId,t.caseId,t.entryId).where(sql`${t.kind}='measurement' AND ${t.entryId} IS NOT NULL`),
 check('pre_project_site_records_kind_check',sql`${t.kind} IN ('visit','measurement','observation')`),check('pre_project_site_records_title_check',sql`length(trim(${t.title}))>0`),check('pre_project_site_records_version_check',sql`${t.version}>0`),
 check('pre_project_site_records_check',sql`(${t.kind}='visit' AND ${t.status} IN ('planned','completed','cancelled') AND ${t.roomId} IS NULL AND ${t.entryId} IS NULL AND ${t.visitId} IS NULL) OR (${t.kind}='measurement' AND ${t.status} IN ('incomplete','measured','verified','recheck') AND (${t.roomId} IS NOT NULL OR ${t.entryId} IS NOT NULL)) OR (${t.kind}='observation' AND ${t.status} IN ('open','resolved'))`),
]);
export const preProjectSiteRevisions=pgTable('pre_project_site_revisions',{
 ...scope(),recordId:uuid('record_id').notNull(),version:integer('version').notNull(),content:jsonb('content').notNull(),...creator(),
},t=>[primaryKey({columns:[t.workspaceId,t.caseId,t.recordId,t.version]}),check('pre_project_site_revisions_version_check',sql`${t.version}>0`),foreignKey({columns:[t.workspaceId,t.caseId,t.recordId],foreignColumns:[preProjectSiteRecords.workspaceId,preProjectSiteRecords.caseId,preProjectSiteRecords.id]})]);
export const preProjectSiteAssets=pgTable('pre_project_site_assets',{
 ...scope(),recordId:uuid('record_id').notNull(),version:integer('version').notNull(),assetId:uuid('asset_id').notNull(),
},t=>[primaryKey({columns:[t.workspaceId,t.caseId,t.recordId,t.version,t.assetId]}),foreignKey({columns:[t.workspaceId,t.caseId,t.recordId,t.version],foreignColumns:[preProjectSiteRevisions.workspaceId,preProjectSiteRevisions.caseId,preProjectSiteRevisions.recordId,preProjectSiteRevisions.version]}),foreignKey({columns:[t.workspaceId,t.caseId,t.assetId],foreignColumns:[preProjectBriefAssets.workspaceId,preProjectBriefAssets.caseId,preProjectBriefAssets.id]})]);
export const preProjectSiteSpecificationRefs=pgTable('pre_project_site_specification_refs',{
 ...scope(),recordId:uuid('record_id').notNull(),version:integer('version').notNull(),entryId:uuid('entry_id').notNull(),specificationVersion:integer('specification_version').notNull(),
},t=>[primaryKey({columns:[t.workspaceId,t.caseId,t.recordId,t.version]}),foreignKey({columns:[t.workspaceId,t.caseId,t.recordId,t.version],foreignColumns:[preProjectSiteRevisions.workspaceId,preProjectSiteRevisions.caseId,preProjectSiteRevisions.recordId,preProjectSiteRevisions.version]}),foreignKey({columns:[t.workspaceId,t.caseId,t.entryId,t.specificationVersion],foreignColumns:[preProjectItemSpecifications.workspaceId,preProjectItemSpecifications.caseId,preProjectItemSpecifications.entryId,preProjectItemSpecifications.version]})]);
