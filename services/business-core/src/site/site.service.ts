import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { move, onHand, stockItemFor, stockItemInCatalogUnit } from "../inventory/stock";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { activeMembers, membershipOf, readProject } from "../project-core/project-core.store";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^-?\d{1,14}(\.\d{1,4})?$/;
const STOCKED = ["make", "buy", "ready_made"];

type Line = { id: string; title: string; unit: string; quantity: string; supply: string | null; catalogItemId: string | null; areaName: string | null; installed: string; pending: string };
type Report = {
  id: string; reportDate: string; authorId: string; authorName: string; status: "draft" | "submitted" | "approved" | "returned"; weather: string; safety: "none" | "observation" | "incident";
  safetyNote: string; forecast: "none" | "watch" | "blocked"; impact: string; recoveryOwnerId: string | null; recoveryOwnerName: string | null; recoveryOn: string | null; noWorkReason: string;
  notes: string; decidedByName: string | null; decisionNote: string; version: number;
  /** While submitted: the names of the people who can approve it. */
  waitingFor: string[];
  workforce: Array<{ trade: string; people: number }>; lines: Array<{ id: string; boqLineId: string; title: string; unit: string; installed: string; note: string }>;
  photos: Array<{ id: string; name: string; shared: boolean }>;
};

/**
 * The site: when site work started and finished, and the daily reports — who worked, what was installed,
 * safety and whether the plan is at risk. Someone other than the author approves a report; approved
 * installation takes the goods from the project's stock at its site and never passes the scope line.
 */
