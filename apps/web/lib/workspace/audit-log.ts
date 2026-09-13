export type AuditEvent = {
  id: string;
  source: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  correlationId: string;
  occurredAt: string;
  actorName: string | null;
  actorEmail: string | null;
};

export type AuditLogPageData = {
  canView: boolean;
  items: AuditEvent[];
  nextCursor: string | null;
  referenceTime: string;
  workspaceId: string;
};

export const auditLogFixture: AuditLogPageData = {
  canView: true,
  workspaceId: "00000000-0000-4000-8000-000000000002",
  nextCursor: "fixture-next-page",
  referenceTime: "2026-09-06T06:00:00.000Z",
  items: [
    {
      id: "70000000-0000-4000-8000-000000000001",
      source: "user",
      action: "workspace.member_invited",
      entityType: "workspace_member",
      entityId: "10000000-0000-4000-8000-000000000004",
      before: null,
      after: { email: "designer@igloarchitects.com", roles: ["member"] },
      correlationId: "71000000-0000-4000-8000-000000000001",
      occurredAt: "2026-09-06T04:42:00.000Z",
      actorName: "Iglo Administrator",
      actorEmail: "admin@igloarchitects.com",
    },
    {
      id: "70000000-0000-4000-8000-000000000002",
      source: "user",
      action: "workspace.team_updated",
      entityType: "team",
      entityId: "20000000-0000-4000-8000-000000000003",
      before: { leadUserId: null },
      after: { leadUserId: "10000000-0000-4000-8000-000000000001" },
      correlationId: "71000000-0000-4000-8000-000000000002",
      occurredAt: "2026-09-06T04:15:00.000Z",
      actorName: "Iglo Administrator",
      actorEmail: "admin@igloarchitects.com",
    },
    {
      id: "70000000-0000-4000-8000-000000000003",
      source: "integration",
      action: "integration.connection_completed",
      entityType: "integration_connection",
      entityId: "40000000-0000-4000-8000-000000000001",
      before: { status: "pending" },
      after: { provider: "google_workspace", status: "connected" },
      correlationId: "71000000-0000-4000-8000-000000000003",
      occurredAt: "2026-09-05T12:10:00.000Z",
      actorName: null,
      actorEmail: null,
    },
    {
      id: "70000000-0000-4000-8000-000000000004",
      source: "user",
      action: "business_unit.created",
      entityType: "business_unit",
      entityId: "30000000-0000-4000-8000-000000000006",
      before: null,
      after: { code: "DELIVERY", displayName: "Project Delivery" },
      correlationId: "71000000-0000-4000-8000-000000000004",
      occurredAt: "2026-09-05T08:30:00.000Z",
      actorName: "Iglo Administrator",
      actorEmail: "admin@igloarchitects.com",
    },
    {
      id: "70000000-0000-4000-8000-000000000005",
      source: "internal",
      action: "workspace.invitation_resent",
      entityType: "workspace_invitation",
      entityId: "50000000-0000-4000-8000-000000000002",
      before: { status: "expired" },
      after: { status: "pending" },
      correlationId: "71000000-0000-4000-8000-000000000005",
      occurredAt: "2026-09-03T06:05:00.000Z",
      actorName: "Iglo Administrator",
      actorEmail: "admin@igloarchitects.com",
    },
  ],
};
