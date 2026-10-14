/** The operator CLI's command line: parsed and checked before anything connects to the database. */
import { isEmail } from "class-validator";
import { RESERVED_SLUGS } from "../workspaces/reserved-slugs";
import { patternEmail, ROLE_PLACEHOLDER, SANDBOX_PERSONAS } from "./ops-sandbox-plan";

export class UsageError extends Error {}

export type ImportTargetArg = "stock" | "catalog" | "suppliers";
type Common = { workspace: string; as: string; apply: boolean; json: boolean };
export type ImportArgs = Common & {
  command: "import"; target: ImportTargetArg; file: string; tabs: string[] | null; excludeTabs: string[]; mapping: string | null;
  legalEntity: string | null; fillOnly: boolean; catalog: string | null; location: string | null; name: string | null; itemType: string | null;
  setsStock: boolean; pictures: boolean;
  /** Catalog: the file's prices are approved list prices (live at once); left out, the link keeps its setting. */
  approvedPrices: boolean;
};
/**
 * `configure`: a profile's sections, a teams access file and a design packages file (at least one), applied to an
 * existing workspace; the teams and packages are only added or updated, never removed.
 */
export type ConfigureArgs = Common & { command: "configure"; profile: string | null; teams: string | null; packages: string | null };
/** A test workspace with one member per role (ops-sandbox.ts); no --workspace or --as: the workspace may not exist yet. */
export type SandboxArgs = {
  command: "sandbox"; slug: string; name: string; region: string; profile: string | null; teams: string | null;
  /** A CRM intake profile whose lead options (sources, channels, enquiry types, …) the sandbox gets. */
  crm: string | null;
  /** The name of the environment variable that holds the members' password; never the password. */
  passwordEnv: string | null;
  /** A firm kit code; left out, the sandbox default. */
  kit: string | null;
  /**
   * The slug of an existing sandbox: --slug is then another organization in that sandbox's customer account, for the
   * same test members (<role>@<that slug>.test), switched to with the organization switcher.
   */
  organizationOf: string | null;
  /**
   * The test members' sign-in addresses, with {role} for each member's role key (e.g. wodanatechnology+{role}@gmail.com),
   * lower case. Existing members are moved to them; left out, the sandbox keeps the scheme it has.
   */
  emailPattern: string | null;
  seed: boolean;
  /** Demo data for every main scenario (src/ops/scenarios); implies seed. */
  scenarios: boolean;
  apply: boolean; json: boolean;
};
/**
 * `sandbox --slug <slug> --retire|--restore` (ops-sandbox.ts): a sandbox this command made, with every organization of
 * its customer account, archived (kept, out of use and billing) or made active again.
 */
export type SandboxLifecycleArgs = { command: "sandbox"; lifecycle: "retire" | "restore"; slug: string; apply: boolean; json: boolean };
export type OpsArgs = ImportArgs | ConfigureArgs | SandboxArgs | SandboxLifecycleArgs | { command: "help" };

