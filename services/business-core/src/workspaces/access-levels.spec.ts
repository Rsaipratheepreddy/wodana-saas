import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS_MODULES, describeAccess, expandAccess, levelPermissions, modulePermissions, offeredLevels } from "./access-levels";
import { ROLE_TEMPLATES } from "./role-templates";

/** The permission catalogue the migrations seed: the baseline's rows and every later INSERT INTO permissions. */
const migrationsDir = resolve(__dirname, "../../drizzle");
const catalogue = new Set(readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).flatMap((file) => {
  const sql = readFileSync(resolve(migrationsDir, file), "utf8");
  const baseline = [...sql.matchAll(/INSERT INTO public\.permissions VALUES \('[^']+', '([^']+)'/g)].map((match) => match[1]);
  const later = [...sql.matchAll(/INSERT INTO permissions\s*\(code, description\)\s*VALUES([\s\S]*?);/g)]
    .flatMap((statement) => [...statement[1].matchAll(/\(\s*'([a-z_]+(?:\.[a-z_]+)+)'\s*,/g)].map((match) => match[1]));
  return [...baseline, ...later];
}));

describe("access levels", () => {
  it("puts every catalogue permission in exactly one module, and nothing else", () => {
    expect(catalogue.size).toBeGreaterThan(100);
    const mapped = ACCESS_MODULES.flatMap(modulePermissions);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...catalogue].filter((code) => !mapped.includes(code))).toEqual([]);
    expect(mapped.filter((code) => !catalogue.has(code))).toEqual([]);
  });

  it("builds each level on the one before it", () => {
    const sales = ACCESS_MODULES.find((module) => module.id === "sales")!;
    expect(levelPermissions(sales, "view")).toContain("crm.opportunities.view");
    expect(levelPermissions(sales, "edit")).toEqual(expect.arrayContaining(["crm.opportunities.view", "crm.opportunities.manage", "crm.opportunities.sensitive_values"]));
    expect(levelPermissions(sales, "edit")).not.toContain("crm.parties.identity");
    expect(levelPermissions(sales, "manage")).toEqual(expect.arrayContaining(["crm.parties.identity", "crm.leads.assign"]));
    expect(levelPermissions(sales, "manage")).not.toContain("crm.privacy.erase");
    expect(offeredLevels(ACCESS_MODULES.find((module) => module.id === "woddy")!)).toEqual(["none", "view"]);
  });

  it("describes every role template as levels and extras that expand back to the same permissions", () => {
    for (const template of ROLE_TEMPLATES) {
      const access = describeAccess(template.permissions);
      expect(expandAccess(access), template.code).toEqual([...template.permissions].sort());
    }
    expect(describeAccess(ROLE_TEMPLATES.find((template) => template.code === "sales")!.permissions).levels).toMatchObject({ sales: "edit", inbox: "view", planning: "view", purchasing: "none" });
  });

  it("refuses an unknown module, a level the module doesn't offer and malformed extras", () => {
    expect(() => expandAccess({ levels: { warehouse: "view" } })).toThrow("Unknown module: warehouse");
    expect(() => expandAccess({ levels: { sales: "owner" } })).toThrow("sales has no owner level");
    expect(() => expandAccess({ levels: { woddy: "manage" } })).toThrow("woddy has no manage level");
    expect(() => expandAccess({ levels: {}, extras: "crm.leads.view" })).toThrow("Extras must be permission codes");
    expect(expandAccess({ levels: { inbox: "edit" }, extras: ["crm.parties.export"] })).toEqual(["crm.communications.send", "crm.communications.view", "crm.inbox.close_chats", "crm.inbox.team", "crm.parties.export"]);
    // Inbox levels (plan §5b): Own chats sees and answers; Team chats adds the queue and the team; Manage adds every chat and the settings.
    expect(expandAccess({ levels: { inbox: "view" } })).toEqual(["crm.communications.send", "crm.communications.view"]);
    // PLM-137: Team chats (the Sales admins) also send the closing message to a quiet chat.
    expect(expandAccess({ levels: { inbox: "manage" } })).toEqual(["crm.communications.send", "crm.communications.view", "crm.consent.manage", "crm.inbox.close_chats", "crm.inbox.manage", "crm.inbox.team"]);
  });
});
