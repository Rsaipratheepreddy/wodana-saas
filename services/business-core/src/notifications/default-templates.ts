import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

export type DefaultTemplate = {
  code: string;
  channel: "in_app" | "email" | "whatsapp" | "push";
  subject: string | null;
  body: string;
  variables: string[];
};

/**
 * System default notification templates, seeded into every workspace as approved version 1.
 * Tenants edit their own copies (a newer version wins). Each module adds its events here when it
 * is built; variables use {{name}} and are declared so sends fail loudly when one is missing.
 */
export const DEFAULT_NOTIFICATION_TEMPLATES: DefaultTemplate[] = [
  {
    code: "workspace.member_joined",
    channel: "in_app",
    subject: "{{memberName}} joined {{workspaceName}}",
    body: "{{memberName}} accepted your invitation.",
    variables: ["memberName", "workspaceName"],
  },
  {
    code: "crm.enquiry_duplicate",
    channel: "in_app",
    subject: "{{clientName}} enquired again",
    body: "{{reference}} came in through {{channel}} and is linked to {{originalReference}}, which you own.",
    variables: ["clientName", "reference", "channel", "originalReference"],
  },
  {
    code: "crm.returning_customer",
    channel: "in_app",
    subject: "{{clientName}} is back",
    body: "{{reference}} is from a returning customer you worked with before.",
    variables: ["clientName", "reference"],
  },
  {
    code: "crm.lead_taken_over_from",
    channel: "in_app",
    subject: "{{reference}} moved to {{newOwner}}",
    body: "No call or note was logged within the response time, so {{reference}} was reassigned.",
    variables: ["reference", "newOwner"],
  },
  {
    code: "crm.conversation_assigned",
    channel: "in_app",
    subject: "Conversation with {{client}} is yours",
    body: "{{assignedBy}} assigned it to you. Reply from the inbox.",
    variables: ["client", "assignedBy"],
  },
  {
    code: "crm.lead_taken_over_to",
    channel: "in_app",
    subject: "{{reference}} is now yours",
    body: "{{previousOwner}} did not log contact within the response time. Contact the client now.",
    variables: ["reference", "previousOwner"],
  },
  {
    code: "crm.lead_assigned",
    channel: "in_app",
    subject: "{{reference}} · {{clientName}} is yours",
    body: "New enquiry from {{source}}. Respond by {{deadline}}.",
    variables: ["reference", "clientName", "source", "deadline"],
  },
  {
    code: "crm.lead_assigned",
    channel: "email",
    subject: "New enquiry {{reference}}: {{clientName}}",
    body: "You have a new enquiry.\n\nReference: {{reference}}\nClient: {{clientName}}\nSource: {{source}}\nRespond by: {{deadline}}\n\nOpen it and log your first contact.",
    variables: ["reference", "clientName", "source", "deadline"],
  },
  // Sales timers (S-1, S-2, S-3, S-7, S-26, S-27): who is told when an enquiry is at risk.
  { code: "crm.sla_warning", channel: "in_app", subject: "{{reference}} · respond by {{deadline}}", body: "{{minutes}} min left to contact {{clientName}}.", variables: ["reference", "clientName", "deadline", "minutes"] },
  { code: "crm.sla_warning", channel: "push", subject: "{{reference}} · respond by {{deadline}}", body: "{{minutes}} min left to contact {{clientName}}.", variables: ["reference", "clientName", "deadline", "minutes"] },
  { code: "crm.sla_breached", channel: "in_app", subject: "{{reference}} missed its response time", body: "{{clientName}} was due a first contact by {{deadline}}. Owner: {{ownerName}}.", variables: ["reference", "clientName", "deadline", "ownerName"] },
  { code: "crm.sla_breached", channel: "push", subject: "{{reference}} missed its response time", body: "{{clientName}} was due a first contact by {{deadline}}. Owner: {{ownerName}}.", variables: ["reference", "clientName", "deadline", "ownerName"] },
  { code: "crm.lead_kept", channel: "in_app", subject: "{{reference}} is still yours", body: "No one else is available, so {{clientName}} stays with you. Contact the client now.", variables: ["reference", "clientName"] },
  { code: "crm.lead_kept", channel: "push", subject: "{{reference}} is still yours", body: "No one else is available, so {{clientName}} stays with you. Contact the client now.", variables: ["reference", "clientName"] },
  { code: "crm.lead_kept_admin", channel: "in_app", subject: "{{reference}} has no one to take over", body: "{{ownerName}} has not contacted {{clientName}} and no one else is available. It stays with {{ownerName}}.", variables: ["reference", "clientName", "ownerName"] },
  { code: "crm.lead_escalated", channel: "in_app", subject: "{{reference}} needs a manager", body: "{{clientName}} went {{attempts}} response windows without a first contact. Owner now: {{ownerName}}.", variables: ["reference", "clientName", "attempts", "ownerName"] },
  { code: "crm.lead_escalated", channel: "email", subject: "{{reference}} needs a manager", body: "{{clientName}} went {{attempts}} response windows without a first contact.\n\nOwner now: {{ownerName}}\n\nOpen the enquiry to assign it or call the client.", variables: ["reference", "clientName", "attempts", "ownerName"] },
  { code: "crm.lead_unowned", channel: "in_app", subject: "{{reference}} has no owner", body: "{{clientName}} has waited {{minutes}} min without an owner. Assign it now.", variables: ["reference", "clientName", "minutes"] },
  { code: "crm.lead_unowned", channel: "push", subject: "{{reference}} has no owner", body: "{{clientName}} has waited {{minutes}} min without an owner. Assign it now.", variables: ["reference", "clientName", "minutes"] },
  { code: "crm.lead_unowned", channel: "email", subject: "{{reference}} has no owner", body: "{{clientName}} has waited {{minutes}} min without an owner.\n\nOpen the enquiry and assign it now.", variables: ["reference", "clientName", "minutes"] },
  { code: "crm.client_review_waiting", channel: "in_app", subject: "Confirm the client for {{reference}}", body: "{{clientName}} may be an existing client. Confirm or keep them as new.", variables: ["reference", "clientName"] },
  { code: "crm.sales_digest", channel: "in_app", subject: "Sales today: {{breached}} overdue, {{unowned}} without an owner", body: "{{waiting}} enquiries are waiting for a first contact.", variables: ["breached", "unowned", "waiting"] },
  { code: "crm.sales_digest", channel: "email", subject: "Sales today: {{breached}} overdue, {{unowned}} without an owner", body: "Overdue first contact: {{breached}}\nWithout an owner: {{unowned}}\nWaiting for a first contact: {{waiting}}\n\nOpen Enquiries to act on them.", variables: ["breached", "unowned", "waiting"] },
  { code: "crm.enquiries_waiting", channel: "in_app", subject: "{{count}} enquiries waiting for you", body: "The first is due {{deadline}}.", variables: ["count", "deadline"] },
  { code: "crm.enquiries_waiting", channel: "push", subject: "{{count}} enquiries waiting for you", body: "The first is due {{deadline}}.", variables: ["count", "deadline"] },
  { code: "crm.lead_woken", channel: "in_app", subject: "Come back to {{clientName}} today", body: "{{reference}} was paused until {{deadline}}. It is back in your list.", variables: ["reference", "clientName", "deadline"] },
  { code: "crm.lead_woken", channel: "push", subject: "Come back to {{clientName}} today", body: "{{reference}} was paused until {{deadline}}. It is back in your list.", variables: ["reference", "clientName", "deadline"] },
  { code: "crm.lead_reassigned_from", channel: "in_app", subject: "{{reference}} moved to {{newOwner}}", body: "{{clientName}} is now with {{newOwner}}.", variables: ["reference", "clientName", "newOwner"] },
  {
    code: "crm.intro_booked",
    channel: "in_app",
    subject: "{{meeting}} with {{clientName}}",
    body: "{{when}} · {{place}}. Booked by {{bookedBy}}.",
    variables: ["meeting", "clientName", "when", "place", "bookedBy"],
  },
  {
    code: "crm.intro_booked",
    channel: "email",
    subject: "Invitation: {{meeting}} with {{clientName}}",
    body: "{{meeting}} with {{clientName}}\n\nWhen: {{when}}\nWhere: {{place}}\nBooked by: {{bookedBy}}\n\nThe floor plan and the client's details are on the opportunity.",
    variables: ["meeting", "clientName", "when", "place", "bookedBy"],
  },
  {
    code: "crm.designer_assigned",
    channel: "in_app",
    subject: "You are the designer for {{clientName}}",
    body: "{{changedBy}} made you the dedicated designer. Reason: {{reason}}",
    variables: ["clientName", "changedBy", "reason"],
  },
  { code: "design.stage_started", channel: "in_app", subject: "{{stage}} · {{clientName}}", body: "{{stage}} has started. Due {{due}}.", variables: ["stage", "clientName", "due"] },
  { code: "design.stage_overdue", channel: "in_app", subject: "{{stage}} is overdue · {{clientName}}", body: "It was due {{due}}.", variables: ["stage", "clientName", "due"] },
  { code: "design.stage_overdue", channel: "email", subject: "{{stage}} is overdue: {{clientName}}", body: "{{stage}} for {{clientName}} was due {{due}}.\n\nOpen the project to catch up.", variables: ["stage", "clientName", "due"] },
  // Design review steps (pre-projects/design-notices.ts).
  { code: "design.review_requested", channel: "in_app", subject: "Review {{title}} · {{clientName}}", body: "{{actor}} sent it for your review.", variables: ["title", "clientName", "actor", "note"] },
  { code: "design.review_requested", channel: "email", subject: "Please review: {{title}} ({{clientName}})", body: "{{actor}} sent {{title}} for {{clientName}} for your review.\n\nOpen it to approve or send it back.", variables: ["title", "clientName", "actor", "note"] },
  { code: "design.review_approved", channel: "in_app", subject: "Approved: {{title}}", body: "{{actor}} approved it. It's ready to present to {{clientName}}.", variables: ["title", "clientName", "actor", "note"] },
  { code: "design.sent_back", channel: "in_app", subject: "Changes needed: {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "design.client_approved", channel: "in_app", subject: "{{clientName}} approved {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "design.client_approved", channel: "email", subject: "{{clientName}} approved {{title}}", body: "{{clientName}} approved {{title}}.\n\n{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "design.client_changes", channel: "in_app", subject: "{{clientName}} wants changes to {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "design.client_changes", channel: "email", subject: "{{clientName}} wants changes to {{title}}", body: "{{clientName}} asked for changes to {{title}}:\n\n{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "design.mentioned", channel: "in_app", subject: "{{actor}} mentioned you · {{title}}", body: "{{note}}", variables: ["title", "actor", "note"] },
  { code: "gallery.published", channel: "in_app", subject: "Your gallery is live", body: "{{actor}} published the company gallery.", variables: ["actor"] },
  { code: "quotation.mentioned", channel: "in_app", subject: "{{actor}} mentioned you · {{title}}", body: "{{note}}", variables: ["title", "actor", "note"] },
  { code: "quotation.review_requested", channel: "in_app", subject: "Review quote {{title}} · {{clientName}}", body: "{{actor}} sent it for review.", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.review_requested", channel: "email", subject: "Please review quote {{title}} ({{clientName}})", body: "{{actor}} sent quote {{title}} for {{clientName}} for your review.", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.returned", channel: "in_app", subject: "Changes needed: {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.client_accepted", channel: "in_app", subject: "{{clientName}} accepted {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.client_accepted", channel: "email", subject: "{{clientName}} accepted {{title}}", body: "{{clientName}} accepted {{title}}.\n\n{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.client_changes", channel: "in_app", subject: "{{clientName}} wants changes to {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.started", channel: "in_app", subject: "Project started · {{title}}", body: "{{actor}} started {{title}} for {{clientName}}.", variables: ["title", "clientName", "actor", "role"] },
  { code: "project.started", channel: "email", subject: "You're on the team for {{title}}", body: "{{actor}} started {{title}} for {{clientName}}. You're the {{role}}.", variables: ["title", "clientName", "actor", "role"] },
  { code: "project.team_added", channel: "in_app", subject: "You're the {{role}} on {{title}}", body: "{{actor}} added you to {{title}}.", variables: ["title", "clientName", "actor", "role"] },
  { code: "project.team_added", channel: "email", subject: "You're the {{role}} on {{title}}", body: "{{actor}} added you to {{title}} for {{clientName}} as the {{role}}.", variables: ["title", "clientName", "actor", "role"] },
  { code: "project.stage_done", channel: "in_app", subject: "{{title}} moved to {{stage}}", body: "{{actor}} finished {{previous}}.", variables: ["title", "clientName", "actor", "stage", "previous"] },
  { code: "project.on_hold", channel: "in_app", subject: "{{title}} is on hold", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.resumed", channel: "in_app", subject: "{{title}} is running again", body: "{{actor}} resumed the project.", variables: ["title", "clientName", "actor", "note"] },
  { code: "factory.released", channel: "in_app", subject: "{{order}} released: {{item}}", body: "{{actor}} released it for {{project}}.", variables: ["order", "item", "project", "actor", "note"] },
  { code: "factory.report_waiting", channel: "in_app", subject: "Approve output on {{order}}", body: "{{actor}}: {{note}}", variables: ["order", "item", "project", "actor", "note"] },
  { code: "factory.check_failed", channel: "in_app", subject: "{{order}} failed its check", body: "{{actor}}: {{note}}", variables: ["order", "item", "project", "actor", "note"] },
  { code: "factory.material_short", channel: "in_app", subject: "{{order}} is waiting for materials", body: "{{project}}: {{note}}", variables: ["order", "item", "project", "actor", "note"] },
  { code: "factory.substitution", channel: "in_app", subject: "A material swap on {{order}} needs your decision", body: "{{actor}}: {{note}}", variables: ["order", "item", "project", "actor", "note"] },
  { code: "factory.scope_changed", channel: "in_app", subject: "A variation changed {{item}}", body: "{{project}}: {{note}}", variables: ["order", "item", "project", "actor", "note"] },
  { code: "factory.drawing_revised", channel: "in_app", subject: "{{order}} is on hold: the drawing changed", body: "{{actor}}: {{note}}", variables: ["order", "item", "project", "actor", "note"] },
  { code: "factory.ready", channel: "in_app", subject: "{{item}} is ready", body: "{{order}} for {{project}} is made and checked.", variables: ["order", "item", "project", "actor", "note"] },
  { code: "site.report_waiting", channel: "in_app", subject: "Site report to approve · {{title}}", body: "{{actor}} reported {{note}}.", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.report_returned", channel: "in_app", subject: "Your site report came back · {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.incident", channel: "in_app", subject: "Incident on site · {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.incident", channel: "email", subject: "Incident on site · {{title}}", body: "{{actor}} reported an incident on {{title}}:\n\n{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.blocked", channel: "in_app", subject: "The site is blocked · {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.report_missing", channel: "in_app", subject: "No site report today · {{title}}", body: "Add today's report before the end of the day.", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.report_overdue", channel: "in_app", subject: "No site report yesterday · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "handover.accepted", channel: "in_app", subject: "{{title}}: handover accepted", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "handover.refused", channel: "in_app", subject: "{{title}}: handover refused", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "warranty.claim", channel: "in_app", subject: "Warranty claim on {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "warranty.claim", channel: "email", subject: "Warranty claim on {{title}}", body: "{{actor}} recorded a warranty claim for {{clientName}}:\n\n{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "request.client_raised", channel: "in_app", subject: "{{actor}} sent a request on {{title}}", body: "{{request}}: {{note}}", variables: ["title", "clientName", "actor", "request", "note"] },
  { code: "request.client_replied", channel: "in_app", subject: "{{actor}} replied on {{title}}", body: "{{request}}: {{note}}", variables: ["title", "clientName", "actor", "request", "note"] },
  // What the client does in the portal (client-portal/portal-*.ts): the people working the case hear it.
  { code: "request.client_raised", channel: "email", subject: "{{actor}} sent a message on {{title}}", body: "{{actor}} wrote in the client portal: {{request}}\n\n{{note}}", variables: ["title", "clientName", "actor", "request", "note"] },
  { code: "request.client_replied", channel: "email", subject: "{{actor}} replied on {{title}}", body: "{{actor}} replied in the client portal on {{request}}:\n\n{{note}}", variables: ["title", "clientName", "actor", "request", "note"] },
  { code: "moodboard.client_reacted", channel: "in_app", subject: "{{actor}} {{reaction}} {{item}}", body: "{{title}}", variables: ["title", "clientName", "actor", "item", "reaction", "note"] },
  { code: "moodboard.client_commented", channel: "in_app", subject: "{{actor}} commented on {{item}}", body: "{{note}}", variables: ["title", "clientName", "actor", "item", "reaction", "note"] },
  { code: "moodboard.client_commented", channel: "email", subject: "{{actor}} commented on {{item}}", body: "{{actor}} commented on {{item}} ({{title}}):\n\n{{note}}", variables: ["title", "clientName", "actor", "item", "reaction", "note"] },
  { code: "moodboard.client_added", channel: "in_app", subject: "{{actor}} added an inspiration", body: "{{item}} on {{title}}. {{note}}", variables: ["title", "clientName", "actor", "item", "reaction", "note"] },
  { code: "payment.client_reported", channel: "in_app", subject: "{{actor}} says they paid {{milestone}}", body: "{{title}}: {{amount}} on {{paidOn}}. Reference {{reference}}.", variables: ["title", "clientName", "actor", "milestone", "amount", "paidOn", "reference", "note"] },
  { code: "payment.client_reported", channel: "email", subject: "{{actor}} says they paid {{milestone}}", body: "{{actor}} reported a payment on {{title}} in the client portal.\n\nMilestone: {{milestone}}\nAmount: {{amount}}\nPaid on: {{paidOn}}\nReference: {{reference}}\n{{note}}\n\nCheck it against the bank, then record the receipt or say it wasn't received.", variables: ["title", "clientName", "actor", "milestone", "amount", "paidOn", "reference", "note"] },
  { code: "project.client_issue", channel: "in_app", subject: "{{actor}} reported an issue on {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.client_issue", channel: "email", subject: "{{actor}} reported an issue on {{title}}", body: "{{actor}} reported an issue in the client portal:\n\n{{note}}\n\nTriage it: accept it as a snag with a severity, or decline it with a reason the client reads.", variables: ["title", "clientName", "actor", "note"] },
  { code: "warranty.expiring", channel: "in_app", subject: "Warranty ending soon · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.over_budget", channel: "in_app", subject: "Over budget · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.cancelled", channel: "in_app", subject: "{{title}} is cancelled", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.cancelled", channel: "email", subject: "{{title}} is cancelled", body: "{{actor}} cancelled {{title}} for {{clientName}}.\n\n{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.completed", channel: "in_app", subject: "{{title}} is complete", body: "{{actor}} finished the last stage.", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.reopened", channel: "in_app", subject: "{{title}} is open again", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.materials_signed_off", channel: "in_app", subject: "{{title}}: material list signed off", body: "{{clientName}} signed off {{revision}}.", variables: ["title", "clientName", "actor", "revision"] },
  { code: "project.materials_changes", channel: "in_app", subject: "{{title}}: changes to the material list", body: "{{clientName}} asked for changes to {{revision}}: {{note}}", variables: ["title", "clientName", "actor", "revision", "note"] },
  { code: "project.variation_applied", channel: "in_app", subject: "{{title}}: {{variation}} applied", body: "{{actor}} applied {{variation}} ({{amount}}).", variables: ["title", "clientName", "actor", "variation", "amount"] },
  { code: "work.assigned", channel: "in_app", subject: "{{task}} is yours", body: "{{actor}} gave you {{task}} on {{title}}.", variables: ["title", "clientName", "actor", "task", "due"] },
  { code: "work.assigned", channel: "email", subject: "{{task}} is yours · {{title}}", body: "{{actor}} gave you {{task}} on {{title}} for {{clientName}}. {{due}}", variables: ["title", "clientName", "actor", "task", "due"] },
  { code: "work.commented", channel: "in_app", subject: "{{actor}} on {{task}}", body: "{{note}}", variables: ["title", "clientName", "actor", "task", "note"] },
  { code: "work.blocked", channel: "in_app", subject: "{{task}} is blocked", body: "{{actor}} reported a blocker on {{title}}: {{note}}", variables: ["title", "clientName", "actor", "task", "note"] },
  { code: "work.snag_ready", channel: "in_app", subject: "{{task}} is fixed: check it", body: "{{actor}} marked it ready on {{title}}.", variables: ["title", "clientName", "actor", "task", "note"] },
  { code: "work.snag_reopened", channel: "in_app", subject: "{{task}} is open again", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "task", "note"] },
  { code: "work.moved", channel: "in_app", subject: "{{task}} moved to {{due}}", body: "{{actor}} pushed it later because {{note}} moved.", variables: ["title", "clientName", "actor", "task", "due", "note"] },
  { code: "work.planned", channel: "in_app", subject: "{{task}} is planned", body: "{{actor}} gave you {{note}} on {{title}}. {{due}}", variables: ["title", "clientName", "actor", "task", "note", "due"] },
  { code: "work.sprint_started", channel: "in_app", subject: "{{task}} started on {{title}}", body: "{{actor}} started it: {{note}}", variables: ["title", "clientName", "actor", "task", "note"] },
  { code: "work.sprint_closed", channel: "in_app", subject: "{{task}} closed on {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "task", "note"] },
  { code: "work.due_soon", channel: "in_app", subject: "{{task}} is due tomorrow", body: "{{title}}", variables: ["title", "task", "due"] },
  { code: "work.overdue", channel: "in_app", subject: "{{task}} is late", body: "It was due {{due}} on {{title}}.", variables: ["title", "task", "due"] },
  { code: "work.overdue", channel: "email", subject: "{{task}} is late · {{title}}", body: "{{task}} on {{title}} was due {{due}}.\n\nOpen it to update its status or dates.", variables: ["title", "task", "due"] },
  { code: "work.done", channel: "in_app", subject: "{{task}} is done", body: "{{actor}} finished {{task}} on {{title}}.", variables: ["title", "clientName", "actor", "task"] },
  { code: "purchasing.approval_needed", channel: "in_app", subject: "{{order}} needs your approval", body: "{{actor}} raised {{order}} to {{supplier}} for {{amount}}.", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.approval_needed", channel: "email", subject: "{{order}} needs your approval · {{amount}}", body: "{{actor}} raised {{order}} to {{supplier}} for {{amount}}.\n\nOpen it to approve or send it back.", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.approved", channel: "in_app", subject: "{{order}} is approved", body: "{{actor}} approved {{order}} to {{supplier}}. Send it to the supplier.", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.returned", channel: "in_app", subject: "{{order}} was sent back", body: "{{actor}}: {{note}}", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.received", channel: "in_app", subject: "{{order}} arrived", body: "{{actor}} received it at {{note}}.", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.rejected", channel: "in_app", subject: "Goods rejected on {{order}}", body: "{{actor}}: {{note}}", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.inspection_needed", channel: "in_app", subject: "{{order}} is waiting for inspection", body: "{{actor}} received it; someone else checks it.", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.missing", channel: "in_app", subject: "Goods missing on {{order}}", body: "{{actor}}: {{note}}", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.supplier_return", channel: "in_app", subject: "Goods going back to {{supplier}}", body: "{{actor}} raised a return on {{order}}: {{note}}", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.receipt_reversed", channel: "in_app", subject: "A delivery on {{order}} was reversed", body: "{{actor}}: {{note}}", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.late", channel: "in_app", subject: "{{order}} is late", body: "{{supplier}}: {{note}}", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.late", channel: "email", subject: "{{order}} from {{supplier}} is late", body: "{{note}}\n\nChase the supplier and record their new date on the order.", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.order_late", channel: "in_app", subject: "Order now for {{project}}", body: "{{note}}", variables: ["project", "note"] },
  { code: "purchasing.order_late", channel: "email", subject: "Order now for {{project}}", body: "These should have been ordered by now to arrive when they're needed:\n\n{{note}}", variables: ["project", "note"] },
  { code: "purchasing.over_funds", channel: "in_app", subject: "Ordered beyond the money in hand: {{order}}", body: "{{note}}", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.funds_blocked", channel: "in_app", subject: "Order waiting for money: {{order}}", body: "{{note}}", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "accounting.attention", channel: "in_app", subject: "Accounting needs attention · {{company}}", body: "{{note}}", variables: ["company", "note"] },
  { code: "receivables.overdue", channel: "in_app", subject: "Client invoice overdue: {{invoice}}", body: "{{note}}", variables: ["invoice", "client", "amount", "actor", "note"] },
  { code: "receivables.credited", channel: "in_app", subject: "Invoice credited: {{invoice}}", body: "{{note}}", variables: ["invoice", "client", "amount", "actor", "note"] },
  { code: "payables.held", channel: "in_app", subject: "Supplier invoice held: {{supplier}} {{invoice}}", body: "{{note}}", variables: ["supplier", "invoice", "amount", "actor", "note"] },
  { code: "payables.due", channel: "in_app", subject: "Supplier invoices due · {{supplier}}", body: "{{note}}", variables: ["supplier", "invoice", "amount", "actor", "note"] },
  { code: "payables.retention_released", channel: "in_app", subject: "Retention to pay · {{supplier}}", body: "{{note}}", variables: ["supplier", "invoice", "amount", "actor", "note"] },
  { code: "payables.run_submitted", channel: "in_app", subject: "Payment run {{run}} needs your approval", body: "{{actor}} prepared {{amount}}.", variables: ["run", "amount", "actor", "note"] },
  { code: "payables.run_approved", channel: "in_app", subject: "Payment run {{run}} is approved", body: "{{actor}} approved {{amount}}. Pay it, then mark it paid.", variables: ["run", "amount", "actor", "note"] },
  { code: "payables.run_returned", channel: "in_app", subject: "Payment run {{run}} was sent back", body: "{{actor}}: {{note}}", variables: ["run", "amount", "actor", "note"] },
  { code: "payables.run_paid", channel: "in_app", subject: "Payment run {{run}} is paid", body: "{{actor}} recorded {{amount}} paid on {{note}}.", variables: ["run", "amount", "actor", "note"] },
  { code: "hrms.leave_requested", channel: "in_app", subject: "Leave to approve: {{person}}", body: "{{leaveType}} · {{dates}} ({{days}}): {{note}}", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.leave_requested", channel: "email", subject: "Leave to approve: {{person}}", body: "{{person}} asked for {{leaveType}}: {{dates}} ({{days}}).\n\n{{note}}", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.leave_cancellation_requested", channel: "in_app", subject: "Leave cancellation to approve: {{person}}", body: "{{leaveType}} · {{dates}}: {{note}}", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.leave_approved", channel: "in_app", subject: "Leave approved: {{dates}}", body: "{{actor}} approved your {{leaveType}}.", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.leave_approved", channel: "email", subject: "Leave approved: {{dates}}", body: "{{actor}} approved your {{leaveType}}: {{dates}} ({{days}}).\n\n{{note}}", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.leave_rejected", channel: "in_app", subject: "Leave not approved: {{dates}}", body: "{{actor}}: {{note}}", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.leave_rejected", channel: "email", subject: "Leave not approved: {{dates}}", body: "{{actor}} didn't approve your {{leaveType}}: {{dates}}.\n\n{{note}}", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.leave_cancelled", channel: "in_app", subject: "Leave cancelled: {{dates}}", body: "{{actor}} agreed to cancel your {{leaveType}}.", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.leave_cancellation_refused", channel: "in_app", subject: "Leave stays booked: {{dates}}", body: "{{actor}}: {{note}}", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.leave_holiday", channel: "in_app", subject: "Leave changed: {{dates}}", body: "{{note}} is now a holiday and no longer counts as leave. This request now counts {{days}}.", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.attendance_to_review", channel: "in_app", subject: "Attendance to review: {{person}}", body: "{{when}}: {{note}}", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.attendance_approved", channel: "in_app", subject: "Attendance approved: {{when}}", body: "{{actor}}: {{note}}", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.attendance_rejected", channel: "in_app", subject: "Attendance not approved: {{when}}", body: "{{actor}}: {{note}}", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.checkout_missing", channel: "in_app", subject: "You're still checked in", body: "Checked in at {{place}} since {{when}}. Check out, or ask for a correction.", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.checkout_missing", channel: "email", subject: "You're still checked in", body: "You checked in at {{place}} at {{when}} and haven't checked out.\n\nCheck out now, or ask for a correction with the time you left.", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.crew_day_submitted", channel: "in_app", subject: "Crew day to approve: {{person}}", body: "{{actor}} marked {{days}} at {{place}} on {{dates}}. {{note}}", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.crew_day_approved", channel: "in_app", subject: "Crew day approved: {{person}}", body: "{{actor}} approved {{dates}} at {{place}}.", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.crew_day_returned", channel: "in_app", subject: "Crew day sent back: {{person}}", body: "{{actor}}: {{note}}", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.document_expiring", channel: "in_app", subject: "Expires soon: {{person}}'s {{note}}", body: "Expires on {{dates}}. Ask for the new one.", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.document_expiring", channel: "email", subject: "Expires soon: {{person}}'s {{note}}", body: "{{person}}'s {{note}} expires on {{dates}}.\n\nAsk for the new one and add it to their documents.", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.document_expired", channel: "in_app", subject: "Expired: {{person}}'s {{note}}", body: "It expired on {{dates}}. They can't be cleared for site until it's renewed.", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.timesheet_submitted", channel: "in_app", subject: "Timesheet to approve: {{person}}", body: "{{dates}}: {{days}} logged.", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.timesheet_approved", channel: "in_app", subject: "Timesheet approved: {{dates}}", body: "{{actor}} approved your week.", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "hrms.timesheet_returned", channel: "in_app", subject: "Timesheet sent back: {{dates}}", body: "{{actor}}: {{note}}", variables: ["person", "leaveType", "dates", "days", "note", "actor", "when", "place"] },
  { code: "petty_cash.submitted", channel: "in_app", subject: "Petty cash to approve: {{claim}}", body: "{{actor}} claimed {{amount}} on {{project}}: {{note}}", variables: ["claim", "project", "amount", "actor", "note"] },
  { code: "petty_cash.approved", channel: "in_app", subject: "Petty cash {{claim}} approved", body: "{{actor}} approved {{amount}} on {{project}}.", variables: ["claim", "project", "amount", "actor", "note"] },
  { code: "petty_cash.rejected", channel: "in_app", subject: "Petty cash {{claim}} rejected", body: "{{actor}}: {{note}}", variables: ["claim", "project", "amount", "actor", "note"] },
  { code: "petty_cash.to_reimburse", channel: "in_app", subject: "Petty cash to reimburse: {{claim}}", body: "{{actor}} approved {{amount}} for {{note}} on {{project}}.", variables: ["claim", "project", "amount", "actor", "note"] },
  { code: "petty_cash.reimbursed", channel: "in_app", subject: "Petty cash {{claim}} reimbursed", body: "{{actor}} reimbursed {{amount}} on {{project}}.", variables: ["claim", "project", "amount", "actor", "note"] },
  { code: "purchasing.unmatched", channel: "in_app", subject: "Goods arrived without an order", body: "{{actor}} received goods from {{supplier}} at {{note}}. Match them to an order or send them back.", variables: ["supplier", "actor", "note"] },
  { code: "purchasing.alternate_offered", channel: "in_app", subject: "{{supplier}} offers an alternative on {{order}}", body: "{{actor}}: {{note}}", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.alternate_decided", channel: "in_app", subject: "Alternative on {{order}}: {{note}}", body: "{{actor}} decided on {{supplier}}'s alternative.", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "supplier.on_hold", channel: "in_app", subject: "{{supplier}} is on hold", body: "{{note}}", variables: ["supplier", "actor", "note"] },
  { code: "supplier.document_expiring", channel: "in_app", subject: "{{supplier}}: {{note}}", body: "Ask the supplier for the new one.", variables: ["supplier", "actor", "note"] },
  { code: "supplier.bank_change", channel: "in_app", subject: "New bank details for {{supplier}}", body: "{{actor}} recorded them ({{note}}). Call the supplier on a number you already have before approving.", variables: ["supplier", "actor", "note"] },
  { code: "stock.transfer_sent", channel: "in_app", subject: "Stock on its way to {{to}}", body: "{{actor}} sent move {{transfer}} from {{from}}.", variables: ["transfer", "from", "to", "actor", "note"] },
  { code: "stock.transfer_short", channel: "in_app", subject: "Move {{transfer}} arrived short", body: "{{actor}}: {{note}}", variables: ["transfer", "from", "to", "actor", "note"] },
  { code: "stock.adjustment_needs_approval", channel: "in_app", subject: "A stock correction needs your approval", body: "{{actor}} counted {{note}} at {{to}}.", variables: ["transfer", "from", "to", "actor", "note"] },
  { code: "stock.adjusted", channel: "in_app", subject: "Stock corrected at {{to}}", body: "{{actor}}: {{note}}", variables: ["transfer", "from", "to", "actor", "note"] },
  { code: "project.off_track", channel: "in_app", subject: "{{title}} is off track", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "design.signed_off", channel: "in_app", subject: "Design signed off · {{clientName}}", body: "The design is approved. It's ready to quote.", variables: ["clientName"] },
  { code: "design.signed_off", channel: "email", subject: "Design signed off: {{clientName}}", body: "The design for {{clientName}} is signed off and ready to quote.\n\nOpen the case to start the quotation.", variables: ["clientName"] },
  // Team inbox (crm/conversations/inbox/inbox-notices.ts): one notice per chat until it is read.
  { code: "crm.inbox_message", channel: "in_app", subject: "{{clientName}} wrote", body: "{{summary}}", variables: ["clientName", "summary"] },
  { code: "crm.inbox_woke", channel: "in_app", subject: "Chat with {{clientName}} is back", body: "You snoozed it until now.", variables: ["clientName"] },
  { code: "crm.number_health", channel: "in_app", subject: "Your WhatsApp number is {{status}}", body: "{{reason}}", variables: ["status", "reason"] },
  { code: "crm.template_status", channel: "in_app", subject: "Template {{name}} is {{status}}", body: "{{reason}}", variables: ["name", "status", "reason"] },
  { code: "crm.inbox_mention", channel: "in_app", subject: "{{actor}} mentioned you", body: "{{clientName}}: {{summary}}", variables: ["actor", "clientName", "summary"] },
  { code: "crm.inbox_unassigned", channel: "in_app", subject: "{{clientName}} is waiting", body: "Nobody could take this new chat. Assign it.", variables: ["clientName"] },
  // Client portal notices (client-portal/portal-notices.ts): to client contacts, by email.
  { code: "portal.quote_issued", channel: "email", subject: "{{title}} is ready for you", body: "{{company}} sent you {{title}} for {{project}}.\n\nOpen your project page to read it and give your decision.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.payment_due", channel: "email", subject: "Payment reminder · {{title}}", body: "A reminder from {{company}}: {{title}} for {{project}} is due. {{due}}\n\nOpen your project page to see it and pay.", variables: ["company", "project", "title", "due", "note"] },
  { code: "receivables.payment_overdue", channel: "in_app", subject: "{{client}} hasn't paid {{title}}", body: "A week past due. Reminders sent: {{count}}.", variables: ["client", "title", "count"] },
  { code: "portal.invoice_issued", channel: "email", subject: "Invoice {{title}} from {{company}}", body: "{{company}} issued invoice {{title}} for {{project}}. {{due}}\n\nOpen your project page to see it and what's left to pay.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.decision_waiting", channel: "email", subject: "{{title}} is waiting for your decision", body: "{{company}} needs your decision on {{title}} for {{project}}. {{due}}\n\nOpen your project page to review it.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.update_published", channel: "email", subject: "New update on {{project}}", body: "{{note}}\n\nOpen your project page to see the progress.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.team_replied", channel: "email", subject: "{{company}} replied on {{project}}", body: "{{note}}\n\nOpen your project page to read it and reply.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.payment_checked", channel: "email", subject: "Your payment on {{project}}", body: "{{note}}\n\nOpen your project page to see your payments.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.issue_triaged", channel: "email", subject: "The issue you reported on {{project}}", body: "{{note}}\n\nOpen your project page to follow it.", variables: ["company", "project", "title", "due", "note"] },
  // Client portal access (client-portal/portal-invitations.ts): the project's manager hears the client's first sign-in.
  { code: "client_portal.client_signed_in", channel: "in_app", subject: "{{client}} opened the client portal", body: "{{client}} signed in to the portal for {{title}} for the first time.", variables: ["client", "title"] },
  { code: "design.site_visit_booked", channel: "in_app", subject: "Site visit with {{clientName}}", body: "{{when}} · {{place}}. Booked by {{bookedBy}}.", variables: ["clientName", "when", "place", "bookedBy"] },
  { code: "design.site_visit_booked", channel: "email", subject: "Invitation: site visit with {{clientName}}", body: "Site visit with {{clientName}}\n\nWhen: {{when}}\nWhere: {{place}}\nBooked by: {{bookedBy}}\n\nRecord every wall's measurements and photos in the project.", variables: ["clientName", "when", "place", "bookedBy"] },
  // Control plane (control-plane/control-notices.service.ts): lifecycle, payment and domain notices to owners.
  { code: "account.trial_started", channel: "in_app", subject: "{{organization}} trial started", body: "Your trial runs until {{date}}.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.trial_started", channel: "email", subject: "{{organization}} trial started", body: "Your {{organization}} workspace is on trial until {{date}}.\n\nSign in at {{address}} to continue setting it up.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.activated", channel: "in_app", subject: "{{organization}} is active", body: "Your workspace is active.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.activated", channel: "email", subject: "{{organization}} is active", body: "Your {{organization}} workspace is active.\n\nSign in at {{address}}.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.grace_started", channel: "in_app", subject: "Payment due by {{date}}", body: "Settle the open invoice by {{date}} to keep full access.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.grace_started", channel: "email", subject: "Payment due by {{date}} for {{organization}}", body: "A payment for {{organization}} is past due.\n\nSettle it by {{date}} to keep full access. After that date the workspace becomes read-only until payment is received.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.suspended", channel: "in_app", subject: "{{organization}} is read-only", body: "Changes are paused. Your data and exports stay available.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.suspended", channel: "email", subject: "{{organization}} is read-only", body: "Changes to {{organization}} are paused.\n\nYou can still sign in, read your records and export them. Contact us to restore full access.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.reactivated", channel: "in_app", subject: "{{organization}} is active again", body: "Full access is restored.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.reactivated", channel: "email", subject: "{{organization}} is active again", body: "Full access to {{organization}} is restored.\n\nSign in at {{address}}.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.archived", channel: "email", subject: "{{organization}} is archived", body: "The {{organization}} workspace is archived.\n\nContact us if you need a copy of your data.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.payment_past_due", channel: "in_app", subject: "Payment past due", body: "An invoice for {{organization}} is past due.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.payment_past_due", channel: "email", subject: "Payment past due for {{organization}}", body: "An invoice for {{organization}} is past due.\n\nPlease settle it to avoid interruption.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.domain_ownership_lost", channel: "in_app", subject: "{{domain}} is not connected", body: "Sign in at {{address}} until the DNS record is restored.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.domain_ownership_lost", channel: "email", subject: "{{domain}} is not connected", body: "We could no longer find the DNS record that proves {{organization}} owns {{domain}}.\n\nSign in at {{address}} in the meantime, and restore the record to reconnect the domain.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.domain_live", channel: "in_app", subject: "{{domain}} is live", body: "Sign in at {{domain}}.", variables: ["organization", "date", "domain", "address"] },
  { code: "account.domain_live", channel: "email", subject: "{{domain}} is live", body: "{{organization}} now signs in at {{domain}}.", variables: ["organization", "date", "domain", "address"] },
];

export async function seedDefaultNotificationTemplates(db: Db, workspaceId: string) {
  for (const template of DEFAULT_NOTIFICATION_TEMPLATES) {
    await db.query(
      `INSERT INTO notification_templates
         (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
       VALUES ($1, $2, $3, 'en', 1, 'approved', $4, $5, $6::jsonb, now())
       ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING`,
      [workspaceId, template.code, template.channel, template.subject, template.body, JSON.stringify(template.variables)],
    );
  }
}

export const renderNoticeText = (template: string, variables: Record<string, string>) =>
  template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_all, key: string) => variables[key] ?? "");

/**
 * Records an in-app notification for one user from the workspace's approved template, inside the
 * caller's tenant transaction. Honours the recipient's preference and is idempotent per key.
 * (Module 10 folds this and the CRM notification engine into one notification service.)
 */
export async function notifyUserInApp(db: Db, input: {
  workspaceId: string;
  recipientUserId: string;
  code: string;
  eventType: string;
  variables: Record<string, string>;
  deepLink?: string;
  idempotencyKey: string;
}) {
  const preference = await db.query<{ enabled: boolean }>(
    `SELECT enabled FROM notification_preferences
     WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='in_app'
       AND event_type::text IN ($3::text, split_part($3::text, '.', 1) || '.*', '*')
     ORDER BY CASE WHEN event_type::text=$3::text THEN 0 WHEN event_type::text='*' THEN 2 ELSE 1 END LIMIT 1`,
    [input.workspaceId, input.recipientUserId, input.eventType],
  );
  if (preference.rows[0]?.enabled === false) return { queued: false as const, reason: "recipient_preference" };
  const template = await db.query<{ id: string; subject: string | null; body: string }>(
    `SELECT id, subject_template AS subject, body_template AS body FROM notification_templates
     WHERE workspace_id=$1 AND code=$2 AND channel='in_app' AND status='approved' AND locale='en'
     ORDER BY version_number DESC LIMIT 1`,
    [input.workspaceId, input.code],
  );
  if (!template.rows[0]) return { queued: false as const, reason: "template_missing" };
  const row = template.rows[0];
  const subject = row.subject ? renderNoticeText(row.subject, input.variables) : null;
  const body = renderNoticeText(row.body, input.variables);
  const inserted = await db.query(
    `INSERT INTO notifications (workspace_id, template_id, recipient_type, recipient_id, channel, event_type, status,
       subject, body, deep_link, idempotency_key, correlation_id, delivered_at)
     VALUES ($1, $2, 'user', $3, 'in_app', $4, 'delivered', $5, $6, $7, $8, gen_random_uuid(), now())
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
    [input.workspaceId, row.id, input.recipientUserId, input.eventType, subject, body, input.deepLink ?? null, input.idempotencyKey],
  );
  // A key already used means this notice was already sent: nothing new is queued.
  if (!inserted.rowCount) return { queued: false as const, reason: "already_sent" };
  // The same notice on the phone, for the events people act on away from a desk.
  if (PUSH_NOTICES.has(input.code)) {
    // Keys are at most 160 characters; a long one is hashed rather than cut.
    const pushKey = input.idempotencyKey.length <= 155 ? `${input.idempotencyKey}:push` : `push:${createHash("sha256").update(input.idempotencyKey).digest("hex")}`;
    await queueUserPush(db, { workspaceId: input.workspaceId, recipientUserId: input.recipientUserId, eventType: input.eventType, subject, body, deepLink: input.deepLink, templateId: row.id, idempotencyKey: pushKey });
  }
  return { queued: true as const };
}

/**
 * Queues a push to one user's phone from the workspace's approved push template, inside the caller's
 * tenant transaction. Only when the person turned push on and has a registered device; the in-app
 * notice is always the record. The worker delivers it (and falls back to the inbox on failure).
 */
export async function queueUserPushFromTemplate(db: Db, input: {
  workspaceId: string;
  recipientUserId: string;
  code: string;
  eventType: string;
  variables: Record<string, string>;
  deepLink?: string;
  idempotencyKey: string;
}) {
  const reachable = await db.query(
    `SELECT 1 FROM notification_preferences preference
      WHERE preference.workspace_id=$1 AND preference.recipient_type='user' AND preference.recipient_id=$2
        AND preference.channel='push' AND preference.event_type='*' AND preference.enabled
        AND EXISTS (SELECT 1 FROM device_endpoints endpoint WHERE endpoint.workspace_id=$1 AND endpoint.user_id=$2 AND endpoint.status='active')
        AND NOT EXISTS (SELECT 1 FROM notification_preferences muted WHERE muted.workspace_id=$1 AND muted.recipient_type='user'
          AND muted.recipient_id=$2 AND muted.channel='push' AND muted.event_type::text IN ($3::text, split_part($3::text, '.', 1) || '.*') AND NOT muted.enabled)
      LIMIT 1`,
    [input.workspaceId, input.recipientUserId, input.eventType],
  );
  if (!reachable.rowCount) return { queued: false as const, reason: "push_off" };
  const template = await db.query<{ id: string; subject: string | null; body: string }>(
    `SELECT id, subject_template AS subject, body_template AS body FROM notification_templates
     WHERE workspace_id=$1 AND code=$2 AND channel='push' AND status='approved' AND locale='en'
     ORDER BY version_number DESC LIMIT 1`,
    [input.workspaceId, input.code],
  );
  if (!template.rows[0]) return { queued: false as const, reason: "template_missing" };
  const row = template.rows[0];
  const inserted = await db.query(
    `INSERT INTO notifications (workspace_id, template_id, recipient_type, recipient_id, channel, event_type, status,
       scheduled_for, subject, body, deep_link, idempotency_key, correlation_id)
     VALUES ($1, $2, 'user', $3, 'push', $4, 'pending', now(), $5, $6, $7, $8, gen_random_uuid())
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
     RETURNING id, correlation_id AS "correlationId"`,
    [input.workspaceId, row.id, input.recipientUserId, input.eventType,
      row.subject ? renderNoticeText(row.subject, input.variables) : null, renderNoticeText(row.body, input.variables),
      input.deepLink ?? null, input.idempotencyKey],
  );
  const notification = inserted.rows[0] as { id: string; correlationId: string } | undefined;
  if (!notification) return { queued: false as const, reason: "already_sent" };
  // Wake the worker now instead of waiting for its next poll.
  const eventId = randomUUID();
  await db.query(
    `INSERT INTO outbox_events (id, workspace_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($4, $1, 'notification', $2, 'notification.delivery_requested.v1', $3::jsonb)`,
    [input.workspaceId, notification.id, JSON.stringify({ schemaVersion: 1, eventId, workspaceId: input.workspaceId, aggregateType: "notification", aggregateId: notification.id, actorUserId: null, occurredAt: new Date().toISOString(), correlationId: notification.correlationId, causationId: null, data: { channel: "push" } }), eventId],
  );
  return { queued: true as const };
}

/**
 * Queues an email for one user from the workspace's approved email template, inside the caller's
 * tenant transaction; the notification worker renders it with the tenant brand and sends it.
 * Sent unless the person switched this event off. Idempotent per key.
 */
export async function queueUserEmail(db: Db, input: {
  workspaceId: string;
  recipientUserId: string;
  code: string;
  eventType: string;
  variables: Record<string, string>;
  deepLink?: string;
  idempotencyKey: string;
}) {
  const preference = await db.query<{ enabled: boolean }>(
    `SELECT enabled FROM notification_preferences
     WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='email'
       AND event_type::text IN ($3::text, split_part($3::text, '.', 1) || '.*', '*')
     ORDER BY CASE WHEN event_type::text=$3::text THEN 0 WHEN event_type::text='*' THEN 2 ELSE 1 END LIMIT 1`,
    [input.workspaceId, input.recipientUserId, input.eventType],
  );
  if (preference.rows[0]?.enabled === false) return { queued: false as const, reason: "recipient_preference" };
  const template = await db.query<{ id: string; subject: string | null; body: string }>(
    `SELECT id, subject_template AS subject, body_template AS body FROM notification_templates
     WHERE workspace_id=$1 AND code=$2 AND channel='email' AND status='approved' AND locale='en'
     ORDER BY version_number DESC LIMIT 1`,
    [input.workspaceId, input.code],
  );
  if (!template.rows[0]) return { queued: false as const, reason: "template_missing" };
  const row = template.rows[0];
  const inserted = await db.query<{ id: string; correlationId: string }>(
    `INSERT INTO notifications (workspace_id, template_id, recipient_type, recipient_id, channel, event_type, status,
       scheduled_for, subject, body, deep_link, idempotency_key, correlation_id)
     VALUES ($1, $2, 'user', $3, 'email', $4, 'pending', now(), $5, $6, $7, $8, gen_random_uuid())
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
     RETURNING id, correlation_id AS "correlationId"`,
    [input.workspaceId, row.id, input.recipientUserId, input.eventType,
      row.subject ? renderNoticeText(row.subject, input.variables) : null, renderNoticeText(row.body, input.variables),
      input.deepLink ?? null, input.idempotencyKey],
  );
  const notification = inserted.rows[0];
  if (notification) await wakeDelivery(db, input.workspaceId, notification.id, notification.correlationId, "email");
  return { queued: true as const };
}

/** Wakes the delivery worker for one queued notice now, instead of waiting for its next poll. */
export async function wakeDelivery(db: Db, workspaceId: string, notificationId: string, correlationId: string, channel: string) {
  const eventId = randomUUID();
  await db.query(
    `INSERT INTO outbox_events (id, workspace_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($4, $1, 'notification', $2, 'notification.delivery_requested.v1', $3::jsonb)`,
    [workspaceId, notificationId, JSON.stringify({ schemaVersion: 1, eventId, workspaceId, aggregateType: "notification", aggregateId: notificationId, actorUserId: null, occurredAt: new Date().toISOString(), correlationId, causationId: null, data: { channel } }), eventId],
  );
}

/**
 * Notices that also go to the person's phone as a push: work waiting for someone away from a desk
 * (site, factory, purchasing, stock), approvals, and a new enquiry of one's own. Everything else stays in
 * the in-app inbox. A push needs the person to have turned push on and a registered phone.
 */
export const PUSH_NOTICES: ReadonlySet<string> = new Set([
  "site.report_missing", "site.report_returned", "site.incident", "site.blocked",
  "work.assigned", "work.overdue", "work.snag_reopened",
  "factory.released", "factory.check_failed", "factory.material_short",
  "purchasing.late", "purchasing.order_late", "purchasing.inspection_needed",
  "stock.transfer_sent", "stock.transfer_short",
  "purchasing.approval_needed", "stock.adjustment_needs_approval", "payables.run_submitted", "petty_cash.submitted",
  "hrms.leave_requested", "hrms.leave_approved", "hrms.leave_rejected", "hrms.timesheet_submitted", "hrms.crew_day_submitted", "hrms.attendance_to_review",
  "quotation.review_requested", "design.review_requested",
  "crm.lead_assigned", "crm.lead_taken_over_to", "crm.conversation_assigned",
  // Team inbox: a client wrote in a chat that is yours (one notice per chat), or someone mentioned you in a note.
  "crm.inbox_message", "crm.inbox_mention",
]);

/**
 * When quiet hours ({ start: "22:00", end: "07:00", timezone }) are on now, the moment they end; otherwise null.
 * A window may cross midnight. Without a time zone the hours are UTC.
 */
export function quietUntil(quietHours: Record<string, unknown> | null | undefined, now = new Date()): Date | null {
  const pattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const start = typeof quietHours?.start === "string" ? pattern.exec(quietHours.start) : null;
  const end = typeof quietHours?.end === "string" ? pattern.exec(quietHours.end) : null;
  if (!start || !end) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: typeof quietHours?.timezone === "string" ? quietHours.timezone : "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch { return null; }
  const minuteOf = (hour: string, minute: string) => Number(hour) * 60 + Number(minute);
  const current = minuteOf(parts.find((part) => part.type === "hour")?.value ?? "0", parts.find((part) => part.type === "minute")?.value ?? "0");
  const from = minuteOf(start[1], start[2]);
  const to = minuteOf(end[1], end[2]);
  if (from === to) return null;
  const inside = from < to ? current >= from && current < to : current >= from || current < to;
  if (!inside) return null;
  const wait = (to - current + 1440) % 1440;
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000 + wait * 60_000);
}

/**
 * Queues a push to one person's phone, inside the caller's tenant transaction, when they turned push on
 * (the app does it on sign-in) and have a registered phone; a preference for this event (or its module)
 * can switch it off. Idempotent per key. The worker sends it through Expo and falls back to the inbox.
 */
export async function queueUserPush(db: Db, input: {
  workspaceId: string;
  recipientUserId: string;
  eventType: string;
  subject: string | null;
  body: string;
  deepLink?: string | null;
  templateId?: string | null;
  idempotencyKey: string;
}) {
  // The phone's switch ("*") must be on; the event's or its module's setting can still turn this one off.
  const preferences = await db.query<{ eventType: string; enabled: boolean; quietHours: Record<string, unknown> | null }>(
    `SELECT event_type AS "eventType", enabled, quiet_hours AS "quietHours" FROM notification_preferences
     WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='push'
       AND event_type::text IN ($3::text, split_part($3::text, '.', 1) || '.*', '*')`,
    [input.workspaceId, input.recipientUserId, input.eventType],
  );
  const master = preferences.rows.find((row) => row.eventType === "*");
  const specific = preferences.rows.find((row) => row.eventType === input.eventType) ?? preferences.rows.find((row) => row.eventType !== "*");
  if (master?.enabled !== true || specific?.enabled === false) return { queued: false as const, reason: "push_off" };
  // The person's quiet hours (on the phone's switch) hold a push until they end; the in-app notice is already there.
  const scheduledFor = quietUntil(master.quietHours) ?? new Date();
  const device = await db.query(
    `SELECT 1 FROM device_endpoints WHERE workspace_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,
    [input.workspaceId, input.recipientUserId],
  );
  if (!device.rowCount) return { queued: false as const, reason: "no_device" };
  const inserted = await db.query<{ id: string; correlationId: string }>(
    `INSERT INTO notifications (workspace_id, template_id, recipient_type, recipient_id, channel, event_type, status,
       scheduled_for, subject, body, deep_link, idempotency_key, correlation_id)
     VALUES ($1, $2, 'user', $3, 'push', $4, 'pending', $9, $5, $6, $7, $8, gen_random_uuid())
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
     RETURNING id, correlation_id AS "correlationId"`,
    [input.workspaceId, input.templateId ?? null, input.recipientUserId, input.eventType, input.subject, input.body, input.deepLink ?? null, input.idempotencyKey, scheduledFor],
  );
  const notification = inserted.rows[0];
  if (!notification) return { queued: false as const, reason: "already_sent" };
  await wakeDelivery(db, input.workspaceId, notification.id, notification.correlationId, "push");
  return { queued: true as const };
}
