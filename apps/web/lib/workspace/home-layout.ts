/** Attendance is not a widget: today's status is a chip in the Home header. */
export const homeWidgetIds = ["attention", "projects", "trend", "money", "health", "planning", "activity", "storage", "sales", "tools"] as const;
export type HomeWidgetId = typeof homeWidgetIds[number];
export const homeWidgetSizes = ["small", "medium", "wide"] as const;
export type HomeWidgetSize = typeof homeWidgetSizes[number];
/** `wide` mirrors `size === "wide"` so layouts stay readable by older clients. */
export type HomeWidget = { id: HomeWidgetId; visible: boolean; size: HomeWidgetSize; wide: boolean };

/** Grid columns each size spans on the three-column Home grid. */
export const homeWidgetSpan: Record<HomeWidgetSize, number> = { small: 1, medium: 2, wide: 3 };

const widget = (id: HomeWidgetId, size: HomeWidgetSize, visible = true): HomeWidget => ({ id, visible, size, wide: size === "wide" });
const baseSize: Record<HomeWidgetId, HomeWidgetSize> = {
  attention: "medium", projects: "small", trend: "medium", money: "small", health: "small", planning: "small",
  activity: "small", storage: "small", sales: "small", tools: "small",
};

export const defaultHomeLayout: HomeWidget[] = homeWidgetIds.map(id => widget(id, baseSize[id], id !== "sales"));

export type HomeProfile = "owner" | "sales" | "qs" | "finance" | "member";
/** Two compact rows per role; everything else stays in the gallery. */
const profileOrder: Record<HomeProfile, Array<[HomeWidgetId, HomeWidgetSize]>> = {
  owner: [["attention", "medium"], ["projects", "small"], ["trend", "small"], ["money", "small"], ["health", "small"]],
  sales: [["attention", "medium"], ["projects", "small"], ["trend", "small"], ["planning", "small"], ["activity", "small"]],
  qs: [["planning", "medium"], ["projects", "small"], ["trend", "small"], ["attention", "medium"]],
  finance: [["money", "small"], ["activity", "medium"], ["health", "small"], ["projects", "medium"]],
  member: [["projects", "medium"], ["tools", "small"], ["attention", "medium"], ["planning", "small"]],
};

/** Picks the starting Home from what the person may do, never from a tenant or a role name alone. */
export function homeProfile(can: (permission: string) => boolean, owner = false): HomeProfile {
  if (owner || can("workspace.settings.manage")) return "owner";
  if (can("receivables.view") && !can("crm.leads.view")) return "finance";
  if (can("crm.leads.view")) return "sales";
  if (can("pre_projects.view")) return "qs";
  return "member";
}

/**
 * The profile's widgets in order, then every other widget hidden (so the gallery can add it).
 * Sizes are widened where a row would otherwise end with an empty cell.
 */
export function defaultLayoutFor(profile: HomeProfile, available: (id: HomeWidgetId) => boolean = () => true): HomeWidget[] {
  const chosen = profileOrder[profile].filter(([id]) => available(id)).map(([id, size]) => widget(id, size));
  let used = 0;
  chosen.forEach((item, index) => {
    const span = homeWidgetSpan[item.size];
    if (used + span > 3) {
      const previous = chosen[index - 1];
      if (previous) { const grown = homeWidgetSizes[homeWidgetSpan[previous.size] - 1 + (3 - used)] ?? previous.size; chosen[index - 1] = widget(previous.id, grown); }
      used = 0;
    }
    used = (used + span) % 3;
  });
  const last = chosen.at(-1);
  if (last && used !== 0) chosen[chosen.length - 1] = widget(last.id, homeWidgetSizes[homeWidgetSpan[last.size] - 1 + (3 - used)] ?? last.size);
  return [...chosen, ...homeWidgetIds.filter(id => !chosen.some(item => item.id === id)).map(id => widget(id, baseSize[id], false))];
}

const isSize = (value: unknown): value is HomeWidgetSize => typeof value === "string" && (homeWidgetSizes as readonly string[]).includes(value);

/**
 * Only presentation preferences are stored; never records, permission grants or URLs.
 * Unknown ids are dropped, layouts saved before sizes existed keep `wide`, and widgets added
 * since the layout was saved are appended from `fallback`.
 */
export function parseHomeLayout(raw: string | null, fallback: HomeWidget[] = defaultHomeLayout): HomeWidget[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (!Array.isArray(parsed) || !parsed.length) return fallback;
    const result: HomeWidget[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object" || !homeWidgetIds.includes(entry.id) || result.some(item => item.id === entry.id)) continue;
      const size = isSize(entry.size) ? entry.size : entry.wide === true ? "wide" : baseSize[entry.id as HomeWidgetId] === "wide" ? "medium" : baseSize[entry.id as HomeWidgetId];
      result.push(widget(entry.id, size, entry.visible !== false));
    }
    return [...result, ...fallback.filter(item => !result.some(saved => saved.id === item.id))];
  } catch { return fallback; }
}

/** Moves a widget one visible place earlier or later, skipping widgets the viewer cannot see. */
export function moveHomeWidget(layout: HomeWidget[], id: HomeWidgetId, offset: -1 | 1, shown: (item: HomeWidget) => boolean): HomeWidget[] {
  const next = [...layout];
  const index = next.findIndex(item => item.id === id);
  let target = index + offset;
  while (target >= 0 && target < next.length && !shown(next[target])) target += offset;
  if (index < 0 || target < 0 || target >= next.length) return layout;
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/** Places `id` where `over` is, for pointer dragging. */
export function placeHomeWidget(layout: HomeWidget[], id: HomeWidgetId, over: HomeWidgetId): HomeWidget[] {
  if (id === over) return layout;
  const from = layout.findIndex(item => item.id === id);
  const to = layout.findIndex(item => item.id === over);
  if (from < 0 || to < 0) return layout;
  const next = [...layout];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function homeActivityId(item: Record<string, unknown>): string | null {
  const match = String(item.deepLink ?? "").match(/^\/crm\/activities\/([\da-f-]{36})$/i);
  return match?.[1] ?? null;
}

export function homeActionLabel(item: Record<string, unknown>): string {
  if (homeActivityId(item)) return "Update follow-up";
  if (String(item.kind).includes("reply")) return "Reply to client";
  if (String(item.kind).includes("lead") || item.kind === "sla_breach") return "Review enquiry";
  if (String(item.kind).includes("opportunity")) return "Review deal";
  return "View follow-ups";
}
