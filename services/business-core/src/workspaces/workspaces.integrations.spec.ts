import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import { WorkspacesService } from "./workspaces.service";

const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
const connectionId = "ca296f82-7941-4e30-b01d-94515b93f197";
const legalEntityId = "c235c573-f4b1-4da6-b041-887ffcdeaf49";
const otherLegalEntityId = "50cb7103-744f-4925-b378-446417347d83";
const actor: RequestActor = {
  subject: "local:owner",
  provider: "local",
  email: "owner@example.com",
  displayName: "Workspace owner",
};

function serviceFor(connectionLegalEntityId: string | null) {
  const before = {
    id: connectionId,
    legalEntityId: connectionLegalEntityId,
    provider: "quickbooks",
    displayName: "QuickBooks",
    externalDomain: null,
    status: "connected",
    configuration: {},
    version: 3,
  };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM integration_connections") && sql.includes("FOR UPDATE")) {
      return { rowCount: 1, rows: [before] };
    }
    if (sql.includes("FROM legal_entities")) {
      return { rowCount: 1, rows: [{ id: legalEntityId }] };
    }
    if (sql.includes("UPDATE integration_connections")) {
      return {
        rowCount: 1,
        rows: [{ ...before, legalEntityId, version: 4 }],
      };
    }
    return { rowCount: 1, rows: [{ id: workspaceId }] };
  });
  const client = { query };
  const access = {
    withAnyPermission: vi.fn(async (
      _actor: RequestActor,
      _workspaceId: string,
      _permissions: string[],
      work: (databaseClient: typeof client, resolvedActor: typeof actor & { userId: string }) => Promise<unknown>,
    ) => work(client, { ...actor, userId: "00000000-0000-4000-8000-000000000010" })),
  };
  return {
    query,
    service: new WorkspacesService(
      {} as never,
      {} as never,
      access as never,
      {} as never,
      {} as never,
    ),
  };
}

describe("WorkspacesService integration assignment", () => {
  it("repairs a connected legacy connection that has no legal entity", async () => {
    const { query, service } = serviceFor(null);

    await expect(service.updateIntegrationConnection(actor, workspaceId, connectionId, {
      version: 3,
      legalEntityId,
    })).resolves.toMatchObject({ legalEntityId, version: 4 });

    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE integration_connections"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO audit_events"))).toBe(true);
  });

  it("still blocks moving an active connection between legal entities", async () => {
    const { service } = serviceFor(otherLegalEntityId);

    await expect(service.updateIntegrationConnection(actor, workspaceId, connectionId, {
      version: 3,
      legalEntityId,
    })).rejects.toBeInstanceOf(ConflictException);
  });
});
