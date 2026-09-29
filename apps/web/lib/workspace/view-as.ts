/** View as: an owner or administrator reads the workspace as one team member (or one role), read-only, time-boxed. */
export type ViewAsSummary = {
  sessionId: string;
  kind: "person" | "role";
  workspaceId: string;
  subjectName: string;
  subjectRoleLabel: string | null;
  startedAt: string;
  expiresAt: string;
  returnPath: string | null;
};

/** One view of the signed-in person by someone else (Security > Activity). */
export type ViewAsActivity = {
  id: string;
  viewerName: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number | null;
  open: boolean;
};

export type ViewAsSettings = { notifySubject: boolean; version: number };

export type ViewAsTarget =
  | { kind: "person"; membershipId: string; name: string }
  | { kind: "role"; roleId: string; name: string };

export const VIEW_AS_PERMISSION = "workspace.view_as";

/** "mm:ss" left until the view ends, never below zero. */
export function viewAsTimeLeft(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Only a page inside the workspace is a place to go back to. */
export function viewAsReturnPath(value: string | null | undefined): string {
  return typeof value === "string" && /^\/workspace(?:[/?#]|$)/.test(value) && !value.includes("//") ? value : "/workspace";
}

type Failure = { ok: false; code?: string; message: string };

async function send(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { response, payload };
}

/** Confirms the viewer's authenticator code, then opens the view. */
export async function startViewAs(input: {
  workspaceId: string; target: ViewAsTarget; code: string; returnPath: string; idempotencyKey: string; fallback: string;
}): Promise<{ ok: true } | Failure> {
  const failure = (payload: Record<string, unknown> | null): Failure => ({
    ok: false, code: typeof payload?.code === "string" ? payload.code : undefined,
    message: typeof payload?.message === "string" ? payload.message : input.fallback,
  });
  const stepUp = await send("/api/auth/mfa/step-up", { workspaceId: input.workspaceId, code: input.code });
  if (!stepUp.response.ok) return failure(stepUp.payload);
  const started = await send("/api/workspace/view-as", {
    workspaceId: input.workspaceId,
    kind: input.target.kind,
    ...(input.target.kind === "role" ? { roleId: input.target.roleId } : { membershipId: input.target.membershipId }),
    returnPath: input.returnPath,
    idempotencyKey: input.idempotencyKey,
  });
  return started.response.ok ? { ok: true } : failure(started.payload);
}

/** Leaves the view and names the page to return to, as oneself. Leaving a view that already ended still returns. */
export async function exitViewAs(workspaceId: string, sessionId: string, returnPath: string | null): Promise<string> {
  const { response, payload } = await send("/api/workspace/view-as/exit", { workspaceId, sessionId }).catch(() => ({ response: null, payload: null }));
  return viewAsReturnPath(response?.ok && typeof payload?.returnPath === "string" ? payload.returnPath : returnPath);
}
