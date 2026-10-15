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
 * The reminder engine's notices (reminders/, plan §6.24a; 0290 seeds them into existing workspaces). The engine
 * fills `title` (the record), `context` (the client, project or supplier it belongs to) and `due`, a short phrase
 * in the recipient's language and zone ("due today", "3 days overdue", "waiting 26 hours").
 */
const REMINDER_VARIABLES = ["title", "context", "due"];
const staffReminder = (kind: string, action: string): DefaultTemplate[] => [
  { code: `reminders.${kind}`, channel: "in_app", subject: "{{title}} · {{due}}", body: `{{context}}. ${action}`, variables: REMINDER_VARIABLES },
  { code: `reminders.${kind}`, channel: "push", subject: "{{title}} · {{due}}", body: `{{context}}. ${action}`, variables: REMINDER_VARIABLES },
  { code: `reminders.${kind}`, channel: "email", subject: "{{title}} · {{due}}", body: `{{title}} is {{due}}.\n\n{{context}}. ${action}`, variables: REMINDER_VARIABLES },
];
const clientDecisionCopy = (kind: string, what: string): DefaultTemplate[] => {
  const variables = [...REMINDER_VARIABLES, "reminders"];
  const subject = `Waiting on the client · {{title}}`;
  const body = `{{context}} has had {{reminders}} reminders about this ${what} and hasn't decided. Call them.`;
  return [
    { code: `reminders.${kind}.staff`, channel: "in_app", subject, body, variables },
    { code: `reminders.${kind}.staff`, channel: "push", subject, body, variables },
    { code: `reminders.${kind}.staff`, channel: "email", subject, body: `${body}\n\nOpen it to see what they still have to decide.`, variables },
  ];
};

const INSPECTION_VARIABLES = ["order", "item", "project", "stage", "date", "actor", "note"];

/** PLM-147 (0341 seeds them into existing workspaces): `why` is the over-budget line, written by the module in plain words. */
const VALUE_ENGINEERING_VARIABLES = ["title", "clientName", "actor", "lead", "qs", "why", "round", "when", "place", "budget", "note"];
const VALUE_ENGINEERING_TEMPLATES: DefaultTemplate[] = [
  { code: "quotation.value_engineering_lead", channel: "in_app", subject: "Over budget · {{clientName}}", body: "{{why}}. You lead value engineering with {{qs}}: agree the savings, then present the options to the client. {{note}}", variables: VALUE_ENGINEERING_VARIABLES },
  { code: "quotation.value_engineering_lead", channel: "email", subject: "Over budget: value engineering for {{clientName}}", body: "{{why}} ({{title}}).\n\nYou lead value engineering with {{qs}}: agree the savings together, then present the options to {{clientName}}. The client decides.\n\n{{note}}", variables: VALUE_ENGINEERING_VARIABLES },
  { code: "quotation.value_engineering_no_designer", channel: "in_app", subject: "Over budget · {{clientName}} · no lead designer", body: "{{why}}. Nobody is the lead designer on this job, so you lead value engineering with {{qs}}. {{note}}", variables: VALUE_ENGINEERING_VARIABLES },
  { code: "quotation.value_engineering_no_designer", channel: "email", subject: "Over budget: you lead value engineering for {{clientName}}", body: "{{why}} ({{title}}).\n\nNobody is the lead designer on this job, so you lead value engineering with {{qs}}: agree the savings, then present the options to {{clientName}}. Allocate a lead designer and it moves to them.\n\n{{note}}", variables: VALUE_ENGINEERING_VARIABLES },
  { code: "quotation.value_engineering_copy", channel: "in_app", subject: "Value engineering · {{clientName}}", body: "{{why}}. {{lead}} leads it with {{qs}}. You can attend the meeting; the design choices are theirs.", variables: VALUE_ENGINEERING_VARIABLES },
  { code: "quotation.value_engineering_copy", channel: "email", subject: "For information: value engineering for {{clientName}}", body: "{{why}} ({{title}}).\n\n{{lead}} leads value engineering with {{qs}} and presents the options to the client. You can attend the meeting; the design choices are theirs.", variables: VALUE_ENGINEERING_VARIABLES },
  { code: "quotation.value_engineering_chargeable", channel: "in_app", subject: "Chargeable value engineering · {{clientName}}", body: "Round {{round}} is past the free rounds. Agree the fee with the client before the work starts.", variables: VALUE_ENGINEERING_VARIABLES },
  { code: "quotation.value_engineering_chargeable", channel: "email", subject: "Chargeable value engineering for {{clientName}}", body: "Value engineering round {{round}} on {{title}} is past the free rounds your firm gives.\n\nAgree the fee with {{clientName}} before the work starts.", variables: VALUE_ENGINEERING_VARIABLES },
  { code: "quotation.value_engineering_agreed", channel: "in_app", subject: "Savings agreed · {{clientName}}", body: "{{actor}}: {{note}}", variables: VALUE_ENGINEERING_VARIABLES },
  { code: "quotation.value_engineering_agreed", channel: "email", subject: "Savings agreed for {{clientName}}", body: "{{actor}} recorded the savings agreed for {{title}}:\n\n{{note}}\n\nThe options go to the client next.", variables: VALUE_ENGINEERING_VARIABLES },
  { code: "quotation.value_engineering_meeting", channel: "in_app", subject: "Value engineering meeting · {{clientName}}", body: "{{actor}} booked it for {{when}}.", variables: VALUE_ENGINEERING_VARIABLES },
  { code: "quotation.value_engineering_meeting", channel: "email", subject: "Value engineering meeting booked: {{clientName}}", body: "{{actor}} booked the value engineering meeting for {{title}} on {{when}}. {{place}}\n\nOpen it to see the savings agreed and, afterwards, the minutes.", variables: VALUE_ENGINEERING_VARIABLES },
  { code: "quotation.value_engineering_budget_changed", channel: "in_app", subject: "Budget changed · {{clientName}}", body: "{{actor}} changed the client's budget to {{budget}} during value engineering. {{note}}", variables: VALUE_ENGINEERING_VARIABLES },
  { code: "quotation.value_engineering_closed", channel: "in_app", subject: "Value engineering closed · {{clientName}}", body: "{{note}}", variables: VALUE_ENGINEERING_VARIABLES },
];
export const INSPECTION_TEMPLATES: DefaultTemplate[] = [
  { code: "factory.inspection_ready", channel: "in_app", subject: "{{item}} is ready for {{stage}}", body: "{{order}} · {{project}}. Inspect it by {{date}}. {{note}}", variables: INSPECTION_VARIABLES },
  { code: "factory.inspection_ready", channel: "email", subject: "{{item}} is ready for {{stage}}: {{project}}", body: "{{actor}} marked {{order}} {{item}} for {{project}} ready for {{stage}}.\n\nInspect it at the factory by {{date}}. {{note}}", variables: INSPECTION_VARIABLES },
  { code: "factory.reinspection_ready", channel: "in_app", subject: "{{item}} is ready for re-inspection", body: "{{order}} · {{project}}: the snags from {{stage}} are fixed. Inspect it by {{date}}. {{note}}", variables: INSPECTION_VARIABLES },
  { code: "factory.reinspection_ready", channel: "email", subject: "{{item}} is ready for re-inspection: {{project}}", body: "The factory fixed the snags {{stage}} found on {{order}} {{item}} for {{project}}.\n\nInspect it again by {{date}}. {{note}}", variables: INSPECTION_VARIABLES },
  { code: "factory.inspection_snags", channel: "in_app", subject: "Snags to fix on {{item}}", body: "{{actor}} found them at {{stage}} on {{order}} · {{project}}: {{note}}", variables: INSPECTION_VARIABLES },
  { code: "factory.inspection_snags", channel: "email", subject: "Snags to fix on {{item}}: {{project}}", body: "{{actor}} failed {{stage}} on {{order}} {{item}} for {{project}}.\n\nTo fix: {{note}}\n\nMark each one fixed when it is done; the item then goes back for inspection.", variables: INSPECTION_VARIABLES },
  { code: "factory.inspection_failed", channel: "in_app", subject: "{{item}} failed {{stage}}", body: "{{actor}} on {{order}} · {{project}}: {{note}}", variables: INSPECTION_VARIABLES },
  { code: "factory.inspection_failed", channel: "email", subject: "{{item}} failed {{stage}}: {{project}}", body: "{{actor}} failed {{stage}} on {{order}} {{item}} for {{project}}.\n\n{{note}}\n\nThe factory has the snags to fix. It can't go to site until the last inspection passes.", variables: INSPECTION_VARIABLES },
  { code: "factory.inspection_passed", channel: "in_app", subject: "{{item}} passed {{stage}}", body: "{{actor}} passed it on {{order}} · {{project}}. Finishing can go ahead.", variables: INSPECTION_VARIABLES },
  { code: "factory.dispatch_cleared", channel: "in_app", subject: "{{item}} can go to site", body: "{{actor}} passed {{stage}} on {{order}} · {{project}}.", variables: INSPECTION_VARIABLES },
  { code: "factory.dispatch_cleared", channel: "email", subject: "{{item}} can go to site: {{project}}", body: "{{actor}} passed {{stage}} on {{order}} {{item}} for {{project}}.\n\nIt can be sent to site.", variables: INSPECTION_VARIABLES },
  { code: "factory.inspector_missing", channel: "in_app", subject: "Nobody inspects {{item}}", body: "{{project}} has nobody in the {{note}} role. Add them to the team, or record {{stage}} yourself.", variables: INSPECTION_VARIABLES },
  { code: "factory.inspector_missing", channel: "email", subject: "Nobody inspects {{item}}: {{project}}", body: "{{order}} {{item}} is ready for {{stage}}, but {{project}} has nobody in the {{note}} role.\n\nAdd them to the project team, or record the inspection yourself.", variables: INSPECTION_VARIABLES },
];

/**
 * The finishes schedule (design/finishes.store.ts, PLM-146/148/156): the designer hears the finishes to mark once the
 * samples are approved and a missing client signature when procurement tries to order; the QS hears the finishes to
 * price and a finish changed after it was sent; the factory lead hears the sample log is shared; procurement hears a
 * project's gate cleared. 0339 seeds them into existing workspaces.
 */
