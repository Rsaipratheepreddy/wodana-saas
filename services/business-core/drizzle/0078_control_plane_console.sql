-- Control plane (master plan §6.1): support sessions gain the approved step and a time box that starts
-- when the operator starts it; lifecycle changes can be made by the automation (grace → suspend) and say
-- whether their notices were delivered; domains remember their checks; every notice to a tenant owner
-- or an operator is a row with its own delivery status.

-- Support sessions: requested → approved → active → expired | revoked (or rejected).
ALTER TABLE tenant_support_sessions DROP CONSTRAINT tenant_support_sessions_status_check;
--> statement-breakpoint
ALTER TABLE tenant_support_sessions DROP CONSTRAINT tenant_support_sessions_time_check;
--> statement-breakpoint
ALTER TABLE tenant_support_sessions
  ADD COLUMN duration_minutes integer,
  ADD COLUMN ended_by uuid REFERENCES users(id),
  ADD COLUMN end_reason varchar(40),
  ADD COLUMN decision_note varchar(500),
  ADD COLUMN idempotency_key varchar(160),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
UPDATE tenant_support_sessions
   SET status = 'expired', end_reason = 'expired', ended_at = COALESCE(ended_at, expires_at)
 WHERE status IN ('requested', 'active') AND expires_at <= now();
--> statement-breakpoint
UPDATE tenant_support_sessions
   SET duration_minutes = LEAST(480, GREATEST(15, ceil(extract(epoch FROM (expires_at - COALESCE(starts_at, requested_at))) / 60)::integer));
--> statement-breakpoint
ALTER TABLE tenant_support_sessions
  ALTER COLUMN duration_minutes SET NOT NULL,
  ADD CONSTRAINT tenant_support_sessions_status_check
    CHECK (status IN ('requested', 'approved', 'active', 'rejected', 'revoked', 'expired')),
  ADD CONSTRAINT tenant_support_sessions_duration_check CHECK (duration_minutes BETWEEN 15 AND 480),
  ADD CONSTRAINT tenant_support_sessions_time_check
    CHECK (expires_at > requested_at AND expires_at <= COALESCE(starts_at, requested_at) + interval '24 hours'),
  ADD CONSTRAINT tenant_support_sessions_active_check
    CHECK (status NOT IN ('active') OR (starts_at IS NOT NULL AND approved_by IS NOT NULL)),
  ADD CONSTRAINT tenant_support_sessions_end_reason_check
    CHECK (end_reason IS NULL OR end_reason IN ('operator', 'rejected', 'expired', 'operator_role_changed', 'tenant_archived'));
--> statement-breakpoint
CREATE UNIQUE INDEX tenant_support_sessions_request_key_uidx
  ON tenant_support_sessions (workspace_id, requested_by, idempotency_key) WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX tenant_support_sessions_open_uidx
  ON tenant_support_sessions (workspace_id, requested_by) WHERE status IN ('requested', 'approved', 'active');
--> statement-breakpoint

-- Lifecycle: the automation (payment past due → grace → suspended) writes its own versions, and a
-- version's notice state is pending until its notices report back.
ALTER TABLE tenant_lifecycle_versions DROP CONSTRAINT tenant_lifecycle_notice_check;
--> statement-breakpoint
ALTER TABLE tenant_lifecycle_versions
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN automated boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT tenant_lifecycle_notice_check
    CHECK (notice_delivery_state IN ('not_required', 'not_configured', 'pending')),
  ADD CONSTRAINT tenant_lifecycle_actor_check
    CHECK ((automated AND created_by IS NULL) OR (NOT automated AND created_by IS NOT NULL));
--> statement-breakpoint
CREATE POLICY tenant_lifecycle_automation_insert ON tenant_lifecycle_versions FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
    AND automated AND created_by IS NULL);
--> statement-breakpoint

-- Domains remember when ownership was last checked, so "verifying" and "ownership lost" are facts.
ALTER TABLE workspace_domains
  ADD COLUMN last_checked_at timestamptz,
  ADD COLUMN check_count integer NOT NULL DEFAULT 0 CHECK (check_count >= 0),
  ADD COLUMN ownership_lost_at timestamptz;
--> statement-breakpoint