@Injectable()
export class SiteService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  state(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.read(client, workspaceId, projectId, user.userId));
  }

  command(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const who = await this.who(client, workspaceId, projectId, user.userId);
      const project = who.project;
      if (!["active", "on_hold"].includes(project.status)) throw new ConflictException("The project is closed.");
      await client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, projectId]);
      const action = String(body.action ?? "");
      let audit: Record<string, unknown> = {};
      const today = await this.today(client, workspaceId);

      if (action === "start_site" || action === "finish_site") {
        if (!who.manager) throw new ForbiddenException("Only the project manager starts or finishes site work.");
        const on = optionalDate(body.on, "Date") ?? today;
        const dates = (await client.query<{ started: string | null; finished: string | null }>(
          `SELECT site_started_on::text AS started, site_finished_on::text AS finished FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
        if (action === "start_site") {
          if (dates.started && !dates.finished) throw new ConflictException("Site work has already started.");
          await client.query(`UPDATE delivery_projects SET site_started_on = coalesce($3, site_started_on), site_finished_on = NULL WHERE workspace_id = $1 AND id = $2`,
            [workspaceId, projectId, dates.started ? null : on]);
        } else {
          if (!dates.started || dates.finished) throw new ConflictException("Site work isn't running.");
          if (on < dates.started) throw new BadRequestException("Site work can't finish before it started.");
          await client.query(`UPDATE delivery_projects SET site_finished_on = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId, on]);
        }
        audit = { on };
      } else if (action === "save_report") {
        if (!who.onTeam) throw new ForbiddenException("Only the project's team reports on its site.");
        const id = uuid(body.id, "Report");
        const existing = (await client.query<{ authorId: string; status: string; version: number }>(
          `SELECT author_id AS "authorId", status, version FROM site_reports WHERE workspace_id = $1 AND id = $2 AND project_id = $3 FOR UPDATE`, [workspaceId, id, projectId])).rows[0];
        if (existing && existing.authorId !== user.userId) throw new ForbiddenException("Only its author changes a report.");
        if (existing && !["draft", "returned"].includes(existing.status)) throw new ConflictException("A submitted report doesn't change; add a correction in a later report.");
        if (existing && body.version !== existing.version) throw new ConflictException("This report changed elsewhere. Reload to see it.");
        const reportDate = optionalDate(body.reportDate, "Date") ?? today;
        if (reportDate > today) throw new BadRequestException("A report can't be for a day that hasn't come.");
        const safety = oneOf(body.safety ?? "none", ["none", "observation", "incident"] as const, "Safety");
        const forecast = oneOf(body.forecast ?? "none", ["none", "watch", "blocked"] as const, "Outlook");
        const safetyNote = text(body.safetyNote, 1000);
        if (safety !== "none" && !safetyNote) throw new BadRequestException("Say what happened.");
        const impact = text(body.impact, 1000);
        const recoveryOwnerId = body.recoveryOwnerId ? uuid(body.recoveryOwnerId, "Owner") : null;
        const recoveryOn = optionalDate(body.recoveryOn, "Recovery date");
        if (forecast !== "none") {
          if (!impact) throw new BadRequestException("Say what's at risk and how it will be recovered.");
          if (!recoveryOwnerId || !recoveryOn) throw new BadRequestException("Name who recovers it and by when.");
          if (!(await activeMembers(client, workspaceId)).some((member) => member.membershipId === recoveryOwnerId)) throw new BadRequestException("Choose someone from your team.");
        }
        const workforce = Array.isArray(body.workforce) ? (body.workforce as Array<Record<string, unknown>>) : [];
        const people = workforce.map((row, index) => {
          const trade = text(row?.trade, 80);
          const count = Number(row?.people);
          if (!trade) throw new BadRequestException(`Name the trade on row ${index + 1}.`);
          if (!Number.isInteger(count) || count < 1 || count > 1000) throw new BadRequestException(`${trade}: how many people, from 1 to 1000.`);
          return { trade, people: count };
        });
        const scope = await this.lines(client, workspaceId, projectId);
        const entries = (Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : []).map((row) => {
          const line = scope.find((item) => item.id === row?.boqLineId);
          if (!line) throw new BadRequestException("Choose items from the project's scope.");
          const installed = signed(row?.installed, `${line.title}: installed`);
          if (Dec.of(installed).isZero()) throw new BadRequestException(`${line.title}: enter how much was installed.`);
          const note = text(row?.note, 500);
          if (Dec.of(installed).cmp(0) < 0 && !note) throw new BadRequestException(`${line.title}: a correction says why.`);
          return { boqLineId: line.id, installed, note };
        });
        if (new Set(entries.map((entry) => entry.boqLineId)).size !== entries.length) throw new BadRequestException("Each item once per report.");
        if (existing) {
          await client.query(`UPDATE site_reports SET report_date = $3, weather = $4, safety = $5, safety_note = $6, forecast = $7, impact = $8, recovery_owner_id = $9, recovery_on = $10,
            no_work_reason = $11, notes = $12, status = 'draft', version = version + 1 WHERE workspace_id = $1 AND id = $2`,
            [workspaceId, id, reportDate, text(body.weather, 120), safety, safetyNote, forecast, impact, forecast === "none" ? null : recoveryOwnerId, forecast === "none" ? null : recoveryOn,
              text(body.noWorkReason, 500), text(body.notes, 4000)]);
          await client.query(`DELETE FROM site_report_workforce WHERE workspace_id = $1 AND report_id = $2`, [workspaceId, id]);
          await client.query(`DELETE FROM site_report_lines WHERE workspace_id = $1 AND report_id = $2`, [workspaceId, id]);
        } else {
          try {
            await client.query(
              `INSERT INTO site_reports (id, workspace_id, project_id, report_date, author_id, weather, safety, safety_note, forecast, impact, recovery_owner_id, recovery_on, no_work_reason, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
              [id, workspaceId, projectId, reportDate, user.userId, text(body.weather, 120), safety, safetyNote, forecast, impact, forecast === "none" ? null : recoveryOwnerId,
                forecast === "none" ? null : recoveryOn, text(body.noWorkReason, 500), text(body.notes, 4000)]);
          } catch (error) {
            if ((error as { constraint?: string }).constraint === "site_reports_workspace_id_project_id_report_date_author_id_key") throw new ConflictException("You already have a report for that day: open it instead.");
            throw error;
          }
        }
        for (const row of people) await client.query(`INSERT INTO site_report_workforce (id, workspace_id, report_id, trade, people) VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), workspaceId, id, row.trade, row.people]);
        for (const entry of entries) await client.query(`INSERT INTO site_report_lines (id, workspace_id, report_id, boq_line_id, installed, note) VALUES ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), workspaceId, id, entry.boqLineId, entry.installed, entry.note]);
        audit = { reportId: id, reportDate, lines: entries.length };
      } else if (["submit", "approve", "return"].includes(action)) {
        const id = uuid(body.reportId, "Report");
        const report = (await this.reports(client, workspaceId, projectId, id))[0];
        if (!report) throw new NotFoundException("Report not found.");
        if (body.version !== report.version) throw new ConflictException("This report changed elsewhere. Reload to see it.");
        const facts = `${report.reportDate}: ${report.workforce.reduce((sum, row) => sum + row.people, 0)} people, ${report.lines.length} item${report.lines.length === 1 ? "" : "s"} installed`;
        if (action === "submit") {
          if (report.authorId !== user.userId) throw new ForbiddenException("Only its author submits a report.");
          if (!["draft", "returned"].includes(report.status)) throw new ConflictException("This report is already submitted.");
          // Evidence, or why nothing was done.
          if (!report.photos.length && !report.noWorkReason) throw new ConflictException("Add a photo, or say why no work was done.");
          await client.query(`UPDATE site_reports SET status = 'submitted', submitted_at = now(), decided_by = NULL, decided_at = NULL, decision_note = '', version = version + 1
            WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
          await this.tell(client, workspaceId, projectId, "site.report_waiting", (await this.approvers(client, workspaceId, projectId)).map((person) => person.userId), user.userId, facts, `submit:${id}:${report.version}`);
          if (report.safety === "incident") await this.tell(client, workspaceId, projectId, "site.incident", await this.leads(client, workspaceId, projectId), user.userId, report.safetyNote, `incident:${id}`, true);
          if (report.forecast === "blocked") await this.tell(client, workspaceId, projectId, "site.blocked", await this.leads(client, workspaceId, projectId), user.userId, report.impact, `blocked:${id}`);
        } else {
          if (!who.manager) throw new ForbiddenException("Only the project manager approves site reports.");
          if (report.authorId === user.userId) throw new ForbiddenException("Someone other than its author approves a report.");
          if (report.status !== "submitted") throw new ConflictException("Only a submitted report is approved or sent back.");
          if (action === "return") {
            const note = text(body.note, 500);
            if (!note) throw new BadRequestException("Say what to change.");
            await client.query(`UPDATE site_reports SET status = 'returned', decided_by = $3, decided_at = now(), decision_note = $4, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
              [workspaceId, id, user.userId, note]);
            await this.tell(client, workspaceId, projectId, "site.report_returned", [report.authorId], user.userId, note, `return:${id}:${report.version}`);
          } else {
            await this.install(client, workspaceId, projectId, report, user.userId);
            await client.query(`UPDATE site_reports SET status = 'approved', decided_by = $3, decided_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, user.userId]);
          }
        }
        audit = { reportId: id };
      } else if (action === "share_photo") {
        // The project manager chooses which photos of an approved report the client sees.
        if (!who.manager) throw new ForbiddenException("Only the project manager shares photos with the client.");
        const photo = (await client.query<{ id: string; status: string }>(
          `SELECT photo.id, report.status FROM site_report_photos photo JOIN site_reports report ON report.workspace_id = photo.workspace_id AND report.id = photo.report_id
            WHERE photo.workspace_id = $1 AND photo.id = $2 AND report.project_id = $3`, [workspaceId, uuid(body.photoId, "Photo"), projectId])).rows[0];
        if (!photo) throw new NotFoundException("Photo not found.");
        const shared = body.shared === true;
        if (shared && photo.status !== "approved") throw new ConflictException("Approve the report before sharing its photos.");
        await client.query(`UPDATE site_report_photos SET shared_at = CASE WHEN $3::boolean THEN coalesce(shared_at, now()) END,
          shared_by = CASE WHEN $3::boolean THEN coalesce(shared_by, $4::uuid) END WHERE workspace_id = $1 AND id = $2`, [workspaceId, photo.id, shared, user.userId]);
        audit = { photoId: photo.id, shared };
      } else throw new BadRequestException("Unknown action.");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `site.${action}`, entityType: "project", entityId: projectId, after: audit });
      return this.read(client, workspaceId, projectId, user.userId);
    });
  }

  /** A photo for a report its author is still writing (up to 10); replayed safely by its id. */
  async uploadPhoto(actor: RequestActor, workspaceId: string, projectId: string, reportId: string, photoId: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/")) throw new BadRequestException("Choose a photo (JPG, PNG, WebP or HEIC).");
    const storage = this.storage;
    if (!storage) throw new ConflictException("Photos can't be stored here yet.");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.who(client, workspaceId, projectId, user.userId);
      const report = (await client.query<{ authorId: string; status: string }>(
        `SELECT author_id AS "authorId", status FROM site_reports WHERE workspace_id = $1 AND id = $2 AND project_id = $3 FOR UPDATE`, [workspaceId, uuid(reportId, "Report"), projectId])).rows[0];
      if (!report) throw new NotFoundException("Report not found.");
      if (report.authorId !== user.userId) throw new ForbiddenException("Only its author adds photos to a report.");
      if (!["draft", "returned"].includes(report.status)) throw new ConflictException("A submitted report doesn't change.");
      const id = uuid(photoId, "Photo");
      const existing = (await client.query<{ sha256: string }>(`SELECT sha256 FROM site_report_photos WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      if (existing && existing.sha256 !== prepared.digest) throw new ConflictException("This upload id belongs to another photo.");
      if (!existing) {
        const count = (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM site_report_photos WHERE workspace_id = $1 AND report_id = $2`, [workspaceId, reportId])).rows[0].count;
        if (count >= 10) throw new BadRequestException("A report takes up to 10 photos.");
        const key = `site/reports/${workspaceId}/${id}`;
        await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
        if (prepared.preview) await storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
        await client.query(
          `INSERT INTO site_report_photos (id, workspace_id, report_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [id, workspaceId, reportId, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null, prepared.digest, user.userId]);
        await client.query(`UPDATE site_reports SET version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, reportId]);
      }
      return this.read(client, workspaceId, projectId, user.userId);
    });
  }

  photo(actor: RequestActor, workspaceId: string, projectId: string, photoId: string, preview: boolean) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.who(client, workspaceId, projectId, user.userId);
      const row = (await client.query<{ objectKey: string; previewKey: string | null; mimeType: string }>(
        `SELECT photo.object_key AS "objectKey", photo.preview_key AS "previewKey", photo.mime_type AS "mimeType"
           FROM site_report_photos photo JOIN site_reports report ON report.workspace_id = photo.workspace_id AND report.id = photo.report_id
          WHERE photo.workspace_id = $1 AND photo.id = $2 AND report.project_id = $3`, [workspaceId, uuid(photoId, "Photo"), projectId])).rows[0];
      if (!row || !this.storage) throw new NotFoundException("Photo not found.");
      const key = preview && row.previewKey ? row.previewKey : row.objectKey;
      const stored = await this.storage.read(key).catch(() => null);
      if (!stored) throw new NotFoundException("Photo not found.");
      return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mimeType };
    });
  }

  // ---------- helpers ----------
  /**
   * Approving installation: each line's total stays within the scope line (and never below nothing), and
   * goods bought or made for it come out of the project's stock at its site — so nothing is installed
   * that didn't arrive. A correction puts them back.
   */
  private async install(client: Db, workspaceId: string, projectId: string, report: Report, userId: string) {
    const lines = await this.lines(client, workspaceId, projectId);
    const site = (await client.query<{ id: string }>(`SELECT id FROM stock_locations WHERE workspace_id = $1 AND kind = 'site' AND project_id = $2`, [workspaceId, projectId])).rows[0];
    for (const entry of report.lines) {
      const line = lines.find((item) => item.id === entry.boqLineId)!;
      const total = Dec.of(line.installed).add(entry.installed);
      if (total.cmp(0) < 0) throw new ConflictException(`${line.title}: only ${Dec.of(line.installed).toString()} ${line.unit} was installed before.`.replace("  ", " "));
      if (total.cmp(line.quantity) > 0) throw new ConflictException(`${line.title}: the scope has ${Dec.of(line.quantity).toString()} ${line.unit}; ${Dec.of(line.installed).toString()} is installed already.`.replace("  ", " "));
      if (!line.supply || !STOCKED.includes(line.supply)) continue;
      const { itemId, factor } = line.supply === "make"
        ? { itemId: await stockItemFor(client, workspaceId, { catalogItemId: line.catalogItemId, name: line.title, unit: line.unit }), factor: Dec.of(1) }
        : await stockItemInCatalogUnit(client, workspaceId, { catalogItemId: line.catalogItemId, name: line.title, unit: line.unit });
      const quantity = Dec.of(entry.installed).mul(factor).round(4);
      if (quantity.cmp(0) > 0) {
        const have = site ? await onHand(client, workspaceId, itemId, site.id, projectId) : Dec.ZERO;
        if (!site || have.cmp(quantity) < 0) throw new ConflictException(`${line.title}: only ${have.div(factor).round(4).toString()} ${line.unit} is at the site.`.replace("  ", " "));
      }
      if (!site) continue;
      await move(client, workspaceId, { batchId: report.id, itemId, locationId: site.id, projectId, kind: quantity.cmp(0) > 0 ? "issue" : "return", quantity: quantity.neg().toString(),
        forProjectId: projectId, reason: entry.note || `Installed (${report.reportDate})`, movedOn: report.reportDate, actorId: userId, siteReportLineId: entry.id });
    }
  }

  private async read(client: Db, workspaceId: string, projectId: string, userId: string) {
    const who = await this.who(client, workspaceId, projectId, userId);
    const dates = (await client.query<{ started: string | null; finished: string | null }>(
      `SELECT site_started_on::text AS started, site_finished_on::text AS finished FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
    return {
      site: { startedOn: dates.started, finishedOn: dates.finished },
      reports: await this.reports(client, workspaceId, projectId),
      lines: await this.lines(client, workspaceId, projectId),
      members: await activeMembers(client, workspaceId),
      today: await this.today(client, workspaceId),
      me: userId, canReport: who.onTeam && ["active", "on_hold"].includes(who.project.status), canApprove: who.manager, canManage: who.manager,
    };
  }

  /** The project's active scope lines with what approved reports installed, and what submitted ones would add. */
  private async lines(client: Db, workspaceId: string, projectId: string): Promise<Line[]> {
    return (await client.query<Line>(
      `SELECT line.id, line.title, line.unit, line.quantity::text AS quantity, package.supply, line.catalog_item_id AS "catalogItemId", room.name AS "areaName",
              coalesce((SELECT sum(entry.installed) FROM site_report_lines entry JOIN site_reports report ON report.workspace_id = entry.workspace_id AND report.id = entry.report_id
                         WHERE entry.workspace_id = line.workspace_id AND entry.boq_line_id = line.id AND report.status = 'approved'), 0)::numeric(18, 4)::text AS installed,
              coalesce((SELECT sum(entry.installed) FROM site_report_lines entry JOIN site_reports report ON report.workspace_id = entry.workspace_id AND report.id = entry.report_id
                         WHERE entry.workspace_id = line.workspace_id AND entry.boq_line_id = line.id AND report.status = 'submitted'), 0)::numeric(18, 4)::text AS pending
         FROM project_boq_lines line
         JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
         LEFT JOIN project_packages package ON package.workspace_id = line.workspace_id AND package.id = line.package_id
         LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
        WHERE line.workspace_id = $1 AND line.project_id = $2 AND line.status = 'active' ORDER BY line.position`, [workspaceId, projectId])).rows;
  }

  private async reports(client: Db, workspaceId: string, projectId: string, id: string | null = null): Promise<Report[]> {
    const rows = (await client.query<Omit<Report, "workforce" | "lines" | "photos">>(
      `SELECT report.id, report.report_date::text AS "reportDate", report.author_id AS "authorId", author.display_name AS "authorName", report.status, report.weather, report.safety,
              report.safety_note AS "safetyNote", report.forecast, report.impact, report.recovery_owner_id AS "recoveryOwnerId", owner_user.display_name AS "recoveryOwnerName",
              report.recovery_on::text AS "recoveryOn", report.no_work_reason AS "noWorkReason", report.notes, decider.display_name AS "decidedByName", report.decision_note AS "decisionNote", report.version
         FROM site_reports report
         JOIN users author ON author.id = report.author_id
         LEFT JOIN users decider ON decider.id = report.decided_by
         LEFT JOIN workspace_memberships owner ON owner.workspace_id = report.workspace_id AND owner.id = report.recovery_owner_id
         LEFT JOIN users owner_user ON owner_user.id = owner.user_id
        WHERE report.workspace_id = $1 AND report.project_id = $2 AND ($3::uuid IS NULL OR report.id = $3)
        ORDER BY report.report_date DESC, report.created_at DESC LIMIT 120`, [workspaceId, projectId, id])).rows;
    const ids = rows.map((row) => row.id);
    const approvers = rows.some((row) => row.status === "submitted") ? await this.approvers(client, workspaceId, projectId) : [];
    const workforce = (await client.query<{ reportId: string; trade: string; people: number }>(
      `SELECT report_id AS "reportId", trade, people FROM site_report_workforce WHERE workspace_id = $1 AND report_id = ANY($2::uuid[]) ORDER BY trade`, [workspaceId, ids])).rows;
    const lines = (await client.query<{ reportId: string; id: string; boqLineId: string; title: string; unit: string; installed: string; note: string }>(
      `SELECT entry.report_id AS "reportId", entry.id, entry.boq_line_id AS "boqLineId", line.title, line.unit, entry.installed::text AS installed, entry.note
         FROM site_report_lines entry JOIN project_boq_lines line ON line.workspace_id = entry.workspace_id AND line.id = entry.boq_line_id
        WHERE entry.workspace_id = $1 AND entry.report_id = ANY($2::uuid[]) ORDER BY line.position`, [workspaceId, ids])).rows;
    const photos = (await client.query<{ reportId: string; id: string; name: string; shared: boolean }>(
      `SELECT report_id AS "reportId", id, original_name AS name, shared_at IS NOT NULL AS shared FROM site_report_photos WHERE workspace_id = $1 AND report_id = ANY($2::uuid[]) ORDER BY created_at`, [workspaceId, ids])).rows;
    return rows.map((row) => ({ ...row,
      workforce: workforce.filter((item) => item.reportId === row.id).map(({ trade, people }) => ({ trade, people })),
      lines: lines.filter((item) => item.reportId === row.id).map(({ reportId: _reportId, ...item }) => item),
      photos: photos.filter((item) => item.reportId === row.id).map(({ id: photoId, name, shared }) => ({ id: photoId, name, shared })),
      waitingFor: row.status === "submitted" ? approvers.filter((person) => person.userId !== row.authorId).map((person) => person.name) : [] }));
  }

  /**
   * Who approves this project's reports: its managers, and anyone who manages all projects — never
   * a report's own author, who is filtered out where it matters.
   */
  private async approvers(client: Db, workspaceId: string, projectId: string) {
    return (await client.query<{ userId: string; name: string }>(
      `SELECT DISTINCT membership.user_id AS "userId", person.display_name AS name
         FROM workspace_memberships membership JOIN users person ON person.id = membership.user_id
        WHERE membership.workspace_id = $1 AND membership.status = 'active'
          AND (EXISTS (SELECT 1 FROM project_assignments assignment
                        WHERE assignment.workspace_id = membership.workspace_id AND assignment.project_id = $2 AND assignment.membership_id = membership.id AND assignment.active AND assignment.is_manager)
               OR EXISTS (SELECT 1 FROM effective_member_roles assigned
                            JOIN role_permissions granted ON granted.role_id = assigned.role_id
                            JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'projects.manage'
                           WHERE assigned.membership_id = membership.id))
        ORDER BY name LIMIT 20`, [workspaceId, projectId])).rows;
  }

  /** Who this person is on the project: on its team (reports), its manager (starts site work, approves). */
  private async who(client: Db, workspaceId: string, projectId: string, userId: string) {
    const project = await readProject(client, workspaceId, projectId);
    if (!project) throw new NotFoundException("Project not found.");
    const all = await this.access.hasPermission(client, workspaceId, userId, "projects.manage");
    if (!all && !(await this.access.hasPermission(client, workspaceId, userId, "projects.view"))) throw new ForbiddenException("You don't have access to projects.");
    const membershipId = await membershipOf(client, workspaceId, userId);
    const assignment = (await client.query<{ lead: boolean }>(
      `SELECT is_manager AS lead FROM project_assignments WHERE workspace_id = $1 AND project_id = $2 AND membership_id = $3 AND active`, [workspaceId, projectId, membershipId])).rows[0];
    if (!all && !assignment) throw new NotFoundException("Project not found.");
    return { project, onTeam: all || Boolean(assignment), manager: all || Boolean(assignment?.lead) };
  }

  private async leads(client: Db, workspaceId: string, projectId: string) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager`, [workspaceId, projectId])).rows.map((row) => row.userId);
  }

  private async tell(client: Db, workspaceId: string, projectId: string, code: string, users: string[], actorId: string, note: string, key: string, email = false) {
    const facts = (await client.query<{ title: string; clientName: string }>(
      `SELECT project.reference || ' · ' || project.name AS title, coalesce(party.display_name, opportunity.title) AS "clientName"
         FROM delivery_projects project
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0];
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "";
    for (const userId of new Set(users.filter((id) => id !== actorId))) {
      const message = { workspaceId, recipientUserId: userId, code, eventType: code, variables: { title: facts?.title ?? "", clientName: facts?.clientName ?? "", actor, note: note.slice(0, 480) },
        deepLink: `/workspace/projects/${projectId}/site` };
      await notifyUserInApp(client, { ...message, idempotencyKey: `${code}:${key}:${userId}` });
      if (email) await queueUserEmail(client, { ...message, idempotencyKey: `${code}:${key}:${userId}:email` });
    }
  }

  private async today(client: Db, workspaceId: string) {
    return (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
  }
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} isn't valid.`);
  return value;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function signed(value: unknown, label: string) {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!NUMBER.test(raw)) throw new BadRequestException(`${label} must be a number with up to 4 decimals.`);
  return raw;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new BadRequestException(`Choose a valid ${label.toLowerCase()}.`);
  return value as T;
}

function optionalDate(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} isn't a valid date.`);
  return value;
}
