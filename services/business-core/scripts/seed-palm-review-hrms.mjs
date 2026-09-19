import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
assert(databaseUrl, "Set DATABASE_URL to the local Palm review database.");
const target = new URL(databaseUrl);
assert(
  ["127.0.0.1", "localhost"].includes(target.hostname),
  "Palm HRMS review seed is local-only.",
);
assert(
  target.pathname.includes("palm_review"),
  "Use a dedicated palm_review database.",
);

const ids = {
  calendar: "e2000000-0000-4000-8000-000000000001",
  managerRole: "e2000000-0000-4000-8000-000000000002",
  office: "e2000000-0000-4000-8000-000000000003",
  factory: "e2000000-0000-4000-8000-000000000004",
  annual: "e2000000-0000-4000-8000-000000000005",
  sick: "e2000000-0000-4000-8000-000000000006",
  personal: "e2000000-0000-4000-8000-000000000007",
  project: "d1000000-0000-4000-8000-000000000008",
  site: "d1000000-0000-4000-8000-000000000010",
};

const people = [
  {
    key: "cece",
    userId: "e2100000-0000-4000-8000-000000000001",
    membershipId: "e2200000-0000-4000-8000-000000000001",
    name: "Cece Serna",
    email: "cece.demo@palmliving.invalid",
    code: "PLM-002",
    designation: "Operations Manager",
    department: "Operations",
    manager: "owner",
    managerRole: true,
    remote: true,
  },
  {
    key: "amy",
    userId: "e2100000-0000-4000-8000-000000000002",
    membershipId: "e2200000-0000-4000-8000-000000000002",
    name: "Amy",
    email: "amy.demo@palmliving.invalid",
    code: "PLM-003",
    designation: "Account Manager",
    department: "Client Relations",
    manager: "cece",
    remote: true,
  },
  {
    key: "grace",
    userId: "e2100000-0000-4000-8000-000000000003",
    membershipId: "e2200000-0000-4000-8000-000000000003",
    name: "Grace",
    email: "grace.demo@palmliving.invalid",
    code: "PLM-004",
    designation: "Interior Designer",
    department: "Design",
    manager: "cece",
    remote: true,
  },
  {
    key: "karen",
    userId: "e2100000-0000-4000-8000-000000000004",
    membershipId: "e2200000-0000-4000-8000-000000000004",
    name: "Karen",
    email: "karen.demo@palmliving.invalid",
    code: "PLM-005",
    designation: "Project Manager",
    department: "Projects",
    manager: "owner",
    managerRole: true,
    remote: true,
  },
  {
    key: "sahabdeen",
    userId: "e2100000-0000-4000-8000-000000000005",
    membershipId: "e2200000-0000-4000-8000-000000000005",
    name: "M. Sahabdeen",
    email: "sahabdeen.demo@palmliving.invalid",
    code: "PLM-006",
    designation: "Quantity Surveyor",
    department: "Commercial",
    manager: "karen",
    remote: false,
  },
  {
    key: "omar",
    userId: "e2100000-0000-4000-8000-000000000006",
    membershipId: "e2200000-0000-4000-8000-000000000006",
    name: "Demo Site Supervisor",
    email: "site-supervisor.demo@palmliving.invalid",
    code: "PLM-007",
    designation: "Site Supervisor",
    department: "Site Execution",
    manager: "karen",
    remote: false,
  },
  {
    key: "noor",
    userId: "e2100000-0000-4000-8000-000000000007",
    membershipId: "e2200000-0000-4000-8000-000000000007",
    name: "Demo Procurement Coordinator",
    email: "procurement.demo@palmliving.invalid",
    code: "PLM-008",
    designation: "Procurement Coordinator",
    department: "Procurement",
    manager: "cece",
    remote: false,
  },
];

const calendar = {
  id: ids.calendar,
  name: "Palm Living · Sunday to Thursday",
  timezone: "Asia/Dubai",
  workingDays: [0, 1, 2, 3, 4],
  holidays: ["2026-12-02", "2026-12-03"],
  dayStart: "08:30:00",
  halfDay: "13:00:00",
  dayEnd: "17:30:00",
};

