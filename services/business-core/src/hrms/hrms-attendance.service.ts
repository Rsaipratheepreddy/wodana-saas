import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { RequestActor } from "../auth/actor";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { ProjectsService } from "../projects/projects.service";
import { HrmsAccessService, HrmsContext } from "./hrms-access.service";
import {
  AttendanceActionDto,
  DecisionDto,
  HistoryDto,
  ReviewDto,
} from "./hrms.dto";
import {
  addDays,
  Calendar,
  csvCell,
  dateRange,
  fingerprint,
  formatWhen,
  localDate,
  locationEvidence,
  splitInterval,
  zonedInstant,
} from "./hrms-domain";

export const HRMS_PHOTO_MAX_BYTES = 6 * 1024 * 1024;
export type PhotoUpload = { buffer: Buffer; size: number; mimetype: string };
@Injectable()
export class HrmsAttendanceService {
  constructor(
    private readonly access: HrmsAccessService,
    private readonly projects: ProjectsService,
    private readonly storage: BrandAssetStorageService,
  ) {}
  capture(actor: RequestActor, workspaceId: string, id: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      await this.access.self(ctx);
      await this.access.lock(ctx);
      const prior = await ctx.client.query(
        `SELECT id,expires_at AS "expiresAt",object_key IS NOT NULL AS "hasPhoto" FROM hrms_captures WHERE workspace_id=$1 AND membership_id=$2 AND id=$3`,
        [workspaceId, ctx.membershipId, id],
      );
      if (prior.rowCount) return prior.rows[0];
      const count = await ctx.client.query(
        `SELECT count(*)::int AS n FROM hrms_captures WHERE workspace_id=$1 AND membership_id=$2 AND issued_at>now()-interval '1 hour'`,
        [workspaceId, ctx.membershipId],
      );
      if (count.rows[0].n >= 60)
        throw new BadRequestException(
          "Too many capture attempts. Try again later.",
        );
      return (
        await ctx.client.query(
          `INSERT INTO hrms_captures(id,workspace_id,membership_id) VALUES($1,$2,$3) RETURNING id,expires_at AS "expiresAt",false AS "hasPhoto"`,
          [id, workspaceId, ctx.membershipId],
        )
      ).rows[0];
    });
  }
  photo(
    actor: RequestActor,
    workspaceId: string,
    id: string,
    file?: PhotoUpload,
  ) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      await this.access.self(ctx);
      await this.access.lock(ctx);
      const row = await this.captureRow(ctx, id);
      if (!file?.buffer.length || file.buffer.length > HRMS_PHOTO_MAX_BYTES)
        throw new BadRequestException("Capture an image up to 6 MB.");
      let buffer: Buffer;
      try {
        const image = sharp(file.buffer, { limitInputPixels: 20000000 });
        const meta = await image.metadata();
        if (
          !["jpeg", "png", "webp", "heif"].includes(meta.format ?? "") ||
          (meta.pages ?? 1) > 1
        )
          throw new Error("format");
        buffer = await image
          .rotate()
          .resize({
            width: 1200,
            height: 1200,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 80 })
          .toBuffer();
      } catch {
        throw new BadRequestException("The photo must be a valid still image.");
      }
      const digest = fingerprint(buffer.toString("base64"));
      if (row.object_key) {
        if (row.sha256 !== digest)
          throw new ConflictException(
            "This capture already has a different photo. Start a new capture.",
          );
        return { id, hasPhoto: true };
      }
      const used = await ctx.client.query(
        `SELECT 1 FROM hrms_attendance_events WHERE workspace_id=$1 AND capture_id=$2`,
        [workspaceId, id],
      );
      if (used.rowCount)
        throw new ConflictException("A submitted capture cannot be changed.");
      const key = `hrms/${workspaceId}/${ctx.membershipId}/${id}.jpg`;
      await this.storage.put(key, buffer, "image/jpeg");
      await ctx.client.query(
        `UPDATE hrms_captures SET object_key=$4,sha256=$5,byte_size=$6,photo_uploaded_at=now() WHERE workspace_id=$1 AND membership_id=$2 AND id=$3`,
        [workspaceId, ctx.membershipId, id, key, digest, buffer.length],
      );
      return { id, hasPhoto: true };
    });
  }
  readPhoto(actor: RequestActor, workspaceId: string, id: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const row = await ctx.client.query(
        `SELECT c.*,e.id AS event_id FROM hrms_captures c LEFT JOIN hrms_attendance_events e ON e.workspace_id=c.workspace_id AND e.capture_id=c.id WHERE c.workspace_id=$1 AND c.id=$2`,
        [workspaceId, id],
      );
      if (!row.rowCount || !row.rows[0].object_key)
        throw new NotFoundException("Photo not found.");
      const photo = row.rows[0];
      await this.access.assertReadEmployee(ctx, photo.membership_id);
      if (photo.membership_id !== ctx.membershipId) {
        this.access.require(ctx, "hrms.evidence");
        if (!photo.event_id) throw new NotFoundException("Photo not found.");
      }
      const settings = await this.access.settings(ctx);
      if (
        Date.now() - new Date(photo.issued_at).getTime() >
        settings.mediaRetentionDays * 86400000
      )
        throw new NotFoundException(
          "This photo is outside the evidence retention period.",
        );
      const data = await this.storage.read(photo.object_key);
      return data.body;
    });
  }
  current(actor: RequestActor, workspaceId: string) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(ctx, "hrms.self", "hrms.manage");
      await this.access.employee(ctx);
      return this.currentIn(ctx);
    });
  }
  private async currentIn(ctx: HrmsContext) {
    const row = await ctx.client.query(
      `SELECT id,started_at AS "startedAt",ended_at AS "endedAt",calendar_snapshot AS calendar,version FROM hrms_sessions WHERE workspace_id=$1 AND membership_id=$2 AND ended_at IS NULL`,
      [ctx.workspaceId, ctx.membershipId],
    );
    if (!row.rowCount) return null;
    const segments = await ctx.client.query(
      `SELECT id,mode,location_id AS "locationId",project_id AS "projectId",case_id AS "caseId",context_snapshot AS context,started_at AS "startedAt",ended_at AS "endedAt" FROM hrms_segments WHERE workspace_id=$1 AND session_id=$2 ORDER BY started_at`,
      [ctx.workspaceId, row.rows[0].id],
    );
    const reviewCounts = await ctx.client.query(
      `SELECT count(*) FILTER(WHERE status='pending')::int AS pending,count(*) FILTER(WHERE status='rejected')::int AS rejected FROM hrms_reviews WHERE workspace_id=$1 AND session_id=$2`,
      [ctx.workspaceId, row.rows[0].id],
    );
    return {
      ...row.rows[0],
      segments: segments.rows,
      pendingReviewCount: reviewCounts.rows[0].pending,
      rejectedReviewCount: reviewCounts.rows[0].rejected,
    };
  }
  action(actor: RequestActor, workspaceId: string, input: AttendanceActionDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const employee = await this.access.self(ctx);
      await this.access.lock(ctx);
      const hash = fingerprint(input);
      const replay = await ctx.client.query(
        `SELECT id,session_id AS "sessionId",request_hash,occurred_at AS "occurredAt",evidence FROM hrms_attendance_events WHERE workspace_id=$1 AND membership_id=$2 AND action_id=$3`,
        [workspaceId, ctx.membershipId, input.actionId],
      );
      if (replay.rowCount) {
        if (replay.rows[0].request_hash !== hash)
          throw new ConflictException(
            "This action ID was already used for a different request.",
          );
        const { request_hash, ...event } = replay.rows[0];
        return { event, current: await this.currentIn(ctx), replayed: true };
      }
      const settings = await this.access.settings(ctx);
      const capture = await this.captureRow(ctx, input.captureId);
      const used = await ctx.client.query(
        `SELECT 1 FROM hrms_attendance_events WHERE workspace_id=$1 AND capture_id=$2`,
        [workspaceId, input.captureId],
      );
      if (used.rowCount)
        throw new ConflictException(
          "This photo capture has already been submitted.",
        );
      const now = new Date();
      const deviceAt = new Date(input.deviceAt);
      if (
        !Number.isFinite(deviceAt.getTime()) ||
        deviceAt.getTime() > now.getTime() + 30000
      )
        throw new BadRequestException(
          "The device timestamp is invalid or in the future.",
        );
      const current = await this.currentIn(ctx);
      if (input.kind === "check_in" && (current || input.expectedSessionId))
        throw new ConflictException(
          "You already have an open attendance session. Refresh to continue.",
        );
      if (
        input.kind !== "check_in" &&
        (!current ||
          current.id !== input.expectedSessionId ||
          current.version !== input.expectedVersion)
      )
        throw new ConflictException(
          "Your attendance changed on another device. Refresh before continuing.",
        );
      const active = current?.segments.find(
        (s: { endedAt: Date | null }) => !s.endedAt,
      );
      let mode = input.mode;
      let locationId = input.locationId ?? null;
      let projectId = input.projectId ?? null;
      let caseId = input.caseId ?? null;
      let location: Record<string, any> | null = null;
      if (input.kind === "check_out") {
        mode = active.mode;
        locationId = active.locationId;
        projectId = active.projectId;
        caseId = active.caseId;
        location = active.context.location ?? null;
      } else {
        if (mode === "remote" && !employee.remoteAllowed)
          throw new ForbiddenException(
            "Remote attendance is not enabled for you.",
          );
        if (mode === "site" && !locationId)
          throw new BadRequestException(
            "Choose the project site you are visiting.",
          );
        if ((mode === "field" || mode === "remote") && locationId)
          throw new BadRequestException(
            "Field and remote attendance do not use an office/site boundary.",
          );
        if (locationId) {
          location = await this.projects.location(ctx, locationId);
          if (location!.kind !== (mode === "site" ? "site" : "office"))
            throw new BadRequestException(
              "The selected location does not match the attendance mode.",
            );
          if (mode === "site") {
            if (
              (projectId && projectId !== location!.projectId) ||
              (caseId && caseId !== location!.caseId)
            )
              throw new BadRequestException(
                "This site belongs to another project.",
              );
            projectId = location!.projectId;
            caseId = location!.caseId;
          }
        }
        await this.projects.assertContext(ctx, projectId, caseId);
      }
      const arrival = locationEvidence(
        input.position,
        location as {
          latitude: number;
          longitude: number;
          radiusM: number;
        } | null,
        now,
        settings.maxGpsAccuracyM,
        settings.maxCaptureAgeSeconds,
      );
      const departure =
        input.kind === "switch" && active?.context.location
          ? locationEvidence(
              input.position,
              active.context.location,
              now,
              settings.maxGpsAccuracyM,
              settings.maxCaptureAgeSeconds,
            )
          : null;
      const issues: string[] = [];
      if (!capture.object_key) issues.push("Photo was not captured");
      if (
        (now.getTime() - new Date(capture.issued_at).getTime()) / 1000 >
        settings.maxCaptureAgeSeconds
      )
        issues.push("Photo capture was delayed");
      if (
        (now.getTime() - deviceAt.getTime()) / 1000 >
        settings.maxCaptureAgeSeconds
      )
        issues.push(
          "Device action was delayed; recorded time uses server receipt",
        );
      if (["missing", "outside", "uncertain"].includes(arrival.status))
        issues.push(`Location ${arrival.status}`);
      if ((mode === "office" || mode === "site") && !location)
        issues.push("Workplace boundary is not configured");
      if (departure && departure.status !== "inside")
        issues.push("Departure from the previous site is unverified");
      const day = localDate(now, employee.calendar.timezone);
      const onLeave = await ctx.client.query(
        `SELECT id,units,calendar_snapshot FROM hrms_leave_requests WHERE workspace_id=$1 AND membership_id=$2 AND status IN ('approved','cancellation_pending') AND start_date<=$3 AND end_date>=$3`,
        [workspaceId, ctx.membershipId, day],
      );
      for (const leave of onLeave.rows)
        for (const unit of leave.units) {
          if (unit.date !== day) continue;
          const cal = leave.calendar_snapshot as Calendar;
          const start = zonedInstant(
            day,
            unit.part === "first_half" ? cal.dayStart : cal.halfDay,
            cal.timezone,
          );
          const end = zonedInstant(
            day,
            unit.part === "first_half" ? cal.halfDay : cal.dayEnd,
            cal.timezone,
          );
          if (now >= start && now < end)
            issues.push("Attendance overlaps approved leave");
        }
      if (issues.length && input.exceptionReason.trim().length < 3)
        throw new BadRequestException({
          message: "Retry the capture or provide an exception reason.",
          issues,
        });
      let sessionId = current?.id;
      if (!sessionId) {
        const inserted = await ctx.client.query(
          `INSERT INTO hrms_sessions(workspace_id,membership_id,started_at,calendar_snapshot) VALUES($1,$2,$3,$4) RETURNING id`,
          [workspaceId, ctx.membershipId, now, employee.calendar],
        );
        sessionId = inserted.rows[0].id;
      }
      const evidence = {
        position: input.position ?? null,
        location,
        arrival,
        departure,
        photoCaptured: Boolean(capture.object_key),
        issues,
        verification: issues.length ? "pending_review" : "recorded",
        exceptionReason: input.exceptionReason.trim(),
      };
      const event = await ctx.client.query(
        `INSERT INTO hrms_attendance_events(workspace_id,membership_id,session_id,action_id,request_hash,capture_id,kind,occurred_at,device_at,evidence,note,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,session_id AS "sessionId",occurred_at AS "occurredAt",evidence`,
        [
          workspaceId,
          ctx.membershipId,
          sessionId,
          input.actionId,
          hash,
          input.captureId,
          input.kind,
          now,
          deviceAt,
          evidence,
          input.note.trim(),
          ctx.userId,
        ],
      );
      const eventId = event.rows[0].id;
      if (active)
        await ctx.client.query(
          `UPDATE hrms_segments SET ended_at=$3,end_event_id=$4 WHERE workspace_id=$1 AND id=$2`,
          [workspaceId, active.id, now, eventId],
        );
      if (input.kind === "check_out")
        await ctx.client.query(
          `UPDATE hrms_sessions SET ended_at=$3,version=version+1 WHERE workspace_id=$1 AND id=$2`,
          [workspaceId, sessionId, now],
        );
      else {
        const contextName =
          projectId || caseId
            ? (await this.projects.contextsIn(ctx)).find(
                (c: { id: string }) => c.id === (projectId ?? caseId),
              )?.name
            : null;
        await ctx.client.query(
          `INSERT INTO hrms_segments(workspace_id,session_id,mode,location_id,project_id,case_id,context_snapshot,started_at,start_event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            workspaceId,
            sessionId,
            mode,
            locationId,
            projectId,
            caseId,
            { name: contextName ?? "General work", location },
            now,
            eventId,
          ],
        );
        if (current)
          await ctx.client.query(
            `UPDATE hrms_sessions SET version=version+1 WHERE workspace_id=$1 AND id=$2`,
            [workspaceId, sessionId],
          );
      }
      if (issues.length) {
        const review = await ctx.client.query<{ id: string }>(
          `INSERT INTO hrms_reviews(workspace_id,membership_id,session_id,action_id,kind,event_id,reason) VALUES($1,$2,$3,$4,'exception',$5,$6) RETURNING id`,
          [
            workspaceId,
            ctx.membershipId,
            sessionId,
            input.actionId,
            eventId,
            input.exceptionReason.trim(),
          ],
        );
        await this.access.notify(ctx, [
          {
            code: "hrms.attendance_to_review",
            users: await this.access.approvers(ctx, ctx.membershipId),
            variables: {
              person: employee.name,
              when: formatWhen(
                now,
                employee.calendar.timezone,
                await this.access.locale(ctx),
              ),
              note: `${issues.join("; ")} — ${input.exceptionReason.trim()}`,
            },
            deepLink: `/workspace/hrms/team?review=${review.rows[0].id}`,
            key: `hrms.attendance_to_review:${review.rows[0].id}`,
          },
        ]);
      }
      await this.access.audit(ctx, `attendance_${input.kind}`, eventId, {
        sessionId,
        membershipId: ctx.membershipId,
        issues,
      });
      return {
        event: event.rows[0],
        current: await this.currentIn(ctx),
        replayed: false,
      };
    });
  }
  private async captureRow(ctx: HrmsContext, id: string) {
    const result = await ctx.client.query(
      `SELECT * FROM hrms_captures WHERE workspace_id=$1 AND membership_id=$2 AND id=$3 FOR UPDATE`,
      [ctx.workspaceId, ctx.membershipId, id],
    );
    if (!result.rowCount)
      throw new NotFoundException("Start a photo capture first.");
    if (new Date(result.rows[0].expires_at).getTime() < Date.now())
      throw new ConflictException(
        "This capture expired. Start a new capture or request an attendance correction.",
      );
    return result.rows[0];
  }
  history(actor: RequestActor, workspaceId: string, input: HistoryDto) {
    return this.access.run(actor, workspaceId, (ctx) =>
      this.historyIn(ctx, input),
    );
  }
  private async historyIn(ctx: HrmsContext, input: HistoryDto) {
    const dates = dateRange(input.from, input.to);
    let members: string[] = [];
    if (input.scope === "team") {
      this.access.require(ctx, "hrms.team", "hrms.manage");
      const employees = await ctx.client.query(
        `SELECT membership_id FROM hrms_employees WHERE workspace_id=$1`,
        [ctx.workspaceId],
      );
      for (const e of employees.rows)
        if (await this.access.canManageEmployee(ctx, e.membership_id))
          members.push(e.membership_id);
    } else {
      await this.access.assertReadEmployee(ctx, ctx.membershipId);
      members = [ctx.membershipId];
    }
    if (input.membershipId) {
      if (!members.includes(input.membershipId))
        throw new ForbiddenException(
          "This employee is outside your attendance scope.",
        );
      members = [input.membershipId];
    }
    const sessions = await ctx.client.query(
      `SELECT s.id,s.membership_id AS "membershipId",u.display_name AS name,s.started_at AS "startedAt",s.ended_at AS "endedAt",s.calendar_snapshot AS calendar,s.version FROM hrms_sessions s JOIN workspace_memberships m ON m.workspace_id=s.workspace_id AND m.id=s.membership_id JOIN users u ON u.id=m.user_id WHERE s.workspace_id=$1 AND s.membership_id=ANY($2::uuid[]) AND s.started_at < $4::date+interval '2 days' AND (s.ended_at IS NULL OR s.ended_at>$3::date-interval '1 day') ORDER BY s.started_at`,
      [ctx.workspaceId, members, input.from, input.to],
    );
    const ids = sessions.rows.map((r) => r.id);
    const segments = await ctx.client.query(
      `SELECT id,session_id AS "sessionId",mode,location_id AS "locationId",project_id AS "projectId",case_id AS "caseId",context_snapshot AS context,started_at AS "startedAt",ended_at AS "endedAt",start_event_id AS "startEventId",end_event_id AS "endEventId" FROM hrms_segments WHERE workspace_id=$1 AND session_id=ANY($2::uuid[]) ORDER BY started_at`,
      [ctx.workspaceId, ids],
    );
    const events = await ctx.client.query(
      `SELECT e.id,e.session_id AS "sessionId",e.kind,e.occurred_at AS "originalAt",coalesce(r.requested_at,e.occurred_at) AS "effectiveAt",e.received_at AS "receivedAt",e.device_at AS "deviceAt",e.capture_id AS "captureId",e.evidence,e.note FROM hrms_attendance_events e LEFT JOIN LATERAL(SELECT requested_at FROM hrms_reviews WHERE workspace_id=e.workspace_id AND event_id=e.id AND kind='correction' AND status='approved' ORDER BY decided_at DESC LIMIT 1) r ON true WHERE e.workspace_id=$1 AND e.session_id=ANY($2::uuid[]) ORDER BY e.occurred_at`,
      [ctx.workspaceId, ids],
    );
    const reviews = await ctx.client.query(
      `SELECT id,membership_id AS "membershipId",session_id AS "sessionId",event_id AS "eventId",kind,reason,status,requested_at AS "requestedAt",decision_reason AS "decisionReason",created_at AS "createdAt" FROM hrms_reviews WHERE workspace_id=$1 AND session_id=ANY($2::uuid[]) ORDER BY created_at DESC`,
      [ctx.workspaceId, ids],
    );
    const leaves = await ctx.client.query(
      `SELECT l.id,l.membership_id AS "membershipId",l.start_date::text AS "startDate",l.end_date::text AS "endDate",l.day_part AS "dayPart",l.units,l.status,t.name FROM hrms_leave_requests l JOIN hrms_leave_types t ON t.workspace_id=l.workspace_id AND t.id=l.leave_type_id WHERE l.workspace_id=$1 AND l.membership_id=ANY($2::uuid[]) AND l.start_date<=$4 AND l.end_date>=$3 AND l.status IN ('approved','cancellation_pending','pending')`,
      [ctx.workspaceId, members, input.from, input.to],
    );
    type Day = {
      membershipId: string;
      name: string;
      date: string;
      timezone: string;
      firstIn: string | null;
      lastOut: string | null;
      workedMilliseconds: number;
      openMilliseconds: number;
      open: boolean;
      stale: boolean;
      reviewCount: number;
      rejectedCount: number;
      leaveDays: number;
      leaveStatus: string | null;
      leaveType: string | null;
      scheduled: boolean;
      place: string | null;
      breakdown: Record<
        string,
        { name: string; mode: string; milliseconds: number }
      >;
    };
    const days = new Map<string, Day>();
    const get = (
      membershipId: string,
      name: string,
      date: string,
      timezone: string,
    ) => {
      const key = `${membershipId}:${date}`;
      if (!days.has(key))
        days.set(key, {
          membershipId,
          name,
          date,
          timezone,
          firstIn: null,
          lastOut: null,
          workedMilliseconds: 0,
          openMilliseconds: 0,
          open: false,
          stale: false,
          reviewCount: 0,
          rejectedCount: 0,
          leaveDays: 0,
          leaveStatus: null,
          leaveType: null,
          scheduled: false,
          place: null,
          breakdown: {},
        });
      return days.get(key)!;
    };
    for (const id of members) {
      const e = await this.access.employee(ctx, id);
      for (const date of dates)
        if (date >= e.activeFrom && (!e.activeTo || date <= e.activeTo))
          get(id, e.name, date, e.calendar.timezone).scheduled =
            e.calendar.workingDays.includes(
              new Date(`${date}T12:00:00Z`).getUTCDay(),
            ) && !e.calendar.holidays.includes(date);
    }
    const now = new Date();
    for (const segment of segments.rows) {
      if (input.projectId && segment.projectId !== input.projectId) continue;
      const session = sessions.rows.find((s) => s.id === segment.sessionId)!;
      const tz = session.calendar.timezone;
      const stale =
        !segment.endedAt &&
        now.getTime() - new Date(session.startedAt).getTime() > 36 * 3600000;
      const end = segment.endedAt ?? (stale ? segment.startedAt : now);
      for (const part of splitInterval(segment.startedAt, end, tz)) {
        if (!dates.includes(part.date)) continue;
        const day = get(session.membershipId, session.name, part.date, tz);
        const start = new Date(
          Math.max(
            new Date(segment.startedAt).getTime(),
            zonedInstant(part.date, "00:00", tz).getTime(),
          ),
        ).toISOString();
        const finish = new Date(
          Math.min(
            new Date(end).getTime(),
            zonedInstant(addDays(part.date, 1), "00:00", tz).getTime(),
          ),
        ).toISOString();
        if (!day.firstIn || start < day.firstIn) day.firstIn = start;
        if (segment.endedAt) {
          day.workedMilliseconds += part.milliseconds;
          if (!day.lastOut || finish > day.lastOut) day.lastOut = finish;
        } else {
          day.openMilliseconds += part.milliseconds;
          day.open = true;
          if (!stale && part.date === localDate(now, tz))
            day.place = segment.context.location?.name ?? segment.context.name;
        }
        const key = `${segment.mode}:${segment.locationId ?? ""}:${segment.projectId ?? segment.caseId ?? ""}`;
        day.breakdown[key] ??= {
          name: segment.context.location?.name ?? segment.context.name,
          mode: segment.mode,
          milliseconds: 0,
        };
        day.breakdown[key].milliseconds += part.milliseconds;
      }
      if (stale) {
        const date = localDate(segment.startedAt, tz);
        if (dates.includes(date)) {
          const d = get(session.membershipId, session.name, date, tz);
          d.open = true;
          d.stale = true;
        }
      }
    }
    for (const review of reviews.rows.filter(
      (r) => r.status === "pending" || r.status === "rejected",
    )) {
      const session = sessions.rows.find((s) => s.id === review.sessionId)!;
      const event = events.rows.find((e) => e.id === review.eventId);
      const date = localDate(
        event?.effectiveAt ?? session.startedAt,
        session.calendar.timezone,
      );
      if (dates.includes(date))
        get(
          session.membershipId,
          session.name,
          date,
          session.calendar.timezone,
        )[review.status === "pending" ? "reviewCount" : "rejectedCount"]++;
    }
    for (const leave of leaves.rows)
      for (const unit of leave.units) {
        const day = days.get(`${leave.membershipId}:${unit.date}`);
        if (day) {
          if (leave.status !== "pending") day.leaveDays += unit.days;
          day.leaveStatus = leave.status;
          day.leaveType = leave.name;
        }
      }
    return {
      from: input.from,
      to: input.to,
      sessions: sessions.rows,
      segments: segments.rows.filter(
        (s) => !input.projectId || s.projectId === input.projectId,
      ),
      events: events.rows,
      reviews: reviews.rows,
      leaves: leaves.rows,
      days: [...days.values()]
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
        )
        .map(({ workedMilliseconds, openMilliseconds, breakdown, ...day }) => ({
          ...day,
          workedMinutes: Math.floor(workedMilliseconds / 60000),
          elapsedMinutes: Math.floor(
            (workedMilliseconds + openMilliseconds) / 60000,
          ),
          breakdown: Object.values(breakdown).map(
            ({ milliseconds, ...item }) => ({
              ...item,
              minutes: Math.floor(milliseconds / 60000),
            }),
          ),
          status: day.stale
            ? "missing_checkout"
            : day.open
              ? "checked_in"
              : day.reviewCount || day.rejectedCount
                ? "needs_review"
                : workedMilliseconds > 0
                  ? "complete"
                  : day.leaveDays
                    ? "on_leave"
                    : "not_checked_in",
        })),
    };
  }
  export(actor: RequestActor, workspaceId: string, input: HistoryDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const report = await this.historyIn(ctx, input);
      const lines = [
        [
          "Employee",
          "Date",
          "Timezone",
          "First check-in",
          "Last check-out",
          "Recorded minutes",
          "Elapsed minutes",
          "Status",
          "Leave days",
          "Pending reviews",
          "Rejected reviews",
          "Work breakdown",
        ],
      ];
      for (const day of report.days)
        lines.push([
          day.name,
          day.date,
          day.timezone,
          day.firstIn ?? "",
          day.lastOut ?? "",
          String(day.workedMinutes),
          String(day.elapsedMinutes),
          day.status,
          String(day.leaveDays),
          String(day.reviewCount),
          String(day.rejectedCount),
          day.breakdown.map((b) => `${b.name}: ${b.minutes} min`).join("; "),
        ]);
      return lines.map((row) => row.map(csvCell).join(",")).join("\r\n");
    });
  }
  reviews(actor: RequestActor, workspaceId: string, team = false) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      this.access.require(
        ctx,
        ...(team ? ["hrms.team", "hrms.manage"] : ["hrms.self", "hrms.manage"]),
      );
      const rows = await ctx.client.query(
        `SELECT r.id,r.membership_id AS "membershipId",u.display_name AS name,r.session_id AS "sessionId",r.event_id AS "eventId",r.kind,r.status,r.reason,r.requested_at AS "requestedAt",r.original_at AS "originalAt",r.decision_reason AS "decisionReason",r.created_at AS "createdAt",e.evidence,e.capture_id AS "captureId" FROM hrms_reviews r JOIN workspace_memberships m ON m.workspace_id=r.workspace_id AND m.id=r.membership_id JOIN users u ON u.id=m.user_id LEFT JOIN hrms_attendance_events e ON e.workspace_id=r.workspace_id AND e.id=r.event_id WHERE r.workspace_id=$1 AND ($2 OR r.membership_id=$3) ORDER BY r.created_at DESC`,
        [workspaceId, team, ctx.membershipId],
      );
      const result = [];
      for (const row of rows.rows)
        if (
          !team ||
          (await this.access.canManageEmployee(ctx, row.membershipId))
        )
          result.push({
            ...row,
            canDecide:
              row.status === "pending" &&
              row.membershipId !== ctx.membershipId &&
              (await this.access.canManageEmployee(ctx, row.membershipId)),
          });
      return result;
    });
  }
  requestReview(actor: RequestActor, workspaceId: string, input: ReviewDto) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const employee = await this.access.self(ctx);
      await this.access.lock(ctx);
      if (input.reason.trim().length < 3)
        throw new BadRequestException("Explain the attendance correction.");
      const requested = new Date(input.requestedAt);
      if (
        !Number.isFinite(requested.getTime()) ||
        requested.getTime() > Date.now()
      )
        throw new BadRequestException(
          "A corrected attendance time must be in the past.",
        );
      const session = await ctx.client.query(
        `SELECT * FROM hrms_sessions WHERE workspace_id=$1 AND membership_id=$2 AND id=$3`,
        [workspaceId, ctx.membershipId, input.sessionId],
      );
      if (!session.rowCount)
        throw new NotFoundException("Attendance session not found.");
      const prior = await ctx.client.query(
        `SELECT * FROM hrms_reviews WHERE workspace_id=$1 AND membership_id=$2 AND action_id=$3`,
        [workspaceId, ctx.membershipId, input.actionId],
      );
      if (prior.rowCount) {
        const p = prior.rows[0];
        if (
          p.session_id !== input.sessionId ||
          p.kind !== input.kind ||
          p.event_id !== (input.eventId ?? null) ||
          new Date(p.requested_at).getTime() !== requested.getTime() ||
          p.reason !== input.reason.trim()
        )
          throw new ConflictException("This request ID has already been used.");
        return { id: p.id, status: p.status };
      }
      let original: Date | null = null;
      if (input.kind === "correction") {
        if (!input.eventId)
          throw new BadRequestException(
            "Choose the attendance event to correct.",
          );
        const event = await ctx.client.query(
          `SELECT e.id,coalesce((SELECT r.requested_at FROM hrms_reviews r WHERE r.workspace_id=e.workspace_id AND r.event_id=e.id AND r.kind='correction' AND r.status='approved' ORDER BY r.decided_at DESC LIMIT 1),e.occurred_at) AS effective_at FROM hrms_attendance_events e WHERE e.workspace_id=$1 AND e.membership_id=$2 AND e.session_id=$3 AND e.id=$4`,
          [workspaceId, ctx.membershipId, input.sessionId, input.eventId],
        );
        if (!event.rowCount)
          throw new NotFoundException("Attendance event not found.");
        original = event.rows[0].effective_at;
      } else if (input.eventId || session.rows[0].ended_at)
        throw new BadRequestException(
          "Missing checkout is only available for an open session.",
        );
      const row = await ctx.client.query(
        `INSERT INTO hrms_reviews(workspace_id,membership_id,session_id,action_id,kind,event_id,requested_at,original_at,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,status`,
        [
          workspaceId,
          ctx.membershipId,
          input.sessionId,
          input.actionId,
          input.kind,
          input.eventId ?? null,
          requested,
          original,
          input.reason.trim(),
        ],
      );
      await this.access.audit(ctx, "correction_requested", row.rows[0].id, {
        ...input,
      });
      await this.access.notify(ctx, [
        {
          code: "hrms.attendance_to_review",
          users: await this.access.approvers(ctx, ctx.membershipId),
          variables: {
            person: employee.name,
            when: formatWhen(
              requested,
              employee.calendar.timezone,
              await this.access.locale(ctx),
            ),
            note: input.reason.trim(),
          },
          deepLink: `/workspace/hrms/team?review=${row.rows[0].id}`,
          key: `hrms.attendance_to_review:${row.rows[0].id}`,
        },
      ]);
      return row.rows[0];
    });
  }
  decideReview(
    actor: RequestActor,
    workspaceId: string,
    id: string,
    input: DecisionDto,
  ) {
    return this.access.run(actor, workspaceId, async (ctx) => {
      const before = await ctx.client.query(
        `SELECT * FROM hrms_reviews WHERE workspace_id=$1 AND id=$2`,
        [workspaceId, id],
      );
      if (!before.rowCount)
        throw new NotFoundException("Attendance request not found.");
      const review = before.rows[0];
      await this.access.assertReviewer(ctx, review.membership_id);
      await this.access.lock(ctx, review.membership_id);
      const locked = await ctx.client.query(
        `SELECT * FROM hrms_reviews WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
        [workspaceId, id],
      );
      if (locked.rows[0].status !== "pending")
        throw new ConflictException("This request has already been decided.");
      if (input.reason.trim().length < 3)
        throw new BadRequestException("Explain your decision.");
      if (input.decision === "approve" && review.kind !== "exception")
        await this.applyCorrection(ctx, review);
      const result = await ctx.client.query(
        `UPDATE hrms_reviews SET status=$3,decision_reason=$4,decided_by=$5,decided_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING id,status`,
        [
          workspaceId,
          id,
          input.decision === "approve" ? "approved" : "rejected",
          input.reason.trim(),
          ctx.userId,
        ],
      );
      await this.access.audit(
        ctx,
        "attendance_review_decided",
        id,
        {
          decision: input.decision,
          reason: input.reason,
          membershipId: review.membership_id,
        },
        review,
      );
      const subject = await this.access.employee(ctx, review.membership_id);
      const at = review.requested_at ?? review.created_at;
      const code =
        input.decision === "approve"
          ? "hrms.attendance_approved"
          : "hrms.attendance_rejected";
      await this.access.notify(ctx, [
        {
          code,
          users: await this.access.userOf(ctx, review.membership_id),
          variables: {
            when: formatWhen(
              at,
              subject.calendar.timezone,
              await this.access.locale(ctx),
            ),
            note: input.reason.trim(),
          },
          deepLink: `/workspace/hrms?day=${localDate(at, subject.calendar.timezone)}`,
          key: `${code}:${id}`,
        },
      ]);
      return result.rows[0];
    });
  }
  private async applyCorrection(ctx: HrmsContext, review: Record<string, any>) {
    const session = (
      await ctx.client.query(
        `SELECT * FROM hrms_sessions WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
        [ctx.workspaceId, review.session_id],
      )
    ).rows[0];
    const segments = (
      await ctx.client.query(
        `SELECT * FROM hrms_segments WHERE workspace_id=$1 AND session_id=$2 ORDER BY started_at`,
        [ctx.workspaceId, session.id],
      )
    ).rows;
    const at = new Date(review.requested_at);
    let start = new Date(session.started_at),
      end = session.ended_at ? new Date(session.ended_at) : null;
    if (review.kind === "missing_checkout") {
      if (end)
        throw new ConflictException(
          "This session has already been checked out.",
        );
      end = at;
      segments[segments.length - 1].ended_at = at;
    } else {
      const event = (
        await ctx.client.query(
          `SELECT kind FROM hrms_attendance_events WHERE workspace_id=$1 AND id=$2`,
          [ctx.workspaceId, review.event_id],
        )
      ).rows[0];
      const affected =
        segments.find((s) => s.start_event_id === review.event_id) ||
        segments.find((s) => s.end_event_id === review.event_id);
      const effective =
        affected?.start_event_id === review.event_id
          ? affected.started_at
          : affected?.ended_at;
      if (
        !effective ||
        new Date(effective).getTime() !== new Date(review.original_at).getTime()
      )
        throw new ConflictException(
          "This attendance time has changed since the correction was requested.",
        );
      if (event.kind === "check_in") start = at;
      if (event.kind === "check_out") end = at;
      for (const segment of segments) {
        if (segment.start_event_id === review.event_id) segment.started_at = at;
        if (segment.end_event_id === review.event_id) segment.ended_at = at;
      }
    }
    if (end && end <= start)
      throw new BadRequestException("Checkout must follow check-in.");
    for (const segment of segments) {
      if (
        segment.ended_at &&
        new Date(segment.ended_at) <= new Date(segment.started_at)
      )
        throw new BadRequestException(
          "The correction would reverse a work segment.",
        );
    }
    const overlap = await ctx.client.query(
      `SELECT 1 FROM hrms_sessions WHERE workspace_id=$1 AND membership_id=$2 AND id<>$3 AND tstzrange(started_at,ended_at,'[)') && tstzrange($4::timestamptz,$5::timestamptz,'[)')`,
      [ctx.workspaceId, review.membership_id, session.id, start, end],
    );
    if (overlap.rowCount)
      throw new ConflictException(
        "The correction would overlap another attendance session.",
      );
    let manualEventId: string | null = null;
    if (review.kind === "missing_checkout") {
      const manual = await ctx.client.query(
        `INSERT INTO hrms_attendance_events(workspace_id,membership_id,session_id,action_id,request_hash,kind,occurred_at,device_at,evidence,note,recorded_by) VALUES($1,$2,$3,$4,$5,'check_out',$6,$6,$7,$8,$9) RETURNING id`,
        [
          ctx.workspaceId,
          review.membership_id,
          session.id,
          review.action_id,
          fingerprint({ reviewId: review.id }),
          at,
          {
            verification: "manual_correction",
            reviewId: review.id,
            photoCaptured: false,
            position: null,
          },
          review.reason,
          ctx.userId,
        ],
      );
      manualEventId = manual.rows[0].id;
    }
    await ctx.client.query(
      `UPDATE hrms_sessions SET started_at=$3,ended_at=$4,version=version+1 WHERE workspace_id=$1 AND id=$2`,
      [ctx.workspaceId, session.id, start, end],
    );
    for (const segment of segments)
      await ctx.client.query(
        `UPDATE hrms_segments SET started_at=$3,ended_at=$4,end_event_id=coalesce($5::uuid,end_event_id) WHERE workspace_id=$1 AND id=$2`,
        [
          ctx.workspaceId,
          segment.id,
          segment.started_at,
          segment.ended_at,
          manualEventId && segment.id === segments[segments.length - 1].id
            ? manualEventId
            : null,
        ],
      );
  }
}
