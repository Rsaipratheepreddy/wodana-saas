import { BadRequestException, Body, Controller, Get, Injectable, Logger, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { DatabaseService } from "../database/database.service";
import { offboardMember, offboardingPreview } from "./member-offboarding";
import { WorkspaceAccessService } from "./workspace-access.service";

const MANAGE = ["module.members.edit", "workspace.members.manage"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Offboarding a person (SP-4): what they hold, and handing it all over in one audited command. */
@Injectable()
export class MemberOffboardingService {
  private readonly logger = new Logger(MemberOffboardingService.name);
  constructor(private readonly access: WorkspaceAccessService, private readonly database: DatabaseService) {}

  preview(actor: RequestActor, workspaceId: string, membershipId: string) {
    return this.access.withAnyPermission(actor, workspaceId, MANAGE, (client) => offboardingPreview(client, workspaceId, membershipId));
  }

  async offboard(actor: RequestActor, workspaceId: string, membershipId: string, body: Record<string, unknown>) {
    const successorMembershipId = typeof body.successorMembershipId === "string" && UUID.test(body.successorMembershipId) ? body.successorMembershipId : null;
    const version = Number(body.version);
    if (!successorMembershipId) throw new BadRequestException("Choose who takes over.");
    if (!Number.isInteger(version) || version < 1) throw new BadRequestException("Reload and try again.");
    const result = await this.access.withAnyPermission(actor, workspaceId, MANAGE, (client, user) =>
      offboardMember(client, { workspaceId, membershipId, successorMembershipId, version, actorUserId: user.userId }));
    // Signed out everywhere once they belong to no other active workspace; otherwise only this one is closed to them.
    const signedOut = await this.revokeSessionsIfNoOtherWorkspace(result.userId);
    return { ...result, signedOut };
  }

  private async revokeSessionsIfNoOtherWorkspace(userId: string) {
    try {
      return await this.database.actorTransaction(userId, async (client) => {
        const other = await client.query(`SELECT 1 FROM workspace_memberships WHERE user_id = $1 AND status = 'active' LIMIT 1`, [userId]);
        if (other.rowCount) return false;
        await client.query(`UPDATE auth_refresh_sessions SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
        return true;
      });
    } catch (error) {
      // The membership is already suspended, so the workspace is closed to them; a session left open expires.
      this.logger.warn(`Sessions were not revoked after offboarding: ${(error as Error).message}`);
      return false;
    }
  }
}

@ApiTags("workspaces")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/members/:membershipId/offboarding")
export class MemberOffboardingController {
  constructor(private readonly offboarding: MemberOffboardingService) {}

  @Get()
  @ApiOperation({ summary: "What a person still holds, by module, and who can take it over" })
  preview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("membershipId", ParseUUIDPipe) membershipId: string) {
    return this.offboarding.preview(actor, workspaceId, membershipId);
  }

  @Post()
  @ApiOperation({ summary: "Hand everything to a successor, sign the person out and suspend them" })
  offboard(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("membershipId", ParseUUIDPipe) membershipId: string,
    @Body() body: Record<string, unknown>) {
    return this.offboarding.offboard(actor, workspaceId, membershipId, body ?? {});
  }
}
