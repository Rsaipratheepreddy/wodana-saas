import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import { WorkspacesService } from "./workspaces.service";

const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
const legalEntityId = "c235c573-f4b1-4da6-b041-887ffcdeaf49";
const actor: RequestActor = {
  subject: "local:owner",
  provider: "local",
  email: "owner@example.com",
  displayName: "Workspace owner",
};
const timestamp = new Date("2026-09-06T00:00:00.000Z");

const workspace = {
  id: workspaceId,
  name: "Iglo Architects",
  slug: "iglo-architects",
  status: "active",
  default_currency: "AED",
  default_locale: "en-AE",
  default_timezone: "Asia/Dubai",
  unit_system: "metric",
  week_starts_on: 1,
  version: 1,
  created_at: timestamp,
  updated_at: timestamp,
};
const legalEntity = {
  id: legalEntityId,
  workspace_id: workspaceId,
  code: "IGLO",
  display_name: "Iglo Architects",
  registered_name: "Iglo Architects LLC",
  country_code: "AE",
  base_currency: "AED",
  locale: "en-AE",
  timezone: "Asia/Dubai",
  tax_registration_number: null,
  registration_number: null,
  address: {},
  status: "active",
  version: 1,
  created_at: timestamp,
  updated_at: timestamp,
};

describe("WorkspacesService company profile", () => {
  it("updates workspace, legal identity, login branding, and audit under both permissions", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM workspaces") && sql.includes("FOR UPDATE")) {
        return { rowCount: 1, rows: [{ id: workspaceId }] };
      }
      if (sql.includes("SELECT * FROM workspaces")) {
        return { rowCount: 1, rows: [workspace] };
      }
      if (sql.includes("SELECT * FROM legal_entities")) {
        return { rowCount: 1, rows: [legalEntity] };
      }
      if (sql.includes("UPDATE workspaces")) {
        return { rowCount: 1, rows: [{ ...workspace, name: "Iglo Studio", version: 2 }] };
      }
      if (sql.includes("UPDATE legal_entities")) {
        return { rowCount: 1, rows: [{
          ...legalEntity,
          display_name: "Iglo Studio",
          registered_name: "Iglo Studio LLC",
          registration_number: "CN-1",
          address: { city: "Dubai" },
          version: 2,
        }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const client = { query };
    const access = {
      withAnyPermission: vi.fn(async (
        _actor: RequestActor,
        _id: string,
        _permissions: string[],
        work: (databaseClient: typeof client, resolvedActor: typeof actor & { userId: string }) => Promise<unknown>,
      ) => work(client, { ...actor, userId: "00000000-0000-4000-8000-000000000010" })),
    };
    const service = new WorkspacesService(
      {} as never,
      {} as never,
      access as never,
      {} as never,
      {} as never,
    );

    const result = await service.updateCompanyProfile(actor, workspaceId, {
      workspaceVersion: 1,
      legalEntityId,
      legalEntityVersion: 1,
      name: "Iglo Studio",
      registeredName: "Iglo Studio LLC",
      countryCode: "AE",
      defaultCurrency: "AED",
      defaultLocale: "en-AE",
      defaultTimezone: "Asia/Dubai",
      unitSystem: "metric" as never,
      weekStartsOn: 1,
      registrationNumber: "CN-1",
      taxRegistrationNumber: "",
      address: { city: "Dubai" },
    });

    expect(access.withAnyPermission).toHaveBeenCalledWith(
      actor,
      workspaceId,
      ["module.organization.edit", "workspace.settings.manage", "legal_entities.manage"],
      expect.any(Function),
    );
    expect(result).toMatchObject({
      workspace: { name: "Iglo Studio", slug: "iglo-architects", version: 2 },
      legalEntity: { registeredName: "Iglo Studio LLC", version: 2 },
    });
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO tenant_login_branding"))).toBe(true);
    const branding = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO tenant_login_branding"));
    expect(branding?.[1]).toEqual([workspaceId, "iglo-architects", "Iglo Studio"]);
    const audit = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO audit_events"));
    expect(audit?.[1]?.[4]).toBe("workspace.company_profile_updated");
  });
});
