import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { AiGatewayService } from "../ai-gateway/ai-gateway.service";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { move, onHand, stockItemFor, stockItemInCatalogUnit } from "../inventory/stock";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { activeMembers, membershipOf, readProject } from "../project-core/project-core.store";
import { raiseBlocker, raiseSnag, setWorkProgress } from "../project-core/project-work";
import { ProjectWorkService } from "../project-core/project-work.service";
import { readCalendar, workdays } from "../project-core/work-calendar";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { composeClientView, readSummaryFacts, readTodayPlan, readTomorrowPlan, SUMMARY_SYSTEM, templateSummary, validateSummary } from "./daily-progress";
import { reworkInstallation } from "./installation-rework";
import { arrangeSiteAccess } from "./site-access";
import { publishReport, readProgressSettings } from "./progress-delivery";
import { readSitesToday } from "./sites-today";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^-?\d{1,14}(\.\d{1,4})?$/;
const STOCKED = ["make", "buy", "ready_made"];
const PHOTO_LIMIT = 20;
/** How many photos go to the client by default: the best of the day (after photos, then tagged ones). */
const CLIENT_PHOTOS = 6;
const SEVERITIES = ["minor", "major", "critical"] as const;
/** How long the phone waits for Woddy's summary before answering (the template is already there; Woddy's replaces it when ready). */
const SUMMARY_WAIT_MS = 6_000;

type Line = { id: string; title: string; unit: string; quantity: string; supply: string | null; catalogItemId: string | null; areaName: string | null; installed: string; pending: string };
type Status = "draft" | "submitted" | "approved" | "returned";
type Report = {
  id: string; reportDate: string; authorId: string; authorName: string; status: Status; weather: string; safety: "none" | "observation" | "incident";
  safetyNote: string; forecast: "none" | "watch" | "blocked"; impact: string; recoveryOwnerId: string | null; recoveryOwnerName: string | null; recoveryOn: string | null; noWorkReason: string;
  notes: string; decidedByName: string | null; decisionNote: string; version: number;
  submittedAt: string | null; decidedAt: string | null; updatedAt: string;
  /** Submitted after the day's end-of-day time (or not by then). */
  late: boolean;
  /** The client's words for the day, and where they came from. */
  clientSummary: string; summarySource: "none" | "template" | "ai" | "edited"; heroPhotoId: string | null;
  /** How the day reached the client: still to send, kept internal, or sent (with when, by whom, and whether by itself). */
  delivery: "pending" | "internal" | "sent"; sentAt: string | null; sentByName: string | null; sentAutomatically: boolean;
  /** While submitted: the names of the people who can approve it. */
  waitingFor: string[];
  workforce: Array<{ trade: string; people: number; hours: string | null }>;
  lines: Array<{ id: string; boqLineId: string; title: string; unit: string; installed: string; note: string }>;
  tasks: Array<{ id: string; workItemId: string; number: number; title: string; progress: number; previous: number | null; note: string; hidden: boolean }>;
  next: Array<{ id: string; workItemId: string | null; title: string; hidden: boolean }>;
  materials: Array<{ id: string; direction: "received" | "used"; description: string; quantity: string | null; unit: string; purchaseOrderId: string | null; stockTransferId: string | null }>;
  issues: Array<{ id: string; severity: (typeof SEVERITIES)[number]; description: string; internal: boolean; raised: "snag" | "material" | null; workItemId: string | null; workItemNumber: number | null }>;
  photos: Array<{ id: string; name: string; shared: boolean; areaId: string | null; phase: "before" | "after" | null; pairId: string | null; forClient: boolean }>;
  /** The client's reactions once it was sent, and which client contacts gave them (for the team). */
  reactions: { like: number; love: number };
  reactedBy: { like: string[]; love: string[] };
};

/**
 * The site: when site work started and finished, and the daily progress reports — today's planned work and how far
 * it got, photos by room, the crew, materials, issues, tomorrow's plan — with the client's card written from them.
 * Someone other than the author approves a report; approved installation takes the goods from the project's stock
 * at its site and never passes the scope line. Nothing reaches the client until the manager approves and sends it
 * (or the firm's "Send by itself" does).
 */