export const USAGE = `Wodana operator CLI: a workspace's go-live import and configuration, run on the server through the app's own
services as a named workspace member, and test sandboxes. Every command is a dry run unless --apply is given.

Usage:
  node dist/ops/ops-cli.js import --workspace <slug> --as <member email> --target stock|catalog|suppliers --file <path.xlsx|csv>
      [--tabs "A,B"] [--exclude-tabs "A,B"] [--mapping <json or file>] [--legal-entity <code>] [--fill-only]
      [--catalog <code|name>] [--location <place name>] [--name <import name>] [--item-type <kind>] [--no-sets-stock]
      [--pictures] [--approved-prices] [--apply] [--json]
  node dist/ops/ops-cli.js configure --workspace <slug> --as <member email> [--profile <profile.json>] [--teams <teams-access.json>]
      [--packages <design-packages.json>] [--apply] [--json]
  node dist/ops/ops-cli.js sandbox --slug <slug> --name "<name>" --region <country code> [--profile <profile.json>]
      [--teams <teams-access.json>] [--crm <crm-intake-profile.json>] [--password-env <ENV VAR>] [--kit <firm kit code>]
      [--email-pattern "<local>+{role}@<domain>"] [--seed] [--scenarios] [--apply] [--json]
  node dist/ops/ops-cli.js sandbox --slug <slug> --name "<name>" --region <country code> --organization-of <sandbox slug>
      [--profile <profile.json>] [--teams <teams-access.json>] [--crm <crm-intake-profile.json>]
      [--email-pattern "<local>+{role}@<domain>"] [--seed] [--scenarios] [--apply] [--json]
  node dist/ops/ops-cli.js sandbox --slug <sandbox slug> --retire|--restore [--apply] [--json]
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
  --approved-prices   catalog: the file's prices are approved list prices: they go live in the catalogue's default price
                      book (put in use if needed) instead of waiting in draft, and drafts of prices the file repeats are
                      approved. The member needs commercial.estimate and catalog.manage. The link keeps the setting for
                      later refreshes; without the flag a re-run keeps what the link has.

configure
  Applies a workspace configuration profile (JSON) through the settings commands. Sections the profile leaves out are
  skipped; a second run changes nothing. See docs/fixtures/palm-golive-config.json. Needs at least one of:
  --profile       a configuration profile
  --teams         a teams access file (e.g. docs/fixtures/palm-teams-access.json), additive only: a missing team is
                  created with its role (team_<code>, or a role the workspace has with the team's name) and no members,
                  and a team's role missing some of the file's permissions gets them. No team, member, role or
                  permission is ever removed and nobody joins or leaves a team. A new team goes in the workspace's first
                  business unit (by name).
  --packages      a design packages file (e.g. docs/fixtures/palm-design-packages.json), matched by code: each package
                  is set to what the file says, as Settings › Design saves it (a field the file leaves out takes the
                  product's default, a currency the workspace's), and only the fields that differ are changed and
                  listed; a missing package is added, and the minimum design deposit is set when the file has one. A
                  package the file doesn't list is left as it is (never archived or deleted); an archived one stays
                  archived.
  The teams and packages go first, then the profile's sections, which name their roles, teams and packages.

sandbox
  A test workspace for end-to-end testing, created (or found) through the same provisioning as Wodana Control: the
  region pack's currency, tax, locale and time zone, a firm kit (default design_build_deal_first, the deal-first
  design & build kit), login at <slug>.<domain>, seats for the test members, and sign-in without an authenticator.
  Refuses a slug that belongs to a workspace it didn't create. Emails are held back while it runs. A second run
  changes nothing. On a sandbox that exists, a different --name renames it (the slug never changes).
  --teams         a teams access file (e.g. docs/fixtures/palm-teams-access.json): a role and a team for each team
  --crm           a CRM intake profile (e.g. docs/fixtures/palm-crm-intake-profile.json), its lead options only:
                  sources, channels, enquiry types, budget ranges, client types and referral lists
  --profile       a configuration profile, applied as configure does
                  From every file, email addresses, web addresses, phone numbers, bank accounts and integration
                  settings are taken out first (each one is listed in the output).
  --password-env  the environment variable that holds the test members' password (never the password itself; it is
                  never printed or stored). Needed while a test member has no password; given again, it resets theirs.
  --kit           a firm kit by code, instead of the default
  --seed          the showcase records for every section, made through the test members' own commands
  --scenarios     (implies --seed) at least one realistic example of every main scenario (enquiries in every state and
                  type, the sales pipeline's stages, a client message waiting, the design fee, design stages, moodboard
                  and site visit, quotations in every status, deal files, planning, projects at each stage of the route
                  and on hold, completed, at risk and over budget, change requests in every state, purchase orders,
                  bills, low stock, factory work orders, deliveries, installation and permits, site reports and snags,
                  client invoices, receipts, refunds, finance requests, petty cash and supplier payments, the Ledger on
                  with its postings, approvals of every kind, My day for each test member and client decisions in the
                  portal), in the organization's own country, currency and people; only what is missing is made, and
                  each scenario is listed with its record. While seeding, every email, WhatsApp and push written for the
                  organization is suppressed (sandbox_seed), counted and audited.
  One active member per role (owner, manager, sales, designer, design manager, QS, purchasing, factory lead,
  logistics, site supervisor, finance, accountant) as <role>@<slug>.test (or --email-pattern's addresses) with the
  workspace's matching roles and teams.
  Prints each member's email, roles and user id (for AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS), never the password.
  --organization-of  another organization in that sandbox's customer account (e.g. one per country): requested by its
                  test owner and approved as Wodana approves an account's additional organization, with this region
                  pack and the sandbox's firm kit and plan. The sandbox's own test members join it with the same roles
                  and teams (no new people, passwords untouched) and switch between the two with the organization
                  switcher; the account's sign-in policy covers both. Refused unless the sandbox and every organization
                  in its account were made by this command. --password-env and --kit don't apply.
  --email-pattern  the test members' sign-in addresses, {role} standing for each member's role key once before the @
                  (e.g. "wodanatechnology+{role}@gmail.com": wodanatechnology+sales@gmail.com, …), so their emails reach
                  a real inbox. A new sandbox's members get them from the start; existing members are moved to them
                  (same people, user ids, passwords, sessions, memberships, roles and teams) in every organization of
                  the sandbox at once, and emails already queued for their old addresses are skipped (never sent to the
                  new ones). The sandbox keeps the pattern: later runs, with it or without, find the same people. Refused
                  for anyone who also belongs to an organization the sandbox didn't make, and for an address someone
                  else signs in with. With --organization-of it is the sandbox's people's addresses (one run covers
                  every organization they belong to).
                  A new sandbox adopts the people of a retired sandbox (--retire) who hold its addresses: the same
                  people (user ids, passwords, sessions) join it with its roles and teams, and nobody new is made for
                  them, so --password-env is needed only for anyone new. Anyone with an active membership in an
                  organization that is not a retired sandbox's is still refused.
  --retire        retires a sandbox this command made with every organization of its customer account (those added
                  with --organization-of too; name the sandbox's own --slug). Each organization is archived: nobody
                  signs in to it, its login address answers "This login address is not active", it leaves the
                  organization switcher, and no reminder, Ledger, CRM, import, outbox or control-plane job runs for it.
                  Its waiting emails, WhatsApp and push messages are suppressed (sandbox_retired), its integration
                  connections revoked, and its account leaves Wodana's billing: collection state closed, subscriptions
                  cancelled, allocations ended, and no usage snapshot, billing document, contract or allocation is
                  recorded for it while it is retired. Nothing is deleted: every record, person, file and audit row
                  stays. Refused for anything this command didn't make. Takes only --slug, --apply and --json.
  --restore       makes a retired sandbox active again: its organizations and account active, its billing as it was
                  before (connections stay revoked: reconnect them in Integrations). Messages suppressed stay so.

Output is counts and messages only. Exit code 0 when everything succeeded, 1 when anything failed, 2 for usage errors.`;

