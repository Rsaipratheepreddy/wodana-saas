import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { CatalogV2Service } from "../catalog-core/catalog-v2.service";
import { DatabaseService } from "../database/database.service";
import { InventoryService } from "../inventory/inventory.service";
import { SuppliersService } from "../purchasing/suppliers.service";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { catalogAdapter } from "./linked-import-catalog";
import type { Applied, ImportContext, LinkRecord, LinkSettings, Step, TargetAdapter } from "./linked-import-run";
import { recordKey } from "./linked-import-run";
import { checkMapping, checkSheets, fingerprint, keyField, readRows, sameNumber, SourceError, type ColumnMapping, type ImportTarget, type SourceSheet } from "./linked-import-source";
import { stockAdapter } from "./linked-import-stock";
import { suppliersAdapter } from "./linked-import-suppliers";
import { SheetSourceError, SheetSourceService } from "./sheet-source.service";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SPREADSHEET = /^[A-Za-z0-9_-]{10,200}$/;
const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const ITEM_TYPES = ["product", "material", "assembly", "service", "package", "ready_made"];
const SCHEDULES = ["off", "hourly", "daily"] as const;
type Schedule = (typeof SCHEDULES)[number];
const PERMISSIONS: Record<ImportTarget, { view: string[]; manage: string }> = {
  stock: { view: ["stock.view", "stock.manage", "stock.adjust", "stock.receive", "purchasing.view"], manage: "stock.adjust" },
  catalog: { view: ["catalog.view", "catalog.manage"], manage: "catalog.manage" },
  suppliers: { view: ["vendors.view", "vendors.manage"], manage: "vendors.manage" },
};
/** Where a link's owner opens it from a notice. */
const OPEN_AT: Record<ImportTarget, string> = { stock: "/workspace/inventory", catalog: "/workspace/catalogs", suppliers: "/workspace/purchasing/suppliers" };
const DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
/** Rows a preview or a run's detail returns (the counts cover every row). */
const SHOWN_ROWS = 500;

type LinkRow = LinkSettings & {
  id: string; source: "upload" | "google_sheet"; connectionId: string | null; spreadsheetId: string | null; sheetName: string | null; mapping: ColumnMapping;
  schedule: Schedule; nextRunAt: string | null; ownerId: string; ownerName: string; locationName: string | null; legalEntityName: string | null; status: string; version: number;
};
type Draft = Omit<LinkRow, "id" | "nextRunAt" | "ownerId" | "ownerName" | "locationName" | "legalEntityName" | "status" | "version"> & { id: string | null };
type Outcome = { status: "applied" | "partial" | "failed"; added: number; changed: number; unchanged: number; errors: number; missing: number; message: string };

const LINK_SELECT = `SELECT link.id, link.target, link.name, link.catalog_id AS "catalogId", link.location_id AS "locationId", place.name AS "locationName", link.item_type AS "itemType",
    link.legal_entity_id AS "legalEntityId", entity.display_name AS "legalEntityName", link.sets_stock AS "setsStock", link.source, link.connection_id AS "connectionId", link.spreadsheet_id AS "spreadsheetId", link.sheet_name AS "sheetName", link.mapping,
    link.schedule, link.next_run_at AS "nextRunAt", link.owner_id AS "ownerId", owner.display_name AS "ownerName", link.status, link.version
  FROM import_links link
  JOIN users owner ON owner.id = link.owner_id
  LEFT JOIN stock_locations place ON place.workspace_id = link.workspace_id AND place.id = link.location_id
  LEFT JOIN legal_entities entity ON entity.workspace_id = link.workspace_id AND entity.id = link.legal_entity_id`;
const RUN_SELECT = `SELECT run.id, run.finished_at AS at, run.status, run.trigger, run.added, run.changed, run.unchanged, run.errors, run.missing, run.message, person.display_name AS "byName"
  FROM import_runs run LEFT JOIN users person ON person.id = run.started_by`;

/**
 * Linked spreadsheet imports (PLM-073, PLM-124): a stock list or a product list kept in a spreadsheet is
 * imported through the module's own commands. Columns map to fields once; rows match by their code and
 * are added or changed, never deleted (a code that leaves the sheet is flagged "not in sheet"). A preview
 * shows every row's outcome before the first apply; every apply is a recorded, audited run, and a run of
 * the same data changes nothing. A linked Google Sheet refreshes on its schedule; its owner hears when a
 * refresh fails or leaves rows out.
 */
