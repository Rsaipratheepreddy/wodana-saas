"use client";

import { useState } from "react";
import { AlertTriangle, PauseCircle, Settings2, Users } from "lucide-react";
import { ControlledModalDialog } from "@/design-system";
import type {
  ProjectControlSummary,
  ProjectRole,
  ProjectRoleAssignment,
  ProjectState,
} from "@/lib/projects/execution";
import { label } from "@/lib/projects/execution";
import s from "./project-control-strip.module.css";

const roles: { id: ProjectRole; label: string }[] = [
  { id: "sales_manager", label: "Sales / account manager" },
  { id: "senior_designer", label: "Senior designer" },
  { id: "junior_designer", label: "Junior designer" },
  { id: "technical_designer", label: "Technical designer" },
  { id: "visualizer", label: "Visualizer" },
  { id: "project_manager", label: "Project manager" },
  { id: "creative_director", label: "Creative director" },
  { id: "finance", label: "Finance" },
  { id: "procurement_production", label: "Procurement / production" },
  { id: "crm_owner", label: "CRM owner" },
  { id: "sales_assistant", label: "Sales assistant" },
  { id: "surveyor", label: "Surveyor" },
];

const blankControls = (): ProjectControlSummary => ({
  reference: "",
  priority: "normal",
  risk: "on_track",
  onHold: false,
  holdReason: "",
  holdSince: "",
  holdOwnerId: "",
  promise: "",
  targetCompletion: "",
  handoverDate: "",
  nextAction: "",
  nextActionOwnerId: "",
  nextActionDate: "",
  nextClientMeeting: "",
  nextClientMeetingOwnerId: "",
  clientNote: "",
});

