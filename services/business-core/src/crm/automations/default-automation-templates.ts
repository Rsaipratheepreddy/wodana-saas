export interface DefaultCrmAutomationTemplate {
  code: string;
  name: string;
  description: string;
  runOncePerAggregate: boolean;
  definition: Record<string, unknown>;
}

const linear = (
  eventType: string,
  actions: Array<{ key: string; type: string; configuration: Record<string, unknown> }>,
) => ({
  nodes: [
    { key: "start", type: "trigger", configuration: { eventTypes: [eventType] } },
    ...actions,
    { key: "finish", type: "end", configuration: {} },
  ],
  edges: [
    { from: "start", to: actions[0]?.key ?? "finish" },
    ...actions.map((action, index) => ({ from: action.key, to: actions[index + 1]?.key ?? "finish" })),
  ],
});

export const DEFAULT_CRM_AUTOMATION_TEMPLATES: readonly DefaultCrmAutomationTemplate[] = [
  {
    code: "new_enquiry_assignment",
    name: "New enquiry assignment",
    description: "Assign a new enquiry and create its first response task.",
    runOncePerAggregate: true,
    definition: linear("crm.enquiry.ready.v1", [
      { key: "assign", type: "assign", configuration: {} },
      { key: "first_response", type: "create_task", configuration: { title: "Respond to new enquiry", priority: "high", delayMinutes: 0, isNextAction: true } },
    ]),
  },
  {
    code: "customer_reply_follow_up",
    name: "Customer reply follow-up",
    description: "Create an owned action when a customer reply needs attention.",
    runOncePerAggregate: false,
    definition: linear("crm.customer.replied.v1", [
      { key: "reply_task", type: "create_task", configuration: { title: "Respond to customer", priority: "high", delayMinutes: 0, isNextAction: true } },
    ]),
  },
  {
    code: "sla_breach_escalation",
    name: "SLA breach escalation",
    description: "Create an urgent escalation task when a lead SLA is breached.",
    runOncePerAggregate: false,
    definition: linear("crm.sla.breached.v1", [
      { key: "escalate", type: "create_task", configuration: { title: "Resolve breached lead SLA", priority: "urgent", delayMinutes: 0, isNextAction: true } },
    ]),
  },
  {
    code: "appointment_reminder",
    name: "Appointment reminder",
    description: "Send an approved reminder one hour before an appointment.",
    runOncePerAggregate: false,
    definition: linear("crm.appointment.changed.v1", [
      { key: "wait", type: "delay_until", configuration: { dueAt: "$event.startsAt", offsetMinutes: -60 } },
      { key: "remind", type: "send_template", configuration: { channel: "email", templateCode: "crm.appointment_reminder", eventType: "crm.appointment.reminder" } },
    ]),
  },
  {
    code: "opportunity_won_handoff",
    name: "Won opportunity handoff",
    description: "Request human approval before emitting a Projects handoff.",
    runOncePerAggregate: true,
    definition: linear("crm.opportunity.won.v1", [
      { key: "approve", type: "request_approval", configuration: { title: "Approve project handoff" } },
      { key: "handoff", type: "create_project_handoff", configuration: { mode: "delivery" } },
    ]),
  },
  {
    code: "consent_withdrawal_stop_outreach",
    name: "Consent withdrawal protection",
    description: "Stop active outreach only when communication consent is no longer granted.",
    runOncePerAggregate: false,
    definition: {
      nodes: [
        { key: "start", type: "trigger", configuration: { eventTypes: ["crm.consent.changed.v1"] } },
        { key: "not_granted", type: "filter", configuration: { condition: { path: "event.status", operator: "not_equals", value: "granted" } } },
        { key: "stop_outreach", type: "stop_sequence", configuration: { reason: "consent_not_granted" } },
        { key: "finish", type: "end", configuration: {} },
      ],
      edges: [
        { from: "start", to: "not_granted" },
        { from: "not_granted", to: "stop_outreach", when: "true" },
        { from: "not_granted", to: "finish", when: "false" },
        { from: "stop_outreach", to: "finish" },
      ],
    },
  },
] as const;
