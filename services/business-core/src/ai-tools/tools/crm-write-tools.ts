import { ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CreateActivityDto, CompleteActivityDto } from "../../crm/activities/dto/activities.dto";
import { CreateScheduledMessageDto, UpdateConversationDto } from "../../crm/conversations/dto/conversations.dto";
import { SetConversationLabelsDto } from "../../crm/conversations/dto/inbox.dto";
import { CreateIntakeEventDto, UpdateLeadDetailsDto } from "../../crm/intake/dto/intake.dto";
import { hasResolvedEnquiryType } from "../../crm/leads/lead-options";
import { AssignLeadDto, ListLeadsQueryDto } from "../../crm/leads/dto/leads.dto";
import { ListOpportunitiesQueryDto, QualifyLeadDto, TransitionOpportunityDto } from "../../crm/opportunities/dto/opportunities.dto";
import { ItemsFailedError, phrase, ToolInputError, ToolQuestion, type AiTool, type AiToolContext, type Execution, type PreviewField, type Proposal, type ProposalTarget, type StoredProposal } from "../ai-tool";
import { clip, moduleMessage, ref, uuidArg, zonedArg, zonedWallTime } from "../tool-kit";
import { commandInput, num, queryInput, rowsOf, str, type Row, type ToolServices } from "../tool-services";

type Option = { id: string; label: string };
type LeadOptions = { sources: Option[]; channels: Record<string, Option[]>; enquiryTypes: Option[]; budgetRanges: Option[]; customerTypes: Option[]; emirates: Option[] };

const PARTY_KEYS = ["displayName", "email", "phone", "mobile", "company", "jobPosition", "website", "address", "phoneCountryCode", "mobileCountryCode", "preferredLocale", "preferredTimezone"];
const DETAIL_KEYS = ["emirate", "area", "location", "customerType", "budgetRange", "campaign", "internalNotes"];
const pick = (value: unknown, keys: string[]) => Object.fromEntries(keys.flatMap((key) => {
  const item = (value as Row | null | undefined)?.[key];
  return typeof item === "string" && item.trim() ? [[key, item]] : [];
}));

/** A choice the person named, matched to the workspace's options by id or label. */
function choose(options: Option[], value: unknown, what: string): Option {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  const found = text ? options.find((option) => option.id.toLowerCase() === text || option.label.toLowerCase() === text) : undefined;
  if (found) return found;
  throw new ToolQuestion(text ? `"${String(value)}" is not a ${what} here. Ask which ${what} it is.` : `Ask which ${what} it is.`, options.slice(0, 20).map((option) => ({ type: "choice", id: option.id, label: option.label })));
}
const labelOf = (options: Option[], id: unknown) => options.find((option) => option.id === id)?.label ?? (typeof id === "string" ? id : null);

/** The record a request is about: the id given, else the record open where the person asked. */
function contextId(context: AiToolContext, value: unknown, type: string, name: string): string {
  if (value !== undefined && value !== null && value !== "") return uuidArg(value, name);
  if (context.record?.type === type) return context.record.id;
  throw new ToolInputError(`${name} is required: search for the record first`);
}

/** The chats a request covers: the ids given, else what the person selected, else the chat open. */
function chatIds(context: AiToolContext, value: unknown): string[] {
  if (Array.isArray(value) && value.length) return [...new Set(value.map((id) => uuidArg(id, "ids")))];
  if (context.selection?.type === "conversation" && context.selection.ids.length) return context.selection.ids;
  if (context.record?.type === "conversation") return [context.record.id];
  throw new ToolInputError("ids is required: which chats?");
}

async function memberById(services: ToolServices, context: AiToolContext, memberId: string) {
  const member = await services.access.asMember(context.actor, context.workspaceId, async (client) => (await client.query<{ id: string; name: string; permissions: string[] }>(
    `SELECT membership.id, coalesce(nullif(btrim(person.display_name), ''), person.primary_email) AS name,
            coalesce(array_agg(DISTINCT permission.code) FILTER (WHERE permission.code IS NOT NULL), '{}') AS permissions
       FROM workspace_memberships membership JOIN users person ON person.id = membership.user_id
       LEFT JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
       LEFT JOIN role_permissions granted ON granted.role_id = assigned.role_id
       LEFT JOIN permissions permission ON permission.id = granted.permission_id
        AND permission.code IN ('crm.communications.view', 'crm.leads.view', 'crm.leads.manage', 'crm.activities.manage')
      WHERE membership.workspace_id = $1 AND membership.id = $2 AND membership.status = 'active'
      GROUP BY membership.id, person.display_name, person.primary_email`, [context.workspaceId, memberId])).rows[0]);
  if (!member) throw new ToolInputError("memberId is not an active teammate: use find_member");
  return { ...member, canOwnChats: member.permissions.includes("crm.communications.view"), canOwnEnquiries: ["crm.leads.view", "crm.leads.manage", "crm.activities.manage"].every((code) => member.permissions.includes(code)) };
}

/**
 * Giving work to someone else needs the lead assignment permission (the rule intake applies, LF-1);
 * anyone may take it themselves.
 */
function assertMayAssign(context: AiToolContext, ownerId: string) {
  if (ownerId !== context.membershipId && !context.permissions.has("crm.leads.assign")) {
    throw new ForbiddenException("You can schedule work for yourself. Giving it to someone else needs the lead assignment permission.");
  }
}

/**
 * An enquiry or opportunity for a client named in words. Two or more matches are a question for the person,
 * never a guess. A converted enquiry's follow-ups belong to its opportunity.
 */