-- One row per notice (tenant owner or Wodana operator, in-app or email) with its own delivery status.
-- Owner notices point at the notification the worker delivers; operator emails are sent directly.
CREATE TABLE tenant_control_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type varchar(60) NOT NULL CHECK (event_type IN (
    'lifecycle.trial_started', 'lifecycle.activated', 'lifecycle.grace_started', 'lifecycle.suspended',
    'lifecycle.reactivated', 'lifecycle.archived', 'billing.past_due', 'domain.ownership_lost', 'domain.live')),
  source_type varchar(40) NOT NULL CHECK (source_type IN ('lifecycle_version', 'domain', 'billing_document')),
  source_id uuid NOT NULL,
  audience varchar(20) NOT NULL CHECK (audience IN ('tenant_owner', 'operator')),
  channel varchar(20) NOT NULL CHECK (channel IN ('in_app', 'email')),
  recipient_user_id uuid REFERENCES users(id),
  recipient_email citext,
  notification_id uuid,
  subject varchar(200) NOT NULL,
  body text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'not_configured', 'skipped')),
  skip_reason varchar(40),
  provider varchar(40),
  provider_message_id varchar(255),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempted_at timestamptz,
  idempotency_key varchar(200) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (recipient_user_id IS NOT NULL OR recipient_email IS NOT NULL),
  UNIQUE (workspace_id, idempotency_key)
);
--> statement-breakpoint
CREATE INDEX tenant_control_notices_source_idx ON tenant_control_notices (workspace_id, source_type, source_id);
--> statement-breakpoint
CREATE INDEX tenant_control_notices_recent_idx ON tenant_control_notices (workspace_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE tenant_control_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_control_notices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant_control_notices
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON tenant_control_notices TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint

-- The accounts list reads control facts across tenants (never business records). Only an active
-- Wodana operator, set as the transaction's actor, may call it.
CREATE FUNCTION control_plane_directory()
RETURNS TABLE (
  account_id uuid, account_name varchar, account_status varchar, external_customer_id varchar,
  contract_contact_email text, organization_limit integer,
  workspace_id uuid, external_tenant_id varchar, organization_name varchar, slug varchar,
  workspace_status text, is_default boolean, lifecycle_state varchar, lifecycle_version integer,
  grace_ends_at timestamptz, onboarding_status text, subscription_status varchar,
  plan_code varchar, plan_version integer, contract_status varchar, trial_ends_at timestamptz, seat_limit integer,
  active_members integer, invited_members integer, pending_invitations integer,
  owner_email text, owner_invitation_status text, owner_delivery_status varchar,
  last_activity_at timestamptz, created_at timestamptz,
  open_support boolean, domain_attention boolean, payment_past_due boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM platform_administrators operator
     WHERE operator.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid
       AND operator.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Wodana operator access is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT account.id, account.display_name, account.status, account.external_customer_id,
         account.contract_contact_email::text, account.organization_limit,
         workspace.id, request.external_tenant_id, workspace.name, workspace.slug,
         workspace.status::text, linked.is_default, lifecycle.state, lifecycle.version, lifecycle.grace_ends_at,
         onboarding.status::text, subscription.status,
         COALESCE(contract.plan_code, subscription.plan_code), contract.plan_version, contract.status, contract.trial_ends_at,
         subscription.seat_limit,
         (SELECT count(*)::integer FROM workspace_memberships m WHERE m.workspace_id = workspace.id AND m.status = 'active'),
         (SELECT count(*)::integer FROM workspace_memberships m WHERE m.workspace_id = workspace.id AND m.status = 'invited'),
         (SELECT count(*)::integer FROM workspace_invitations i
           WHERE i.workspace_id = workspace.id AND i.status = 'pending' AND i.expires_at > now()),
         owner_invitation.email::text, owner_invitation.status, owner_invitation.delivery_status,
         (SELECT max(event.occurred_at) FROM audit_events event WHERE event.workspace_id = workspace.id),
         workspace.created_at,
         EXISTS (SELECT 1 FROM tenant_support_sessions support WHERE support.workspace_id = workspace.id
                  AND support.status IN ('requested', 'approved', 'active') AND support.expires_at > now()),
         EXISTS (SELECT 1 FROM workspace_domains domain WHERE domain.workspace_id = workspace.id
                  AND domain.removed_at IS NULL
                  AND (domain.dns_status = 'failed' OR domain.routing_status = 'failed'
                       OR domain.rollback_status IN ('pending', 'failed'))),
         EXISTS (SELECT 1 FROM account_billing_documents document WHERE document.account_id = account.id
                  AND document.document_type = 'invoice'
                  AND (document.status = 'past_due' OR (document.status = 'issued' AND document.due_at < now())))
           OR COALESCE((SELECT collection.status IN ('past_due', 'collections')
                          FROM account_collection_state_versions collection
                         WHERE collection.account_id = account.id ORDER BY collection.version DESC LIMIT 1), false)
    FROM customer_accounts account
    JOIN customer_account_organizations linked ON linked.account_id = account.id
    JOIN workspaces workspace ON workspace.id = linked.workspace_id
    LEFT JOIN tenant_provisioning_requests request ON request.workspace_id = workspace.id
    LEFT JOIN workspace_onboarding onboarding ON onboarding.workspace_id = workspace.id
    LEFT JOIN workspace_subscriptions subscription ON subscription.workspace_id = workspace.id
    LEFT JOIN customer_account_contracts contract ON contract.account_id = account.id
    LEFT JOIN LATERAL (
      SELECT version.state, version.version, version.grace_ends_at FROM tenant_lifecycle_versions version
       WHERE version.workspace_id = workspace.id ORDER BY version.version DESC LIMIT 1
    ) lifecycle ON true
    LEFT JOIN LATERAL (
      SELECT invitation.email,
             CASE WHEN invitation.status = 'pending' AND invitation.expires_at <= now() THEN 'expired'
                  ELSE invitation.status::text END AS status,
             delivery.status AS delivery_status
        FROM workspace_invitations invitation
        LEFT JOIN workspace_invitation_delivery delivery ON delivery.invitation_id = invitation.id
       WHERE invitation.workspace_id = workspace.id
       ORDER BY invitation.created_at LIMIT 1
    ) owner_invitation ON true
   WHERE request.external_tenant_id IS NULL OR request.external_tenant_id NOT LIKE 'auth-smoke-%';
END $$;
--> statement-breakpoint
-- The control-plane sweep (grace, support expiry, domain checks) enumerates organizations here, then
-- works inside each one in its own tenant transaction.
CREATE FUNCTION list_control_plane_workspaces() RETURNS TABLE (workspace_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT workspace.id FROM workspaces workspace
   WHERE workspace.status <> 'archived'
      OR EXISTS (SELECT 1 FROM tenant_support_sessions support WHERE support.workspace_id = workspace.id
                  AND support.status IN ('requested', 'approved', 'active'))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION control_plane_directory() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION list_control_plane_workspaces() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION control_plane_directory() TO wodana_app;
    GRANT EXECUTE ON FUNCTION list_control_plane_workspaces() TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint

-- Owner notices. Tenants edit their copies; the organization name and dates are the only variables.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body,
       '["organization", "date", "domain", "address"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('account.trial_started', 'in_app', '{{organization}} trial started', 'Your trial runs until {{date}}.'),
  ('account.trial_started', 'email', '{{organization}} trial started', E'Your {{organization}} workspace is on trial until {{date}}.\n\nSign in at {{address}} to continue setting it up.'),
  ('account.activated', 'in_app', '{{organization}} is active', 'Your workspace is active.'),
  ('account.activated', 'email', '{{organization}} is active', E'Your {{organization}} workspace is active.\n\nSign in at {{address}}.'),
  ('account.grace_started', 'in_app', 'Payment due by {{date}}', 'Settle the open invoice by {{date}} to keep full access.'),
  ('account.grace_started', 'email', 'Payment due by {{date}} for {{organization}}', E'A payment for {{organization}} is past due.\n\nSettle it by {{date}} to keep full access. After that date the workspace becomes read-only until payment is received.'),
  ('account.suspended', 'in_app', '{{organization}} is read-only', 'Changes are paused. Your data and exports stay available.'),
  ('account.suspended', 'email', '{{organization}} is read-only', E'Changes to {{organization}} are paused.\n\nYou can still sign in, read your records and export them. Contact us to restore full access.'),
  ('account.reactivated', 'in_app', '{{organization}} is active again', 'Full access is restored.'),
  ('account.reactivated', 'email', '{{organization}} is active again', E'Full access to {{organization}} is restored.\n\nSign in at {{address}}.'),
  ('account.archived', 'email', '{{organization}} is archived', E'The {{organization}} workspace is archived.\n\nContact us if you need a copy of your data.'),
  ('account.payment_past_due', 'in_app', 'Payment past due', 'An invoice for {{organization}} is past due.'),
  ('account.payment_past_due', 'email', 'Payment past due for {{organization}}', E'An invoice for {{organization}} is past due.\n\nPlease settle it to avoid interruption.'),
  ('account.domain_ownership_lost', 'in_app', '{{domain}} is not connected', 'Sign in at {{address}} until the DNS record is restored.'),
  ('account.domain_ownership_lost', 'email', '{{domain}} is not connected', E'We could no longer find the DNS record that proves {{organization}} owns {{domain}}.\n\nSign in at {{address}} in the meantime, and restore the record to reconnect the domain.'),
  ('account.domain_live', 'in_app', '{{domain}} is live', 'Sign in at {{domain}}.'),
  ('account.domain_live', 'email', '{{domain}} is live', E'{{organization}} now signs in at {{domain}}.')
) AS template (code, channel, subject, body)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
