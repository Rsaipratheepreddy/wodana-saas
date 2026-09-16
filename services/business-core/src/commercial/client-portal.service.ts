import {validateDeduction} from "./variation-controls";
import {
  controlledChangeCanRelease,
  controlledChangeForQuote,
} from "./change-control";
import {decidePortalDesign,portalReviewDesign} from './portal-design-approval';
import {deliverPortalOtp} from "./portal-otp-delivery";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { publicProject } from "../projects/execution.domain";
import { decideHandoverFromPortal } from "../projects/project-handover";
import { addClientWarrantyClaim, assertWarrantyCoverage, warrantyOwnerId } from "../projects/project-warranty";
import type { ProjectData } from "../projects/execution.types";
import { ProjectNotificationsService } from "../projects/project-notifications";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { localDate } from "../hrms/hrms-domain";
import { parsePortalChallengePurpose } from "./client-portal-purpose";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  HttpException,
} from "@nestjs/common";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { PoolClient } from "pg";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { CommercialService } from "./commercial.service";
import {
  actionable,
  clientQuote,
  newRequest,
  object,
  phone,
  text,
} from "./commercial.domain";
import type { PortalSettings, Quote } from "./commercial.types";
import { PreProjectDefinitionService } from "../pre-projects/pre-project-definition.service";
const actorId = "00000000-0000-4000-8000-000000000000";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
@Injectable()
export class ClientPortalService {
  private readonly secret: string;
  constructor(
    private readonly db: DatabaseService,
    private readonly commercial: CommercialService,
    private readonly storage: BrandAssetStorageService,
    private readonly config: ConfigService,
    private readonly definitions: PreProjectDefinitionService,
    private readonly projectNotifications: ProjectNotificationsService,
    private readonly events: CrmEventsService,
  ) {
    if (
      config.get("PORTAL_DEMO_OTP") === "true" &&
      config.get("NODE_ENV") === "production"
    )
      throw new Error("PORTAL_DEMO_OTP cannot be enabled in production.");
    if(config.get("NODE_ENV")==="production" && (config.get<string>("PORTAL_OTP_SECRET")??"").length<32)throw new Error("Set a stable PORTAL_OTP_SECRET of at least 32 characters for production.");
    this.secret =
      config.get<string>("PORTAL_OTP_SECRET") ??
      config.get<string>("LOCAL_AUTH_JWT_SECRET") ??
      randomBytes(32).toString("hex");
  }
  async branding(slug: string): Promise<PortalSettings> {
    if (!/^[a-z0-9-]{1,80}$/.test(slug))
      throw new NotFoundException("Portal not found.");
    const r = await this.db.query(
      `SELECT workspace_id AS "workspaceId",slug,brand,enabled,version FROM client_portal_settings WHERE slug=$1 AND enabled=true`,
      [slug],
    );
    if (!r.rowCount)
      throw new NotFoundException("This client portal is not available.");
    return {
      ...r.rows[0],
      testMode: this.commercial.testMode,
    } as PortalSettings;
  }
  private async session(
    client: PoolClient,
    workspaceId: string,
    token: string,
  ) {
    if (!token || token.length > 200)
      throw new UnauthorizedException("Sign in to continue.");
    const result = await client.query(
      `SELECT phone FROM client_portal_sessions WHERE workspace_id=$1 AND token_hash=$2 AND revoked_at IS NULL AND expires_at>now()`,
      [workspaceId, digest(token)],
    );
    if (!result.rowCount)
      throw new UnauthorizedException(
        "Your session has expired. Sign in again.",
      );
    const mobile = result.rows[0].phone;
    const grants = await client.query(
      `SELECT id,case_id AS "caseId",name,role FROM client_portal_grants WHERE workspace_id=$1 AND phone=$2 AND active=true AND ($3=false OR test_contact=true)`,
      [workspaceId, mobile, this.commercial.testMode],
    );
    if (!grants.rowCount)
      throw new ForbiddenException("Client access is no longer available.");
    return { phone: mobile, grants: grants.rows };
  }
  async challenge(slug: string, input: unknown, token: string) {
    const settings = await this.branding(slug),
      body = object(input),
      purpose = text(body.purpose ?? "login", 200, true),
      mobile = phone(body.phone);
    let grantId: string | undefined;
    const response = await this.db.tenantTransaction(
      settings.workspaceId,
      actorId,
      async (client) => {
        if (purpose !== "login") {
          const parsed = parsePortalChallengePurpose(purpose);
          if (!parsed)
            throw new BadRequestException("Invalid portal verification challenge.");
          const s = await this.session(client, settings.workspaceId, token);
          if (s.phone !== mobile)
            throw new ForbiddenException("Use your signed-in mobile number.");
          const grant = s.grants.find(
            (candidate) =>
              candidate.caseId === parsed.caseId &&
              (parsed.kind === "warranty-claim" || candidate.role === "approver"),
          );
          if (!grant)
            throw new ForbiddenException(
              parsed.kind === "warranty-claim"
                ? "This client contact cannot report warranty work for the project."
                : "Only the designated approver can decide.",
            );
          grantId = grant.id;
          if (parsed.kind === "design-decision")
            await portalReviewDesign(client, settings.workspaceId, parsed.caseId, parsed.recordId);
          else if (parsed.kind === "definition-decision")
            await this.definitions.assertPortalDecisionAvailable(
              client,
              settings.workspaceId,
              parsed.caseId,
              parsed.recordId,
            );
          else if (parsed.kind === "handover-decision" || parsed.kind === "warranty-claim") {
            const project = await client.query<{ content: ProjectData; timezone: string }>(
              `SELECT execution.content, workspace.default_timezone AS timezone
                 FROM delivery_projects project
                 JOIN workspaces workspace ON workspace.id=project.workspace_id
                 JOIN project_execution execution
                   ON execution.workspace_id=project.workspace_id AND execution.project_id=project.id
                WHERE project.workspace_id=$1 AND project.case_id=$2 AND project.id=$3
                FOR UPDATE OF project,execution`,
              [settings.workspaceId, parsed.caseId, parsed.projectId],
            );
            if (!project.rowCount)
              throw new NotFoundException("This project handover is not available.");
            const handover = project.rows[0].content.handovers.find(
              (item) => item.id === parsed.handoverId,
            );
            if (!handover)
              throw new NotFoundException("This project handover is not available.");
            if (parsed.kind === "handover-decision") {
              if (handover.status !== "ready" || handover.clientApproverId !== grant.id)
                throw new ForbiddenException("This handover is not assigned to you.");
            } else {
              assertWarrantyCoverage(project.rows[0].content, {
                handoverId: handover.id,
                area: handover.area,
                onDate: localDate(new Date(), project.rows[0].timezone ?? "UTC"),
              });
              warrantyOwnerId(project.rows[0].content);
            }
          } else {
            const data = await this.commercial.load(
              client,
              settings.workspaceId,
              parsed.caseId,
            );
            if (parsed.kind === "material-decision") {
              const approval = data.materialApprovals?.find(
                (item) =>
                  item.id === parsed.recordId &&
                  item.approverId === grantId &&
                  item.status === "client_review",
              );
              if (!approval)
                throw new ForbiddenException("This material approval is not assigned to you.");
            } else {
              const quote = data.quotes.find(
                (item) => item.id === parsed.recordId && item.approverId === grantId,
              );
              if (!quote)
                throw new ForbiddenException("This approval is not assigned to you.");
              actionable(quote);
            }
          }
        }
        // Database lock and counters survive retries and multiple application processes.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          settings.workspaceId + mobile,
        ]);
        const rate = await client.query(
          `SELECT count(*) FILTER (WHERE phone=$2)::int AS count,max(created_at) FILTER(WHERE phone=$2) AS last,count(*)::int AS total FROM client_portal_challenges WHERE workspace_id=$1 AND created_at>now()-interval '10 minutes'`,
          [settings.workspaceId, mobile],
        );
        if (
          rate.rows[0].count >= 6 ||
          rate.rows[0].total >= 300 ||
          (purpose === "login" &&
            rate.rows[0].last &&
            Date.now() - new Date(rate.rows[0].last).getTime() < 60000)
        )
          throw new HttpException(
            "Please wait before requesting another code.",
            429,
          );
        const eligible = await client.query(
          `SELECT id FROM client_portal_grants WHERE workspace_id=$1 AND phone=$2 AND active=true AND ($3=false OR test_contact=true)`,
          [settings.workspaceId, mobile, this.commercial.testMode],
        );
        const id = randomUUID(),
          code = eligible.rowCount ? (this.commercial.testMode?"123456":String(randomInt(0,1000000)).padStart(6,"0")) : randomBytes(24).toString("hex");
        await client.query(
          `UPDATE client_portal_challenges SET consumed_at=now() WHERE workspace_id=$1 AND phone=$2 AND purpose=$3 AND consumed_at IS NULL`,
          [settings.workspaceId, mobile, purpose],
        );
        await client.query(
          `INSERT INTO client_portal_challenges(id,workspace_id,phone,purpose,code_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes')`,
          [id, settings.workspaceId, mobile, purpose, this.codeHash(id, code)],
        );
        if(eligible.rowCount&&!this.commercial.testMode)await deliverPortalOtp(this.config,settings.workspaceId,id,mobile,code);
        return {
          challengeId: id,
          expiresIn: 300,
          resendAfter: 60,
          testMode: this.commercial.testMode,
          message: this.commercial.testMode?"Demo mode: use 123456. No WhatsApp message is sent.":"If this number has access, a code will arrive on WhatsApp.",
        };
      },
    );
    return response;
  }
  private codeHash(id: string, code: string) {
    return createHmac("sha256", this.secret)
      .update(`${id}:${code}`)
      .digest("hex");
  }
  private async consume(
    client: PoolClient,
    workspaceId: string,
    id: string,
    code: string,
    purpose: string,
    mobile?: string,
  ) {
    if (!/^[\da-f-]{36}$/i.test(id) || !/^\d{6}$/.test(code)) return null;
    const result = await client.query(
      "SELECT * FROM client_portal_challenges WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
      [workspaceId, id],
    );
    const c = result.rows[0];
    if (
      !c ||
      c.purpose !== purpose ||
      (mobile && mobile !== c.phone) ||
      c.consumed_at ||
      c.attempts >= 5 ||
      new Date(c.expires_at).getTime() <= Date.now()
    )
      return null;
    await client.query(
      "UPDATE client_portal_challenges SET attempts=attempts+1 WHERE id=$1 AND workspace_id=$2",
      [id, workspaceId],
    );
    if (
      !timingSafeEqual(
        Buffer.from(c.code_hash, "hex"),
        Buffer.from(this.codeHash(id, code), "hex"),
      )
    )
      return null;
    await client.query(
      "UPDATE client_portal_challenges SET consumed_at=now() WHERE id=$1 AND workspace_id=$2",
      [id, workspaceId],
    );
    return c.phone as string;
  }
  async login(slug: string, input: unknown) {
    const s = await this.branding(slug),
      b = object(input);
    const result = await this.db.tenantTransaction(
      s.workspaceId,
      actorId,
      async (client) => {
        const mobile = await this.consume(
          client,
          s.workspaceId,
          text(b.challengeId, 80, true),
          text(b.code, 6, true),
          "login",
        );
        if (!mobile) return null;
        const eligible = await client.query(
          `SELECT id FROM client_portal_grants WHERE workspace_id=$1 AND phone=$2 AND active=true AND ($3=false OR test_contact=true)`,
          [s.workspaceId, mobile, this.commercial.testMode],
        );
        if (!eligible.rowCount) return null;
        const token = randomBytes(48).toString("base64url");
        await client.query(
          `INSERT INTO client_portal_sessions(id,workspace_id,phone,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '8 hours')`,
          [randomUUID(), s.workspaceId, mobile, digest(token)],
        );
        return { token, expiresIn: 28800 };
      },
    );
    if (!result)
      throw new UnauthorizedException(
        "The code is invalid or expired. Check your number or request a new code.",
      );
    return result;
  }
  async data(slug: string, token: string) {
    const s = await this.branding(slug);
    return this.db.tenantTransaction(s.workspaceId, actorId, async (client) => {
      const session = await this.session(client, s.workspaceId, token);
      const cases = [];
      for (const grant of session.grants) {
        const record = await this.commercial.caseRecord(
            client,
            s.workspaceId,
            grant.caseId,
          ),
          data = await this.commercial.load(
            client,
            s.workspaceId,
            grant.caseId,
          );
        const project=(await client.query(`SELECT p.id,p.name,e.content,workspace.default_timezone AS timezone FROM delivery_projects p JOIN workspaces workspace ON workspace.id=p.workspace_id JOIN project_execution e ON e.workspace_id=p.workspace_id AND e.project_id=p.id WHERE p.workspace_id=$1 AND p.case_id=$2`,[s.workspaceId,grant.caseId])).rows[0];
        const designs=(await client.query(`SELECT v.id,d.title,d.document_type AS type,v.number,v.status,a.original_name AS name,a.mime_type AS "mimeType" FROM pre_project_design_versions v JOIN pre_project_designs d ON d.workspace_id=v.workspace_id AND d.id=v.design_id JOIN pre_project_brief_assets a ON a.workspace_id=v.workspace_id AND a.id=v.asset_id WHERE v.workspace_id=$1 AND v.case_id=$2 AND d.archived_at IS NULL AND v.status IN ('client_review','approved') AND v.number=(SELECT max(number) FROM pre_project_design_versions WHERE workspace_id=d.workspace_id AND design_id=d.id) ORDER BY d.title,v.number DESC`,[s.workspaceId,grant.caseId])).rows;
        cases.push({
          definitionBaseline: await this.definitions.portalData(
            client,
            s.workspaceId,
            grant.caseId,
            grant,
          ),
          designs,
          materials: (data.materialApprovals ?? [])
            .filter((item) => ["client_review", "approved", "rejected"].includes(item.status))
            .map(({ approverId, decisionChallengeId: _challenge, ...item }) => ({
              ...item,
              canDecide:
                item.status === "client_review" &&
                grant.role === "approver" &&
                approverId === grant.id,
            })),
          project: project
            ? (() => {
                const publicData = publicProject(project.id, project.name, project.content);
                const today = localDate(new Date(), project.timezone ?? "UTC");
                let warrantyReportingReady = true;
                try {
                  warrantyOwnerId(project.content);
                } catch {
                  warrantyReportingReady = false;
                }
                return {
                  ...publicData,
                  handovers: publicData.handovers.map((handover) => ({
                    ...handover,
                    canDecide:
                      handover.status === "ready" &&
                      grant.role === "approver" &&
                      project.content.handovers.some(
                        (candidate: ProjectData["handovers"][number]) =>
                          candidate.id === handover.id &&
                          candidate.clientApproverId === grant.id,
                      ),
                    canReportWarranty:
                      warrantyReportingReady &&
                      handover.status === "accepted" &&
                      Boolean(handover.warrantyUntil) &&
                      handover.warrantyUntil >= today,
                  })),
                };
              })()
            : undefined,
          id: grant.caseId,
          title: record.title,
          customerName: record.customerName,
          role: grant.role,
          quotes: data.quotes
            .filter((q) => q.issuedAt)
            .map((q) => clientQuote(q, grant.id)),
          requests: data.requests.map((r) => ({
            ...r,
            comments: r.comments.filter((c) => c.visibility === "client"),
          })),
          agreement:
            data.agreement?.status === "executed" ? data.agreement : null,
          credits:data.credits?.map(c=>({...c,verifiedBy:undefined,evidence:""})),
          payments: data.payments.map((p) => ({ ...p, verifiedBy: undefined })),
          released: Boolean(data.release),
        });
      }
      return { name: session.grants[0].name, phone: session.phone, cases };
    });
  }
  async projectFile(slug:string,token:string,projectId:string,fileId:string){const settings=await this.branding(slug);return this.db.tenantTransaction(settings.workspaceId,actorId,async client=>{const session=await this.session(client,settings.workspaceId,token);const row=(await client.query(`SELECT p.case_id,e.content FROM delivery_projects p JOIN project_execution e ON e.project_id=p.id AND e.workspace_id=p.workspace_id WHERE p.workspace_id=$1 AND p.id=$2`,[settings.workspaceId,projectId])).rows[0];if(!row||!session.grants.some(g=>g.caseId===row.case_id))throw new NotFoundException("Shared file not available.");const d=row.content as import('../projects/execution.types').ProjectData;const file=d.files?.find(f=>f.id===fileId);const report=d.reports.find(r=>r.status==="approved"&&r.publishedAt&&r.clientFileIds?.includes(fileId)&&r.id===file?.recordId&&!d.reports.some(n=>n.status==="approved"&&n.supersedes===r.id));if(!file||!report)throw new NotFoundException("Shared file not available.");const stored=await this.storage.read(`projects/${settings.workspaceId}/${projectId}/${fileId}`).catch(()=>null);if(!stored)throw new NotFoundException("The shared file is temporarily unavailable.");return {body:stored.body,mimeType:file.mimeType};});}
  async designAsset(slug:string,token:string,versionId:string){const settings=await this.branding(slug);return this.db.tenantTransaction(settings.workspaceId,actorId,async client=>{const session=await this.session(client,settings.workspaceId,token);const asset=(await client.query(`SELECT v.case_id,a.object_key,a.mime_type,a.original_name FROM pre_project_design_versions v JOIN pre_project_designs d ON d.workspace_id=v.workspace_id AND d.id=v.design_id JOIN pre_project_brief_assets a ON a.workspace_id=v.workspace_id AND a.id=v.asset_id WHERE v.workspace_id=$1 AND v.id=$2 AND v.status IN ('client_review','approved') AND d.archived_at IS NULL`,[settings.workspaceId,versionId])).rows[0];if(!asset||!session.grants.some(g=>g.caseId===asset.case_id))throw new NotFoundException("Design not available.");const stored=await this.storage.read(asset.object_key).catch(()=>null);if(!stored)throw new NotFoundException("Design file is unavailable. Contact your project team.");return {body:stored.body,mimeType:asset.mime_type};});}
  async command(slug: string, token: string, input: unknown) {
    const s = await this.branding(slug),
      b = object(input),
      caseId = text(b.caseId, 80, true),
      action = text(b.action, 40, true);
    const result = await this.db.tenantTransaction(
      s.workspaceId,
      actorId,
      async (client) => {
        const session = await this.session(client, s.workspaceId, token),
          grant = session.grants.find((g) => g.caseId === caseId);
        if (!grant)
          throw new ForbiddenException(
            "This pre-execution is not shared with you.",
          );
        await this.commercial.caseRecord(client, s.workspaceId, caseId, true);
        if(action==='design-decision'){
          const versionId=text(b.versionId,80,true),decision=text(b.decision,20,true),note=text(b.note??'',5000,decision==='changes'),challengeId=text(b.challengeId,80,true);
          return decidePortalDesign(client,s.workspaceId,caseId,grant,{versionId,decision,note,challengeId},()=>this.consume(client,s.workspaceId,challengeId,text(b.code,6,true),`design-decision:${caseId}:${versionId}:${decision}`,session.phone));
        }
        if(action==='definition-decision'){
          const baselineId=text(b.baselineId,80,true),decision=text(b.decision,20,true),note=text(b.note??'',5000,b.decision==='changes'),challengeId=text(b.challengeId,80,true);
          if(decision!=='accept'&&decision!=='changes')throw new BadRequestException('Choose confirm or request changes.');
          return this.definitions.decidePortal(
            client,
            s.workspaceId,
            caseId,
            grant,
            {baselineId,decision,note,challengeId},
            ()=>this.consume(client,s.workspaceId,challengeId,text(b.code,6,true),`definition-decision:${caseId}:${baselineId}:${decision}`,session.phone),
          );
        }
        if (action === "handover-decision") {
          const approverGrant = session.grants.find(
            (candidate) => candidate.caseId === caseId && candidate.role === "approver",
          );
          if (!approverGrant)
            throw new ForbiddenException("Only the assigned client approver can decide this handover.");
          const projectId = text(b.projectId, 80, true);
          const handoverId = text(b.handoverId, 80, true);
          const decision = text(b.decision, 20, true);
          if (decision !== "accept" && decision !== "changes")
            throw new BadRequestException("Choose accept or request changes.");
          const note = text(b.note ?? "", 5000, decision === "changes");
          const challengeId = text(b.challengeId, 80, true);
          const project = await client.query<{ content: ProjectData }>(
            `SELECT execution.content
               FROM delivery_projects project
               JOIN project_execution execution
                 ON execution.workspace_id=project.workspace_id AND execution.project_id=project.id
              WHERE project.workspace_id=$1 AND project.case_id=$2 AND project.id=$3
              FOR UPDATE OF project,execution`,
            [s.workspaceId, caseId, projectId],
          );
          if (!project.rowCount)
            throw new NotFoundException("This project handover is not available.");
          const execution = project.rows[0].content;
          const existing = execution.handovers.find((handover) => handover.id === handoverId);
          const expectedStatus = decision === "accept" ? "accepted" : "returned";
          if (
            existing?.decisionChallengeId === challengeId &&
            existing.status === expectedStatus
          )
            return { ok: true, replayed: true };
          const mobile = await this.consume(
            client,
            s.workspaceId,
            challengeId,
            text(b.code, 6, true),
            `handover-decision:${caseId}:${projectId}:${handoverId}:${decision}`,
            session.phone,
          );
          if (!mobile) return { invalidCode: true };
          decideHandoverFromPortal(execution, {
            handoverId,
            grantId: approverGrant.id,
            grantName: approverGrant.name,
            decision,
            note,
            challengeId,
            now: new Date().toISOString(),
          });
          execution.revision++;
          await client.query(
            `UPDATE project_execution
                SET revision=$3,content=$4,updated_at=now()
              WHERE workspace_id=$1 AND project_id=$2`,
            [s.workspaceId, projectId, execution.revision, JSON.stringify(execution)],
          );
          return { ok: true };
        }
        if (action === "warranty-claim") {
          const projectId = text(b.projectId, 80, true);
          const handoverId = text(b.handoverId, 80, true);
          const challengeId = text(b.challengeId, 80, true);
          const project = await client.query<{ content: ProjectData; name: string; timezone: string }>(
            `SELECT execution.content,project.name,workspace.default_timezone AS timezone
               FROM delivery_projects project
               JOIN workspaces workspace ON workspace.id=project.workspace_id
               JOIN project_execution execution
                 ON execution.workspace_id=project.workspace_id AND execution.project_id=project.id
              WHERE project.workspace_id=$1 AND project.case_id=$2 AND project.id=$3
              FOR UPDATE OF project,execution`,
            [s.workspaceId, caseId, projectId],
          );
          if (!project.rowCount)
            throw new NotFoundException("This warranty area is not available.");
          const execution = project.rows[0].content;
          const existing = execution.snags.find(
            (claim) => claim.warrantyClaimChallengeId === challengeId,
          );
          if (existing) return { ok: true, claimId: existing.id, replayed: true };
          const handover = execution.handovers.find((item) => item.id === handoverId);
          if (!handover)
            throw new NotFoundException("This warranty area is not available.");
          assertWarrantyCoverage(execution, {
            handoverId,
            area: handover.area,
            onDate: localDate(new Date(), project.rows[0].timezone ?? "UTC"),
          });
          const ownerId = warrantyOwnerId(execution);
          const activeOwner = await client.query(
            `SELECT 1 FROM workspace_memberships
              WHERE workspace_id=$1 AND id=$2 AND status='active'`,
            [s.workspaceId, ownerId],
          );
          if (!activeOwner.rowCount)
            throw new ConflictException("The project team needs an active warranty owner before reporting can begin.");
          const mobile = await this.consume(
            client,
            s.workspaceId,
            challengeId,
            text(b.code, 6, true),
            `warranty-claim:${caseId}:${projectId}:${handoverId}`,
            session.phone,
          );
          if (!mobile) return { invalidCode: true };
          const now = new Date().toISOString();
          const { claim } = addClientWarrantyClaim(execution, {
            id: randomUUID(),
            challengeId,
            handoverId,
            title: text(b.title, 240, true),
            detail: text(b.detail, 5000, true),
            severity: (() => {
              const value = text(b.severity ?? "minor", 20, true);
              if (!(["minor", "major", "critical"] as string[]).includes(value))
                throw new BadRequestException("Choose a valid urgency.");
              return value as "minor" | "major" | "critical";
            })(),
            reportedBy: grant.name,
            reportedAt: now,
            reportedDate: localDate(now, project.rows[0].timezone ?? "UTC"),
            ownerId,
          });
          execution.audit.push({
            id: randomUUID(),
            at: now,
            author: grant.name,
            action: "warranty_claim",
            recordId: claim.id,
            note: "Client portal warranty report",
          });
          execution.revision++;
          await client.query(
            `UPDATE project_execution
                SET revision=$3,content=$4,updated_at=now()
              WHERE workspace_id=$1 AND project_id=$2`,
            [s.workspaceId, projectId, execution.revision, JSON.stringify(execution)],
          );
          await this.projectNotifications.notifyClientWarrantyClaim(client, {
            workspaceId: s.workspaceId,
            projectId,
            projectName: project.rows[0].name,
            projectReference: execution.controls?.reference,
            ownerMembershipId: ownerId,
            claimId: claim.id,
            title: claim.title,
            handoverTitle: handover.title,
            dueDate: claim.dueDate,
            idempotencyKey: `portal-warranty:${projectId}:${challengeId}`,
          });
          await this.events.record(client, {
            workspaceId: s.workspaceId,
            actorUserId: null,
            source: "system",
            action: "project.warranty.claimed.v1",
            entityType: "delivery_project",
            entityId: projectId,
            after: {
              projectId,
              projectName: project.rows[0].name,
              projectReference: execution.controls?.reference ?? "",
              claim: {
                id: claim.id,
                handoverId,
                area: claim.area,
                severity: claim.severity,
                dueDate: claim.dueDate,
              },
            },
          });
          return { ok: true, claimId: claim.id };
        }
        const data = await this.commercial.load(client, s.workspaceId, caseId);
        let quoteId: string | undefined;
        if (action === "material-decision") {
          const approval = data.materialApprovals?.find(
              (item) => item.id === b.materialApprovalId,
            ),
            decision = text(b.decision, 20, true);
          if (
            !approval ||
            approval.approverId !== grant.id ||
            grant.role !== "approver"
          )
            throw new ForbiddenException("This material approval is not assigned to you.");
          if (!['accept', 'changes'].includes(decision))
            throw new BadRequestException("Choose approve or reject with remarks.");
          if (
            approval.decisionChallengeId === b.challengeId &&
            approval.status === (decision === "accept" ? "approved" : "rejected")
          )
            return { ok: true, replayed: true };
          if (approval.status !== "client_review")
            throw new ConflictException("This material selection is no longer awaiting a decision.");
          const note = text(b.note ?? "", 5000, decision === "changes"),
            challengeId = text(b.challengeId, 80, true),
            mobile = await this.consume(
              client,
              s.workspaceId,
              challengeId,
              text(b.code, 6, true),
              `material-decision:${caseId}:${approval.id}:${decision}`,
              session.phone,
            );
          if (!mobile) return { invalidCode: true };
          approval.status = decision === "accept" ? "approved" : "rejected";
          approval.decidedAt = new Date().toISOString();
          approval.decidedBy = grant.name;
          approval.decisionNote = note;
          approval.decisionChallengeId = challengeId;
        } else if (action === "decision") {
          const q = data.quotes.find((q) => q.id === b.quoteId);
          if (!q || q.approverId !== grant.id || grant.role !== "approver")
            throw new ForbiddenException(
              "This approval is not assigned to you.",
            );
          quoteId = q.id;
          const decision = text(b.decision, 20, true);
          if (!["accept", "changes", "decline"].includes(decision))
            throw new BadRequestException("Choose a valid decision.");
          if (
            q.decisionChallengeId === b.challengeId &&
            q.status ===
              (decision === "accept"
                ? "accepted"
                : decision === "changes"
                  ? "changes_requested"
                  : "declined")
          )
            return { ok: true, replayed: true };
          const controlledRequest = controlledChangeForQuote(data, q.id);
          if (
            controlledRequest &&
            !controlledRequest.control!.quoteIds.every((quoteId) =>
              data.quotes.some(
                (quote) => quote.id === quoteId && quote.status === "issued",
              ),
            )
          )
            throw new ConflictException(
              "The complete Change Case is still being prepared. Review it once every linked document has been issued.",
            );
          actionable(q);
          const note = text(b.note ?? "", 6000, decision !== "accept");
          const mobile = await this.consume(
            client,
            s.workspaceId,
            text(b.challengeId, 80, true),
            text(b.code, 6, true),
            `decision:${caseId}:${q.id}:${decision}`,
            session.phone,
          );
          if (!mobile) return { invalidCode: true };
          if(decision==="accept")validateDeduction(data,q);
          q.status =
            decision === "accept"
              ? "accepted"
              : decision === "changes"
                ? "changes_requested"
                : "declined";
          q.decidedAt = new Date().toISOString();
          q.decidedBy = grant.name;
          q.decisionChallengeId = String(b.challengeId);
          const acceptedForEffects = new Map([[q.id, q]]);
          if (decision === "accept") {
            for (const id of q.requestIds) {
              const request = data.requests.find((item) => item.id === id);
              if (!request || ["declined", "withdrawn", "resolved"].includes(request.status))
                continue;
              if (!request.control) {
                request.status = "resolved";
                request.resolution = `Applied in accepted V${q.number}`;
                continue;
              }
              const caseQuotes = request.control.quoteIds
                .map((quoteId) => data.quotes.find((quote) => quote.id === quoteId))
                .filter((quote): quote is Quote => Boolean(quote));
              if (
                caseQuotes.length === request.control.quoteIds.length &&
                caseQuotes.every((quote) => quote.status === "accepted")
              ) {
                if (!controlledChangeCanRelease(data, request.id))
                  throw new ConflictException(
                    "This Change Case is missing its approved operational disposition. Ask the project team to complete the case before approval.",
                  );
                request.status = "resolved";
                request.resolution = `Applied through accepted Change Case C${request.number}`;
                for (const caseQuote of caseQuotes)
                  acceptedForEffects.set(caseQuote.id, caseQuote);
              } else {
                acceptedForEffects.delete(q.id);
                request.status = "awaiting_decision";
                request.resolution = "";
              }
            }
          } else if (controlledRequest) {
            controlledRequest.status = "under_review";
            controlledRequest.resolution = "";
          }
          if (decision === "changes" && !controlledRequest)
            newRequest(data, `Changes to quotation V${q.number}`, note, q.id);
          if (decision === "accept")
            for (const acceptedQuote of acceptedForEffects.values()) {
              if (
                acceptedQuote.kind === "variation" &&
                acceptedQuote.direction !== "deduction" &&
                data.agreement &&
                !data.payments.some(
                  (payment) => payment.sourceQuoteId === acceptedQuote.id,
                )
              ) {
                let allocated = 0;
                for (const [index, term] of acceptedQuote.paymentTerms.entries()) {
                  const amount =
                    index === acceptedQuote.paymentTerms.length - 1
                      ? Math.round((acceptedQuote.total - allocated) * 100) / 100
                      : Math.round(acceptedQuote.total * term.percent) / 100;
                  allocated += amount;
                  data.payments.push({
                    id: randomUUID(),
                    sourceQuoteId: acceptedQuote.id,
                    title: `Variation V${acceptedQuote.number} · ${term.title}`,
                    trigger: term.trigger,
                    amount,
                    dueDate: "",
                    requiredForRelease: term.requiredForRelease,
                    status: "pending",
                    proof: "",
                    reference: "",
                  });
                }
              }
              if (
                acceptedQuote.kind === "variation" &&
                acceptedQuote.direction === "deduction" &&
                !data.credits?.some((credit) => credit.quoteId === acceptedQuote.id)
              ) {
                data.credits ??= [];
                data.credits.push({
                  id: randomUUID(),
                  quoteId: acceptedQuote.id,
                  amount: acceptedQuote.total,
                  currency: acceptedQuote.currency,
                  status: "pending",
                  reference: "",
                  evidence: "",
                });
              }
            }
          await this.commercial.persist(
            client,
            s.workspaceId,
            caseId,
            data,
            grant.name,
            `Client ${decision}`,
            q.id,
            note,
          );
          return { ok: true };
        } else if (action === "request") {
          newRequest(
            data,
            text(b.title, 240, true),
            text(b.detail, 6000, true),
          );
        } else if (action === "comment") {
          const r = data.requests.find((r) => r.id === b.requestId);
          if (!r) throw new NotFoundException("Request not found.");
          r.comments.push({
            id: randomUUID(),
            author: grant.name,
            at: new Date().toISOString(),
            text: text(b.text, 6000, true),
            visibility: "client",
          });
        } else if (action === "proof") {
          const p = data.payments.find((p) => p.id === b.paymentId);
          if (!p || p.status === "verified")
            throw new ConflictException(
              "This payment cannot receive new evidence.",
            );
          p.proof = text(b.proof, 3000, true);
          p.status = "proof_submitted";
        } else throw new BadRequestException("Unknown client action.");
        await this.commercial.persist(
          client,
          s.workspaceId,
          caseId,
          data,
          grant.name,
          `Client ${action}`,
          quoteId,
        );
        return { ok: true };
      },
    );
    if ("invalidCode" in result)
      throw new UnauthorizedException(
        "The code is invalid or expired. Request a new approval code.",
      );
    return result;
  }
  async logout(slug: string, token: string) {
    const s = await this.branding(slug);
    return this.db.tenantTransaction(s.workspaceId, actorId, async (client) => {
      await client.query(
        "UPDATE client_portal_sessions SET revoked_at=now() WHERE workspace_id=$1 AND token_hash=$2",
        [s.workspaceId, digest(token)],
      );
      return { ok: true };
    });
  }
}
