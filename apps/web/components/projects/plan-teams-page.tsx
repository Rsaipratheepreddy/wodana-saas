"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { ArrowRight, CalendarDays, Check, CheckCheck, CircleAlert, Factory, HardHat, ListTodo, Plus, RotateCcw, Search, Users, X } from "lucide-react";
import { Button, ConfirmationDialog, IconButton, Tabs } from "@/design-system";
import { DataTable } from "@/components/ui";
import { addDays, bookingIssues, dateLabel, decodePlan, DEMO_TODAY, newTask, otherBookings, PLAN_STORAGE_KEY, planTeams, readinessIssues, seedTasks, statusLabels, taskNeedsAttention, teamConflicts, validateTask, workDays, type PlanTask } from "@/lib/projects/planning";
import { PlanTaskEditor } from "./plan-task-editor";
import { TeamAvailability } from "./team-availability";
import colors from "@/components/crm/crm-workspace-colors.module.css";
import styles from "./plan-teams.module.css";

const SEED = JSON.stringify(seedTasks);
const STORE_EVENT = "wodana-demo-plan-change";
function snapshot() { try { return window.localStorage.getItem(PLAN_STORAGE_KEY) ?? SEED; } catch { return SEED; } }
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(STORE_EVENT, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(STORE_EVENT, listener); };
}

