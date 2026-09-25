"use client";

import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import styles from "../workspace/workspace.module.css";

type Destination = { section: string; label: string; view?: string };
const groupIcons: Record<string, string> = { project: "overview", supply: "materials-procurement", work: "execution", quality: "quality-handover", commercial: "finance-expenses", files: "design" };
const groups: { id: string; label: string; destinations: Destination[] }[] = [
  { id: "project", label: "Project", destinations: [
    { section: "overview", label: "Items" }, { section: "overview", label: "Approvals", view: "approvals" }, { section: "overview", label: "Overview", view: "summary" },
    { section: "boq", label: "BOQ" }, { section: "boq", label: "Designs", view: "designs" },
  ] },
  { id: "supply", label: "Supply", destinations: [
    { section: "material-planning", label: "Requirements & stock" }, { section: "material-planning", label: "Stock transfers", view: "warehouse" },
    { section: "procurement", label: "Orders" }, { section: "procurement", label: "To order", view: "shortages" },
    { section: "procurement", label: "Supplier quotes", view: "enquiries" }, { section: "procurement", label: "Receipts", view: "deliveries" },
    { section: "procurement", label: "Returns", view: "supplier_return" }, { section: "procurement", label: "Suppliers", view: "suppliers" },
  ] },
  { id: "work", label: "Work", destinations: [
    { section: "plan-teams", label: "Tasks" }, { section: "plan-teams", label: "Teams & bookings", view: "teams" },
    { section: "production", label: "Factory" }, { section: "site-work", label: "Site" }, { section: "daily-progress", label: "Daily progress" },
  ] },
  { id: "quality", label: "Quality & handover", destinations: [
    { section: "handover", label: "Completion checks" }, { section: "snagging", label: "Defects & warranty" }, { section: "handover", label: "Handovers", view: "packs" },
  ] },
  { id: "commercial", label: "Budget & payments", destinations: [{ section: "commercial", label: "Budget & payments" }] },
  { id: "files", label: "Files", destinations: [{ section: "documents", label: "Files" }] },
];

export function ProjectPipelineNavigation({ root, section, available }: { root: string; section: string; available: Set<string> }) {
  const params = useSearchParams();
  const currentView = (section === "boq" ? params.get("scopeTab") : params.get("view")) ?? "all";
  const visibleGroups = groups.map(group => ({ ...group, destinations: group.destinations.filter(tab => available.has(tab.section)) })).filter(group => group.destinations.length);
  const active = visibleGroups.find(group => group.destinations.some(tab => tab.section === section));
  const related = active?.destinations ?? [];
  // Specialist filters (e.g. factory dispatch) still belong to their section.
  const selected = related.find(tab => tab.section === section && (tab.view ?? "all") === currentView)
    ?? related.find(tab => tab.section === section && !tab.view);
  const href = (tab: Destination) => `${root}/${tab.section}${tab.view ? `?${tab.section === "boq" ? "scopeTab" : "view"}=${tab.view}` : ""}`;
  return <div className={styles.flowHeader} data-module="projects">
    <nav aria-label="Project sections" className={styles.flowTabScroll}>
      {visibleGroups.map(group => <Link key={group.id} href={href(group.destinations[0])} className={styles.flowTab} aria-current={active?.id === group.id ? "page" : undefined}><Image src={`/icons/projects/${groupIcons[group.id]}.svg`} width={20} height={20} alt="" unoptimized/>{group.label}</Link>)}
    </nav>
    {related.length > 1 && <nav aria-label="Section views" className={styles.flowTabScroll}>
      {related.map(tab => <Link key={`${tab.section}:${tab.view ?? "all"}`} href={href(tab)} className={styles.flowTab} aria-current={tab === selected ? "page" : undefined}>{tab.label}</Link>)}
    </nav>}
  </div>;
}
