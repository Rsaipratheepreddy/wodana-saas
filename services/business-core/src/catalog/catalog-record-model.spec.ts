import { describe, expect, it } from "vitest";
import { catalogRecordRole } from "./catalog-record-model";

describe("shared catalogue record model", () => {
  it("exposes one stable item, variant and assembly vocabulary over existing records", () => {
    expect(catalogRecordRole({ kind: "work" })).toBe("item");
    expect(catalogRecordRole({ kind: "variant" })).toBe("variant");
    expect(catalogRecordRole({ kind: "construction", configuration: { recordRole: "template" } })).toBe("assembly");
    expect(catalogRecordRole({ kind: "construction", configuration: { recordRole: "component" } })).toBe("assembly_component");
    expect(catalogRecordRole({ kind: "material" })).toBe("catalog_record");
  });
});
