"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Badge, Button, Callout, Checkbox, ControlledModalDialog, Form, MenuButton, SelectField, TextAreaField, TextInput, type ActionItem } from "@/design-system";
import type { ProjectControlSummary, ProjectRole, ProjectRoleAssignment, ProjectState } from "@/lib/projects/execution";
import { label, taskProgress } from "@/lib/projects/execution";
import { StateBadge } from "./project-stage";
import { initials, shortDate } from "@/lib/projects/format";
import s from "./project-header.module.css";

const roles: { id: ProjectRole; label: string }[] = [
  { id: "project_manager", label: "Project manager" },
  { id: "sales_manager", label: "Sales / account manager" },
  { id: "senior_designer", label: "Senior designer" },
  { id: "junior_designer", label: "Junior designer" },
  { id: "technical_designer", label: "Technical designer" },
  { id: "visualizer", label: "Visualizer" },
  { id: "creative_director", label: "Creative director" },
  { id: "finance", label: "Finance" },
  { id: "procurement_production", label: "Procurement / production" },
  { id: "crm_owner", label: "CRM owner" },
  { id: "sales_assistant", label: "Sales assistant" },
  { id: "surveyor", label: "Surveyor" },
];

export const blankControls = (): ProjectControlSummary => ({
  reference: "", priority: "normal", risk: "on_track", onHold: false,
  holdReason: "", holdSince: "", holdOwnerId: "", promise: "",
  targetCompletion: "", handoverDate: "", nextAction: "",
  nextActionOwnerId: "", nextActionDate: "", nextClientMeeting: "",
  nextClientMeetingOwnerId: "", clientNote: "",
});

export function projectControls(state: ProjectState): ProjectControlSummary {
  return { ...blankControls(), ...(state.data.controls ?? {}) };
}

