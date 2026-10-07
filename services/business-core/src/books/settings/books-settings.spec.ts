import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_ROLES, type AccountRole, type AccountType } from "../books-contract";
import { roleProblem, ROLE_TYPES, SETTINGS_ACTIONS, taxProblem } from "./books-settings";

/** The templates as 0283 seeds them. */
function templates() {
  const sql = readFileSync(join(__dirname, "../../../drizzle/0283_books_templates.sql"), "utf8");
  return [...sql.matchAll(/\$template\$([\s\S]*?)\$template\$/g)].map((match) => JSON.parse(match[1]) as {
    code: string; accounts: Array<{ key: string; code: string; type: AccountType; isControl: boolean }>; roles: Record<AccountRole, string>;
  });
}

describe("Ledger settings rules", () => {
  it("accept every role mapping the templates make", () => {
    const seeded = templates();
    expect(seeded.map((template) => template.code).sort()).toEqual(["AE", "IFRS"]);
    for (const template of seeded) {
      for (const role of ACCOUNT_ROLES) {
        const account = template.accounts.find((item) => item.key === template.roles[role])!;
        expect(roleProblem(role, { ...account, archived: false }), `${template.code} ${role}`).toBeNull();
      }
    }
  });

  it("keep control accounts to receivables and payables, and roles to their account types", () => {
    expect(Object.keys(ROLE_TYPES).sort()).toEqual([...ACCOUNT_ROLES].sort());
    expect(roleProblem("ar_control", { code: "1100", type: "asset", isControl: false, archived: false })).toMatch(/not a control account/);
    expect(roleProblem("general_expense", { code: "1200", type: "expense", isControl: true, archived: false })).toMatch(/control account/);
    expect(roleProblem("revenue_project", { code: "5100", type: "expense", isControl: false, archived: false })).toMatch(/needs income/);
    expect(roleProblem("rounding", { code: "6990", type: "expense", isControl: false, archived: true })).toMatch(/archived/);
  });

  it("keep tax codes to the rules the table enforces", () => {
    const base = { code: "SR", name: "Standard", rate: "5", treatment: "standard" as const, direction: "sales" as const, recoverable: false, baseBox: "1", taxBox: "1",
      rcOutputBox: null, effectiveFrom: "2018-01-01", effectiveTo: null };
    expect(taxProblem(base)).toBeNull();
    expect(taxProblem({ ...base, recoverable: true })).toMatch(/recoverable/);
    expect(taxProblem({ ...base, treatment: "reverse_charge" })).toMatch(/purchases/);
    expect(taxProblem({ ...base, rcOutputBox: "3" })).toMatch(/output box/);
    expect(taxProblem({ ...base, effectiveTo: "2017-12-31" })).toMatch(/ends on or after/);
    expect(SETTINGS_ACTIONS).toContain("turn_on");
  });
});
