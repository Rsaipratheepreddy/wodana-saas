import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceSearchService } from "./workspace-search.service";

const actor = {} as never;

function harness(permissionCodes: string[], entitledPermissionCodes = permissionCodes) {
  const sql: string[] = [];
  const query = vi.fn(async (statement: string) => {
    sql.push(statement);
    if (statement.includes('permission.code')) {
      return { rows: permissionCodes.map((code) => ({ membershipId: "member-1", code })) };
    }
    if (statement.includes("FROM crm_parties party") && !statement.includes("job_identities")) {
      return { rows: [{ id: "customer-1", title: "Amira Hassan", type: "person", lifecycle: "active" }] };
    }
    if (statement.includes("WITH facts AS")) {
      return { rows: [{ id: "job-1", reference: "J-000001", title: "Villa interiors", customer: "Amira Hassan" }] };
    }
    if (statement.includes("FROM pre_project_rooms room")) {
      return { rows: [{ id: "room-1", name: "Living room", caseId: "case-1", caseTitle: "Villa interiors", customer: "Amira Hassan" }] };
    }
    if (statement.includes("FROM commercial_cases commercial")) {
      return { rows: [{ id: "quote-1", title: "Villa proposal", number: "Q-001", status: "issued", caseId: "case-1", customer: "Amira Hassan" }] };
    }
    if (statement.includes("FROM delivery_projects project")) {
      return { rows: [{ id: "project-1", name: "Villa delivery", reference: "P-001", customer: "Amira Hassan", status: "active" }] };
    }
    return { rows: [] };
  });
  const access = {
    asMember: vi.fn(async (_actor, _workspace, work) => work({ query }, { userId: "user-1" })),
    effectivePermissions: vi.fn(async () => entitledPermissionCodes),
  };
  return { service: new WorkspaceSearchService(access as never), query, sql };
}

describe("WorkspaceSearchService", () => {
  it("returns meaningful routes for every permitted product record", async () => {
    const { service } = harness([
      "crm.parties.view", "crm.leads.view", "crm.opportunities.view",
      "pre_projects.view", "projects.manage",
    ]);
    const result = await service.search(actor, "workspace-1", "villa", "20");
    expect(result.searchedKinds).toEqual(["customer", "job", "room", "quotation", "project"]);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "customer", route: "/workspace/crm/customers?record=customer-1" }),
      expect.objectContaining({ kind: "job", reference: "J-000001", route: "/workspace/crm/jobs/job-1" }),
      expect.objectContaining({ kind: "room", route: "/workspace/pre-projects/cases/case-1/requirements?room=room-1" }),
      expect.objectContaining({ kind: "quotation", reference: "Q-001", route: "/workspace/pre-projects/cases/case-1/quotations?quote=quote-1" }),
      expect.objectContaining({ kind: "project", route: "/workspace/projects/project-1/overview" }),
    ]));
  });

  it("does not query or hint at record kinds outside effective inherited permissions", async () => {
    const { service, sql } = harness(["crm.parties.view"]);
    const result = await service.search(actor, "workspace-1", "amira");
    expect(result.searchedKinds).toEqual(["customer"]);
    expect(result.items.map((item) => item.kind)).toEqual(["customer"]);
    expect(sql.some((statement) => statement.includes("job_identities"))).toBe(false);
    expect(sql.some((statement) => statement.includes("pre_project_rooms"))).toBe(false);
    expect(sql.some((statement) => statement.includes("delivery_projects"))).toBe(false);
  });

  it("does not search an unsold module even when the member role grants it", async () => {
    const { service, sql } = harness(["crm.parties.view", "projects.view"], ["crm.parties.view"]);
    const result = await service.search(actor, "workspace-1", "amira");
    expect(result.searchedKinds).toEqual(["customer"]);
    expect(sql.some((statement) => statement.includes("delivery_projects"))).toBe(false);
  });

  it("applies the same assigned-project predicate to Job and Project results", async () => {
    const { service, query } = harness(["projects.view"]);
    await service.search(actor, "workspace-1", "villa");
    const statements = query.mock.calls.map(([statement]) => String(statement));
    expect(statements.find((statement) => statement.includes("WITH facts AS"))).toContain("project_assignments assignment");
    expect(statements.find((statement) => statement.includes("FROM delivery_projects project"))).toContain("assignment.membership_id=$3");
  });

  it("searches only identifiable quotation records and never exposes variations as quotations", async () => {
    const { service, query } = harness(["pre_projects.view"]);
    await service.search(actor, "workspace-1", "villa");
    const quotationSql = query.mock.calls
      .map(([statement]) => String(statement))
      .find((statement) => statement.includes("FROM commercial_cases commercial"));
    expect(quotationSql).toContain("quote.data->>'kind'='quotation'");
    expect(quotationSql).toContain("NULLIF(quote.data->>'id','') IS NOT NULL");
  });

  it("returns no records for a one-character query and rejects unsafe windows", async () => {
    const { service, query } = harness(["crm.parties.view"]);
    await expect(service.search(actor, "workspace-1", "a")).resolves.toEqual({ query: "a", items: [], searchedKinds: [], truncated: false });
    expect(query).not.toHaveBeenCalled();
    expect(() => service.search(actor, "workspace-1", "valid", "51")).toThrow(BadRequestException);
    expect(() => service.search(actor, "workspace-1", "x".repeat(121))).toThrow(BadRequestException);
  });
});
