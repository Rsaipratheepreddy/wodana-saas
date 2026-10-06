import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { CatalogItemImagesService } from "../catalog-core/catalog-item-images";
import { ImportFileError, readImportFile, readImportImage, rowImage, type FileSheet } from "../linked-imports/import-file-reader";
import { chosenTabs, headingsOf, mappedColumns, overrideMapping, suggestMapping } from "../linked-imports/import-mapping";
import { headingKey, TARGET_FIELDS, type ColumnMapping } from "../linked-imports/linked-import-source";
import { LinkedImportsService } from "../linked-imports/linked-imports.service";
import { parseMappingOverrides, UsageError, type ImportArgs } from "./ops-args";
import { OpsError, type OpsContext, type Report } from "./ops-context";

const tidy = (name: string) => name.replace(/\s+/g, " ").trim();
type Counts = { added: number; changed: number; unchanged: number; errors: number };
type Preview = { fingerprint: string; skippedTabs: string[]; summary: Counts & { missing: number }; bySheet?: Record<string, Counts>;
  prices?: { approved: boolean; refused: boolean };
  rows: Array<{ sheet: string; line: number | null; outcome: string; message: string }> };
type Detail = { link: { id: string; name: string; version: number }; runs: Array<Counts & { id: string; status: string; missing: number; message: string }>;
  records?: Array<{ sheet: string; line: number; recordId: string; images: number }> };

/**
 * A row's problem without the values it quotes ("Cost isn't a number (abc)" → "Cost isn't a number (…)"), so reasons
 * group and nothing from the sheet is printed.
 */
export function errorReason(message: string) {
  return message.replace(/\([^)]*\)/g, "(…)").replace(/"[^"]*"|“[^”]*”/g, "\"…\"").replace(/\s+/g, " ").trim().slice(0, 160) || "Wodana couldn't save this row.";
}

/** The tabs to import: those named, else every tab the sheet shows (hidden ones are templates); less those excluded. */
export function pickTabs(sheets: Array<{ name: string; hidden?: boolean }>, tabs: string[] | null, exclude: string[]) {
  const find = (wanted: string) => {
    const found = sheets.find((sheet) => tidy(sheet.name).toLowerCase() === tidy(wanted).toLowerCase());
    if (!found) throw new UsageError(`The file has no tab "${wanted}". Its tabs: ${sheets.map((sheet) => tidy(sheet.name)).join(", ")}.`);
    return found.name;
  };
  if (sheets.length === 1) {
    if (exclude.length || (tabs && tabs.length)) for (const name of [...exclude, ...(tabs ?? [])]) find(name);
    if (exclude.length) throw new UsageError("The file has one tab; nothing would be left to import.");
    return undefined;
  }
  const chosen = tabs ? tabs.map(find) : sheets.filter((sheet) => !sheet.hidden).map((sheet) => sheet.name);
  const left = new Set(exclude.map(find));
  const result = [...new Set(chosen.filter((name) => !left.has(name)))];
  if (!result.length) throw new UsageError("No tab is left to import.");
  return result;
}

/** The column mapping: the Import dialog's guess, with the operator's overrides. */
export function buildMapping(target: ImportArgs["target"], sheets: FileSheet[], tabs: string[] | undefined, overrides: Record<string, string>, fillOnly: boolean): ColumnMapping {
  const fields: readonly string[] = TARGET_FIELDS[target];
  const unknown = Object.entries(overrides).filter(([, field]) => field && !fields.includes(field));
  if (unknown.length) throw new UsageError(`--mapping: ${unknown.map(([heading, field]) => `"${heading}" → ${field}`).join(", ")} is not a ${target} field (${fields.join(", ")}).`);
  const shown = tabs ? sheets.filter((sheet) => tabs.includes(sheet.name)) : sheets;
  const guess = suggestMapping(target, headingsOf(shown)).columns;
  const mapping: ColumnMapping = { columns: overrideMapping(guess, overrides) };
  if (tabs) mapping.tabs = tabs;
  if (fillOnly) mapping.fillOnly = true;
  return mapping;
}