const FINISH_VARIABLES = ["clientName", "project", "actor", "title", "count", "items", "due", "note"];
export const FINISH_TEMPLATES: DefaultTemplate[] = [
  { code: "finishes.to_mark", channel: "in_app", subject: "Mark the finishes · {{clientName}}", body: "The samples are approved. Mark the finishes on the render snapshots and send them to QS by {{due}}.", variables: FINISH_VARIABLES },
  { code: "finishes.to_mark", channel: "email", subject: "Mark the finishes: {{clientName}}", body: "The samples for {{clientName}} are approved.\n\nMark the exact finishes on the render snapshots and send them to QS by {{due}}.", variables: FINISH_VARIABLES },
  { code: "finishes.sent_to_qs", channel: "in_app", subject: "Finishes to price · {{clientName}}", body: "{{actor}} sent {{count}} finishes. Price the quotation from them. {{note}}", variables: FINISH_VARIABLES },
  { code: "finishes.sent_to_qs", channel: "email", subject: "Finishes to price: {{clientName}}", body: "{{actor}} marked the finishes for {{clientName}} and sent them to you ({{count}}).\n\nPrice the quotation from the designer's specification. {{note}}", variables: FINISH_VARIABLES },
  { code: "finishes.changed", channel: "in_app", subject: "{{title}} changed after pricing · {{clientName}}", body: "{{actor}}: {{note}} The old price is flagged on the quotation.", variables: FINISH_VARIABLES },
  { code: "finishes.changed", channel: "email", subject: "{{title}} changed after pricing: {{clientName}}", body: "{{actor}} changed {{title}} for {{clientName}} after it was sent to you.\n\n{{note}}\n\nThe old price is flagged on the quotation. Price it again from the new specification.", variables: FINISH_VARIABLES },
  { code: "finishes.factory_shared", channel: "in_app", subject: "Sample log shared · {{project}}", body: "{{actor}} shared the samples and finishes for {{clientName}}. {{note}}", variables: FINISH_VARIABLES },
  { code: "finishes.factory_shared", channel: "email", subject: "Sample log shared: {{project}}", body: "{{actor}} shared the sample log and photos for {{project}} ({{clientName}}) with the factory.\n\nOpen it in the Factory. {{note}}", variables: FINISH_VARIABLES },
  { code: "procurement.gate_cleared", channel: "in_app", subject: "{{project}} can be ordered", body: "The client's payment, the material list and the signed samples are in for {{clientName}}.", variables: FINISH_VARIABLES },
  { code: "procurement.gate_cleared", channel: "email", subject: "{{project}} can be ordered", body: "The client's payment, the confirmed material list and the client's signed samples and data sheets are all in for {{project}} ({{clientName}}).\n\nThe materials can be ordered.", variables: FINISH_VARIABLES },
  { code: "procurement.signature_missing", channel: "in_app", subject: "Client signature missing · {{project}}", body: "{{actor}} tried to order. The client still signs: {{items}}.", variables: FINISH_VARIABLES },
  { code: "procurement.signature_missing", channel: "email", subject: "Client signature missing: {{project}}", body: "{{actor}} tried to order materials for {{project}} ({{clientName}}), but the client hasn't signed these samples or data sheets yet:\n\n{{items}}\n\nRecord each signed sample or sheet (a photo and the date) on the finishes schedule.", variables: FINISH_VARIABLES },
];

