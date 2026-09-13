"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CircleAlert, Sparkles } from "lucide-react";
import { Button, InspectorSheet } from "@/design-system";
import { bookingIssues, dateLabel, planTeams, readinessIssues, statusLabels, suitableTeams, trades, validDate, workDays, type PlanTask, type WorkStatus } from "@/lib/projects/planning";
import colors from "@/components/crm/crm-workspace-colors.module.css";
import styles from "./plan-teams.module.css";

export function PlanTaskEditor({ initial, tasks, isNew, onSave, onClose }: { initial: PlanTask; tasks: PlanTask[]; isNew: boolean; onSave: (task: PlanTask) => string[]; onClose: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (errors.length) errorRef.current?.focus(); }, [errors]);
  const update = <K extends keyof PlanTask>(key: K, value: PlanTask[K]) => { setDraft(current => ({ ...current, [key]: value })); setErrors([]); };
  const validDates = validDate(draft.start) && validDate(draft.end) && draft.start <= draft.end;
  const issues = validDates ? bookingIssues(draft, tasks) : ["Choose valid dates to check availability."];
  const readiness = readinessIssues(draft, tasks);
  const suggestions = validDates && issues.length ? suitableTeams(draft, tasks).filter(t => t.id !== draft.teamId) : [];
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const save = (status: WorkStatus) => setErrors(onSave({ ...draft, status }));
  const nextStatus = draft.status === "draft" ? "booked" : draft.status;
  const cannotBook = issues.length > 0 || ((nextStatus === "in-progress" || nextStatus === "complete") && readiness.length > 0);

  return <InspectorSheet isOpen size="md" isDirty={dirty} onOpenChange={open => { if (!open) onClose(); }} title={isNew ? "Plan work" : draft.title || "Edit work package"} description={`${isNew ? "New work package" : initial.boq} · Jumeirah villa interiors`} footer={<div className={`${styles.editorFooter} ${colors.theme}`}>
    <span>{draft.status === "draft" ? "Drafts do not reserve a team." : "Changes update the team’s booking."}</span>
    <div>{draft.status === "draft" && <Button onPress={() => save("draft")}>Save draft</Button>}<Button className={styles.primary} isDisabled={cannotBook} onPress={() => save(nextStatus)}>{draft.status === "draft" ? "Confirm booking" : "Save changes"}<ArrowRight size={15} data-directional="true" /></Button></div>
  </div>}>
    <div className={`${styles.editor} ${colors.theme}`}>
      {errors.length > 0 && <div role="alert" tabIndex={-1} ref={errorRef} className={styles.validation}><strong>Check before saving</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
      <div className={styles.editorSection}><h3><span>01</span> Define the work</h3>
        <label>Task name<input autoFocus value={draft.title} maxLength={120} placeholder="e.g. Living room ceiling framework" onChange={e => update("title", e.target.value)} /></label>
        <div className={styles.fieldPair}><label>BOQ reference<input value={draft.boq} maxLength={40} placeholder="e.g. FIN-01" onChange={e => update("boq", e.target.value)} /></label><label>Area / room<input value={draft.area} maxLength={80} placeholder="e.g. Ground floor" onChange={e => update("area", e.target.value)} /></label></div>
        <div className={styles.fieldPair}><label>Trade<select value={draft.trade} onChange={e => { setDraft({ ...draft, trade: e.target.value as PlanTask["trade"], teamId: "" }); setErrors([]); }}>{trades.map(trade => <option key={trade}>{trade}</option>)}</select></label><label>Work location<select value={draft.kind} onChange={e => { setDraft({ ...draft, kind: e.target.value as PlanTask["kind"], teamId: "" }); setErrors([]); }}><option value="site">Site</option><option value="factory">Factory</option></select></label></div>
      </div>
      <div className={styles.editorSection}><h3><span>02</span> Schedule & assign</h3>
        <div className={styles.fieldPair}><label>Start date<input type="date" value={draft.start} onChange={e => update("start", e.target.value)} /></label><label>Finish date<input type="date" value={draft.end} onChange={e => update("end", e.target.value)} /></label></div>
        {validDates && <p className={styles.fieldHint}>{workDays(draft.start, draft.end).length} working days · Full crew, full day · Sunday off</p>}
        <label>Predecessor<select value={draft.dependencyId} onChange={e => update("dependencyId", e.target.value)}><option value="">None — can run independently</option>{tasks.filter(t => t.id !== draft.id).map(task => <option key={task.id} value={task.id}>{task.title} · ends {dateLabel(task.end)}</option>)}</select></label>
        <label>Assigned team<select value={draft.teamId} onChange={e => update("teamId", e.target.value)}><option value="">Unassigned</option>{planTeams.filter(t => t.trade === draft.trade && t.kind === draft.kind).map(team => <option key={team.id} value={team.id}>{team.name} · {team.size} people</option>)}</select></label>
        {issues.length ? <div className={styles.bookingWarning}><strong><CircleAlert size={16} />{draft.teamId ? "Booking needs review" : "Choose a team"}</strong><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div> : <p className={styles.availabilityGood}><Check size={16} />Team available for the full date range.</p>}
        {suggestions[0] && <div className={styles.suggestion}><Sparkles size={17} /><div><strong>{suggestions[0].name} is available</strong><small>Matching trade · {suggestions[0].size} people · No booking overlap</small></div><Button size="compact" onPress={() => update("teamId", suggestions[0].id)}>Use {suggestions[0].name}</Button></div>}
      </div>
      <div className={styles.editorSection}><h3><span>03</span> Track readiness</h3>
        <p className={styles.fieldHint}>Reserve time now. Start work once checks and predecessor work are complete.</p>
        <fieldset className={styles.checks}><legend className={styles.srOnly}>Ready to start checks</legend>
          {([ ["drawings", "Drawings approved"], ["materials", "Materials ready"], ["access", draft.kind === "factory" ? "Factory release confirmed" : "Site access & release confirmed"] ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={draft[key]} onChange={e => update(key, e.target.checked)} /><span>{label}</span></label>)}
        </fieldset>
        <label>Work status<select value={draft.status} onChange={e => { const status = e.target.value as WorkStatus; setDraft({ ...draft, status, progress: status === "complete" ? 100 : status === "in-progress" ? Math.min(draft.progress, 99) : 0 }); setErrors([]); }}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{value === "draft" && initial.status !== "draft" ? "Draft — release booking" : label}</option>)}</select></label>
        {(draft.status === "in-progress" || draft.status === "complete") && readiness.length > 0 && <div className={styles.bookingWarning}><strong>Work cannot start yet</strong><ul>{readiness.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
        {draft.status === "in-progress" && <label>Progress · {draft.progress}%<input type="range" min={0} max={99} value={draft.progress} onChange={e => update("progress", Number(e.target.value))} /></label>}
        <label>Notes<textarea rows={3} maxLength={1200} value={draft.notes} placeholder="Instructions, dependencies or delivery details…" onChange={e => update("notes", e.target.value)} /></label>
      </div>
    </div>
  </InspectorSheet>;
}
