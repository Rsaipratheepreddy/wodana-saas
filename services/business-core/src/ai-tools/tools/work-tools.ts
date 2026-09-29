import { NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { CompleteActivityDto, CreateActivityDto, UpdateActivityDto } from "../../crm/activities/dto/activities.dto";
import { ToolInputError, type AiTool, type AiToolContext, type PreviewField, type Proposal } from "../ai-tool";
import { clip, ref, uuidArg, zonedArg, zonedWallTime } from "../tool-kit";
import { commandInput, num, str, type Row, type ToolServices } from "../tool-services";
import { crmToolHelpers } from "./crm-write-tools";

const PRIORITIES = ["low", "normal", "high", "urgent"];
const WORK_STATUSES = ["todo", "in_progress", "in_review", "done"];

/** A project task and its project, read through the project module (its own access rules). */
async function workItem(services: ToolServices, context: AiToolContext, itemId: string) {
  const projectId = await services.access.asMember(context.actor, context.workspaceId, async (client) =>
    (await client.query<{ projectId: string }>(`SELECT project_id AS "projectId" FROM work_items WHERE workspace_id = $1 AND id = $2`, [context.workspaceId, itemId])).rows[0]?.projectId);
  if (!projectId) throw new NotFoundException("Task not found");
  const item = await services.work.item(context.actor, context.workspaceId, projectId, itemId) as unknown as Row;
  return { projectId, item, label: `#${str(item.number) ?? "?"} ${clip(item.title, 60) ?? ""}`.trim() };
}

/** A date for a project task: its day in the workspace's calendar. */
function dayArg(value: unknown, timeZone: string, name: string) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const instant = zonedArg(text, timeZone, name);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

async function memberName(services: ToolServices, context: AiToolContext, memberId: string) {
  if (memberId === context.membershipId) return "You";
  return (await crmToolHelpers.memberById(services, context, memberId)).name;
}

export function workTools(services: ToolServices): AiTool[] {
  const createTask: AiTool = {
    name: "create_task",
    description: "Prepare a new task: a sales task on an enquiry, opportunity or customer, or a project task on a project. Due is a local date (or date and time for sales tasks).",
    kind: "write",
    confirmation: "confirm",
    calls: "CrmActivitiesService.create (type task) or ProjectWorkService.command create (idempotent by id)",
    permissions: [],
    anyPermissions: ["crm.activities.manage", "projects.view", "projects.manage"],
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 240 },
        recordType: { type: "string", enum: ["enquiry", "opportunity", "customer", "project"] },
        recordId: { type: "string", maxLength: 40 },
        due: { type: "string", description: "Local date, or date and time", maxLength: 25 },
        assigneeId: { type: "string", description: "A member id; left out: the person asking", maxLength: 40 },
        priority: { type: "string", enum: PRIORITIES },
        notes: { type: "string", maxLength: 4000 },
      },
      required: ["title", "recordType"],
    },
    async propose(context, input) {
      const assigneeId = input.assigneeId ? uuidArg(input.assigneeId, "assigneeId") : context.membershipId;
      const title = String(input.title);
      if (input.recordType === "project") {
        const projectId = uuidArg(input.recordId ?? (context.record?.type === "project" ? context.record.id : undefined), "recordId");
        const project = await services.access.asMember(context.actor, context.workspaceId, async (client) => (await client.query<{ reference: string; name: string }>(
          `SELECT reference, name FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [context.workspaceId, projectId])).rows[0]);
        if (!project) throw new NotFoundException("Project not found");
        const dueDate = input.due ? dayArg(input.due, context.timeZone, "due") : undefined;
        const label = `${project.reference} · ${project.name}`;
        return {
          summary: `Add "${title}" to ${project.reference}`,
          target: { ...ref("project", projectId, label), version: null },
          preview: { kind: "fields", fields: [
            { label: "Task", after: title }, { label: "Project", after: label }, ...(dueDate ? [{ label: "Due", after: dueDate }] : []),
            { label: "Assignee", after: await memberName(services, context, assigneeId) }, ...(input.priority ? [{ label: "Priority", after: String(input.priority) }] : []),
            ...(input.notes ? [{ label: "Notes", after: clip(input.notes, 400) }] : []),
          ] },
          // The item's id is chosen now: confirming twice creates it once.
          command: { projectId, work: { action: "create", id: randomUUID(), title, type: "task", assigneeId, ...(dueDate ? { dueDate } : {}), ...(input.priority ? { priority: input.priority } : {}), ...(input.notes ? { description: input.notes } : {}) } },
        } satisfies Proposal;
      }
      const record = await crmToolHelpers.resolveSalesRecord(services, context, { recordType: input.recordType, recordId: input.recordId });
      crmToolHelpers.assertMayAssign(context, assigneeId);
      const dueAt = input.due ? zonedArg(String(input.due).length === 10 ? `${String(input.due)}T09:00` : input.due, context.timeZone, "due") : undefined;
      return {
        summary: `Add the task "${title}" on ${record.label}`,
        target: { ...record, version: null },
        preview: { kind: "fields", fields: [
          { label: "Task", after: title }, { label: "On", after: `${record.label}${record.client ? ` · ${record.client}` : ""}` },
          ...(dueAt ? [{ label: "Due", after: `${zonedWallTime(new Date(dueAt), context.timeZone)} (${context.timeZone})` }] : []),
          { label: "Owner", after: await memberName(services, context, assigneeId) }, ...(input.priority ? [{ label: "Priority", after: String(input.priority) }] : []),
          ...(input.notes ? [{ label: "Notes", after: clip(input.notes, 400) }] : []),
        ] },
        command: { activity: { type: "task", title, [crmToolHelpers.targetKey(record.type)]: record.id, ownerMembershipId: assigneeId, ...(dueAt ? { dueAt } : {}), ...(input.priority ? { priority: input.priority } : {}), ...(input.notes ? { description: input.notes } : {}) } },
      } satisfies Proposal;
    },
    async execute(context, proposal) {
      if (proposal.command.work) {
        const projectId = String(proposal.command.projectId);
        const work = proposal.command.work as Row;
        await services.work.command(context.actor, context.workspaceId, projectId, work);
        return { result: { workItemId: work.id }, record: ref("work_item", String(work.id), String(work.title), { projectId }) };
      }
      const activity = proposal.command.activity as Row;
      crmToolHelpers.assertMayAssign(context, String(activity.ownerMembershipId));
      const created = await services.activities.create(context.actor, context.workspaceId, await commandInput(CreateActivityDto, activity)) as unknown as Row;
      return { result: { activityId: created.id }, record: proposal.targetType && proposal.targetId ? ref(proposal.targetType, proposal.targetId, "Record") : null };
    },
  };

  const updateTask: AiTool = {
    name: "update_task",
    description: "Prepare changes to a task: a sales task (crm_task) or a project task (work_item). Change its title, due, assignee or priority, or mark it done (a project task can also move to in progress or in review).",
    kind: "write",
    confirmation: "confirm",
    calls: "CrmActivitiesService.update / complete, or ProjectWorkService.command update (version-checked)",
    permissions: [],
    anyPermissions: ["crm.activities.manage", "projects.view", "projects.manage"],
    parameters: {
      type: "object",
      properties: {
        taskType: { type: "string", enum: ["crm_task", "work_item"] },
        taskId: { type: "string", maxLength: 40 },
        title: { type: "string", maxLength: 240 },
        due: { type: "string", description: "Local date, or date and time", maxLength: 25 },
        assigneeId: { type: "string", maxLength: 40 },
        priority: { type: "string", enum: PRIORITIES },
        status: { type: "string", enum: WORK_STATUSES },
      },
      required: ["taskType", "taskId"],
    },
    async propose(context, input) {
      const taskId = uuidArg(input.taskId, "taskId");
      const fields: PreviewField[] = [];
      if (input.taskType === "work_item") {
        const { projectId, item, label } = await workItem(services, context, taskId);
        const change: Row = { action: "update", itemId: taskId, version: num(item.version) };
        if (input.title && input.title !== item.title) { fields.push({ label: "Title", before: str(item.title), after: String(input.title) }); change.title = input.title; }
        if (input.due) { const dueDate = dayArg(input.due, context.timeZone, "due"); if (dueDate !== item.dueDate) { fields.push({ label: "Due", before: str(item.dueDate), after: dueDate }); change.dueDate = dueDate; } }
        if (input.assigneeId) { const assigneeId = uuidArg(input.assigneeId, "assigneeId"); if (assigneeId !== item.assigneeId) { fields.push({ label: "Assignee", before: str(item.assigneeName) ?? "Unassigned", after: await memberName(services, context, assigneeId) }); change.assigneeId = assigneeId; } }
        if (input.priority && input.priority !== item.priority) { fields.push({ label: "Priority", before: str(item.priority), after: String(input.priority) }); change.priority = input.priority; }
        if (input.status && input.status !== item.status) { fields.push({ label: "Status", before: str(item.status), after: String(input.status) }); change.status = input.status; }
        if (!fields.length) throw new ToolInputError("Nothing would change");
        return {
          summary: `Update ${label}`,
          target: { ...ref("work_item", taskId, label, { projectId }), version: num(item.version) },
          preview: { kind: "fields", fields },
          command: { projectId, work: change },
        } satisfies Proposal;
      }
      const task = await services.activities.get(context.actor, context.workspaceId, taskId) as unknown as Row;
      const label = clip(task.title, 80) ?? "Task";
      if (task.status !== "pending") throw new ToolInputError(`"${label}" is ${String(task.status)}; only pending tasks change`);
      if (input.status && input.status !== "done") throw new ToolInputError("A sales task is either pending or done");
      const change: Row = { version: num(task.version) };
      if (input.title && input.title !== task.title) { fields.push({ label: "Title", before: str(task.title), after: String(input.title) }); change.title = input.title; }
      if (input.due) {
        const dueAt = zonedArg(String(input.due).length === 10 ? `${String(input.due)}T09:00` : input.due, context.timeZone, "due");
        fields.push({ label: "Due", before: task.dueAt ? zonedWallTime(new Date(String(task.dueAt)), context.timeZone) : null, after: zonedWallTime(new Date(dueAt), context.timeZone) });
        change.dueAt = dueAt;
      }
      if (input.assigneeId) {
        const ownerId = uuidArg(input.assigneeId, "assigneeId");
        crmToolHelpers.assertMayAssign(context, ownerId);
        fields.push({ label: "Owner", before: str(task.ownerName), after: await memberName(services, context, ownerId) });
        change.ownerMembershipId = ownerId;
      }
      if (input.priority && input.priority !== task.priority) { fields.push({ label: "Priority", before: str(task.priority), after: String(input.priority) }); change.priority = input.priority; }
      const complete = input.status === "done";
      if (complete && fields.length) throw new ToolInputError("Mark it done on its own, or change its details: not both at once");
      if (complete) fields.push({ label: "Status", before: "Pending", after: "Done" });
      if (!fields.length) throw new ToolInputError("Nothing would change");
      return {
        summary: complete ? `Mark "${label}" done` : `Update "${label}"`,
        target: { type: "crm_task", id: taskId, label, href: null, version: num(task.version) },
        preview: { kind: "fields", fields },
        command: complete ? { activityId: taskId, complete: { version: num(task.version) } } : { activityId: taskId, update: change },
      } satisfies Proposal;
    },
    async execute(context, proposal) {
      if (proposal.command.work) {
        const projectId = String(proposal.command.projectId);
        const work = proposal.command.work as Row;
        await services.work.command(context.actor, context.workspaceId, projectId, work);
        return { result: { workItemId: work.itemId }, record: ref("work_item", String(work.itemId), "Task", { projectId }) };
      }
      const activityId = String(proposal.command.activityId);
      if (proposal.command.complete) await services.activities.complete(context.actor, context.workspaceId, activityId, await commandInput(CompleteActivityDto, proposal.command.complete as Row));
      else {
        const update = proposal.command.update as Row;
        if (update.ownerMembershipId) crmToolHelpers.assertMayAssign(context, String(update.ownerMembershipId));
        await services.activities.update(context.actor, context.workspaceId, activityId, await commandInput(UpdateActivityDto, update));
      }
      return { result: { activityId }, record: null };
    },
  };

  const addComment: AiTool = {
    name: "add_comment",
    description: "Prepare a comment for the team on a project task (work_item) or on a quotation (id caseId/quoteId). The person sees the exact text before it is posted.",
    kind: "write",
    confirmation: "confirm",
    calls: "ProjectWorkService.command comment or QuotationCollabService.comment (both idempotent by id)",
    permissions: [],
    anyPermissions: ["projects.view", "projects.manage", "pre_projects.view"],
    parameters: {
      type: "object",
      properties: {
        recordType: { type: "string", enum: ["work_item", "quotation"] },
        recordId: { type: "string", maxLength: 120 },
        text: { type: "string", maxLength: 4000 },
      },
      required: ["recordType", "recordId", "text"],
    },
    async propose(context, input) {
      const text = String(input.text);
      if (input.recordType === "work_item") {
        const itemId = uuidArg(input.recordId, "recordId");
        const { projectId, label } = await workItem(services, context, itemId);
        return {
          summary: `Comment on ${label}`,
          target: { ...ref("work_item", itemId, label, { projectId }), version: null },
          preview: { kind: "text", text, fields: [{ label: "On", after: label }] },
          command: { projectId, work: { action: "comment", itemId, id: randomUUID(), body: text } },
        } satisfies Proposal;
      }
      const [caseId, quoteId] = String(input.recordId).split("/");
      uuidArg(caseId, "recordId (caseId)");
      if (!quoteId) throw new ToolInputError("A quotation id is caseId/quoteId");
      const quote = await services.access.withPermission(context.actor, context.workspaceId, "pre_projects.view", async (client) => (await client.query<{ number: number; reference: string | null; title: string }>(
        `SELECT quote.number, opportunity.reference, quote.title FROM commercial_quotes quote
           JOIN pre_project_cases case_record ON case_record.workspace_id = quote.workspace_id AND case_record.id = quote.case_id
           JOIN crm_opportunities opportunity ON opportunity.workspace_id = case_record.workspace_id AND opportunity.id = case_record.opportunity_id
          WHERE quote.workspace_id = $1 AND quote.case_id = $2 AND quote.id = $3`, [context.workspaceId, caseId, quoteId])).rows[0]);
      if (!quote) throw new NotFoundException("Quotation not found");
      const label = `${quote.reference ?? quote.title} R${quote.number}`;
      return {
        summary: `Comment on ${label}`,
        target: { ...ref("quotation", `${caseId}/${quoteId}`, label, { caseId }), version: null },
        preview: { kind: "text", text, fields: [{ label: "On", after: label }] },
        command: { caseId, quoteId, comment: { id: randomUUID(), body: text, anchorKind: "total" } },
      } satisfies Proposal;
    },
    async execute(context, proposal) {
      if (proposal.command.work) {
        const projectId = String(proposal.command.projectId);
        const work = proposal.command.work as Row;
        await services.work.command(context.actor, context.workspaceId, projectId, work);
        return { result: { commentId: work.id }, record: ref("work_item", String(work.itemId), "Task", { projectId }) };
      }
      const { caseId, quoteId, comment } = proposal.command as { caseId: string; quoteId: string; comment: Row };
      await services.quoteComments.comment(context.actor, context.workspaceId, caseId, quoteId, comment);
      return { result: { commentId: comment.id }, record: ref("quotation", `${caseId}/${quoteId}`, "Quote", { caseId }) };
    },
  };

  const draftMessage: AiTool = {
    name: "draft_message",
    description: "Put a reply you wrote into the chat's composer for the person to edit and send themselves. It never sends. Read the chat (and the quote, when the reply is about one) first.",
    kind: "draft",
    confirmation: "composer",
    calls: "none: the text goes to the inbox composer",
    permissions: ["crm.communications.send"],
    parameters: {
      type: "object",
      properties: {
        conversationId: { type: "string", description: "Left out: the chat open", maxLength: 40 },
        text: { type: "string", description: "The reply, in the client's language, ready to send", maxLength: 4000 },
      },
      required: ["text"],
    },
    async draft(context, input) {
      const conversationId = input.conversationId ? uuidArg(input.conversationId, "conversationId") : context.record?.type === "conversation" ? context.record.id : null;
      // The chat must be one the person can read; the text is theirs to change and send.
      if (conversationId) await services.conversations.get(context.actor, context.workspaceId, conversationId);
      return { text: String(input.text), conversationId };
    },
  };

  return [createTask, updateTask, addComment, draftMessage];
}