export function ProjectControlStrip({
  state,
  busy,
  run,
}: {
  state: ProjectState;
  busy: boolean;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
}) {
  const controls = { ...blankControls(), ...(state.data.controls ?? {}) },
    [dialog, setDialog] = useState<"" | "controls" | "roles">(""),
    [draft, setDraft] = useState(controls),
    [assignments, setAssignments] = useState<ProjectRoleAssignment[]>(
      state.data.roleAssignments ?? [],
    );
  const person = (id: string) => state.members.find((member) => member.id === id)?.name ?? "Unassigned";
  const openControls = () => { setDraft({ ...controls }); setDialog("controls"); };
  const openRoles = () => { setAssignments([...(state.data.roleAssignments ?? [])]); setDialog("roles"); };
  const handoverDays = controls.handoverDate && state.today
    ? Math.ceil((Date.parse(`${controls.handoverDate}T12:00:00Z`) - Date.parse(`${state.today}T12:00:00Z`)) / 86400000)
    : null;
  const hasNextAction = Boolean(draft.nextAction || draft.nextActionOwnerId || draft.nextActionDate);
  function updateRole(role: ProjectRole, memberId: string) {
    setAssignments((current) => {
      const next = current.filter((item) => item.role !== role);
      return memberId ? [...next, { role, memberId }] : next;
    });
  }
  return (
    <>
      <section className={s.strip} aria-label="Project controls">
        <div><small>Risk</small><span data-tone={controls.risk}><AlertTriangle size={13}/>{label(controls.risk)}</span></div>
        <div><small>Next action</small><strong>{controls.nextAction || "Set next action"}</strong><em>{controls.nextActionDate || "No due date"}{controls.nextActionOwnerId ? ` · ${person(controls.nextActionOwnerId)}` : ""}</em></div>
        <div><small>Handover</small><strong>{controls.handoverDate || "Not set"}</strong><em>{handoverDays === null ? "Set client date" : handoverDays < 0 ? `${Math.abs(handoverDays)} days overdue` : `${handoverDays} days remaining`}</em></div>
        {controls.onHold && <div className={s.hold}><PauseCircle size={15}/><strong>On hold</strong><span>{controls.holdReason}</span></div>}
        {state.canManage && <div className={s.actions}><button onClick={openControls}><Settings2 size={14}/> Project settings</button><button aria-label="Project team roles" onClick={openRoles}><Users size={14}/> Team</button></div>}
      </section>
      <ControlledModalDialog isOpen={dialog === "controls"} onOpenChange={(open) => !open && setDialog("")} title="Project controls" size="lg">
        <form className={s.form} onSubmit={async (event) => { event.preventDefault(); if (await run("project_controls", { controls: draft })) setDialog(""); }}>
          <div className={s.grid}>
            <label>Project / work-order reference<input required value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })}/></label>
            <label>Priority<select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as ProjectControlSummary["priority"] })}><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
            <label>Risk<select value={draft.risk} onChange={(e) => setDraft({ ...draft, risk: e.target.value as ProjectControlSummary["risk"] })}><option value="on_track">On track</option><option value="get_ready">Get ready</option><option value="urgent_action">Urgent action</option><option value="high_risk">High risk</option><option value="complete">Complete</option></select></label>
            <label>Promised timeline<input value={draft.promise} onChange={(e) => setDraft({ ...draft, promise: e.target.value })} placeholder="What the client was promised"/></label>
            <label>Target completion<input type="date" value={draft.targetCompletion} onChange={(e) => setDraft({ ...draft, targetCompletion: e.target.value })}/></label>
            <label>Client handover date<input type="date" value={draft.handoverDate} onChange={(e) => setDraft({ ...draft, handoverDate: e.target.value })}/></label>
            <label>Next action<input required={hasNextAction} value={draft.nextAction} onChange={(e) => setDraft({ ...draft, nextAction: e.target.value })}/></label>
            <label>Next action owner<select required={hasNextAction} value={draft.nextActionOwnerId} onChange={(e) => setDraft({ ...draft, nextActionOwnerId: e.target.value })}><option value="">Choose owner…</option>{state.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
            <label>Next action due<input required={hasNextAction} type="date" value={draft.nextActionDate} onChange={(e) => setDraft({ ...draft, nextActionDate: e.target.value })}/></label>
            <label>Next client meeting<input type="date" value={draft.nextClientMeeting} onChange={(e) => setDraft({ ...draft, nextClientMeeting: e.target.value })}/></label>
            <label>Meeting owner<select required={Boolean(draft.nextClientMeeting)} value={draft.nextClientMeetingOwnerId} onChange={(e) => setDraft({ ...draft, nextClientMeetingOwnerId: e.target.value })}><option value="">Choose owner…</option>{state.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          </div>
          <label>Latest client note<textarea value={draft.clientNote} onChange={(e) => setDraft({ ...draft, clientNote: e.target.value })}/></label>
          <label className={s.check}><input type="checkbox" checked={draft.onHold} onChange={(e) => setDraft({ ...draft, onHold: e.target.checked })}/><span><strong>Place project on hold</strong><small>This pauses new task starts without changing the project phase.</small></span></label>
          {draft.onHold && <div className={s.grid}><label>Hold owner<select required value={draft.holdOwnerId} onChange={(e) => setDraft({ ...draft, holdOwnerId: e.target.value })}><option value="">Choose owner…</option>{state.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label>Hold reason<textarea required value={draft.holdReason} onChange={(e) => setDraft({ ...draft, holdReason: e.target.value })}/></label></div>}
          <button className={s.primary} disabled={busy}>Save project controls</button>
        </form>
      </ControlledModalDialog>
      <ControlledModalDialog isOpen={dialog === "roles"} onOpenChange={(open) => !open && setDialog("")} title="Project team roles" size="lg">
        <form className={s.form} onSubmit={async (event) => { event.preventDefault(); if (await run("project_roles", { assignments })) setDialog(""); }}>
          <p className={s.help}>Assign accountable roles for this project. One person may hold several roles; unneeded roles can stay unassigned.</p>
          <div className={s.roles}>{roles.map((role) => <label key={role.id}><span>{role.label}</span><select value={assignments.find((item) => item.role === role.id)?.memberId ?? ""} onChange={(e) => updateRole(role.id, e.target.value)}><option value="">Unassigned</option>{state.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>)}</div>
          <button className={s.primary} disabled={busy}>Save team roles</button>
        </form>
      </ControlledModalDialog>
    </>
  );
}
