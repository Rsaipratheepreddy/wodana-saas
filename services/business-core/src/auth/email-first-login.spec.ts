import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LocalAuthService } from "./local-auth.service";

const user = { id: "10000000-0000-4000-8000-000000000001", passwordHash: "hash", passwordChangedAt: new Date(0) };
const palm = { workspaceId: "00000000-0000-4000-8000-00000000000a", name: "Palm Living", loginSlug: "palm-living", logoUrl: null, primaryColor: null };
const studio = { workspaceId: "00000000-0000-4000-8000-00000000000b", name: "Studio B", loginSlug: "studio-b", logoUrl: null, primaryColor: null };

function fixture(workspaces: typeof palm[], sessionWorkspace?: string) {
  const query = vi.fn(async (sql: string) => sql.includes("FROM tenant_login_branding WHERE login_slug")
    ? { rowCount: sessionWorkspace ? 1 : 0, rows: sessionWorkspace ? [{ workspaceId: sessionWorkspace }] : [] }
    : { rowCount: 0, rows: [] });
  const actorQuery = vi.fn(async (sql: string) => sql.includes("JOIN tenant_login_branding branding")
    ? { rowCount: workspaces.length, rows: workspaces }
    : { rowCount: 1, rows: [{ id: "membership" }] });
  const database = {
    query,
    actorTransaction: vi.fn(async (_id: string, work: (client: { query: typeof actorQuery }) => Promise<unknown>) => work({ query: actorQuery })),
  };
  const config = { get: vi.fn((key: string, fallback: unknown) => key === "AUTH_MODE" ? "local" : fallback) };
  const service = new LocalAuthService(database as never, config as never, {} as never, {} as never, {} as never);
  const internals = service as unknown as Record<string, unknown>;
  internals.verifyLocalPassword = vi.fn().mockResolvedValue(user);
  internals.recordSuccessfulPasswordLogin = vi.fn().mockResolvedValue(undefined);
  internals.actorFor = vi.fn().mockReturnValue({ subject: `local:${user.id}` });
  const completePrimaryAuthentication = vi.fn().mockResolvedValue({ accessToken: "session" });
  internals.completePrimaryAuthentication = completePrimaryAuthentication;
  return { service, query, completePrimaryAuthentication };
}

describe("email-first staff sign-in", () => {
  it("signs straight into the only active workspace", async () => {
    const { service, query, completePrimaryAuthentication } = fixture([palm], palm.workspaceId);

    await expect(service.login("sara@palm.ae", "secret", undefined)).resolves.toEqual({ accessToken: "session" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE login_slug = $1"), ["palm-living"]);
    expect(completePrimaryAuthentication).toHaveBeenCalledWith(expect.anything(), user.id, palm.workspaceId, user.passwordChangedAt, expect.anything());
  });

  it("returns a workspace picker, not a session, when the user belongs to several workspaces", async () => {
    const { service, completePrimaryAuthentication } = fixture([palm, studio]);

    await expect(service.login("sara@palm.ae", "secret", undefined)).resolves.toEqual({
      workspaceSelectionRequired: true,
      workspaces: [palm, studio],
    });
    expect(completePrimaryAuthentication).not.toHaveBeenCalled();
  });

  it("rejects a verified user with no active workspace using the generic message", async () => {
    const { service, completePrimaryAuthentication } = fixture([]);

    await expect(service.login("sara@palm.ae", "secret", undefined)).rejects.toThrow(UnauthorizedException);
    await expect(service.login("sara@palm.ae", "secret", undefined)).rejects.toThrow("Email, password, or tenant is incorrect");
    expect(completePrimaryAuthentication).not.toHaveBeenCalled();
  });

  it("keeps the existing slug path unchanged when a tenant is chosen", async () => {
    const { service, completePrimaryAuthentication } = fixture([palm, studio], studio.workspaceId);

    await service.login("sara@palm.ae", "secret", "studio-b");
    expect(completePrimaryAuthentication).toHaveBeenCalledWith(expect.anything(), user.id, studio.workspaceId, user.passwordChangedAt, expect.anything());
  });
});
