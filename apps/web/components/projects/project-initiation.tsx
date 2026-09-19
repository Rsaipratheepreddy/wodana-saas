"use client";

import { useState, type FormEvent } from "react";
import type {
  ProjectInitiationBaseline,
  ProjectRole,
  ProjectRoleAssignment,
  ProjectState,
} from "@/lib/projects/execution";
import styles from "./project-initiation.module.css";

const roleChoices: { value: ProjectRole; label: string }[] = [
  { value: "sales_manager", label: "Sales manager" },
  { value: "senior_designer", label: "Senior designer" },
  { value: "junior_designer", label: "Junior designer" },
  { value: "technical_designer", label: "Technical designer" },
  { value: "visualizer", label: "Visualizer" },
  { value: "creative_director", label: "Creative director" },
  { value: "finance", label: "Finance" },
  { value: "procurement_production", label: "Procurement & production" },
  { value: "crm_owner", label: "CRM owner" },
  { value: "sales_assistant", label: "Sales assistant" },
  { value: "surveyor", label: "Surveyor" },
];

function initialDraft(state: ProjectState): ProjectInitiationBaseline {
  const baseline = state.data.initiation?.baseline;
  if (baseline) return structuredClone(baseline);
  return {
    projectOwnerId: "",
    teamMemberIds: [],
    siteReadiness: "to_confirm",
    siteIds: [],
    objective: "",
    clientPromise: "",
    clientContactName: "",
    clientContactPhone: "",
    clientContactEmail: "",
    accessNotes: "",
    operationalStart: "",
    targetCompletion: "",
    handoverDate: "",
  };
}

export function ProjectInitiation({
  state,
  busy,
  run,
}: {
  state: ProjectState;
  busy: boolean;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
}) {
  const initiation = state.data.initiation;
  if (!initiation) return null;
  return <ProjectInitiationContent state={state} busy={busy} run={run} />;
}

