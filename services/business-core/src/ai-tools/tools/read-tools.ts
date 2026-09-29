import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { ListConversationsQueryDto } from "../../crm/conversations/dto/conversations.dto";
import { ListLeadsQueryDto } from "../../crm/leads/dto/leads.dto";
import { ListOpportunitiesQueryDto } from "../../crm/opportunities/dto/opportunities.dto";
import { ListPartiesQueryDto } from "../../crm/parties/dto/parties.dto";
import { readHomeOverview } from "../../workspaces/home-overview";
import { ToolInputError, type AiTool, type AiToolContext, type RecordRef } from "../ai-tool";
import { clip, ref, uuidArg, zonedWallTime } from "../tool-kit";
import { queryInput, rowsOf, str, num, type Row, type ToolServices } from "../tool-services";

const SEARCH_TYPES = ["enquiry", "opportunity", "customer", "conversation", "project", "quotation"] as const;
const RECORD_TYPES = ["enquiry", "opportunity", "customer", "conversation", "crm_task", "work_item", "quotation"] as const;

/** Only a refusal for this part (a permission the person lacks, a module not included) skips it. */
async function part<T>(work: () => Promise<T>): Promise<T | null> {
  try { return await work(); } catch (error) { if (error instanceof ForbiddenException) return null; throw error; }
}

const when = (value: unknown, context: AiToolContext) => {
  const text = value instanceof Date ? value.toISOString() : str(value);
  return text && Number.isFinite(Date.parse(text)) ? zonedWallTime(new Date(text), context.timeZone) : null;
};

/** Enquiry labels: its reference, else its title. */
const enquiryLabel = (row: Row) => str(row.reference) ?? str(row.title) ?? "Enquiry";
const opportunityLabel = (row: Row) => str(row.reference) ?? str(row.title) ?? "Opportunity";
const quoteLabel = (row: Row) => `${str(row.reference) ?? str(row.title) ?? "Quote"} R${str(row.number) ?? "?"}`;

/**
 * The client's quotes (latest first) through their opportunities, for a person who may see Planning. Only
 * what a reply needs: which revision, its state, total and validity.
 */
async function clientQuotes(services: ToolServices, context: AiToolContext, partyId: string | null) {
  if (!partyId || !context.permissions.has("pre_projects.view")) return null;
  return part(() => services.access.withPermission(context.actor, context.workspaceId, "pre_projects.view", async (client: PoolClient) => {
    const rows = (await client.query<Row>(
      `SELECT quote.case_id::text AS "caseId", quote.id, quote.number, quote.title, quote.status, quote.total::text AS total, quote.currency,
              quote.valid_until::text AS "validUntil", quote.updated_at AS "updatedAt", opportunity.reference, opportunity.title AS "opportunityTitle"
         FROM commercial_quotes quote
         JOIN pre_project_cases case_record ON case_record.workspace_id = quote.workspace_id AND case_record.id = quote.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = case_record.workspace_id AND opportunity.id = case_record.opportunity_id
        WHERE quote.workspace_id = $1 AND opportunity.party_id = $2 AND quote.kind = 'quotation' AND quote.status NOT IN ('superseded', 'withdrawn')
        ORDER BY quote.updated_at DESC LIMIT 4`, [context.workspaceId, partyId])).rows;
    return rows.map((row) => quoteFacts(row, context));
  }));
}

function quoteFacts(row: Row, context: AiToolContext) {
  const caseId = String(row.caseId);
  const source = context.cite(ref("quotation", `${caseId}/${String(row.id)}`, quoteLabel(row), { caseId }));
  return { source, quote: quoteLabel(row), title: clip(row.title, 160), status: str(row.status), total: str(row.total), currency: str(row.currency), validUntil: str(row.validUntil), updated: when(row.updatedAt, context) };
}

