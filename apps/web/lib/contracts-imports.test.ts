import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The contracts index re-exports with NodeNext ".js" paths the web bundler can't follow,
// so web code takes only types from it; runtime helpers come from a self-contained subpath.
describe("contracts imports", () => {
  it("web takes only types from the contracts index", () => {
    const hits = (() => { try { return execFileSync("git", ["grep", "-n", "-E", "^import \\{[^}]*\\} from \"@wodana/contracts\";", "--", "."], { encoding: "utf8", cwd: process.cwd() }).trim(); } catch { return ""; } })();
    expect(hits).toBe("");
  });
});
