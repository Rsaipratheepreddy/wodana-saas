import { describe, expect, it, vi } from "vitest";
import { CrmSettingsService } from "./crm-settings.service";

function setup(query = vi.fn()) {
  const access = { withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work({ query }, { userId: "user" })) };
  const events = { record: vi.fn().mockResolvedValue(undefined) };
  const revisions = { ensureBaseline: vi.fn().mockResolvedValue(null), record: vi.fn().mockResolvedValue({ id: "revision" }) };
  return { service: new CrmSettingsService(access as never, events as never, revisions as never), query, events, revisions };
}

describe("CRM qualification form integrity", () => {
  it("rejects invalid select definitions before writing", async () => {
    const { service, query } = setup();
    await expect(service.createForm({} as never, "workspace", {
      code: "design", name: "Design", questions: [
        { key: "property", label: "Property", dataType: "select", position: 1, configuration: {} },
      ],
    })).rejects.toThrow("requires unique string options");
    expect(query).not.toHaveBeenCalled();
  });

  it("normalizes an empty service scope to the global form scope", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("INSERT INTO crm_qualification_forms")
      ? { rows: [{ id: "form", code: "global", name: "Global", status: "draft", serviceType: null, version: 1 }], rowCount: 1 }
      : { rows: [], rowCount: 0 });
    const { service } = setup(query);
    await service.createForm({} as never, "workspace", {
      code: "global", name: "Global", serviceType: "   ", questions: [],
    });
    expect(query.mock.calls[0][1]).toEqual(["workspace", "global", "Global", null, "qualification"]);
  });

  it("prevents two active forms for the same global or service-specific scope", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT * FROM crm_qualification_forms")) {
        return { rows: [{ id: "form", version: 2, status: "draft", service_type: null }], rowCount: 1 };
      }
      if (sql.includes("id<>$2 AND status='active'")) return { rows: [{ exists: true }], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const { service } = setup(query);
    await expect(service.updateForm({} as never, "workspace", "form", {
      version: 2, status: "active",
      questions: [{ key: "budget", label: "Budget", dataType: "number", required: true, position: 1 }],
    })).rejects.toThrow("Only one active qualification form");
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE crm_qualification_forms SET"))).toBe(false);
  });

  it("turns a concurrent active-scope uniqueness race into a stable conflict", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT * FROM crm_qualification_forms")) {
        return { rows: [{ id: "form", version: 2, status: "draft", service_type: null }], rowCount: 1 };
      }
      if (sql.includes("id<>$2 AND status='active'")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT form.id,form.code")) {
        return { rows: [{ id: "form", code: "global", name: "Global", version: 2, status: "draft", serviceType: null, questions: [] }], rowCount: 1 };
      }
      if (sql.includes("UPDATE crm_qualification_forms SET")) {
        throw Object.assign(new Error("duplicate"), { code: "23505", constraint: "crm_qualification_forms_active_scope_uidx" });
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    await expect(setup(query).service.updateForm({} as never, "workspace", "form", {
      version: 2, status: "active",
      questions: [{ key: "budget", label: "Budget", dataType: "number", position: 1 }],
    })).rejects.toThrow("Only one active qualification form");
  });

  it("does not allow an active form to have no questions", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("SELECT * FROM crm_qualification_forms")
      ? { rows: [{ id: "form", version: 2, status: "active", service_type: "fit_out" }], rowCount: 1 }
      : { rows: [], rowCount: 0 });
    const { service } = setup(query);
    await expect(service.updateForm({} as never, "workspace", "form", { version: 2, questions: [] }))
      .rejects.toThrow("needs at least one question");
  });
});