async function conversationFacts(services: ToolServices, context: AiToolContext, conversationId: string) {
  const chat = await services.conversations.get(context.actor, context.workspaceId, conversationId) as unknown as Row;
  const related = await part(() => services.inbox.context(context.actor, context.workspaceId, conversationId)) as Row | null;
  const source = context.cite(ref("conversation", conversationId, `${str(chat.partyName) ?? "Chat"} · ${str(chat.channel) ?? "chat"}`));
  const messages = rowsOf(chat.messages).filter((message) => !message.hiddenAt).slice(-20).map((message) => {
    const metadata = (message.metadata && typeof message.metadata === "object" ? message.metadata : {}) as Row;
    const from = message.direction === "inbound" ? "client" : message.direction === "internal" ? "team note" : metadata.automatic || message.authorship === "automation" ? "automatic" : str(message.senderName) ?? "team";
    return { from, at: when(message.createdAt, context), text: clip(message.bodyText, 500) ?? (metadata.messageType ? `[${String(metadata.messageType)}]` : null) };
  });
  const enquiries = rowsOf(related?.enquiries).map((row) => ({ source: context.cite(ref("enquiry", String(row.id), enquiryLabel(row))), reference: str(row.reference), status: str(row.status), owner: str(row.ownerName), linked: row.id === chat.leadId }));
  const opportunities = rowsOf(related?.opportunities).map((row) => ({ source: context.cite(ref("opportunity", String(row.id), opportunityLabel(row))), reference: str(row.reference), title: clip(row.title, 160), status: str(row.status), stage: str(row.stageName) }));
  const projects = rowsOf(related?.projects).map((row) => ({ source: context.cite(ref("project", String(row.id), str(row.reference) ?? str(row.name) ?? "Project")), name: clip(row.name, 160), status: str(row.status) }));
  const party = related?.party as Row | null | undefined;
  return {
    source, conversationId, client: str(chat.partyName), channel: str(chat.channel), status: str(chat.status), owner: str(chat.ownerName) ?? "Unassigned",
    labels: rowsOf(chat.labels).map((label) => str(label.name)), unread: num(chat.unreadCount), waitingSince: when(chat.waitingSince, context), version: num(chat.version),
    // Whether the chat has a reachable number or email; the values themselves stay out of the model's context.
    contact: party ? { hasMobile: rowsOf(party.contacts).some((item) => item.type === "phone"), hasEmail: rowsOf(party.contacts).some((item) => item.type === "email") } : null,
    enquiries, opportunities, projects, quotes: await clientQuotes(services, context, str(chat.partyId)),
    messages,
  };
}

