import { describe, expect, it } from "vitest";
import { CRM_EVENT_TYPES } from "./crm-events.js";
describe("CRM event catalog", () => {
  it("contains unique, versioned names", () => {
    expect(new Set(CRM_EVENT_TYPES).size).toBe(CRM_EVENT_TYPES.length);
    expect(CRM_EVENT_TYPES.every((name) => name.endsWith(".v1"))).toBe(true);
  });
});