export const REMINDER_TEMPLATES: DefaultTemplate[] = [
  // Staff kinds: the owner (and cc) in the app, on the phone and by email.
  ...staffReminder("work.due", "Update its progress or move the date."),
  ...staffReminder("crm.follow_up", "Call or message the client, then log it."),
  ...staffReminder("approval.waiting", "It is waiting for your decision."),
  ...staffReminder("quote.expiring", "Follow up with the client, or extend its validity."),
  ...staffReminder("invoice.overdue", "Chase the payment, or record it if it came in."),
  ...staffReminder("payables.due", "Pay it, or put it on hold."),
  ...staffReminder("purchase.order_late", "Chase the supplier, or move the expected date."),
  ...staffReminder("design.stage_due", "Finish the stage, or move its date."),
  ...staffReminder("permit.expiry", "Renew the permit, or move the booking."),
  ...staffReminder("finance_request.waiting", "It is waiting for Finance."),
  ...staffReminder("meeting.minutes_due", "Write the minutes and share them with the client."),
  ...staffReminder("crm.timeline_check", "Answer the timeline question so Sales can reply to the client today."),
  ...staffReminder("factory.inspection_due", "Inspect it at the factory, or ask someone to cover it."),
  ...staffReminder("quote.value_engineering_idle", "Agree the savings, present the options or record the client's decision."),
  ...staffReminder("finishes.signature_due", "Get the client to sign the samples and data sheets, then record them."),
  // Client kinds: the client by email (WhatsApp uses the firm's approved templates); the owner after the reminders.
  { code: "reminders.client.quote_decision", channel: "email", subject: "Your quotation {{title}} is waiting for you", body: "{{title}} is waiting for your decision.\n\n{{context}}\n\nOpen it to accept it or ask for changes.", variables: REMINDER_VARIABLES },
  { code: "reminders.client.design_decision", channel: "email", subject: "Your design {{title}} is waiting for you", body: "{{title}} is waiting for your approval.\n\n{{context}}\n\nOpen it to approve it or ask for changes.", variables: REMINDER_VARIABLES },
  { code: "reminders.payment.due", channel: "email", subject: "Payment {{title}} · {{due}}", body: "{{title}} is {{due}}.\n\n{{context}}\n\nOpen it to see how to pay. If you have paid already, thank you, and please ignore this message.", variables: REMINDER_VARIABLES },
  { code: "reminders.change_request.client_decision", channel: "email", subject: "Your change {{title}} is waiting for you", body: "{{title}} is waiting for your decision.\n\n{{context}}\n\nOpen it to approve it or decline it.", variables: REMINDER_VARIABLES },
  ...clientDecisionCopy("client.quote_decision", "quotation"),
  ...clientDecisionCopy("client.design_decision", "design"),
  ...clientDecisionCopy("change_request.client_decision", "change"),
  // Escalation: the next person in the chain, once per level.
  { code: "reminders.escalated", channel: "in_app", subject: "Escalated · {{title}} · {{due}}", body: "{{owner}} has had {{reminders}} reminders. {{context}}.", variables: [...REMINDER_VARIABLES, "owner", "reminders"] },
  { code: "reminders.escalated", channel: "push", subject: "Escalated · {{title}} · {{due}}", body: "{{owner}} has had {{reminders}} reminders. {{context}}.", variables: [...REMINDER_VARIABLES, "owner", "reminders"] },
  { code: "reminders.escalated", channel: "email", subject: "Escalated · {{title}} · {{due}}", body: "{{title}} is {{due}}. {{owner}} has had {{reminders}} reminders and it is still open.\n\n{{context}}.\n\nOpen it to help move it on, or reassign it.", variables: [...REMINDER_VARIABLES, "owner", "reminders"] },
  // The personal digest at the person's digest time, on working days, only when something is due.
  { code: "reminders.digest", channel: "in_app", subject: "Your day · {{count}} to do", body: "{{overdue}} overdue, {{today}} due today, {{waiting}} waiting.", variables: ["count", "overdue", "today", "waiting", "items"] },
  { code: "reminders.digest", channel: "email", subject: "Your day · {{count}} to do", body: "{{overdue}} overdue, {{today}} due today, {{waiting}} waiting.\n\n{{items}}\n\nOpen My day to work through them.", variables: ["count", "overdue", "today", "waiting", "items"] },
  // A client no channel reached: the subject's owner, once.
  { code: "reminders.unreachable", channel: "in_app", subject: "Couldn't reach {{client}} · {{title}}", body: "No WhatsApp or email reached them. Add a contact detail, or tell them yourself.", variables: ["client", "title", "context"] },
  { code: "reminders.unreachable", channel: "email", subject: "Couldn't reach {{client}} · {{title}}", body: "The reminder about {{title}} reached {{client}} on no channel: WhatsApp and email both failed or aren't set up.\n\n{{context}}\n\nAdd a contact detail on the client, or tell them yourself.", variables: ["client", "title", "context"] },
  // Failing client or critical deliveries: owners and administrators, once per channel, error and day.
  { code: "reminders.delivery_failed", channel: "in_app", subject: "{{channel}} messages are failing", body: "{{count}} failed today: {{error}}. Check Delivery health.", variables: ["channel", "count", "error"] },
  { code: "reminders.delivery_failed", channel: "email", subject: "{{channel}} messages are failing", body: "{{count}} {{channel}} messages to clients or about critical items failed today with: {{error}}.\n\nOpen Settings → Delivery health to see which ones and fix the connection.", variables: ["channel", "count", "error"] },
];

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
  // Approvals that wait (approvals/approval-chasers.ts): the approver, then the owners.
  { code: "approvals.reminder", channel: "in_app", subject: "Still waiting for you · {{title}}", body: "It has waited {{hours}} hours.", variables: ["title", "hours", "approvers"] },
  { code: "approvals.reminder", channel: "email", subject: "Still waiting for you · {{title}}", body: "{{title}} has waited {{hours}} hours for your decision.\n\nOpen it to approve or send it back.", variables: ["title", "hours", "approvers"] },
  { code: "approvals.escalated", channel: "in_app", subject: "Waiting {{hours}} hours · {{title}}", body: "Still with {{approvers}}.", variables: ["title", "hours", "approvers"] },
  { code: "approvals.escalated", channel: "email", subject: "Waiting {{hours}} hours · {{title}}", body: "{{title}} has waited {{hours}} hours. It is still with {{approvers}}.\n\nOpen it to decide it or chase them.", variables: ["title", "hours", "approvers"] },
  // The E3 approval engine (approvals/approval-engine.ts): the step's approvers, the requester, and an escalation.
  { code: "approvals.requested", channel: "in_app", subject: "To approve · {{title}}", body: "{{actor}} asks for your approval{{amountText}}.", variables: ["title", "actor", "amountText", "step"] },
  { code: "approvals.requested", channel: "email", subject: "To approve · {{title}}", body: "{{actor}} asks for your approval{{amountText}}.\n\nStep: {{step}}.", variables: ["title", "actor", "amountText", "step"] },
  { code: "approvals.decided", channel: "in_app", subject: "{{title}} · {{outcome}}", body: "{{actor}}: {{note}}", variables: ["title", "actor", "outcome", "note"] },
  { code: "approvals.escalated_step", channel: "in_app", subject: "Escalated to you · {{title}}", body: "It waited {{hours}} hours at {{step}}.", variables: ["title", "hours", "step"] },
  // AI read a payment proof (crm/opportunities/payment-proof-reading.ts): Finance confirms or corrects it.
  { code: "opportunity.proof_read", channel: "in_app", subject: "Payment proof read · {{clientName}}", body: "The proof for {{title}} reads {{amount}}. Confirm or correct it.", variables: ["title", "clientName", "amount"] },
  // Offboarding (workspaces/member-offboarding.ts): the successor hears what they took over.
  { code: "workspace.work_handed_over", channel: "in_app", subject: "{{memberName}}'s work is yours", body: "{{note}}", variables: ["memberName", "note"] },
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
  { code: "crm.deal_won", channel: "in_app", subject: "Won: {{title}}", body: "{{clientName}} {{amount}} · {{reason}}", variables: ["title", "clientName", "amount", "reason"] },
  { code: "crm.deal_lost", channel: "in_app", subject: "Lost: {{title}}", body: "{{clientName}} · Why: {{reason}}", variables: ["title", "clientName", "amount", "reason"] },
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
  // Design flow after Won (plan §6.7a batch 1): showroom booking, revisions, the ledger, design comments and the estimate hand-off.
  { code: "design.material_selection_unbooked", channel: "in_app", subject: "Book the material selection · {{clientName}}", body: "The showroom appointment is not booked yet. Material selection is due {{due}}.", variables: ["clientName", "due"] },
  { code: "design.material_selection_booked", channel: "in_app", subject: "Material selection with {{clientName}}", body: "{{when}} · {{place}}. Booked by {{bookedBy}}.", variables: ["clientName", "when", "place", "bookedBy"] },
  { code: "design.material_selection_booked", channel: "email", subject: "Invitation: material selection with {{clientName}}", body: "Material selection with {{clientName}}\n\nWhen: {{when}}\nWhere: {{place}}\nBooked by: {{bookedBy}}\n\nAttach the material list to the project after the appointment.", variables: ["clientName", "when", "place", "bookedBy"] },
  { code: "design.extra_revision", channel: "in_app", subject: "Extra revision on {{stage}} · {{clientName}}", body: "Revision {{round}} of {{title}} goes beyond the {{included}} included. It is chargeable.", variables: ["stage", "clientName", "round", "included", "title"] },
  { code: "design.extra_revision", channel: "email", subject: "Chargeable revision: {{stage}} for {{clientName}}", body: "Revision {{round}} of {{title}} goes beyond the {{included}} included in the package. Agree the extra-revision fee with {{clientName}} before the work starts.", variables: ["stage", "clientName", "round", "included", "title"] },
  { code: "design.site_measured", channel: "in_app", subject: "Site measured · {{clientName}}", body: "Measurements and photos are in. {{summary}}", variables: ["clientName", "summary"] },
  { code: "design.site_measured", channel: "email", subject: "Site measured: {{clientName}}", body: "The site visit for {{clientName}} is recorded with its measurements and photos.\n\n{{summary}}\n\nOpen the case to price it.", variables: ["clientName", "summary"] },
  { code: "design.estimate_overdue", channel: "in_app", subject: "Estimate overdue · {{clientName}}", body: "The design was approved {{approvedOn}}. The estimate was due {{due}}.", variables: ["clientName", "approvedOn", "due"] },
  { code: "design.estimate_overdue", channel: "email", subject: "Estimate overdue: {{clientName}}", body: "{{clientName}} approved the design on {{approvedOn}}. The estimate was due {{due}} and has not been sent.\n\nOpen the case to send it.", variables: ["clientName", "approvedOn", "due"] },
  { code: "design.concept_chosen", channel: "in_app", subject: "{{clientName}} chose {{title}}", body: "{{stage}}: {{note}}", variables: ["clientName", "title", "stage", "note"] },
  { code: "design.approved_estimate", channel: "in_app", subject: "Design approved · {{clientName}}", body: "Approved {{approvedOn}}. Share the estimate by {{due}}.", variables: ["clientName", "approvedOn", "due"] },
  { code: "design.approved_estimate", channel: "email", subject: "Design approved: {{clientName}}", body: "{{clientName}} approved the final design on {{approvedOn}}.\n\nThe estimate (Proposal 2) is due by {{due}}. Open the case to prepare it.", variables: ["clientName", "approvedOn", "due"] },
  { code: "design.ledger_confirmed", channel: "in_app", subject: "{{clientName}} confirmed {{title}}", body: "{{note}}", variables: ["clientName", "title", "note"] },
  { code: "design.ledger_changed", channel: "in_app", subject: "Change after sign-off · {{clientName}}", body: "{{title}}: {{impact}}. Procurement keeps the signed-off version until the change is approved.", variables: ["clientName", "title", "impact"] },
  { code: "design.ledger_changed", channel: "email", subject: "Change after sign-off: {{clientName}}", body: "{{title}} changed after the material list was signed off.\n\nImpact: {{impact}}\n\nProcurement keeps the signed-off version until the change is approved.", variables: ["clientName", "title", "impact"] },
  // The design order of 13 Oct 2026 (design/, PLM-140–145, PLM-151): the team to allocate and who joins it, the kick-off,
  // the design site measure, the renders' team and sign-off, samples and their meeting, and rounds waiting for the reviewer.
  { code: "design.team_to_allocate", channel: "in_app", subject: "Allocate the design team · {{clientName}}", body: "The design fee is paid. Choose the {{roles}} by {{due}}.", variables: ["clientName", "roles", "due"] },
  { code: "design.team_to_allocate", channel: "email", subject: "Allocate the design team: {{clientName}}", body: "The design fee for {{clientName}} is paid.\n\nChoose the {{roles}} by {{due}} so the kick-off can be booked.", variables: ["clientName", "roles", "due"] },
  { code: "design.team_allocated", channel: "in_app", subject: "You're on {{clientName}} as {{role}}", body: "{{actor}} added you to the design team. {{note}}", variables: ["clientName", "role", "actor", "note"] },
  { code: "design.team_allocated", channel: "email", subject: "You're on {{clientName}} as {{role}}", body: "{{actor}} added you to the design team for {{clientName}} as {{role}}.\n\n{{note}}", variables: ["clientName", "role", "actor", "note"] },
  { code: "design.kickoff_booked", channel: "in_app", subject: "Kick-off with {{clientName}}", body: "{{when}} · {{place}}. Booked by {{bookedBy}}.", variables: ["clientName", "when", "place", "bookedBy"] },
  { code: "design.kickoff_booked", channel: "email", subject: "Invitation: kick-off with {{clientName}}", body: "Kick-off meeting with {{clientName}}\n\nWhen: {{when}}\nWhere: {{place}}\nBooked by: {{bookedBy}}\n\nConfirm the brief and agree the render sign-off date with the client.", variables: ["clientName", "when", "place", "bookedBy"] },
  { code: "design.site_measure_due", channel: "in_app", subject: "Design site measure · {{clientName}}", body: "Measure every wall, take the photos and answer the site visit questions by {{due}}.", variables: ["clientName", "due"] },
  { code: "design.site_measure_due", channel: "email", subject: "Design site measure: {{clientName}}", body: "The kick-off with {{clientName}} is done.\n\nMeasure every wall, take the photos and answer the site visit questions by {{due}}. Whoever on the design team is free can do it.", variables: ["clientName", "due"] },
  { code: "design.render_tagged", channel: "in_app", subject: "{{role}} · {{clientName}}", body: "{{actor}} tagged you on the renders. The client signs them off by {{due}}.", variables: ["clientName", "role", "actor", "due"] },
  { code: "design.render_tagged", channel: "email", subject: "Renders for {{clientName}}", body: "{{actor}} tagged you on the renders for {{clientName}} as {{role}}.\n\nThe client signs them off by {{due}}. Book your render time in the design calendar.", variables: ["clientName", "role", "actor", "due"] },
  { code: "design.render_signed_off", channel: "in_app", subject: "Renders signed off · {{clientName}}", body: "Signed {{signedOn}} by {{signer}}. Samples start now.", variables: ["clientName", "signedOn", "signer"] },
  { code: "design.samples_to_collect", channel: "in_app", subject: "Collect the samples · {{clientName}}", body: "Collect the samples for every room by {{due}}, from our own stock and brands first.", variables: ["clientName", "due"] },
  { code: "design.samples_to_collect", channel: "email", subject: "Collect the samples: {{clientName}}", body: "Samples for {{clientName}} start now.\n\nCollect the samples for every room by {{due}}, from our own stock and brands first. A material from a local supplier needs the reviewer's sign-off.", variables: ["clientName", "due"] },
  { code: "design.samples_collected", channel: "in_app", subject: "Samples collected · {{clientName}}", body: "Book the sample meeting with the client. {{note}}", variables: ["clientName", "note"] },
  { code: "design.sample_meeting_booked", channel: "in_app", subject: "Sample meeting with {{clientName}}", body: "{{when}} · {{place}}. Booked by {{bookedBy}}.", variables: ["clientName", "when", "place", "bookedBy"] },
  { code: "design.sample_meeting_booked", channel: "email", subject: "Invitation: sample meeting with {{clientName}}", body: "Sample meeting with {{clientName}}\n\nWhen: {{when}}\nWhere: {{place}}\nBooked by: {{bookedBy}}\n\nBring the printed renders and the samples for each room.", variables: ["clientName", "when", "place", "bookedBy"] },
  { code: "design.sample_meeting_unbooked", channel: "in_app", subject: "Book the sample meeting · {{clientName}}", body: "The sample meeting is not booked yet. Samples are due {{due}}.", variables: ["clientName", "due"] },
  { code: "design.presentation_to_review", channel: "in_app", subject: "Review {{stage}} · {{clientName}}", body: "{{actor}} prepared it. Approve it before the client sees it.", variables: ["stage", "clientName", "actor"] },
  { code: "design.presentation_to_review", channel: "email", subject: "Please review: {{stage}} for {{clientName}}", body: "{{actor}} prepared {{stage}} for {{clientName}}.\n\nApprove it before it goes to the client.", variables: ["stage", "clientName", "actor"] },
  { code: "design.presentation_reviewed", channel: "in_app", subject: "{{stage}} approved · {{clientName}}", body: "{{actor}} approved it. Show it to the client.", variables: ["stage", "clientName", "actor"] },
  // Product sourcing (plan §6.7a batch 3, E5-6): a failing fit check let through with a reason.
  { code: "sourcing.fit_override", channel: "in_app", subject: "Fit check overridden · {{item}}", body: "{{actor}} let {{item}} through for {{clientName}}: {{reason}}", variables: ["item", "clientName", "actor", "reason"] },
  { code: "change_request.raised", channel: "in_app", subject: "Change requested · {{clientName}}", body: "{{reference}} {{title}}: {{note}}", variables: ["clientName", "reference", "title", "note"] },
  { code: "change_request.raised", channel: "email", subject: "Change requested: {{clientName}}", body: "{{clientName}} asked for a change.\n\n{{reference}} {{title}}\n{{note}}\n\nAssess its impact and send it for approval.", variables: ["clientName", "reference", "title", "note"] },
  { code: "change_request.decided", channel: "in_app", subject: "{{reference}} {{decision}} · {{clientName}}", body: "{{title}}: {{note}}", variables: ["clientName", "reference", "title", "decision", "note"] },
  { code: "change_request.decided", channel: "email", subject: "{{reference}} {{decision}}: {{clientName}}", body: "{{clientName}} {{decision}} {{reference}} {{title}}.\n\n{{note}}", variables: ["clientName", "reference", "title", "decision", "note"] },
  // Changes on a started project (plan §6.20): priced, approved, sent, decided, applied; the people each step concerns.
  { code: "change_request.project_raised", channel: "in_app", subject: "{{reference}} raised · {{title}}", body: "{{actor}} raised a change on {{project}}. {{note}}", variables: ["project", "clientName", "actor", "reference", "title", "note"] },
  { code: "change_request.project_raised", channel: "email", subject: "Change raised: {{reference}} {{title}}", body: "{{actor}} raised a change on {{project}}.\n\n{{note}}\n\nPrice it and send it for approval.", variables: ["project", "clientName", "actor", "reference", "title", "note"] },
  { code: "change_request.ready", channel: "in_app", subject: "{{reference}} approved · ready to send", body: "{{actor}} approved {{title}} ({{impact}}). Send it to the client.", variables: ["project", "clientName", "actor", "reference", "title", "impact"] },
  { code: "change_request.ready", channel: "email", subject: "Ready to send: {{reference}} {{title}}", body: "{{actor}} approved {{reference}} {{title}} on {{project}}.\n\n{{impact}}\n\nSend it to the client.", variables: ["project", "clientName", "actor", "reference", "title", "impact"] },
  { code: "change_request.sent", channel: "in_app", subject: "{{reference}} sent to {{clientName}}", body: "{{title}}: {{impact}}. Waiting for their decision.", variables: ["project", "clientName", "actor", "reference", "title", "impact"] },
  { code: "change_request.sent", channel: "email", subject: "Sent to the client: {{reference}} {{title}}", body: "{{actor}} sent {{reference}} {{title}} to {{clientName}}.\n\n{{impact}}\n\nYou'll hear when they decide.", variables: ["project", "clientName", "actor", "reference", "title", "impact"] },
  { code: "change_request.invoice", channel: "in_app", subject: "Bill {{variation}} · {{clientName}}", body: "{{reference}} {{title}} on {{project}}: {{payment}}", variables: ["project", "clientName", "actor", "reference", "title", "variation", "amount", "payment"] },
  { code: "change_request.invoice", channel: "email", subject: "Variation to bill: {{variation}} · {{project}}", body: "{{clientName}} approved {{reference}} {{title}}, applied as {{variation}} ({{amount}}).\n\n{{payment}}", variables: ["project", "clientName", "actor", "reference", "title", "variation", "amount", "payment"] },
  { code: "change_request.materials", channel: "in_app", subject: "{{variation}} changes what to make or buy", body: "{{project}}: {{note}}", variables: ["project", "clientName", "actor", "reference", "title", "variation", "note"] },
  { code: "change_request.materials", channel: "email", subject: "Make or buy changes: {{variation}} · {{project}}", body: "{{reference}} {{title}} was approved and applied as {{variation}}.\n\n{{note}}\n\nPlan the work orders and orders, and check the ones listed.", variables: ["project", "clientName", "actor", "reference", "title", "variation", "note"] },
  { code: "change_request.schedule_moved", channel: "in_app", subject: "New dates · {{project}}", body: "{{reference}} {{title}}: {{note}}", variables: ["project", "clientName", "actor", "reference", "title", "variation", "note"] },
  { code: "change_request.schedule_moved", channel: "email", subject: "New dates on {{project}}", body: "{{reference}} {{title}} was approved and applied as {{variation}}.\n\n{{note}}", variables: ["project", "clientName", "actor", "reference", "title", "variation", "note"] },
  { code: "change_request.apply_blocked", channel: "in_app", subject: "{{reference}} not applied yet", body: "{{title}}: {{note}}", variables: ["project", "clientName", "actor", "reference", "title", "note"] },
  { code: "change_request.apply_blocked", channel: "email", subject: "Apply {{reference}}: {{title}}", body: "The client approved {{reference}} {{title}} on {{project}}, but it couldn't be applied by itself.\n\n{{note}}\n\nOpen it and apply it.", variables: ["project", "clientName", "actor", "reference", "title", "note"] },
  { code: "ledger.alternative_chosen", channel: "in_app", subject: "{{clientName}} chose an alternative", body: "{{title}} instead of {{previous}}.", variables: ["clientName", "title", "previous"] },
  { code: "design.client_commented", channel: "in_app", subject: "{{actor}} commented on {{item}}", body: "{{clientName}}: {{note}}", variables: ["title", "clientName", "actor", "item", "note"] },
  { code: "design.client_commented", channel: "email", subject: "New design comment · {{clientName}}", body: "{{actor}} commented on {{item}} ({{title}}):\n\n{{note}}\n\nOpen the design to reply.", variables: ["title", "clientName", "actor", "item", "note"] },
  { code: "gallery.published", channel: "in_app", subject: "Your gallery is live", body: "{{actor}} published the company gallery.", variables: ["actor"] },
  { code: "quotation.mentioned", channel: "in_app", subject: "{{actor}} mentioned you · {{title}}", body: "{{note}}", variables: ["title", "actor", "note"] },
  { code: "quotation.review_requested", channel: "in_app", subject: "Review quote {{title}} · {{clientName}}", body: "{{actor}} sent it for review.", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.review_requested", channel: "email", subject: "Please review quote {{title}} ({{clientName}})", body: "{{actor}} sent quote {{title}} for {{clientName}} for your review.", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.returned", channel: "in_app", subject: "Changes needed: {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.qs_approved", channel: "in_app", subject: "{{title}} is ready to send", body: "{{actor}} approved the estimate for {{clientName}}.", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.qs_approved", channel: "email", subject: "{{title}} is ready to send · {{clientName}}", body: "{{actor}} approved the estimate for {{title}} ({{clientName}}).\n\nOpen the quote to send it to the client.", variables: ["title", "clientName", "actor", "note"] },
  // The QS hand-off (proposals/qs-review.service.ts, PLM-082/084).
  { code: "quotation.with_qs", channel: "in_app", subject: "To price · {{title}}", body: "{{actor}} sent it to you for pricing ({{clientName}}). {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.with_qs", channel: "email", subject: "Please price {{title}} · {{clientName}}", body: "{{actor}} sent {{title}} for {{clientName}} to you for pricing.\n\n{{note}}\n\nOpen it to price the lines and confirm.", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.qs_confirmed", channel: "in_app", subject: "Priced: {{title}}", body: "{{actor}} confirmed the pricing. It can go to {{clientName}}.", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.qs_confirmed", channel: "email", subject: "{{title}} is priced · {{clientName}}", body: "{{actor}} confirmed the pricing of {{title}} ({{clientName}}).\n\nOpen it to add it to the proposal and send it to the client.", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.qs_returned", channel: "in_app", subject: "QS returned {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  // Value engineering (value-engineering/, PLM-147): the lead designer leads it with the QS; the Account Manager is copied.
  ...VALUE_ENGINEERING_TEMPLATES,
  // Client payments on a planning case (commercial/commercial-notices.ts): Finance verifies, the reporter hears back.
  { code: "commercial.receipt_reported", channel: "in_app", subject: "Payment to verify · {{clientName}}", body: "{{actor}} reported {{amount}} for {{title}}.", variables: ["title", "clientName", "actor", "amount", "note"] },
  { code: "commercial.receipt_reported", channel: "email", subject: "Payment to verify · {{clientName}}", body: "{{actor}} reported {{amount}} for {{title}} ({{clientName}}).\n\nOpen it to check the receipt and verify it.", variables: ["title", "clientName", "actor", "amount", "note"] },
  { code: "commercial.receipt_verified", channel: "in_app", subject: "Payment verified · {{clientName}}", body: "{{actor}} verified {{amount}} for {{title}}.", variables: ["title", "clientName", "actor", "amount", "note"] },
  // A sent quote running out, and one that ran out (commercial/quote-expiry.ts, Q-6).
  { code: "quotation.expiring", channel: "in_app", subject: "{{title}} expires {{due}}", body: "{{clientName}} hasn't decided yet. Follow up, or extend its validity.", variables: ["title", "clientName", "due"] },
  { code: "quotation.expired", channel: "in_app", subject: "{{title}} expired", body: "It was valid until {{due}} and {{clientName}} didn't decide. Extend its validity to send it again.", variables: ["title", "clientName", "due"] },
  { code: "quotation.expired", channel: "email", subject: "{{title}} expired", body: "{{title}} for {{clientName}} was valid until {{due}} and the client didn't decide.\n\nOpen the quote and extend its validity to send it again, or start a new revision.", variables: ["title", "clientName", "due"] },
  // A quote or design waiting on the client, on the firm's reminder days (commercial/client-decision-reminders.ts).
  { code: "commercial.decision_waiting", channel: "in_app", subject: "Waiting on the client · {{title}}", body: "{{note}}", variables: ["title", "clientName", "note"] },
  { code: "quotation.client_accepted", channel: "in_app", subject: "{{clientName}} accepted {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.client_accepted", channel: "email", subject: "{{clientName}} accepted {{title}}", body: "{{clientName}} accepted {{title}}.\n\n{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "quotation.client_changes", channel: "in_app", subject: "{{clientName}} wants changes to {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.started", channel: "in_app", subject: "Project started · {{title}}", body: "{{actor}} started {{title}} for {{clientName}}.", variables: ["title", "clientName", "actor", "role"] },
  { code: "project.started", channel: "email", subject: "You're on the team for {{title}}", body: "{{actor}} started {{title}} for {{clientName}}. You're on it as {{role}}.", variables: ["title", "clientName", "actor", "role"] },
  { code: "project.team_added", channel: "in_app", subject: "You're on {{title}} as {{role}}", body: "{{actor}} added you to {{title}}.", variables: ["title", "clientName", "actor", "role"] },
  { code: "project.team_added", channel: "email", subject: "You're on {{title}} as {{role}}", body: "{{actor}} added you to {{title}} for {{clientName}} as {{role}}.", variables: ["title", "clientName", "actor", "role"] },
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
  // A work order ready (factory/factory-ready.ts): Finance and the account manager, with the ready date and the payment stage's reminder.
  { code: "factory.order_ready", channel: "in_app", subject: "{{item}} is ready · {{project}}", body: "{{order}} was ready on {{date}}. {{payment}}", variables: ["order", "item", "project", "date", "actor", "payment"] },
  { code: "factory.order_ready", channel: "email", subject: "{{item}} is ready: {{project}}", body: "{{order}} {{item}} for {{project}} was ready on {{date}}.\n\n{{payment}}", variables: ["order", "item", "project", "date", "actor", "payment"] },
  // Everything the factory makes for a project is ready: the project manager and the delivery and installation team.
  { code: "factory.project_ready", channel: "in_app", subject: "Everything for {{project}} is made", body: "All factory items passed their checks. Schedule delivery and installation.", variables: ["order", "item", "project", "date", "actor", "payment"] },
  { code: "factory.project_ready", channel: "email", subject: "Everything for {{project}} is made", body: "Every factory item for {{project}} passed its checks on {{date}}.\n\nSchedule delivery and installation.", variables: ["order", "item", "project", "date", "actor", "payment"] },
  // Design inspections at the factory (factory/factory-inspections.ts, PLM-150): the inspecting designer (and the project
  // manager, who may attend) hears an item is ready for an inspection or a re-inspection; the factory hears the snags to
  // fix and that finishing can go ahead; the project manager hears it failed and when it can go to site; the project's
  // managers hear when nobody on the team inspects. 0326 seeds them into existing workspaces.
  ...INSPECTION_TEMPLATES,
  ...FINISH_TEMPLATES,
  // Sample requests (factory/factory-samples.ts, PLM-061): the factory hears a sample is asked for (and when it's due and not
  // ready); the person who asked and the case's designer hear it's ready.
  { code: "factory.sample_requested", channel: "in_app", subject: "Sample requested · {{sample}}", body: "{{actor}} needs it by {{date}} for {{project}}. {{note}}", variables: ["sample", "project", "date", "actor", "note"] },
  { code: "factory.sample_requested", channel: "email", subject: "Sample requested: {{sample}}", body: "{{actor}} asked the factory for {{sample}} for {{project}}, needed by {{date}}.\n\n{{note}}", variables: ["sample", "project", "date", "actor", "note"] },
  { code: "factory.sample_ready", channel: "in_app", subject: "{{sample}} is ready", body: "{{actor}} marked it ready for {{project}}. {{note}}", variables: ["sample", "project", "date", "actor", "note"] },
  { code: "factory.sample_ready", channel: "email", subject: "{{sample}} is ready", body: "{{actor}} marked {{sample}} for {{project}} ready.\n\n{{note}}", variables: ["sample", "project", "date", "actor", "note"] },
  { code: "factory.sample_due", channel: "in_app", subject: "{{sample}} is due {{date}}", body: "{{project}}: it isn't ready yet.", variables: ["sample", "project", "date", "actor", "note"] },
  // Team calendars (team-calendars/, PLM-090/091): the person tagged on render or 2D time hears it is booked; the designer
  // who booked it and the case owner hear when it runs past its day; the factory, project manager and installation team
  // hear when production, a delivery or an installation runs past its day.
  { code: "design.work_booked", channel: "in_app", subject: "{{kind}} booked · {{clientName}}", body: "{{actor}} booked {{days}} from {{date}}, due {{due}}. {{note}}", variables: ["kind", "clientName", "actor", "date", "due", "days", "note"] },
  { code: "design.work_booked", channel: "email", subject: "{{kind}} booked: {{clientName}}", body: "{{actor}} booked {{kind}} for {{clientName}}: {{days}} from {{date}}, due {{due}}.\n\n{{note}}", variables: ["kind", "clientName", "actor", "date", "due", "days", "note"] },
  { code: "design.work_overdue", channel: "in_app", subject: "{{kind}} is overdue · {{clientName}}", body: "{{person}} was due to finish it {{due}}.", variables: ["kind", "clientName", "person", "due"] },
  { code: "design.work_overdue", channel: "email", subject: "{{kind}} is overdue: {{clientName}}", body: "{{kind}} for {{clientName}} was due {{due}} ({{person}}).\n\nOpen the design calendar to catch up or move it.", variables: ["kind", "clientName", "person", "due"] },
  { code: "logistics.overdue", channel: "in_app", subject: "{{what}} is overdue · {{project}}", body: "It was due {{due}}.", variables: ["what", "project", "due"] },
  { code: "logistics.overdue", channel: "email", subject: "{{what}} is overdue: {{project}}", body: "{{what}} for {{project}} was due {{due}}.\n\nOpen the logistics calendar to catch up or move it.", variables: ["what", "project", "due"] },
  // Client update calls (client-calls/, PLM-046): the Account Manager hears the recurring call is booked in their calendar.
  { code: "client_calls.booked", channel: "in_app", subject: "Client update calls · {{clientName}}", body: "{{frequency}}, the first on {{when}}. Change or turn them off on the case.", variables: ["clientName", "frequency", "when"] },
  { code: "client_calls.booked", channel: "email", subject: "Client update calls booked: {{clientName}}", body: "Client update calls with {{clientName}} are booked in your calendar: {{frequency}}, the first on {{when}}.\n\nChange how often, or turn them off, on the case.", variables: ["clientName", "frequency", "when"] },
  // PLM-046: the client follows the work in the portal instead of calls; the Account Manager posts the update on the same cadence.
  { code: "client_calls.portal_update_due", channel: "in_app", subject: "Post a progress update · {{clientName}}", body: "They follow the work in the portal ({{frequency}}). Share an update today.", variables: ["clientName", "frequency", "when"] },
  { code: "client_calls.portal_update_due", channel: "email", subject: "Post a progress update: {{clientName}}", body: "{{clientName}} follows the work in the client portal instead of calls ({{frequency}}).\n\nShare a progress update with them today.", variables: ["clientName", "frequency", "when"] },
  { code: "client_calls.client_changed", channel: "in_app", subject: "{{clientName}} changed their updates", body: "{{choice}}", variables: ["clientName", "choice"] },
  { code: "site.report_waiting", channel: "in_app", subject: "Site report to approve · {{title}}", body: "{{actor}} reported {{note}}.", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.report_returned", channel: "in_app", subject: "Your site report came back · {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.incident", channel: "in_app", subject: "Incident on site · {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.incident", channel: "email", subject: "Incident on site · {{title}}", body: "{{actor}} reported an incident on {{title}}:\n\n{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.blocked", channel: "in_app", subject: "The site is blocked · {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.report_missing", channel: "in_app", subject: "No site report today · {{title}}", body: "Add today's report before the end of the day.", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.report_overdue", channel: "in_app", subject: "No site report yesterday · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  // Daily progress (site/): the author hears the approval; the manager hears what went out by itself, material needed
  // on site, and the client's reactions and questions on a sent day.
  { code: "site.report_late", channel: "in_app", subject: "No site report today · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.report_approved", channel: "in_app", subject: "Your report was approved · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.report_sent", channel: "in_app", subject: "{{title}}: the daily progress went to the client", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  // PLM-065: installation signed off (site work finished) while the payment due before installation is owed: Finance and the account manager.
  { code: "site.installation_owed", channel: "in_app", subject: "Installation signed off with money owed · {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.installation_owed", channel: "email", subject: "Installation signed off with money owed · {{title}}", body: "{{actor}} signed off the installation on {{title}} before it was paid.\n\n{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.material_requested", channel: "in_app", subject: "Material needed on site · {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  // A day card's issue: given to its owner, and resolved (to whoever reported it and its owner).
  { code: "site.issue_assigned", channel: "in_app", subject: "A site issue is yours · {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.issue_resolved", channel: "in_app", subject: "Site issue resolved · {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.client_reacted", channel: "in_app", subject: "{{actor}} reacted to the daily progress · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.client_question", channel: "in_app", subject: "{{actor}} asked about the daily progress · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.client_question", channel: "email", subject: "{{actor}} asked about the daily progress · {{title}}", body: "{{actor}} asked about the daily progress on {{title}}:\n\n{{note}}\n\nAnswer in the conversation on the project.", variables: ["title", "clientName", "actor", "note"] },
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
  // D-29 (site/site-access.ts): the client's answer about site access reaches the site supervisor and the project manager.
  { code: "site.access_confirmed", channel: "in_app", subject: "{{actor}} confirmed site access · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.access_move_asked", channel: "in_app", subject: "{{actor}} asked to move a delivery · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.access_move_asked", channel: "email", subject: "{{actor}} asked to move a delivery · {{title}}", body: "{{actor}} asked in the client portal to move a delivery:\n\n{{note}}\n\nReschedule it with the supplier, or confirm the day with the client.", variables: ["title", "clientName", "actor", "note"] },
  { code: "site.delivery_moved", channel: "in_app", subject: "Delivery moved · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "warranty.expiring", channel: "in_app", subject: "Warranty ending soon · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.over_budget", channel: "in_app", subject: "Over budget · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.cancelled", channel: "in_app", subject: "{{title}} is cancelled", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.cancelled", channel: "email", subject: "{{title}} is cancelled", body: "{{actor}} cancelled {{title}} for {{clientName}}.\n\n{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.completed", channel: "in_app", subject: "{{title}} is complete", body: "{{actor}} finished the last stage.", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.finished_automatically", channel: "in_app", subject: "{{title}} is complete", body: "{{clientName}} accepted the handover, so {{note}} and the project finished by themselves.", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.reopened", channel: "in_app", subject: "{{title}} is open again", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.materials_signed_off", channel: "in_app", subject: "{{title}}: material list signed off", body: "{{clientName}} signed off {{revision}}.", variables: ["title", "clientName", "actor", "revision"] },
  { code: "project.materials_changes", channel: "in_app", subject: "{{title}}: changes to the material list", body: "{{clientName}} asked for changes to {{revision}}: {{note}}", variables: ["title", "clientName", "actor", "revision", "note"] },
  { code: "project.variation_applied", channel: "in_app", subject: "{{title}}: {{variation}} applied", body: "{{actor}} applied {{variation}} ({{amount}}).", variables: ["title", "clientName", "actor", "variation", "amount"] },
  // PLM-161 / PLM-167 / PLM-168 (0357 seeds them into existing workspaces): the BOQ's steps, each to its next owner.
  { code: "project.boq_draft_ready", channel: "in_app", subject: "BOQ to verify · {{title}}", body: "The draft BOQ for {{clientName}} is ready for the technical check. {{note}}", variables: ["title", "clientName", "actor", "revision", "note"] },
  { code: "project.boq_draft_ready", channel: "email", subject: "BOQ to verify: {{title}}", body: "The draft BOQ for {{title}} ({{clientName}}) is ready for the technical check.\n\n{{note}}\n\nOpen the project's Scope tab and verify it once the quantities and specifications are right.", variables: ["title", "clientName", "actor", "revision", "note"] },
  { code: "project.boq_verified", channel: "in_app", subject: "BOQ for QS approval · {{title}}", body: "{{actor}} verified the BOQ. It waits for your approval. {{note}}", variables: ["title", "clientName", "actor", "revision", "note"] },
  { code: "project.boq_verified", channel: "email", subject: "BOQ for QS approval: {{title}}", body: "{{actor}} verified the BOQ for {{title}} ({{clientName}}).\n\nIt waits for your approval on the project's Scope tab. {{note}}", variables: ["title", "clientName", "actor", "revision", "note"] },
  { code: "project.boq_approved", channel: "in_app", subject: "BOQ approved {{revision}} · {{title}}", body: "{{actor}} approved the BOQ as {{revision}}. Ordering can go ahead. {{note}}", variables: ["title", "clientName", "actor", "revision", "note"] },
  { code: "project.boq_returned", channel: "in_app", subject: "BOQ returned to draft · {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "revision", "note"] },
  { code: "project.boq_locked", channel: "in_app", subject: "BOQ locked {{revision}} · {{title}}", body: "{{actor}} locked the BOQ. A change is a variation from here.", variables: ["title", "clientName", "actor", "revision", "note"] },
  { code: "project.ready_to_start", channel: "in_app", subject: "Ready to start · {{title}}", body: "The upfront payment for {{clientName}} is verified. Start the project: {{note}}", variables: ["title", "clientName", "actor", "revision", "note"] },
  // Delivery reminders (the daily run): the week in numbers, a stage whose checks all pass, a material list
  // left with the client, a milestone to invoice and the drafted client update.
  { code: "project.weekly_summary", channel: "in_app", subject: "This week on {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.weekly_summary", channel: "email", subject: "This week on {{title}}", body: "{{note}}\n\nOpen the project to see what needs you.", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.stage_ready", channel: "in_app", subject: "{{stage}} can be finished · {{title}}", body: "Everything it needs is done.", variables: ["title", "clientName", "actor", "stage", "note"] },
  { code: "project.materials_waiting", channel: "in_app", subject: "Material list waiting on the client · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.milestone_due", channel: "in_app", subject: "To invoice · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.client_update_ready", channel: "in_app", subject: "Client update to approve · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.client_update_auto_sent", channel: "in_app", subject: "{{title}}: the client update went out", body: "Nobody sent or discarded it within {{note}}, so it went to the client by itself.", variables: ["title", "clientName", "actor", "note"] },
  // Technical drawings to production release (project-core/project-drawings.ts, project-release.ts): who starts the
  // project, the technical team, the factory.
  { code: "project.ready_to_start", channel: "in_app", subject: "Ready to start · {{title}}", body: "{{actor}} approved the deal. Name the project manager and start the project.", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.ready_to_start", channel: "email", subject: "Ready to start: {{title}}", body: "{{actor}} approved the deal for {{clientName}}.\n\nName the project manager and start the project.", variables: ["title", "clientName", "actor", "note"] },
  { code: "project.drawings_changes", channel: "in_app", subject: "Drawings {{revision}} need changes · {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "revision", "note", "date"] },
  { code: "project.drawings_approved", channel: "in_app", subject: "Drawings approved · {{title}}", body: "{{clientName}} approved drawings {{revision}} on {{date}}. The drawings, material list and BOQ are in the project.", variables: ["title", "clientName", "actor", "revision", "note", "date"] },
  { code: "project.drawings_approved", channel: "email", subject: "Drawings approved: {{title}}", body: "{{clientName}} approved drawings {{revision}} on {{date}}.\n\nThe approved drawings, the material list and the BOQ are in the project, read-only.", variables: ["title", "clientName", "actor", "revision", "note", "date"] },
  { code: "project.factory_slot_due", channel: "in_app", subject: "Book the factory slot · {{title}}", body: "The deposit is in and the project is released. Record the slot date on the project.", variables: ["title", "clientName", "actor", "revision", "note", "date"] },
  { code: "project.factory_slot_due", channel: "email", subject: "Book the factory slot: {{title}}", body: "The deposit for {{clientName}} is in and the project is released.\n\nBook the factory slot and record its date on the project.", variables: ["title", "clientName", "actor", "revision", "note", "date"] },
  { code: "project.factory_slot_booked", channel: "in_app", subject: "Factory slot booked · {{title}}", body: "{{actor}} booked the factory for {{date}}.", variables: ["title", "clientName", "actor", "revision", "note", "date"] },
  // Key moments the roles in Settings → Projects → Keep informed hear (PLM-055: the designer), and installation scheduled
  // for the installation team and the project manager (PLM-069) (project-core/project-keep-informed.ts).
  { code: "project.drawings_started", channel: "in_app", subject: "Technical drawings started · {{title}}", body: "The technical team started the drawings. Add any product details they need to the material list.", variables: ["title", "clientName", "actor", "date", "note"] },
  { code: "project.drawings_started", channel: "email", subject: "Technical drawings started: {{title}}", body: "The technical team started the drawings for {{clientName}}.\n\nAdd any product details they need to the material list.", variables: ["title", "clientName", "actor", "date", "note"] },
  { code: "project.production_started", channel: "in_app", subject: "Production started · {{title}}", body: "{{actor}} started production on {{date}}.", variables: ["title", "clientName", "actor", "date", "note"] },
  { code: "project.production_started", channel: "email", subject: "Production started: {{title}}", body: "{{actor}} started production for {{clientName}} on {{date}}.", variables: ["title", "clientName", "actor", "date", "note"] },
  { code: "project.installation_scheduled", channel: "in_app", subject: "Installation on {{date}} · {{title}}", body: "{{actor}} scheduled the installation for {{date}}. {{note}}", variables: ["title", "clientName", "actor", "date", "note"] },
  { code: "project.installation_scheduled", channel: "email", subject: "Installation on {{date}}: {{title}}", body: "{{actor}} scheduled the installation for {{clientName}} on {{date}}.\n\n{{note}}", variables: ["title", "clientName", "actor", "date", "note"] },
  // Product details the design team adds to a material for the technical team.
  { code: "project.material_details", channel: "in_app", subject: "Product details for {{item}} · {{title}}", body: "{{actor}}: {{note}}", variables: ["title", "clientName", "actor", "item", "note"] },
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
  // The Ledger (books/posting/issues.ts): people who manage it, once when an event can't post yet.
  { code: "books.posting_blocked", channel: "in_app", subject: "Ledger needs attention · {{source}}", body: "{{note}}", variables: ["source", "note"] },
  { code: "receivables.overdue", channel: "in_app", subject: "Client invoice overdue: {{invoice}}", body: "{{note}}", variables: ["invoice", "client", "amount", "actor", "note"] },
  { code: "receivables.credited", channel: "in_app", subject: "Invoice credited: {{invoice}}", body: "{{note}}", variables: ["invoice", "client", "amount", "actor", "note"] },
  { code: "payables.held", channel: "in_app", subject: "Supplier invoice held: {{supplier}} {{invoice}}", body: "{{note}}", variables: ["supplier", "invoice", "amount", "actor", "note"] },
  { code: "payables.due", channel: "in_app", subject: "Supplier invoices due · {{supplier}}", body: "{{note}}", variables: ["supplier", "invoice", "amount", "actor", "note"] },
  { code: "payables.retention_released", channel: "in_app", subject: "Retention to pay · {{supplier}}", body: "{{note}}", variables: ["supplier", "invoice", "amount", "actor", "note"] },
  { code: "books.capture_read", channel: "in_app", subject: "{{title}}", body: "{{note}}", variables: ["title", "note"] },
  { code: "payables.run_submitted",channel: "in_app", subject: "Payment run {{run}} needs your approval", body: "{{actor}} prepared {{amount}}.", variables: ["run", "amount", "actor", "note"] },
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
  // Finance requests (finance-requests/finance-request-notices.ts): Finance and its inbox on a submission, the requester on a note, Done or a rejection.
  { code: "finance_request.submitted", channel: "in_app", subject: "{{kind}} request {{reference}} · {{client}}", body: "{{actor}} asks for {{amount}}. {{note}}", variables: ["reference", "kind", "client", "amount", "project", "actor", "note"] },
  { code: "finance_request.submitted", channel: "email", subject: "{{kind}} request {{reference}} · {{client}}", body: "{{actor}} asks Finance for {{amount}}.\n\n{{project}}\n\n{{note}}", variables: ["reference", "kind", "client", "amount", "project", "actor", "note"] },
  { code: "finance_request.answered", channel: "in_app", subject: "{{reference}} is back with you", body: "{{actor}}: {{note}}", variables: ["reference", "kind", "client", "amount", "project", "actor", "note"] },
  { code: "finance_request.needs_info", channel: "in_app", subject: "Finance needs more on {{reference}}", body: "{{actor}}: {{note}}", variables: ["reference", "kind", "client", "amount", "project", "actor", "note"] },
  { code: "finance_request.needs_info", channel: "email", subject: "Finance needs more on {{reference}}", body: "{{actor}} sent your {{kind}} request for {{client}} back: {{note}}\n\nOpen it to add what is missing and send it again.", variables: ["reference", "kind", "client", "amount", "project", "actor", "note"] },
  { code: "finance_request.approved", channel: "in_app", subject: "{{reference}} is approved", body: "{{kind}} for {{client}}, {{amount}}: ready to process.", variables: ["reference", "kind", "client", "amount", "project", "actor", "note"] },
  { code: "finance_request.done", channel: "in_app", subject: "{{reference}} is done", body: "{{kind}} for {{client}}, {{amount}}. {{note}}", variables: ["reference", "kind", "client", "amount", "project", "actor", "note"] },
  { code: "finance_request.done", channel: "email", subject: "{{reference}} is done", body: "{{actor}} completed the {{kind}} request for {{client}} ({{amount}}).\n\n{{note}}", variables: ["reference", "kind", "client", "amount", "project", "actor", "note"] },
  { code: "finance_request.rejected", channel: "in_app", subject: "{{reference}} was rejected", body: "{{actor}}: {{note}}", variables: ["reference", "kind", "client", "amount", "project", "actor", "note"] },
  { code: "finance_request.rejected", channel: "email", subject: "{{reference}} was rejected", body: "{{actor}} rejected the {{kind}} request for {{client}}: {{note}}", variables: ["reference", "kind", "client", "amount", "project", "actor", "note"] },
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
  { code: "stock.transfer_rejected", channel: "in_app", subject: "Move {{transfer}}: goods refused at {{to}}", body: "{{actor}}: {{note}}. They're on their way back.", variables: ["transfer", "from", "to", "actor", "note"] },
  { code: "stock.low", channel: "in_app", subject: "Stock is low: {{item}}", body: "{{note}}", variables: ["item", "place", "note"] },
  { code: "stock.low", channel: "email", subject: "Stock is low: {{item}}", body: "{{note}}", variables: ["item", "place", "note"] },
  // PLM-125/126: a deal's stock and its fulfilment.
  { code: "stock.sale_short", channel: "in_app", subject: "Not enough {{item}} · {{deal}}", body: "{{note}}", variables: ["item", "deal", "note"] },
  { code: "stock.sale_short", channel: "email", subject: "Not enough {{item}} in stock: {{deal}}", body: "{{deal}} took {{item}} from stock, but there wasn't enough.\n\n{{note}}", variables: ["item", "deal", "note"] },
  { code: "fulfilment.transfer_requested", channel: "in_app", subject: "Send to the showroom · {{deal}}", body: "{{actor}} asked for {{items}}. {{note}}", variables: ["deal", "actor", "items", "note"] },
  { code: "fulfilment.transfer_requested", channel: "email", subject: "Transfer request: {{deal}}", body: "{{actor}} asked the factory to send {{items}} for {{deal}}.\n\n{{note}}", variables: ["deal", "actor", "items", "note"] },
  { code: "fulfilment.delivery_booked", channel: "in_app", subject: "Delivery {{date}} · {{deal}}", body: "{{actor}} booked the delivery. {{note}}", variables: ["deal", "actor", "date", "note"] },
  { code: "fulfilment.delivery_booked", channel: "email", subject: "Delivery booked for {{date}}: {{deal}}", body: "{{actor}} booked the delivery of {{deal}} for {{date}}.\n\n{{note}}", variables: ["deal", "actor", "date", "note"] },
  { code: "fulfilment.order_arrived", channel: "in_app", subject: "In for {{deal}}", body: "{{items}} arrived from the supplier. Arrange the collection or delivery.", variables: ["deal", "items"] },
  { code: "fulfilment.order_arrived", channel: "email", subject: "The supplier order arrived: {{deal}}", body: "{{items}} arrived for {{deal}}.\n\nArrange the collection or delivery with the client.", variables: ["deal", "items"] },
  { code: "fulfilment.late", channel: "in_app", subject: "Late · {{deal}}", body: "It was expected by {{date}}.", variables: ["deal", "date"] },
  { code: "fulfilment.late", channel: "email", subject: "Late: {{deal}}", body: "{{deal}} was expected with the client by {{date}} and isn't collected or delivered yet.", variables: ["deal", "date"] },
  // Factory and installation bookings (logistics/): the project's managers and installation team.
  { code: "logistics.booked", channel: "in_app", subject: "{{what}} on {{date}} · {{project}}", body: "{{actor}} booked it. {{crew}}", variables: ["what", "project", "date", "actor", "crew"] },
  { code: "logistics.booked", channel: "email", subject: "{{what}} on {{date}}: {{project}}", body: "{{actor}} booked {{what}} for {{project}} on {{date}}.\n\n{{crew}}", variables: ["what", "project", "date", "actor", "crew"] },
  { code: "logistics.permit_collected", channel: "in_app", subject: "Building permit collected · {{project}}", body: "Permit {{number}}, valid {{from}} to {{to}}.", variables: ["project", "number", "from", "to", "actor"] },
  { code: "logistics.permit_missing", channel: "in_app", subject: "No building permit for {{what}} · {{project}}", body: "Collect it before {{what}} on {{date}}.", variables: ["project", "what", "date", "until"] },
  { code: "logistics.permit_missing", channel: "email", subject: "No building permit for {{what}}: {{project}}", body: "There is no building permit for {{project}} yet for {{what}} on {{date}}.\n\nCollect it first: the building can't be entered without it.", variables: ["project", "what", "date", "until"] },
  { code: "logistics.permit_expiring", channel: "in_app", subject: "The building permit ends before {{what}} · {{project}}", body: "It is valid until {{until}}, before {{what}} on {{date}}.", variables: ["project", "what", "date", "until"] },
  { code: "logistics.permit_expiring", channel: "email", subject: "The building permit ends before {{what}}: {{project}}", body: "The building permit for {{project}} is valid until {{until}}, before {{what}} on {{date}}.\n\nRenew the permit or move the day.", variables: ["project", "what", "date", "until"] },
  // PLM-136: each permit reminds once, its own days before it ends (the firm's default, or the permit's).
  { code: "logistics.permit_renewal", channel: "in_app", subject: "The building permit ends on {{until}} · {{project}}", body: "Permit {{number}}. Renew it if the work still needs it.", variables: ["project", "number", "until", "type"] },
  { code: "logistics.permit_renewal", channel: "email", subject: "The building permit ends on {{until}}: {{project}}", body: "Building permit {{number}} for {{project}} ends on {{until}}.\n\nRenew it if the work still needs it, and record the new permit.", variables: ["project", "number", "until", "type"] },
  // A linked spreadsheet (inventory stock list, catalogue) that didn't refresh or left rows out: its owner (linked-imports).
  { code: "linked_import.failed", channel: "in_app", subject: "{{name}} didn't refresh", body: "{{note}}", variables: ["name", "note"] },
  { code: "linked_import.failed", channel: "email", subject: "{{name}} didn't refresh", body: "{{note}}\n\nOpen the import to check the link.", variables: ["name", "note"] },
  { code: "linked_import.row_errors", channel: "in_app", subject: "{{name}}: some rows weren't imported", body: "{{note}}", variables: ["name", "note"] },
  { code: "purchasing.shipment_late", channel: "in_app", subject: "{{order}} arrives later", body: "{{supplier}}: {{note}}", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.blocking_work", channel: "in_app", subject: "{{order}} is holding up work", body: "{{supplier}}: {{note}}", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "purchasing.over_ordered", channel: "in_app", subject: "{{variation}} leaves orders past what {{project}} needs", body: "{{note}}", variables: ["variation", "project", "note"] },
  // Everything a project buys is in (purchasing/materials-ready.ts): its manager and production lead, once per set of lines.
  { code: "purchasing.materials_ready", channel: "in_app", subject: "Materials are in for {{project}}", body: "All {{lines}} lines are received.", variables: ["project", "lines"] },
  { code: "purchasing.materials_ready", channel: "email", subject: "Materials are in for {{project}}", body: "Everything {{project}} buys is received: {{lines}} lines.\n\nPlan production and site work.", variables: ["project", "lines"] },
  { code: "purchasing.hold_override", channel: "in_app", subject: "{{order}} goes ahead while its project is on hold", body: "{{actor}}: {{note}}", variables: ["order", "supplier", "amount", "actor", "note"] },
  // PLM-159: the QS signed off the draft order; the buyer who raised it hears it can be placed.
  { code: "purchasing.qs_signed_off", channel: "in_app", subject: "{{order}} signed off by the QS", body: "{{actor}} signed off {{order}} to {{supplier}} ({{amount}}). It can be placed.", variables: ["order", "supplier", "amount", "actor", "note"] },
  { code: "factory.rework", channel: "in_app", subject: "{{order}} goes back into production", body: "{{note}}", variables: ["order", "item", "project", "actor", "note"] },
  { code: "factory.drawing_stale", channel: "in_app", subject: "{{order}}: its drawing has a newer revision", body: "{{note}}", variables: ["order", "item", "project", "actor", "note"] },
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
  // "File into job": the job's owner hears that a chat now belongs to their job (crm-inbox.service.ts fileIntoJob).
  { code: "crm.inbox_filed", channel: "in_app", subject: "A chat with {{clientName}} is in {{job}}", body: "{{actor}} filed it into your job. New messages from them reach you here.", variables: ["clientName", "job", "actor"] },
  // A message someone scheduled ("Send later") could not go at its time: they are told why.
  { code: "crm.inbox_scheduled_cancelled", channel: "in_app", subject: "{{clientName}} replied first", body: "Your scheduled message was cancelled so it doesn't land on top of their reply: \"{{preview}}\"", variables: ["clientName", "preview"] },
  { code: "crm.inbox_scheduled_failed", channel: "in_app", subject: "Your message to {{clientName}} wasn't sent", body: "{{reason}}", variables: ["clientName", "reason"] },
  // Client portal notices (client-portal/portal-notices.ts): to client contacts, by email.
  { code: "portal.quote_issued", channel: "email", subject: "{{title}} is ready for you", body: "{{company}} sent you {{title}} for {{project}}.\n\nOpen your project page to read it and give your decision.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.payment_due", channel: "email", subject: "Payment reminder · {{title}}", body: "A reminder from {{company}}: {{title}} for {{project}} is due. {{due}}\n\nOpen your project page to see it and pay.", variables: ["company", "project", "title", "due", "note"] },
  { code: "receivables.payment_overdue", channel: "in_app", subject: "{{client}} hasn't paid {{title}}", body: "A week past due. Reminders sent: {{count}}.", variables: ["client", "title", "count"] },
  { code: "portal.invoice_issued", channel: "email", subject: "Invoice {{title}} from {{company}}", body: "{{company}} issued invoice {{title}} for {{project}}. {{due}}\n\nOpen your project page to see it and what's left to pay.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.decision_waiting", channel: "email", subject: "{{title}} is waiting for your decision", body: "{{company}} needs your decision on {{title}} for {{project}}. {{due}}\n\nOpen your project page to review it.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.update_published", channel: "email", subject: "New update on {{project}}", body: "{{note}}\n\nOpen your project page to see the progress.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.daily_progress", channel: "email", subject: "{{project}} · {{title}}", body: "{{note}}\n\nOpen your project page to see the photos.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.weekly_rollup", channel: "email", subject: "{{project}} · {{title}}", body: "{{note}}\n\nOpen your project page to see every day of the week.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.team_replied", channel: "email", subject: "{{company}} replied on {{project}}", body: "{{note}}\n\nOpen your project page to read it and reply.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.payment_checked", channel: "email", subject: "Your payment on {{project}}", body: "{{note}}\n\nOpen your project page to see your payments.", variables: ["company", "project", "title", "due", "note"] },
  { code: "portal.issue_triaged", channel: "email", subject: "The issue you reported on {{project}}", body: "{{note}}\n\nOpen your project page to follow it.", variables: ["company", "project", "title", "due", "note"] },
  // PLM-153: the minutes of a client meeting shared in the portal (the client); the client's comment on them (the author).
  { code: "portal.minutes_shared", channel: "email", subject: "Notes from your meeting · {{project}}", body: "{{company}} shared the notes from {{title}}.\n\n{{note}}\n\nOpen your project page to read them and comment.", variables: ["company", "project", "title", "due", "note"] },
  { code: "meeting.minutes_comment", channel: "in_app", subject: "{{actor}} commented on the minutes · {{title}}", body: "{{note}}", variables: ["title", "clientName", "actor", "note"] },
  { code: "meeting.minutes_comment", channel: "email", subject: "{{actor}} commented on the minutes of {{title}}", body: "{{actor}} commented on the minutes of {{title}} in the client portal:\n\n{{note}}\n\nOpen the meeting to reply.", variables: ["title", "clientName", "actor", "note"] },
  // PLM-155: a timeline question (the person asked), then its answer (the Account Manager, who replies to the client today).
  { code: "crm.timeline_question", channel: "in_app", subject: "Timeline question · {{client}}", body: "{{actor}} asks: {{question}} Answer by {{due}}.", variables: ["client", "actor", "question", "due", "opportunity"] },
  { code: "crm.timeline_question", channel: "email", subject: "Timeline question for {{client}}", body: "{{actor}} asks about {{opportunity}}:\n\n{{question}}\n\nAnswer in Wodana by {{due}}, so they can reply to the client the same day.", variables: ["client", "actor", "question", "due", "opportunity"] },
  { code: "crm.timeline_answered", channel: "in_app", subject: "Timeline answer · {{client}}", body: "{{actor}}: {{answer}} Reply to the client today.", variables: ["client", "actor", "answer", "opportunity"] },
  { code: "crm.timeline_answered", channel: "email", subject: "Timeline answer for {{client}}", body: "{{actor}} answered your timeline question on {{opportunity}}:\n\n{{answer}}\n\nReply to the client today.", variables: ["client", "actor", "answer", "opportunity"] },
  // D-29: a delivery to site is coming; the client confirms someone lets the team in, or asks to move it.
  { code: "portal.site_access", channel: "email", subject: "Confirm site access for {{title}}", body: "{{company}} has a delivery for {{project}} on {{title}}: {{note}}\n\nOpen your project page to confirm someone can let the team in, or ask to move it.", variables: ["company", "project", "title", "due", "note"] },
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
  // AI credits (ai-gateway/ai-credits.ts): owners and administrators, once when credits run low and once when they run out.
  { code: "ai.credits_low", channel: "in_app", subject: "AI credits are running low", body: "{{balance}} credits left. Contact support to top up.", variables: ["balance"] },
  { code: "ai.credits_low", channel: "email", subject: "AI credits are running low", body: "Your workspace has {{balance}} AI credits left.\n\nContact support to top up before they run out. Woddy and AI suggestions pause when credits are used up.", variables: ["balance"] },
  { code: "ai.credits_exhausted", channel: "in_app", subject: "AI credits are used up", body: "Woddy and AI suggestions are paused. Contact support to top up.", variables: ["balance"] },
  { code: "ai.credits_exhausted", channel: "email", subject: "AI credits are used up", body: "Your workspace has used all of its AI credits.\n\nWoddy and AI suggestions are paused until credits are topped up. Contact support to top up.", variables: ["balance"] },
  // View as (auth/view-as): the person an owner or administrator viewed as, once the view ends (a workspace setting, on by default).
  { code: "workspace.viewed_as", channel: "in_app", subject: "{{viewerName}} viewed as you", body: "Read-only, {{minutes}} min from {{startedAt}}. Security lists every view.", variables: ["viewerName", "minutes", "startedAt"] },
  // Ledger (books/settings, books/journals): the lock date moved (everyone who sets up the Ledger); a manual journal decided (its preparer).
  { code: "books.lock_date_changed", channel: "in_app", subject: "{{company}} · books locked up to {{lockDate}}", body: "{{actor}} changed the lock date. It was {{previous}}.", variables: ["company", "lockDate", "previous", "actor"] },
  { code: "books.lock_date_changed", channel: "email", subject: "{{company}} · books locked up to {{lockDate}}", body: "{{actor}} changed the Ledger lock date for {{company}} to {{lockDate}}. It was {{previous}}.\n\nNothing dated on or before the lock date can be entered by hand.", variables: ["company", "lockDate", "previous", "actor"] },
  { code: "books.journal_decided", channel: "in_app", subject: "{{reference}} · {{outcome}}", body: "{{actor}}: {{note}}", variables: ["reference", "company", "outcome", "note", "actor"] },
  { code: "books.journal_decided", channel: "email", subject: "{{reference}} · {{outcome}}", body: "{{actor}} {{outcome}} your journal {{reference}} for {{company}}.\n\n{{note}}", variables: ["reference", "company", "outcome", "note", "actor"] },
  // Ledger statements (books/statements): where a company's P&L and cash flow come from changed (everyone who sets up the Ledger).
  { code: "books.statement_source_changed", channel: "in_app", subject: "{{company}} · statements from {{source}}", body: "{{actor}} changed where statements come from. It was {{previous}}.", variables: ["company", "source", "previous", "actor"] },
  { code: "books.statement_source_changed", channel: "email", subject: "{{company}} · statements from {{source}}", body: "{{actor}} changed where the profit and loss and cash flow of {{company}} come from: {{source}}. It was {{previous}}.", variables: ["company", "source", "previous", "actor"] },
  // AI apps (mcp): the person who connected a new AI app, in the app and by email, in case it wasn't them.
  { code: "ai.app_connected", channel: "in_app", subject: "{{appName}} connected to your account", body: "It can {{access}} as you. Revoke it in AI apps if this wasn't you.", variables: ["appName", "access"] },
  { code: "ai.app_connected", channel: "email", subject: "{{appName}} connected to your account", body: "{{appName}} can now {{access}} as you.\n\nIf this wasn't you, revoke it in Settings → AI apps and change your password.", variables: ["appName", "access"] },
  ...REMINDER_TEMPLATES,
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
 * `critical` (R13) ignores the person's mutes and marks the notice critical.
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
  critical?: boolean;
}) {
  const critical = input.critical === true;
  const preference = await db.query<{ enabled: boolean }>(
    `SELECT enabled FROM notification_preferences
     WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='in_app'
       AND event_type::text IN ($3::text, split_part($3::text, '.', 1) || '.*', '*')
     ORDER BY CASE WHEN event_type::text=$3::text THEN 0 WHEN event_type::text='*' THEN 2 ELSE 1 END LIMIT 1`,
    [input.workspaceId, input.recipientUserId, input.eventType],
  );
  if (!critical && preference.rows[0]?.enabled === false) return { queued: false as const, reason: "recipient_preference" };
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
       subject, body, deep_link, idempotency_key, correlation_id, delivered_at, critical)
     VALUES ($1, $2, 'user', $3, 'in_app', $4, 'delivered', $5, $6, $7, $8, gen_random_uuid(), now(), $9)
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
    [input.workspaceId, row.id, input.recipientUserId, input.eventType, subject, body, input.deepLink ?? null, input.idempotencyKey, critical],
  );
  // A key already used means this notice was already sent: nothing new is queued.
  if (!inserted.rowCount) return { queued: false as const, reason: "already_sent" };
  // The same notice on the phone, for the events people act on away from a desk.
  if (PUSH_NOTICES.has(input.code)) {
    // Keys are at most 160 characters; a long one is hashed rather than cut.
    const pushKey = input.idempotencyKey.length <= 155 ? `${input.idempotencyKey}:push` : `push:${createHash("sha256").update(input.idempotencyKey).digest("hex")}`;
    await queueUserPush(db, { workspaceId: input.workspaceId, recipientUserId: input.recipientUserId, eventType: input.eventType, subject, body, deepLink: input.deepLink, templateId: row.id, idempotencyKey: pushKey, critical });
  }
  return { queued: true as const };
}

/**
 * Queues a push to one user's phone from the workspace's approved push template, inside the caller's
 * tenant transaction. Only when the person turned push on and has a registered device; the in-app
 * notice is always the record. The worker delivers it (and falls back to the inbox on failure).
 * `critical` (R13) ignores the person's mutes of this event or its module, never the phone's own switch.
 */
export async function queueUserPushFromTemplate(db: Db, input: {
  workspaceId: string;
  recipientUserId: string;
  code: string;
  eventType: string;
  variables: Record<string, string>;
  deepLink?: string;
  idempotencyKey: string;
  critical?: boolean;
}) {
  const critical = input.critical === true;
  const reachable = await db.query(
    `SELECT 1 FROM notification_preferences preference
      WHERE preference.workspace_id=$1 AND preference.recipient_type='user' AND preference.recipient_id=$2
        AND preference.channel='push' AND preference.event_type='*' AND preference.enabled
        AND EXISTS (SELECT 1 FROM device_endpoints endpoint WHERE endpoint.workspace_id=$1 AND endpoint.user_id=$2 AND endpoint.status='active')
        AND ($4::boolean OR NOT EXISTS (SELECT 1 FROM notification_preferences muted WHERE muted.workspace_id=$1 AND muted.recipient_type='user'
          AND muted.recipient_id=$2 AND muted.channel='push' AND muted.event_type::text IN ($3::text, split_part($3::text, '.', 1) || '.*') AND NOT muted.enabled))
      LIMIT 1`,
    [input.workspaceId, input.recipientUserId, input.eventType, critical],
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
       scheduled_for, subject, body, deep_link, idempotency_key, correlation_id, critical)
     VALUES ($1, $2, 'user', $3, 'push', $4, 'pending', now(), $5, $6, $7, $8, gen_random_uuid(), $9)
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
     RETURNING id, correlation_id AS "correlationId"`,
    [input.workspaceId, row.id, input.recipientUserId, input.eventType,
      row.subject ? renderNoticeText(row.subject, input.variables) : null, renderNoticeText(row.body, input.variables),
      input.deepLink ?? null, input.idempotencyKey, critical],
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
 * Sent unless the person switched this event off; `critical` (R13) ignores that. Idempotent per key.
 */
export async function queueUserEmail(db: Db, input: {
  workspaceId: string;
  recipientUserId: string;
  code: string;
  eventType: string;
  variables: Record<string, string>;
  deepLink?: string;
  idempotencyKey: string;
  critical?: boolean;
}) {
  const critical = input.critical === true;
  const preference = await db.query<{ enabled: boolean }>(
    `SELECT enabled FROM notification_preferences
     WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='email'
       AND event_type::text IN ($3::text, split_part($3::text, '.', 1) || '.*', '*')
     ORDER BY CASE WHEN event_type::text=$3::text THEN 0 WHEN event_type::text='*' THEN 2 ELSE 1 END LIMIT 1`,
    [input.workspaceId, input.recipientUserId, input.eventType],
  );
  if (!critical && preference.rows[0]?.enabled === false) return { queued: false as const, reason: "recipient_preference" };
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
       scheduled_for, subject, body, deep_link, idempotency_key, correlation_id, critical)
     VALUES ($1, $2, 'user', $3, 'email', $4, 'pending', now(), $5, $6, $7, $8, gen_random_uuid(), $9)
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
     RETURNING id, correlation_id AS "correlationId"`,
    [input.workspaceId, row.id, input.recipientUserId, input.eventType,
      row.subject ? renderNoticeText(row.subject, input.variables) : null, renderNoticeText(row.body, input.variables),
      input.deepLink ?? null, input.idempotencyKey, critical],
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
  "site.report_missing", "site.report_returned", "site.incident", "site.blocked", "site.access_move_asked", "site.delivery_moved",
  "site.report_waiting", "site.report_late", "site.material_requested", "site.client_question", "site.issue_assigned",
  "work.assigned", "work.overdue", "work.snag_reopened",
  "factory.released", "factory.check_failed", "factory.material_short", "factory.rework", "factory.sample_requested",
  "factory.inspection_ready", "factory.reinspection_ready", "factory.inspection_snags", "factory.inspection_failed",
  "purchasing.late", "purchasing.order_late", "purchasing.inspection_needed", "purchasing.blocking_work", "purchasing.materials_ready",
  "stock.transfer_sent", "stock.transfer_short", "stock.transfer_rejected",
  "purchasing.approval_needed", "stock.adjustment_needs_approval", "payables.run_submitted", "petty_cash.submitted",
  "hrms.leave_requested", "hrms.leave_approved", "hrms.leave_rejected", "hrms.timesheet_submitted", "hrms.crew_day_submitted", "hrms.attendance_to_review",
  "quotation.review_requested", "design.review_requested", "approvals.requested", "approvals.escalated_step",
  "crm.lead_assigned", "crm.lead_taken_over_to", "crm.conversation_assigned",
  // Team inbox: a client wrote in a chat that is yours (one notice per chat), or someone mentioned you in a note.
  "crm.inbox_message", "crm.inbox_mention", "crm.inbox_scheduled_failed", "crm.inbox_filed",
  // PLM-155: a timeline question to answer the same day, and its answer for the Account Manager.
  "crm.timeline_question", "crm.timeline_answered",
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
 * can switch it off, except for a `critical` one (R13), which never overrides the phone's own switch.
 * Idempotent per key. The worker sends it through Expo and falls back to the inbox.
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
  critical?: boolean;
}) {
  const critical = input.critical === true;
  // The phone's switch ("*") must be on; the event's or its module's setting can still turn this one off.
  const preferences = await db.query<{ eventType: string; enabled: boolean; quietHours: Record<string, unknown> | null }>(
    `SELECT event_type AS "eventType", enabled, quiet_hours AS "quietHours" FROM notification_preferences
     WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='push'
       AND event_type::text IN ($3::text, split_part($3::text, '.', 1) || '.*', '*')`,
    [input.workspaceId, input.recipientUserId, input.eventType],
  );
  const master = preferences.rows.find((row) => row.eventType === "*");
  const specific = preferences.rows.find((row) => row.eventType === input.eventType) ?? preferences.rows.find((row) => row.eventType !== "*");
  if (master?.enabled !== true || (!critical && specific?.enabled === false)) return { queued: false as const, reason: "push_off" };
  // The person's quiet hours (on the phone's switch) hold a push until they end; the in-app notice is already there.
  const scheduledFor = quietUntil(master.quietHours) ?? new Date();
  const device = await db.query(
    `SELECT 1 FROM device_endpoints WHERE workspace_id=$1 AND user_id=$2 AND status='active' LIMIT 1`,
    [input.workspaceId, input.recipientUserId],
  );
  if (!device.rowCount) return { queued: false as const, reason: "no_device" };
  const inserted = await db.query<{ id: string; correlationId: string }>(
    `INSERT INTO notifications (workspace_id, template_id, recipient_type, recipient_id, channel, event_type, status,
       scheduled_for, subject, body, deep_link, idempotency_key, correlation_id, critical)
     VALUES ($1, $2, 'user', $3, 'push', $4, 'pending', $9, $5, $6, $7, $8, gen_random_uuid(), $10)
     ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
     RETURNING id, correlation_id AS "correlationId"`,
    [input.workspaceId, input.templateId ?? null, input.recipientUserId, input.eventType, input.subject, input.body, input.deepLink ?? null, input.idempotencyKey, scheduledFor, critical],
  );
  const notification = inserted.rows[0];
  if (!notification) return { queued: false as const, reason: "already_sent" };
  await wakeDelivery(db, input.workspaceId, notification.id, notification.correlationId, "push");
  return { queued: true as const };
}
