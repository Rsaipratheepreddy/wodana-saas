import { describe, expect, it } from "vitest";
import { normalKey } from "./stock";

describe("stock items", () => {
  it("tells items without a catalog item apart by name and unit, ignoring case and spacing", () => {
    expect(normalKey("  Wood   Glue ", "Nos")).toBe(normalKey("wood glue", "nos"));
    expect(normalKey("Wood glue", "nos")).not.toBe(normalKey("Wood glue", "kg"));
  });
});