async function resolveSalesRecord(services: ToolServices, context: AiToolContext, input: { recordType?: unknown; recordId?: unknown; client?: unknown }) {
  if (input.recordId) {
    const type = input.recordType === "opportunity" ? "opportunity" : input.recordType === "customer" ? "customer" : "enquiry";
    return describeSalesRecord(services, context, type, uuidArg(input.recordId, "recordId"));
  }
  const name = typeof input.client === "string" ? input.client.trim() : "";
  if (!name) {
    if (context.record && ["enquiry", "opportunity", "customer"].includes(context.record.type)) return describeSalesRecord(services, context, context.record.type, context.record.id);
    throw new ToolInputError("Name the client, or give recordType and recordId");
  }
  const found: Array<ProposalTarget & { kind: "enquiry" | "opportunity" }> = [];
  if (context.permissions.has("crm.opportunities.view")) {
    const opportunities = rowsOf(await services.opportunities.list(context.actor, context.workspaceId, queryInput(ListOpportunitiesQueryDto, { search: name.slice(0, 160), status: "open", limit: 6 })));
    for (const row of opportunities) found.push({ kind: "opportunity", ...ref("opportunity", String(row.id), str(row.reference) ?? str(row.title) ?? "Opportunity"), detail: [str(row.partyName), str(row.stageName)].filter(Boolean).join(" · ") });
  }
  if (context.permissions.has("crm.leads.view")) {
    const leads = rowsOf(await services.leads.list(context.actor, context.workspaceId, queryInput(ListLeadsQueryDto, { search: name, limit: 6 })))
      .filter((row) => !row.isConverted && !["qualified", "disqualified", "duplicate"].includes(String(row.status)));
    for (const row of leads) found.push({ kind: "enquiry", ...ref("enquiry", String(row.id), str(row.reference) ?? str(row.title) ?? "Enquiry"), detail: [str(row.partyName), str(row.status)].filter(Boolean).join(" · ") });
  }
  if (!found.length) throw new ToolQuestion(`No open enquiry or opportunity matches "${name}". Ask who they mean.`);
  if (found.length > 1) throw new ToolQuestion(`${found.length} records match "${name}". Ask which one they mean, then call again with its recordType and recordId.`, found);
  return describeSalesRecord(services, context, found[0].kind, found[0].id);
}

async function describeSalesRecord(services: ToolServices, context: AiToolContext, type: string, id: string): Promise<{ type: "enquiry" | "opportunity" | "customer"; id: string; label: string; client: string | null; href: string | null }> {
  if (type === "opportunity") {
    const row = await services.opportunities.get(context.actor, context.workspaceId, id) as unknown as Row;
    const record = ref("opportunity", id, str(row.reference) ?? str(row.title) ?? "Opportunity");
    return { type: "opportunity", id, label: record.label, client: str(row.partyName), href: record.href ?? null };
  }
  if (type === "customer") {
    const row = await services.parties.get(context.actor, context.workspaceId, id) as unknown as Row;
    const record = ref("customer", id, str(row.displayName) ?? "Customer");
    return { type: "customer", id, label: record.label, client: str(row.displayName), href: record.href ?? null };
  }
  const lead = await services.leads.get(context.actor, context.workspaceId, id) as unknown as Row;
  const enquiry = (lead.enquiry ?? {}) as Row;
  // A converted enquiry is closed: its follow-ups go on the opportunity it became.
  const open = rowsOf(lead.opportunities).find((row) => row.status === "open");
  if (["qualified", "disqualified", "duplicate"].includes(String(lead.status))) {
    if (open) return describeSalesRecord(services, context, "opportunity", String(open.id));
    throw new ToolInputError(`${str(enquiry.reference) ?? "This enquiry"} is closed (${String(lead.status)}).`);
  }
  const record = ref("enquiry", id, str(enquiry.reference) ?? str(enquiry.title) ?? "Enquiry");
  return { type: "enquiry", id, label: record.label, client: str(enquiry.partyName), href: record.href ?? null };
}

/** A card's title, and the same sentence in English for the model and the audit trail. */
export const titled = (title: ReturnType<typeof phrase>, extra = "") => ({ title: { key: title.key, values: title.values }, summary: `${title.text}${extra}` });
export const KIND_LABELS: Record<string, string> = { note: "Note", call: "Call", meeting: "Meeting", email: "Email", whatsapp: "WhatsApp", sms: "SMS", other: "Other", task: "Task" };
const STATE_LABELS: Record<string, string> = { open: "Open", snoozed: "Snoozed", closed: "Resolved" };

const targetKey = (type: string) => (type === "enquiry" ? "leadId" : type === "opportunity" ? "opportunityId" : "partyId");

/** Runs one module command per ticked item; the module's own refusal is kept per item. */
async function eachItem(proposal: StoredProposal, work: (item: { id: string; version: number; label: string }) => Promise<unknown>): Promise<Execution> {
  const items = (proposal.command.items as Array<{ id: string; version: number; label: string }>).filter((item) => !proposal.selection || proposal.selection.includes(item.id));
  const failures: NonNullable<Execution["failures"]> = [];
  let done = 0;
  for (const item of items) {
    try { await work(item); done += 1; } catch (error) { failures.push({ id: item.id, label: item.label, message: moduleMessage(error) }); }
  }
  if (!done && failures.length) throw new ItemsFailedError(failures);
  return { result: { done, failed: failures.length }, record: null, failures };
}

