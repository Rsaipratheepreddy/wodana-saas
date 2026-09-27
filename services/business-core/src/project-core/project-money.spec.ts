import { describe, expect, it } from "vitest";
import { stockEffect } from "./project-money";

const P = "project", Q = "other";
const effect = (kind: string, projectId: string | null, forProjectId: string | null, quantity: string) => stockEffect({ kind, projectId, forProjectId, quantity }, P).toString();

describe("what stock does to a project's cost", () => {
  it("counts goods when they become the project's and when they leave it", () => {
    expect(effect("receive", P, P, "6")).toBe("6");
    expect(effect("allocate", P, P, "2")).toBe("2");
    expect(effect("allocate", null, P, "-2")).toBe("0");
    expect(effect("release", P, P, "-1")).toBe("-1");
    expect(effect("release", null, P, "1")).toBe("0");
    expect(effect("supplier_return", P, P, "-1")).toBe("-1");
    expect(effect("reverse", P, P, "-6")).toBe("-6");
    expect(effect("adjust", P, P, "-0.5")).toBe("-0.5");
    expect(effect("receive", null, null, "10")).toBe("0");
  });

  it("counts general stock issued to the project and returned from it, not its own stock used on its own work", () => {
    expect(effect("issue", null, P, "-3")).toBe("3");
    expect(effect("return", null, P, "1")).toBe("-1");
    expect(effect("issue", P, P, "-3")).toBe("0");
    expect(effect("return", P, P, "1")).toBe("0");
    // Another project's stock used here moves the cost from that project to this one.
    expect(effect("issue", Q, P, "-2")).toBe("2");
    expect(stockEffect({ kind: "issue", projectId: Q, forProjectId: P, quantity: "-2" }, Q).toString()).toBe("-2");
  });

  it("leaves out what the factory makes, whose materials were counted when issued", () => {
    expect(effect("produce", P, P, "3")).toBe("0");
  });
});
