"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { IconButton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { useProjectFormat } from "../project-core/format";
import styles from "./operations.module.css";

export type ProjectRef = { id: string; reference: string; name?: string | null };

/** A project's page. */
export const projectHref = (projectId: string, section?: string) => `/workspace/projects/${projectId}${section ? `/${section}` : ""}`;

/**
 * The project a Purchasing, Inventory or Factory list is narrowed to (`?project=`), as the project's own
 * stage links open them. Changing it keeps the rest of the address.
 */
export function useProjectFilter() {
  const params = useSearchParams();
  const [projectId, setProject] = useState<string | null>(() => params.get("project"));
  const set = useCallback((next: string | null) => {
    setProject(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("project", next); else url.searchParams.delete("project");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);
  return [projectId, set] as const;
}

/** A link within the module that keeps the project the list is narrowed to. */
export function withProject(href: string, projectId: string | null) {
  if (!projectId) return href;
  return `${href}${href.includes("?") ? "&" : "?"}project=${encodeURIComponent(projectId)}`;
}

/** "PRJ-0007 ×": the project a list shows, removable. */
export function ProjectFilterChip({ project, onClear }: { project: ProjectRef | null; onClear: () => void }) {
  const t = useT();
  if (!project) return null;
  return <span className={styles.filterChip}>
    <span><strong>{project.reference}</strong>{project.name ? ` · ${project.name}` : ""}</span>
    <IconButton aria-label={t("Show every project")} size="compact" variant="quiet" onPress={onClear}><X aria-hidden="true" size={12} /></IconButton>
  </span>;
}

/** The projects a row is for, each a link to the project. */
export function ProjectLinks({ projects }: { projects: ProjectRef[] }) {
  if (!projects.length) return <span className={styles.empty}>—</span>;
  return <span className={styles.projects}>{projects.map((project) => <Link key={project.id} className={styles.projectLink} href={projectHref(project.id)}
    title={project.name ?? undefined} onClick={(event) => event.stopPropagation()}>{project.reference}</Link>)}</span>;
}

/** The won deals a row is for (an order bought for a client's furniture), each linking to its deal. */
export function DealLinks({ deals }: { deals: Array<{ id: string; reference: string }> }) {
  return <span className={styles.projects}>{deals.map((deal) => <Link key={deal.id} className={styles.projectLink} href={`/workspace/crm/opportunities?record=${deal.id}`}
    onClick={(event) => event.stopPropagation()}>{deal.reference}</Link>)}</span>;
}

/** A date and how far it is from today; late in the danger tone (with the words, never colour alone). */
export function DueText({ date, done = false, prefix }: { date: string | null; done?: boolean; prefix?: string }) {
  const format = useProjectFormat();
  if (!date) return <span className={styles.empty}>—</span>;
  const until = done ? null : format.until(date);
  return <span className={styles.cell}>
    <span className={styles.number}>{prefix ? `${prefix} ${format.short(date)}` : format.short(date)}</span>
    {until ? <small data-tone={until.late ? "danger" : undefined}>{until.text}</small> : null}
  </span>;
}

/** Two lines in one cell: what it is, then what else says which. */
export function Cell({ title, meta, tone, children }: { title: ReactNode; meta?: ReactNode; tone?: "danger" | "warning" | "success" | "info"; children?: ReactNode }) {
  return <span className={styles.cell}><span>{title}</span>{meta ? <small data-tone={tone}>{meta}</small> : null}{children}</span>;
}

/** The one next step on an opened record: what happens next and whose it is, with its action when it's the viewer's. */
export function NextStep({ title, detail, tone, actions }: { title: string; detail?: string | null; tone?: "danger" | "warning"; actions?: ReactNode }) {
  const t = useT();
  return <div className={styles.nextStep} data-tone={tone} role="status" aria-label={t("Next step")}>
    <div><strong>{title}</strong>{detail ? <small>{detail}</small> : null}</div>
    {actions ? <span>{actions}</span> : null}
  </div>;
}

/** A titled part of an opened record, with an optional action beside its title. */
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className={styles.section} aria-label={title}>
    <div className={styles.sectionHead}><h3>{title}</h3>{action}</div>
    {children}
  </section>;
}

export { styles as operationsStyles };