export function daysUntil(date: string, today: string) {
  if (!date || !today) return null;
  return Math.ceil((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
}

export function daysLabel(days: number | null) {
  if (days === null) return "";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "today";
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

const riskTone = (risk: string): "neutral" | "success" | "warning" | "danger" =>
  risk === "on_track" ? "success" : risk === "get_ready" ? "warning" : "danger";

/**
 * One-line project identity: who, where it stands and the single primary action for the
 * current stage. Everything else (settings, team roles, refresh, source case) lives in the menu.
 */
export function ProjectHeader({ state, busy, run, today, primary, status, onRefresh }: {
  state: ProjectState;
  busy: boolean;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
  today: string;
  primary?: ReactNode;
  status?: string;
  onRefresh: () => void;
}) {
  const controls = projectControls(state);
  const d = state.data;
  const [dialog, setDialog] = useState<"" | "controls" | "roles">("");
  const [draft, setDraft] = useState(controls);
  const [assignments, setAssignments] = useState<ProjectRoleAssignment[]>(d.roleAssignments ?? []);
  const people = state.members.map((member) => ({ id: member.id, label: member.name }));
  const person = (id: string) => state.members.find((member) => member.id === id)?.name ?? "Unassigned";
  const progress = Math.round(taskProgress(d));
  const handoverDays = daysUntil(controls.handoverDate, today);
  const hasNextAction = Boolean(draft.nextAction || draft.nextActionOwnerId || draft.nextActionDate);
  const openControls = () => { setDraft({ ...controls }); setDialog("controls"); };
  const openRoles = () => { setAssignments([...(d.roleAssignments ?? [])]); setDialog("roles"); };
  const menu: ActionItem[] = [
    ...(state.canManage ? [{ id: "controls", label: "Project settings" }, { id: "roles", label: "Team roles" }] : []),
    { id: "refresh", label: "Refresh project", isDisabled: busy },
  ];
  function updateRole(role: ProjectRole, memberId: string) {
    setAssignments((current) => {
      const next = current.filter((item) => item.role !== role);
      return memberId ? [...next, { role, memberId }] : next;
    });
  }

  return <>
    <header className={s.header}>
      <div className={s.identity}>
        <span aria-hidden="true" className={s.mark}>{initials(state.customer || state.name)}</span>
        <div className={s.copy}>
          <div className={s.titleRow}>
            <h1>{state.name}</h1>
            <StateBadge state={d.phase} />
            {controls.onHold ? <Badge tone="warning">On hold</Badge> : controls.risk !== "on_track" ? <Badge tone={riskTone(controls.risk)}>{label(controls.risk)}</Badge> : null}
          </div>
          <p className={s.meta}>
            <span>{state.customer}</span>
            <span><Link className={s.caseLink} href={`/workspace/pre-projects/cases/${state.caseId}/overview`}>Source case</Link></span>
            {controls.reference ? <span>{controls.reference}</span> : null}
            <span>{progress}% complete</span>
            {controls.handoverDate ? <span data-overdue={handoverDays !== null && handoverDays < 0 || undefined}>Handover {shortDate(controls.handoverDate)}{handoverDays !== null ? ` · ${daysLabel(handoverDays)}` : ""}</span> : null}
          </p>
        </div>
      </div>
      <div className={s.actions}>
        <span className={s.status} role="status">{busy ? "Saving…" : status}</span>
        {primary}
        <MenuButton items={menu} label="More" onAction={(id) => {
          if (id === "controls") openControls();
          else if (id === "roles") openRoles();
          else if (id === "refresh") onRefresh();
        }} />
      </div>
    </header>

    {controls.onHold ? <div className={s.hold}><Callout
      actions={state.canManage ? <Button onPress={openControls} size="compact">Update hold</Button> : undefined}
      title="Project on hold"
      tone="warning"
    >{[controls.holdReason, controls.holdOwnerId ? `Owner ${person(controls.holdOwnerId)}` : "", controls.holdSince ? `Since ${shortDate(controls.holdSince)}` : ""].filter(Boolean).join(" · ") || "New task starts are paused until the hold is released."}</Callout></div> : null}

    <ControlledModalDialog isOpen={dialog === "controls"} onOpenChange={(open) => !open && setDialog("")} size="lg" title="Project controls">
      <Form className={s.form} onSubmit={async (event) => { event.preventDefault(); if (await run("project_controls", { controls: draft })) setDialog(""); }}>
        <div className={s.grid}>
          <TextInput isRequired label="Project / work-order reference" onChange={(value) => setDraft({ ...draft, reference: value })} value={draft.reference} />
          <SelectField items={[{ id: "normal", label: "Normal" }, { id: "high", label: "High" }, { id: "critical", label: "Critical" }]} label="Priority" onSelectionChange={(key) => key && setDraft({ ...draft, priority: String(key) as ProjectControlSummary["priority"] })} selectedKey={draft.priority} />
          <SelectField items={[{ id: "on_track", label: "On track" }, { id: "get_ready", label: "Get ready" }, { id: "urgent_action", label: "Urgent action" }, { id: "high_risk", label: "High risk" }]} label="Risk" onSelectionChange={(key) => key && setDraft({ ...draft, risk: String(key) as ProjectControlSummary["risk"] })} selectedKey={draft.risk} />
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
        <div className={s.check}><Checkbox isSelected={draft.onHold} onChange={(checked) => setDraft({ ...draft, onHold: checked })}>Place project on hold</Checkbox><small>This pauses new task starts and shows the hold on the project until it is released.</small></div>
        {draft.onHold ? <div className={s.grid}>
          <SelectField isRequired items={people} label="Hold owner" onSelectionChange={(key) => setDraft({ ...draft, holdOwnerId: key ? String(key) : "" })} placeholder="Choose owner" selectedKey={draft.holdOwnerId || null} />
          <TextAreaField isRequired label="Hold reason" onChange={(value) => setDraft({ ...draft, holdReason: value })} value={draft.holdReason} />
        </div> : null}
        <div className={s.submit}><Button isLoading={busy} type="submit" variant="primary">Save project controls</Button></div>
      </Form>
    </ControlledModalDialog>

    <ControlledModalDialog isOpen={dialog === "roles"} onOpenChange={(open) => !open && setDialog("")} size="lg" title="Project team roles">
      <Form className={s.form} onSubmit={async (event) => { event.preventDefault(); if (await run("project_roles", { assignments })) setDialog(""); }}>
        <div className={s.roles}>{roles.map((role) => {
          const assigned = assignments.find((item) => item.role === role.id)?.memberId ?? "unassigned";
          return <SelectField items={[{ id: "unassigned", label: "Unassigned" }, ...people]} key={role.id} label={role.label} onSelectionChange={(key) => updateRole(role.id, key === "unassigned" ? "" : String(key ?? ""))} selectedKey={assigned} />;
        })}</div>
        <div className={s.submit}><Button isLoading={busy} type="submit" variant="primary">Save team roles</Button></div>
      </Form>
    </ControlledModalDialog>
  </>;
}
