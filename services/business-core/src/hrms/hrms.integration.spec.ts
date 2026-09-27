import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { readCalendar } from "../project-core/work-calendar";
import { HrmsAccessService } from "./hrms-access.service";
import { readProjectCosts } from "../project-core/project-money";
import { HrmsAttendanceService } from "./hrms-attendance.service";
import { HrmsCrewsService } from "./hrms-crews.service";
import { HrmsLeaveService } from "./hrms-leave.service";
import { processHrmsCheckouts } from "./hrms-reminders";
import { HrmsSettingsService } from "./hrms-settings.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

type World = {
  client: PoolClient;
  workspaceId: string;
  owner: string;
  designer: string;
  supervisor: string;
  ownerMember: string;
  designerMember: string;
  supervisorMember: string;
  as: (userId: string) => { settings: HrmsSettingsService; leave: HrmsLeaveService; attendance: HrmsAttendanceService; crews: HrmsCrewsService };
};

integration("HRMS works on day one (plan §6.28, H1)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(work: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), owner = randomUUID(), designer = randomUUID(), supervisor = randomUUID();
    const ownerMember = randomUUID(), designerMember = randomUUID(), supervisorMember = randomUUID(), hrRole = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Olivia Owner'),($3,$4,'Dana Designer'),($5,$6,'Sam Supervisor')",
        [owner, `${owner.slice(0, 8)}@example.com`, designer, `${designer.slice(0, 8)}@example.com`, supervisor, `${supervisor.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,default_locale,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai','en-AE',$3)",
        [workspaceId, `hr-${workspaceId.slice(0, 8)}`, owner]);
      await client.query(`INSERT INTO workspace_memberships(id,workspace_id,user_id,status,joined_at) VALUES
        ($1,$4,$5,'active','2026-01-10T06:00:00Z'),($2,$4,$6,'active','2026-03-01T21:30:00Z'),($3,$4,$7,'active','2026-06-15T06:00:00Z')`,
        [ownerMember, designerMember, supervisorMember, workspaceId, owner, designer, supervisor]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,'hr','HR',false)", [hrRole, workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code IN ('hrms.manage','hrms.team','hrms.evidence')", [workspaceId, hrRole]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, ownerMember, hrRole]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      // Each call is its own transaction, as in the app: a command that fails part-way leaves nothing behind.
      const as = (userId: string) => {
        const access = new HrmsAccessService({
          asMember: async (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => {
            await client.query("SAVEPOINT command");
            try {
              const result = await fn(client, { userId });
              await client.query("RELEASE SAVEPOINT command");
              return result;
            } catch (error) {
              await client.query("ROLLBACK TO SAVEPOINT command");
              throw error;
            }
          },
          effectivePermissions: async (_c: unknown, _w: string, codes: string[]) => [...new Set(codes)],
        } as never, new CrmEventsService());
        return { settings: new HrmsSettingsService(access), leave: new HrmsLeaveService(access), attendance: new HrmsAttendanceService(access, {} as never, {} as never), crews: new HrmsCrewsService(access) };
      };
      await work({ client, workspaceId, owner, designer, supervisor, ownerMember, designerMember, supervisorMember, as });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const notices = async (w: World, code: string, userId?: string) => (await w.client.query<{ recipient: string; channel: string; subject: string; body: string; link: string }>(
    `SELECT recipient_id AS recipient,channel,subject,body,deep_link AS link FROM notifications WHERE workspace_id=$1 AND event_type=$2 AND ($3::uuid IS NULL OR recipient_id=$3) ORDER BY channel`,
    [w.workspaceId, code, userId ?? null])).rows;

  it("sets itself up on first use: the region's week, everyone enrolled from the day they joined, self-service for all", async () => {
    await world(async (w) => {
      const boot = await w.as(w.designer).settings.bootstrap(actor, w.workspaceId);
      expect(boot.permissions).toMatchObject({ self: true, team: false, manage: false });
      expect(boot.settings).not.toBeNull();
      expect(boot.employee).toMatchObject({ membershipId: w.designerMember, enabled: true, activeFrom: "2026-03-02" });
      expect(boot.employee!.calendar).toMatchObject({ name: "Company calendar", timezone: "Asia/Dubai", workingDays: [1, 2, 3, 4, 5], dayStart: "09:00", dayEnd: "18:00" });
      const people = await w.as(w.owner).settings.people(actor, w.workspaceId);
      expect(people.map((person: { enabled: boolean }) => person.enabled)).toEqual([true, true, true]);
      const types = await w.as(w.owner).leave.types(actor, w.workspaceId);
      expect(types.map((type: { name: string; limited: boolean; paid: boolean }) => [type.name, type.limited, type.paid]))
        .toEqual([["Annual leave", true, true], ["Sick leave", false, true], ["Unpaid leave", false, false]]);
      // Again: nothing more is made.
      await w.as(w.supervisor).settings.bootstrap(actor, w.workspaceId);
      const counts = (await w.client.query("SELECT (SELECT count(*) FROM hrms_calendars WHERE workspace_id=$1)::int AS calendars,(SELECT count(*) FROM hrms_leave_types WHERE workspace_id=$1)::int AS types", [w.workspaceId])).rows[0];
      expect(counts).toEqual({ calendars: 1, types: 3 });
      await expect(w.as(w.designer).settings.people(actor, w.workspaceId)).rejects.toThrow("You do not have access");
    });
  });

  it("unlimited leave needs no allowance; the approver is told by email and in-app, and so is the person after the decision", async () => {
    await world(async (w) => {
      const designer = w.as(w.designer);
      const types = await designer.leave.types(actor, w.workspaceId);
      const sick = types.find((type: { name: string }) => type.name === "Sick leave").id;
      const annual = types.find((type: { name: string }) => type.name === "Annual leave").id;
      await expect(designer.leave.request(actor, w.workspaceId, { actionId: randomUUID(), leaveTypeId: annual, startDate: "2026-10-05", endDate: "2026-10-05", dayPart: "full", reason: "Family visit" }))
        .rejects.toThrow("Insufficient leave allowance for 2026.");
      const asked = await designer.leave.request(actor, w.workspaceId, { actionId: randomUUID(), leaveTypeId: sick, startDate: "2026-10-05", endDate: "2026-10-07", dayPart: "full", reason: "Flu" });
      expect(asked.status).toBe("pending");
      // No manager and no fallback: everyone who manages HRMS decides.
      expect(await notices(w, "hrms.leave_requested")).toEqual([
        expect.objectContaining({ recipient: w.owner, channel: "email", subject: "Leave to approve: Dana Designer" }),
        expect.objectContaining({ recipient: w.owner, channel: "in_app", body: "Sick leave · 5\u2009–\u20097 Oct 2026 (3 days): Flu", link: `/workspace/hrms/team?leave=${asked.id}` }),
      ]);
      const balances = await designer.leave.balances(actor, w.workspaceId, { scope: "self", year: 2026 });
      expect(balances.find((row: { leaveTypeName: string }) => row.leaveTypeName === "Sick leave")).toMatchObject({ limited: false, allowance: null, available: null, pending: 3 });
      await expect(designer.leave.decide(actor, w.workspaceId, asked.id, { decision: "approve", reason: "My own" })).rejects.toThrow("independent approver");
      await w.as(w.owner).leave.decide(actor, w.workspaceId, asked.id, { decision: "approve", reason: "Get well soon" });
      expect((await notices(w, "hrms.leave_approved", w.designer)).map((row) => row.channel)).toEqual(["email", "in_app"]);
      await expect(w.as(w.owner).leave.saveAllowance(actor, w.workspaceId, { membershipId: w.designerMember, leaveTypeId: sick, year: 2026, days: 10, version: 0 }))
        .rejects.toThrow("This leave type has no allowance.");
    });
  });

  it("a manager decides for their people, and a cancellation of approved leave goes back to them", async () => {
    await world(async (w) => {
      const owner = w.as(w.owner);
      const people = await owner.settings.people(actor, w.workspaceId);
      const designer = people.find((person: { membershipId: string }) => person.membershipId === w.designerMember);
      await owner.settings.saveEmployee(actor, w.workspaceId, w.designerMember, { ...designer, version: designer.version, managerId: w.supervisorMember, employeeCode: "D-1" });
      const types = await owner.leave.types(actor, w.workspaceId);
      const unpaid = types.find((type: { name: string }) => type.name === "Unpaid leave").id;
      const asked = await w.as(w.designer).leave.request(actor, w.workspaceId, { actionId: randomUUID(), leaveTypeId: unpaid, startDate: "2026-11-02", endDate: "2026-11-02", dayPart: "first_half", reason: "Visa office" });
      expect((await notices(w, "hrms.leave_requested")).map((row) => row.recipient)).toEqual([w.supervisor, w.supervisor]);
      await w.as(w.supervisor).leave.decide(actor, w.workspaceId, asked.id, { decision: "approve", reason: "Fine" });
      await w.as(w.designer).leave.cancel(actor, w.workspaceId, asked.id, { reason: "Appointment moved" });
      expect(await notices(w, "hrms.leave_cancellation_requested")).toEqual([expect.objectContaining({ recipient: w.supervisor, body: "Unpaid leave · 2 Nov 2026: Appointment moved" })]);
      await w.as(w.supervisor).leave.decide(actor, w.workspaceId, asked.id, { decision: "reject", reason: "Already arranged cover" });
      expect(await notices(w, "hrms.leave_cancellation_refused", w.designer)).toEqual([expect.objectContaining({ subject: "Leave stays booked: 2 Nov 2026", body: "Sam Supervisor: Already arranged cover" })]);
    });
  });

  it("calendars are edited with their version; holidays are named ranges that keep the day list and give back leave booked on them", async () => {
    await world(async (w) => {
      const owner = w.as(w.owner);
      const [calendar] = await owner.settings.calendars(actor, w.workspaceId);
      expect(calendar).toMatchObject({ isDefault: true, people: 3, holidayList: [], version: 1 });
      const edited = await owner.settings.updateCalendar(actor, w.workspaceId, calendar.id, { name: "Studio week", timezone: "Asia/Dubai", workingDays: [0, 1, 2, 3, 4], dayStart: "08:30", halfDay: "13:00", dayEnd: "17:30", version: 1 });
      expect(edited).toMatchObject({ name: "Studio week", workingDays: [0, 1, 2, 3, 4], dayStart: "08:30", version: 2 });
      await expect(owner.settings.updateCalendar(actor, w.workspaceId, calendar.id, { ...edited, version: 1 })).rejects.toThrow("This record changed");
      // Planning reads the default calendar's week and holidays.
      expect((await readCalendar(w.client, w.workspaceId)).workingDays).toEqual([0, 1, 2, 3, 4]);
      await expect(owner.settings.updateCalendar(actor, w.workspaceId, calendar.id, { ...edited, dayStart: "18:00", version: 2 })).rejects.toThrow("Working hours must run");
      const second = await owner.settings.createCalendar(actor, w.workspaceId, { name: "Site crews", timezone: "Asia/Dubai", workingDays: [1, 2, 3, 4, 5, 6], dayStart: "07:00", halfDay: "12:00", dayEnd: "16:00" });
      expect(second).toMatchObject({ isDefault: false, people: 0, version: 1 });
      await expect(w.as(w.designer).settings.calendars(actor, w.workspaceId)).rejects.toThrow("You do not have access");
    });
  });

  it("a holiday announced after leave was approved gives the days back and tells the person", async () => {
    await world(async (w) => {
      const owner = w.as(w.owner);
      const [calendar] = await owner.settings.calendars(actor, w.workspaceId);
      const types = await owner.leave.types(actor, w.workspaceId);
      const sick = types.find((type: { name: string }) => type.name === "Sick leave").id;
      const designer = w.as(w.designer);
      // Monday 30 Nov to Friday 4 Dec 2026 (five working days), and Wednesday 2 Dec alone.
      const long = await designer.leave.request(actor, w.workspaceId, { actionId: randomUUID(), leaveTypeId: sick, startDate: "2026-11-30", endDate: "2026-12-04", dayPart: "full", reason: "Surgery" });
      await owner.leave.decide(actor, w.workspaceId, long.id, { decision: "approve", reason: "Approved" });
      const other = await w.as(w.supervisor).leave.request(actor, w.workspaceId, { actionId: randomUUID(), leaveTypeId: sick, startDate: "2026-12-02", endDate: "2026-12-03", dayPart: "full", reason: "Dentist" });

      const holiday = await owner.settings.addHoliday(actor, w.workspaceId, calendar.id, { name: "National Day", startsOn: "2026-12-02", endsOn: "2026-12-03" });
      expect(holiday).toMatchObject({ name: "National Day", days: 2, version: 1 });
      const days = (await w.client.query("SELECT holidays::text[] AS days FROM hrms_calendars WHERE id=$1", [calendar.id])).rows[0].days;
      expect(days).toEqual(["2026-12-02", "2026-12-03"]);
      const leave = (await w.client.query("SELECT id,status,units FROM hrms_leave_requests WHERE workspace_id=$1 ORDER BY start_date", [w.workspaceId])).rows;
      expect(leave.find((row) => row.id === long.id)).toMatchObject({ status: "approved" });
      expect(leave.find((row) => row.id === long.id).units.map((unit: { date: string }) => unit.date)).toEqual(["2026-11-30", "2026-11-30", "2026-12-01", "2026-12-01", "2026-12-04", "2026-12-04"]);
      expect(leave.find((row) => row.id === other.id)).toMatchObject({ status: "withdrawn" });
      expect(await notices(w, "hrms.leave_holiday", w.designer)).toEqual([expect.objectContaining({ subject: "Leave changed: 30 Nov\u2009–\u20094 Dec 2026", body: "National Day is now a holiday and no longer counts as leave. This request now counts 3 days." })]);

      await expect(owner.settings.addHoliday(actor, w.workspaceId, calendar.id, { name: "Eid", startsOn: "2026-12-03", endsOn: "2026-12-05" })).rejects.toThrow("already a holiday: National Day");
      await expect(owner.settings.updateHoliday(actor, w.workspaceId, holiday.id, { name: "National Day", startsOn: "2026-12-02", endsOn: "2026-12-02", version: 2 })).rejects.toThrow("This record changed");
      await owner.settings.updateHoliday(actor, w.workspaceId, holiday.id, { name: "National Day", startsOn: "2026-12-02", endsOn: "2026-12-02", version: 1 });
      expect((await w.client.query("SELECT holidays::text[] AS days FROM hrms_calendars WHERE id=$1", [calendar.id])).rows[0].days).toEqual(["2026-12-02"]);
      await owner.settings.removeHoliday(actor, w.workspaceId, holiday.id, { version: 2 });
      expect((await w.client.query("SELECT holidays::text[] AS days FROM hrms_calendars WHERE id=$1", [calendar.id])).rows[0].days).toEqual([]);

      // The database keeps the day list: it can't be written directly, and calendars aren't deleted.
      await w.client.query("SAVEPOINT direct");
      await expect(w.client.query("UPDATE hrms_calendars SET holidays='{2026-12-25}' WHERE id=$1", [calendar.id])).rejects.toThrow("come from its named holidays");
      await w.client.query("ROLLBACK TO SAVEPOINT direct");
      await expect(w.client.query("DELETE FROM hrms_calendars WHERE id=$1", [calendar.id])).rejects.toThrow("kept once made");
      await w.client.query("ROLLBACK TO SAVEPOINT direct");
    });
  });

  it("a missing check-out goes to the approver, and their decision back to the person", async () => {
    await world(async (w) => {
      const boot = await w.as(w.designer).settings.bootstrap(actor, w.workspaceId);
      const session = randomUUID(), event = randomUUID();
      const started = new Date(Date.now() - 30 * 3_600_000);
      await w.client.query("INSERT INTO hrms_sessions(id,workspace_id,membership_id,started_at,calendar_snapshot) VALUES($1,$2,$3,$4,$5)", [session, w.workspaceId, w.designerMember, started, boot.employee!.calendar]);
      await w.client.query(`INSERT INTO hrms_attendance_events(id,workspace_id,membership_id,session_id,action_id,request_hash,kind,occurred_at,device_at,evidence,recorded_by)
        VALUES($1,$2,$3,$4,$5,repeat('a',64),'check_in',$6,$6,'{}',$7)`, [event, w.workspaceId, w.designerMember, session, randomUUID(), started, w.designer]);
      await w.client.query("INSERT INTO hrms_segments(workspace_id,session_id,mode,context_snapshot,started_at,start_event_id) VALUES($1,$2,'office','{\"name\":\"General work\",\"location\":{\"name\":\"Studio\"}}',$3,$4)",
        [w.workspaceId, session, started, event]);

      // The reminder: once per session, an hour after the working day should have ended.
      expect(await processHrmsCheckouts(w.client, w.workspaceId)).toEqual({ sent: 1 });
      expect(await processHrmsCheckouts(w.client, w.workspaceId)).toEqual({ sent: 0 });
      expect((await notices(w, "hrms.checkout_missing", w.designer)).map((row) => [row.channel, row.subject])).toEqual([["email", "You're still checked in"], ["in_app", "You're still checked in"]]);

      const left = new Date(started.getTime() + 8 * 3_600_000);
      const review = await w.as(w.designer).attendance.requestReview(actor, w.workspaceId, { actionId: randomUUID(), sessionId: session, kind: "missing_checkout", requestedAt: left.toISOString(), reason: "Left at six, phone was flat" });
      expect(await notices(w, "hrms.attendance_to_review")).toEqual([expect.objectContaining({ recipient: w.owner, subject: "Attendance to review: Dana Designer", link: `/workspace/hrms/team?review=${review.id}` })]);
      await w.as(w.owner).attendance.decideReview(actor, w.workspaceId, review.id, { decision: "approve", reason: "Confirmed with the site" });
      expect(await notices(w, "hrms.attendance_approved", w.designer)).toEqual([expect.objectContaining({ body: "Olivia Owner: Confirmed with the site" })]);
      const history = await w.as(w.owner).attendance.history(actor, w.workspaceId, { from: started.toISOString().slice(0, 10), to: started.toISOString().slice(0, 10), scope: "team" });
      const day = history.days.find((row: { membershipId: string }) => row.membershipId === w.designerMember)!;
      expect(day.workedMinutes).toBe(480);
      expect(typeof day.scheduled).toBe("boolean");
    });
  });

  it("a session started just now isn't reminded, and a team day says where someone is and what leave they're on", async () => {
    await world(async (w) => {
      const boot = await w.as(w.supervisor).settings.bootstrap(actor, w.workspaceId);
      const session = randomUUID(), event = randomUUID(), started = new Date(Date.now() - 10 * 60_000);
      await w.client.query("INSERT INTO hrms_sessions(id,workspace_id,membership_id,started_at,calendar_snapshot) VALUES($1,$2,$3,$4,$5)", [session, w.workspaceId, w.supervisorMember, started, boot.employee!.calendar]);
      await w.client.query(`INSERT INTO hrms_attendance_events(id,workspace_id,membership_id,session_id,action_id,request_hash,kind,occurred_at,device_at,evidence,recorded_by)
        VALUES($1,$2,$3,$4,$5,repeat('a',64),'check_in',$6,$6,'{}',$7)`, [event, w.workspaceId, w.supervisorMember, session, randomUUID(), started, w.supervisor]);
      await w.client.query("INSERT INTO hrms_segments(workspace_id,session_id,mode,context_snapshot,started_at,start_event_id) VALUES($1,$2,'field','{\"name\":\"Villa 12\",\"location\":null}',$3,$4)",
        [w.workspaceId, session, started, event]);
      expect(await processHrmsCheckouts(w.client, w.workspaceId)).toEqual({ sent: 0 });

      const owner = w.as(w.owner);
      const types = await owner.leave.types(actor, w.workspaceId);
      const sick = types.find((type: { name: string }) => type.name === "Sick leave").id;
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
      const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
      const history = await owner.attendance.history(actor, w.workspaceId, { from: today, to: today, scope: "team" });
      const supervisorDay = history.days.find((row: { membershipId: string }) => row.membershipId === w.supervisorMember)!;
      expect(supervisorDay).toMatchObject({ status: "checked_in", place: "Villa 12", scheduled: weekday >= 1 && weekday <= 5 });
      if (weekday >= 1 && weekday <= 5) {
        const asked = await w.as(w.designer).leave.request(actor, w.workspaceId, { actionId: randomUUID(), leaveTypeId: sick, startDate: today, endDate: today, dayPart: "full", reason: "Fever" });
        await owner.leave.decide(actor, w.workspaceId, asked.id, { decision: "approve", reason: "Rest" });
        const again = await owner.attendance.history(actor, w.workspaceId, { from: today, to: today, scope: "team" });
        expect(again.days.find((row: { membershipId: string }) => row.membershipId === w.designerMember)).toMatchObject({ status: "on_leave", leaveType: "Sick leave", place: null });
      }
    });
  });
  it("crews without logins: a supervisor marks the day, someone else approves it, and its cost replaces the headcount", async () => {
    await world(async (w) => {
      const project = randomUUID(), today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
      await w.client.query("SET LOCAL session_replication_role = replica");
      await w.client.query("INSERT INTO delivery_projects(id,workspace_id,case_id,name,reference,quote_id,started_at,created_by) VALUES($1,$2,$3,'Villa 12','P-1',$5,now(),$4)", [project, w.workspaceId, randomUUID(), w.owner, randomUUID()]);
      await w.client.query("SET LOCAL session_replication_role = origin");
      await w.client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager,active,role_keys) VALUES($1,$2,$3,true,true,'{project_manager}'),($1,$2,$4,false,true,'{site_supervisor}')",
        [w.workspaceId, project, w.ownerMember, w.supervisorMember]);
      await w.client.query("INSERT INTO workspace_labour_rates(id,workspace_id,trade,effective_from,day_rate,currency,updated_by) VALUES($1,$2,'Carpenter','2026-01-01',250,'AED',$3)", [randomUUID(), w.workspaceId, w.owner]);

      const owner = w.as(w.owner), supervisor = w.as(w.supervisor);
      let state = await owner.crews.saveCrew(actor, w.workspaceId, { version: 0, name: "Carpentry A", trade: " carpenter ", leadMembershipId: w.supervisorMember, active: true });
      const crew = state.crews[0].id;
      state = await owner.crews.saveWorker(actor, w.workspaceId, { version: 0, name: "Ali", trade: "Carpenter", crewId: crew, workerCode: "W-1", phone: "", dayRate: "300", currency: "AED", active: true });
      state = await owner.crews.saveWorker(actor, w.workspaceId, { version: 0, name: "Ravi", trade: "Carpenter", crewId: crew, workerCode: "W-2", phone: "", active: true });
      const [ali, ravi] = ["Ali", "Ravi"].map((name) => state.workers.find((worker: { name: string }) => worker.name === name).id);
      await expect(supervisor.crews.saveWorker(actor, w.workspaceId, { version: 0, name: "Sam", trade: "Carpenter", workerCode: "", phone: "", active: true })).rejects.toThrow("You do not have access");
      // The supervisor sees crews but not what people are paid.
      expect((await supervisor.crews.crews(actor, w.workspaceId)).workers.find((worker: { name: string }) => worker.name === "Ali").dayRate).toBeNull();

      const day = randomUUID();
      const saved = await supervisor.crews.saveDay(actor, w.workspaceId, day, { version: 0, crewId: crew, projectId: project, workDate: today, note: "Kitchen carcasses",
        workers: [{ workerId: ali, presence: "present", overtimeHours: 2 }, { workerId: ravi, presence: "half_day", overtimeHours: 0 }] });
      expect(saved).toMatchObject({ status: "draft", present: 1.5, projectName: "P-1 · Villa 12" });
      await expect(supervisor.crews.submitDay(actor, w.workspaceId, day, { version: 1, exceptionReason: "" })).rejects.toThrow("Retake the photo or give a reason.");
      const submitted = await supervisor.crews.submitDay(actor, w.workspaceId, day, { version: 1, exceptionReason: "Phone camera broken" });
      expect(submitted.evidence).toMatchObject({ issues: ["No group photo", "Location missing", "Site boundary is not set up"] });
      expect(await notices(w, "hrms.crew_day_submitted")).toEqual([expect.objectContaining({ recipient: w.owner, subject: "Crew day to approve: Carpentry A" })]);

      // Another sheet the same day can't put Ali anywhere for a second whole day.
      const other = (await owner.crews.saveCrew(actor, w.workspaceId, { version: 0, name: "Carpentry B", trade: "Carpenter", leadMembershipId: w.supervisorMember, active: true })).crews.find((row: { name: string }) => row.name === "Carpentry B").id;
      const second = randomUUID();
      await supervisor.crews.saveDay(actor, w.workspaceId, second, { version: 0, crewId: other, projectId: project, workDate: today, note: "", workers: [{ workerId: ali, presence: "present", overtimeHours: 0 }] });
      await expect(supervisor.crews.submitDay(actor, w.workspaceId, second, { version: 1, exceptionReason: "Phone camera broken" })).rejects.toThrow("Already marked for the whole day elsewhere: Ali.");

      await expect(supervisor.crews.decideDay(actor, w.workspaceId, day, { version: 2, decision: "approve", note: "" })).rejects.toThrow("Someone else approves");
      const approved = await owner.crews.decideDay(actor, w.workspaceId, day, { version: 2, decision: "approve", note: "" });
      expect(approved.workers.map((line: { name: string; dayRate: string; currency: string }) => [line.name, line.dayRate, line.currency])).toEqual([["Ali", "300.0000", "AED"], ["Ravi", "250.0000", "AED"]]);
      expect(await notices(w, "hrms.crew_day_approved", w.supervisor)).toHaveLength(1);
      await w.client.query("SAVEPOINT frozen");
      await expect(w.client.query("UPDATE hrms_crew_day_workers SET presence='absent' WHERE crew_day_id=$1", [day])).rejects.toThrow("approved crew day cannot change");
      await w.client.query("ROLLBACK TO SAVEPOINT frozen");

      // The site report counted 4 carpenters and 2 painters that day: the named crew replaces the carpenters only.
      const report = randomUUID();
      await w.client.query("INSERT INTO site_reports(id,workspace_id,project_id,report_date,author_id,status,submitted_at,decided_by) VALUES($1,$2,$3,$4,$5,'approved',now(),$6)", [report, w.workspaceId, project, today, w.supervisor, w.owner]);
      await w.client.query("INSERT INTO site_report_workforce(id,workspace_id,report_id,trade,people) VALUES($1,$2,$3,'carpenter',4),($4,$2,$3,'Painter',2)", [randomUUID(), w.workspaceId, report, randomUUID()]);
      await w.client.query("INSERT INTO workspace_labour_rates(id,workspace_id,trade,effective_from,day_rate,currency,updated_by) VALUES($1,$2,'Painter','2026-01-01',200,'AED',$3)", [randomUUID(), w.workspaceId, w.owner]);
      const costs = await readProjectCosts(w.client, w.workspaceId, project);
      const labour = costs.entries.filter((entry) => entry.source === "labour").map((entry) => [entry.description, entry.amount]);
      expect(labour).toEqual(expect.arrayContaining([["Crew: Carpentry A, 2 people", "425.0000"], ["Site labour: Painter, 2 people", "400.0000"]]));
      expect(labour).toHaveLength(2);
    });
  });
});
