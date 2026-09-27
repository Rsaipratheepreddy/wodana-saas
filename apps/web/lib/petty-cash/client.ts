import type { PettyCashPayables, ProjectPettyCash } from "./types";

export class PettyCashRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function send<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new PettyCashRequestError(typeof data?.message === "string" ? data.message : fallback, response.status);
  return data as T;
}

/** Petty cash for one workspace: a project's claims and their receipts, and what the people who pay reimburse. */
export function pettyCashApi(workspaceId: string) {
  const at = (value: string) => `/api/petty-cash/${value}?${new URLSearchParams({ workspaceId })}`;
  /** One change, with its own command id so a retry never runs it twice. */
  const post = <T>(url: string, input: Record<string, unknown>) =>
    send<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, commandId: crypto.randomUUID() }) }, "Could not save.");
  return {
    project: (projectId: string) => send<ProjectPettyCash>(at(`projects/${projectId}`), {}, "Petty cash didn't load."),
    /** save (a claim, by its id; version when it exists) · submit · approve · reject (by claimId and version). */
    command: (projectId: string, action: "save" | "submit" | "approve" | "reject", input: Record<string, unknown>) =>
      post<ProjectPettyCash>(at(`projects/${projectId}`), { ...input, action }),
    /** The receipt of a draft claim (a PDF or photo); the same file again changes nothing. */
    uploadReceipt: (projectId: string, claimId: string, file: File) => {
      const form = new FormData(); form.set("file", file);
      return send<ProjectPettyCash>(at(`projects/${projectId}/claims/${claimId}/receipt`), { method: "POST", body: form }, "The receipt could not be uploaded.");
    },
    receiptUrl: (claimId: string) => at(`claims/${claimId}/receipt`),
    payables: () => send<PettyCashPayables>(at("state"), {}, "Petty cash didn't load."),
    reimburse: (input: { claimId: string; version: number; reference: string }) => post<PettyCashPayables>(at("state"), input),
  };
}
export type PettyCashApi = ReturnType<typeof pettyCashApi>;
