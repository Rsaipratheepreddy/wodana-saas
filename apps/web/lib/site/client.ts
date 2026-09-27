import type { SiteState } from "./types";

export class SiteRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function send<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new SiteRequestError(typeof data?.message === "string" ? data.message : fallback, response.status);
  return data as T;
}

/** A project's site for one workspace: its state, one change at a time, and report photos. */
export function siteApi(workspaceId: string, projectId: string) {
  const at = (value = "") => `/api/site/projects/${projectId}${value ? `/${value}` : ""}?${new URLSearchParams({ workspaceId })}`;
  return {
    state: () => send<SiteState>(at(), {}, "The site didn't load."),
    command: (action: string, input: Record<string, unknown> = {}) =>
      send<SiteState>(at(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, action }) }, "Could not save."),
    /** A photo for a report its author is writing; replayed safely by its id. */
    uploadPhoto: (reportId: string, photoId: string, file: File) => {
      const form = new FormData(); form.set("file", file);
      return send<SiteState>(at(`reports/${reportId}/photos/${photoId}`), { method: "POST", body: form }, "The photo could not be uploaded.");
    },
    photoUrl: (photoId: string, preview = true) => `${at(`photos/${photoId}`)}${preview ? "&preview=1" : ""}`,
  };
}
export type SiteApi = ReturnType<typeof siteApi>;
