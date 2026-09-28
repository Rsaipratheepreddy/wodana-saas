import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { Public } from "../auth/public.decorator";
import { REFERENCE_MAX_BYTES, type ReferenceUpload } from "../workspaces/reference-upload";
import { ClientPortalAdminService } from "./client-portal-admin.service";
import { ClientPortalService } from "./client-portal.service";

const bearer = (value = "") => value.replace(/^Bearer /, "");
const object = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** The client's side, reached through the web app's portal routes (session token in the Authorization header). */
@Public()
@Controller("client-portal/:slug")
export class ClientPortalController {
  constructor(private readonly portal: ClientPortalService) {}

  @Get("site") site(@Param("slug") slug: string) { return this.portal.site(slug); }

  @Get("invite/:token") invitation(@Param("slug") slug: string, @Param("token") token: string) { return this.portal.invitation(slug, token.slice(0, 200)); }

  @Post("challenge") challenge(@Param("slug") slug: string, @Body() body: unknown, @Headers("authorization") auth = "", @Headers("x-portal-requester") requester?: string) {
    return this.portal.challenge(slug, object(body), bearer(auth), requester?.slice(0, 100));
  }

  @Post("login") login(@Param("slug") slug: string, @Body() body: unknown) { return this.portal.login(slug, object(body)); }

  @Get("view") view(@Param("slug") slug: string, @Headers("authorization") auth = "") { return this.portal.view(slug, bearer(auth)); }

  @Post("command") command(@Param("slug") slug: string, @Body() body: unknown, @Headers("authorization") auth = "") { return this.portal.command(slug, bearer(auth), object(body)); }

  @Post("logout") logout(@Param("slug") slug: string, @Headers("authorization") auth = "") { return this.portal.logout(slug, bearer(auth)); }

  @Get("files/:kind/:id") async file(@Param("slug") slug: string, @Param("kind") kind: string, @Param("id") id: string, @Query("preview") preview: string | undefined,
    @Headers("authorization") auth = "") {
    const file = await this.portal.file(slug, bearer(auth), kind, id, preview === "1");
    return new StreamableFile(file.body, { type: file.mimeType, disposition: `inline; filename="${encodeURIComponent(file.name)}"` });
  }

  /** A photo or PDF the client adds to a project, before sending it with something. */
  @Post("cases/:caseId/uploads/:id") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: REFERENCE_MAX_BYTES, files: 1, fields: 0 } }))
  upload(@Param("slug") slug: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: ReferenceUpload | undefined,
    @Headers("authorization") auth = "") {
    return this.portal.upload(slug, bearer(auth), caseId, id, file);
  }

  /** A tax invoice or receipt of the client's, to print or save as PDF. */
  @Get("cases/:caseId/documents/:kind/:id") document(@Param("slug") slug: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("kind") kind: string,
    @Param("id") id: string, @Headers("authorization") auth = "") {
    return this.portal.document(slug, bearer(auth), caseId, kind, id.slice(0, 80));
  }
}

/** Finds a portal before any tenant is known: by the tenant's own domain or its sign-in subdomain. */
@Public()
@Controller("client-portal-sites")
export class ClientPortalSitesController {
  constructor(private readonly portal: ClientPortalService) {}

  @Get("host/:hostname") host(@Param("hostname") hostname: string) { return this.portal.resolve({ host: hostname }).then(({ slug }) => ({ slug })); }

  @Get("tenant/:loginSlug") tenant(@Param("loginSlug") loginSlug: string) { return this.portal.resolve({ login: loginSlug }).then(({ slug }) => ({ slug })); }
}

/** The firm's side: what clients see, each project's choice and pause, and the client contacts. */
@Controller("workspaces/:workspaceId/client-portal")
export class ClientPortalAdminController {
  constructor(private readonly admin: ClientPortalAdminService) {}

