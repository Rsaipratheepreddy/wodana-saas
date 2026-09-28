import { randomUUID } from "node:crypto";
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
    body: "New enquiry from {{source}}. Log your first contact within the response time.",
    variables: ["reference", "clientName", "source"],
  },
  {
    code: "crm.lead_assigned",
    channel: "email",
    subject: "New enquiry {{reference}}: {{clientName}}",
    body: "You have a new enquiry.\n\nReference: {{reference}}\nClient: {{clientName}}\nSource: {{source}}\n\nOpen it and log your first contact within the response time.",
    variables: ["reference", "clientName", "source"],
  },
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
  { code: "quotation.qs_approved", channel: "in_app", subject: "{{title}} is ready to send", body: "{{actor}} approved the estimate for {{clientName}}.", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.qs_approved", channel: "email", subject: "{{title}} is ready to send · {{clientName}}", body: "{{actor}} approved the estimate for {{title}} ({{clientName}}).\n\nOpen the quote to send it to the client.", variables: ["title", "clientName", "actor", "note"] },
  // Client payments on a planning case (commercial/commercial-notices.ts): Finance verifies, the reporter hears back.
  { code: "commercial.receipt_reported", channel: "in_app", subject: "Payment to verify · {{clientName}}", body: "{{actor}} reported {{amount}} for {{title}}.", variables: ["title", "clientName", "actor", "amount", "note"] },
  { code: "commercial.receipt_reported", channel: "email", subject: "Payment to verify · {{clientName}}", body: "{{actor}} reported {{amount}} for {{title}} ({{clientName}}).\n\nOpen it to check the receipt and verify it.", variables: ["title", "clientName", "actor", "amount", "note"] },
  { code: "commercial.receipt_verified", channel: "in_app", subject: "Payment verified · {{clientName}}", body: "{{actor}} verified {{amount}} for {{title}}.", variables: ["title", "clientName", "actor", "amount", "note"] },
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
  // Client portal notices (client-portal/portal-notices.ts): to client contacts, by email.
  { code: "portal.quote_issued", channel: "email", subject: "{{title}} is ready for you", body: "{{company}} sent you {{title}} for {{project}}.\n\nOpen your project page to read it and give your decision.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.invoice_issued", channel: "email", subject: "Invoice {{title}} from {{company}}", body: "{{company}} issued invoice {{title}} for {{project}}. {{due}}\n\nOpen your project page to see it and what's left to pay.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.decision_waiting", channel: "email", subject: "{{title}} is waiting for your decision", body: "{{company}} needs your decision on {{title}} for {{project}}. {{due}}\n\nOpen your project page to review it.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.payment_received", channel: "email", subject: "Payment received: {{title}}", body: "{{company}} received your payment for {{title}} on {{project}}.\n\nOpen your project page to see what comes next.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.update_published", channel: "email", subject: "New update on {{project}}", body: "{{note}}\n\nOpen your project page to see the progress.", variables: ["company", "project", "title", "due", "note"] },
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

const render = (template: string, variables: Record<string, string>) =>
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
  const inserted = await db.query(
    `INSERT INTO notifications (workspace_id, template_id, recipient_type, recipient_id, channel, event_type, status,
       subject, body, deep_link, idempotency_key, correlation_id, delivered_at)
     VALUES ($1, $2, 'user', $3, 'in_app', $4, 'delivered', $5, $6, $7, $8, gen_random_uuid(), now())
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
    [input.workspaceId, row.id, input.recipientUserId, input.eventType,
      row.subject ? render(row.subject, input.variables) : null, render(row.body, input.variables),
      input.deepLink ?? null, input.idempotencyKey],
  );
  // A key already used means this notice was already sent: nothing new is queued.
  return inserted.rowCount ? { queued: true as const } : { queued: false as const, reason: "already_sent" };
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
      row.subject ? render(row.subject, input.variables) : null, render(row.body, input.variables),
      input.deepLink ?? null, input.idempotencyKey],
  );
  const notification = inserted.rows[0];
  // Wake the worker now instead of waiting for its next poll.
  const eventId = randomUUID();
  if (notification) await db.query(
    `INSERT INTO outbox_events (id, workspace_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($4, $1, 'notification', $2, 'notification.delivery_requested.v1', $3::jsonb)`,
    [input.workspaceId, notification.id, JSON.stringify({ schemaVersion: 1, eventId, workspaceId: input.workspaceId, aggregateType: "notification", aggregateId: notification.id, actorUserId: null, occurredAt: new Date().toISOString(), correlationId: notification.correlationId, causationId: null, data: { channel: "email" } }), eventId],
  );
  return { queued: true as const };
}
