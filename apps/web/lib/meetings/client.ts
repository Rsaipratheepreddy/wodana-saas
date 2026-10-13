/** PLM-153: the minutes of a client meeting, as the business core returns them (services/business-core/src/meetings). */
export type MinutesFile = { id: string; name: string; mimeType: string; byteSize: number; hasPreview: boolean; byName: string; at: string };
export type MinutesState = {
  meeting: { activityId: string; title: string; type: string; status: "pending" | "completed" | "cancelled"; startsAt: string | null; endsAt: string | null; clientName: string };
  minutes: null | {
    id: string; title: string; body: string; fileIds: string[]; revision: number; sharedAt: string | null; sharedRevision: number | null; authorName: string; createdAt: string;
    updatedAt: string; updatedByName: string; version: number;
  };
  revisions: Array<{ revision: number; title: string; body: string; fileIds: string[]; shared: boolean; byName: string; at: string }>;
  comments: Array<{ id: string; at: string; text: string; fromClient: boolean; author: string }>;
  files: MinutesFile[];
  /** Why minutes can't be written now (cancelled, not started yet), or null. */
  problem: string | null;
  canWrite: boolean;
  /** The client's side: their project, the portal on and its Meetings shown, and how many people can open it. */
  portal: { caseId: string | null; enabled: boolean; shown: boolean; contacts: number };
  /** After a first share: how many of the client's contacts were told, or why nobody was. */
  told?: { queued: number; reason: string | null } | null;
};

export class MinutesRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const path = (workspaceId: string, activityId: string, rest = "") => `/api/meetings/${activityId}/minutes${rest}?${new URLSearchParams({ workspaceId })}`;

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new MinutesRequestError(typeof data?.message === "string" ? data.message : "Could not save the minutes.", response.status);
  return data as T;
}

/** The minutes API for one workspace's meetings. */
export function minutesApi(workspaceId: string) {
  return {
    read: (activityId: string) => request<MinutesState>(path(workspaceId, activityId)),
    /** Saves a new revision (version-checked); shared for the first time, the client is told. */
    save: (activityId: string, input: { minutesId: string; version: number; title: string; body: string; fileIds: string[]; shared: boolean }) =>
      request<MinutesState>(path(workspaceId, activityId), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }),
    reply: (activityId: string, input: { commentId: string; text: string }) =>
      request<MinutesState>(path(workspaceId, activityId, "/replies"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }),
    /** A photo or PDF for the minutes; replayed safely by its id. */
    upload: (activityId: string, fileId: string, file: File) => {
      const form = new FormData();
      form.set("file", file);
      return request<MinutesFile>(path(workspaceId, activityId, `/files/${fileId}`), { method: "POST", body: form });
    },
    fileUrl: (activityId: string, fileId: string) => path(workspaceId, activityId, `/files/${fileId}`),
  };
}