export function crmWriteTools(services: ToolServices): AiTool[] {
  const createEnquiry: AiTool = {
    name: "create_enquiry",
    description: "Prepare a new enquiry (CRM intake) for the person to confirm. From a chat, pass conversationId (or leave it out when the chat is open): the client's name, number and recent messages are taken from the chat. Existing clients with the same mobile or email are checked first.",
    kind: "write",
    confirmation: "confirm",
    calls: "CrmIntakeService.createManual (Idempotency-Key), then CrmConversationsService.updateConversation to link the chat",
    permissions: ["crm.leads.manage"],
    parameters: {
      type: "object",
      properties: {
        conversationId: { type: "string", description: "The chat this enquiry comes from", maxLength: 40 },
        name: { type: "string", description: "The client's name", maxLength: 240 },
        mobile: { type: "string", description: "Only when the person typed it; a chat's number is used automatically", maxLength: 80 },
        email: { type: "string", maxLength: 320 },
        enquiryType: { type: "string", description: "One of the workspace's enquiry types (id or label)", maxLength: 100 },
        region: { type: "string", description: "The client's region (id or label)", maxLength: 100 },
        area: { type: "string", maxLength: 240 },
        summary: { type: "string", description: "What the client wants, in their words", maxLength: 4000 },
        source: { type: "string", description: "Where it came from (id or label); a chat's source is worked out from its channel", maxLength: 100 },
        channel: { type: "string", maxLength: 60 },
        ownerId: { type: "string", description: "A member id to own it; routing decides when left out", maxLength: 40 },
        existingClientId: { type: "string", description: "The existing client the person said it is", maxLength: 40 },
        newClient: { type: "boolean", description: "The person said it is a different person from the existing client" },
      },
    },
    async propose(context, input) {
      const options = await services.intake.options(context.actor, context.workspaceId) as unknown as LeadOptions;
      const conversationId = input.conversationId ? uuidArg(input.conversationId, "conversationId") : context.record?.type === "conversation" ? context.record.id : null;
      let party: Row = { displayName: str(input.name), mobile: str(input.mobile), email: str(input.email) };
      let chatChannel: string | null = null, chatVersion: number | null = null, summary = str(input.summary);
      if (conversationId) {
        const chat = await services.conversations.get(context.actor, context.workspaceId, conversationId) as unknown as Row;
        if (chat.leadId) throw new ToolInputError("This chat is already linked to an enquiry. Read it with get_conversation.");
        const related = await services.inbox.context(context.actor, context.workspaceId, conversationId) as unknown as Row;
        const contacts = rowsOf((related.party as Row | null)?.contacts);
        const chatName = str((related.party as Row | null)?.name) ?? str(chat.partyName);
        party = {
          displayName: str(input.name) ?? (chatName && !/^whatsapp\s*\+?\d/i.test(chatName) ? chatName : null),
          mobile: str(input.mobile) ?? str(contacts.find((item) => item.type === "phone")?.value),
          email: str(input.email) ?? str(contacts.find((item) => item.type === "email")?.value),
        };
        chatChannel = str(chat.channel);
        chatVersion = num(chat.version);
        summary ??= rowsOf(chat.messages).filter((message) => message.direction === "inbound").slice(-3).map((message) => str(message.bodyText)).filter(Boolean).join("\n") || null;
      }
      if (!party.displayName) throw new ToolQuestion("Ask for the client's name.");
      if (!party.mobile) throw new ToolQuestion("Ask for the client's mobile number.");
      const enquiryType = choose(options.enquiryTypes, input.enquiryType, "enquiry type");
      const region = options.emirates.length ? choose(options.emirates, input.region, "region") : null;
      // Every enquiry has a region: the workspace's list when it has one, else as the person says it.
      if (!region && !str(input.region)) throw new ToolQuestion("Ask which region the client is in.");
      // The chat's channel decides the source, as the enquiry form does: the company's own channel first.
      let source: Option;
      if (input.source) source = choose(options.sources, input.source, "source");
      else if (chatChannel) {
        const fromChat = options.sources.find((item) => item.id === "company" && options.channels[item.id]?.some((option) => option.id === chatChannel))
          ?? options.sources.find((item) => options.channels[item.id]?.some((option) => option.id === chatChannel));
        if (!fromChat) throw new ToolQuestion("Ask where this enquiry came from.", options.sources.map((option) => ({ type: "choice", id: option.id, label: option.label })));
        source = fromChat;
      } else throw new ToolQuestion("Ask where this enquiry came from.", options.sources.map((option) => ({ type: "choice", id: option.id, label: option.label })));
      const channels = options.channels[source.id] ?? [];
      const channel = input.channel ? choose(channels, input.channel, "channel") : chatChannel && channels.some((option) => option.id === chatChannel) ? channels.find((option) => option.id === chatChannel)! : channels.length === 1 ? channels[0] : choose(channels, undefined, "channel");
      // Dedupe: an existing client with this mobile or email is the person's call, never a guess.
      const matches = rowsOf((await services.leads.contactMatch(context.actor, context.workspaceId, { mobile: String(party.mobile), ...(party.email ? { email: String(party.email) } : {}) }) as { matches?: unknown }).matches);
      let identity: Record<string, unknown> = {};
      if (matches.length) {
        if (input.existingClientId) {
          const chosen = matches.find((match) => match.partyId === String(input.existingClientId).toLowerCase());
          if (!chosen) throw new ToolQuestion("That client does not have this mobile or email. Ask which existing client it is, or whether it is a different person.", matches.map((match) => ({ ...ref("customer", String(match.partyId), str(match.name) ?? "Client"), detail: [str(match.reference), str(match.ownerName)].filter(Boolean).join(" · ") })));
          identity = { identity: "existing", partyId: chosen.partyId };
          party.displayName = str(chosen.name) ?? party.displayName;
        } else if (input.newClient === true) identity = { identity: "new" };
        else throw new ToolQuestion("This mobile or email already belongs to a client. Ask whether it is the same client (existingClientId) or a different person (newClient).",
          matches.map((match) => ({ ...ref("customer", String(match.partyId), str(match.name) ?? "Client"), detail: [str(match.reference), str(match.status), str(match.ownerName)].filter(Boolean).join(" · ") })));
      }
      let owner: { mode: string; ownerMembershipId?: string } = { mode: "automatic" };
      let ownerName = "Routing decides";
      if (input.ownerId) {
        const member = await memberById(services, context, uuidArg(input.ownerId, "ownerId"));
        if (!member.canOwnEnquiries) throw new ToolInputError(`${member.name} can't own enquiries`);
        assertMayAssign(context, member.id);
        owner = { mode: "manual", ownerMembershipId: member.id };
        ownerName = member.name;
      }
      const intake = {
        source: source.id, channel: channel.id, intakeMethod: "manual",
        party: pick(party, ["displayName", "mobile", "email"]), title: "", ...(summary ? { summary: summary.slice(0, 10_000) } : {}),
        serviceType: enquiryType.id, details: { emirate: region?.id ?? String(input.region ?? ""), ...(input.area ? { area: input.area } : {}) },
        assignment: owner, originalPayload: { origin: "woddy", runId: context.runId }, ...identity,
      };
      const fields: PreviewField[] = [
        { label: identity.identity === "existing" ? "Existing client" : "Client", after: String(party.displayName) },
        { label: "Mobile", after: String(party.mobile) },
        ...(party.email ? [{ label: "Email", after: String(party.email) }] : []),
        { label: "Enquiry type", after: enquiryType.label },
        { label: "Region", after: region?.label ?? String(input.region) },
        ...(input.area ? [{ label: "Area", after: String(input.area) }] : []),
        { label: "Source", after: `${source.label} · ${channel.label}` },
        { label: "Owner", after: ownerName },
        ...(summary ? [{ label: "Summary", after: clip(summary, 400) }] : []),
        ...(conversationId ? [{ label: "Chat", after: "Linked to this chat" }] : []),
      ];
      // The intake's own input rules, checked now so a card never promises what the module would refuse.
      await commandInput(CreateIntakeEventDto, intake);
      return {
        ...titled(phrase("Create an enquiry for {name}", { name: String(party.displayName) })),
        target: null,
        preview: { kind: "fields", fields },
        command: { intake, conversationId, conversationVersion: chatVersion },
      } satisfies Proposal;
    },
    async execute(context, proposal) {
      const input = await commandInput(CreateIntakeEventDto, proposal.command.intake as Row);
      const created = await services.intake.createManual(context.actor, context.workspaceId, `woddy:${proposal.idempotencyKey}`, proposal.runId, input) as unknown as Row;
      const leadId = str(created.leadId);
      const record = leadId ? ref("enquiry", leadId, str(created.reference) ?? "Enquiry") : null;
      const failures: NonNullable<Execution["failures"]> = [];
      const conversationId = str(proposal.command.conversationId);
      if (leadId && conversationId) {
        // The chat moves on while the card waits (new messages); it is linked only while still unlinked.
        const chat = await services.conversations.get(context.actor, context.workspaceId, conversationId) as unknown as Row;
        if (!chat.leadId) {
          try { await services.conversations.updateConversation(context.actor, context.workspaceId, conversationId, await commandInput(UpdateConversationDto, { version: num(chat.version), leadId })); }
          catch (error) { failures.push({ id: conversationId, label: "Chat", message: moduleMessage(error) }); }
        } else if (chat.leadId !== leadId) failures.push({ id: conversationId, label: "Chat", message: "The chat was linked to another enquiry meanwhile." });
      }
      return { result: { leadId, reference: str(created.reference), replay: Boolean(created.idempotentReplay) }, record, failures };
    },
  };

  const updateEnquiry: AiTool = {
    name: "update_enquiry",
    description: "Prepare changes to an enquiry's details (client name, contact, enquiry type, region, area, budget, client type, summary). The person sees each field's before and after.",
    kind: "write",
    confirmation: "confirm",
    calls: "CrmIntakeService.updateDetails (version-checked)",
    permissions: ["crm.leads.manage"],
    parameters: {
      type: "object",
      properties: {
        enquiryId: { type: "string", description: "Left out: the enquiry open", maxLength: 40 },
        name: { type: "string", maxLength: 240 },
        mobile: { type: "string", maxLength: 80 },
        email: { type: "string", maxLength: 320 },
        enquiryType: { type: "string", maxLength: 100 },
        region: { type: "string", maxLength: 100 },
        area: { type: "string", maxLength: 240 },
        budgetRange: { type: "string", maxLength: 80 },
        customerType: { type: "string", maxLength: 80 },
        summary: { type: "string", maxLength: 4000 },
      },
    },
    async propose(context, input) {
      const leadId = contextId(context, input.enquiryId, "enquiry", "enquiryId");
      const [lead, options] = await Promise.all([
        services.leads.get(context.actor, context.workspaceId, leadId) as unknown as Promise<Row>,
        services.intake.options(context.actor, context.workspaceId) as unknown as Promise<LeadOptions>,
      ]);
      const enquiry = (lead.enquiry ?? {}) as Row;
      const details = (enquiry.details ?? {}) as Row;
      const beforeParty = { ...pick(details.contact, PARTY_KEYS), displayName: str(enquiry.partyName) ?? "", ...(str(enquiry.primaryMobile) ? { mobile: str(enquiry.primaryMobile) } : {}), ...(str(enquiry.primaryEmail) ? { email: str(enquiry.primaryEmail) } : {}) } as Row;
      const party = { ...beforeParty } as Row;
      const nextDetails = pick(details, DETAIL_KEYS) as Row;
      let serviceType = str(enquiry.serviceType) ?? "";
      let summary = str(enquiry.summary);
      const fields: PreviewField[] = [];
      const change = (label: string, before: unknown, after: unknown) => { if ((before ?? "") !== (after ?? "")) fields.push({ label, before: str(before), after: str(after) }); };
      if (input.name) { change("Client", party.displayName, input.name); party.displayName = input.name; }
      if (input.mobile) { change("Mobile", party.mobile, input.mobile); party.mobile = input.mobile; }
      if (input.email) { change("Email", party.email, input.email); party.email = input.email; }
      if (input.enquiryType) { const choice = choose(options.enquiryTypes, input.enquiryType, "enquiry type"); change("Enquiry type", labelOf(options.enquiryTypes, serviceType), choice.label); serviceType = choice.id; }
      if (input.region) { const choice = options.emirates.length ? choose(options.emirates, input.region, "region") : { id: String(input.region), label: String(input.region) }; change("Region", labelOf(options.emirates, nextDetails.emirate), choice.label); nextDetails.emirate = choice.id; }
      if (input.area) { change("Area", nextDetails.area, input.area); nextDetails.area = input.area; }
      if (input.budgetRange) { const choice = choose(options.budgetRanges, input.budgetRange, "budget range"); change("Budget", labelOf(options.budgetRanges, nextDetails.budgetRange), choice.label); nextDetails.budgetRange = choice.id; }
      if (input.customerType) { const choice = choose(options.customerTypes, input.customerType, "client type"); change("Client type", labelOf(options.customerTypes, nextDetails.customerType), choice.label); nextDetails.customerType = choice.id; }
      if (input.summary) { change("Summary", clip(summary, 400), clip(input.summary, 400)); summary = String(input.summary); }
      if (!fields.length) throw new ToolInputError("Nothing would change: every value is already the same");
      const label = str(enquiry.reference) ?? str(enquiry.title) ?? "Enquiry";
      const updated = { version: num(lead.version), serviceType, ...(summary ? { summary } : {}), party: pick(party, PARTY_KEYS), details: nextDetails };
      await commandInput(UpdateLeadDetailsDto, updated);
      return {
        ...titled(phrase("Update {record}", { record: label })),
        target: { ...ref("enquiry", leadId, label), version: num(lead.version) },
        preview: { kind: "fields", fields },
        command: { leadId, details: updated },
      } satisfies Proposal;
    },
    async execute(context, proposal) {
      const leadId = String(proposal.command.leadId);
      const saved = await services.intake.updateDetails(context.actor, context.workspaceId, leadId, await commandInput(UpdateLeadDetailsDto, proposal.command.details as Row)) as unknown as Row;
      return { result: { leadId, version: num(saved.version) }, record: ref("enquiry", leadId, "Enquiry") };
    },
  };

  const logActivity: AiTool = {
    name: "log_activity",
    description: "Prepare a record of something that happened with a client (a call, meeting, email, WhatsApp, SMS or a note) on their enquiry, opportunity or customer.",
    kind: "write",
    confirmation: "confirm",
    calls: "CrmActivitiesService.create, then CrmActivitiesService.complete",
    permissions: ["crm.activities.manage"],
    parameters: {
      type: "object",
      properties: {
        recordType: { type: "string", enum: ["enquiry", "opportunity", "customer"] },
        recordId: { type: "string", maxLength: 40 },
        kind: { type: "string", enum: ["note", "call", "meeting", "email", "whatsapp", "sms", "other"] },
        title: { type: "string", description: "A short title, e.g. Called about the kitchen layout", maxLength: 240 },
        details: { type: "string", maxLength: 4000 },
        outcome: { type: "string", description: "How it went, in a few words", maxLength: 120 },
      },
      required: ["kind", "title"],
    },
    async propose(context, input) {
      const record = await resolveSalesRecord(services, context, input);
      const kind = String(input.kind);
      return {
        ...titled(phrase("Log {kind} on {record}", { kind: KIND_LABELS[kind] ?? kind, record: record.label })),
        target: { ...record, version: null },
        preview: { kind: "fields", fields: [
          { label: "On", after: `${record.label}${record.client ? ` · ${record.client}` : ""}` }, { label: "Type", after: KIND_LABELS[kind] ?? kind }, { label: "Title", after: String(input.title) },
          ...(input.details ? [{ label: "Details", after: clip(input.details, 600) }] : []), ...(input.outcome ? [{ label: "Outcome", after: String(input.outcome) }] : []),
        ] },
        command: {
          activity: { type: kind, title: input.title, ...(input.details ? { description: input.details } : {}), [targetKey(record.type)]: record.id, ownerMembershipId: context.membershipId },
          outcome: input.outcome ?? null,
        },
      } satisfies Proposal;
    },
    async execute(context, proposal) {
      const created = await services.activities.create(context.actor, context.workspaceId, await commandInput(CreateActivityDto, proposal.command.activity as Row)) as unknown as Row;
      // What is logged has happened: it is completed straight away, so it never waits as a to-do.
      await services.activities.complete(context.actor, context.workspaceId, String(created.id), await commandInput(CompleteActivityDto, { version: num(created.version), ...(proposal.command.outcome ? { outcome: proposal.command.outcome } : {}) }));
      return { result: { activityId: created.id }, record: proposal.targetType && proposal.targetId ? ref(proposal.targetType, proposal.targetId, "Record") : null };
    },
  };

  const scheduleFollowUp: AiTool = {
    name: "schedule_follow_up",
    description: "Prepare a follow-up (the next action) with a client at a time in the workspace's time zone. Name the client in `client`, or give recordType and recordId; when several records match, ask the person which one.",
    kind: "write",
    confirmation: "confirm",
    calls: "CrmActivitiesService.create (isNextAction)",
    permissions: ["crm.activities.manage"],
    parameters: {
      type: "object",
      properties: {
        client: { type: "string", description: "The client's name as the person said it", maxLength: 160 },
        recordType: { type: "string", enum: ["enquiry", "opportunity"] },
        recordId: { type: "string", maxLength: 40 },
        when: { type: "string", description: "Local date and time, e.g. 2026-09-30T10:00", maxLength: 25 },
        kind: { type: "string", enum: ["call", "meeting", "task"] },
        title: { type: "string", maxLength: 240 },
        ownerId: { type: "string", description: "A member id; left out: the person asking", maxLength: 40 },
      },
      required: ["when"],
    },
    async propose(context, input) {
      const record = await resolveSalesRecord(services, context, input);
      if (record.type === "customer") throw new ToolInputError("Follow-ups go on an enquiry or opportunity: find the client's open one");
      const dueAt = zonedArg(input.when, context.timeZone, "when", context.now, { future: true });
      const ownerId = input.ownerId ? uuidArg(input.ownerId, "ownerId") : context.membershipId;
      assertMayAssign(context, ownerId);
      const owner = ownerId === context.membershipId ? { name: "You" } : await memberById(services, context, ownerId);
      const kind = String(input.kind ?? "call");
      const title = str(input.title) ?? `Follow up with ${record.client ?? record.label}`;
      return {
        ...titled(phrase("Follow up with {client}", { client: record.client ?? record.label }), ` at ${zonedWallTime(new Date(dueAt), context.timeZone)}`),
        target: { ...record, version: null },
        preview: { kind: "fields", fields: [
          { label: "With", after: `${record.client ?? record.label} · ${record.label}` }, { label: "When", after: dueAt, format: "datetime" },
          { label: "Type", after: KIND_LABELS[kind] ?? kind }, { label: "Title", after: title }, { label: "Owner", after: owner.name },
        ] },
        command: { activity: { type: kind, title, [targetKey(record.type)]: record.id, dueAt, isNextAction: true, ownerMembershipId: ownerId } },
      } satisfies Proposal;
    },
    async execute(context, proposal) {
      const activity = proposal.command.activity as Row;
      if (activity.ownerMembershipId) assertMayAssign(context, String(activity.ownerMembershipId));
      const created = await services.activities.create(context.actor, context.workspaceId, await commandInput(CreateActivityDto, activity)) as unknown as Row;
      return { result: { activityId: created.id, dueAt: created.dueAt }, record: proposal.targetType && proposal.targetId ? ref(proposal.targetType, proposal.targetId, "Record") : null };
    },
  };

  const assignRecords: AiTool = {
    name: "assign_records",
    description: "Prepare giving chats or enquiries to a teammate (find them with find_member). Chats: the ids given, else the chats the person selected, else the chat open. The person sees every item and can untick any.",
    kind: "write",
    confirmation: "confirm",
    calls: "CrmConversationsService.updateConversation (per chat, version-checked) or CrmLeadsService.manualAssign (per enquiry, version-checked)",
    permissions: [],
    anyPermissions: ["crm.communications.send", "crm.leads.assign"],
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["conversation", "enquiry"] },
        ids: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 50 },
        memberId: { type: "string", description: "From find_member", maxLength: 40 },
        reason: { type: "string", description: "Why (enquiries)", maxLength: 500 },
      },
      required: ["type", "memberId"],
    },
    async propose(context, input) {
      const type = String(input.type);
      const member = await memberById(services, context, uuidArg(input.memberId, "memberId"));
      const items: Array<{ id: string; version: number; label: string }> = [];
      const targets: ProposalTarget[] = [];
      if (type === "conversation") {
        if (!context.permissions.has("crm.communications.send")) throw new ForbiddenException("Assigning chats needs permission to reply in the inbox.");
        if (!member.canOwnChats) throw new ToolInputError(`${member.name} can't see the inbox, so can't own chats`);
        for (const id of chatIds(context, input.ids)) {
          const chat = await services.conversations.get(context.actor, context.workspaceId, id) as unknown as Row;
          const label = `${str(chat.partyName) ?? "Chat"} · ${str(chat.channel) ?? "chat"}`;
          if (chat.ownerMembershipId === member.id) continue;
          items.push({ id, version: Number(chat.version), label });
          targets.push({ ...ref("conversation", id, label), now: str(chat.ownerName) ?? "Unassigned" });
        }
      } else {
        if (!context.permissions.has("crm.leads.assign")) throw new ForbiddenException("Assigning enquiries needs the lead assignment permission.");
        if (!member.canOwnEnquiries) throw new ToolInputError(`${member.name} can't own enquiries`);
        const ids = Array.isArray(input.ids) && input.ids.length ? [...new Set(input.ids.map((id) => uuidArg(id, "ids")))]
          : context.selection?.type === "enquiry" ? context.selection.ids : context.record?.type === "enquiry" ? [context.record.id] : [];
        if (!ids.length) throw new ToolInputError("ids is required: which enquiries?");
        for (const id of ids) {
          const lead = await services.leads.get(context.actor, context.workspaceId, id) as unknown as Row;
          const enquiry = (lead.enquiry ?? {}) as Row;
          const label = `${str(enquiry.reference) ?? "Enquiry"} · ${str(enquiry.partyName) ?? ""}`.replace(/ · $/, "");
          if (lead.ownerMembershipId === member.id) continue;
          items.push({ id, version: Number(lead.version), label });
          targets.push({ ...ref("enquiry", id, label), now: str(lead.ownerName) ?? "Unassigned" });
        }
      }
      if (!items.length) throw new ToolInputError(`Everything listed is already with ${member.name}`);
      return {
        ...titled(phrase(type === "conversation" ? (items.length === 1 ? "Assign 1 chat to {name}" : "Assign {count} chats to {name}") : (items.length === 1 ? "Assign 1 enquiry to {name}" : "Assign {count} enquiries to {name}"), { count: items.length, name: member.name })),
        target: null,
        preview: { kind: "targets", items: targets, selectable: items.length > 1, fields: [{ label: "Assign to", after: member.name }] },
        command: { type, memberId: member.id, reason: str(input.reason) ?? "Reassigned", items },
      } satisfies Proposal;
    },
    async execute(context, proposal) {
      const memberId = String(proposal.command.memberId);
      if (proposal.command.type === "conversation") {
        return eachItem(proposal, async (item) => services.conversations.updateConversation(context.actor, context.workspaceId, item.id, await commandInput(UpdateConversationDto, { version: item.version, ownerMembershipId: memberId })));
      }
      return eachItem(proposal, async (item) => services.leads.manualAssign(context.actor, context.workspaceId, item.id, await commandInput(AssignLeadDto, { version: item.version, ownerMembershipId: memberId, reason: String(proposal.command.reason) })));
    },
  };

  const setChatState: AiTool = {
    name: "set_chat_state",
    description: "Prepare resolving, reopening or snoozing chats (the ids given, else the selected chats, else the chat open). Snoozing needs a local time to come back.",
    kind: "write",
    confirmation: "confirm",
    calls: "CrmConversationsService.updateConversation (per chat, version-checked)",
    permissions: ["crm.communications.send"],
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 50 },
        state: { type: "string", enum: ["open", "snoozed", "closed"], description: "closed is Resolved" },
        snoozeUntil: { type: "string", description: "Local date and time, for snoozed", maxLength: 25 },
      },
      required: ["state"],
    },
    async propose(context, input) {
      const state = String(input.state);
      const snoozedUntil = state === "snoozed" ? zonedArg(input.snoozeUntil, context.timeZone, "snoozeUntil", context.now, { future: true }) : null;
      const items: Array<{ id: string; version: number; label: string }> = [];
      const targets: ProposalTarget[] = [];
      for (const id of chatIds(context, input.ids)) {
        const chat = await services.conversations.get(context.actor, context.workspaceId, id) as unknown as Row;
        if (chat.status === state && state !== "snoozed") continue;
        const label = `${str(chat.partyName) ?? "Chat"} · ${str(chat.channel) ?? "chat"}`;
        items.push({ id, version: Number(chat.version), label });
        targets.push({ ...ref("conversation", id, label), now: STATE_LABELS[String(chat.status)] ?? str(chat.status) });
      }
      if (!items.length) throw new ToolInputError("Every chat listed is already in that state");
      return {
        ...titled(phrase(`${state === "closed" ? "Resolve" : state === "open" ? "Reopen" : "Snooze"} ${items.length === 1 ? "1 chat" : "{count} chats"}`, { count: items.length })),
        target: null,
        preview: { kind: "targets", items: targets, selectable: items.length > 1, fields: [{ label: "State", after: STATE_LABELS[state] }, ...(snoozedUntil ? [{ label: "Until", after: snoozedUntil, format: "datetime" as const }] : [])] },
        command: { state, snoozedUntil, items },
      } satisfies Proposal;
    },
    async execute(context, proposal) {
      const { state, snoozedUntil } = proposal.command as { state: string; snoozedUntil: string | null };
      return eachItem(proposal, async (item) => services.conversations.updateConversation(context.actor, context.workspaceId, item.id,
        await commandInput(UpdateConversationDto, { version: item.version, status: state, ...(snoozedUntil ? { snoozedUntil } : {}) })));
    },
  };

  const scheduleMessage: AiTool = {
    name: "schedule_message",
    description: "Prepare a message to a client in a chat that is sent later, at a local date and time (the chat given, else the chat open). Free text only while WhatsApp's 24-hour window will still be open then; otherwise name an approved template. The card shows the exact text and time.",
    kind: "write",
    confirmation: "confirm",
    calls: "CrmScheduledMessagesService.create (idempotent by request id; the worker sends it at its time through the normal reply path)",
    permissions: ["crm.communications.send"],
    parameters: {
      type: "object",
      properties: {
        conversationId: { type: "string", description: "Left out: the chat open", maxLength: 40 },
        sendAt: { type: "string", description: "Local date and time to send it", maxLength: 25 },
        text: { type: "string", description: "The message, in the client's language (instead of a template)", maxLength: 4000 },
        template: { type: "string", description: "An approved WhatsApp template's name (instead of text)", maxLength: 512 },
        templateValues: { type: "array", items: { type: "string", maxLength: 1024 }, maxItems: 20, description: "Values for the template's {{1}}…{{n}}; left out, they come from the chat's records" },
      },
      required: ["sendAt"],
    },
    async propose(context, input) {
      const conversationId = contextId(context, input.conversationId, "conversation", "conversationId");
      const sendAt = zonedArg(input.sendAt, context.timeZone, "sendAt", context.now, { future: true });
      const text = typeof input.text === "string" && input.text.trim() ? input.text.trim() : null;
      const name = typeof input.template === "string" && input.template.trim() ? input.template.trim().toLowerCase() : null;
      if (Boolean(text) === Boolean(name)) throw new ToolInputError("Give either text or a template");
      let templateId: string | null = null;
      if (name) {
        const templates = rowsOf(await services.inbox.templates(context.actor, context.workspaceId)).filter((row) => row.approved === true && row.usable !== false);
        const found = templates.find((row) => String(row.code).toLowerCase() === name);
        if (!found) throw new ToolQuestion(`No approved template is called "${String(input.template)}". Ask which one to use.`, templates.slice(0, 20).map((row) => ({ type: "template", id: String(row.id), label: String(row.code), detail: clip(row.body, 120) })));
        templateId = String(found.id);
      }
      const values = Array.isArray(input.templateValues) ? input.templateValues.map(String) : undefined;
      // The same checks the send makes (window, template, values); the card shows exactly what the client will read.
      const preview = await services.scheduled.preview(context.actor, context.workspaceId, conversationId, { sendAt, bodyText: text, templateId, templateParameters: templateId ? values : undefined });
      const label = `${preview.partyName ?? "Chat"} · ${preview.channel === "whatsapp" ? "WhatsApp" : preview.channel}`;
      return {
        ...titled(phrase("Send a message to {client} later", { client: preview.partyName ?? "the client" })),
        target: { ...ref("conversation", conversationId, label), version: null },
        preview: { kind: "text", text: preview.renderedText, fields: [{ label: "To", after: label }, { label: "Send at", after: preview.sendAt, format: "datetime" },
          ...(preview.templateCode ? [{ label: "Template", after: preview.templateCode }] : [])] },
        command: { conversationId, clientRequestId: randomUUID(), sendAt: preview.sendAt,
          ...(preview.templateId ? { templateId: preview.templateId, templateParameters: preview.templateParameters } : { bodyText: text }) },
      } satisfies Proposal;
    },
    async execute(context, proposal) {
      const { conversationId, ...command } = proposal.command as Row & { conversationId: string };
      const scheduled = await services.scheduled.create(context.actor, context.workspaceId, conversationId, await commandInput(CreateScheduledMessageDto, command));
      return { result: { scheduledMessageId: scheduled.id, sendAt: scheduled.sendAt }, record: ref("conversation", conversationId, "Chat") };
    },
  };

  const labelChats: AiTool = {
    name: "label_chats",
    description: "Prepare adding or removing the workspace's existing labels on chats (the ids given, else the selected chats, else the chat open).",
    kind: "write",
    confirmation: "confirm",
    calls: "CrmInboxService.setConversationLabels (per chat)",
    permissions: ["crm.communications.send"],
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 50 },
        add: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 10 },
        remove: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 10 },
      },
    },
    async propose(context, input) {
      const all = rowsOf(await services.inbox.labels(context.actor, context.workspaceId)).filter((label) => label.status !== "archived");
      const resolve = (names: unknown) => (Array.isArray(names) ? names : []).map((name) => {
        const found = all.find((label) => String(label.name).toLowerCase() === String(name).trim().toLowerCase() || label.id === name);
        if (!found) throw new ToolQuestion(`There is no "${String(name)}" label. Ask which existing label they mean.`, all.slice(0, 20).map((label) => ({ type: "choice", id: String(label.id), label: String(label.name) })));
        return { id: String(found.id), name: String(found.name) };
      });
      const add = resolve(input.add), remove = resolve(input.remove);
      if (!add.length && !remove.length) throw new ToolInputError("Say which labels to add or remove");
      const items: Array<{ id: string; version: number; label: string }> = [];
      const targets: ProposalTarget[] = [];
      for (const id of chatIds(context, input.ids)) {
        const chat = await services.conversations.get(context.actor, context.workspaceId, id) as unknown as Row;
        const label = `${str(chat.partyName) ?? "Chat"} · ${str(chat.channel) ?? "chat"}`;
        items.push({ id, version: Number(chat.version), label });
        targets.push({ ...ref("conversation", id, label), now: rowsOf(chat.labels).map((item) => str(item.name)).filter(Boolean).join(", ") || null });
      }
      return {
        ...titled(phrase(items.length === 1 ? "Label 1 chat" : "Label {count} chats", { count: items.length })),
        target: null,
        preview: { kind: "targets", items: targets, selectable: items.length > 1, fields: [
          ...(add.length ? [{ label: "Add", after: add.map((item) => item.name).join(", ") }] : []), ...(remove.length ? [{ label: "Remove", after: remove.map((item) => item.name).join(", ") }] : []),
        ] },
        command: { add: add.map((item) => item.id), remove: remove.map((item) => item.id), items },
      } satisfies Proposal;
    },
    async execute(context, proposal) {
      const { add, remove } = proposal.command as { add: string[]; remove: string[] };
      // Labels are a set without a version: each chat's current labels are read at confirm time, so a
      // label someone added meanwhile is kept.
      return eachItem(proposal, async (item) => {
        const chat = await services.conversations.get(context.actor, context.workspaceId, item.id) as unknown as Row;
        const current = rowsOf(chat.labels).map((label) => String(label.id));
        const labelIds = [...new Set([...current.filter((id) => !remove.includes(id)), ...add])];
        return services.inbox.setConversationLabels(context.actor, context.workspaceId, item.id, await commandInput(SetConversationLabelsDto, { labelIds }));
      });
    },
  };

  const convertEnquiry: AiTool = {
    name: "convert_enquiry",
    description: "Prepare converting an enquiry into an opportunity in the default sales pipeline. Needs a next follow-up time (local) unless the enquiry already has one ahead.",
    kind: "write",
    confirmation: "confirm",
    calls: "CrmOpportunitiesService.qualifyLead (lead version-checked, replay-safe)",
    permissions: ["crm.opportunities.manage", "crm.leads.manage"],
    parameters: {
      type: "object",
      properties: {
        enquiryId: { type: "string", description: "Left out: the enquiry open", maxLength: 40 },
        title: { type: "string", description: "The opportunity's name", maxLength: 240 },
        nextFollowUp: { type: "string", description: "Local date and time", maxLength: 25 },
        ownerId: { type: "string", description: "A member id; left out: the enquiry's owner", maxLength: 40 },
      },
    },
    async propose(context, input) {
      const leadId = contextId(context, input.enquiryId, "enquiry", "enquiryId");
      const lead = await services.leads.get(context.actor, context.workspaceId, leadId) as unknown as Row;
      const enquiry = (lead.enquiry ?? {}) as Row;
      const label = str(enquiry.reference) ?? str(enquiry.title) ?? "Enquiry";
      if (rowsOf(lead.opportunities).length || ["qualified", "disqualified", "duplicate"].includes(String(lead.status))) throw new ToolInputError(`${label} is already converted or closed`);
      if (!hasResolvedEnquiryType(str(enquiry.serviceType))) throw new ToolQuestion(`${label} is marked Not Sure Yet. Ask for its enquiry type and update the enquiry first.`);
      const pipelines = rowsOf(await services.opportunities.listPipelines(context.actor, context.workspaceId)).filter((pipeline) => pipeline.status === "active");
      const pipeline = pipelines.find((item) => item.isDefault) ?? pipelines[0];
      if (!pipeline) throw new ToolInputError("No sales pipeline is set up yet. Ask a workspace administrator to add one in Sales settings.");
      const existing = str(lead.nextActionAt);
      const nextActionAt = input.nextFollowUp ? zonedArg(input.nextFollowUp, context.timeZone, "nextFollowUp", context.now, { future: true })
        : existing && Date.parse(existing) > context.now.getTime() ? new Date(existing).toISOString() : null;
      if (!nextActionAt) throw new ToolQuestion("Ask when the next follow-up with the client should be.");
      const ownerId = input.ownerId ? uuidArg(input.ownerId, "ownerId") : str(lead.ownerMembershipId) ?? context.membershipId;
      const owner = ownerId === context.membershipId ? { name: "You", canOwnEnquiries: true } : await memberById(services, context, ownerId);
      if (!owner.canOwnEnquiries) throw new ToolInputError(`${owner.name} can't own sales work`);
      const title = str(input.title) ?? str(enquiry.title) ?? `${str(enquiry.partyName) ?? "Client"} opportunity`;
      return {
        ...titled(phrase("Convert {record} to an opportunity", { record: label })),
        target: { ...ref("enquiry", leadId, label), version: num(lead.version) },
        preview: { kind: "fields", fields: [
          { label: "Enquiry", after: `${label} · ${str(enquiry.partyName) ?? ""}` }, { label: "Opportunity", after: title }, { label: "Pipeline", after: str(pipeline.name) },
          { label: "Owner", after: owner.name }, { label: "Next follow-up", after: nextActionAt, format: "datetime" },
        ] },
        command: { leadId, qualify: { partyId: str(lead.partyId), leadVersion: num(lead.version), pipelineId: str(pipeline.id), ownerMembershipId: ownerId, title, nextActionAt } },
      } satisfies Proposal;
    },
    async execute(context, proposal) {
      const leadId = String(proposal.command.leadId);
      const created = await services.opportunities.qualifyLead(context.actor, context.workspaceId, leadId, await commandInput(QualifyLeadDto, proposal.command.qualify as Row)) as unknown as Row;
      return { result: { opportunityId: created.id, replay: Boolean(created.conversionReplay) }, record: ref("opportunity", String(created.id), str(created.reference) ?? str(created.title) ?? "Opportunity") };
    },
  };

  const moveOpportunity: AiTool = {
    name: "move_opportunity",
    description: "Prepare moving an open opportunity to another stage of its pipeline (by stage name). Won and lost are marked in the opportunity itself.",
    kind: "write",
    confirmation: "confirm",
    calls: "CrmOpportunitiesService.transition (version-checked)",
    permissions: ["crm.opportunities.transition"],
    parameters: {
      type: "object",
      properties: {
        opportunityId: { type: "string", description: "Left out: the opportunity open", maxLength: 40 },
        stage: { type: "string", description: "The stage's name", maxLength: 120 },
        nextFollowUp: { type: "string", description: "Local date and time, when the stage asks for one", maxLength: 25 },
      },
      required: ["stage"],
    },
    async propose(context, input) {
      const opportunityId = contextId(context, input.opportunityId, "opportunity", "opportunityId");
      const opportunity = await services.opportunities.get(context.actor, context.workspaceId, opportunityId) as unknown as Row;
      const label = str(opportunity.reference) ?? str(opportunity.title) ?? "Opportunity";
      if (opportunity.status !== "open") throw new ToolInputError(`${label} is ${String(opportunity.status)}, not open`);
      const pipeline = rowsOf(await services.opportunities.listPipelines(context.actor, context.workspaceId)).find((item) => item.id === opportunity.pipelineId);
      const stages = rowsOf(pipeline?.stages).filter((stage) => stage.status !== "archived" && stage.forecastCategory !== "closed");
      const wanted = String(input.stage).trim().toLowerCase();
      const stage = stages.find((item) => String(item.name).toLowerCase() === wanted || String(item.code).toLowerCase() === wanted || item.id === input.stage);
      if (!stage) throw new ToolQuestion(`There is no open stage called "${String(input.stage)}". Ask which stage.`, stages.map((item) => ({ type: "choice", id: String(item.id), label: String(item.name) })));
      if (stage.id === opportunity.stageId) throw new ToolInputError(`${label} is already in ${String(stage.name)}`);
      const nextActionAt = input.nextFollowUp ? zonedArg(input.nextFollowUp, context.timeZone, "nextFollowUp", context.now, { future: true }) : null;
      return {
        ...titled(phrase("Move {record} to {stage}", { record: label, stage: String(stage.name) })),
        target: { ...ref("opportunity", opportunityId, label), version: num(opportunity.version) },
        preview: { kind: "fields", fields: [
          { label: "Stage", before: str(opportunity.stageName), after: String(stage.name) },
          ...(nextActionAt ? [{ label: "Next follow-up", after: nextActionAt, format: "datetime" as const }] : []),
        ] },
        command: { opportunityId, transition: { version: num(opportunity.version), stageId: String(stage.id), ...(nextActionAt ? { nextActionAt } : {}) } },
      } satisfies Proposal;
    },
    async execute(context, proposal) {
      const opportunityId = String(proposal.command.opportunityId);
      const moved = await services.opportunities.transition(context.actor, context.workspaceId, opportunityId, await commandInput(TransitionOpportunityDto, proposal.command.transition as Row)) as unknown as Row;
      return { result: { opportunityId, version: num(moved.version) }, record: ref("opportunity", opportunityId, str(moved.reference) ?? str(moved.title) ?? "Opportunity") };
    },
  };

  return [createEnquiry, updateEnquiry, logActivity, scheduleFollowUp, assignRecords, setChatState, scheduleMessage, labelChats, convertEnquiry, moveOpportunity];
}

export const crmToolHelpers = { resolveSalesRecord, memberById, assertMayAssign, contextId, targetKey };
