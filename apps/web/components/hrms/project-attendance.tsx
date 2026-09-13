"use client";
import { useState } from "react";
import type {
  HrmsBootstrap,
  ProjectSiteAttendance,
  WorkContext,
} from "@wodana/contracts";
import { DataTable, SelectField, TextField } from "./controls";
import { localDay, minutesLabel, statusLabel } from "@/lib/hrms/client";
import { Empty, Notice, useHrms } from "./shared";
import styles from "./hrms.module.css";
export function ProjectAttendancePanel({
  workspaceId,
  boot,
  revision,
}: {
  workspaceId: string;
  boot: HrmsBootstrap;
  revision: number;
}) {
  const { data, error } = useHrms<WorkContext[]>(
      workspaceId,
      "",
      revision,
      "projects",
    ),
    [project, setProject] = useState("");
  const projects =
    data?.filter((p) => p.kind === "project" && p.canViewAttendance) ?? [];
  return (
    <>
      <div className={styles.toolbar}>
        <div>
          <h2>Site attendance</h2>
          <p>See who checked in at the delivery projects you lead.</p>
        </div>
      </div>
      {error ? <Notice error>{error}</Notice> : null}
      {projects.length ? (
        <>
          <SelectField
            id="site-attendance-project"
            label="Project"
            value={project || projects[0].id}
            onChange={(e) => setProject(e)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <SiteRecords
            workspaceId={workspaceId}
            projectId={project || projects[0].id}
            timezone={boot.workspace.timezone}
            revision={revision}
          />
        </>
      ) : (
        <Empty title="No project attendance to review">
          Your administrator can assign you as a project lead in Workplaces &
          assignments.
        </Empty>
      )}
    </>
  );
}
function SiteRecords({
  workspaceId,
  projectId,
  timezone,
  revision,
}: {
  workspaceId: string;
  projectId: string;
  timezone: string;
  revision: number;
}) {
  const today = localDay(timezone),
    [from, setFrom] = useState(today),
    [to, setTo] = useState(today);
  const { data, error, loading } = useHrms<ProjectSiteAttendance[]>(
    workspaceId,
    `attendance?projectId=${projectId}&from=${from}&to=${to}`,
    revision,
    "projects",
  );
  const time = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  return (
    <>
      <div className={styles.filters}>
        <TextField
          id="site-attendance-from"
          label="From"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          id="site-attendance-to"
          label="To"
          type="date"
          min={from}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      {error ? <Notice error>{error}</Notice> : null}
      {loading ? <Notice>Loading site records…</Notice> : null}
      {data?.length ? (
        <DataTable
          caption="Project site visits"
          rows={data}
          getRowKey={(r) => r.id}
          columns={[
            { key: "name", header: "Employee", render: (r) => r.name },
            { key: "site", header: "Site", render: (r) => r.site },
            {
              key: "in",
              header: "Site check-in",
              render: (r) => time(r.checkedInAt),
            },
            {
              key: "out",
              header: "Site checkout",
              render: (r) =>
                r.checkedOutAt ? time(r.checkedOutAt) : "In progress",
            },
            {
              key: "duration",
              header: "Visit duration",
              render: (r) =>
                r.minutes === null ? "—" : minutesLabel(r.minutes),
            },
            {
              key: "location",
              header: "Location check",
              render: (r) => statusLabel(r.locationStatus ?? "missing"),
            },
          ]}
        />
      ) : !loading && !error ? (
        <Empty title="No site visits in this range">
          Verified site check-ins appear here as employees record their
          attendance.
        </Empty>
      ) : null}
    </>
  );
}
