"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { jsonRequest } from "@/lib/commercial/client";
import { projectPath } from "@/lib/projects/execution";
import type { PortfolioRow } from "../projects/project-portfolio";
import type { PreProjectList } from "@/lib/pre-project/types";
import styles from "./project-shortcuts.module.css";
import { useT } from "@/lib/i18n/i18n-provider";

const changeEvent = "wodana-project-shortcuts";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(changeEvent, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(changeEvent, callback); };
}
type Choice = { id: string; label: string; title: string; href: string };

export function ProjectShortcuts({ workspaceId, pathname, visible, onNavigate }: { workspaceId: string; pathname: string; visible: boolean; onNavigate?: () => void }) {
  const t = useT();
  const key = `wodana:project-shortcuts:${workspaceId}`;
  const stored = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(key) ?? "[]"; } catch { return "[]"; } }, () => "[]");
  const ids = useMemo<string[]>(() => { try { const value = JSON.parse(stored); return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, 30) : []; } catch { return []; } }, [stored]);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const needsChoices = ids.length > 0;
  useEffect(() => {
    if (!needsChoices) return;
    let alive = true;
    async function load() {
      const [execution, planning] = await Promise.allSettled([
        jsonRequest<PortfolioRow[]>(projectPath(workspaceId, "portfolio")),
        (async () => {
          const first = await jsonRequest<PreProjectList>(`/api/workspace/pre-projects?workspaceId=${workspaceId}`);
          const items = [...first.items];
          for (let page = 2; items.length < first.total; page++) {
            const next = await jsonRequest<PreProjectList>(`/api/workspace/pre-projects?workspaceId=${workspaceId}&page=${page}`);
            const fresh = next.items.filter(item => !items.some(existing => existing.id === item.id));
            if (!fresh.length) break;
            items.push(...fresh);
          }
          return items;
        })(),
      ]);
      if (!alive) return;
      const projects = execution.status === "fulfilled" ? execution.value : [];
      const cases = planning.status === "fulfilled" ? planning.value.filter(item => !item.qualifiedLead) : [];
      const linked = new Set(projects.map(project => project.caseId));
      // Persist identifiers only; names and destinations always come from authorized reads.
      setChoices([
        ...projects.map(project => ({ id: project.caseId, title: project.name, label: `${project.name} · ${project.customer}`, href: `/workspace/projects/${project.id}/overview` })),
        ...cases.filter(item => !linked.has(item.id)).map(item => ({ id: item.id, title: item.title, label: `${item.title} · ${item.customerName}`, href: `/workspace/pre-projects/cases/${item.id}/overview` })),
      ]);
    }
    void load();
    return () => { alive = false; };
  }, [workspaceId, needsChoices]);
  function save(next: string[]) {
    try { localStorage.setItem(key, JSON.stringify(next)); window.dispatchEvent(new Event(changeEvent)); return true; }
    catch { return false; }
  }
  if (!ids.length) return null;
  return <div className={styles.shortcuts}>
    {ids.map(id => choices?.find(choice => choice.id === id)).filter((item): item is Choice => Boolean(item)).map(item => <div className={styles.row} key={item.id}>
      <Link href={item.href} title={item.title} aria-current={pathname.startsWith(item.href.replace(/\/overview$/, "")) ? "page" : undefined} tabIndex={visible ? undefined : -1} onClick={onNavigate}>{item.title}</Link>
      <button type="button" aria-label={t("Remove {name} from sidebar", { name: item.title })} tabIndex={visible ? undefined : -1} onClick={() => save(ids.filter(id => id !== item.id))}><X size={12} /></button>
    </div>)}
  </div>;
}
