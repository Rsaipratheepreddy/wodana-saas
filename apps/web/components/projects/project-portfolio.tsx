"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search, ArrowRight, ArrowLeft, FolderKanban } from "lucide-react";
import { ControlledModalDialog } from "@/design-system";
import { identityInitials, identityStyle } from "@/lib/brand/identity";
import { jsonRequest } from "@/lib/commercial/client";
import { projectPath, label } from "@/lib/projects/execution";
import s from "@/components/pre-project/pre-project.module.css";
import ui from "./project-workspace.module.css";
export type PortfolioRow = {
  id: string;
  caseId: string;
  name: string;
  customer: string;
  phase: string;
  manager: string | null;
  reference: string;
  priority: string;
  risk: string;
  onHold: boolean;
  handoverDate: string;
  nextAction: string;
  nextActionDate: string;
};
export function ProjectPortfolio({
  workspaceId,
  rows,
  today,
}: {
  workspaceId: string;
  rows: PortfolioRow[];
  today: string;
}) {
  const router = useRouter(),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [open, setOpen] = useState(false),
    [cases, setCases] = useState<
      { id: string; title: string; customer: string }[]
    >([]),
    [caseId, setCaseId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const visible = rows.filter(
    (r) =>
      (status === "all" || r.phase === status) &&
      `${r.name} ${r.customer}`.toLowerCase().includes(search.toLowerCase()),
  );
  const handoverLimit = new Date(`${today}T12:00:00Z`);
  handoverLimit.setUTCDate(handoverLimit.getUTCDate() + 30);
  const handoverLimitDay = handoverLimit.toISOString().slice(0, 10),
    metrics = [
      ["High risk", rows.filter((row) => ["high_risk", "urgent_action"].includes(row.risk)).length],
      ["On hold", rows.filter((row) => row.onHold).length],
      ["Overdue actions", rows.filter((row) => row.nextActionDate && row.nextActionDate < today).length],
      ["Handover next 30 days", rows.filter((row) => row.handoverDate && row.handoverDate >= today && row.handoverDate <= handoverLimitDay).length],
    ] as const;
  async function start() {
    setOpen(true);
    setBusy(true);
    setError("");
    try {
      setCases(await jsonRequest(projectPath(workspaceId, "candidates")));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`${s.page} ${s.preProjectPage} ${s.projectsPage}`}>
      <div className={`${s.content} ${s.preProjectContent}`}>
        <Link className={s.backLink} href="/workspace/pre-projects">
          <ArrowLeft size={16} />
          Back to Pre-execution
        </Link>
        <div className={s.listPanel}>
          <header className={s.listHeading}>
            <div className={s.listTitle}>
              <h1>Projects</h1>
              <span className={s.count}>{visible.length}</span>
            </div>
            <button className={s.primary} onClick={() => void start()}>
              <Plus size={16} />
              Start project
            </button>
          </header>
          <div className={s.listBody}>
            <div className={ui.portfolioMetrics}>{metrics.map(([name,value])=><div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div>
            <div className={s.toolbar}>
              <div className={s.statusFilters} role="group" aria-label="Project status">
                {["all", "planning", "active", "handover", "completed"].map(
                  (id) => (
                    <button
                      key={id}
                      aria-pressed={status === id}
                      onClick={() => setStatus(id)}
                    >
                      {id === "active" ? "In progress" : label(id)}
                    </button>
                  ),
                )}
              </div>
              <label className={s.search}>
                <Search size={16} />
                <input
                  aria-label="Search projects"
                  placeholder="Search project or customer…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            </div>
            <div
              className={s.tableWrap}
              tabIndex={0}
              role="region"
              aria-label="Project records"
            >
              <table data-record-table="" className={s.table} aria-label="Projects">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Project</th>
                    <th>Project manager</th>
                    <th>Control</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className={s.client}>
                          <span
                            className={s.avatar}
                            style={identityStyle(r.customer)}
                          >
                            {identityInitials(r.customer)}
                          </span>
                          <strong>{r.customer}</strong>
                        </div>
                      </td>
                      <td>
                        <Link
                          className={ui.link}
                          href={`/workspace/projects/${r.id}/overview`}
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td>{r.manager || "Not assigned"}</td>
                      <td><span className={ui.status} data-state={r.onHold ? "blocked" : r.risk}>{r.onHold ? "On hold" : label(r.risk)}</span><small className={ui.detail}>{r.nextAction || "Next action not set"}{r.nextActionDate ? ` · ${r.nextActionDate}` : ""}</small></td>
                      <td>
                        <span className={ui.status} data-state={r.phase}>
                          {label(r.phase)}
                        </span>
                      </td>
                      <td>
                        <Link
                          className={ui.icon}
                          href={`/workspace/projects/${r.id}/overview`}
                          aria-label={`Open ${r.name}`}
                        >
                          <ArrowRight size={18} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && (
                <div className={ui.empty}>
                  <FolderKanban size={30} aria-hidden="true" />
                  <h2>
                    {rows.length
                      ? "No matching projects"
                      : "Start with your agreed scope"}
                  </h2>
                  <p>
                    Create a planning workspace from Pre-execution. Execution
                    begins when its release checklist is complete.
                  </p>
                  {rows.length ? <button type="button" className={s.control} onClick={() => { setSearch(""); setStatus("all"); }}>Clear filters</button> : null}
                </div>
              )}
            </div>
            <div className={ui.footer}>
              <span>
                {visible.length} of {rows.length} projects
              </span>
              <span>Connected to Pre-execution</span>
            </div>
          </div>
        </div>
      </div>
      <ControlledModalDialog
        isOpen={open}
        onOpenChange={setOpen}
        title="Start project"
      >
        <form
          className={ui.form}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const p = await jsonRequest<{ id: string }>(
                projectPath(workspaceId, "planning"),
                "POST",
                { caseId },
              );
              router.push(`/workspace/projects/${p.id}/plan-teams`);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <p className={ui.muted}>
            Choose an active Pre-execution. You can plan tasks and teams now;
            purchasing and execution stay gated by the release checklist.
          </p>
          {error && (
            <p role="alert" className={ui.error}>
              {error}
            </p>
          )}
          <label>
            Pre-execution
            <select
              required
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
            >
              <option value="">Select pre-execution…</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} · {c.customer}
                </option>
              ))}
            </select>
          </label>
          <button className={ui.primary} disabled={busy || !caseId}>
            Create planning workspace
          </button>
          {!busy && !cases.length && !error && (
            <p className={ui.muted}>
              All active Pre-execution already have a project, or none are
              available.
            </p>
          )}
        </form>
      </ControlledModalDialog>
    </section>
  );
}