export function readTools(services: ToolServices): AiTool[] {
  const searchRecords: AiTool = {
    name: "search_records",
    description: "Find records by name, reference or title: enquiries, opportunities, customers, chats, projects and quotations. Use it before acting on a client named in words. Returns ids to use with other tools.",
    kind: "read",
    confirmation: "none",
    calls: "WorkspaceSearchService.search, CrmLeadsService.list, CrmOpportunitiesService.list, CrmPartiesService.list, CrmConversationsService.list",
    permissions: [],
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "A name, reference or words from the title", maxLength: 120 },
        types: { type: "array", description: "Only these kinds (all when empty)", items: { type: "string", enum: [...SEARCH_TYPES] }, maxItems: 6 },
      },
      required: ["text"],
    },
    async run(context, input) {
      const text = String(input.text);
      if (text.length < 2) throw new ToolInputError("Search with at least 2 characters");
      const wanted = new Set<string>(Array.isArray(input.types) && input.types.length ? input.types as string[] : SEARCH_TYPES);
      const results: Array<Record<string, unknown>> = [];
      const can = (permission: string) => context.permissions.has(permission);
      if (wanted.has("enquiry") && can("crm.leads.view")) {
        const found = await part(() => services.leads.list(context.actor, context.workspaceId, queryInput(ListLeadsQueryDto, { search: text, limit: 8 })));
        for (const row of rowsOf(found)) results.push({ source: context.cite(ref("enquiry", String(row.id), enquiryLabel(row))), type: "enquiry", id: row.id, reference: str(row.reference), title: clip(row.title, 160), client: str(row.partyName), status: str(row.status), owner: str(row.ownerName) ?? "Unassigned", nextAction: when(row.nextActionAt, context), converted: Boolean(row.isConverted) });
      }
      if (wanted.has("opportunity") && can("crm.opportunities.view")) {
        const found = await part(() => services.opportunities.list(context.actor, context.workspaceId, queryInput(ListOpportunitiesQueryDto, { search: text.slice(0, 160), limit: 8 })));
        for (const row of rowsOf(found)) results.push({ source: context.cite(ref("opportunity", String(row.id), opportunityLabel(row))), type: "opportunity", id: row.id, reference: str(row.reference), title: clip(row.title, 160), client: str(row.partyName), stage: str(row.stageName), status: str(row.status), owner: str(row.ownerName) });
      }
      if (wanted.has("customer") && can("crm.parties.view")) {
        const found = await part(() => services.parties.list(context.actor, context.workspaceId, queryInput(ListPartiesQueryDto, { search: text, limit: 8 })));
        for (const row of rowsOf(found)) results.push({ source: context.cite(ref("customer", String(row.id), str(row.displayName) ?? "Customer")), type: "customer", id: row.id, name: str(row.displayName), kind: str(row.type), lifecycle: str(row.lifecycle) });
      }
      if (wanted.has("conversation") && can("crm.communications.view")) {
        const found = await part(() => services.conversations.list(context.actor, context.workspaceId, queryInput(ListConversationsQueryDto, { search: text.slice(0, 200), view: "all", limit: 8 })));
        for (const row of rowsOf(found)) results.push({ source: context.cite(ref("conversation", String(row.id), `${str(row.partyName) ?? "Chat"} · ${str(row.channel) ?? "chat"}`)), type: "conversation", id: row.id, client: str(row.partyName), channel: str(row.channel), status: str(row.status), owner: str(row.ownerName) ?? "Unassigned" });
      }
      if (wanted.has("project") || wanted.has("quotation")) {
        const found = await part(() => services.search.search(context.actor, context.workspaceId, text, "10")) as { items?: Row[] } | null;
        for (const row of found?.items ?? []) {
          if (row.kind === "project" && wanted.has("project")) {
            results.push({ source: context.cite({ type: "project", id: String(row.id), label: str(row.reference) ?? str(row.title) ?? "Project", href: str(row.route) }), type: "project", id: row.id, name: clip(row.title, 160), detail: clip(row.subtitle, 160) });
          }
          if (row.kind === "quotation" && wanted.has("quotation")) {
            const caseId = /cases\/([^/]+)\/quotations/.exec(String(row.route ?? ""))?.[1];
            if (!caseId) continue;
            const id = `${decodeURIComponent(caseId)}/${String(row.id)}`;
            results.push({ source: context.cite({ type: "quotation", id, label: `${clip(row.title, 80) ?? "Quote"} R${str(row.reference) ?? "?"}`, href: str(row.route) }), type: "quotation", id, title: clip(row.title, 160), detail: clip(row.subtitle, 160) });
          }
        }
      }
      return { data: { results, count: results.length } };
    },
  };

  const getRecord: AiTool = {
    name: "get_record",
    description: "Read one record in full: an enquiry, opportunity, customer, chat, CRM task, project task (work_item) or quotation (id is caseId/quoteId). Use the id from search_records, the current record, or another tool.",
    kind: "read",
    confirmation: "none",
    calls: "CrmLeadsService.get, CrmOpportunitiesService.get, CrmPartiesService.get, CrmConversationsService.get, CrmActivitiesService.get, ProjectWorkService.item, commercial quotes",
    permissions: [],
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...RECORD_TYPES] },
        id: { type: "string", description: "The record's id", maxLength: 120 },
      },
      required: ["type", "id"],
    },
    async run(context, input) {
      const type = String(input.type);
      const id = String(input.id);
      if (type === "quotation") return { data: await readQuotation(services, context, id) };
      const recordId = uuidArg(id, "id");
      switch (type) {
        case "enquiry": {
          const lead = await services.leads.get(context.actor, context.workspaceId, recordId) as unknown as Row;
          const enquiry = (lead.enquiry ?? {}) as Row;
          const details = (enquiry.details ?? {}) as Row;
          return { data: {
            source: context.cite(ref("enquiry", recordId, enquiryLabel(enquiry))), reference: str(enquiry.reference), title: clip(enquiry.title, 240), client: str(enquiry.partyName),
            status: str(lead.status), owner: str(lead.ownerName) ?? "Unassigned", nextAction: when(lead.nextActionAt, context), enquiryType: str(enquiry.serviceType),
            summary: clip(enquiry.summary, 800), region: str(details.emirate), area: str(details.area), budgetRange: str(details.budgetRange), customerType: str(details.customerType),
            source_channel: [str(enquiry.source), str(enquiry.channel)].filter(Boolean).join(" / "), hasMobile: Boolean(enquiry.primaryMobile), hasEmail: Boolean(enquiry.primaryEmail),
            readyToConvert: (lead.qualificationState as Row | undefined)?.ready ?? null,
            opportunities: rowsOf(lead.opportunities).map((row) => ({ source: context.cite(ref("opportunity", String(row.id), opportunityLabel(row))), title: clip(row.title, 160), status: str(row.status) })),
            version: num(lead.version),
          } };
        }
        case "opportunity": {
          const row = await services.opportunities.get(context.actor, context.workspaceId, recordId) as unknown as Row;
          return { data: {
            source: context.cite(ref("opportunity", recordId, opportunityLabel(row))), reference: str(row.reference), title: clip(row.title, 240), client: str(row.partyName),
            pipeline: str(row.pipelineName), stage: str(row.stageName), status: str(row.status), owner: str(row.ownerName) ?? "Unassigned", nextAction: when(row.nextActionAt, context),
            expectedClose: when(row.expectedCloseAt, context), amount: str(row.amount), currency: str(row.currencyCode), probability: num(row.probability), description: clip(row.description, 600),
            version: num(row.version),
          } };
        }
        case "customer": {
          const row = await services.parties.get(context.actor, context.workspaceId, recordId) as unknown as Row;
          const timeline = rowsOf(row.clientTimeline).slice(0, 10).map((item) => ({ what: clip(item.title ?? item.kind ?? item.type, 160), at: when(item.occurredAt ?? item.createdAt, context) }));
          return { data: { source: context.cite(ref("customer", recordId, str(row.displayName) ?? "Customer")), name: str(row.displayName), kind: str(row.type), lifecycle: str(row.lifecycle), recent: timeline } };
        }
        case "conversation":
          return { data: await conversationFacts(services, context, recordId) };
        case "crm_task": {
          const row = await services.activities.get(context.actor, context.workspaceId, recordId) as unknown as Row;
          const parent = str(row.opportunityId) ? ref("opportunity", String(row.opportunityId), "Opportunity") : str(row.leadId) ? ref("enquiry", String(row.leadId), "Enquiry") : null;
          return { data: {
            source: context.cite({ type: "crm_task", id: recordId, label: clip(row.title, 80) ?? "Task", href: parent?.href ?? null }), kind: str(row.type), title: clip(row.title, 240), status: str(row.status),
            due: when(row.dueAt, context), owner: str(row.ownerName), priority: str(row.priority), description: clip(row.description, 600), enquiryId: str(row.leadId), opportunityId: str(row.opportunityId),
            version: num(row.version),
          } };
        }
        case "work_item": {
          const projectId = await services.access.asMember(context.actor, context.workspaceId, async (client) =>
            (await client.query<{ projectId: string }>(`SELECT project_id AS "projectId" FROM work_items WHERE workspace_id = $1 AND id = $2`, [context.workspaceId, recordId])).rows[0]?.projectId);
          if (!projectId) throw new NotFoundException("Task not found");
          const state = await services.work.item(context.actor, context.workspaceId, projectId, recordId) as unknown as Row;
          const item = (state.item ?? state) as Row;
          return { data: {
            source: context.cite(ref("work_item", recordId, `#${str(item.number) ?? "?"} ${clip(item.title, 60) ?? ""}`.trim(), { projectId })), number: num(item.number), title: clip(item.title, 240),
            status: str(item.status), priority: str(item.priority), assignee: str(item.assigneeName) ?? "Unassigned", start: str(item.startDate), due: str(item.dueDate), projectId, version: num(item.version),
          } };
        }
      }
      throw new ToolInputError("Unknown record type");
    },
  };

  const listMyWork: AiTool = {
    name: "list_my_work",
    description: "The person's own next actions: their pending sales follow-ups and their open project tasks, soonest first.",
    kind: "read",
    confirmation: "none",
    calls: "Home overview (readHomeOverview)",
    permissions: [],
    parameters: { type: "object", properties: {} },
    async run(context) {
      const overview = await services.access.asMember(context.actor, context.workspaceId, async (client, user) => {
        const [sales, planning, projects, manageProjects] = await Promise.all(["crm.activities.view", "pre_projects.view", "projects.view", "projects.manage"]
          .map((permission) => services.access.hasPermission(client, context.workspaceId, user.userId, permission)));
        return readHomeOverview(client, context.workspaceId, context.membershipId, { sales, planning, projects, manageProjects });
      });
      const item = (type: string) => (row: { id: string; title: string; detail: string; href: string; date: string | null }) => ({
        source: context.cite({ type, id: row.id, label: clip(row.title, 80) ?? "Task", href: row.href }), title: clip(row.title, 200), detail: clip(row.detail, 200), due: when(row.date, context),
      });
      return { data: { followUps: overview.sales.map(item("crm_task")), projectTasks: overview.tasks.map(item("work_item")), counts: overview.metrics } };
    },
  };

  const listConversations: AiTool = {
    name: "list_conversations",
    description: "Chats in the inbox: mine, unassigned, my team's or all; open, snoozed or resolved (closed); optionally unread only or matching a name.",
    kind: "read",
    confirmation: "none",
    calls: "CrmConversationsService.list",
    permissions: ["crm.communications.view"],
    parameters: {
      type: "object",
      properties: {
        view: { type: "string", enum: ["mine", "unassigned", "team", "all"] },
        status: { type: "string", enum: ["open", "snoozed", "closed"] },
        search: { type: "string", maxLength: 200 },
        unread: { type: "boolean" },
        limit: { type: "integer", description: "Up to 20" },
      },
    },
    async run(context, input) {
      const limit = Math.min(Math.max(Number(input.limit ?? 10) || 10, 1), 20);
      const found = await services.conversations.list(context.actor, context.workspaceId, queryInput(ListConversationsQueryDto, {
        view: input.view ?? "mine", ...(input.status ? { status: input.status } : { status: "open" }), ...(input.search ? { search: input.search } : {}),
        ...(input.unread !== undefined ? { unread: String(input.unread) } : {}), limit,
      }));
      return { data: { chats: rowsOf(found).map((row) => ({
        source: context.cite(ref("conversation", String(row.id), `${str(row.partyName) ?? "Chat"} · ${str(row.channel) ?? "chat"}`)), id: row.id, client: str(row.partyName), channel: str(row.channel),
        status: str(row.status), owner: str(row.ownerName) ?? "Unassigned", unread: num(row.unreadCount), waitingSince: when(row.waitingSince, context),
        lastMessage: { from: row.lastMessageDirection === "inbound" ? "client" : "team", text: clip(row.lastMessageText, 160), at: when(row.lastMessageAt, context) },
        labels: rowsOf(row.labels).map((label) => str(label.name)), version: num(row.version),
      })) } };
    },
  };

  const getConversation: AiTool = {
    name: "get_conversation",
    description: "Read one chat: the client, owner, state, labels, the latest messages, and the client's enquiries, opportunities, projects and quotes.",
    kind: "read",
    confirmation: "none",
    calls: "CrmConversationsService.get, CrmInboxService.context",
    permissions: ["crm.communications.view"],
    parameters: { type: "object", properties: { id: { type: "string", description: "The chat's id", maxLength: 40 } }, required: ["id"] },
    async run(context, input) {
      return { data: await conversationFacts(services, context, uuidArg(input.id, "id")) };
    },
  };

  const findMember: AiTool = {
    name: "find_member",
    description: "Find a teammate by name to assign work to. Returns their member id and what they can own.",
    kind: "read",
    confirmation: "none",
    calls: "workspace members (names only)",
    permissions: [],
    parameters: { type: "object", properties: { name: { type: "string", maxLength: 120 } }, required: ["name"] },
    async run(context, input) {
      const members = await findMembers(services, context, String(input.name));
      return { data: { members: members.map((member) => ({ memberId: member.id, name: member.name, isYou: member.id === context.membershipId, canOwnChats: member.canOwnChats, canOwnEnquiries: member.canOwnEnquiries })) } };
    },
  };

  return [searchRecords, getRecord, listMyWork, listConversations, getConversation, findMember];
}

