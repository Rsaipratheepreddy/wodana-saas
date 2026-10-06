import { BadRequestException } from "@nestjs/common";
import { plainToInstance, type ClassConstructor } from "class-transformer";
import { validate } from "class-validator";
import type { CatalogV2Service } from "../catalog-core/catalog-v2.service";
import type { CrmActivitiesService } from "../crm/activities/crm-activities.service";
import type { CrmConversationsService } from "../crm/conversations/crm-conversations.service";
import type { CrmInboxService } from "../crm/conversations/crm-inbox.service";
import type { CrmScheduledMessagesService } from "../crm/conversations/crm-scheduled-messages.service";
import type { CrmIntakeService } from "../crm/intake/crm-intake.service";
import type { CrmLeadsService } from "../crm/leads/crm-leads.service";
import type { CrmOpportunitiesService } from "../crm/opportunities/crm-opportunities.service";
import type { CrmPartiesService } from "../crm/parties/crm-parties.service";
import type { InventoryService } from "../inventory/inventory.service";
import type { ProjectWorkService } from "../project-core/project-work.service";
import type { SuppliersService } from "../purchasing/suppliers.service";
import type { QuotationCollabService } from "../quotation/quotation-collab.service";
import type { WorkspaceSearchService } from "../search/workspace-search.service";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";

/** The module services Woddy's tools call. Every call passes the person's own actor. */
export type ToolServices = {
  access: WorkspaceAccessService;
  search: WorkspaceSearchService;
  leads: CrmLeadsService;
  intake: CrmIntakeService;
  opportunities: CrmOpportunitiesService;
  activities: CrmActivitiesService;
  parties: CrmPartiesService;
  conversations: CrmConversationsService;
  inbox: CrmInboxService;
  scheduled: CrmScheduledMessagesService;
  work: ProjectWorkService;
  quoteComments: QuotationCollabService;
  catalog: CatalogV2Service;
  inventory: InventoryService;
  suppliers: SuppliersService;
};

/**
 * A module command's input built the way its HTTP route receives it: the module's own DTO class, validated
 * with the same rules as the API (unknown fields refused), so a confirmed proposal runs exactly the command
 * a person's form would.
 */
export async function commandInput<T extends object>(type: ClassConstructor<T>, plain: Record<string, unknown>): Promise<T> {
  const instance = plainToInstance(type, plain);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}).concat((error.children ?? []).flatMap((child) => Object.values(child.constraints ?? {}))));
    throw new BadRequestException(messages.length ? messages : "The request is not valid");
  }
  return instance;
}

/** A module query with its DTO's defaults (limits, sort) applied. */
export function queryInput<T extends object>(type: ClassConstructor<T>, plain: Record<string, unknown>): T {
  return Object.assign(new type(), plain);
}

export type Row = Record<string, unknown>;
export const rowsOf = (value: unknown): Row[] => {
  const data = (value as { data?: unknown; items?: unknown } | null)?.data ?? (value as { items?: unknown } | null)?.items ?? value;
  return Array.isArray(data) ? data.filter((row): row is Row => Boolean(row) && typeof row === "object") : [];
};
export const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : typeof value === "number" ? String(value) : null);
export const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);
