import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { describe, expect, it, vi } from "vitest";
import { PLATFORM_OPERATOR_PERMISSION_KEY } from "../auth/platform-operator-permission.guard";
import { ClearWorkspaceRecordsDto } from "./dto/clear-workspace-records.dto";
import { InternalTenantsController } from "./internal-tenants.controller";
import { clearRecordsError, runWorkspaceClearRecords, summarizeClearRecords } from "./workspace-clear-records.service";

const workspaceId = "00000000-0000-4000-8000-000000000001";

describe("workspace clear records", () => {
  it("summarises the per-table counts and leaves out empty tables", () => {
    const result = summarizeClearRecords(workspaceId, "palm-living", false, [
      { tableName: "crm_leads", disposition: "clear", rowCount: "3", runId: "run" },
      { tableName: "crm_enquiry_counters", disposition: "reset", rowCount: "1", runId: "run" },
      { tableName: "bookings", disposition: "clear", rowCount: "0", runId: "run" },
      { tableName: "workspace_stored_objects", disposition: "files", rowCount: "2", runId: "run" },
      { tableName: "object storage keys", disposition: "files", rowCount: "4", runId: "run" },
    ]);
    expect(result).toEqual({
      workspaceId, slug: "palm-living", dryRun: false, runId: "run", rows: 6, objectKeys: 4,
      tables: [
        { table: "crm_enquiry_counters", disposition: "reset", rows: 1 },
        { table: "crm_leads", disposition: "clear", rows: 3 },
        { table: "workspace_stored_objects", disposition: "files", rows: 2 },
      ],
    });
  });

  it("maps the database refusals to safe HTTP errors", () => {
    expect(clearRecordsError(Object.assign(new Error("x"), { code: "22023" }))).toBeInstanceOf(BadRequestException);
    expect(clearRecordsError(Object.assign(new Error("x"), { code: "P0002" }))).toBeInstanceOf(NotFoundException);
    expect(clearRecordsError(Object.assign(new Error("Unclassified tenant tables: x"), { code: "55000" }))).toBeInstanceOf(ConflictException);
  });

  it("calls the SQL function with the confirmation and the dry-run flag", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ tableName: "crm_leads", disposition: "clear", rowCount: "2", runId: null }] });
    const result = await runWorkspaceClearRecords({ query } as never, workspaceId, "palm-living", true);
    expect(query.mock.calls[0][0]).toContain("workspace_clear_records($1::uuid, $2::text, $3::boolean)");
    expect(query.mock.calls[0][1]).toEqual([workspaceId, "palm-living", true]);
    expect(result.rows).toBe(2);
  });

  it("validates the request and treats a missing dryRun as a dry run", () => {
    expect(validateSync(plainToInstance(ClearWorkspaceRecordsDto, { confirmSlug: "palm-living" }))).toEqual([]);
    expect(validateSync(plainToInstance(ClearWorkspaceRecordsDto, { confirmSlug: "" })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(ClearWorkspaceRecordsDto, { confirmSlug: "palm-living", dryRun: "no" })).length).toBeGreaterThan(0);
  });

  it("is an operator-only route that needs data.manage", () => {
    const handler = InternalTenantsController.prototype.clearWorkspaceRecords;
    expect(Reflect.getMetadata(PLATFORM_OPERATOR_PERMISSION_KEY, handler)).toBe("data.manage");
    const guards = (Reflect.getMetadata("__guards__", handler) as Array<{ name: string }>).map((guard) => guard.name);
    expect(guards).toEqual(["PlatformOperatorGuard", "PlatformOperatorPermissionGuard"]);
  });
});