export async function runImport(ctx: OpsContext, args: ImportArgs, report: Report) {
  const imports = ctx.get(LinkedImportsService);
  let sheets: FileSheet[];
  try { sheets = await readImportFile(args.file); }
  catch (error) {
    if (error instanceof ImportFileError) throw new OpsError(error.message);
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new OpsError(`No file at ${args.file}.`);
    throw error;
  }
  if (!sheets.length) throw new OpsError("The file has no rows to import.");
  const tabs = pickTabs(sheets, args.tabs, args.excludeTabs);
  const overrides = args.mapping ? parseMappingOverrides(args.mapping.trim().startsWith("{") ? args.mapping : await readFile(args.mapping, "utf8").catch(() => {
    throw new UsageError(`--mapping is JSON or a JSON file; ${args.mapping} could not be read.`);
  })) : { columns: {} };
  const mapping = buildMapping(args.target, sheets, tabs, overrides.columns, args.fillOnly);
  const chosen = chosenTabs(sheets, mapping);
  const cells = new Set(chosen.flatMap((sheet) => sheet.rows.flat().map((cell) => headingKey(cell))));
  for (const heading of Object.keys(overrides.columns)) if (!cells.has(headingKey(heading))) report.add("mapping", "not found", `--mapping heading "${heading}" is in none of the chosen tabs`);

  // What the link imports into: the catalogue, the place, the company.
  const lookups = await ctx.read(async (client) => ({
    catalogs: args.target === "catalog" ? (await client.query<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM catalogs WHERE workspace_id = $1 AND status = 'active' ORDER BY name`, [ctx.workspace.id])).rows : [],
    entities: args.target === "suppliers" ? (await client.query<{ id: string; code: string; name: string }>(
      `SELECT id, code, display_name AS name FROM legal_entities WHERE workspace_id = $1 AND status = 'active' ORDER BY display_name`, [ctx.workspace.id])).rows : [],
  }));
  let catalogId: string | undefined;
  if (args.target === "catalog") {
    const wanted = args.catalog?.toLowerCase();
    const found = wanted ? lookups.catalogs.filter((catalog) => catalog.code.toLowerCase() === wanted || catalog.name.toLowerCase() === wanted) : lookups.catalogs;
    if (found.length !== 1) throw new OpsError(wanted ? `No active catalogue "${args.catalog}".` : `The workspace has ${lookups.catalogs.length} active catalogues; choose one with --catalog <code>.`);
    catalogId = found[0].id;
  }
  const entityId = (code: string) => {
    const found = lookups.entities.find((entity) => entity.code.toLowerCase() === code.toLowerCase() || entity.name.toLowerCase() === code.toLowerCase());
    if (!found) throw new OpsError(`No active company with the code "${code}".`);
    return found.id;
  };
  const legalEntityId = args.target === "suppliers" && args.legalEntity ? entityId(args.legalEntity) : null;
  if (args.target === "suppliers" && overrides.entities) {
    mapping.entities = Object.fromEntries(Object.entries(overrides.entities).map(([tab, code]) => {
      const sheet = chosen.find((entry) => tidy(entry.name).toLowerCase() === tidy(tab).toLowerCase());
      if (!sheet) throw new UsageError(`--mapping entities: "${tab}" is not a chosen tab.`);
      if (typeof code !== "string") throw new UsageError(`--mapping entities: "${tab}" names a company code.`);
      return [tidy(sheet.name), entityId(code)];
    }));
  }

  const overview = await imports.overview(ctx.actor, ctx.workspace.id, { target: args.target, ...(catalogId ? { catalogId } : {}) }) as {
    links: Array<{ id: string; name: string; version: number; source: string }>; locations: Array<{ id: string; name: string; isDefault: boolean }>; canManage: boolean };
  if (!overview.canManage) throw new OpsError(`The member can't manage ${args.target} imports in this workspace.`);
  let locationId: string | null = null;
  if (args.target === "stock") {
    const place = args.location ? overview.locations.find((entry) => entry.name.toLowerCase() === args.location!.toLowerCase())
      : overview.locations.find((entry) => entry.isDefault) ?? overview.locations[0];
    if (!place) throw new OpsError(args.location ? `No place "${args.location}" where stock is kept.` : "The workspace has no place where stock is kept.");
    locationId = place.id;
  }
  const name = args.name ?? basename(args.file).replace(/\.[^.]+$/, "").slice(0, 200);
  const existing = overview.links.find((link) => link.name.toLowerCase() === name.toLowerCase());
  if (existing && existing.source !== "upload") throw new OpsError(`"${name}" is a linked Google Sheet; give this upload another --name.`);

  const body: Record<string, unknown> = {
    ...(existing ? { linkId: existing.id, version: existing.version } : { target: args.target, source: "upload", ...(catalogId ? { catalogId } : {}) }),
    name, mapping, sheetName: null, schedule: "off",
    ...(args.target === "stock" ? { locationId, setsStock: args.setsStock } : args.target === "suppliers" ? { legalEntityId }
      : { itemType: args.itemType ?? "product", ...(args.approvedPrices ? { approvedPrices: true } : {}) }),
    // The file goes as the browser sends it: trimmed to the chosen tabs and the mapped columns.
    sheets: mappedColumns(sheets, mapping),
  };

  report.facts.import = { target: args.target, name, link: existing ? "existing" : "new", tabs: chosen.map((sheet) => tidy(sheet.name)), mapping: mapping.columns };
  report.note(`${args.target} import "${name}" (${existing ? "updates the existing link" : "new link"}) from ${chosen.length} tab${chosen.length === 1 ? "" : "s"}`);
  for (const [heading, field] of Object.entries(mapping.columns)) report.add("mapping", "info", heading, field);

  const preview = await imports.preview(ctx.actor, ctx.workspace.id, body) as Preview;
  if (args.target === "catalog" && preview.prices) {
    report.facts.prices = preview.prices;
    // Asked for on the command line, a refusal stops the import rather than drafting prices the operator meant to approve.
    if (args.approvedPrices && preview.prices.refused)
      throw new OpsError(`${args.as} can't approve prices (needs commercial.estimate and catalog.manage); nothing was imported. Run as a member who can.`);
    report.add("prices", "info", preview.prices.approved ? "approved list prices" : "prices drafted for review",
      preview.prices.approved ? "live in the catalogue's default price book" : preview.prices.refused ? "the link has approved prices, but this member can't approve them" : undefined);
  }
  for (const tab of preview.skippedTabs) report.add("tabs", "info", tidy(tab), "skipped: no heading row with the mapped columns");
  for (const sheet of chosen) {
    const counts = preview.bySheet?.[tidy(sheet.name)];
    // Rows with problems are left out of the import (as in the app); they don't fail the run.
    if (counts) report.add("preview", "info", tidy(sheet.name), `${counts.added} added, ${counts.changed} changed, ${counts.unchanged} unchanged, ${counts.errors} errors`);
  }
  const { summary } = preview;
  report.facts.preview = { summary: preview.summary, bySheet: preview.bySheet ?? {}, skippedTabs: preview.skippedTabs.map(tidy) };
  report.note(`Preview: ${summary.added} added, ${summary.changed} changed, ${summary.unchanged} unchanged, ${summary.errors} errors, ${summary.missing} no longer in the sheet.`);
  const reasons = new Map<string, number>();
  for (const row of preview.rows) if (row.outcome === "error") reasons.set(errorReason(row.message), (reasons.get(errorReason(row.message)) ?? 0) + 1);
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  report.facts.topErrors = top.map(([reason, count]) => ({ reason, count }));
  for (const [reason, count] of top) report.add("errors", "info", reason, `${count} row${count === 1 ? "" : "s"}`);
  if (args.target === "catalog") {
    const pictures = chosen.reduce((total, sheet) => total + (sheet.images?.length ?? 0), 0);
    if (pictures) report.add("pictures", "info", `${pictures} rows have a picture in the file`, args.pictures ? "added to items without one after the import" : "add them with --pictures --apply");
  }

  if (!ctx.apply) { report.note("Dry run: nothing was changed. Re-run with --apply to import."); return; }

  const detail = await imports.apply(ctx.actor, ctx.workspace.id, { ...body, runId: randomUUID(), expectedFingerprint: preview.fingerprint }) as Detail;
  const run = detail.runs[0];
  report.facts.run = run ? { status: run.status, added: run.added, changed: run.changed, unchanged: run.unchanged, errors: run.errors, missing: run.missing } : null;
  report.facts.linkId = detail.link.id;
  report.add("run", run?.status === "failed" ? "failed" : run && run.added + run.changed === 0 ? "unchanged" : "changed", `import ${run?.status ?? "done"}`,
    run ? `${run.added} added, ${run.changed} changed, ${run.unchanged} unchanged, ${run.errors} errors, ${run.missing} no longer in the sheet${run.message ? `; ${run.message}` : ""}` : undefined);
  report.note(`Link ${detail.link.id}: shown in the app under Import, and refreshable there from a new upload.`);

  if (args.pictures && args.target === "catalog" && detail.records?.length) {
    const images = ctx.get(CatalogItemImagesService);
    const wanted = new Map<string, NonNullable<ReturnType<typeof rowImage>>>();
    for (const record of detail.records) {
      if (record.images || wanted.has(record.recordId)) continue;
      const image = rowImage(sheets, record.sheet, record.line);
      if (image) wanted.set(record.recordId, image);
    }
    let added = 0, failed = 0;
    for (const [itemId, image] of wanted) {
      try {
        const buffer = await readImportImage(args.file, image);
        await images.upload(ctx.actor, ctx.workspace.id, itemId, randomUUID(), { buffer, originalname: basename(image.path), mimetype: image.type, size: buffer.byteLength });
        added += 1;
      } catch { failed += 1; }
    }
    report.facts.pictures = { added, failed };
    report.add("pictures", failed ? "failed" : added ? "changed" : "unchanged", "item pictures", `${added} added, ${failed} could not be added`);
  }
}