@Injectable()
export class LinkedImportsService {
  private readonly logger = new Logger(LinkedImportsService.name);

  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly db: DatabaseService,
    private readonly inventory: InventoryService,
    private readonly catalogs: CatalogV2Service,
    private readonly sheets: SheetSourceService,
    private readonly suppliers: SuppliersService,
  ) {}

  /** The links of one target (and catalog), with their last run, and what a new link can use. */
  overview(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    const target = targetOf(query.target);
    const catalogId = query.catalogId ? uuid(query.catalogId, "Catalog") : null;
    return this.access.withAnyPermission(actor, workspaceId, PERMISSIONS[target].view, async (client, user) => ({
      links: await this.links(client, workspaceId, target, catalogId),
      canManage: await this.access.hasPermission(client, workspaceId, user.userId, PERMISSIONS[target].manage),
      connections: (await client.query<{ id: string; name: string; account: string | null; driveFile: boolean }>(
        `SELECT id, display_name AS name, configuration->>'accountEmail' AS account, granted_scopes ? $2 AS "driveFile" FROM integration_connections
          WHERE workspace_id = $1 AND provider = 'google_workspace' AND status::text IN ('connected', 'degraded') ORDER BY display_name`, [workspaceId, DRIVE_FILE])).rows,
      locations: target === "stock" ? (await client.query<{ id: string; name: string; isDefault: boolean }>(
        `SELECT id, name, is_default AS "isDefault" FROM stock_locations WHERE workspace_id = $1 AND active AND kind <> 'site' ORDER BY is_default DESC, kind, name`, [workspaceId])).rows : [],
      currency: (await client.query<{ currency: string | null }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? "",
      // Suppliers: the companies a supplier list can be for.
      entities: target === "suppliers" ? (await client.query<{ id: string; name: string }>(
        `SELECT id, display_name AS name FROM legal_entities WHERE workspace_id = $1 AND status = 'active' ORDER BY display_name`, [workspaceId])).rows : [],
    }));
  }

  /** One link: its settings, its recent runs, and what the last run did to each row it didn't leave unchanged. */
  async detail(actor: RequestActor, workspaceId: string, linkId: string) {
    const target = await this.targetOfLink(actor, workspaceId, linkId);
    return this.access.withAnyPermission(actor, workspaceId, PERMISSIONS[target].view, async (client, user) => this.linkDetail(client, workspaceId, linkId, user.userId));
  }

  /** A Google Sheet someone picked: its tabs and their first rows, to map the columns. */
  async readSource(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    const target = targetOf(body.target);
    const connectionId = uuid(body.connectionId, "Google connection");
    const spreadsheetId = spreadsheet(body.spreadsheetId);
    await this.access.withPermission(actor, workspaceId, PERMISSIONS[target].manage, async (client) => this.connection(client, workspaceId, connectionId));
    const read = await this.fetch({ workspaceId, connectionId, spreadsheetId, previewRows: 30 });
    return { title: read.title, sheets: read.sheets, rowCounts: read.rowCounts };
  }

  /** What applying would do, row by row, without changing anything. */
  async preview(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    const target = await this.targetFor(actor, workspaceId, body);
    const permission = PERMISSIONS[target].manage;
    const draft = await this.access.withPermission(actor, workspaceId, permission, async (client) => this.draft(client, workspaceId, body, target));
    const sheets = await this.source(workspaceId, draft, body.sheets);
    return this.access.withPermission(actor, workspaceId, permission, async (client, user) => {
      const { steps, missing, print, skippedTabs } = await this.plan(client, workspaceId, user.userId, draft, sheets);
      const count = (outcome: string) => steps.filter((step) => step.outcome === outcome).length;
      return {
        fingerprint: print, skippedTabs,
        summary: { added: count("added"), changed: count("changed"), unchanged: count("unchanged"), errors: count("error"), missing: missing.length },
        rows: [...steps.filter((step) => step.outcome !== "unchanged" || step.message), ...missing].sort(byConcern).slice(0, SHOWN_ROWS).map(shown),
      };
    });
  }

  /**
   * Saves a link (new, or its mapping and settings, version-checked) and applies its source now. Replayed
   * safely by the run's id; refused when the source changed since the preview it was confirmed on.
   */
  async apply(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    const runId = uuid(body.runId, "Import");
    const target = await this.targetFor(actor, workspaceId, body);
    const permission = PERMISSIONS[target].manage;
    const replay = await this.access.withPermission(actor, workspaceId, permission, async (client) => {
      const done = await this.runLink(client, workspaceId, runId);
      return done ? { done } : { draft: await this.draft(client, workspaceId, body, target) };
    });
    if (replay.done) return this.access.withPermission(actor, workspaceId, permission, async (client, user) => this.linkDetail(client, workspaceId, replay.done!, user.userId));
    const sheets = await this.source(workspaceId, replay.draft!, body.sheets);
    return this.access.withPermission(actor, workspaceId, permission, async (client, user) => {
      const done = await this.runLink(client, workspaceId, runId);
      if (done) return this.linkDetail(client, workspaceId, done, user.userId);
      const linkId = await this.saveLink(client, workspaceId, user.userId, await this.draft(client, workspaceId, body, target), body.version);
      const link = await this.lockedLink(client, workspaceId, linkId);
      await this.execute(client, workspaceId, user.userId, link, { sheets }, runId, "manual", typeof body.expectedFingerprint === "string" ? body.expectedFingerprint : null);
      return this.linkDetail(client, workspaceId, linkId, user.userId);
    });
  }

  /** Refresh now: a linked sheet is read again; an uploaded one takes the new file through the same mapping. */
  async refresh(actor: RequestActor, workspaceId: string, linkId: string, body: Record<string, unknown>) {
    const runId = uuid(body.runId, "Import");
    const target = await this.targetOfLink(actor, workspaceId, linkId);
    const permission = PERMISSIONS[target].manage;
    const link = await this.access.withPermission(actor, workspaceId, permission, async (client) => {
      if (await this.runLink(client, workspaceId, runId)) return null;
      const found = await this.readLink(client, workspaceId, linkId);
      if (!found || found.status !== "active") throw new NotFoundException("This import isn't linked any more.");
      return found;
    });
    let source: { sheets: SourceSheet[] } | { failure: string } | null = null;
    if (link) {
      if (link.source === "upload") source = { sheets: sheetsFrom(body.sheets) };
      else try { source = { sheets: (await this.fetch({ workspaceId, connectionId: link.connectionId!, spreadsheetId: link.spreadsheetId!, sheetName: link.sheetName })).sheets }; }
      catch (error) { if (error instanceof ServiceUnavailableException) source = { failure: error.message }; else throw error; }
    }
    return this.access.withPermission(actor, workspaceId, permission, async (client, user) => {
      if (!(await this.runLink(client, workspaceId, runId))) {
        const locked = await this.lockedLink(client, workspaceId, linkId);
        if (locked.status !== "active") throw new NotFoundException("This import isn't linked any more.");
        await this.execute(client, workspaceId, user.userId, locked, source!, runId, "manual", null);
      }
      return this.linkDetail(client, workspaceId, linkId, user.userId);
    });
  }

  /** The schedule, whether the sheet sets stock quantities, the name, or stop linking. Version-checked. */
  async settings(actor: RequestActor, workspaceId: string, linkId: string, body: Record<string, unknown>) {
    const target = await this.targetOfLink(actor, workspaceId, linkId);
    return this.access.withPermission(actor, workspaceId, PERMISSIONS[target].manage, async (client, user) => {
      const link = await this.lockedLink(client, workspaceId, linkId);
      if (body.version !== link.version) throw new ConflictException("Someone else changed this import. Reload to see their change.");
      if (link.status !== "active") throw new ConflictException("This import isn't linked any more.");
      if (body.archive === true) {
        await client.query(`UPDATE import_links SET status = 'archived', schedule = 'off', next_run_at = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, linkId]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "linked_import.archived", entityType: "import_link", entityId: linkId, before: { name: link.name } });
        return { archived: true };
      }
      const schedule = body.schedule === undefined ? link.schedule : scheduleOf(body.schedule, link.source);
      const setsStock = body.setsStock === undefined ? link.setsStock : body.setsStock === true;
      const name = body.name === undefined ? link.name : required(body.name, 200, "Name the import.");
      await client.query(
        `UPDATE import_links SET schedule = $3::varchar, sets_stock = $4, name = $5, version = version + 1, updated_at = now(),
           next_run_at = CASE WHEN $3::varchar = 'off' THEN NULL WHEN $3::varchar = schedule THEN next_run_at
             ELSE now() + CASE WHEN $3::varchar = 'daily' THEN interval '1 day' ELSE interval '1 hour' END END
         WHERE workspace_id = $1 AND id = $2`, [workspaceId, linkId, schedule, link.target === "stock" ? setsStock : true, name]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "linked_import.settings_changed", entityType: "import_link", entityId: linkId,
        before: { schedule: link.schedule, setsStock: link.setsStock, name: link.name }, after: { schedule, setsStock, name } });
      return this.linkDetail(client, workspaceId, linkId, user.userId);
    });
  }

  /**
   * The schedule's run (every few minutes): workspaces with a linked sheet due are found through a SECURITY
   * DEFINER function, then each workspace claims its due links and refreshes each in its own tenant
   * transaction, as the link's owner. A sheet that can't be read is a failed run its owner hears about.
   */
  async runDue() {
    const totals = { links: 0, failed: 0, workspaces: 0 };
    const due = await this.db.query<{ workspace_id: string }>("SELECT workspace_id FROM list_import_link_workspaces_due()");
    for (const { workspace_id: workspaceId } of due.rows) {
      totals.workspaces += 1;
      const claimed = await this.db.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => (await client.query<{ id: string; ownerId: string; connectionId: string; spreadsheetId: string; sheetName: string | null }>(
        `UPDATE import_links SET claimed_until = now() + interval '15 minutes'
          WHERE workspace_id = $1 AND id IN (SELECT id FROM import_links WHERE workspace_id = $1 AND status = 'active' AND schedule <> 'off' AND source = 'google_sheet'
            AND (next_run_at IS NULL OR next_run_at <= now()) AND (claimed_until IS NULL OR claimed_until < now()) ORDER BY next_run_at NULLS FIRST LIMIT 10 FOR UPDATE SKIP LOCKED)
          RETURNING id, owner_id AS "ownerId", connection_id AS "connectionId", spreadsheet_id AS "spreadsheetId", sheet_name AS "sheetName"`, [workspaceId])).rows);
      for (const link of claimed) {
        let source: { sheets: SourceSheet[] } | { failure: string };
        try { source = { sheets: (await this.fetch({ workspaceId, connectionId: link.connectionId, spreadsheetId: link.spreadsheetId, sheetName: link.sheetName })).sheets }; }
        catch (error) { source = { failure: error instanceof HttpException ? error.message : "Wodana couldn't read the sheet." }; }
        try {
          const outcome = await this.db.tenantTransaction(workspaceId, link.ownerId, async (client) => {
            const locked = await this.lockedLink(client, workspaceId, link.id);
            if (locked.status !== "active" || locked.schedule === "off") return null;
            return this.execute(client, workspaceId, link.ownerId, locked, source, randomUUID(), "schedule", null);
          });
          if (outcome) { totals.links += 1; if (outcome.status === "failed") totals.failed += 1; }
        } catch (error) {
          totals.failed += 1;
          this.logger.error(`Linked import ${link.id} in workspace ${workspaceId} failed: ${(error as Error).message}`);
        }
      }
    }
    return totals;
  }

  // ---------- running ----------

  private adapter(target: ImportTarget): TargetAdapter {
    return target === "stock" ? stockAdapter(this.inventory) : target === "suppliers" ? suppliersAdapter(this.suppliers) : catalogAdapter(this.catalogs);
  }

  /** Reads the source through the mapping and plans every row, plus the known keys no longer in it. */
  private async plan(client: Db, workspaceId: string, userId: string, link: Draft | LinkRow, sheets: SourceSheet[]) {
    const { rows, skippedTabs } = readRows(link.target, sheets, link.mapping);
    const key = keyField(link.target, link.mapping);
    const keyHeading = Object.entries(link.mapping.columns).find(([, field]) => field === key)![0];
    if (!rows.length && skippedTabs.length) throw new SourceError(`No tab has the column ${keyHeading}.`);
    const records = link.id ? await this.records(client, workspaceId, link.id) : new Map<string, LinkRecord>();
    const context: ImportContext = { client, workspaceId, userId, link, records };
    const adapter = this.adapter(link.target);
    const steps = await adapter.plan(context, rows);
    const inSheet = new Set(steps.map((step) => step.recordKey).filter(Boolean));
    const gone = [...records.entries()].filter(([key]) => !inSheet.has(key)).map(([, record]) => record);
    const names = await adapter.names(context, gone.map((record) => record.recordId));
    const missing: Step[] = gone.filter((record) => names.has(record.recordId)).map((record) => ({ sheet: "", line: 0, key: record.key, name: names.get(record.recordId)!, outcome: "error",
      changes: [], message: "", recordKey: null, locationId: record.locationId, missing: true } as Step & { missing: true }));
    return { steps, missing, gone, context, adapter, print: fingerprint(link.target, link.mapping, rows, { setsStock: link.setsStock, locationId: link.locationId, itemType: link.itemType, legalEntityId: link.legalEntityId }), skippedTabs };
  }

  /** One run: applies every row that changes something (each on its own, so a bad row leaves the others), records it and tells the owner. */
  private async execute(client: Db, workspaceId: string, userId: string, link: LinkRow, source: { sheets: SourceSheet[] } | { failure: string }, runId: string,
    trigger: "manual" | "schedule", expected: string | null): Promise<Outcome> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('import_link:' || $1::text, 0))`, [link.id]);
    const previous = (await client.query<{ status: string; message: string; digest: string | null }>(
      `SELECT status, message, error_digest AS digest FROM import_runs WHERE workspace_id = $1 AND link_id = $2 ORDER BY seq DESC LIMIT 1`, [workspaceId, link.id])).rows[0];
    const permitted = await this.access.hasPermission(client, workspaceId, link.ownerId, PERMISSIONS[link.target].manage);
    let failure = "failure" in source ? source.failure : !permitted && trigger === "schedule" ? `${link.ownerName} can no longer make these changes. Someone who can should link the sheet again.` : "";
    let planned: Awaited<ReturnType<LinkedImportsService["plan"]>> | null = null;
    if (!failure) {
      try {
        planned = await this.plan(client, workspaceId, userId, link, "sheets" in source ? source.sheets : []);
        if (expected && planned.print !== expected) throw new ConflictException("The sheet changed since the preview. Review it again.");
      } catch (error) {
        if (error instanceof SourceError || (error instanceof HttpException && trigger === "schedule")) failure = error.message;
        else throw error;
      }
    }
    const shownRows: Array<Pick<Step, "sheet" | "line" | "key" | "name" | "message"> & { outcome: "added" | "changed" | "error" | "missing" }> = [];
    let outcome: Outcome;
    let digest: string | null = null;
    if (failure || !planned) {
      outcome = { status: "failed", added: 0, changed: 0, unchanged: 0, errors: 0, missing: 0, message: failure.slice(0, 500) };
    } else {
      const applied: Applied[] = [];
      const kept = new Map<string, { step: Step; result: Applied }>();
      for (const step of planned.steps) {
        if (step.apply) {
          await client.query("SAVEPOINT linked_import_row");
          try {
            const result = await step.apply();
            await client.query("RELEASE SAVEPOINT linked_import_row");
            applied.push(result);
            if (step.recordKey) kept.set(step.recordKey, { step, result });
          } catch (error) {
            await client.query("ROLLBACK TO SAVEPOINT linked_import_row");
            if (!(error instanceof HttpException || error instanceof SourceError)) this.logger.warn(`Linked import ${link.id} row ${step.line}: ${(error as Error).message}`);
            Object.assign(step, { outcome: "error", changes: [], message: error instanceof HttpException || error instanceof SourceError ? error.message : "Wodana couldn't save this row." });
          }
        } else if (step.keep && step.recordKey) kept.set(step.recordKey, { step, result: step.keep });
      }
      await this.keepRecords(client, workspaceId, link.id, planned.context.records, kept, planned.gone);
      await planned.adapter.finish?.(planned.context, applied);
      const count = (name: string) => planned!.steps.filter((step) => step.outcome === name).length;
      outcome = { status: count("error") ? "partial" : "applied", added: count("added"), changed: count("changed"), unchanged: count("unchanged"), errors: count("error"),
        missing: planned.missing.length, message: "" };
      for (const step of [...planned.steps, ...planned.missing].sort(byConcern)) {
        const missing = (step as { missing?: boolean }).missing === true;
        if (step.outcome === "unchanged" && !missing) continue;
        shownRows.push({ sheet: step.sheet, line: step.line, key: step.key, name: step.name, message: missing ? "Not in the sheet any more." : [step.message, step.changes.join("; ")].filter(Boolean).join(" "),
          outcome: missing ? "missing" : step.outcome as "added" | "changed" | "error" });
      }
      const errors = shownRows.filter((row) => row.outcome === "error");
      digest = errors.length ? createHash("sha256").update(JSON.stringify(errors.map((row) => [row.sheet, row.line, row.key, row.message]))).digest("hex") : null;
    }
    await client.query(
      `INSERT INTO import_runs (id, workspace_id, link_id, trigger, started_by, status, fingerprint, added, changed, unchanged, errors, missing, error_digest, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [runId, workspaceId, link.id, trigger, trigger === "manual" ? userId : null, outcome.status, planned?.print ?? null, outcome.added, outcome.changed, outcome.unchanged, outcome.errors,
        outcome.missing, digest, outcome.message]);
    for (const [position, row] of shownRows.slice(0, 5000).entries())
      await client.query(`INSERT INTO import_run_rows (id, workspace_id, run_id, position, sheet, line, key_value, name, outcome, message) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [randomUUID(), workspaceId, runId, position, row.sheet.slice(0, 200), row.line || null, row.key.slice(0, 200), row.name.slice(0, 240), row.outcome, row.message.slice(0, 1000)]);
    await client.query(
      `UPDATE import_links SET claimed_until = NULL, updated_at = now(),
         next_run_at = CASE schedule WHEN 'hourly' THEN now() + interval '1 hour' WHEN 'daily' THEN now() + interval '1 day' ELSE NULL END
       WHERE workspace_id = $1 AND id = $2`, [workspaceId, link.id]);
    await recordAudit(client, { workspaceId, actorUserId: trigger === "manual" ? userId : null, source: trigger === "manual" ? "user" : "internal", action: `linked_import.${outcome.status}`,
      entityType: "import_link", entityId: link.id, after: { runId, trigger, target: link.target, source: link.source, ...outcome } });
    await this.tellOwner(client, workspaceId, link, runId, trigger, userId, outcome, previous, digest);
    return outcome;
  }

  /** The owner hears about a failure, or about rows left out, once per new set of problems (never about a run they made themselves). */
  private async tellOwner(client: Db, workspaceId: string, link: LinkRow, runId: string, trigger: string, userId: string, outcome: Outcome,
    previous: { status: string; message: string; digest: string | null } | undefined, digest: string | null) {
    if (trigger === "manual" && userId === link.ownerId) return;
    const deepLink = `${OPEN_AT[link.target]}?import=${link.id}`;
    const message = { workspaceId, recipientUserId: link.ownerId, deepLink };
    if (outcome.status === "failed") {
      if (previous?.status === "failed" && previous.message === outcome.message) return;
      const variables = { name: link.name, note: outcome.message };
      await notifyUserInApp(client, { ...message, code: "linked_import.failed", eventType: "linked_import.failed", variables, idempotencyKey: `linked_import.failed:${runId}` });
      await queueUserEmail(client, { ...message, code: "linked_import.failed", eventType: "linked_import.failed", variables, idempotencyKey: `linked_import.failed:${runId}:email` });
    } else if (outcome.errors && digest !== previous?.digest) {
      await notifyUserInApp(client, { ...message, code: "linked_import.row_errors", eventType: "linked_import.row_errors",
        variables: { name: link.name, note: `${outcome.errors} ${outcome.errors === 1 ? "row needs" : "rows need"} a fix in the sheet.` }, idempotencyKey: `linked_import.row_errors:${runId}` });
    }
  }

  /** Each key in the sheet names its record (and the quantity taken from it); keys no longer in it are flagged, never removed. */
  private async keepRecords(client: Db, workspaceId: string, linkId: string, records: Map<string, LinkRecord>, kept: Map<string, { step: Step; result: Applied }>, gone: LinkRecord[]) {
    const seen: string[] = [];
    for (const [key, { step, result }] of kept) {
      const known = records.get(key);
      // Most rows of a refresh are as they were: they're only marked seen, together.
      if (known && known.recordId === result.recordId && !known.missingSince && (result.quantity === null || sameNumber(known.lastQuantity, result.quantity))) { seen.push(known.id); continue; }
      if (known) await client.query(
        `UPDATE import_link_records SET record_id = $3, last_quantity = coalesce($4::numeric, last_quantity), last_seen_at = now(), missing_since = NULL WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, known.id, result.recordId, result.quantity]);
      else await client.query(
        `INSERT INTO import_link_records (id, workspace_id, link_id, key_value, location_id, record_id, last_quantity) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace_id, link_id, lower(key_value), coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
         DO UPDATE SET record_id = EXCLUDED.record_id, last_quantity = coalesce(EXCLUDED.last_quantity, import_link_records.last_quantity), last_seen_at = now(), missing_since = NULL`,
        [randomUUID(), workspaceId, linkId, step.key.slice(0, 200), result.locationId, result.recordId, result.quantity]);
    }
    if (seen.length) await client.query(`UPDATE import_link_records SET last_seen_at = now() WHERE workspace_id = $1 AND id = ANY($2::uuid[])`, [workspaceId, seen]);
    if (gone.length) await client.query(`UPDATE import_link_records SET missing_since = coalesce(missing_since, now()) WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
      [workspaceId, gone.map((record) => record.id)]);
  }

  private async records(client: Db, workspaceId: string, linkId: string) {
    const rows = (await client.query<LinkRecord>(
      `SELECT id, key_value AS key, location_id AS "locationId", record_id AS "recordId", last_quantity::text AS "lastQuantity", missing_since AS "missingSince"
         FROM import_link_records WHERE workspace_id = $1 AND link_id = $2`, [workspaceId, linkId])).rows;
    return new Map(rows.map((row) => [recordKey(row.key, row.locationId), row]));
  }

  // ---------- links ----------

  /** The settings a request describes, checked: a new link's whole definition, or an existing link's with the changes it may take. */
  private async draft(client: Db, workspaceId: string, body: Record<string, unknown>, target: ImportTarget): Promise<Draft> {
    const existing = body.linkId ? await this.readLink(client, workspaceId, uuid(body.linkId, "Import")) : null;
    if (body.linkId && (!existing || existing.status !== "active")) throw new NotFoundException("This import isn't linked any more.");
    const source = existing?.source ?? (body.source === "google_sheet" ? "google_sheet" : body.source === "upload" ? "upload" : null);
    if (!source) throw new BadRequestException("Choose where the sheet comes from.");
    let mapping: ColumnMapping;
    try { mapping = body.mapping === undefined && existing ? existing.mapping : checkMapping(target, body.mapping); }
    catch (error) { if (error instanceof SourceError) throw new BadRequestException(error.message); throw error; }
    const draft: Draft = {
      id: existing?.id ?? null, target, source, mapping,
      name: body.name === undefined && existing ? existing.name : required(body.name, 200, "Name the import."),
      catalogId: existing?.catalogId ?? null, locationId: existing?.locationId ?? null, itemType: existing?.itemType ?? null, legalEntityId: existing?.legalEntityId ?? null,
      setsStock: target === "stock" ? (body.setsStock === undefined ? existing?.setsStock ?? true : body.setsStock === true) : true,
      connectionId: existing?.connectionId ?? null, spreadsheetId: existing?.spreadsheetId ?? null,
      sheetName: body.sheetName === undefined ? existing?.sheetName ?? null : optionalText(body.sheetName, 200, "Tab"),
      schedule: body.schedule === undefined ? existing?.schedule ?? (source === "google_sheet" ? "hourly" : "off") : scheduleOf(body.schedule, source),
    };
    if (target === "stock" && (body.locationId !== undefined || !existing)) {
      const locationId = uuid(body.locationId, "Place");
      if (!(await client.query(`SELECT 1 FROM stock_locations WHERE workspace_id = $1 AND id = $2 AND active AND kind <> 'site'`, [workspaceId, locationId])).rowCount)
        throw new BadRequestException("Choose a place where stock is kept.");
      draft.locationId = locationId;
    }
    if (target === "catalog") {
      if (!existing) {
        const catalogId = uuid(body.catalogId, "Catalog");
        if (!(await client.query(`SELECT 1 FROM catalogs WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, catalogId])).rowCount) throw new NotFoundException("Catalog not found.");
        draft.catalogId = catalogId;
      }
      if (body.itemType !== undefined || !existing) {
        const itemType = body.itemType === undefined || body.itemType === null || body.itemType === "" ? "product" : String(body.itemType);
        if (!ITEM_TYPES.includes(itemType)) throw new BadRequestException("Choose what kind of items the sheet lists.");
        draft.itemType = itemType;
      }
    }
    if (target === "suppliers" && body.legalEntityId !== undefined) {
      const entityId = body.legalEntityId === null || body.legalEntityId === "" ? null : uuid(body.legalEntityId, "Company");
      if (entityId && !(await client.query(`SELECT 1 FROM legal_entities WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, entityId])).rowCount)
        throw new BadRequestException("Choose one of your companies.");
      draft.legalEntityId = entityId;
    }
    if (source === "google_sheet" && !existing) {
      draft.connectionId = uuid(body.connectionId, "Google connection");
      draft.spreadsheetId = spreadsheet(body.spreadsheetId);
      await this.connection(client, workspaceId, draft.connectionId);
    }
    return draft;
  }

  private async saveLink(client: Db, workspaceId: string, userId: string, draft: Draft, version: unknown) {
    if (draft.id) {
      const before = await this.lockedLink(client, workspaceId, draft.id);
      if (version !== before.version) throw new ConflictException("Someone else changed this import. Reload to see their change.");
      await client.query(
        `UPDATE import_links SET name = $3, mapping = $4::jsonb, sets_stock = $5, schedule = $6, sheet_name = $7, location_id = $8, item_type = $9, legal_entity_id = $10, version = version + 1,
           updated_at = now(), next_run_at = CASE WHEN $6::varchar = 'off' THEN NULL ELSE next_run_at END WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, draft.id, draft.name, JSON.stringify(draft.mapping), draft.setsStock, draft.schedule, draft.sheetName, draft.locationId, draft.itemType, draft.legalEntityId]);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "linked_import.changed", entityType: "import_link", entityId: draft.id,
        before: { name: before.name, mapping: before.mapping, setsStock: before.setsStock, schedule: before.schedule, sheetName: before.sheetName, locationId: before.locationId, itemType: before.itemType,
          legalEntityId: before.legalEntityId },
        after: { name: draft.name, mapping: draft.mapping, setsStock: draft.setsStock, schedule: draft.schedule, sheetName: draft.sheetName, locationId: draft.locationId, itemType: draft.itemType,
          legalEntityId: draft.legalEntityId } });
      return draft.id;
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO import_links (id, workspace_id, target, catalog_id, location_id, item_type, source, name, connection_id, spreadsheet_id, sheet_name, mapping, sets_stock, schedule, owner_id, legal_entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16)`,
      [id, workspaceId, draft.target, draft.catalogId, draft.locationId, draft.itemType, draft.source, draft.name, draft.connectionId, draft.spreadsheetId, draft.sheetName,
        JSON.stringify(draft.mapping), draft.setsStock, draft.schedule, userId, draft.legalEntityId]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "linked_import.linked", entityType: "import_link", entityId: id,
      after: { target: draft.target, source: draft.source, name: draft.name, catalogId: draft.catalogId, locationId: draft.locationId, legalEntityId: draft.legalEntityId, spreadsheetId: draft.spreadsheetId, sheetName: draft.sheetName,
        mapping: draft.mapping, setsStock: draft.setsStock, schedule: draft.schedule } });
    return id;
  }

  private async links(client: Db, workspaceId: string, target: ImportTarget, catalogId: string | null) {
    const links = (await client.query<LinkRow>(
      `${LINK_SELECT} WHERE link.workspace_id = $1 AND link.status = 'active' AND link.target = $2 AND ($3::uuid IS NULL OR link.catalog_id = $3) ORDER BY link.created_at`,
      [workspaceId, target, catalogId])).rows;
    const last = new Map((await client.query<{ linkId: string }>(
      `SELECT DISTINCT ON (run.link_id) run.link_id AS "linkId", ${RUN_SELECT.slice("SELECT ".length)}
        WHERE run.workspace_id = $1 AND run.link_id = ANY($2::uuid[]) ORDER BY run.link_id, run.seq DESC`, [workspaceId, links.map((link) => link.id)])).rows
      .map(({ linkId, ...run }) => [linkId, run]));
    return links.map((link) => ({ ...link, lastRun: last.get(link.id) ?? null }));
  }

  private async linkDetail(client: Db, workspaceId: string, linkId: string, userId: string) {
    const link = await this.readLink(client, workspaceId, linkId);
    if (!link) throw new NotFoundException("Import not found.");
    const runs = (await client.query(`${RUN_SELECT} WHERE run.workspace_id = $1 AND run.link_id = $2 ORDER BY run.seq DESC LIMIT 10`, [workspaceId, linkId])).rows;
    const rows = runs.length ? (await client.query(
      `SELECT sheet, line, key_value AS key, name, outcome, message FROM import_run_rows WHERE workspace_id = $1 AND run_id = $2
        ORDER BY array_position(ARRAY['error', 'missing', 'added', 'changed'], outcome::text), position LIMIT ${SHOWN_ROWS}`, [workspaceId, runs[0].id])).rows : [];
    return { link, runs, rows, canManage: await this.access.hasPermission(client, workspaceId, userId, PERMISSIONS[link.target].manage) };
  }

  private async readLink(client: Db, workspaceId: string, linkId: string) {
    return (await client.query<LinkRow>(`${LINK_SELECT} WHERE link.workspace_id = $1 AND link.id = $2`, [workspaceId, linkId])).rows[0] ?? null;
  }

  private async lockedLink(client: Db, workspaceId: string, linkId: string) {
    await client.query(`SELECT 1 FROM import_links WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, linkId]);
    const link = await this.readLink(client, workspaceId, linkId);
    if (!link) throw new NotFoundException("Import not found.");
    return link;
  }

  /** The link a run already belongs to (a replayed request). */
  private async runLink(client: Db, workspaceId: string, runId: string) {
    return (await client.query<{ linkId: string }>(`SELECT link_id AS "linkId" FROM import_runs WHERE workspace_id = $1 AND id = $2`, [workspaceId, runId])).rows[0]?.linkId ?? null;
  }

  private async targetFor(actor: RequestActor, workspaceId: string, body: Record<string, unknown>): Promise<ImportTarget> {
    return body.linkId ? this.targetOfLink(actor, workspaceId, uuid(body.linkId, "Import")) : targetOf(body.target);
  }

  /** A link's target, read as a member, so the right module's permission guards the rest. */
  private async targetOfLink(actor: RequestActor, workspaceId: string, linkId: string): Promise<ImportTarget> {
    const target = await this.access.asMember(actor, workspaceId, async (client) =>
      (await client.query<{ target: ImportTarget }>(`SELECT target FROM import_links WHERE workspace_id = $1 AND id = $2`, [workspaceId, uuid(linkId, "Import")])).rows[0]?.target);
    if (!target) throw new NotFoundException("Import not found.");
    return target;
  }

  private async connection(client: Db, workspaceId: string, connectionId: string) {
    const found = (await client.query<{ driveFile: boolean }>(
      `SELECT granted_scopes ? $3 AS "driveFile" FROM integration_connections WHERE workspace_id = $1 AND id = $2 AND provider = 'google_workspace' AND status::text IN ('connected', 'degraded')`,
      [workspaceId, connectionId, DRIVE_FILE])).rows[0];
    if (!found) throw new BadRequestException("Choose a connected Google account.");
    if (!found.driveFile) throw new ConflictException("Turn on Drive files for this Google connection in Connections, then link the sheet.");
  }

  /** The rows to import: the file the browser read, or the linked sheet read now. */
  private async source(workspaceId: string, draft: Draft, uploaded: unknown) {
    if (draft.source === "upload") return sheetsFrom(uploaded);
    return (await this.fetch({ workspaceId, connectionId: draft.connectionId!, spreadsheetId: draft.spreadsheetId!, sheetName: draft.sheetName })).sheets;
  }

  private async fetch(input: Parameters<SheetSourceService["read"]>[0]) {
    try {
      const read = await this.sheets.read(input);
      return { ...read, sheets: checkSheets(read.sheets) };
    } catch (error) {
      if (error instanceof SheetSourceError || error instanceof SourceError) throw new ServiceUnavailableException(error.message);
      throw error;
    }
  }
}

function sheetsFrom(value: unknown) {
  try { return checkSheets(value); }
  catch (error) { if (error instanceof SourceError) throw new BadRequestException(error.message); throw error; }
}

/** Errors first, then rows leaving the sheet, then additions and changes; each in sheet order. */
function byConcern(a: Step, b: Step) {
  const rank = (step: Step) => (step.outcome === "error" && !(step as { missing?: boolean }).missing ? 0 : (step as { missing?: boolean }).missing ? 1 : step.outcome === "added" ? 2 : 3);
  return rank(a) - rank(b) || a.sheet.localeCompare(b.sheet) || a.line - b.line;
}

function shown(step: Step) {
  const missing = (step as { missing?: boolean }).missing === true;
  return { sheet: step.sheet, line: step.line || null, key: step.key, name: step.name, outcome: missing ? "missing" : step.outcome, changes: step.changes,
    message: missing ? "Not in the sheet any more." : step.message };
}

function targetOf(value: unknown): ImportTarget {
  if (value !== "stock" && value !== "catalog" && value !== "suppliers") throw new BadRequestException("Choose stock, the catalog or suppliers.");
  return value;
}

function scheduleOf(value: unknown, source: string): Schedule {
  if (!SCHEDULES.includes(value as Schedule)) throw new BadRequestException("Choose how often the sheet refreshes.");
  if (source !== "google_sheet" && value !== "off") throw new BadRequestException("Only a linked Google Sheet refreshes by itself.");
  return value as Schedule;
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} is not valid.`);
  return value;
}

function spreadsheet(value: unknown) {
  if (typeof value !== "string" || !SPREADSHEET.test(value)) throw new BadRequestException("Choose a Google Sheet.");
  return value;
}

function optionalText(value: unknown, max: number, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) throw new BadRequestException(`${label} is not valid.`);
  return value.trim() || null;
}

function required(value: unknown, max: number, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(message);
  if (value.trim().length > max) throw new BadRequestException(`Use at most ${max} characters.`);
  return value.trim();
}
