export const WORKSPACE_TERMINOLOGY_DEFAULTS = [
  { key: "workspace", visibleName: "Workspace", visibleNamePlural: "Workspaces" },
  { key: "crm", visibleName: "CRM", visibleNamePlural: "CRM" },
  { key: "lead", visibleName: "Lead", visibleNamePlural: "Leads" },
  { key: "opportunity", visibleName: "Deal", visibleNamePlural: "Deals" },
  { key: "client", visibleName: "Client", visibleNamePlural: "Clients" },
  { key: "pre_execution", visibleName: "Pre-execution", visibleNamePlural: "Pre-execution" },
  { key: "quotation", visibleName: "Quotation", visibleNamePlural: "Quotations" },
  { key: "project", visibleName: "Project", visibleNamePlural: "Projects" },
  { key: "business_unit", visibleName: "Business unit", visibleNamePlural: "Business units" },
  { key: "team", visibleName: "Team", visibleNamePlural: "Teams" },
  { key: "resource", visibleName: "Resource", visibleNamePlural: "Resources" },
  { key: "schedule", visibleName: "Schedule", visibleNamePlural: "Schedules" },
  { key: "file", visibleName: "File", visibleNamePlural: "Files" },
] as const;

export type WorkspaceTerminologyKey = (typeof WORKSPACE_TERMINOLOGY_DEFAULTS)[number]["key"];

export type WorkspaceTerminologyOverride = {
  key: string;
  visibleName: string;
  visibleNamePlural: string;
  version: number;
  updatedAt: Date | string | null;
};

export type ResolvedWorkspaceTerminology = {
  key: WorkspaceTerminologyKey;
  defaultVisibleName: string;
  defaultVisibleNamePlural: string;
  visibleName: string;
  visibleNamePlural: string;
  overridden: boolean;
  version: number;
  updatedAt: Date | string | null;
};

export function workspaceTerminologyDefault(key: string) {
  return WORKSPACE_TERMINOLOGY_DEFAULTS.find((item) => item.key === key);
}

export function resolveWorkspaceTerminology(overrides: WorkspaceTerminologyOverride[]) {
  const selected = new Map(overrides.map((item) => [item.key, item]));
  const items: ResolvedWorkspaceTerminology[] = WORKSPACE_TERMINOLOGY_DEFAULTS.map((fallback) => {
    const override = selected.get(fallback.key);
    return {
      key: fallback.key,
      defaultVisibleName: fallback.visibleName,
      defaultVisibleNamePlural: fallback.visibleNamePlural,
      visibleName: override?.visibleName ?? fallback.visibleName,
      visibleNamePlural: override?.visibleNamePlural ?? fallback.visibleNamePlural,
      overridden: Boolean(override),
      version: override?.version ?? 0,
      updatedAt: override?.updatedAt ?? null,
    };
  });
  return {
    items,
    map: Object.fromEntries(items.map((item) => [item.key, {
      visibleName: item.visibleName,
      visibleNamePlural: item.visibleNamePlural,
    }])) as Record<WorkspaceTerminologyKey, { visibleName: string; visibleNamePlural: string }>,
  };
}
