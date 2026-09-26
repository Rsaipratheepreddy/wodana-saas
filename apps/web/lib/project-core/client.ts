import type { LineHistoryEntry, LiveScope, ProjectDetail, ProjectRow, ReadyCase, SealedScope, SettingsState, StartState } from "./types";

export const projectPath = (workspaceId: string, path: string) => `/api/project-core/${path}?${new URLSearchParams({ workspaceId })}`;

export class ProjectRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ProjectRequestError(typeof data?.message === "string" ? data.message : "Could not update the project.", response.status);
  return data as T;
}

/** The Projects API for one workspace. */
export function projectApi(workspaceId: string) {
  const path = (value: string) => projectPath(workspaceId, value);
  return {
    list: () => request<{ projects: ProjectRow[]; canStart: boolean }>(path("projects")),
    ready: () => request<{ cases: ReadyCase[] }>(path("ready")),
    get: (projectId: string) => request<ProjectDetail>(path(`projects/${projectId}`)),
    scope: (projectId: string) => request<LiveScope>(path(`projects/${projectId}/scope`)),
    seal: (projectId: string, sealId: string) => request<SealedScope>(path(`projects/${projectId}/seals/${sealId}`)),
    line: (projectId: string, lineId: string) => request<{ history: LineHistoryEntry[] }>(path(`projects/${projectId}/lines/${lineId}`)),
    /** One change to the project, version-checked; returns the project as it is now. */
    command: (projectId: string, version: number, action: string, input: Record<string, unknown> = {}) =>
      request<ProjectDetail>(path(`projects/${projectId}`), "POST", { ...input, action, version }),
    startState: (caseId: string) => request<StartState>(path(`start/${caseId}`)),
    start: (caseId: string, input: { quoteId: string; templateId?: string; name: string; leadMembershipId: string; startDate?: string | null; promiseDate?: string | null }) =>
      request<{ projectId: string; existing: boolean }>(path(`start/${caseId}`), "POST", input),
    settings: () => request<SettingsState>(path("settings")),
    saveSettings: (input: Record<string, unknown>) => request<SettingsState>(path("settings"), "PUT", input),
    saveRoute: (input: Record<string, unknown>) => request<SettingsState>(path("routes"), "POST", input),
    archiveRoute: (id: string) => request<SettingsState>(path(`routes/${id}/archive`), "POST", {}),
  };
}
export type ProjectApi = ReturnType<typeof projectApi>;
