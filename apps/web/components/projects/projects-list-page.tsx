"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Clock3, FolderKanban, Plus, Search, X } from "lucide-react";
import { identityInitials, identityStyle } from "@/lib/brand/identity";
import { DEMO_PROJECT } from "@/lib/projects/demo";
// Use the exact same table styling and content width as Pre-execution.
import styles from "@/components/pre-project/pre-project.module.css";

const projectHref = `${DEMO_PROJECT.root}/overview`;
const filters = [["all", "All"], ["planning", "Planning"], ["active", "In progress"], ["completed", "Completed"]] as const;

export function ProjectsListPage() {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const matches = (status === "all" || status === "planning")
    && `${DEMO_PROJECT.title} ${DEMO_PROJECT.customer}`.toLowerCase().includes(search.trim().toLowerCase());
  const filtered = Boolean(search.trim()) || status !== "all";
  const count = matches ? 1 : 0;
  const clear = () => { setTerm(""); setSearch(""); setStatus("all"); };

  return <section className={`${styles.page} ${styles.preProjectPage} ${styles.projectsPage}`} aria-label="Projects entry">
    <div className={`${styles.content} ${styles.preProjectContent}`}>
      <Link className={styles.backLink} href="/workspace/pre-projects"><ArrowLeft size={16} aria-hidden="true" data-directional="true" />Back to Pre-execution</Link>
      <div className={styles.listPanel}>
        <header className={styles.listHeading}>
          <div>
            <div className={styles.listTitle}><h1>Projects</h1><span className={styles.count} aria-label={`${count} ${filtered ? "matching " : ""}projects`}>{count}</span></div>
            <p>Delivery, procurement, production and handover—in one project workspace.</p>
          </div>
          <Link className={styles.primary} href="/workspace/pre-projects"><Plus size={17} aria-hidden="true" />Start project</Link>
        </header>
        <div className={styles.listBody}>
          <div className={styles.toolbar}>
            <div role="group" aria-label="Project status" className={styles.statusFilters}>
              {filters.map(([id, label]) => <button key={id} type="button" aria-pressed={status === id} onClick={() => setStatus(id)}>{label}</button>)}
            </div>
            <form className={styles.search} onSubmit={(event) => { event.preventDefault(); setSearch(term); }}>
              <Search size={17} aria-hidden="true" />
              <input aria-label="Search projects" placeholder="Search by project or customer…" maxLength={200} value={term} onChange={(event) => setTerm(event.target.value)} />
              {term ? <button type="button" aria-label="Clear search" onClick={() => { setTerm(""); setSearch(""); }}><X size={15} /></button> : null}
              <button type="submit" className={styles.searchSubmit}>Search</button>
            </form>
          </div>
          {matches ? <div className={styles.tableWrap} role="region" aria-label="Project records" tabIndex={0}>
            <table data-record-table="" className={styles.table}>
              <caption className={styles.srOnly}>Projects</caption>
              <colgroup><col className={styles.clientColumn} /><col className={styles.projectColumn} /><col className={styles.managerColumn} /><col className={styles.statusColumn} /><col className={styles.actionColumn} /></colgroup>
              <thead><tr><th scope="col">Client</th><th scope="col">Project</th><th scope="col">Project manager</th><th scope="col">Status</th><th scope="col" className={styles.actionCell}>Action</th></tr></thead>
              <tbody><tr>
                <td><div className={styles.client}><span className={styles.avatar} style={identityStyle(DEMO_PROJECT.customer)} aria-hidden="true">{identityInitials(DEMO_PROJECT.customer)}</span><strong>{DEMO_PROJECT.customer}</strong></div></td>
                <td><Link className={styles.projectLink} href={projectHref}>{DEMO_PROJECT.title}</Link><small className={styles.opened}>Demo project</small></td>
                <td>Not assigned</td>
                <td><span className={`${styles.badge} ${styles.statusBadge}`}><Clock3 size={14} aria-hidden="true" />Planning</span></td>
                <td className={styles.actionCell}><Link className={styles.openAction} aria-label={`Open ${DEMO_PROJECT.title}`} href={projectHref}><ArrowRight size={17} aria-hidden="true" data-directional="true" /></Link></td>
              </tr></tbody>
            </table>
          </div> : <div className={styles.empty}><FolderKanban size={30} aria-hidden="true" /><h2>No matching projects</h2><p>Try another search or clear your filters.</p><button className={styles.control} onClick={clear}>Clear filters</button></div>}
          <footer className={styles.pagination}><span>{count} of {count} {filtered ? "matching " : ""}project{count !== 1 ? "s" : ""}</span><span>Demo preview</span></footer>
        </div>
      </div>
      <p className={styles.previewNotice}>This is a demo preview. Real projects will appear here once execution release is connected in Pre-execution.</p>
    </div>
  </section>;
}
