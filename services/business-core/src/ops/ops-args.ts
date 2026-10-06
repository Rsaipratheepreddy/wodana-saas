/** The operator CLI's command line: parsed and checked before anything connects to the database. */

export class UsageError extends Error {}

export type ImportTargetArg = "stock" | "catalog" | "suppliers";
type Common = { workspace: string; as: string; apply: boolean; json: boolean };
export type ImportArgs = Common & {
  command: "import"; target: ImportTargetArg; file: string; tabs: string[] | null; excludeTabs: string[]; mapping: string | null;
  legalEntity: string | null; fillOnly: boolean; catalog: string | null; location: string | null; name: string | null; itemType: string | null;
  setsStock: boolean; pictures: boolean;
};
export type ConfigureArgs = Common & { command: "configure"; profile: string };
export type OpsArgs = ImportArgs | ConfigureArgs | { command: "help" };

export const USAGE = `Wodana operator CLI: a workspace's go-live import and configuration, run on the server through the app's own
services as a named workspace member. Every command is a dry run unless --apply is given.

Usage:
  node dist/ops/ops-cli.js import --workspace <slug> --as <member email> --target stock|catalog|suppliers --file <path.xlsx|csv>
      [--tabs "A,B"] [--exclude-tabs "A,B"] [--mapping <json or file>] [--legal-entity <code>] [--fill-only]
      [--catalog <code|name>] [--location <place name>] [--name <import name>] [--item-type <kind>] [--no-sets-stock]
      [--pictures] [--apply] [--json]
  node dist/ops/ops-cli.js configure --workspace <slug> --as <member email> --profile <profile.json> [--apply] [--json]
  node dist/ops/ops-cli.js --help

import
  Reads the file the way the browser does, guesses the column mapping like the Import dialog, previews and (with --apply)
  applies through the linked-import engine. The import link and its run are recorded as if made in the app, so the link
  can be refreshed from a new upload there; a second run of the same file updates the same link (matched by name).
  --tabs              only these tabs (default: every tab the sheet shows; hidden tabs are left out)
  --exclude-tabs      leave these tabs out
  --mapping           column overrides as {"Heading": "field"} (or {"columns": {...}}); "" leaves a column out.
                      Fields: stock code,name,unit,quantity,usedQuantity,size,colour,location,cost;
                      catalog code,name,category,unit,type,description,cost,price,productionDays,technicalDrawing,
                      height,width,depth,attribute; suppliers code,name,legalName,contactName,phone,contact,email,
                      address,taxNumber,paymentTerms,categories,notes,attribute
  --legal-entity      suppliers: the company (legal entity code) the suppliers sell to
  --fill-only         suppliers: only fill in what known suppliers are missing
  --catalog           catalog: the catalogue to import into (default: the only active one)
  --location          stock: the place the quantities are at (default: the default place)
  --name              the import's name (default: the file name without its extension)
  --item-type         catalog: what new items are (product, material, assembly, service, package, ready_made)
  --no-sets-stock     stock: the sheet doesn't set quantities
  --pictures          catalog, with --apply: add each row's picture to its item when the item has none

configure
  Applies a workspace configuration profile (JSON) through the settings commands. Sections the profile leaves out are
  skipped; a second run changes nothing. See docs/fixtures/palm-golive-config.json.

Output is counts and messages only. Exit code 0 when everything succeeded, 1 when anything failed, 2 for usage errors.`;

const FLAGS = new Set(["--apply", "--dry-run", "--json", "--fill-only", "--no-sets-stock", "--pictures", "--help", "-h"]);
const OPTIONS = new Set(["--workspace", "--as", "--target", "--file", "--tabs", "--exclude-tabs", "--mapping", "--legal-entity", "--catalog", "--location", "--name",
  "--item-type", "--profile"]);
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ITEM_TYPES = ["product", "material", "assembly", "service", "package", "ready_made"];

/** A comma-separated list of names ("A, B"), trimmed, without blanks or repeats. */
export const listOf = (value: string) => [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))];

