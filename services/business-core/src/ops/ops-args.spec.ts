import { describe, expect, it } from "vitest";
import { listOf, parseArgs, parseMappingOverrides, UsageError } from "./ops-args";
import { buildMapping, errorReason, pickTabs } from "./ops-import";

const base = ["--workspace", "palm-living", "--as", "Owner@Example.test"];

describe("operator CLI arguments", () => {
  it("parses an import, dry run unless --apply", () => {
    const args = parseArgs(["import", ...base, "--target", "suppliers", "--file", "/tmp/list.xlsx", "--exclude-tabs", "bank, Average spends 6 months", "--legal-entity", "PLM", "--fill-only"]);
    expect(args).toMatchObject({ command: "import", workspace: "palm-living", as: "owner@example.test", target: "suppliers", file: "/tmp/list.xlsx", tabs: null,
      excludeTabs: ["bank", "Average spends 6 months"], legalEntity: "PLM", fillOnly: true, apply: false });
    expect(parseArgs(["import", ...base, "--target", "stock", "--file", "a.csv", "--apply", "--tabs", "A,B,A"])).toMatchObject({ apply: true, tabs: ["A", "B"] });
  });

  it("parses --approved-prices for a catalogue import only", () => {
    expect(parseArgs(["import", ...base, "--target", "catalog", "--file", "core.xlsx", "--approved-prices"])).toMatchObject({ target: "catalog", approvedPrices: true, apply: false });
    expect(parseArgs(["import", ...base, "--target", "catalog", "--file", "core.xlsx"])).toMatchObject({ approvedPrices: false });
    expect(() => parseArgs(["import", ...base, "--target", "stock", "--file", "a.xlsx", "--approved-prices"])).toThrow("--approved-prices does not apply to --target stock");
  });

  it("parses configure", () => {
    expect(parseArgs(["configure", ...base, "--profile", "p.json", "--json"])).toEqual({ command: "configure", workspace: "palm-living", as: "owner@example.test", apply: false, json: true, profile: "p.json" });
  });

  it("shows help without other arguments", () => {
    expect(parseArgs([])).toEqual({ command: "help" });
    expect(parseArgs(["--help"])).toEqual({ command: "help" });
    expect(parseArgs(["import", "--help"])).toEqual({ command: "help" });
  });

  it.each([
    [["export", ...base], "Unknown command"],
    [["import", ...base, "--target", "stock"], "--file is required"],
    [["import", "--as", "a@b.test", "--target", "stock", "--file", "a.xlsx"], "--workspace is required"],
    [["import", ...base, "--target", "people", "--file", "a.xlsx"], "--target is stock, catalog or suppliers"],
    [["import", ...base, "--target", "stock", "--file", "a.xls"], ".xlsx, .csv or .tsv"],
    [["import", ...base, "--target", "stock", "--file", "a.xlsx", "--legal-entity", "PLM"], "--legal-entity does not apply to --target stock"],
    [["import", ...base, "--target", "catalog", "--file", "a.xlsx", "--pictures"], "--pictures is added with --apply"],
    [["import", ...base, "--target", "catalog", "--file", "a.xlsx", "--apply", "--dry-run"], "either --apply or --dry-run"],
    [["import", ...base, "--target", "catalog", "--file"], "--file needs a value"],
    [["import", ...base, "--target", "catalog", "--file", "a.xlsx", "--force"], "Unknown option --force"],
    [["configure", ...base], "--profile is required"],
    [["configure", ...base, "--profile", "p.json", "--target", "stock"], "--target does not apply to configure"],
    [["configure", "--workspace", "Palm Living", "--as", "a@b.test", "--profile", "p.json"], "workspace slug"],
    [["configure", "--workspace", "palm", "--as", "not-an-email", "--profile", "p.json"], "--as is the email"],
  ])("refuses %j", (argv, message) => {
    expect(() => parseArgs(argv as string[])).toThrow(UsageError);
    expect(() => parseArgs(argv as string[])).toThrow(message as string);
  });

  it("reads --mapping overrides as headings to fields", () => {
    expect(parseMappingOverrides("{\"ITEM\": \"description\", \"DESCRIPTION\": \"name\", \"REMARKS\": null}")).toEqual({ columns: { ITEM: "description", DESCRIPTION: "name", REMARKS: "" } });
    expect(parseMappingOverrides("{\"columns\": {\"Name\": \"name\"}, \"entities\": {\"Tab\": \"PLM\"}}")).toEqual({ columns: { Name: "name" }, entities: { Tab: "PLM" } });
    expect(() => parseMappingOverrides("[1]")).toThrow(UsageError);
    expect(() => parseMappingOverrides("{\"A\": 1}")).toThrow("maps to a field name");
    expect(() => parseMappingOverrides("{\"columns\": {}, \"tabs\": []}")).toThrow("unknown keys");
    expect(listOf(" a , ,b,a ")).toEqual(["a", "b"]);
  });
});

describe("import planning", () => {
  const sheets = [
    { name: "PLM Manu Prefered Suppliers ", rows: [["Company Name", "Email"], ["Example", "x@example.test"]] },
    { name: "Average spends 6 months", hidden: true, rows: [["Company Name", "Average"]] },
    { name: "bank", rows: [["Date", "Supplier", "Amount"]] },
  ];

  it("chooses the tabs the sheet shows, less those excluded; named tabs as written", () => {
    expect(pickTabs(sheets, null, [])).toEqual(["PLM Manu Prefered Suppliers ", "bank"]);
    expect(pickTabs(sheets, null, ["BANK", "Average spends 6 months"])).toEqual(["PLM Manu Prefered Suppliers "]);
    expect(pickTabs(sheets, ["plm manu prefered suppliers", "Average spends 6 months"], [])).toEqual(["PLM Manu Prefered Suppliers ", "Average spends 6 months"]);
    expect(() => pickTabs(sheets, ["Nope"], [])).toThrow("no tab \"Nope\"");
    expect(() => pickTabs(sheets, null, ["PLM Manu Prefered Suppliers", "bank"])).toThrow("No tab is left");
    expect(pickTabs([sheets[0]], null, [])).toBeUndefined();
    expect(() => pickTabs([sheets[0]], null, ["PLM Manu Prefered Suppliers"])).toThrow("one tab");
  });

  it("guesses the mapping like the Import dialog and applies overrides", () => {
    const catalog = [{ name: "Sofa", rows: [["SOFA"], [], ["REMARKS", "ITEM", "DESCRIPTION", "PRICE (AED)"], ["", "Sofa 1", "Aria Sofa", "100"]] }];
    expect(buildMapping("catalog", catalog, undefined, {}, false)).toEqual({ columns: { REMARKS: "description", ITEM: "name", "PRICE (AED)": "price" } });
    expect(buildMapping("catalog", catalog, undefined, { ITEM: "description", DESCRIPTION: "name" }, false))
      .toEqual({ columns: { "PRICE (AED)": "price", ITEM: "description", DESCRIPTION: "name" } });
    expect(buildMapping("suppliers", sheets, ["bank"], {}, true)).toMatchObject({ tabs: ["bank"], fillOnly: true });
    expect(() => buildMapping("catalog", catalog, undefined, { ITEM: "colour" }, false)).toThrow("not a catalog field");
  });

  it("groups error reasons without the values they quote", () => {
    expect(errorReason("Cost isn't a number (abc).")).toBe("Cost isn't a number (…).");
    expect(errorReason("Unit \"boxes\" is not known")).toBe("Unit \"…\" is not known");
    expect(errorReason("")).toBe("Wodana couldn't save this row.");
  });
});
