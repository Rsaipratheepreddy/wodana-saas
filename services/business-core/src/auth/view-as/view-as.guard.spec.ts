import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { IS_PUBLIC_KEY } from "../public.decorator";
import { currentViewAs, runViewingAs, viewAsPermissionsFor, viewAsReadOnly, type ViewAsContext } from "./view-as.context";
import { ALLOW_DURING_VIEW_AS_KEY, HIDDEN_DURING_VIEW_AS_KEY } from "./view-as.decorators";
import { ViewAsGuard } from "./view-as.guard";
import { ViewAsInterceptor } from "./view-as.interceptor";
import { Observable, lastValueFrom } from "rxjs";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const session: ViewAsContext = {
  sessionId: "00000000-0000-4000-8000-0000000000aa", workspaceId, kind: "person", viewerUserId: "viewer",
  viewerMembershipId: "m-viewer", subjectUserId: "subject", subjectMembershipId: "m-subject", subjectRoleId: null,
  subjectName: "Sara Sales", subjectRoleLabel: "Sales", effectiveUserId: "subject",
  permissions: new Set(["crm.leads.view"]), startedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), returnPath: "/workspace",
};

function guardFor(open: ViewAsContext | null, metadata: Record<string, boolean> = {}) {
  const viewAs = { resolve: vi.fn(async () => open), recordVisit: vi.fn(async () => undefined) };
  const reflector = { getAllAndOverride: (key: string) => metadata[key] ?? false };
  return { guard: new ViewAsGuard(reflector as never, viewAs as never), viewAs };
}

function request(method: string, path: string, params: Record<string, string> = { workspaceId }, headers: Record<string, string> = {}) {
  return { method, originalUrl: path, url: path, params, headers, actor: { subject: "local:viewer", provider: "local", email: "v@example.com", displayName: "V" } } as {
    method: string; originalUrl: string; url: string; params: Record<string, string>; headers: Record<string, string>; actor: { viewAs?: ViewAsContext };
  };
}
const context = (req: object) => ({
  getType: () => "http", getHandler: () => undefined, getClass: () => undefined,
  switchToHttp: () => ({ getRequest: () => req }),
}) as never;
const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.catch((reason: unknown) => reason) as ForbiddenException;
  return error instanceof ForbiddenException ? (error.getResponse() as { code: string }).code : null;
};

describe("the view-as guard", () => {
  it("does nothing for a sign-in session that is not viewing as anyone", async () => {
    const { guard, viewAs } = guardFor(null);
    const req = request("POST", `/api/v1/workspaces/${workspaceId}/crm/leads`);
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.actor.viewAs).toBeUndefined();
    expect(viewAs.recordVisit).not.toHaveBeenCalled();
  });

  it("refuses every change with view_as_read_only", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const { guard } = guardFor(session);
      expect(await refusal(guard.canActivate(context(request(method, `/api/v1/workspaces/${workspaceId}/crm/leads`))))).toBe("view_as_read_only");
    }
    // Routes without a workspace too (the viewer's own security settings, preferences).
    expect(await refusal(guardFor(session).guard.canActivate(context(request("POST", "/api/v1/security/mfa/disable", {}))))).toBe("view_as_read_only");
  });

  it("lets reads through as the subject and records the page or route opened", async () => {
    const { guard, viewAs } = guardFor(session);
    const req = request("GET", `/api/v1/workspaces/${workspaceId}/crm/leads?page=2`);
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(req.actor.viewAs).toBe(session);
    expect(viewAs.recordVisit).toHaveBeenCalledWith(session, "GET /crm/leads");
    const page = request("GET", "/api/v1/me", {}, { "x-wodana-page": "/workspace/projects" });
    await guard.canActivate(context(page));
    expect(viewAs.recordVisit).toHaveBeenLastCalledWith(session, "page /workspace/projects");
  });

  it("keeps private reads private, other workspaces closed, and leaving the view open", async () => {
    expect(await refusal(guardFor(session, { [HIDDEN_DURING_VIEW_AS_KEY]: true }).guard
      .canActivate(context(request("GET", `/api/v1/workspaces/${workspaceId}/hrms/documents`))))).toBe("view_as_private");
    expect(await refusal(guardFor(session).guard
      .canActivate(context(request("GET", "/api/v1/workspaces/x/crm/leads", { workspaceId: "00000000-0000-4000-8000-000000000002" }))))).toBe("view_as_other_workspace");
    await expect(guardFor(session, { [ALLOW_DURING_VIEW_AS_KEY]: true }).guard
      .canActivate(context(request("POST", `/api/v1/workspaces/${workspaceId}/view-as/${session.sessionId}/exit`)))).resolves.toBe(true);
    await expect(guardFor(session, { [IS_PUBLIC_KEY]: true }).guard.canActivate(context(request("POST", "/api/v1/auth/logout", {})))).resolves.toBe(true);
  });
});

describe("the view-as request context", () => {
  it("runs the handler inside the view, discarding its database work, except when leaving it", async () => {
    const reflector = { getAllAndOverride: vi.fn(() => false) };
    const interceptor = new ViewAsInterceptor(reflector as never);
    const req = { actor: { viewAs: session } };
    const seen = await lastValueFrom(interceptor.intercept(context(req), { handle: () => new Observable((subscriber) => {
      setTimeout(() => { subscriber.next({ viewAs: currentViewAs()?.sessionId, discard: viewAsReadOnly() }); subscriber.complete(); }, 1);
    }) }));
    expect(seen).toEqual({ viewAs: session.sessionId, discard: true });
    reflector.getAllAndOverride.mockReturnValue(true);
    const leaving = await lastValueFrom(interceptor.intercept(context(req), { handle: () => new Observable((subscriber) => {
      subscriber.next(viewAsReadOnly()); subscriber.complete();
    }) }));
    expect(leaving).toBe(false);
    expect(currentViewAs()).toBeNull();
  });

  it("narrows permissions for the effective user in that workspace only", () => {
    runViewingAs(session, true, () => {
      expect(viewAsPermissionsFor(workspaceId, "subject")?.has("crm.leads.view")).toBe(true);
      expect(viewAsPermissionsFor(workspaceId, "someone-else")).toBeNull();
      expect(viewAsPermissionsFor("00000000-0000-4000-8000-000000000002", "subject")).toBeNull();
    });
    expect(viewAsPermissionsFor(workspaceId, "subject")).toBeNull();
  });
});
