import { describe, expect, it } from "vitest";
import { filtersFrom, filtersQuery, toCsv } from "./management";

describe("management report filters", () => {
  it("keeps the filter bar in the address and drops what isn't a date", () => {
    const filters = filtersFrom(new URLSearchParams("from=2026-09-01&to=bad&accountManager=abc&region=dubai"));
    expect(filters).toMatchObject({ from: "2026-09-01", to: "", accountManager: "abc", region: "dubai", source: "" });
    expect(filtersQuery(filters).toString()).toBe("from=2026-09-01&accountManager=abc&region=dubai");
  });

  it("writes a CSV Excel opens safely", () => {
    const csv = toCsv(["KPI", "Actual"], [["=SUM(A1)", "1,000"], ["Say \"hi\"", null]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain(`"'=SUM(A1)","1,000"`);
    expect(csv).toContain(`"Say ""hi""",""`);
  });
});
