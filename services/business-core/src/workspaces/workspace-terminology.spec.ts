import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { UpdateWorkspaceTerminologyDto } from "./dto/update-workspace-terminology.dto";
import { resolveWorkspaceTerminology, workspaceTerminologyDefault } from "./workspace-terminology";

describe("workspace terminology", () => {
  it("returns the current product terminology when no override exists", () => {
    const result = resolveWorkspaceTerminology([]);

    expect(result.map.lead).toEqual({ visibleName: "Lead", visibleNamePlural: "Leads" });
    expect(result.map.pre_execution).toEqual({ visibleName: "Pre-execution", visibleNamePlural: "Pre-execution" });
    expect(result.map.business_unit).toEqual({ visibleName: "Business unit", visibleNamePlural: "Business units" });
    expect(result.items.every((item) => !item.overridden && item.version === 0)).toBe(true);
  });

  it("resolves an override without changing its immutable key or defaults", () => {
    const result = resolveWorkspaceTerminology([{
      key: "business_unit",
      visibleName: "Department",
      visibleNamePlural: "Departments",
      version: 3,
      updatedAt: "2026-09-13T12:00:00Z",
    }]);
    const item = result.items.find((candidate) => candidate.key === "business_unit");

    expect(item).toMatchObject({
      key: "business_unit",
      defaultVisibleName: "Business unit",
      defaultVisibleNamePlural: "Business units",
      visibleName: "Department",
      visibleNamePlural: "Departments",
      overridden: true,
      version: 3,
    });
    expect(workspaceTerminologyDefault("not_a_term")).toBeUndefined();
  });

  it("validates plain, bounded singular and plural names", async () => {
    const valid = plainToInstance(UpdateWorkspaceTerminologyDto, {
      version: 0,
      visibleName: "  Division  ",
      visibleNamePlural: "  Divisions  ",
    });
    expect(await validate(valid)).toEqual([]);
    expect(valid.visibleName).toBe("Division");

    const invalid = plainToInstance(UpdateWorkspaceTerminologyDto, {
      version: 0,
      visibleName: "Division\nAdmin",
      visibleNamePlural: "",
    });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
  });
});
