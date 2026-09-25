import { ConflictException, GoneException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { notifyUserInApp } from "../notifications/default-templates";

type Db = Pick<PoolClient, "query">;

/**
 * The only way a pending invitation becomes a membership, whichever sign-in path accepts it
 * (existing account or first password). Runs in the caller's transaction with the tenant context
 * set: locks the workspace, enforces the seat limit, creates the membership with the invited roles
 * and teams, marks the invitation accepted and tells the inviter.
 */
export async function acceptPendingInvitation(db: Db, input: { invitationId: string; userId: string }) {
  const workspace = await db.query<{ id: string; name: string }>(
    `SELECT workspace.id, workspace.name FROM workspaces workspace
     JOIN workspace_invitations invitation ON invitation.workspace_id = workspace.id
     WHERE invitation.id = $1 AND workspace.status = 'active'
     FOR UPDATE OF workspace`,
    [input.invitationId],
  );
  if (!workspace.rowCount) throw new NotFoundException("Invitation not found");
  const workspaceId = workspace.rows[0].id;
  const locked = await db.query<{ status: string; expiresAt: Date; invitedBy: string | null }>(
    `SELECT status, expires_at AS "expiresAt", invited_by AS "invitedBy"
     FROM workspace_invitations WHERE id = $1 FOR UPDATE`,
    [input.invitationId],
  );
  const invitation = locked.rows[0];
  if (!invitation) throw new NotFoundException("Invitation not found");
  if (invitation.status !== "pending") throw new ConflictException(`Invitation is already ${invitation.status}`);
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) throw new GoneException("Invitation has expired");

  // This invitation already holds a seat; accepting must still fit if the limit was lowered since.
  const capacity = await db.query<{ seatLimit: number; reservedSeats: number }>(
    `SELECT seat_limit AS "seatLimit", reserved_seats AS "reservedSeats" FROM workspace_seat_capacity($1, $2)`,
    [workspaceId, input.invitationId],
  );
  if (!capacity.rowCount) throw new ConflictException("Workspace subscription is not configured");
  if (capacity.rows[0].reservedSeats >= capacity.rows[0].seatLimit) {
    throw new ConflictException({ message: "Workspace seat limit reached", seatLimit: capacity.rows[0].seatLimit });
  }

  const membership = await db.query<{ id: string }>(
    `INSERT INTO workspace_memberships (workspace_id, user_id, status, joined_at)
     VALUES ($1, $2, 'active', now())
     ON CONFLICT (workspace_id, user_id)
     DO UPDATE SET status = 'active', joined_at = COALESCE(workspace_memberships.joined_at, now()), updated_at = now()
     RETURNING id`,
    [workspaceId, input.userId],
  );
  const membershipId = membership.rows[0].id;
  await db.query(
    `INSERT INTO member_roles (workspace_id, membership_id, role_id)
     SELECT $1, $2, role_id FROM invitation_roles WHERE invitation_id = $3
     ON CONFLICT (membership_id, role_id) DO NOTHING`,
    [workspaceId, membershipId, input.invitationId],
  );
  await db.query(
    `INSERT INTO workspace_team_members (workspace_id, team_id, membership_id, is_lead)
     SELECT invited_team.workspace_id, invited_team.team_id, $2, false
     FROM invitation_teams invited_team JOIN workspace_teams team ON team.id = invited_team.team_id
     WHERE invited_team.invitation_id = $1 AND team.status = 'active'
     ON CONFLICT (team_id, membership_id) DO NOTHING`,
    [input.invitationId, membershipId],
  );
  await db.query(
    `UPDATE workspace_invitations SET status = 'accepted', accepted_at = now(), updated_at = now() WHERE id = $1`,
    [input.invitationId],
  );

  if (invitation.invitedBy && invitation.invitedBy !== input.userId) {
    const member = await db.query<{ displayName: string }>(`SELECT display_name AS "displayName" FROM users WHERE id = $1`, [input.userId]);
    await notifyUserInApp(db, {
      workspaceId,
      recipientUserId: invitation.invitedBy,
      code: "workspace.member_joined",
      eventType: "workspace.member_joined",
      variables: { memberName: member.rows[0]?.displayName ?? "", workspaceName: workspace.rows[0].name },
      deepLink: "/workspace/members",
      idempotencyKey: `member-joined:${input.invitationId}`,
    });
  }
  return { workspaceId, membershipId };
}