@Injectable()
export class SiteService {
  private readonly logger = new Logger(SiteService.name);

  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService,
    @Optional() private readonly ai?: AiGatewayService, @Optional() private readonly work?: ProjectWorkService) {}

  /** My sites today (the phone's Today): projects I'm on whose site work runs today, with my report, deliveries and snags. */
  sitesToday(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      if (!(await this.access.hasPermission(client, workspaceId, user.userId, "projects.view")) && !(await this.access.hasPermission(client, workspaceId, user.userId, "projects.manage")))
        return { today: null, hour: null, dueTime: null, sites: [] };
      return readSitesToday(client, workspaceId, user.userId);
    });
  }

  /**
   * Home for the people who run projects: the daily reports waiting for their review, and — once the day's
   * end-of-day time has passed — the running sites that have no report for today.
   */
  attention(actor: RequestActor, workspaceId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const all = await this.access.hasPermission(client, workspaceId, user.userId, "projects.manage");
      const membershipId = await membershipOf(client, workspaceId, user.userId);
      const managed = all ? null : (await client.query<{ projectId: string }>(
        `SELECT DISTINCT project_id AS "projectId" FROM project_assignments WHERE workspace_id = $1 AND membership_id = $2 AND active AND is_manager AND project_id IS NOT NULL`,
        [workspaceId, membershipId])).rows.map((row) => row.projectId);
      const clock = await this.clock(client, workspaceId);
      const { dueTime } = await readProgressSettings(client, workspaceId);
      if (managed && !managed.length) return { today: clock.today, dueTime, pastDue: false, toReview: [], missing: [] };
      const toReview = (await client.query<{ reportId: string; projectId: string; reference: string; name: string; reportDate: string; authorName: string; summary: string;
        submittedAt: string; photos: number; photoId: string | null }>(
        `SELECT report.id AS "reportId", project.id AS "projectId", project.reference, project.name, report.report_date::text AS "reportDate", author.display_name AS "authorName",
                report.client_summary AS summary, report.submitted_at AS "submittedAt",
                (SELECT count(*)::int FROM site_report_photos photo WHERE photo.workspace_id = report.workspace_id AND photo.report_id = report.id) AS photos,
                coalesce(report.hero_photo_id, (SELECT photo.id FROM site_report_photos photo WHERE photo.workspace_id = report.workspace_id AND photo.report_id = report.id
                                                 ORDER BY photo.for_client DESC, photo.position, photo.created_at LIMIT 1)) AS "photoId"
           FROM site_reports report JOIN delivery_projects project ON project.workspace_id = report.workspace_id AND project.id = report.project_id
           JOIN users author ON author.id = report.author_id
          WHERE report.workspace_id = $1 AND report.status = 'submitted' AND report.author_id <> $2 AND ($3::uuid[] IS NULL OR report.project_id = ANY($3::uuid[]))
          ORDER BY report.submitted_at LIMIT 20`, [workspaceId, user.userId, managed])).rows;
      const [hour, minute] = dueTime.split(":").map(Number);
      const pastDue = clock.minutes >= hour * 60 + minute;
      const missing = pastDue ? (await client.query<{ projectId: string; reference: string; name: string; supervisor: string | null }>(
        `SELECT project.id AS "projectId", project.reference, project.name,
                (SELECT string_agg(DISTINCT person.display_name, ', ') FROM project_assignments assignment
                   JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
                   JOIN users person ON person.id = membership.user_id
                  WHERE assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id AND assignment.active AND 'site_supervisor' = ANY(assignment.role_keys)) AS supervisor
           FROM delivery_projects project
          WHERE project.workspace_id = $1 AND project.status = 'active' AND project.site_started_on <= $2::date AND (project.site_finished_on IS NULL OR project.site_finished_on >= $2::date)
            AND ($3::uuid[] IS NULL OR project.id = ANY($3::uuid[]))
            AND NOT EXISTS (SELECT 1 FROM site_reports report WHERE report.workspace_id = project.workspace_id AND report.project_id = project.id AND report.report_date = $2::date
                             AND report.status IN ('submitted', 'approved'))
          ORDER BY project.reference`, [workspaceId, clock.today, managed])).rows : [];
      const worked = workdays(await readCalendar(client, workspaceId)).isWorking(clock.today);
      return { today: clock.today, dueTime, pastDue, toReview, missing: worked ? missing : [] };
    });
  }

  state(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.read(client, workspaceId, projectId, user.userId));
  }

  /** The client's card for a report exactly as it would go now (or as it went, once sent), for the manager's review. */
  clientView(actor: RequestActor, workspaceId: string, projectId: string, reportId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.who(client, workspaceId, projectId, user.userId);
      const row = (await client.query<{ view: unknown }>(`SELECT client_view AS view FROM site_reports WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
        [workspaceId, projectId, uuid(reportId, "Report")])).rows[0];
      if (!row) throw new NotFoundException("Report not found.");
      return { view: row.view ?? await composeClientView(client, workspaceId, reportId), sent: row.view !== null };
    });
  }

  async command(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    const action = String(body.action ?? "");
    if (action === "rewrite_summary") return this.rewriteSummary(actor, workspaceId, projectId, body);
    if (action === "raise_issue") return this.raiseIssue(actor, workspaceId, projectId, body);
    const state = await this.access.asMember(actor, workspaceId, async (client, user) => this.run(client, workspaceId, projectId, user.userId, action, body));
    // Woddy writes the client's words from the submitted facts; the template stands until (and unless) it does.
    if (action === "submit") await this.summaryInTime(actor, workspaceId, projectId, uuid(body.reportId, "Report"));
    return state;
  }

  private async run(client: Db, workspaceId: string, projectId: string, userId: string, action: string, body: Record<string, unknown>) {
    const who = await this.who(client, workspaceId, projectId, userId);
    const project = who.project;
    if (!["active", "on_hold"].includes(project.status)) throw new ConflictException("The project is closed.");
    await client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, projectId]);
    let audit: Record<string, unknown> = {};
    const today = await this.today(client, workspaceId);
    // On hold: nothing new is reported or started on site; reports already submitted can still be decided.
    if (project.status === "on_hold" && ["save_report", "submit", "start_site"].includes(action))
      throw new ConflictException("The project is on hold. Resume it before reporting on site.");

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
      audit = await this.save(client, workspaceId, projectId, userId, who.onTeam, today, body);
    } else if (action === "submit") {
      const id = uuid(body.reportId, "Report");
      const report = await this.one(client, workspaceId, projectId, id, body.version);
      if (report.authorId !== userId) throw new ForbiddenException("Only its author submits a report.");
      if (!["draft", "returned"].includes(report.status)) throw new ConflictException("This report is already submitted.");
      // Evidence, or why nothing was done.
      if (!report.photos.length && !report.noWorkReason) throw new ConflictException("Add a photo, or say why no work was done.");
      // The day's progress goes onto the plan, as if it was changed there.
      const moved = [];
      for (const task of report.tasks) {
        const changed = await setWorkProgress(client, workspaceId, { projectId, itemId: task.workItemId, progress: task.progress, userId });
        if (changed) moved.push(changed);
      }
      await this.pickPhotos(client, workspaceId, id);
      if (report.summarySource === "none" || report.summarySource === "template") {
        const facts = await readSummaryFacts(client, workspaceId, id);
        if (facts) await client.query(`UPDATE site_reports SET client_summary = $3, summary_source = 'template' WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, id, templateSummary(facts).slice(0, 1200)]);
      }
      await client.query(`UPDATE site_reports SET status = 'submitted', submitted_at = now(), decided_by = NULL, decided_at = NULL, decision_note = '', version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
      const people = report.workforce.reduce((sum, row) => sum + row.people, 0);
      const facts = [report.reportDate, report.noWorkReason ? "no work" : `${people} ${people === 1 ? "person" : "people"}`,
        report.tasks.length ? `${report.tasks.length} task${report.tasks.length === 1 ? "" : "s"} moved` : "", `${report.photos.length} photo${report.photos.length === 1 ? "" : "s"}`]
        .filter(Boolean).join(", ");
      await this.tell(client, workspaceId, projectId, "site.report_waiting", (await this.approvers(client, workspaceId, projectId)).map((person) => person.userId), userId, facts,
        `submit:${id}:${report.version}`, false, `?report=${id}`);
      if (report.safety === "incident") await this.tell(client, workspaceId, projectId, "site.incident", await this.leads(client, workspaceId, projectId), userId, report.safetyNote, `incident:${id}`, true);
      if (report.forecast === "blocked") await this.tell(client, workspaceId, projectId, "site.blocked", await this.leads(client, workspaceId, projectId), userId, report.impact, `blocked:${id}`);
      audit = { reportId: id, moved: moved.map((item) => ({ number: item.number, from: item.from, to: item.to })) };
    } else if (["approve", "approve_send", "approve_hold", "return"].includes(action)) {
      const id = uuid(body.reportId, "Report");
      const report = await this.one(client, workspaceId, projectId, id, body.version);
      if (!who.manager) throw new ForbiddenException("Only the project manager approves site reports.");
      if (report.authorId === userId) throw new ForbiddenException("Someone other than its author approves a report.");
      if (report.status !== "submitted") throw new ConflictException("Only a submitted report is approved or sent back.");
      if (action === "return") {
        if (report.delivery === "sent") throw new ConflictException("This day already went to the client. Approve it, and correct anything in the next report.");
        const note = text(body.note, 500);
        if (!note) throw new BadRequestException("Say what to change.");
        await client.query(`UPDATE site_reports SET status = 'returned', decided_by = $3, decided_at = now(), decision_note = $4, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, id, userId, note]);
        await this.tell(client, workspaceId, projectId, "site.report_returned", [report.authorId], userId, note, `return:${id}:${report.version}`);
        audit = { reportId: id };
      } else {
        await this.install(client, workspaceId, projectId, report, userId);
        const hold = action === "approve_hold";
        await client.query(`UPDATE site_reports SET status = 'approved', decided_by = $3, decided_at = now(), delivery = CASE WHEN $4 AND delivery <> 'sent' THEN 'internal' ELSE delivery END,
          version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, userId, hold]);
        const sent = action === "approve_send" && report.delivery !== "sent" ? await publishReport(client, workspaceId, { reportId: id, userId, automatic: false }) : null;
        await this.tell(client, workspaceId, projectId, "site.report_approved", [report.authorId], userId,
          sent ? `${report.reportDate} went to the client.` : hold ? `${report.reportDate} stays internal.` : `${report.reportDate}.`, `approve:${id}`);
        audit = { reportId: id, delivery: sent ? "sent" : hold ? "internal" : report.delivery, ...(sent ? { photos: sent.photos, told: sent.told } : {}) };
      }
    } else if (action === "send") {
      // An approved day that wasn't sent (kept internal, or approved without a decision) goes to the client now.
      const id = uuid(body.reportId, "Report");
      const report = await this.one(client, workspaceId, projectId, id, body.version);
      if (!who.manager) throw new ForbiddenException("Only the project manager sends a day to the client.");
      if (report.status !== "approved") throw new ConflictException("Approve the report before sending it.");
      if (report.delivery === "sent") throw new ConflictException("This day already went to the client.");
      const sent = await publishReport(client, workspaceId, { reportId: id, userId, automatic: false });
      audit = { reportId: id, photos: sent?.photos ?? 0, told: sent?.told ?? null };
    } else if (action === "review") {
      audit = await this.review(client, workspaceId, projectId, userId, who.manager, body);
    } else if (action === "reject_installation") {
      // Installed work that isn't accepted: a snag with why, and its finished tasks open again for rework.
      if (!who.manager) throw new ForbiddenException("Only the project manager decides what isn't accepted.");
      const report = (await this.reports(client, workspaceId, projectId, uuid(body.reportId, "Report")))[0];
      if (!report) throw new NotFoundException("Report not found.");
      if (report.status !== "approved") throw new ConflictException("Only approved installation can be not accepted.");
      const line = report.lines.find((item) => item.id === body.lineId);
      if (!line || Dec.of(line.installed).cmp(0) <= 0) throw new BadRequestException("Choose an installed item of this report.");
      const reason = text(body.reason, 1000);
      if (!reason) throw new BadRequestException("Say what isn't right.");
      const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "";
      audit = { reportId: report.id, lineId: line.id, ...(await reworkInstallation(client, workspaceId, { projectId, projectTitle: `${project.reference} · ${project.name}`,
        boqLineId: line.boqLineId, title: line.title, reason, actorId: userId, actorName: actor })) };
    } else if (action === "share_photo") {
      // The project manager shares more of a sent day's photos with the client (or takes one back).
      if (!who.manager) throw new ForbiddenException("Only the project manager shares photos with the client.");
      const photo = (await client.query<{ id: string; status: string; delivery: string }>(
        `SELECT photo.id, report.status, report.delivery FROM site_report_photos photo JOIN site_reports report ON report.workspace_id = photo.workspace_id AND report.id = photo.report_id
          WHERE photo.workspace_id = $1 AND photo.id = $2 AND report.project_id = $3`, [workspaceId, uuid(body.photoId, "Photo"), projectId])).rows[0];
      if (!photo) throw new NotFoundException("Photo not found.");
      const shared = body.shared === true;
      if (shared && photo.status !== "approved") throw new ConflictException("Approve the report before sharing its photos.");
      await client.query(`UPDATE site_report_photos SET shared_at = CASE WHEN $3::boolean THEN coalesce(shared_at, now()) END,
        shared_by = CASE WHEN $3::boolean THEN coalesce(shared_by, $4::uuid) END, for_client = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, photo.id, shared, userId]);
      audit = { photoId: photo.id, shared };
    } else throw new BadRequestException("Unknown action.");
    await recordAudit(client, { workspaceId, actorUserId: userId, action: `site.${action}`, entityType: "project", entityId: projectId, after: { projectId, ...audit } });
    return this.read(client, workspaceId, projectId, userId);
  }

  /** Saves a draft (the phone and the web save as the person types): each part only when it's sent, so a partial save keeps the rest. */
  private async save(client: Db, workspaceId: string, projectId: string, userId: string, onTeam: boolean, today: string, body: Record<string, unknown>) {
    if (!onTeam) throw new ForbiddenException("Only the project's team reports on its site.");
    const id = uuid(body.id, "Report");
    const existing = (await client.query<{ authorId: string; status: string; version: number }>(
      `SELECT author_id AS "authorId", status, version FROM site_reports WHERE workspace_id = $1 AND id = $2 AND project_id = $3 FOR UPDATE`, [workspaceId, id, projectId])).rows[0];
    if (existing && existing.authorId !== userId) throw new ForbiddenException("Only its author changes a report.");
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
      const hours = row?.hours === undefined || row?.hours === null || row?.hours === "" ? null : Number(row.hours);
      if (hours !== null && !(Number.isFinite(hours) && hours > 0 && hours <= 24)) throw new BadRequestException(`${trade}: hours on site, up to 24.`);
      return { trade, people: count, hours: hours === null ? null : hours.toFixed(2) };
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
    const tasks = body.tasks === undefined ? undefined : await this.parseTasks(client, workspaceId, projectId, body.tasks);
    const next = body.next === undefined ? undefined : await this.parseNext(client, workspaceId, projectId, body.next);
    const materials = body.materials === undefined ? undefined : await this.parseMaterials(client, workspaceId, projectId, body.materials);
    const issues = body.issues === undefined ? undefined : parseIssues(body.issues);
    const values = [text(body.weather, 120), safety, safetyNote, forecast, impact, forecast === "none" ? null : recoveryOwnerId, forecast === "none" ? null : recoveryOn,
      text(body.noWorkReason, 500), text(body.notes, 4000)];
    if (existing) {
      await client.query(`UPDATE site_reports SET report_date = $3, weather = $4, safety = $5, safety_note = $6, forecast = $7, impact = $8, recovery_owner_id = $9, recovery_on = $10,
        no_work_reason = $11, notes = $12, status = 'draft', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, reportDate, ...values]);
      if (body.workforce !== undefined) await client.query(`DELETE FROM site_report_workforce WHERE workspace_id = $1 AND report_id = $2`, [workspaceId, id]);
      if (body.lines !== undefined) await client.query(`DELETE FROM site_report_lines WHERE workspace_id = $1 AND report_id = $2`, [workspaceId, id]);
    } else {
      try {
        await client.query(
          `INSERT INTO site_reports (id, workspace_id, project_id, report_date, author_id, weather, safety, safety_note, forecast, impact, recovery_owner_id, recovery_on, no_work_reason, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`, [id, workspaceId, projectId, reportDate, userId, ...values]);
      } catch (error) {
        if ((error as { constraint?: string }).constraint === "site_reports_workspace_id_project_id_report_date_author_id_key") throw new ConflictException("You already have a report for that day: open it instead.");
        throw error;
      }
    }
    // The first report starts site work (nobody has to press "Start site work" first).
    await client.query(`UPDATE delivery_projects SET site_started_on = $3 WHERE workspace_id = $1 AND id = $2 AND site_started_on IS NULL`, [workspaceId, projectId, reportDate]);
    if (!existing || body.workforce !== undefined)
      for (const row of people) await client.query(`INSERT INTO site_report_workforce (id, workspace_id, report_id, trade, people, hours) VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), workspaceId, id, row.trade, row.people, row.hours]);
    if (!existing || body.lines !== undefined)
      for (const entry of entries) await client.query(`INSERT INTO site_report_lines (id, workspace_id, report_id, boq_line_id, installed, note) VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), workspaceId, id, entry.boqLineId, entry.installed, entry.note]);
    if (tasks) {
      // What the item was at when the day's report first named it, and what the manager hid, are kept across saves.
      const kept = new Map((await client.query<{ workItemId: string; previous: number | null; hidden: boolean }>(
        `SELECT work_item_id AS "workItemId", previous, hidden FROM site_report_tasks WHERE workspace_id = $1 AND report_id = $2`, [workspaceId, id])).rows.map((row) => [row.workItemId, row]));
      await client.query(`DELETE FROM site_report_tasks WHERE workspace_id = $1 AND report_id = $2`, [workspaceId, id]);
      for (const [position, task] of tasks.entries()) {
        const before = kept.get(task.workItemId);
        await client.query(`INSERT INTO site_report_tasks (id, workspace_id, report_id, work_item_id, progress, previous, note, hidden, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [randomUUID(), workspaceId, id, task.workItemId, task.progress, before ? before.previous : task.previous, task.note, before?.hidden ?? false, position]);
      }
    }
    if (next) {
      await client.query(`DELETE FROM site_report_next WHERE workspace_id = $1 AND report_id = $2`, [workspaceId, id]);
      for (const [position, item] of next.entries())
        await client.query(`INSERT INTO site_report_next (id, workspace_id, report_id, work_item_id, title, position) VALUES ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), workspaceId, id, item.workItemId, item.title, position]);
    }
    if (materials) {
      await client.query(`DELETE FROM site_report_materials WHERE workspace_id = $1 AND report_id = $2`, [workspaceId, id]);
      for (const [position, item] of materials.entries())
        await client.query(`INSERT INTO site_report_materials (id, workspace_id, report_id, direction, description, quantity, unit, purchase_order_id, stock_transfer_id, position)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [randomUUID(), workspaceId, id, item.direction, item.description, item.quantity, item.unit, item.purchaseOrderId, item.stockTransferId, position]);
    }
    if (issues) {
      // An issue keeps its id (a snag or a material request raised from it points back at it).
      const known = new Map((await client.query<{ id: string; reportId: string }>(`SELECT id, report_id AS "reportId" FROM site_report_issues WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
        [workspaceId, issues.map((issue) => issue.id)])).rows.map((row) => [row.id, row.reportId]));
      if ([...known.values()].some((reportId) => reportId !== id)) throw new ConflictException("This issue belongs to another report.");
      await client.query(`DELETE FROM site_report_issues WHERE workspace_id = $1 AND report_id = $2 AND NOT (id = ANY($3::uuid[]))`, [workspaceId, id, issues.map((issue) => issue.id)]);
      for (const [position, issue] of issues.entries())
        await client.query(`INSERT INTO site_report_issues (id, workspace_id, report_id, severity, description, internal, position) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE SET severity = EXCLUDED.severity, description = EXCLUDED.description, internal = EXCLUDED.internal, position = EXCLUDED.position`,
          [issue.id, workspaceId, id, issue.severity, issue.description, issue.internal, position]);
    }
    if (Array.isArray(body.photos)) for (const photo of body.photos as Array<Record<string, unknown>>) await this.tagPhoto(client, workspaceId, projectId, id, photo);
    return { reportId: id, reportDate, lines: entries.length, tasks: tasks?.length ?? null, issues: issues?.length ?? null };
  }

  /** Today's work and how far it got: tasks of this project, each once, at a whole percent. */
  private async parseTasks(client: Db, workspaceId: string, projectId: string, value: unknown) {
    const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
    if (rows.length > 60) throw new BadRequestException("Up to 60 tasks in a day's report.");
    const ids = rows.map((row) => uuid(row?.workItemId, "Task"));
    if (new Set(ids).size !== ids.length) throw new BadRequestException("Each task once per report.");
    const found = new Map((await client.query<{ id: string; type: string; progress: number | null; number: number; subtasks: boolean }>(
      `SELECT item.id, item.type, item.progress, item.number,
              EXISTS (SELECT 1 FROM work_items child WHERE child.workspace_id = item.workspace_id AND child.parent_id = item.id AND child.status <> 'cancelled') AS subtasks
         FROM work_items item WHERE item.workspace_id = $1 AND item.project_id = $2 AND item.id = ANY($3::uuid[]) AND item.status <> 'cancelled'`, [workspaceId, projectId, ids])).rows
      .map((row) => [row.id, row]));
    return rows.map((row, index) => {
      const item = found.get(ids[index]);
      if (!item || item.type !== "task") throw new BadRequestException("Choose tasks from this project's plan.");
      // A task with subtasks moves with them: the day reports on the subtasks.
      if (item.subtasks) throw new BadRequestException(`#${item.number} has subtasks: report on those instead.`);
      const progress = Number(row?.progress);
      if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new BadRequestException(`#${item.number}: progress is a whole percent from 0 to 100.`);
      return { workItemId: item.id, progress, previous: item.progress, note: text(row?.note, 500) };
    });
  }

  /** Tomorrow's plan: the plan's work (of this project) or a line of text. */
  private async parseNext(client: Db, workspaceId: string, projectId: string, value: unknown) {
    const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
    if (rows.length > 20) throw new BadRequestException("Up to 20 things for tomorrow.");
    const ids = rows.map((row) => (row?.workItemId ? uuid(row.workItemId, "Task") : null)).filter((id): id is string => Boolean(id));
    const found = new Map((await client.query<{ id: string; title: string }>(`SELECT id, title FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND id = ANY($3::uuid[])`,
      [workspaceId, projectId, ids])).rows.map((row) => [row.id, row.title]));
    return rows.map((row) => {
      const workItemId = row?.workItemId ? String(row.workItemId) : null;
      if (workItemId && !found.has(workItemId)) throw new BadRequestException("Choose tomorrow's work from this project's plan.");
      const title = text(row?.title, 300) || (workItemId ? found.get(workItemId)! : "");
      if (!title) throw new BadRequestException("Say what's planned for tomorrow.");
      return { workItemId, title };
    });
  }

  /** Materials received or used, each with the delivery it came on when there is one (an order for this project, or a stock move to its site). */
  private async parseMaterials(client: Db, workspaceId: string, projectId: string, value: unknown) {
    const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
    if (rows.length > 30) throw new BadRequestException("Up to 30 materials in a day's report.");
    return Promise.all(rows.map(async (row, index) => {
      const direction = oneOf(row?.direction ?? "received", ["received", "used"] as const, "Material");
      const description = text(row?.description, 300);
      if (!description) throw new BadRequestException(`Say what the material is on row ${index + 1}.`);
      const raw = row?.quantity === undefined || row?.quantity === null || row?.quantity === "" ? null : signed(row.quantity, `${description}: quantity`);
      if (raw !== null && Dec.of(raw).cmp(0) <= 0) throw new BadRequestException(`${description}: the quantity is more than nothing.`);
      const purchaseOrderId = row?.purchaseOrderId ? uuid(row.purchaseOrderId, "Order") : null;
      const stockTransferId = row?.stockTransferId ? uuid(row.stockTransferId, "Stock move") : null;
      if (purchaseOrderId && stockTransferId) throw new BadRequestException(`${description}: one delivery at a time.`);
      if (purchaseOrderId && !(await client.query(`SELECT 1 FROM purchase_order_lines WHERE workspace_id = $1 AND order_id = $2 AND project_id = $3 LIMIT 1`,
        [workspaceId, purchaseOrderId, projectId])).rowCount) throw new BadRequestException("Choose a delivery for this project.");
      if (stockTransferId && !(await client.query(`SELECT 1 FROM stock_transfers transfer JOIN stock_locations place ON place.workspace_id = transfer.workspace_id AND place.id = transfer.to_location_id
        WHERE transfer.workspace_id = $1 AND transfer.id = $2 AND place.project_id = $3`, [workspaceId, stockTransferId, projectId])).rowCount) throw new BadRequestException("Choose a delivery for this project.");
      return { direction, description, quantity: raw, unit: text(row?.unit, 20), purchaseOrderId, stockTransferId };
    }));
  }

  /** A photo's room or area (one of the project's), before or after, and the photo of this report it pairs with. */
  private async tagPhoto(client: Db, workspaceId: string, projectId: string, reportId: string, input: Record<string, unknown>) {
    const id = typeof input?.id === "string" && UUID.test(input.id) ? input.id : null;
    if (!id) return;
    const photo = (await client.query<{ id: string }>(`SELECT id FROM site_report_photos WHERE workspace_id = $1 AND report_id = $2 AND id = $3`, [workspaceId, reportId, id])).rows[0];
    // A photo still on its way from the phone is tagged when it arrives (its upload carries the same tags).
    if (!photo) return;
    const areaId = input.areaId ? uuid(input.areaId, "Area") : null;
    if (areaId && !(await client.query(`SELECT 1 FROM pre_project_rooms room JOIN delivery_projects project ON project.workspace_id = room.workspace_id AND project.case_id = room.case_id
      WHERE room.workspace_id = $1 AND room.id = $2 AND project.id = $3`, [workspaceId, areaId, projectId])).rowCount) throw new BadRequestException("Choose one of the project's rooms or areas.");
    const phase = input.phase === "before" || input.phase === "after" ? input.phase : null;
    const pairId = input.pairId && input.pairId !== id ? uuid(input.pairId, "Photo") : null;
    const pair = pairId ? (await client.query<{ id: string }>(`SELECT id FROM site_report_photos WHERE workspace_id = $1 AND report_id = $2 AND id = $3`, [workspaceId, reportId, pairId])).rows[0] : null;
    // Pairs go both ways: the other half points back (and anything that paired with either lets go).
    await client.query(`UPDATE site_report_photos SET pair_id = NULL WHERE workspace_id = $1 AND report_id = $2 AND pair_id = $3 AND id <> coalesce($4::uuid, id)`, [workspaceId, reportId, id, pair?.id ?? null]);
    await client.query(`UPDATE site_report_photos SET area_id = $4, phase = $5, pair_id = $6 WHERE workspace_id = $1 AND report_id = $2 AND id = $3`,
      [workspaceId, reportId, id, areaId, phase, pair?.id ?? null]);
    if (pair) await client.query(`UPDATE site_report_photos SET pair_id = $3, phase = coalesce(phase, CASE $4::text WHEN 'before' THEN 'after' WHEN 'after' THEN 'before' END), area_id = coalesce(area_id, $5)
      WHERE workspace_id = $1 AND id = $2`, [workspaceId, pair.id, id, phase, areaId]);
  }

  /** The day's best photos for the client, unless the manager already chose: after photos first, then those tagged to a room, in order. */
  private async pickPhotos(client: Db, workspaceId: string, reportId: string) {
    const chosen = (await client.query(`SELECT 1 FROM site_report_photos WHERE workspace_id = $1 AND report_id = $2 AND for_client LIMIT 1`, [workspaceId, reportId])).rowCount;
    if (!chosen) await client.query(
      `UPDATE site_report_photos SET for_client = true WHERE workspace_id = $1 AND id IN (
         SELECT id FROM site_report_photos WHERE workspace_id = $1 AND report_id = $2 AND mime_type LIKE 'image/%'
          ORDER BY (phase = 'after') DESC NULLS LAST, (area_id IS NOT NULL) DESC, position, created_at LIMIT ${CLIENT_PHOTOS})`, [workspaceId, reportId]);
    await client.query(
      `UPDATE site_reports report SET hero_photo_id = (SELECT photo.id FROM site_report_photos photo WHERE photo.workspace_id = report.workspace_id AND photo.report_id = report.id AND photo.for_client
                                                        ORDER BY (photo.phase = 'after') DESC NULLS LAST, photo.position, photo.created_at LIMIT 1)
        WHERE report.workspace_id = $1 AND report.id = $2 AND (report.hero_photo_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM site_report_photos hero WHERE hero.workspace_id = report.workspace_id AND hero.id = report.hero_photo_id AND hero.for_client))`, [workspaceId, reportId]);
  }

  /**
   * The manager's review before it goes: the client's words (edited in place), which photos go (and the hero), and
   * which items the client doesn't see. While it waits for approval, or once approved and not yet sent.
   */
  private async review(client: Db, workspaceId: string, projectId: string, userId: string, manager: boolean, body: Record<string, unknown>) {
    const id = uuid(body.reportId, "Report");
    const report = await this.one(client, workspaceId, projectId, id, body.version);
    if (!manager) throw new ForbiddenException("Only the project manager reviews what the client sees.");
    if (report.authorId === userId) throw new ForbiddenException("Someone other than its author reviews a report.");
    if (!(report.status === "submitted" || report.status === "approved") || report.delivery === "sent") throw new ConflictException("Only a report waiting to go to the client is reviewed.");
    const changed: string[] = [];
    if (body.summary !== undefined) {
      const summary = text(body.summary, 1200);
      if (!summary) throw new BadRequestException("Write a few words for the client.");
      await client.query(`UPDATE site_reports SET client_summary = $3, summary_source = 'edited' WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, summary]);
      changed.push("summary");
    }
    if (Array.isArray(body.photos)) {
      for (const photo of body.photos as Array<Record<string, unknown>>) {
        if (!report.photos.some((item) => item.id === photo?.id)) throw new BadRequestException("Choose photos of this report.");
        await client.query(`UPDATE site_report_photos SET for_client = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, photo.id, photo.forClient === true]);
      }
      const count = (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM site_report_photos WHERE workspace_id = $1 AND report_id = $2 AND for_client`, [workspaceId, id])).rows[0].count;
      if (count > CLIENT_PHOTOS) throw new BadRequestException(`Up to ${CLIENT_PHOTOS} photos go to the client.`);
      changed.push("photos");
    }
    if (body.heroPhotoId !== undefined) {
      const hero = body.heroPhotoId ? uuid(body.heroPhotoId, "Photo") : null;
      if (hero && !report.photos.some((item) => item.id === hero)) throw new BadRequestException("Choose a photo of this report.");
      if (hero) await client.query(`UPDATE site_report_photos SET for_client = true WHERE workspace_id = $1 AND id = $2`, [workspaceId, hero]);
      await client.query(`UPDATE site_reports SET hero_photo_id = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, hero]);
      changed.push("hero");
    }
    for (const [key, table, rows] of [["tasks", "site_report_tasks", report.tasks], ["next", "site_report_next", report.next]] as const) {
      if (!Array.isArray(body[key])) continue;
      for (const entry of body[key] as Array<Record<string, unknown>>) {
        if (!(rows as Array<{ id: string }>).some((row) => row.id === entry?.id)) throw new BadRequestException("Choose items of this report.");
        await client.query(`UPDATE ${table} SET hidden = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, entry.id, entry.hidden === true]);
      }
      changed.push(key);
    }
    if (!changed.length) throw new BadRequestException("Nothing to change.");
    await client.query(`UPDATE site_reports SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
    return { reportId: id, changed };
  }

  /** A report of this project at the version the person saw. */
  private async one(client: Db, workspaceId: string, projectId: string, id: string, version: unknown) {
    const report = (await this.reports(client, workspaceId, projectId, id))[0];
    if (!report) throw new NotFoundException("Report not found.");
    if (version !== report.version) throw new ConflictException("This report changed elsewhere. Reload to see it.");
    return report;
  }

  /**
   * Raises the real record from a day's issue: a snag (the plan's snag, in its room) or a material request (a blocker
   * on the plan for whoever buys, holding up the task it names). Created through the plan's own command with the
   * issue's id, so a retry never makes two; the manager (and the buyer) hear about material needed.
   */
  private async raiseIssue(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    const issueId = uuid(body.issueId, "Issue");
    const kind = oneOf(body.kind, ["snag", "material"] as const, "What to raise");
    const found = await this.access.asMember(actor, workspaceId, async (client, user) => {
      const who = await this.who(client, workspaceId, projectId, user.userId);
      if (!who.onTeam) throw new ForbiddenException("Only the project's team raises work from a report.");
      if (who.project.status !== "active") throw new ConflictException("The project isn't running.");
      const issue = (await client.query<{ id: string; severity: (typeof SEVERITIES)[number]; description: string; raised: string | null; reportDate: string }>(
        `SELECT issue.id, issue.severity, issue.description, issue.raised, report.report_date::text AS "reportDate" FROM site_report_issues issue
           JOIN site_reports report ON report.workspace_id = issue.workspace_id AND report.id = issue.report_id WHERE issue.workspace_id = $1 AND issue.id = $2 AND report.project_id = $3`,
        [workspaceId, issueId, projectId])).rows[0];
      if (!issue) throw new NotFoundException("Save the report first, then raise it.");
      const buyer = (await client.query<{ membershipId: string; userId: string }>(
        `SELECT assignment.membership_id AS "membershipId", membership.user_id AS "userId" FROM project_assignments assignment
           JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
          WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND ('buyer' = ANY(assignment.role_keys) OR assignment.is_manager)
          ORDER BY ('buyer' = ANY(assignment.role_keys)) DESC LIMIT 1`, [workspaceId, projectId])).rows[0] ?? null;
      return { issue, buyer, userId: user.userId };
    });
    if (found.issue.raised) return this.state(actor, workspaceId, projectId);
    const blocks = kind === "material" && body.blocks ? uuid(body.blocks, "Task") : null;
    const areaId = kind === "snag" && body.areaId ? uuid(body.areaId, "Area") : null;
    const title = (kind === "snag" ? found.issue.description : `Material needed: ${found.issue.description}`).split("\n")[0].slice(0, 300);
    const description = `From the site report of ${found.issue.reportDate}:\n${found.issue.description}`;
    if (this.work) {
      await this.work.command(actor, workspaceId, projectId, kind === "snag"
        ? { action: "create", id: issueId, type: "snag", title, description, severity: found.issue.severity, source: "inspection", ...(areaId ? { areaId } : {}) }
        : { action: "create", id: issueId, type: "blocker", title, description, ...(blocks ? { blocks } : {}), ...(found.buyer ? { assigneeId: found.buyer.membershipId } : {}) });
    }
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      // Without the plan's service (the site on its own), the same records through the plan's shared functions.
      const itemId = this.work ? issueId : kind === "snag"
        ? (await raiseSnag(client, workspaceId, { projectId, title, description, severity: found.issue.severity, source: "inspection", actorId: user.userId })).id
        : (await raiseBlocker(client, workspaceId, { projectId, title, description, assigneeMembershipId: found.buyer?.membershipId ?? null, blocks: blocks ? [blocks] : [], actorId: user.userId })).id;
      await client.query(`UPDATE site_report_issues SET raised = $3, work_item_id = $4 WHERE workspace_id = $1 AND id = $2 AND raised IS NULL`, [workspaceId, issueId, kind, itemId]);
      if (kind === "material") await this.tell(client, workspaceId, projectId, "site.material_requested",
        [...new Set([...(await this.leads(client, workspaceId, projectId)), ...(found.buyer ? [found.buyer.userId] : [])])], user.userId, found.issue.description, `material:${issueId}`);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "site.raise_issue", entityType: "project", entityId: projectId, after: { projectId, issueId, kind, workItemId: itemId } });
      return this.read(client, workspaceId, projectId, user.userId);
    });
  }

  /**
   * D-29: the project manager or a buyer records the client's confirmation of site access for them (given by phone),
   * or moves the delivery to a new day with a reason (and whether the new delivery is charged). Version-checked and audited.
   */
  arrangeAccess(actor: RequestActor, workspaceId: string, projectId: string, requestId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      if (!(await this.access.hasPermission(client, workspaceId, user.userId, "purchasing.manage"))) {
        const who = await this.who(client, workspaceId, projectId, user.userId);
        if (!who.manager) throw new ForbiddenException("Only the project manager or a buyer arranges deliveries.");
      }
      const project = await readProject(client, workspaceId, projectId);
      if (!project) throw new NotFoundException("Project not found.");
      if (project.status !== "active") throw new ConflictException("The project isn't running.");
      const result = await arrangeSiteAccess(client, workspaceId, projectId, user.userId, requestId, body);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `site_access.${String(body.action)}`, entityType: "site_access_request", entityId: result.id, after: result.audit });
      return { ok: true, id: result.id };
    });
  }

  /** Writes the client's words with Woddy; the template stays when AI is off, out of credits or slow — a submit never fails for it. */
  private async summaryInTime(actor: RequestActor, workspaceId: string, projectId: string, reportId: string) {
    if (!this.ai?.configured) return;
    const writing = this.writeSummary(actor, workspaceId, projectId, reportId, false).catch((error: unknown) => {
      this.logger.warn(`Daily summary for ${reportId} kept its template (${(error as Error)?.name ?? "error"})`);
    });
    await Promise.race([writing, new Promise((resolve) => setTimeout(resolve, SUMMARY_WAIT_MS))]);
  }

  /** "Rewrite with Woddy" on the review: the manager asked, so the answer (or why not) comes back to them. */
  private async rewriteSummary(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    const reportId = uuid(body.reportId, "Report");
    await this.access.asMember(actor, workspaceId, async (client, user) => {
      const who = await this.who(client, workspaceId, projectId, user.userId);
      if (!who.manager) throw new ForbiddenException("Only the project manager rewrites what the client reads.");
      await this.one(client, workspaceId, projectId, reportId, body.version);
    });
    if (!this.ai) throw new ConflictException("AI assistance is not set up yet.");
    await this.writeSummary(actor, workspaceId, projectId, reportId, true);
    return this.state(actor, workspaceId, projectId);
  }

  private async writeSummary(actor: RequestActor, workspaceId: string, projectId: string, reportId: string, replace: boolean) {
    const facts = await this.access.asMember(actor, workspaceId, (client) => readSummaryFacts(client, workspaceId, reportId));
    if (!facts || !this.ai) return;
    const language = await this.access.asMember(actor, workspaceId, async (client) => (await client.query<{ locale: string }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`,
      [workspaceId])).rows[0]?.locale ?? "en");
    const summary = await this.ai.run(actor, workspaceId, { feature: "site.daily_summary", automatic: true, maxTokens: 600, validate: validateSummary,
      system: `${SUMMARY_SYSTEM}\nWrite in the language of the locale ${language}.`, prompt: JSON.stringify({ facts }) });
    await this.access.asMember(actor, workspaceId, async (client, user) => {
      const written = (await client.query(
        `UPDATE site_reports SET client_summary = $4, summary_source = 'ai', version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND delivery <> 'sent' AND status IN ('submitted', 'approved') AND ($5::boolean OR summary_source IN ('none', 'template'))`,
        [workspaceId, projectId, reportId, summary.slice(0, 1200), replace])).rowCount;
      if (written) await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "site.summary_written", entityType: "project", entityId: projectId,
        after: { projectId, reportId, source: "ai", requested: replace } });
    });
  }

  /** A photo for a report its author is still writing (up to 20), with its room, before/after and pair; replayed safely by its id. */
  async uploadPhoto(actor: RequestActor, workspaceId: string, projectId: string, reportId: string, photoId: string, file?: ReferenceUpload, tags: Record<string, unknown> = {}) {
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
        if (count >= PHOTO_LIMIT) throw new BadRequestException(`A report takes up to ${PHOTO_LIMIT} photos.`);
        const key = `site/reports/${workspaceId}/${id}`;
        await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
        if (prepared.preview) await storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
        await client.query(
          `INSERT INTO site_report_photos (id, workspace_id, report_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, created_by, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [id, workspaceId, reportId, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`, prepared.preview ? `${key}/preview.webp` : null, prepared.digest, user.userId, count]);
        if (tags.areaId || tags.phase || tags.pairId) await this.tagPhoto(client, workspaceId, projectId, reportId, { id, areaId: tags.areaId || null, phase: tags.phase || null, pairId: tags.pairId || null });
        await client.query(`UPDATE site_reports SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, reportId]);
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
    const today = await this.today(client, workspaceId);
    const { dueTime } = await readProgressSettings(client, workspaceId);
    const reports = await this.reports(client, workspaceId, projectId);
    const tomorrow = await readTomorrowPlan(client, workspaceId, projectId, today);
    return {
      site: { startedOn: dates.started, finishedOn: dates.finished },
      reports,
      lines: await this.lines(client, workspaceId, projectId),
      members: await activeMembers(client, workspaceId),
      today, dueTime,
      // What the day's report starts from: today's planned work, tomorrow's, the rooms, deliveries and the last crew.
      plan: { today: await readTodayPlan(client, workspaceId, projectId, today), tomorrow },
      areas: (await client.query<{ id: string; name: string }>(`SELECT room.id, room.name FROM pre_project_rooms room WHERE room.workspace_id = $1 AND room.case_id = $2 ORDER BY room.name`,
        [workspaceId, who.project.caseId])).rows,
      deliveries: await this.deliveries(client, workspaceId, projectId, today),
      crew: reports.find((report) => report.reportDate < today && report.workforce.length)?.workforce ?? [],
      // Worked days since site work started without a submitted report (the last two weeks), for the timeline's late markers.
      missing: await this.missingDays(client, workspaceId, projectId, today, dates.started, dates.finished, dueTime),
      // Nothing new is reported while the project is on hold; reports already submitted can still be decided.
      me: userId, canReport: who.onTeam && who.project.status === "active", canApprove: who.manager, canManage: who.manager && who.project.status === "active",
      // Site access (HR's list of who may be on site) is for the project's managers and site supervisors, and HR.
      canSeeSiteAccess: await this.seesSiteAccess(client, workspaceId, projectId, userId, who.manager),
    };
  }

  /** Recent deliveries to the site (orders for this project delivering there, and stock moves to it), to link a material to. */
  private async deliveries(client: Db, workspaceId: string, projectId: string, today: string) {
    return (await client.query<{ kind: "order" | "transfer"; id: string; label: string; on: string | null; received: boolean }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (purchase.id) 'order' AS kind, purchase.id, purchase.number || ' · ' || vendor.display_name AS label,
                coalesce(line.promised_date, purchase.promised_date, purchase.expected_date)::text AS "on",
                EXISTS (SELECT 1 FROM goods_receipts receipt WHERE receipt.workspace_id = purchase.workspace_id AND receipt.order_id = purchase.id) AS received
           FROM purchase_orders purchase
           JOIN purchase_order_lines line ON line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id AND line.project_id = $2
           JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
          WHERE purchase.workspace_id = $1 AND purchase.deliver_to = 'site' AND purchase.status IN ('sent', 'confirmed', 'partly_received', 'received', 'closed')
            AND coalesce(line.promised_date, purchase.promised_date, purchase.expected_date, $3::date) BETWEEN $3::date - 7 AND $3::date + 1
         UNION ALL
         SELECT 'transfer', transfer.id, 'Move ' || transfer.number, coalesce(transfer.received_on, transfer.sent_on)::text, transfer.status = 'received'
           FROM stock_transfers transfer JOIN stock_locations place ON place.workspace_id = transfer.workspace_id AND place.id = transfer.to_location_id AND place.project_id = $2
          WHERE transfer.workspace_id = $1 AND transfer.status <> 'cancelled' AND coalesce(transfer.received_on, transfer.sent_on) >= $3::date - 7) delivered
       ORDER BY "on" DESC NULLS LAST LIMIT 12`, [workspaceId, projectId, today])).rows;
  }

  private async missingDays(client: Db, workspaceId: string, projectId: string, today: string, started: string | null, finished: string | null, dueTime: string) {
    if (!started) return [];
    const math = workdays(await readCalendar(client, workspaceId));
    const reported = new Set((await client.query<{ day: string }>(
      `SELECT DISTINCT report_date::text AS day FROM site_reports WHERE workspace_id = $1 AND project_id = $2 AND status IN ('submitted', 'approved') AND report_date >= $3::date - 14`,
      [workspaceId, projectId, today])).rows.map((row) => row.day));
    const clock = await this.clock(client, workspaceId);
    const [hour, minute] = dueTime.split(":").map(Number);
    const days: string[] = [];
    for (let back = 0; back <= 14; back++) {
      const day = new Date(Date.parse(`${today}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
      if (day < started || (finished && day > finished) || !math.isWorking(day) || reported.has(day)) continue;
      if (day === today && clock.minutes < hour * 60 + minute) continue;
      days.push(day);
    }
    return days;
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
    const rows = (await client.query<Omit<Report, "workforce" | "lines" | "photos" | "tasks" | "next" | "materials" | "issues" | "reactions">>(
      `SELECT report.id, report.report_date::text AS "reportDate", report.author_id AS "authorId", author.display_name AS "authorName", report.status, report.weather, report.safety,
              report.safety_note AS "safetyNote", report.forecast, report.impact, report.recovery_owner_id AS "recoveryOwnerId", owner_user.display_name AS "recoveryOwnerName",
              report.recovery_on::text AS "recoveryOn", report.no_work_reason AS "noWorkReason", report.notes, decider.display_name AS "decidedByName", report.decision_note AS "decisionNote", report.version,
              report.submitted_at AS "submittedAt", report.decided_at AS "decidedAt", report.updated_at AS "updatedAt",
              coalesce(report.submitted_at > ((report.report_date + settings.due) AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC')),
                       report.status = 'draft' AND now() > ((report.report_date + settings.due) AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))) AS late,
              report.client_summary AS "clientSummary", report.summary_source AS "summarySource", report.hero_photo_id AS "heroPhotoId", report.delivery, report.sent_at AS "sentAt",
              sender.display_name AS "sentByName", report.sent_automatically AS "sentAutomatically"
         FROM site_reports report
         JOIN workspaces workspace ON workspace.id = report.workspace_id
         CROSS JOIN LATERAL (SELECT coalesce((SELECT report_due_time FROM workspace_project_settings WHERE workspace_id = report.workspace_id), time '18:00') AS due) settings
         JOIN users author ON author.id = report.author_id
         LEFT JOIN users decider ON decider.id = report.decided_by
         LEFT JOIN users sender ON sender.id = report.sent_by
         LEFT JOIN workspace_memberships owner ON owner.workspace_id = report.workspace_id AND owner.id = report.recovery_owner_id
         LEFT JOIN users owner_user ON owner_user.id = owner.user_id
        WHERE report.workspace_id = $1 AND report.project_id = $2 AND ($3::uuid IS NULL OR report.id = $3)
        ORDER BY report.report_date DESC, report.created_at DESC LIMIT 120`, [workspaceId, projectId, id])).rows;
    const ids = rows.map((row) => row.id);
    const approvers = rows.some((row) => row.status === "submitted") ? await this.approvers(client, workspaceId, projectId) : [];
    const byReport = <T extends { reportId: string }>(list: T[], reportId: string) => list.filter((item) => item.reportId === reportId).map(({ reportId: _reportId, ...item }) => item);
    const workforce = (await client.query<{ reportId: string; trade: string; people: number; hours: string | null }>(
      `SELECT report_id AS "reportId", trade, people, hours::text AS hours FROM site_report_workforce WHERE workspace_id = $1 AND report_id = ANY($2::uuid[]) ORDER BY trade`, [workspaceId, ids])).rows;
    const lines = (await client.query<{ reportId: string; id: string; boqLineId: string; title: string; unit: string; installed: string; note: string }>(
      `SELECT entry.report_id AS "reportId", entry.id, entry.boq_line_id AS "boqLineId", line.title, line.unit, entry.installed::text AS installed, entry.note
         FROM site_report_lines entry JOIN project_boq_lines line ON line.workspace_id = entry.workspace_id AND line.id = entry.boq_line_id
        WHERE entry.workspace_id = $1 AND entry.report_id = ANY($2::uuid[]) ORDER BY line.position`, [workspaceId, ids])).rows;
    const photos = (await client.query<{ reportId: string } & Report["photos"][number]>(
      `SELECT report_id AS "reportId", id, original_name AS name, shared_at IS NOT NULL AS shared, area_id AS "areaId", phase, pair_id AS "pairId", for_client AS "forClient"
         FROM site_report_photos WHERE workspace_id = $1 AND report_id = ANY($2::uuid[]) ORDER BY position, created_at`, [workspaceId, ids])).rows;
    const tasks = (await client.query<{ reportId: string } & Report["tasks"][number]>(
      `SELECT entry.report_id AS "reportId", entry.id, entry.work_item_id AS "workItemId", item.number, item.title, entry.progress, entry.previous, entry.note, entry.hidden
         FROM site_report_tasks entry JOIN work_items item ON item.workspace_id = entry.workspace_id AND item.id = entry.work_item_id
        WHERE entry.workspace_id = $1 AND entry.report_id = ANY($2::uuid[]) ORDER BY entry.position`, [workspaceId, ids])).rows;
    const next = (await client.query<{ reportId: string } & Report["next"][number]>(
      `SELECT report_id AS "reportId", id, work_item_id AS "workItemId", title, hidden FROM site_report_next WHERE workspace_id = $1 AND report_id = ANY($2::uuid[]) ORDER BY position`,
      [workspaceId, ids])).rows;
    const materials = (await client.query<{ reportId: string } & Report["materials"][number]>(
      `SELECT report_id AS "reportId", id, direction, description, quantity::text AS quantity, unit, purchase_order_id AS "purchaseOrderId", stock_transfer_id AS "stockTransferId"
         FROM site_report_materials WHERE workspace_id = $1 AND report_id = ANY($2::uuid[]) ORDER BY position`, [workspaceId, ids])).rows;
    const issues = (await client.query<{ reportId: string } & Report["issues"][number]>(
      `SELECT issue.report_id AS "reportId", issue.id, issue.severity, issue.description, issue.internal, issue.raised, issue.work_item_id AS "workItemId", item.number AS "workItemNumber"
         FROM site_report_issues issue LEFT JOIN work_items item ON item.workspace_id = issue.workspace_id AND item.id = issue.work_item_id
        WHERE issue.workspace_id = $1 AND issue.report_id = ANY($2::uuid[]) ORDER BY issue.position`, [workspaceId, ids])).rows;
    const reactions = (await client.query<{ reportId: string; reaction: "like" | "love"; count: number; names: string[] }>(
      `SELECT reaction.report_id AS "reportId", reaction.reaction, count(*)::int AS count,
              array_agg(coalesce(grant_row.confirmed_name, grant_row.name, '') ORDER BY reaction.created_at) AS names
         FROM site_report_reactions reaction
         LEFT JOIN client_portal_grants grant_row ON grant_row.workspace_id = reaction.workspace_id AND grant_row.id = reaction.grant_id
        WHERE reaction.workspace_id = $1 AND reaction.report_id = ANY($2::uuid[]) GROUP BY reaction.report_id, reaction.reaction`,
      [workspaceId, ids])).rows;
    const reaction = (reportId: string, kind: "like" | "love") => reactions.find((item) => item.reportId === reportId && item.reaction === kind);
    return rows.map((row) => ({ ...row,
      submittedAt: row.submittedAt ? new Date(row.submittedAt).toISOString() : null, decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
      updatedAt: new Date(row.updatedAt).toISOString(), sentAt: row.sentAt ? new Date(row.sentAt).toISOString() : null, late: Boolean(row.late),
      workforce: byReport(workforce, row.id), lines: byReport(lines, row.id), photos: byReport(photos, row.id), tasks: byReport(tasks, row.id), next: byReport(next, row.id),
      materials: byReport(materials, row.id), issues: byReport(issues, row.id),
      reactions: { like: reaction(row.id, "like")?.count ?? 0, love: reaction(row.id, "love")?.count ?? 0 },
      reactedBy: { like: (reaction(row.id, "like")?.names ?? []).filter(Boolean), love: (reaction(row.id, "love")?.names ?? []).filter(Boolean) },
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

  /** The same rule the site-access list itself applies (HR, whoever manages projects, the project's managers and site supervisors). */
  private async seesSiteAccess(client: Db, workspaceId: string, projectId: string, userId: string, manager: boolean) {
    if (manager || await this.access.hasPermission(client, workspaceId, userId, "hrms.manage")) return true;
    return Boolean((await client.query(
      `SELECT 1 FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.user_id = $3
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND 'site_supervisor' = ANY(assignment.role_keys)`,
      [workspaceId, projectId, userId])).rowCount);
  }

  private async leads(client: Db, workspaceId: string, projectId: string) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager`, [workspaceId, projectId])).rows.map((row) => row.userId);
  }

  private async tell(client: Db, workspaceId: string, projectId: string, code: string, users: string[], actorId: string, note: string, key: string, email = false, query = "") {
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
        deepLink: `/workspace/projects/${projectId}/site${query}` };
      await notifyUserInApp(client, { ...message, idempotencyKey: `${code}:${key}:${userId}` });
      if (email) await queueUserEmail(client, { ...message, idempotencyKey: `${code}:${key}:${userId}:email` });
    }
  }

  private async today(client: Db, workspaceId: string) {
    return (await this.clock(client, workspaceId)).today;
  }

  /** The workspace's date and minutes into its day, in its time zone. */
  private async clock(client: Db, workspaceId: string) {
    return (await client.query<{ today: string; minutes: number }>(
      `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today,
              (extract(hour FROM now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC')) * 60
                + extract(minute FROM now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC')))::int AS minutes FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
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

/** A day's issues: each with its own id (kept across saves), a severity, what it is and whether the client may read it. */
function parseIssues(value: unknown) {
  const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  if (rows.length > 20) throw new BadRequestException("Up to 20 issues in a day's report.");
  const issues = rows.map((row, index) => {
    const description = text(row?.description, 1000);
    if (!description) throw new BadRequestException(`Say what the issue is on row ${index + 1}.`);
    return { id: uuid(row?.id, "Issue"), severity: oneOf(row?.severity ?? "minor", SEVERITIES, "Severity"), description, internal: row?.internal !== false };
  });
  if (new Set(issues.map((issue) => issue.id)).size !== issues.length) throw new BadRequestException("Each issue once per report.");
  return issues;
}
