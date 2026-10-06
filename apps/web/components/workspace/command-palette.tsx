"use client";

import type { WorkspaceSearchKind, WorkspaceSearchResponse } from "@wodana/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, CalendarPlus, FileText, ListTodo, Plus, Search, Sparkles, type LucideIcon } from "lucide-react";
import { ControlledModalDialog, SearchInput } from "@/design-system";
import { useWoddy } from "@/components/crm/woddy-chat";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { loadAiSettings } from "@/lib/workspace/ai-settings";
import { meetsRule, type AccessContext, type AccessRule } from "@/lib/workspace/access";
import type { WorkspaceModuleDefinition } from "./workspace-navigation";
import styles from "./command-palette.module.css";

type Group = "woddy" | "actions" | "pages" | "records";
export type PaletteItem = { id: string; group: Group; label: string; detail?: string; icon: LucideIcon; href?: string; run?: () => void };

const GROUP_LABELS: Record<Group, MessageKey> = { woddy: tKey("Woddy"), actions: tKey("Create"), pages: tKey("Go to"), records: tKey("Records") };
const KIND_LABELS: Record<WorkspaceSearchKind, MessageKey> = {
  customer: tKey("Customer"), job: tKey("Job"), room: tKey("Room"), quotation: tKey("Quotation"), project: tKey("Project"),
};

/** Quick creates, each only for someone who may do it (the same permission its form needs). */
const ACTIONS: Array<{ id: string; label: MessageKey; href: string; rule: AccessRule; icon: LucideIcon }> = [
  { id: "new-enquiry", label: tKey("New enquiry"), href: "/workspace/crm/leads?create=true", rule: [["crm.leads.manage"]], icon: Plus },
  { id: "new-follow-up", label: tKey("Add follow-up"), href: "/workspace/crm/follow-ups?create=true", rule: [["crm.activities.manage"]], icon: CalendarPlus },
  { id: "new-task", label: tKey("Add task"), href: "/workspace/crm/follow-ups?view=activity&create=true", rule: [["crm.activities.manage"]], icon: ListTodo },
  { id: "start-planning", label: tKey("Start planning"), href: "/workspace/pre-projects", rule: [["pre_projects.create"]], icon: FileText },
];

/** Every page the person's navigation offers (already narrowed to what they can open), once each. */
export function paletteDestinations(modules: WorkspaceModuleDefinition[]) {
  const seen = new Set<string>();
  const pages: Array<{ id: string; label: string; href: string }> = [];
  for (const workspaceModule of modules) for (const section of workspaceModule.navigation) for (const item of section.items)
    for (const page of [item, ...(item.children ?? [])]) {
      if (seen.has(page.href)) continue;
      seen.add(page.href);
      pages.push({ id: page.id, label: page.label, href: page.href });
    }
  return pages;
}

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const subscribe = () => () => {};
import { inOverlay, isTypingTarget } from "@/lib/keyboard/typing-target";

/**
 * ⌘K (Ctrl K elsewhere) from anywhere in the workspace: find a record, jump to a page, start something new, or
 * hand the words to Woddy. Keyboard first: type, arrow up or down, Enter; Escape closes.
 */
export function CommandPalette({ workspaceId, modules, access }: { workspaceId: string; modules: WorkspaceModuleDefinition[]; access: AccessContext }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const mac = useSyncExternalStore(subscribe, isMac, () => true);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "k") return;
      // A page's own ⌘K (the quote builder's assistant) wins, and typing in a dialog or side panel field is left alone.
      if (event.defaultPrevented || (isTypingTarget(event.target) && inOverlay(event.target))) return;
      event.preventDefault(); setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const shortcut = mac ? "⌘K" : "Ctrl K";
  return <>
    <button type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-keyshortcuts={mac ? "Meta+K" : "Control+K"} aria-label={t("Search and act ({shortcut})", { shortcut })}>
      <Search aria-hidden="true" size={15} /><span className={styles.triggerLabel}>{t("Search")}</span><kbd className={styles.kbd} dir="ltr">{shortcut}</kbd>
    </button>
    {open ? <Palette workspaceId={workspaceId} modules={modules} access={access} onClose={() => setOpen(false)} /> : null}
  </>;
}

