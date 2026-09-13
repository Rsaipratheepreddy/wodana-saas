import { describe, expect, it, vi } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateIntegrationConnectionDto } from "./dto/create-integration-connection.dto";
import { IntegrationsService } from "./integrations.service";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const connectionId = "20000000-0000-4000-8000-000000000001";
const generation = "30000000-0000-4000-8000-000000000001";
const payload = { workspaceId, expectedVersion: 2, provider: "zoho_books" as const, externalAccountId: "12345", grantedScopes: ["ZohoBooks.invoices.READ"], secretReference: `redis:provider:zoho_books:${workspaceId}:${connectionId}:${generation}`, configuration: { region: "in" } };
function setup(row: Record<string, unknown>) {
  const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [row] });
  const database = { tenantTransaction: vi.fn(async (_workspace: string, _actor: string, run: (client: unknown) => unknown) => run({ query })) };
  const access = { withPermission: vi.fn(async (_actor: unknown, _workspace: string, _permission: string, run: (client: unknown) => unknown) => run({ query })) };
  const service = new IntegrationsService(database as never, access as never);
  return { service, access, query };
}

describe("provider connection boundaries", () => {
  it("accepts Zoho Books as an actual provider", async () => {
    expect(await validate(plainToInstance(CreateIntegrationConnectionDto, { provider: "zoho_books", displayName: "India accounting", legalEntityId: workspaceId, configuration: { region: "in" } }))).toEqual([]);
  });
  it("rejects credentials from another workspace before storing them", async () => {
    const { service, query } = setup({ provider: "zoho_books", status: "pending", version: 2 });
    await expect(service.completeProviderConnection(connectionId, { ...payload, secretReference: payload.secretReference.replace(workspaceId, generation) })).rejects.toThrow("does not belong");
    expect(query).toHaveBeenCalledOnce();
  });
  it("rejects replayed or stale callbacks", async () => {
    const { service, query } = setup({ provider: "zoho_books", status: "connected", version: 3 });
    await expect(service.completeProviderConnection(connectionId, payload)).rejects.toThrow("stale");
    expect(query).toHaveBeenCalledOnce();
  });
  it("rejects changing the provider during a callback", async () => {
    const { service } = setup({ provider: "quickbooks", status: "pending", version: 2 });
    await expect(service.completeProviderConnection(connectionId, payload)).rejects.toThrow("another provider");
  });
  it("requires manage permission for an outbound action", async () => {
    const { service, access } = setup({ id: connectionId, provider: "whatsapp", status: "connected", version: 2 });
    await service.authorizeUse({} as never, workspaceId, connectionId, "write");
    expect(access.withPermission.mock.calls[0][2]).toBe("integrations.manage");
  });
  it("does not authorize actions from disconnected accounts", async () => {
    const { service } = setup({ status: "revoked" });
    await expect(service.authorizeUse({} as never, workspaceId, connectionId, "write")).rejects.toThrow("Connect this account");
  });
});
