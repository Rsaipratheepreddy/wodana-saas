import { describe, expect, it } from "vitest";
import { configurationChanges } from "./configuration-revisions.service";

describe("safe configuration revisions", () => {
  it("returns a stable field-level diff without treating reordered object keys as a change", () => {
    expect(configurationChanges(
      { name: "Studio", labels: { one: "Lead", many: "Leads" }, stages: ["brief", "quote"] },
      { labels: { many: "Enquiries", one: "Lead" }, name: "Studio", stages: ["brief", "design", "quote"] },
    )).toEqual([
      { path: "labels.many", before: "Leads", after: "Enquiries" },
      { path: "stages", before: ["brief", "quote"], after: ["brief", "design", "quote"] },
    ]);
  });

  it("describes the complete first snapshot as a baseline", () => {
    expect(configurationChanges(null, { visibleName: "Enquiry", version: 0 })).toEqual([
      { path: "version", before: undefined, after: 0 },
      { path: "visibleName", before: undefined, after: "Enquiry" },
    ]);
  });
});
