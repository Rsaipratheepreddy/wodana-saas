import { describe, expect, it } from "vitest";
import { ACCESS_MODULES, MODULE_LABELS, accessChanges, describeAccess, expandAccess, levelLabel, levelPermissions, modulePermissions, offeredLevels, withExtra, withLevel } from "./access-levels";
import { workspacePermissionFixture } from "./roles-permissions";

describe("access levels on the web", () => {
  it("names every module and covers the permission catalogue once", () => {
    for (const module of ACCESS_MODULES) expect(MODULE_LABELS[module.id], module.id).toBeTruthy();
    const mapped = ACCESS_MODULES.flatMap(modulePermissions);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(workspacePermissionFixture.map((permission) => permission.code).filter((code) => !mapped.includes(code))).toEqual([]);
  });

  it("names the Inbox levels Own chats · Team chats · Manage and keeps the shared names elsewhere", () => {
    expect(levelLabel("inbox", "view")).toBe("Own chats");
    expect(levelLabel("inbox", "edit")).toBe("Team chats");
    expect(levelLabel("inbox", "none")).toBe("No access");
    expect(levelLabel("sales", "edit")).toBe("Edit");
    expect(describeAccess(["crm.communications.view", "crm.communications.send"]).levels.inbox).toBe("view");
    expect(describeAccess(["crm.communications.view", "crm.communications.send", "crm.inbox.team"]).levels.inbox).toBe("edit");
    expect(expandAccess({ levels: { inbox: "manage" }, extras: [] })).toEqual(["crm.communications.send", "crm.communications.view", "crm.consent.manage", "crm.inbox.manage", "crm.inbox.team"]);
  });

  it("round-trips a role through levels and extras", () => {
    const codes = ["crm.leads.view", "crm.parties.view", "crm.opportunities.view", "crm.activities.view", "crm.reports.view", "crm.notifications.view", "crm.parties.export", "stock.view", "unknown.future"];
    const access = describeAccess(codes);
    expect(access.levels).toMatchObject({ sales: "view", inventory: "none" });
    expect(access.extras).toEqual(["crm.parties.export", "stock.view", "unknown.future"]);
    expect(expandAccess(access)).toEqual([...codes].sort());
  });

  it("raises a level, folds the extras it now includes and counts the changes", () => {
    const saved = ["stock.view", "crm.parties.export"];
    const raised = withLevel(describeAccess(saved), "inventory", "view");
    expect(raised.extras).toEqual(["crm.parties.export"]);
    expect(accessChanges(saved, raised)).toBe(1); // catalog.view
    const trimmed = withExtra(raised, "crm.parties.export", false);
    expect(accessChanges(saved, trimmed)).toBe(2);
    const woddy = ACCESS_MODULES.find((module) => module.id === "woddy")!;
    expect(offeredLevels(woddy)).toEqual(["none", "view"]);
    expect(levelPermissions(woddy, "view")).toEqual(["ai.suggestions.use"]);
  });
});
