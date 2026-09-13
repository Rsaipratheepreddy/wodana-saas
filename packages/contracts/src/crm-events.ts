export const CRM_EVENT_TYPES = [
  "crm.intake.received.v1", "crm.identity.review_required.v1", "crm.enquiry.ready.v1",
  "crm.lead.assigned.v1", "crm.lead.reassigned.v1", "crm.sla.warning.v1",
  "crm.sla.breached.v1", "crm.customer.replied.v1", "crm.lead.qualified.v1",
  "crm.lead.disqualified.v1", "crm.activity.completed.v1", "crm.appointment.changed.v1",
  "crm.opportunity.stage_changed.v1", "crm.opportunity.won.v1", "crm.opportunity.lost.v1",
  "crm.project_handoff_requested.v1", "crm.consent.changed.v1", "automation.run_failed.v1",
  "automation.approval.decided.v1",
  "notification.delivery_requested.v1", "notification.delivery_failed.v1",
] as const;
export type CrmEventType = typeof CRM_EVENT_TYPES[number];
export interface DomainEventV1<Data extends Record<string, unknown> = Record<string, unknown>> {
  schemaVersion: 1;
  eventId: string;
  workspaceId: string;
  aggregateType: string;
  aggregateId: string;
  actorUserId: string | null;
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  data: Data;
}
export interface StreamDomainEvent {
  eventId: string;
  eventType: string;
  workspaceId: string;
  aggregateType: string;
  aggregateId: string;
  payload: string;
  attempt: string;
}