const FLAGS = new Set(["--apply", "--dry-run", "--json", "--fill-only", "--no-sets-stock", "--pictures", "--approved-prices", "--seed", "--scenarios", "--retire",
  "--restore", "--help", "-h"]);
const OPTIONS = new Set(["--workspace", "--as", "--target", "--file", "--tabs", "--exclude-tabs", "--mapping", "--legal-entity", "--catalog", "--location", "--name",
  "--item-type", "--profile", "--slug", "--region", "--teams", "--crm", "--password-env", "--kit", "--organization-of", "--email-pattern",
  "--packages"]);
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ITEM_TYPES = ["product", "material", "assembly", "service", "package", "ready_made"];

/** A comma-separated list of names ("A, B"), trimmed, without blanks or repeats. */
export const listOf = (value: string) => [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))];

export function parseArgs(argv: string[]): OpsArgs {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") return { command: "help" };
  if (command !== "import" && command !== "configure" && command !== "sandbox") throw new UsageError(`Unknown command ${command}. Use import, configure or sandbox.`);
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
  if (command === "sandbox") return parseSandbox(values, flags, required);
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
    only(["--profile", "--teams", "--packages"], "configure");
    const file = (name: string) => (values.has(name) ? required(name) : null);
    const [profile, teams, packages] = [file("--profile"), file("--teams"), file("--packages")];
    if (!profile && !teams && !packages) throw new UsageError("configure needs --profile, --teams or --packages (one or more).");
    return { command, ...common, profile, teams, packages };
  }

  const target = required("--target");
  if (target !== "stock" && target !== "catalog" && target !== "suppliers") throw new UsageError("--target is stock, catalog or suppliers.");
  const perTarget: Record<ImportTargetArg, string[]> = {
    stock: ["--location", "--no-sets-stock"],
    catalog: ["--catalog", "--item-type", "--pictures", "--approved-prices"],
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
    setsStock: !flags.has("--no-sets-stock"), pictures: flags.has("--pictures"), approvedPrices: flags.has("--approved-prices"),
  };
}

const SANDBOX_OPTIONS = ["--slug", "--name", "--region", "--profile", "--teams", "--crm", "--password-env", "--kit", "--organization-of", "--email-pattern", "--seed", "--scenarios", "--apply",
  "--dry-run", "--json"];
const STORED_ADDRESS = /^[^@\s{}]+@[^@\s{}]+\.[^@\s{}]+$/;
/** A login slug that is also a DNS label and makes valid test addresses (<role>@<slug>.test). */
const LOGIN_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const LIFECYCLE_OPTIONS = ["--slug", "--retire", "--restore", "--apply", "--dry-run", "--json"];

function sandboxSlug(required: (name: string) => string) {
  const slug = required("--slug").toLowerCase();
  if (!LOGIN_SLUG.test(slug) || slug.length < 2 || slug.length > 40)
    throw new UsageError("--slug is the sandbox's login name: 2 to 40 lowercase letters and digits, single dashes between them (e.g. demo).");
  if (RESERVED_SLUGS.has(slug)) throw new UsageError(`--slug ${slug} is reserved for the platform; choose another.`);
  return slug;
}

