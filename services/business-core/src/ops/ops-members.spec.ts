import { describe, expect, it, vi } from "vitest";
import { parseArgs, USAGE } from "./ops-args";
import { Report, type OpsContext } from "./ops-context";
import { runMembers } from "./ops-members";

const base = ["--workspace", "laespace", "--as", "Owner@Example.test"];
const member = (key: string, roles: string[], status = "active") =>
  ({ id: `m-${key}`, userId: `u-${key}`, email: `${key}@example.test`, displayName: key, status, version: 3, roles });

function run(apply: boolean, deactivate: string[], members = [
  member("owner", ["owner"]), member("sales", ["sales"]), member("designer", ["designer"], "suspended"), member("partner", ["owner"]),
]) {
  const updateMember = vi.fn(async () => ({}));
  const ctx = {
    workspace: { id: "w-1", slug: "laespace", name: "La'espace" }, userId: "u-owner", actor: {}, apply,
    get: () => ({ listMembers: async () => members, updateMember }),
    validated: async (_dto: unknown, body: unknown) => body,
  } as unknown as OpsContext;
  const report = new Report(() => undefined, true);
  return runMembers(ctx, { command: "members", workspace: "laespace", as: "owner@example.test", apply, json: true, deactivate }, report)
    .then(() => ({ lines: report.lines, updateMember }));
}

describe("operator CLI members --deactivate", () => {
  it("parses the members to switch off, a dry run unless --apply", () => {
    expect(parseArgs(["members", ...base, "--deactivate", "Sales@Example.test, design@example.test,sales@example.test", "--apply"])).toEqual({
      command: "members", workspace: "laespace", as: "owner@example.test", apply: true, json: false, deactivate: ["sales@example.test", "design@example.test"] });
    expect(() => parseArgs(["members", ...base])).toThrow("--deactivate is required.");
    expect(() => parseArgs(["members", ...base, "--deactivate", "sales"])).toThrow("not an email: sales");
    expect(() => parseArgs(["members", ...base, "--deactivate", "a@b.co", "--file", "x.json"])).toThrow("--file does not apply to members.");
    expect(USAGE).toContain("members --workspace <slug> --as <member email> --deactivate <email,email,...> [--apply] [--json]");
  });

  it("previews: would change for an active member, unchanged when inactive, not found for a stranger", async () => {
    const { lines, updateMember } = await run(false, ["sales@example.test", "designer@example.test", "nobody@example.test"]);
    expect(lines).toEqual([
      { section: "members", status: "would change", label: "sales@example.test", detail: "sales: active → inactive" },
      { section: "members", status: "unchanged", label: "designer@example.test", detail: "designer: inactive" },
      { section: "members", status: "not found", label: "nobody@example.test", detail: "not a member of this workspace" },
    ]);
    expect(updateMember).not.toHaveBeenCalled();
  });

  it("suspends through the member command with the member's version", async () => {
    const { lines, updateMember } = await run(true, ["sales@example.test"]);
    expect(updateMember).toHaveBeenCalledWith({}, "w-1", "m-sales", { version: 3, status: "suspended" });
    expect(lines).toEqual([{ section: "members", status: "changed", label: "sales@example.test", detail: "sales: active → inactive" }]);
  });

  it("never deactivates the acting member or the last active owner", async () => {
    const { lines, updateMember } = await run(true, ["owner@example.test", "partner@example.test"]);
    expect(lines[0]).toEqual({ section: "members", status: "failed", label: "owner@example.test", detail: "the member the CLI acts as is never deactivated" });
    // The acting owner stays, so another owner may go.
    expect(lines[1]).toMatchObject({ status: "changed", label: "partner@example.test" });

    const alone = await run(true, ["partner@example.test"], [member("owner", ["sales"]), member("partner", ["owner"])]);
    expect(alone.lines).toEqual([{ section: "members", status: "failed", label: "partner@example.test", detail: "the last active owner is never deactivated" }]);
    expect(alone.updateMember).not.toHaveBeenCalled();
    expect(updateMember).toHaveBeenCalledTimes(1);
  });
});