export type MemberMatch = { id: string; name: string; canOwnChats: boolean; canOwnEnquiries: boolean };

/**
 * Active teammates whose name (or email) matches, by name only. Whether they can own chats (inbox access)
 * or enquiries (the sales owner permissions) decides who a record can be given to.
 */
export async function findMembers(services: ToolServices, context: AiToolContext, name: string): Promise<MemberMatch[]> {
  const text = name.trim().replace(/^@/, "");
  if (text.length < 2) throw new ToolInputError("Give at least 2 letters of the name");
  return services.access.asMember(context.actor, context.workspaceId, async (client) => {
    const rows = (await client.query<{ id: string; name: string; permissions: string[] }>(
      `SELECT membership.id, coalesce(nullif(btrim(person.display_name), ''), person.primary_email) AS name,
              coalesce(array_agg(DISTINCT permission.code) FILTER (WHERE permission.code IS NOT NULL), '{}') AS permissions
         FROM workspace_memberships membership
         JOIN users person ON person.id = membership.user_id
         LEFT JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
         LEFT JOIN role_permissions granted ON granted.role_id = assigned.role_id
         LEFT JOIN permissions permission ON permission.id = granted.permission_id
          AND permission.code IN ('crm.communications.view', 'crm.leads.view', 'crm.leads.manage', 'crm.activities.manage')
        WHERE membership.workspace_id = $1 AND membership.status = 'active'
          AND (person.display_name ILIKE $2 OR person.primary_email ILIKE $2)
        GROUP BY membership.id, person.display_name, person.primary_email
        ORDER BY (lower(person.display_name) = lower($3)) DESC, person.display_name
        LIMIT 8`, [context.workspaceId, `%${text.replace(/[%_\\]/g, "\\$&")}%`, text])).rows;
    return rows.map((row) => ({
      id: row.id, name: row.name,
      canOwnChats: row.permissions.includes("crm.communications.view"),
      canOwnEnquiries: ["crm.leads.view", "crm.leads.manage", "crm.activities.manage"].every((code) => row.permissions.includes(code)),
    }));
  });
}

