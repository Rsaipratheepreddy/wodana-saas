import { describe, expect, it } from "vitest";
import { gridSettingsRequestHash, isGridKey, managePermissionFor, normalizeHiddenColumns } from "./grid-settings.domain";

describe("list defaults (R14)", () => {
  it("maps each list to its module's manage permission", () => {
    expect(managePermissionFor("crm.enquiries")).toBe("crm.settings.manage");
    expect(managePermissionFor("crm.opportunities")).toBe("crm.settings.manage");
    expect(managePermissionFor("planning.list")).toBe("pre_projects.manage_lifecycle");
    expect(managePermissionFor("projects.list")).toBe("projects.manage");
    expect(managePermissionFor("purchasing.orders")).toBe("purchasing.manage");
    expect(managePermissionFor("inventory.stock")).toBe("stock.manage");
    expect(managePermissionFor("finance.bills")).toBe("payables.manage");
    expect(managePermissionFor("finance.bills.lines")).toBe("payables.manage");
    expect(managePermissionFor("finance.billsx")).toBe("finance.settings.manage");
    expect(managePermissionFor("hrms.people")).toBe("hrms.manage");
  });

  it("has no default for lists outside the modules or malformed keys", () => {
    expect(managePermissionFor("control.accounts")).toBeNull();
    expect(managePermissionFor("crm")).toBeNull();
    expect(managePermissionFor("CRM.enquiries")).toBeNull();
    expect(isGridKey("crm.enquiries")).toBe(true);
    expect(isGridKey("crm..enquiries")).toBe(false);
    expect(isGridKey(`crm.${"a".repeat(80)}`)).toBe(false);
  });

  it("keeps each hidden column once, in a stable order, and refuses invalid names", () => {
    expect(normalizeHiddenColumns(["stage", "owner", "stage"])).toEqual(["owner", "stage"]);
    expect(normalizeHiddenColumns([])).toEqual([]);
    expect(() => normalizeHiddenColumns("stage")).toThrow("Choose the columns to hide");
    expect(() => normalizeHiddenColumns(["__select"])).toThrow("A column name is not valid");
    expect(() => normalizeHiddenColumns(["drop table"])).toThrow("A column name is not valid");
    expect(() => normalizeHiddenColumns(Array.from({ length: 101 }, (_, index) => `c${index}`))).toThrow("Hide at most 100 columns");
  });

  it("hashes the same change the same way whatever the order", () => {
    expect(gridSettingsRequestHash("crm.enquiries", ["a", "b"], 1)).toBe(gridSettingsRequestHash("crm.enquiries", ["b", "a"], 1));
    expect(gridSettingsRequestHash("crm.enquiries", ["a"], 1)).not.toBe(gridSettingsRequestHash("crm.enquiries", ["a"], 2));
  });
});
