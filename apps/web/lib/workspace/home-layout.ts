export const homeWidgetIds = ["attention", "planning", "projects", "sales", "tools", "attendance"] as const;
export type HomeWidgetId = typeof homeWidgetIds[number];
export type HomeWidget = { id: HomeWidgetId; visible: boolean; wide: boolean };
export const defaultHomeLayout: HomeWidget[] = homeWidgetIds.map(id => ({ id, visible: true, wide: id === "attention" || id === "attendance" }));

/** Only presentation preferences are stored; never records, permission grants or URLs. */
export function parseHomeLayout(raw: string | null): HomeWidget[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (!Array.isArray(parsed)) return defaultHomeLayout;
    const result: HomeWidget[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object" || !homeWidgetIds.includes(entry.id) || result.some(item => item.id === entry.id)) continue;
      result.push({ id: entry.id, visible: entry.visible !== false, wide: entry.wide === true });
    }
    return [...result, ...defaultHomeLayout.filter(item => !result.some(saved => saved.id === item.id))];
  } catch { return defaultHomeLayout; }
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