export function parseArgs(argv: string[]): OpsArgs {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") return { command: "help" };
  if (command !== "import" && command !== "configure") throw new UsageError(`Unknown command ${command}. Use import or configure.`);
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (FLAGS.has(arg)) { flags.add(arg); continue; }
    if (!OPTIONS.has(arg)) throw new UsageError(`Unknown option ${arg}.`);
    const value = rest[index + 1];
    if (value === undefined || (value.startsWith("--") && OPTIONS.has(value)) || FLAGS.has(value)) throw new UsageError(`${arg} needs a value.`);
    if (values.has(arg)) throw new UsageError(`${arg} is given twice.`);
    values.set(arg, value);
    index += 1;
  }
  if (flags.has("--help") || flags.has("-h")) return { command: "help" };
  if (flags.has("--apply") && flags.has("--dry-run")) throw new UsageError("Choose either --apply or --dry-run.");
  const required = (name: string) => {
    const value = values.get(name)?.trim();
    if (!value) throw new UsageError(`${name} is required.`);
    return value;
  };
  const workspace = required("--workspace").toLowerCase();
  if (!SLUG.test(workspace)) throw new UsageError("--workspace is a workspace slug (lowercase letters, digits and dashes).");
  const as = required("--as").toLowerCase();
  if (!EMAIL.test(as)) throw new UsageError("--as is the email of an active member of the workspace.");
  const common: Common = { workspace, as, apply: flags.has("--apply"), json: flags.has("--json") };
  const only = (allowed: string[], what: string) => {
    for (const name of [...values.keys(), ...flags]) {
      if (["--workspace", "--as", "--apply", "--dry-run", "--json", ...allowed].includes(name)) continue;
      throw new UsageError(`${name} does not apply to ${what}.`);
    }
  };

  if (command === "configure") {
    only(["--profile"], "configure");
    return { command, ...common, profile: required("--profile") };
  }

  const target = required("--target");
  if (target !== "stock" && target !== "catalog" && target !== "suppliers") throw new UsageError("--target is stock, catalog or suppliers.");
  const perTarget: Record<ImportTargetArg, string[]> = {
    stock: ["--location", "--no-sets-stock"],
    catalog: ["--catalog", "--item-type", "--pictures"],
    suppliers: ["--legal-entity", "--fill-only"],
  };
  only(["--target", "--file", "--tabs", "--exclude-tabs", "--mapping", "--name", ...perTarget[target]], `--target ${target}`);
  const file = required("--file");
  if (!/\.(xlsx|csv|tsv|txt)$/i.test(file)) throw new UsageError("--file is an .xlsx, .csv or .tsv file.");
  const tabs = values.has("--tabs") ? listOf(values.get("--tabs")!) : null;
  if (tabs && !tabs.length) throw new UsageError("--tabs names at least one tab.");
  const itemType = values.get("--item-type")?.trim() ?? null;
  if (itemType && !ITEM_TYPES.includes(itemType)) throw new UsageError(`--item-type is one of ${ITEM_TYPES.join(", ")}.`);
  const name = values.get("--name")?.trim() ?? null;
  if (name !== null && (!name || name.length > 200)) throw new UsageError("--name is 1 to 200 characters.");
  if (flags.has("--pictures") && !flags.has("--apply")) throw new UsageError("--pictures is added with --apply.");
  return {
    command, ...common, target, file, tabs, excludeTabs: values.has("--exclude-tabs") ? listOf(values.get("--exclude-tabs")!) : [],
    mapping: values.get("--mapping") ?? null, legalEntity: values.get("--legal-entity")?.trim() || null, fillOnly: flags.has("--fill-only"),
    catalog: values.get("--catalog")?.trim() || null, location: values.get("--location")?.trim() || null, name, itemType,
    setsStock: !flags.has("--no-sets-stock"), pictures: flags.has("--pictures"),
  };
}

/** --mapping: inline JSON or a JSON file's text, as heading → field overrides (with the tabs' companies for suppliers). */
export function parseMappingOverrides(text: string): { columns: Record<string, string>; entities?: Record<string, string> } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new UsageError("--mapping is not valid JSON."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new UsageError("--mapping is a JSON object of column headings to fields.");
  const object = raw as Record<string, unknown>;
  const nested = object.columns !== undefined;
  const columns = nested ? object.columns : object;
  if (!columns || typeof columns !== "object" || Array.isArray(columns)) throw new UsageError("--mapping columns is an object of column headings to fields.");
  const result: Record<string, string> = {};
  for (const [heading, field] of Object.entries(columns as Record<string, unknown>)) {
    if (!heading.trim()) throw new UsageError("--mapping has an empty column heading.");
    if (field !== null && typeof field !== "string") throw new UsageError(`--mapping: "${heading}" maps to a field name or "".`);
    result[heading.trim()] = (field ?? "").trim();
  }
  if (nested) {
    const extra = Object.keys(object).filter((key) => key !== "columns" && key !== "entities");
    if (extra.length) throw new UsageError(`--mapping has unknown keys: ${extra.join(", ")}.`);
  }
  return nested && object.entities !== undefined ? { columns: result, entities: object.entities as Record<string, string> } : { columns: result };
}