async function readQuotation(services: ToolServices, context: AiToolContext, id: string) {
  const [caseId, quoteId] = id.split("/");
  if (!caseId || !quoteId) throw new ToolInputError("A quotation id is caseId/quoteId");
  uuidArg(caseId, "caseId");
  const row = await services.access.withPermission(context.actor, context.workspaceId, "pre_projects.view", async (client) => (await client.query<Row>(
    `SELECT quote.case_id::text AS "caseId", quote.id, quote.number, quote.title, quote.status, quote.total::text AS total, quote.currency,
            quote.valid_until::text AS "validUntil", quote.updated_at AS "updatedAt", opportunity.reference, opportunity.title AS "opportunityTitle", party.display_name AS client,
            (SELECT count(*)::int FROM commercial_quote_lines line WHERE line.workspace_id = quote.workspace_id AND line.case_id = quote.case_id AND line.quote_id = quote.id) AS lines
       FROM commercial_quotes quote
       JOIN pre_project_cases case_record ON case_record.workspace_id = quote.workspace_id AND case_record.id = quote.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = case_record.workspace_id AND opportunity.id = case_record.opportunity_id
       JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE quote.workspace_id = $1 AND quote.case_id = $2 AND quote.id = $3`, [context.workspaceId, caseId, quoteId])).rows[0]);
  if (!row) throw new NotFoundException("Quotation not found");
  return { ...quoteFacts(row, context), client: str(row.client), opportunity: clip(row.opportunityTitle, 160), lines: num(row.lines) };
}

export const recordFacts = { conversationFacts, clientQuotes };
export type { RecordRef };