  @Get("settings") settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.admin.settings(actor, workspaceId); }

  @Put("settings") saveSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: unknown) {
    return this.admin.saveSettings(actor, workspaceId, object(body));
  }

  /** The portal as this case's client sees it, read-only, for the team's preview and Woddy's tours. */
  @Get("cases/:caseId/preview") preview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) {
    return this.admin.preview(actor, workspaceId, caseId);
  }

  @Get("projects/:projectId") project(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.admin.project(actor, workspaceId, projectId);
  }

  @Put("projects/:projectId") saveProject(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("projectId", ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    return this.admin.saveProject(actor, workspaceId, projectId, object(body));
  }

  @Post("projects/:projectId/invite") inviteClient(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("projectId", ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    return this.admin.inviteClient(actor, workspaceId, projectId, object(body));
  }

  @Post("projects/:projectId/revoke") revokeClient(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("projectId", ParseUUIDPipe) projectId: string, @Body() body: unknown) {
    return this.admin.revokeClient(actor, workspaceId, projectId, object(body));
  }

  @Get("cases/:caseId/contacts") contacts(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) {
    return this.admin.contacts(actor, workspaceId, caseId);
  }

  @Put("cases/:caseId/contacts") saveContact(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string, @Body() body: unknown) {
    return this.admin.saveContact(actor, workspaceId, caseId, object(body));
  }

  @Post("cases/:caseId/contacts/:contactId/demo-code") demoCode(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string, @Param("contactId", ParseUUIDPipe) contactId: string, @Body() body: unknown) {
    return this.admin.demoCode(actor, workspaceId, caseId, contactId, object(body));
  }

  @Post("cases/:caseId/contacts/:contactId/sign-out") signOut(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string, @Param("contactId", ParseUUIDPipe) contactId: string) {
    return this.admin.signOutContact(actor, workspaceId, caseId, contactId);
  }

  // What the client did, for the team: the moodboard, reported payments, issues, conversations and their files.

  @Get("cases/:caseId/moodboard") moodboard(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) {
    return this.admin.moodboard(actor, workspaceId, caseId);
  }

  @Post("cases/:caseId/moodboard/share") shareMoodboard(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string, @Body() body: unknown) {
    return this.admin.shareMoodboard(actor, workspaceId, caseId, object(body));
  }

  @Post("cases/:caseId/moodboard/reply") replyMoodboard(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string, @Body() body: unknown) {
    return this.admin.replyMoodboard(actor, workspaceId, caseId, object(body));
  }

  @Get("cases/:caseId/payment-reports") paymentReports(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string) {
    return this.admin.paymentReports(actor, workspaceId, caseId);
  }

  @Post("payment-reports/:reportId") decidePaymentReport(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("reportId", ParseUUIDPipe) reportId: string, @Body() body: unknown) {
    return this.admin.decidePaymentReport(actor, workspaceId, reportId, object(body));
  }

  @Get("projects/:projectId/issues") issues(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("projectId", ParseUUIDPipe) projectId: string) {
    return this.admin.issues(actor, workspaceId, projectId);
  }

  @Post("projects/:projectId/issues/:issueId") triageIssue(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("projectId", ParseUUIDPipe) projectId: string, @Param("issueId", ParseUUIDPipe) issueId: string, @Body() body: unknown) {
    return this.admin.triageIssue(actor, workspaceId, projectId, issueId, object(body));
  }

  @Get("cases/:caseId/threads") threads(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) {
    return this.admin.threads(actor, workspaceId, caseId);
  }

  @Post("cases/:caseId/threads/:threadId/read") readThread(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string, @Param("threadId", ParseUUIDPipe) threadId: string) {
    return this.admin.readThreadAsTeam(actor, workspaceId, caseId, threadId);
  }

  @Get("cases/:caseId/files/:assetId") async clientFile(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("caseId", ParseUUIDPipe) caseId: string, @Param("assetId", ParseUUIDPipe) assetId: string, @Query("preview") preview: string | undefined) {
    const file = await this.admin.clientFile(actor, workspaceId, caseId, assetId, preview === "1");
    return new StreamableFile(file.body, { type: file.mimeType, disposition: `inline; filename="${encodeURIComponent(file.name)}"` });
  }
}