function Palette({ workspaceId, modules, access, onClose }: { workspaceId: string; modules: WorkspaceModuleDefinition[]; access: AccessContext; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const woddy = useWoddy();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<{ query: string; items: PaletteItem[]; failed: boolean } | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const canAsk = Boolean(woddy?.ask) && meetsRule([["ai.suggestions.use"]], access);
  useEffect(() => {
    if (!canAsk) return;
    let alive = true;
    void loadAiSettings(workspaceId).then((settings) => { if (alive) setAiOn(Boolean(settings?.enabled && settings.available !== false)); });
    return () => { alive = false; };
  }, [workspaceId, canAsk]);

  const normalized = query.trim();
  useEffect(() => {
    if (normalized.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ workspaceId, q: normalized, limit: "8" });
        const response = await fetch(`/api/workspace/search?${params}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("search");
        const payload = await response.json() as WorkspaceSearchResponse;
        setRecords({ query: normalized, failed: false, items: payload.items.map((item) => ({ id: `record:${item.kind}:${item.id}`, group: "records" as const, label: item.title,
          detail: [t(KIND_LABELS[item.kind]), item.reference, item.subtitle].filter(Boolean).join(" · "), icon: Search, href: item.route })) });
      } catch { if (!controller.signal.aborted) setRecords({ query: normalized, failed: true, items: [] }); }
    }, 160);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [normalized, workspaceId, t]);

  const pages = useMemo(() => paletteDestinations(modules), [modules]);
  const items = useMemo<PaletteItem[]>(() => {
    const needle = normalized.toLocaleLowerCase();
    const matches = (label: string) => !needle || label.toLocaleLowerCase().includes(needle);
    const ask: PaletteItem[] = aiOn && canAsk && normalized ? [{ id: "woddy", group: "woddy", label: t("Ask Woddy: {question}", { question: normalized }), icon: Sparkles,
      run: () => woddy?.ask(normalized) }] : [];
    const actions = ACTIONS.filter((action) => meetsRule(action.rule, access)).map((action) => ({ id: `action:${action.id}`, group: "actions" as const, label: t(action.label), icon: action.icon, href: action.href }))
      .filter((action) => matches(action.label));
    const destinations = pages.map((page) => ({ id: `page:${page.id}`, group: "pages" as const, label: t(page.label as never), icon: ArrowRight, href: page.href }))
      .filter((page) => matches(page.label)).slice(0, needle ? 8 : 6);
    const found = normalized.length >= 2 && records?.query === normalized ? records.items : [];
    return [...(needle ? [...found, ...ask] : []), ...actions, ...destinations, ...(needle ? [] : ask)];
  }, [normalized, records, pages, access, aiOn, canAsk, woddy, t]);
  const current = Math.min(active, Math.max(items.length - 1, 0));

  const activate = useCallback((item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    if (item.run) item.run(); else if (item.href) router.push(item.href);
  }, [onClose, router]);

  const optionRef = useRef<Map<string, HTMLElement>>(new Map());
  useEffect(() => { optionRef.current.get(items[current]?.id ?? "")?.scrollIntoView?.({ block: "nearest" }); }, [current, items]);

  const searching = normalized.length >= 2 && records?.query !== normalized;
  return <ControlledModalDialog isOpen hideTitle size="md" title={t("Search and act")} onOpenChange={(value) => { if (!value) onClose(); }} className={styles.dialog}>
    <div className={styles.palette}>
      <SearchInput autoFocus label={t("Search records, pages and actions")} placeholder={t("Search or type a command…")} value={query}
        onChange={(value) => { setQuery(value); setActive(0); }}
        aria-controls={listId} aria-autocomplete="list" aria-activedescendant={items[current] ? `${listId}-${current}` : undefined}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, items.length - 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
          else if (event.key === "Enter") { event.preventDefault(); activate(items[current]); }
        }} />
      <ul id={listId} role="listbox" aria-label={t("Results")} className={styles.list}>
        {items.map((item, index) => {
          const first = index === 0 || items[index - 1].group !== item.group;
          const Icon = item.icon;
          return <li key={item.id} role="presentation">
            {first ? <span className={styles.group} aria-hidden="true">{t(GROUP_LABELS[item.group])}</span> : null}
            <div id={`${listId}-${index}`} role="option" aria-selected={index === current} className={styles.option} data-group={item.group}
              ref={(element) => { if (element) optionRef.current.set(item.id, element); else optionRef.current.delete(item.id); }}
              onMouseMove={() => setActive(index)} onClick={() => activate(item)}>
              <Icon aria-hidden="true" size={15} />
              <span className={styles.optionText}><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</span>
            </div>
          </li>;
        })}
      </ul>
      {searching ? <p className={styles.status} role="status">{t("Searching…")}</p>
        : !items.length ? <p className={styles.status} role="status">{records?.failed ? t("Workspace search could not be loaded.") : t("No matches")}</p> : null}
      <p className={styles.hint} aria-hidden="true">{t("↑ ↓ to move · Enter to open · Esc to close")}</p>
    </div>
  </ControlledModalDialog>;
}