function parseSandbox(values: Map<string, string>, flags: Set<string>, required: (name: string) => string): SandboxArgs | SandboxLifecycleArgs {
  if (flags.has("--retire") || flags.has("--restore")) {
    if (flags.has("--retire") && flags.has("--restore")) throw new UsageError("Choose either --retire or --restore.");
    const lifecycle = flags.has("--retire") ? "retire" : "restore";
    // The sandbox is found by its slug and covers every organization of its account: nothing else to say.
    for (const name of [...values.keys(), ...flags]) {
      if (!LIFECYCLE_OPTIONS.includes(name)) throw new UsageError(`${name} does not apply to --${lifecycle}: it takes the sandbox's --slug (every organization of its account is covered).`);
    }
    return { command: "sandbox", lifecycle, slug: sandboxSlug(required), apply: flags.has("--apply"), json: flags.has("--json") };
  }
  for (const name of [...values.keys(), ...flags]) if (!SANDBOX_OPTIONS.includes(name)) throw new UsageError(`${name} does not apply to sandbox.`);
  const slug = sandboxSlug(required);
  const name = required("--name");
  if (name.length < 2 || name.length > 160) throw new UsageError("--name is 2 to 160 characters.");
  const region = required("--region").toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) throw new UsageError("--region is a two-letter country code (its region pack), e.g. AE.");
  const passwordEnv = values.get("--password-env")?.trim() || null;
  if (passwordEnv !== null && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(passwordEnv))
    throw new UsageError("--password-env is the name of an environment variable that holds the password, never the password itself.");
  const kit = values.get("--kit")?.trim() || null;
  if (kit !== null && !/^[a-z][a-z0-9_]{0,39}$/.test(kit)) throw new UsageError("--kit is a firm kit code (lowercase letters, digits and _), e.g. design_build.");
  const organizationOf = values.has("--organization-of") ? values.get("--organization-of")!.trim().toLowerCase() : null;
  if (organizationOf !== null) {
    if (!LOGIN_SLUG.test(organizationOf) || organizationOf.length < 2 || organizationOf.length > 40 || RESERVED_SLUGS.has(organizationOf))
      throw new UsageError("--organization-of is the slug of the sandbox whose account gets the organization (e.g. demo).");
    if (organizationOf === slug) throw new UsageError("--organization-of is another sandbox than --slug: the one whose account gets this organization.");
    // The people are the sandbox's own: their passwords stay as they are, and the organization gets the sandbox's kit.
    if (passwordEnv !== null) throw new UsageError(`--password-env does not apply with --organization-of: the test members keep the password sandbox ${organizationOf} gave them.`);
    if (kit !== null) throw new UsageError(`--kit does not apply with --organization-of: the organization gets the firm kit of sandbox ${organizationOf}.`);
  }
  const emailPattern = values.has("--email-pattern") ? parseEmailPattern(values.get("--email-pattern")!) : null;
  return {
    command: "sandbox", slug, name, region, profile: values.get("--profile")?.trim() || null, teams: values.get("--teams")?.trim() || null,
    crm: values.get("--crm")?.trim() || null, passwordEnv, kit, organizationOf, emailPattern, seed: flags.has("--seed") || flags.has("--scenarios"), scenarios: flags.has("--scenarios"),
    apply: flags.has("--apply"), json: flags.has("--json"),
  };
}

/**
 * --email-pattern: an address with {role} once before the @, lower case (addresses are matched without case), that
 * makes a valid sign-in address (as the invitation and provisioning commands check it) for every test member's role.
 */
export function parseEmailPattern(value: string): string {
  const pattern = value.trim().toLowerCase();
  const example = "e.g. wodanatechnology+{role}@gmail.com";
  if (pattern.split(ROLE_PLACEHOLDER).length !== 2) throw new UsageError(`--email-pattern has {role} once, where each member's role goes (${example}).`);
  const at = pattern.lastIndexOf("@");
  if (at >= 0 && pattern.indexOf(ROLE_PLACEHOLDER) > at) throw new UsageError(`--email-pattern has {role} before the @, so every member's email reaches the same inbox (${example}).`);
  if (/[{}]/.test(pattern.replace(ROLE_PLACEHOLDER, ""))) throw new UsageError(`--email-pattern has {role} once and no other braces (${example}).`);
  // The shape the database keeps (operator_sandbox_settings), and an address the invitation and provisioning commands accept.
  const invalid = SANDBOX_PERSONAS.map((persona) => patternEmail(pattern, persona.key))
    .find((email) => !STORED_ADDRESS.test(email) || !isEmail(email) || email.length > 254);
  if (invalid !== undefined) throw new UsageError(`--email-pattern must make a valid address for every member; ${invalid} is not one (${example}).`);
  return pattern;
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
