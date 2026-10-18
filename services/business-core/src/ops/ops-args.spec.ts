import { describe, expect, it } from "vitest";
import { listOf, parseArgs, parseMappingOverrides, USAGE, UsageError } from "./ops-args";
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
    expect(parseArgs(["configure", ...base, "--profile", "p.json", "--json"])).toEqual({ command: "configure", workspace: "palm-living", as: "owner@example.test", apply: false, json: true,
      profile: "p.json", teams: null, packages: null });
  });

  it("parses configure with a teams access file and a design packages file, with or without a profile", () => {
    expect(parseArgs(["configure", ...base, "--teams", "teams.json", "--packages", "packages.json", "--profile", "p.json", "--apply"])).toEqual({ command: "configure",
      workspace: "palm-living", as: "owner@example.test", apply: true, json: false, profile: "p.json", teams: "teams.json", packages: "packages.json" });
    expect(parseArgs(["configure", ...base, "--teams", "teams.json"])).toMatchObject({ profile: null, teams: "teams.json", packages: null, apply: false });
    expect(parseArgs(["configure", ...base, "--packages", " packages.json "])).toMatchObject({ profile: null, teams: null, packages: "packages.json" });
    expect(USAGE).toContain("[--packages <design-packages.json>]");
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
    [["configure", ...base], "configure needs --profile, --teams or --packages"],
    [["configure", ...base, "--teams"], "--teams needs a value"],
    [["configure", ...base, "--packages", "--apply"], "--packages needs a value"],
    [["configure", ...base, "--packages", "  "], "--packages is required"],
    [["configure", ...base, "--teams", "a.json", "--teams", "b.json"], "--teams is given twice"],
    [["configure", ...base, "--teams", "t.json", "--password-env", "PASSWORD"], "--password-env does not apply to configure"],
    [["sandbox", "--slug", "iglo", "--name", "Igolo Test", "--region", "AE", "--packages", "p.json"], "--packages does not apply to sandbox"],
    [["import", ...base, "--target", "stock", "--file", "a.xlsx", "--packages", "p.json"], "--packages does not apply to --target stock"],
    [["configure", ...base, "--profile", "p.json", "--target", "stock"], "--target does not apply to configure"],
    [["configure", "--workspace", "Palm Living", "--as", "a@b.test", "--profile", "p.json"], "workspace slug"],
    [["configure", "--workspace", "palm", "--as", "not-an-email", "--profile", "p.json"], "--as is the email"],
  ])("refuses %j", (argv, message) => {
    expect(() => parseArgs(argv as string[])).toThrow(UsageError);
    expect(() => parseArgs(argv as string[])).toThrow(message as string);
  });

  const sandbox = ["sandbox", "--slug", "iglo", "--name", "Igolo Test", "--region", "ae"];

  it("parses sandbox: a dry run unless --apply, region upper-cased, files and the password's variable optional", () => {
    expect(parseArgs(sandbox)).toEqual({ command: "sandbox", slug: "iglo", name: "Igolo Test", region: "AE", profile: null, teams: null, crm: null, passwordEnv: null,
      kit: null, organizationOf: null, emailPattern: null, seed: false, scenarios: false, apply: false, json: false });
    expect(parseArgs([...sandbox, "--profile", "p.json", "--teams", "t.json", "--crm", "c.json", "--password-env", "SANDBOX_PASSWORD", "--kit", "design_build", "--seed",
      "--apply", "--json"]))
      .toEqual({ command: "sandbox", slug: "iglo", name: "Igolo Test", region: "AE", profile: "p.json", teams: "t.json", crm: "c.json", passwordEnv: "SANDBOX_PASSWORD",
        kit: "design_build", organizationOf: null, emailPattern: null, seed: true, scenarios: false, apply: true, json: true });
    expect(parseArgs(["sandbox", "--slug", "Test-Studio-2", "--name", "  Test Studio ", "--region", "GB"])).toMatchObject({ slug: "test-studio-2", name: "Test Studio" });
    expect(parseArgs(["sandbox", "--help"])).toEqual({ command: "help" });
  });

  const organization = ["sandbox", "--slug", "iglo-india", "--name", "Igolo India", "--region", "in", "--organization-of", "Iglo"];

  it("parses --organization-of: another organization in an existing sandbox's account, for the same test members", () => {
    expect(parseArgs([...organization, "--profile", "p.json", "--teams", "t.json", "--crm", "c.json", "--seed", "--apply"])).toEqual({
      command: "sandbox", slug: "iglo-india", name: "Igolo India", region: "IN", profile: "p.json", teams: "t.json", crm: "c.json", passwordEnv: null,
      kit: null, organizationOf: "iglo", emailPattern: null, seed: true, scenarios: false, apply: true, json: false });
    expect(parseArgs(organization)).toMatchObject({ organizationOf: "iglo", apply: false });
  });

  it("parses --scenarios, which implies --seed, for a sandbox and for an added organization", () => {
    expect(parseArgs(["sandbox", "--slug", "igolo", "--name", "Igolo UAE", "--region", "AE", "--scenarios"])).toMatchObject({ seed: true, scenarios: true, apply: false });
    expect(parseArgs([...organization, "--scenarios", "--apply"])).toMatchObject({ organizationOf: "iglo", seed: true, scenarios: true, apply: true });
    expect(parseArgs(["sandbox", "--slug", "igolo", "--name", "Igolo UAE", "--region", "AE", "--seed"])).toMatchObject({ seed: true, scenarios: false });
  });

  it.each([
    [["sandbox", "--slug", "iglo-india", "--name", "Igolo India", "--organization-of", "iglo"], "--region is required"],
    [["sandbox", "--name", "Igolo India", "--region", "IN", "--organization-of", "iglo"], "--slug is required"],
    [[...organization.slice(0, -1), "iglo india"], "--organization-of is the slug of the sandbox"],
    [[...organization.slice(0, -1), "-iglo"], "--organization-of is the slug of the sandbox"],
    [[...organization.slice(0, -1), "admin"], "--organization-of is the slug of the sandbox"],
    [[...organization.slice(0, -1), "iglo-india"], "--organization-of is another sandbox than --slug"],
    [[...organization, "--password-env", "SANDBOX_PASSWORD"], "--password-env does not apply with --organization-of"],
    [[...organization, "--kit", "design_build"], "--kit does not apply with --organization-of"],
    [[...organization, "--organization-of", "other"], "--organization-of is given twice"],
    [["sandbox", "--slug", "iglo-india", "--name", "Igolo India", "--region", "IN", "--organization-of"], "--organization-of needs a value"],
  ])("refuses --organization-of %j", (argv, message) => {
    expect(() => parseArgs(argv as string[])).toThrow(UsageError);
    expect(() => parseArgs(argv as string[])).toThrow(message as string);
  });

  it("parses --retire and --restore: the sandbox's slug only, a dry run unless --apply", () => {
    expect(parseArgs(["sandbox", "--slug", "Iglo", "--retire"])).toEqual({ command: "sandbox", lifecycle: "retire", slug: "iglo", apply: false, json: false });
    expect(parseArgs(["sandbox", "--retire", "--slug", "igolo", "--apply", "--json"])).toEqual({ command: "sandbox", lifecycle: "retire", slug: "igolo", apply: true, json: true });
    expect(parseArgs(["sandbox", "--slug", "igolo", "--restore", "--dry-run"])).toEqual({ command: "sandbox", lifecycle: "restore", slug: "igolo", apply: false, json: false });
    // Without --retire or --restore, the sandbox command is unchanged.
    expect(parseArgs(sandbox)).not.toHaveProperty("lifecycle");
    expect(USAGE).toContain("--retire|--restore");
  });

  it.each([
    [["sandbox", "--slug", "iglo", "--retire", "--restore"], "Choose either --retire or --restore"],
    [["sandbox", "--retire"], "--slug is required"],
    [["sandbox", "--slug", "iglo test", "--retire"], "--slug is the sandbox's login name"],
    [["sandbox", "--slug", "admin", "--restore"], "reserved"],
    [["sandbox", "--slug", "iglo", "--retire", "--apply", "--dry-run"], "either --apply or --dry-run"],
    [[...sandbox, "--retire"], "--name does not apply to --retire"],
    [["sandbox", "--slug", "iglo-india", "--retire", "--organization-of", "iglo"], "--organization-of does not apply to --retire"],
    [["sandbox", "--slug", "iglo", "--restore", "--email-pattern", "a+{role}@x.com"], "--email-pattern does not apply to --restore"],
    [["sandbox", "--slug", "iglo", "--retire", "--password-env", "SANDBOX_PASSWORD"], "--password-env does not apply to --retire"],
    [["sandbox", "--slug", "iglo", "--retire", "--scenarios"], "--scenarios does not apply to --retire"],
    [["import", ...base, "--target", "stock", "--file", "a.csv", "--retire"], "--retire does not apply to --target stock"],
    [["configure", ...base, "--profile", "p.json", "--restore"], "--restore does not apply to configure"],
  ])("refuses --retire/--restore %j", (argv, message) => {
    expect(() => parseArgs(argv as string[])).toThrow(UsageError);
    expect(() => parseArgs(argv as string[])).toThrow(message as string);
  });

  it("parses --email-pattern: each test member's sign-in address, with or without --organization-of", () => {
    expect(parseArgs([...sandbox, "--email-pattern", "wodanatechnology+{role}@gmail.com"])).toMatchObject({ emailPattern: "wodanatechnology+{role}@gmail.com", apply: false });
    expect(parseArgs([...sandbox, "--email-pattern", "  WodanaTechnology+{ROLE}@Gmail.com "])).toMatchObject({ emailPattern: "wodanatechnology+{role}@gmail.com" });
    expect(parseArgs([...sandbox, "--email-pattern", "{role}@studio.test", "--apply"])).toMatchObject({ emailPattern: "{role}@studio.test", apply: true });
    expect(parseArgs([...organization, "--email-pattern", "qa.{role}@example.com"])).toMatchObject({ emailPattern: "qa.{role}@example.com", organizationOf: "iglo" });
    expect(parseArgs(sandbox)).toMatchObject({ emailPattern: null });
  });

  it.each([
    ["wodanatechnology@gmail.com", "{role} once"],
    ["{role}+{role}@gmail.com", "{role} once"],
    ["wodana+role@gmail.com", "{role} once"],
    ["test@{role}.example.com", "before the @"],
    ["wodanatechnology+{role}", "valid address"],
    ["wodanatechnology+{role}@gmail", "valid address"],
    ["wodana technology+{role}@gmail.com", "valid address"],
    ["a@b+{role}@gmail.com", "valid address"],
    ["wodana+{role}{n}@gmail.com", "no other braces"],
    ["\"wodana {role}\"@gmail.com", "valid address"],
    [`${"a".repeat(50)}+{role}@gmail.com`, "valid address"],
  ])("refuses --email-pattern %j", (pattern, message) => {
    expect(() => parseArgs([...sandbox, "--email-pattern", pattern])).toThrow(UsageError);
    expect(() => parseArgs([...sandbox, "--email-pattern", pattern])).toThrow(message);
  });

  it("refuses --email-pattern without a value or twice", () => {
    expect(() => parseArgs([...sandbox, "--email-pattern"])).toThrow("--email-pattern needs a value");
    expect(() => parseArgs([...sandbox, "--email-pattern", "a+{role}@x.com", "--email-pattern", "b+{role}@x.com"])).toThrow("--email-pattern is given twice");
    expect(() => parseArgs(["configure", ...base, "--profile", "p.json", "--email-pattern", "a+{role}@x.com"])).toThrow("--email-pattern does not apply to configure");
  });

  it.each([
    [["sandbox", "--name", "Igolo Test", "--region", "AE"], "--slug is required"],
    [["sandbox", "--slug", "iglo", "--region", "AE"], "--name is required"],
    [["sandbox", "--slug", "iglo", "--name", "Igolo Test"], "--region is required"],
    [["sandbox", "--slug", "iglo test", "--name", "Igolo Test", "--region", "AE"], "--slug is the sandbox's login name"],
    [["sandbox", "--slug", "-iglo", "--name", "Igolo Test", "--region", "AE"], "--slug is the sandbox's login name"],
    [["sandbox", "--slug", "iglo--test", "--name", "Igolo Test", "--region", "AE"], "--slug is the sandbox's login name"],
    [["sandbox", "--slug", "iglo_test", "--name", "Igolo Test", "--region", "AE"], "--slug is the sandbox's login name"],
    [["sandbox", "--slug", "a", "--name", "Igolo Test", "--region", "AE"], "--slug is the sandbox's login name"],
    [["sandbox", "--slug", `a${"b".repeat(40)}`, "--name", "Igolo Test", "--region", "AE"], "--slug is the sandbox's login name"],
    [["sandbox", "--slug", "admin", "--name", "Igolo Test", "--region", "AE"], "reserved"],
    [["sandbox", "--slug", "iglo", "--name", "I", "--region", "AE"], "--name is 2 to 160 characters"],
    [["sandbox", "--slug", "iglo", "--name", "Igolo Test", "--region", "UAE"], "--region is a two-letter country code"],
    [["sandbox", "--slug", "iglo", "--name", "Igolo Test", "--region", "A1"], "--region is a two-letter country code"],
    [[...sandbox, "--password-env", "Secret#2026!"], "--password-env is the name of an environment variable"],
    [[...sandbox, "--kit", "Design Build"], "--kit is a firm kit code"],
    [[...sandbox, "--workspace", "iglo"], "--workspace does not apply to sandbox"],
    [[...sandbox, "--as", "owner@iglo.test"], "--as does not apply to sandbox"],
    [[...sandbox, "--file", "a.xlsx"], "--file does not apply to sandbox"],
    [[...sandbox, "--pictures"], "--pictures does not apply to sandbox"],
    [[...sandbox, "--owner", "x@y.test"], "Unknown option --owner"],
    [[...sandbox, "--password", "Secret#2026!"], "Unknown option --password"],
    [[...sandbox, "--slug", "other"], "--slug is given twice"],
    [[...sandbox, "--password-env", "--seed"], "--password-env needs a value"],
    [[...sandbox, "--apply", "--dry-run"], "either --apply or --dry-run"],
    [["configure", ...base, "--profile", "p.json", "--seed"], "--seed does not apply to configure"],
    [["configure", ...base, "--profile", "p.json", "--crm", "c.json"], "--crm does not apply to configure"],
    [["import", ...base, "--target", "stock", "--file", "a.xlsx", "--slug", "iglo"], "--slug does not apply to --target stock"],
  ])("refuses sandbox %j", (argv, message) => {
    expect(() => parseArgs(argv as string[])).toThrow(UsageError);
    expect(() => parseArgs(argv as string[])).toThrow(message as string);
  });

  it("documents the sandbox command in the usage text", () => {
    expect(USAGE).toContain("node dist/ops/ops-cli.js sandbox --slug <slug> --name \"<name>\" --region <country code>");
    expect(USAGE).toContain("--password-env <ENV VAR>");
    expect(USAGE).toContain("--crm <crm-intake-profile.json>");
    expect(USAGE).toContain("--organization-of <sandbox slug>");
    expect(USAGE).toContain("--email-pattern \"<local>+{role}@<domain>\"");
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