function ProjectInitiationContent({ state, busy, run }: {
  state: ProjectState;
  busy: boolean;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
}) {
  const initiation = state.data.initiation!;
  const baseline = initiation.baseline;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => initialDraft(state));
  const [roles, setRoles] = useState<ProjectRoleAssignment[]>(() =>
    (state.data.roleAssignments ?? []).filter((entry) => entry.role !== "project_manager"),
  );
  const [revisionReason, setRevisionReason] = useState("");
  const canRevise = !state.data.tasks.length && !state.data.reports.length &&
    !state.data.materials.length &&
    !state.data.orders.some((order) => !["enquiry", "draft", "cancelled"].includes(order.status)) &&
    !(state.data.workPackages ?? []).some((item) => item.status !== "planning");
  const person = (id: string) => state.members.find((member) => member.id === id)?.name ?? "Unassigned";
  const site = (id: string) => state.sites?.find((item) => item.id === id)?.name ?? "Site removed";
  function change<K extends keyof ProjectInitiationBaseline>(key: K, value: ProjectInitiationBaseline[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const action = baseline ? "revise_project_initiation" : "project_initiation";
    const teamMemberIds = [...new Set([draft.projectOwnerId, ...draft.teamMemberIds, ...roles.map((entry) => entry.memberId)].filter(Boolean))];
    const accepted = await run(action, {
      initiation: {
        ...draft,
        teamMemberIds,
        siteIds: draft.siteReadiness === "not_required" ? [] : draft.siteIds,
        roleAssignments: [{ role: "project_manager", memberId: draft.projectOwnerId }, ...roles],
      },
      ...(baseline ? { note: revisionReason.trim() } : {}),
    });
    if (accepted) {
      setEditing(false);
      setRevisionReason("");
    }
  }
  return (
    <section className={styles.panel} aria-label="Project setup">
      <div className={styles.header}>
        <div>
          <h2>Project setup</h2>
          <p>{baseline ? `Confirmed by ${initiation.confirmedByName} · ${initiation.confirmedAt.slice(0, 10)}` : "Confirm the owner, delivery plan and client promise before detailed planning."}</p>
        </div>
        {state.canManage && !editing && (!baseline || canRevise) && (
          <button className={styles.secondary} type="button" onClick={() => {
            setDraft(initialDraft(state));
            setRoles((state.data.roleAssignments ?? []).filter((entry) => entry.role !== "project_manager"));
            setEditing(true);
          }}>{baseline ? "Revise setup" : "Set up project"}</button>
        )}
      </div>
      <div className={styles.commercial}>
        <span>Deal File <strong>{initiation.commercial.dealFileReference}</strong></span>
        <span>Agreement <strong>{initiation.commercial.agreementReference}</strong></span>
        <span>Accepted value <strong>{initiation.commercial.currency} {initiation.commercial.value.toLocaleString()}</strong></span>
      </div>
      {baseline && !editing && <dl className={styles.summary}>
        <div><dt>Project owner</dt><dd>{person(baseline.projectOwnerId)}</dd></div>
        <div><dt>Delivery team</dt><dd>{baseline.teamMemberIds.map(person).join(", ")}</dd></div>
        <div><dt>Site</dt><dd>{baseline.siteReadiness === "not_required" ? "Not required" : baseline.siteReadiness === "to_confirm" ? "To confirm" : baseline.siteIds.map(site).join(", ")}</dd></div>
        <div><dt>Start / target</dt><dd>{baseline.operationalStart} → {baseline.targetCompletion}</dd></div>
        <div><dt>Client promise</dt><dd>{baseline.clientPromise}</dd></div>
      </dl>}
      {editing && <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <div className={styles.grid}>
          <label>Project owner
            <select required value={draft.projectOwnerId} onChange={(event) => change("projectOwnerId", event.target.value)}>
              <option value="">Choose owner</option>
              {state.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </label>
          <label>Site readiness
            <select value={draft.siteReadiness} onChange={(event) => change("siteReadiness", event.target.value as ProjectInitiationBaseline["siteReadiness"])}>
              <option value="to_confirm">To confirm</option>
              <option value="confirmed" disabled={!state.sites?.length}>Confirmed</option>
              <option value="not_required">No site work</option>
            </select>
          </label>
        </div>
        <fieldset className={styles.choices}><legend>Delivery team</legend>
          {state.members.map((member) => <label key={member.id}>
            <input type="checkbox" checked={draft.teamMemberIds.includes(member.id) || draft.projectOwnerId === member.id} disabled={draft.projectOwnerId === member.id}
              onChange={(event) => change("teamMemberIds", event.target.checked ? [...draft.teamMemberIds, member.id] : draft.teamMemberIds.filter((id) => id !== member.id))} />{member.name}
          </label>)}
        </fieldset>
        {draft.siteReadiness !== "not_required" && <fieldset className={styles.choices}><legend>Project sites</legend>
          {state.sites?.length ? state.sites.map((item) => <label key={item.id}>
            <input type="checkbox" checked={draft.siteIds.includes(item.id)} onChange={(event) => change("siteIds", event.target.checked ? [...draft.siteIds, item.id] : draft.siteIds.filter((id) => id !== item.id))} />{item.name}
          </label>) : <p>No transferred project site yet. Keep readiness “To confirm”; confirm a site before site work starts.</p>}
        </fieldset>}
        <div className={styles.grid}>
          <label>Operational start<input required type="date" value={draft.operationalStart} onChange={(event) => change("operationalStart", event.target.value)} /></label>
          <label>Target completion<input required type="date" min={draft.operationalStart} value={draft.targetCompletion} onChange={(event) => change("targetCompletion", event.target.value)} /></label>
          <label>Handover date<input type="date" min={draft.targetCompletion} value={draft.handoverDate} onChange={(event) => change("handoverDate", event.target.value)} /></label>
        </div>
        <label>Project objective<textarea required maxLength={1000} value={draft.objective} onChange={(event) => change("objective", event.target.value)} /></label>
        <label>Client promise<textarea required maxLength={1000} value={draft.clientPromise} onChange={(event) => change("clientPromise", event.target.value)} /></label>
        <div className={styles.grid}>
          <label>Client contact<input value={draft.clientContactName} onChange={(event) => change("clientContactName", event.target.value)} /></label>
          <label>Phone<input value={draft.clientContactPhone} onChange={(event) => change("clientContactPhone", event.target.value)} /></label>
          <label>Email<input type="email" value={draft.clientContactEmail} onChange={(event) => change("clientContactEmail", event.target.value)} /></label>
        </div>
        <label>Access notes<textarea value={draft.accessNotes} onChange={(event) => change("accessNotes", event.target.value)} /></label>
        <details className={styles.roles}><summary>Other role holders</summary>
          <div className={styles.grid}>{roleChoices.map((role) => <label key={role.value}>{role.label}
            <select value={roles.find((entry) => entry.role === role.value)?.memberId ?? ""} onChange={(event) => setRoles((current) => [
              ...current.filter((entry) => entry.role !== role.value),
              ...(event.target.value ? [{ role: role.value, memberId: event.target.value }] : []),
            ])}>
              <option value="">Not assigned</option>
              {state.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </label>)}</div>
        </details>
        {baseline && <label>Reason for revision<textarea required value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} /></label>}
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => setEditing(false)}>Cancel</button>
          <button type="submit" className={styles.primary} disabled={busy || draft.siteReadiness === "confirmed" && !draft.siteIds.length}>{baseline ? "Save revised setup" : "Confirm project setup"}</button>
        </div>
      </form>}
      {baseline && !canRevise && <p className={styles.locked}>Detailed planning has started. Change the delivery plan through project change control.</p>}
    </section>
  );
}
