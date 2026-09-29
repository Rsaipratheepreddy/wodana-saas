import "reflect-metadata";
import { Controller, Get, Injectable, Module, Post, type CanActivate, type ExecutionContext, type INestApplication } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR, NestFactory, Reflector } from "@nestjs/core";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentViewAs, viewAsReadOnly, type ViewAsContext } from "./view-as.context";
import { AllowDuringViewAs } from "./view-as.decorators";
import { ViewAsGuard } from "./view-as.guard";
import { ViewAsInterceptor } from "./view-as.interceptor";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const session: ViewAsContext = {
  sessionId: "00000000-0000-4000-8000-0000000000aa", workspaceId, kind: "person", viewerUserId: "viewer",
  viewerMembershipId: "m-viewer", subjectUserId: "subject", subjectMembershipId: "m-subject", subjectRoleId: null,
  subjectName: "Sara Sales", subjectRoleLabel: "Sales", effectiveUserId: "subject",
  permissions: new Set(["crm.leads.view"]), startedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), returnPath: null,
};
const visits: string[] = [];
const viewAs = {
  resolve: async (actor: { subject: string }) => actor.subject === "viewing" ? session : null,
  recordVisit: async (_session: unknown, route: string) => { visits.push(route); },
};

// Spec files are compiled without legacy decorators, so the probe applies Nest's decorators by hand.
/** Stands in for the sign-in guard: the bearer names who is asking. */
class SignedIn implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    req.actor = { subject: req.headers.authorization === "Bearer viewing" ? "viewing" : "someone", provider: "local", email: "v@example.com", displayName: "V" };
    return true;
  }
}
Injectable()(SignedIn);

class ProbeController {
  async read() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { viewAs: currentViewAs()?.sessionId ?? null, discard: viewAsReadOnly() };
  }

  write() { return { written: true }; }

  leave() { return { viewAs: currentViewAs()?.sessionId ?? null, discard: viewAsReadOnly() }; }
}
const method = (name: keyof ProbeController, ...decorators: MethodDecorator[]) => {
  const descriptor = Object.getOwnPropertyDescriptor(ProbeController.prototype, name)!;
  for (const decorate of decorators) decorate(ProbeController.prototype, name, descriptor);
};
method("read", Get());
method("write", Post());
method("leave", Post("leave"), AllowDuringViewAs());
Controller("workspaces/:workspaceId/probe")(ProbeController);

class ProbeModule {}
Module({
  controllers: [ProbeController],
  providers: [
    { provide: APP_GUARD, useClass: SignedIn },
    { provide: APP_GUARD, useFactory: (reflector: Reflector) => new ViewAsGuard(reflector, viewAs as never), inject: [Reflector] },
    { provide: APP_INTERCEPTOR, useFactory: (reflector: Reflector) => new ViewAsInterceptor(reflector), inject: [Reflector] },
  ],
})(ProbeModule);

describe("view as in the Nest request pipeline", () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await NestFactory.create(ProbeModule, { logger: false });
    await app.init();
  });
  afterAll(() => app.close());

  it("runs a read inside the view (discarding its database work) and refuses a change before the handler", async () => {
    const read = await request(app.getHttpServer()).get(`/workspaces/${workspaceId}/probe`).set("authorization", "Bearer viewing");
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ viewAs: session.sessionId, discard: true });
    expect(visits).toContain("GET /probe");

    const write = await request(app.getHttpServer()).post(`/workspaces/${workspaceId}/probe`).set("authorization", "Bearer viewing");
    expect(write.status).toBe(403);
    expect(write.body).toMatchObject({ code: "view_as_read_only" });

    const leave = await request(app.getHttpServer()).post(`/workspaces/${workspaceId}/probe/leave`).set("authorization", "Bearer viewing");
    expect(leave.body).toEqual({ viewAs: session.sessionId, discard: false });
  });

  it("leaves everyone else's requests as they are", async () => {
    const read = await request(app.getHttpServer()).get(`/workspaces/${workspaceId}/probe`).set("authorization", "Bearer other");
    expect(read.body).toEqual({ viewAs: null, discard: false });
    const write = await request(app.getHttpServer()).post(`/workspaces/${workspaceId}/probe`).set("authorization", "Bearer other");
    expect(write.body).toEqual({ written: true });
  });
});