const uuid = (family, value) =>
  `${`${family}00000000`.slice(0, 8)}-0000-4000-8000-${String(value).padStart(12, "0")}`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const instant = (day, time) => `${day}T${time}:00+04:00`;

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  const workspace = (
    await client.query(`SELECT id FROM workspaces WHERE slug=$1`, [
      process.env.PALM_REVIEW_WORKSPACE_SLUG ?? "palm-living",
    ])
  ).rows[0];
  assert(workspace, "Palm Living workspace is not configured.");
  await client.query(`SELECT set_config('app.current_workspace_id',$1,true)`, [
    workspace.id,
  ]);
  const owner = (
    await client.query(
      `SELECT membership.id AS "membershipId", app_user.id AS "userId"
       FROM workspace_memberships membership
       JOIN users app_user ON app_user.id=membership.user_id
       JOIN member_roles member_role ON member_role.membership_id=membership.id
       JOIN roles role ON role.id=member_role.role_id
       WHERE membership.workspace_id=$1 AND membership.status='active' AND role.code='owner'
       ORDER BY membership.joined_at LIMIT 1`,
      [workspace.id],
    )
  ).rows[0];
  assert(owner, "Palm Living needs an active owner.");
  const project = (
    await client.query(
      `SELECT id,case_id,name FROM delivery_projects WHERE workspace_id=$1 AND id=$2`,
      [workspace.id, ids.project],
    )
  ).rows[0];
  assert(project, "Run seed:palm:review-demo before the HRMS seed.");

  await client.query(
    `INSERT INTO roles(id,workspace_id,code,name,description,is_system)
     VALUES($1,$2,'people_manager','People manager','Review attendance and leave for direct reports.',false)
     ON CONFLICT(workspace_id,code) DO UPDATE SET name=excluded.name,description=excluded.description`,
    [ids.managerRole, workspace.id],
  );
  const managerRoleId = (
    await client.query(
      `SELECT id FROM roles WHERE workspace_id=$1 AND code='people_manager'`,
      [workspace.id],
    )
  ).rows[0].id;
  await client.query(
    `INSERT INTO role_permissions(workspace_id,role_id,permission_id)
     SELECT $1,$2,id FROM permissions
     WHERE code IN ('hrms.self','hrms.team','hrms.evidence','projects.view')
     ON CONFLICT DO NOTHING`,
    [workspace.id, managerRoleId],
  );
  const memberRoleId = (
    await client.query(
      `SELECT id FROM roles WHERE workspace_id=$1 AND code='member'`,
      [workspace.id],
    )
  ).rows[0].id;

  const members = {
    owner: { ...owner, name: "Palm Living Operations" },
  };
  for (const person of people) {
    const user = (
      await client.query(
        `INSERT INTO users(id,primary_email,display_name,preferred_locale,preferred_timezone,status)
         VALUES($1,$2,$3,'en-AE','Asia/Dubai','active')
         ON CONFLICT(id) DO UPDATE SET primary_email=excluded.primary_email,display_name=excluded.display_name,status='active',preferred_timezone='Asia/Dubai'
         RETURNING id`,
        [person.userId, person.email, person.name],
      )
    ).rows[0];
    const membership = (
      await client.query(
        `INSERT INTO workspace_memberships(id,workspace_id,user_id,status,joined_at)
         VALUES($1,$2,$3,'active','2026-01-01')
         ON CONFLICT(workspace_id,user_id) DO UPDATE SET status='active'
         RETURNING id`,
        [person.membershipId, workspace.id, user.id],
      )
    ).rows[0];
    members[person.key] = {
      membershipId: membership.id,
      userId: user.id,
      name: person.name,
    };
    await client.query(
      `INSERT INTO member_roles(workspace_id,membership_id,role_id)
       VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [workspace.id, membership.id, memberRoleId],
    );
    if (person.managerRole)
      await client.query(
        `INSERT INTO member_roles(workspace_id,membership_id,role_id)
         VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
        [workspace.id, membership.id, managerRoleId],
      );
  }

  await client.query(
    `INSERT INTO hrms_calendars(id,workspace_id,name,timezone,working_days,holidays,day_start,half_day,day_end)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,
    [
      calendar.id,
      workspace.id,
      calendar.name,
      calendar.timezone,
      calendar.workingDays,
      calendar.holidays,
      calendar.dayStart,
      calendar.halfDay,
      calendar.dayEnd,
    ],
  );
  await client.query(
    `INSERT INTO hrms_settings(workspace_id,default_calendar_id,fallback_approver_id,max_gps_accuracy_m,max_capture_age_seconds,media_retention_days)
     VALUES($1,$2,$3,100,180,365)
     ON CONFLICT(workspace_id) DO UPDATE SET default_calendar_id=excluded.default_calendar_id,fallback_approver_id=excluded.fallback_approver_id,max_gps_accuracy_m=100,max_capture_age_seconds=180,media_retention_days=365`,
    [workspace.id, calendar.id, owner.membershipId],
  );

  const employeeProfiles = [
    {
      key: "owner",
      code: "PLM-001",
      designation: "Operations Director",
      department: "Leadership",
      manager: null,
      remote: true,
    },
    ...people,
  ];
  for (const person of employeeProfiles) {
    const member = members[person.key];
    await client.query(
      `INSERT INTO hrms_employees(workspace_id,membership_id,enabled,employee_code,designation,department,manager_id,calendar_id,remote_allowed,active_from,active_to)
       VALUES($1,$2,true,$3,$4,$5,$6,$7,$8,'2026-01-01',null)
       ON CONFLICT(workspace_id,membership_id) DO UPDATE SET enabled=true,employee_code=excluded.employee_code,designation=excluded.designation,department=excluded.department,manager_id=excluded.manager_id,calendar_id=excluded.calendar_id,remote_allowed=excluded.remote_allowed,active_from=excluded.active_from,active_to=null`,
      [
        workspace.id,
        member.membershipId,
        person.code,
        person.designation,
        person.department,
        person.manager ? members[person.manager].membershipId : null,
        calendar.id,
        person.remote,
      ],
    );
  }

  await client.query(
    `INSERT INTO work_locations(id,workspace_id,name,kind,address,latitude,longitude,radius_m,active)
     VALUES($1,$3,'Palm Living Studio (demo)','office','Dubai, United Arab Emirates',25.2048,55.2708,180,true),
           ($2,$3,'Production Workshop (demo)','office','Al Quoz, Dubai, United Arab Emirates',25.1412,55.2244,220,true)
     ON CONFLICT(id) DO UPDATE SET active=true,address=excluded.address,radius_m=excluded.radius_m`,
    [ids.office, ids.factory, workspace.id],
  );
  for (const [index, entry] of [
    ["karen", true],
    ["grace", false],
    ["sahabdeen", false],
    ["omar", true],
  ].entries()) {
    const [key, isManager] = entry;
    await client.query(
      `INSERT INTO project_assignments(id,workspace_id,project_id,membership_id,is_manager,active)
       VALUES($1,$2,$3,$4,$5,true)
       ON CONFLICT(workspace_id,project_id,membership_id) WHERE project_id IS NOT NULL
       DO UPDATE SET is_manager=excluded.is_manager,active=true`,
      [uuid("e23", index + 1), workspace.id, project.id, members[key].membershipId, isManager],
    );
  }

  const leaveTypes = [
    [ids.annual, "Annual leave", 30, true],
    [ids.sick, "Sick leave", 15, true],
    [ids.personal, "Personal leave", 5, true],
  ];
  for (const [id, name, days, half] of leaveTypes)
    await client.query(
      `INSERT INTO hrms_leave_types(id,workspace_id,name,annual_days,allow_half_day,active)
       VALUES($1,$2,$3,$4,$5,true)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name,annual_days=excluded.annual_days,allow_half_day=excluded.allow_half_day,active=true`,
      [id, workspace.id, name, days, half],
    );
  for (const member of Object.values(members))
    for (const [typeId, , days] of leaveTypes)
      await client.query(
        `INSERT INTO hrms_leave_allowances(workspace_id,membership_id,leave_type_id,year,days)
         VALUES($1,$2,$3,2026,$4)
         ON CONFLICT(workspace_id,membership_id,leave_type_id,year) DO UPDATE SET days=excluded.days`,
        [workspace.id, member.membershipId, typeId, days],
      );

  const leaveRequests = [
    {
      id: uuid("e70", 1),
      person: "owner",
      type: ids.annual,
      start: "2026-08-06",
      end: "2026-08-06",
      units: [{ date: "2026-08-06", days: 1 }],
      reason: "Personal day",
      status: "approved",
      decision: "Coverage confirmed.",
    },
    {
      id: uuid("e70", 2),
      person: "grace",
      type: ids.annual,
      start: "2026-09-22",
      end: "2026-09-23",
      units: [
        { date: "2026-09-22", days: 1 },
        { date: "2026-09-23", days: 1 },
      ],
      reason: "Planned family time",
      status: "approved",
      decision: "Design review cover assigned.",
    },
    {
      id: uuid("e70", 3),
      person: "amy",
      type: ids.personal,
      start: "2026-09-24",
      end: "2026-09-24",
      units: [{ date: "2026-09-24", days: 0.5 }],
      dayPart: "second_half",
      reason: "Personal appointment",
      status: "pending",
    },
    {
      id: uuid("e70", 4),
      person: "sahabdeen",
      type: ids.sick,
      start: "2026-09-14",
      end: "2026-09-14",
      units: [{ date: "2026-09-14", days: 1 }],
      reason: "Medical rest",
      status: "cancellation_pending",
      decision: "Approved by project manager.",
      cancellation: "Recovered and returned to work.",
    },
    {
      id: uuid("e70", 5),
      person: "omar",
      type: ids.personal,
      start: "2026-09-27",
      end: "2026-09-27",
      units: [{ date: "2026-09-27", days: 1 }],
      reason: "Personal commitment",
      status: "rejected",
      decision: "Site coverage is required; choose another date.",
    },
  ];
  for (const [index, request] of leaveRequests.entries())
    await client.query(
      `INSERT INTO hrms_leave_requests(id,workspace_id,membership_id,leave_type_id,action_id,request_hash,start_date,end_date,day_part,units,calendar_snapshot,reason,status,decided_by,decision_reason,decided_at,cancellation_reason,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT(id) DO NOTHING`,
      [
        request.id,
        workspace.id,
        members[request.person].membershipId,
        request.type,
        uuid("e71", index + 1),
        hash(request.id),
        request.start,
        request.end,
        request.dayPart ?? "full",
        JSON.stringify(request.units),
        JSON.stringify(calendar),
        request.reason,
        request.status,
        request.status === "pending" ? null : owner.userId,
        request.decision ?? null,
        request.status === "pending" ? null : "2026-09-15T12:00:00+04:00",
        request.cancellation ?? null,
        `2026-09-${String(10 + index).padStart(2, "0")}T10:00:00+04:00`,
      ],
    );

  const days = ["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];
  let sessionNumber = 0;
  const seededSessions = [];
  for (const [personIndex, person] of employeeProfiles.entries()) {
    const member = members[person.key];
    for (const [dayIndex, day] of days.entries()) {
      sessionNumber += 1;
      const sessionId = uuid("e30", sessionNumber);
      const startEventId = uuid("e40", sessionNumber * 2 - 1);
      const endEventId = uuid("e40", sessionNumber * 2);
      const segmentId = uuid("e50", sessionNumber);
      const siteDay =
        ["grace", "karen", "omar"].includes(person.key) && dayIndex % 2 === 1;
      const fieldDay = person.key === "amy" && dayIndex === 2;
      const mode = siteDay ? "site" : fieldDay ? "field" : "office";
      const location = siteDay
        ? {
            id: ids.site,
            name: "Jumeirah Garden Villa",
            kind: "site",
            projectId: ids.project,
            caseId: null,
            address: "District One, Mohammed Bin Rashid City, Dubai",
            latitude: 25.1751,
            longitude: 55.2874,
            radiusM: 180,
            active: true,
            version: 1,
          }
        : fieldDay
          ? null
          : {
              id: ids.office,
              name: "Palm Living Studio (demo)",
              kind: "office",
              projectId: null,
              caseId: null,
              address: "Dubai, United Arab Emirates",
              latitude: 25.2048,
              longitude: 55.2708,
              radiusM: 180,
              active: true,
              version: 1,
            };
      const context = {
        name: siteDay
          ? project.name
          : fieldDay
            ? "Client meetings & measurements"
            : "General work",
        location,
      };
      const startMinute = (personIndex % 4) * 4;
      const endMinute = (personIndex % 3) * 5;
      const startAt = instant(day, `08:${String(32 + startMinute).padStart(2, "0")}`);
      const endAt = instant(day, `17:${String(12 + endMinute).padStart(2, "0")}`);
      const position = siteDay
        ? { latitude: 25.17512, longitude: 55.28743, accuracyM: 9 }
        : { latitude: 25.20482, longitude: 55.27081, accuracyM: 12 };
      const evidence = {
        position: {
          ...position,
          capturedAt: startAt,
          mock: false,
        },
        location,
        arrival: {
          status: fieldDay ? "not_required" : "verified",
          distanceM: fieldDay ? null : 8 + personIndex,
          accuracyM: position.accuracyM,
        },
        departure: {
          status: fieldDay ? "not_required" : "verified",
          distanceM: fieldDay ? null : 11 + personIndex,
          accuracyM: position.accuracyM,
        },
        photoCaptured: false,
        issues: [],
        verification: "verified",
      };
      await client.query(
        `INSERT INTO hrms_sessions(id,workspace_id,membership_id,started_at,ended_at,calendar_snapshot)
         VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(id) DO NOTHING`,
        [sessionId, workspace.id, member.membershipId, startAt, endAt, JSON.stringify(calendar)],
      );
      for (const [kind, eventId, eventAt, actionId, eventEvidence] of [
        ["check_in", startEventId, startAt, uuid("e41", sessionNumber * 2 - 1), evidence],
        [
          "check_out",
          endEventId,
          endAt,
          uuid("e41", sessionNumber * 2),
          { ...evidence, position: { ...evidence.position, capturedAt: endAt } },
        ],
      ])
        await client.query(
          `INSERT INTO hrms_attendance_events(id,workspace_id,membership_id,session_id,action_id,request_hash,kind,occurred_at,device_at,evidence,note,recorded_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9::jsonb,$10,$11) ON CONFLICT(id) DO NOTHING`,
          [
            eventId,
            workspace.id,
            member.membershipId,
            sessionId,
            actionId,
            hash(`${sessionId}:${kind}`),
            kind,
            eventAt,
            JSON.stringify(eventEvidence),
            siteDay ? "Project site attendance" : "",
            member.userId,
          ],
        );
      await client.query(
        `INSERT INTO hrms_segments(id,workspace_id,session_id,mode,location_id,project_id,case_id,context_snapshot,started_at,ended_at,start_event_id,end_event_id)
         VALUES($1,$2,$3,$4,$5,$6,null,$7::jsonb,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING`,
        [
          segmentId,
          workspace.id,
          sessionId,
          mode,
          location?.id ?? null,
          siteDay ? ids.project : fieldDay ? ids.project : null,
          JSON.stringify(context),
          startAt,
          endAt,
          startEventId,
          endEventId,
        ],
      );
      seededSessions.push({
        person: person.key,
        day,
        sessionId,
        eventId: startEventId,
        originalAt: startAt,
      });
    }
  }

  const reviewSource = seededSessions.find(
    (session) => session.person === "omar" && session.day === "2026-09-18",
  );
  await client.query(
    `INSERT INTO hrms_reviews(id,workspace_id,membership_id,session_id,action_id,kind,event_id,reason,status,created_at)
     VALUES($1,$2,$3,$4,$5,'exception',$6,'Site check-in photo was unavailable; supervisor confirmation required.','pending','2026-09-18T08:45:00+04:00')
     ON CONFLICT(id) DO NOTHING`,
    [
      uuid("e60", 1),
      workspace.id,
      members.omar.membershipId,
      reviewSource.sessionId,
      uuid("e61", 1),
      reviewSource.eventId,
    ],
  );
  const correctionSource = seededSessions.find(
    (session) => session.person === "grace" && session.day === "2026-09-16",
  );
  await client.query(
    `INSERT INTO hrms_reviews(id,workspace_id,membership_id,session_id,action_id,kind,event_id,requested_at,original_at,reason,status,decision_reason,decided_by,decided_at,created_at)
     VALUES($1,$2,$3,$4,$5,'correction',$6,'2026-09-16T08:30:00+04:00',$7,'Corrected site arrival after supervisor verification.','approved','Confirmed against the site access log.',$8,'2026-09-16T14:00:00+04:00','2026-09-16T12:30:00+04:00')
     ON CONFLICT(id) DO NOTHING`,
    [
      uuid("e60", 2),
      workspace.id,
      members.grace.membershipId,
      correctionSource.sessionId,
      uuid("e61", 2),
      correctionSource.eventId,
      correctionSource.originalAt,
      owner.userId,
    ],
  );

  await client.query("COMMIT");
  console.log(
    JSON.stringify(
      {
        workspaceId: workspace.id,
        people: Object.keys(members).length,
        calendars: 1,
        workplaces: 3,
        attendanceSessions: seededSessions.length,
        leaveTypes: leaveTypes.length,
        leaveRequests: leaveRequests.length,
        attendanceReviews: 2,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
