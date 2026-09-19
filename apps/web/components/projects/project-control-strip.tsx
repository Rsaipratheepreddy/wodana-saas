"use client";

import { useState } from "react";
import { AlertTriangle, PauseCircle, Settings2, Users } from "lucide-react";
import { Button, Checkbox, ControlledModalDialog, Form, SelectField, TextAreaField, TextInput } from "@/design-system";
import type { ProjectControlSummary, ProjectRole, ProjectRoleAssignment, ProjectState } from "@/lib/projects/execution";
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
  reference: "", priority: "normal", risk: "on_track", onHold: false,
  holdReason: "", holdSince: "", holdOwnerId: "", promise: "",
  targetCompletion: "", handoverDate: "", nextAction: "",
  nextActionOwnerId: "", nextActionDate: "", nextClientMeeting: "",
  nextClientMeetingOwnerId: "", clientNote: "",
});

export function ProjectControlStrip({ state, busy, run, compact = false }: {
  state: ProjectState;
  busy: boolean;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
  compact?: boolean;
}) {
  const controls = { ...blankControls(), ...(state.data.controls ?? {}) };
  const [dialog, setDialog] = useState<"" | "controls" | "roles">("");
  const [draft, setDraft] = useState(controls);
  const [assignments, setAssignments] = useState<ProjectRoleAssignment[]>(state.data.roleAssignments ?? []);
  const people = state.members.map((member) => ({ id: member.id, label: member.name }));
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

  if (!state.canManage && !state.data.controls) return null;

  return <>
    <section className={s.strip} data-compact={compact || undefined} aria-label="Project controls">
      <div><small>Risk</small><span data-tone={controls.risk}><AlertTriangle size={13}/>{label(controls.risk)}</span></div>
      <div><small>Client follow-up</small><strong>{controls.nextAction || "Not set"}</strong><em>{controls.nextActionDate || "No due date"}{controls.nextActionOwnerId ? ` · ${person(controls.nextActionOwnerId)}` : ""}</em></div>
      <div><small>Handover</small><strong>{controls.handoverDate || "Not set"}</strong><em>{handoverDays === null ? "Set client date" : handoverDays < 0 ? `${Math.abs(handoverDays)} days overdue` : `${handoverDays} days remaining`}</em></div>
      {controls.onHold ? <div className={s.hold}><PauseCircle size={15}/><strong>On hold</strong><span>{controls.holdReason}</span></div> : null}
      {state.canManage ? <div className={s.actions}><Button onPress={openControls} size="compact"><Settings2 size={14}/>Project settings</Button><Button aria-label="Project team roles" onPress={openRoles} size="compact"><Users size={14}/>Team</Button></div> : null}
    </section>

    <ControlledModalDialog isOpen={dialog === "controls"} onOpenChange={(open) => !open && setDialog("")} title="Project controls" size="lg">
      <Form className={s.form} onSubmit={async (event) => { event.preventDefault(); if (await run("project_controls", { controls: draft })) setDialog(""); }}>
        <div className={s.grid}>
          <TextInput isRequired label="Project / work-order reference" onChange={(value) => setDraft({ ...draft, reference: value })} value={draft.reference} />
          <SelectField items={[{ id: "normal", label: "Normal" }, { id: "high", label: "High" }, { id: "critical", label: "Critical" }]} label="Priority" onSelectionChange={(key) => key && setDraft({ ...draft, priority: String(key) as ProjectControlSummary["priority"] })} selectedKey={draft.priority} />
          <SelectField items={[{ id: "on_track", label: "On track" }, { id: "get_ready", label: "Get ready" }, { id: "urgent_action", label: "Urgent action" }, { id: "high_risk", label: "High risk" }, { id: "complete", label: "Complete" }]} label="Risk" onSelectionChange={(key) => key && setDraft({ ...draft, risk: String(key) as ProjectControlSummary["risk"] })} selectedKey={draft.risk} />
          <TextInput label="Promised timeline" onChange={(value) => setDraft({ ...draft, promise: value })} placeholder="What the client was promised" value={draft.promise} />
          <TextInput inputType="date" label="Target completion" onChange={(value) => setDraft({ ...draft, targetCompletion: value })} value={draft.targetCompletion} />
          <TextInput inputType="date" label="Client handover date" onChange={(value) => setDraft({ ...draft, handoverDate: value })} value={draft.handoverDate} />
          <TextInput isRequired={hasNextAction} label="Next client action" onChange={(value) => setDraft({ ...draft, nextAction: value })} value={draft.nextAction} />
          <SelectField isRequired={hasNextAction} items={people} label="Next action owner" onSelectionChange={(key) => setDraft({ ...draft, nextActionOwnerId: key ? String(key) : "" })} placeholder="Choose owner" selectedKey={draft.nextActionOwnerId || null} />
          <TextInput inputType="date" isRequired={hasNextAction} label="Next action due" onChange={(value) => setDraft({ ...draft, nextActionDate: value })} value={draft.nextActionDate} />
          <TextInput inputType="date" label="Next client meeting" onChange={(value) => setDraft({ ...draft, nextClientMeeting: value })} value={draft.nextClientMeeting} />
          <SelectField isRequired={Boolean(draft.nextClientMeeting)} items={people} label="Meeting owner" onSelectionChange={(key) => setDraft({ ...draft, nextClientMeetingOwnerId: key ? String(key) : "" })} placeholder="Choose owner" selectedKey={draft.nextClientMeetingOwnerId || null} />
        </div>
        <TextAreaField label="Latest client note" onChange={(value) => setDraft({ ...draft, clientNote: value })} value={draft.clientNote} />
        <div className={s.check}><Checkbox isSelected={draft.onHold} onChange={(checked) => setDraft({ ...draft, onHold: checked })}>Place project on hold</Checkbox><small>This pauses new task starts without changing the project phase.</small></div>
        {draft.onHold ? <div className={s.grid}>
          <SelectField isRequired items={people} label="Hold owner" onSelectionChange={(key) => setDraft({ ...draft, holdOwnerId: key ? String(key) : "" })} placeholder="Choose owner" selectedKey={draft.holdOwnerId || null} />
          <TextAreaField isRequired label="Hold reason" onChange={(value) => setDraft({ ...draft, holdReason: value })} value={draft.holdReason} />
        </div> : null}
        <Button isLoading={busy} type="submit" variant="primary">Save project controls</Button>
      </Form>
    </ControlledModalDialog>

    <ControlledModalDialog isOpen={dialog === "roles"} onOpenChange={(open) => !open && setDialog("")} title="Project team roles" size="lg">
      <Form className={s.form} onSubmit={async (event) => { event.preventDefault(); if (await run("project_roles", { assignments })) setDialog(""); }}>
        <div className={s.roles}>{roles.map((role) => {
          const assigned = assignments.find((item) => item.role === role.id)?.memberId ?? "unassigned";
          return <SelectField items={[{ id: "unassigned", label: "Unassigned" }, ...people]} key={role.id} label={role.label} onSelectionChange={(key) => updateRole(role.id, key === "unassigned" ? "" : String(key ?? ""))} selectedKey={assigned} />;
        })}</div>
        <Button isLoading={busy} type="submit" variant="primary">Save team roles</Button>
      </Form>
    </ControlledModalDialog>
  </>;
}