export function PlanTeamsPage() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => SEED);
  const decoded = useMemo(() => decodePlan(raw), [raw]);
  const tasks = decoded ?? seedTasks;
  const [tab, setTab] = useState("work");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState<PlanTask | null>(null);
  const [notice, setNotice] = useState("");
  const [reset, setReset] = useState(false);
  const [storageError, setStorageError] = useState("");
  const attention = tasks.filter(t => taskNeedsAttention(t, tasks));
  const clashes = tasks.filter(t => t.status !== "complete" && teamConflicts(t, tasks).length > 0);
  const activeTeams = planTeams.filter(team => tasks.some(t => t.teamId === team.id && t.status !== "draft" && t.start <= DEMO_TODAY && t.end >= DEMO_TODAY) || otherBookings.some(b => b.teamId === team.id && b.start <= DEMO_TODAY && b.end >= DEMO_TODAY));
  const unassigned = tasks.filter(t => !t.teamId && t.status !== "complete");
  const visible = tasks.filter(t => {
    const team = planTeams.find(team => team.id === t.teamId);
    return (kind === "all" || t.kind === kind) &&
      (filter === "all" || (filter === "attention" ? taskNeedsAttention(t, tasks) : filter === "unassigned" ? !t.teamId : t.status === filter)) &&
      `${t.title} ${t.area} ${t.boq} ${team?.name ?? ""}`.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));

  function persist(next: PlanTask[]) {
    try {
      window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(STORE_EVENT));
      setStorageError("");
      return true;
    } catch {
      setStorageError("Your browser could not save this plan. Enable browser storage and try again; your changes are still in the editor.");
      return false;
    }
  }
  function save(task: PlanTask): string[] {
    const latest = decodePlan(snapshot()) ?? seedTasks;
    const original = tasks.find(t => t.id === task.id);
    const current = latest.find(t => t.id === task.id);
    if (current && JSON.stringify(current) !== JSON.stringify(editor) && original) return ["This task changed in another tab. Close and reopen it to use the latest version."];
    const errors = validateTask(task, latest);
    if (errors.length) return errors;
    const clean = { ...task, title: task.title.trim(), boq: task.boq.trim(), area: task.area.trim(), progress: task.status === "complete" ? 100 : task.status === "in-progress" ? Math.min(task.progress, 99) : 0 };
    const next = current ? latest.map(t => t.id === clean.id ? clean : t) : [...latest, clean];
    if (!persist(next)) return ["Changes could not be saved in this browser. Please try again."];
    setEditor(null);
    setNotice(`${clean.title} ${clean.status === "draft" ? "saved as a draft" : clean.status === "booked" ? "booking saved" : "updated"}.`);
    return [];
  }
  function showFilter(value: string) { setTab("work"); setFilter(value); setSearch(""); setKind("all"); }

  return <section className={`${styles.page} ${colors.theme}`} aria-label="Schedules workspace">
    <header className={styles.header}>
      <div><div className={styles.heading}><h1>Schedules</h1><span className={styles.demoBadge}>Demo data</span></div><p>Plan the work. Give every team a clear place in the schedule.</p></div>
      <div className={styles.headerActions}><IconButton aria-label="Reset demo plan" onPress={() => setReset(true)}><RotateCcw size={16} /></IconButton><Button className={styles.primary} onPress={() => setEditor(newTask(crypto.randomUUID()))}><Plus size={16} />Plan work</Button></div>
    </header>

    <div className={styles.metrics} aria-label="Plan summary">
      <button onClick={() => showFilter("all")}><span><ListTodo size={16} />Work packages</span><strong>{tasks.length}<small>{tasks.filter(t => t.status === "complete").length} complete</small></strong></button>
      <button onClick={() => showFilter("in-progress")}><span><HardHat size={16} />In progress</span><strong>{tasks.filter(t => t.status === "in-progress").length}<small>active work packages</small></strong></button>
      <button onClick={() => setTab("teams")}><span><Users size={16} />Teams available</span><strong>{planTeams.length - activeTeams.length}<small>of {planTeams.length} · {dateLabel(DEMO_TODAY)}</small></strong></button>
      <button onClick={() => showFilter("attention")} data-attention={attention.length > 0}><span><CircleAlert size={16} />Needs attention</span><strong>{attention.length}<small>{clashes.length} clash · {unassigned.length} unassigned</small></strong></button>
    </div>

    {clashes[0] ? <div className={styles.insight}>
      <span className={styles.insightIcon}><CalendarDays size={20} /></span>
      <div><strong>A team is needed in two places.</strong><p>{planTeams.find(t => t.id === clashes[0].teamId)?.name} is already booked for {teamConflicts(clashes[0], tasks)[0].project}. Review “{clashes[0].title}” before confirming.</p></div>
      <Button onPress={() => setEditor(clashes[0])}>Resolve clash<ArrowRight size={15} data-directional="true" /></Button>
    </div> : <div className={`${styles.insight} ${styles.resolved}`}><span className={styles.insightIcon}><CheckCheck size={20} /></span><div><strong>No team booking clashes.</strong><p>Confirmed crew bookings fit together across the demo projects. Check readiness before starting work.</p></div><Button variant="quiet" onPress={() => setTab("teams")}>View availability<ArrowRight size={15} data-directional="true" /></Button></div>}

    {notice && <div className={styles.notice} role="status"><Check size={16} /><span>{notice}</span><IconButton aria-label="Dismiss update" onPress={() => setNotice("")}><X size={14} /></IconButton></div>}
    {storageError && <p role="alert" className={styles.error}>{storageError}</p>}
    {!decoded && <p role="alert" className={styles.error}>Saved demo data could not be read. The original seed plan is shown; reset the demo to replace the unreadable data.</p>}

    <Tabs selectedKey={tab} onSelectionChange={setTab} items={[
      { id: "work", label: <><ListTodo size={15} />Work plan<span className={styles.tabCount}>{tasks.length}</span></>, panel: <>
        <div className={styles.toolbar}>
          <label className={styles.search}><Search size={16} aria-hidden="true" /><input aria-label="Search work plan" placeholder="Search work, area or team…" value={search} onChange={e => setSearch(e.target.value)} />{search && <button aria-label="Clear work search" onClick={() => setSearch("")}><X size={14} /></button>}</label>
          <div className={styles.filters}><select aria-label="Work location" value={kind} onChange={e => setKind(e.target.value)}><option value="all">All work</option><option value="site">Site work</option><option value="factory">Factory work</option></select><select aria-label="Work status" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All statuses</option><option value="attention">Needs attention</option><option value="unassigned">Unassigned</option>{Object.entries(statusLabels).map(([key, value]) => <option value={key} key={key}>{value}</option>)}</select></div>
        </div>
        {visible.length ? <div className={styles.workTable}><DataTable caption="Project work plan" getRowKey={t => t.id} rows={visible} columns={[
          { key: "work", header: "Work package", render: t => <button className={styles.taskLink} onClick={() => setEditor(t)}><span className={styles.taskIcon} data-kind={t.kind}>{t.kind === "factory" ? <Factory size={17} /> : <HardHat size={17} />}</span><span><strong>{t.title}</strong><small>{t.boq} · {t.area}</small></span></button> },
          { key: "schedule", header: "Schedule", render: t => <div className={styles.cellStack}><span>{dateLabel(t.start)} – {dateLabel(t.end)}</span><small>{workDays(t.start, t.end).length} working days</small></div> },
          { key: "team", header: "Assigned team", render: t => { const team = planTeams.find(team => team.id === t.teamId); return team ? <div className={styles.teamCell}><span className={styles.avatar}>{team.initials}</span><div className={styles.cellStack}><span>{team.name}</span><small>{team.size} people · {t.status === "draft" ? "Proposed" : t.status === "complete" ? "Completed" : "Reserved"}</small></div></div> : <button className={styles.assign} onClick={() => setEditor(t)}><Plus size={14} />Assign team</button>; } },
          { key: "progress", header: "Progress", render: t => <div className={styles.progress}><span>{t.progress}%</span><div role="progressbar" aria-label={`${t.title} progress`} aria-valuenow={t.progress} aria-valuemin={0} aria-valuemax={100}><i style={{ inlineSize: `${t.progress}%` }} /></div></div> },
          { key: "status", header: "Status / readiness", render: t => <div className={styles.cellStack}><span className={styles.status} data-status={t.status}><i />{statusLabels[t.status]}</span>{t.status !== "complete" && (bookingIssues(t, tasks).length ? <small className={styles.warning}><CircleAlert size={12} />{teamConflicts(t, tasks).length ? "Booking clash" : !t.teamId ? "Team needed" : "Schedule review"}</small> : readinessIssues(t, tasks).length ? <small>{readinessIssues(t, tasks)[0]}</small> : <small className={styles.ready}><Check size={12} />{t.status === "in-progress" ? "Readiness checked" : "Ready to start"}</small>)}</div> },
          { key: "open", header: "", render: t => <IconButton aria-label={`Edit ${t.title}`} size="compact" onPress={() => setEditor(t)}><ArrowRight size={15} data-directional="true" /></IconButton> },
        ]} /></div> : <div className={styles.empty}><Search size={24} /><h2>No work matches these filters</h2><p>Try another task name, area or team.</p><Button onPress={() => showFilter("all")}>Clear filters</Button></div>}
        <footer className={styles.tableFooter}><span>{visible.length} of {tasks.length} work packages</span><span><span className={styles.keyDot} />Full-day team bookings · Sunday off</span></footer>
      </> },
      { id: "teams", label: <><Users size={15} />Team availability<span className={styles.tabCount}>{planTeams.length}</span></>, panel: <TeamAvailability tasks={tasks} onEdit={setEditor} onPlan={(team, start) => setEditor({ ...newTask(crypto.randomUUID()), trade: team.trade, kind: team.kind, teamId: team.id, start, end: addDays(start, 2) })} /> },
    ]} />
    <p className={styles.demoNote}>Seed scenario · 7 September 2026 · Changes save in this browser. Live BOQ, workforce and factory records are not connected yet.</p>
    {editor && <PlanTaskEditor key={editor.id} initial={editor} tasks={tasks} isNew={!tasks.some(t => t.id === editor.id)} onSave={save} onClose={() => setEditor(null)} />}
    <ConfirmationDialog isOpen={reset} onOpenChange={setReset} title="Reset the demo plan?" body="This replaces your edits in this browser with the original eight work packages. Live project data is unaffected." confirmLabel="Reset demo" onConfirm={() => { if (persist(seedTasks)) { setReset(false); setNotice("Original demo plan restored."); } }} />
  </section>;
}
