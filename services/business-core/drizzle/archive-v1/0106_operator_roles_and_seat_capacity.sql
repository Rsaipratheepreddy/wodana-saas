ALTER TABLE platform_administrators
  DROP CONSTRAINT platform_administrators_role_check;
ALTER TABLE platform_administrators
  ADD CONSTRAINT platform_administrators_role_check CHECK (role IN (
    'administrator',
    'platform_security_owner',
    'provisioning_operator',
    'account_billing_operator',
    'domain_operator',
    'support_observer'
  ));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION workspace_seat_capacity(
  target_workspace_id uuid,
  excluded_invitation_id uuid DEFAULT NULL
)
RETURNS TABLE(
  seat_limit integer,
  active_members integer,
  invited_members integer,
  pending_invitations integer,
  reserved_seats integer,
  available_seats integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT subscription.seat_limit,
    counts.active_members,
    counts.invited_members,
    counts.pending_invitations,
    counts.active_members + counts.invited_members + counts.pending_invitations AS reserved_seats,
    GREATEST(
      subscription.seat_limit - counts.active_members - counts.invited_members - counts.pending_invitations,
      0
    )::integer AS available_seats
  FROM workspace_subscriptions subscription
  CROSS JOIN LATERAL (
    SELECT
      (SELECT count(*)::integer
       FROM workspace_memberships membership
       WHERE membership.workspace_id = subscription.workspace_id
         AND membership.status = 'active') AS active_members,
      (SELECT count(*)::integer
       FROM workspace_memberships membership
       WHERE membership.workspace_id = subscription.workspace_id
         AND membership.status = 'invited') AS invited_members,
      (SELECT count(*)::integer
       FROM workspace_invitations invitation
       WHERE invitation.workspace_id = subscription.workspace_id
         AND invitation.status = 'pending'
         AND invitation.expires_at > now()
         AND (excluded_invitation_id IS NULL OR invitation.id <> excluded_invitation_id)) AS pending_invitations
  ) counts
  WHERE subscription.workspace_id = target_workspace_id;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION workspace_seat_capacity(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT EXECUTE ON FUNCTION workspace_seat_capacity(uuid, uuid) TO wodana_app;
  END IF;
END $$;
