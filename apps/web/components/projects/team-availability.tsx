"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Factory, HardHat, Plus } from "lucide-react";
import { Button, IconButton } from "@/design-system";
import { addDays, dateLabel, DEMO_TODAY, isWorkingDay, otherBookings, planTeams, workDays, type PlanTask, type PlanTeam } from "@/lib/projects/planning";
import styles from "./plan-teams.module.css";

export function TeamAvailability({ tasks, onEdit, onPlan }: { tasks: PlanTask[]; onEdit: (task: PlanTask) => void; onPlan: (team: PlanTeam, start: string) => void }) {
  const [week, setWeek] = useState(DEMO_TODAY);
  const [location, setLocation] = useState("all");
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const end = days[6];
  const teams = planTeams.filter(team => location === "all" || team.kind === location);
  return <div>
    <div className={styles.availabilityToolbar}><div className={styles.weekControls}><IconButton aria-label="Previous week" onPress={() => setWeek(addDays(week, -7))}><ChevronLeft size={16} data-directional="true" /></IconButton><strong>{dateLabel(week)} – {dateLabel(end)}, {week.slice(0, 4)}</strong><IconButton aria-label="Next week" onPress={() => setWeek(addDays(week, 7))}><ChevronRight size={16} data-directional="true" /></IconButton><Button size="compact" variant="quiet" onPress={() => setWeek(DEMO_TODAY)}>Demo week</Button></div><select aria-label="Team location" value={location} onChange={e => setLocation(e.target.value)}><option value="all">All teams</option><option value="site">Site teams</option><option value="factory">Factory teams</option></select></div>
    <div className={styles.legend}><span><i data-tone="project" />This project</span><span><i data-tone="other" />Other projects</span><span><i data-tone="draft" />Proposed · not reserved</span><span><i data-tone="leave" />Time off</span></div>
    <div className={styles.timelineScroll} role="region" aria-label="Weekly team bookings" tabIndex={0}>
      <div className={styles.timeline}>
        <div className={styles.timelineHead}><span><CalendarDays size={14} aria-hidden="true" />{teams.length} teams · across projects</span><div>{days.map(day => <div key={day} data-today={day === DEMO_TODAY} data-off={!isWorkingDay(day)}><small>{new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))}</small><strong>{dateLabel(day, false)}</strong></div>)}</div></div>
        {teams.map(team => {
          const entries = [
            ...otherBookings.filter(b => b.teamId === team.id).map(b => ({ ...b, tone: b.type === "leave" ? "leave" : "other", task: null as PlanTask | null })),
            ...tasks.filter(t => t.teamId === team.id).map(t => ({ ...t, project: "Jumeirah villa interiors", tone: t.status === "draft" ? "draft" : "project", task: t as PlanTask | null })),
          ].filter(b => b.start <= end && b.end >= week && workDays(b.start > week ? b.start : week, b.end < end ? b.end : end).length > 0).sort((a, b) => a.start.localeCompare(b.start));
          return <div className={styles.resourceRow} key={team.id}>
            <div className={styles.resourceName}><span className={styles.avatar}>{team.initials}</span><div><strong>{team.name}</strong><small>{team.kind === "factory" ? <Factory size={11} /> : <HardHat size={11} />}{team.size} people · {team.lead}</small></div><IconButton aria-label={`Plan work for ${team.name}`} size="compact" onPress={() => onPlan(team, week)}><Plus size={14} /></IconButton></div>
            <div className={styles.resourceCalendar}>
              <div className={styles.dayGrid} aria-hidden="true">{days.map(day => <span key={day} data-today={day === DEMO_TODAY} data-off={!isWorkingDay(day)} />)}</div>
              {entries.length ? entries.map(entry => {
                const bookedDays = workDays(entry.start < week ? week : entry.start, entry.end > end ? end : entry.end);
                const first = bookedDays[0];
                const last = bookedDays.at(-1)!;
                const startIndex = days.indexOf(first) + 1;
                const endIndex = days.indexOf(last) + 2;
                const title = `${entry.title} · ${entry.project} · ${dateLabel(entry.start)} to ${dateLabel(entry.end)}${entry.tone === "draft" ? " · Proposed, not reserved" : ""}`;
                return <div className={styles.bookingTrack} key={entry.id}><button className={styles.booking} data-tone={entry.tone} style={{ gridColumn: `${startIndex} / ${endIndex}` }} aria-label={title} title={title} disabled={!entry.task} onClick={() => { if (entry.task) onEdit(entry.task); }}><strong>{entry.title}</strong><small>{entry.tone === "draft" ? "Proposed" : entry.project === "Jumeirah villa interiors" ? "This project" : entry.project}</small></button></div>;
              }) : <div className={styles.availableRow}>Available this week<Button size="compact" variant="quiet" onPress={() => onPlan(team, week)}>Plan work<Plus size={13} /></Button></div>}
            </div>
          </div>;
        })}
      </div>
    </div>
    <p className={styles.timelineHint}><CalendarDays size={14} />Click this project’s booking to edit. External bookings are read-only. Each booking reserves the whole team on working days.</p>
  </div>;
}
