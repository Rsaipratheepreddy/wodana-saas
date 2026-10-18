-- Tenant context is set transaction-locally by Business Core.
-- FORCE protects even when application queries accidentally omit workspace filters.
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;
CREATE POLICY "workspace_tenant_isolation" ON "workspaces"
USING (
  "id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
)
WITH CHECK (
  "id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
);
--> statement-breakpoint

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workspace_memberships',
    'workspace_invitations',
    'invitation_roles',
    'roles',
    'role_permissions',
    'member_roles',
    'legal_entities',
    'business_units',
    'exchange_rates',
    'tax_profiles',
    'document_sequences',
    'integration_connections',
    'integration_resources',
    'sync_cursors',
    'audit_events',
    'idempotency_keys',
    'outbox_events',
    'webhook_inbox'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (workspace_id = NULLIF(current_setting(''app.current_workspace_id'', true), '''')::uuid) WITH CHECK (workspace_id = NULLIF(current_setting(''app.current_workspace_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- Membership discovery is actor-scoped so the workspace switcher can be loaded
-- before a workspace context has been selected.
CREATE POLICY "membership_self_discovery" ON "workspace_memberships"
FOR SELECT
USING (
  "user_id" = NULLIF(current_setting('app.current_actor_id', true), '')::uuid
);
CREATE POLICY "workspace_self_discovery" ON "workspaces"
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM "workspace_memberships" membership
    WHERE membership.workspace_id = workspaces.id
      AND membership.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid
      AND membership.status = 'active'
  )
);
CREATE POLICY "invitation_token_discovery" ON "workspace_invitations"
FOR SELECT
USING (
  "token_hash" = NULLIF(current_setting('app.current_invitation_token_hash', true), '')
);
--> statement-breakpoint

-- Prevent a tenant-scoped row from referencing a parent record in another workspace.
CREATE OR REPLACE FUNCTION enforce_same_workspace_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_workspace_id uuid;
  referenced_id uuid;
BEGIN
  referenced_id := NULLIF(to_jsonb(NEW) ->> TG_ARGV[1], '')::uuid;
  IF referenced_id IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT workspace_id FROM %I WHERE id = $1', TG_ARGV[0])
    INTO referenced_workspace_id
    USING referenced_id;

  IF referenced_workspace_id IS NULL OR referenced_workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'Cross-workspace reference rejected for %.%', TG_TABLE_NAME, TG_ARGV[1]
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "business_units_legal_entity_workspace_guard"
BEFORE INSERT OR UPDATE ON "business_units"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('legal_entities', 'legal_entity_id');
CREATE TRIGGER "business_units_parent_workspace_guard"
BEFORE INSERT OR UPDATE ON "business_units"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('business_units', 'parent_business_unit_id');
CREATE TRIGGER "role_permissions_role_workspace_guard"
BEFORE INSERT OR UPDATE ON "role_permissions"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('roles', 'role_id');
CREATE TRIGGER "member_roles_membership_workspace_guard"
BEFORE INSERT OR UPDATE ON "member_roles"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('workspace_memberships', 'membership_id');
CREATE TRIGGER "member_roles_role_workspace_guard"
BEFORE INSERT OR UPDATE ON "member_roles"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('roles', 'role_id');
CREATE TRIGGER "invitation_roles_invitation_workspace_guard"
BEFORE INSERT OR UPDATE ON "invitation_roles"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('workspace_invitations', 'invitation_id');
CREATE TRIGGER "invitation_roles_role_workspace_guard"
BEFORE INSERT OR UPDATE ON "invitation_roles"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('roles', 'role_id');
CREATE TRIGGER "tax_profiles_legal_entity_workspace_guard"
BEFORE INSERT OR UPDATE ON "tax_profiles"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('legal_entities', 'legal_entity_id');
CREATE TRIGGER "document_sequences_legal_entity_workspace_guard"
BEFORE INSERT OR UPDATE ON "document_sequences"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('legal_entities', 'legal_entity_id');
CREATE TRIGGER "integration_connections_legal_entity_workspace_guard"
BEFORE INSERT OR UPDATE ON "integration_connections"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('legal_entities', 'legal_entity_id');
CREATE TRIGGER "integration_resources_connection_workspace_guard"
BEFORE INSERT OR UPDATE ON "integration_resources"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('integration_connections', 'connection_id');
CREATE TRIGGER "sync_cursors_connection_workspace_guard"
BEFORE INSERT OR UPDATE ON "sync_cursors"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('integration_connections', 'connection_id');
CREATE TRIGGER "sync_cursors_resource_workspace_guard"
BEFORE INSERT OR UPDATE ON "sync_cursors"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('integration_resources', 'resource_id');
CREATE TRIGGER "webhook_inbox_connection_workspace_guard"
BEFORE INSERT OR UPDATE ON "webhook_inbox"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('integration_connections', 'connection_id');
--> statement-breakpoint

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users',
    'user_identities',
    'workspaces',
    'workspace_memberships',
    'workspace_invitations',
    'roles',
    'legal_entities',
    'business_units',
    'tax_profiles',
    'document_sequences',
    'integration_connections',
    'integration_resources',
    'sync_cursors'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      table_name
    );
  END LOOP;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "audit_events_append_only"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
--> statement-breakpoint

INSERT INTO "permissions" ("code", "description") VALUES
  ('workspace.settings.manage', 'Manage workspace regional and operating settings'),
  ('workspace.members.manage', 'Invite, suspend, and assign roles to members'),
  ('workspace.roles.manage', 'Create roles and assign permissions'),
  ('legal_entities.view', 'View legal entities and business units'),
  ('legal_entities.manage', 'Create and update legal entities and business units'),
  ('integrations.view', 'View integration connections and sync state'),
  ('integrations.manage', 'Create, reconnect, configure, and revoke integrations'),
  ('audit.view', 'View workspace audit history'),
  ('finance.settings.manage', 'Manage tax, currency, and document sequence settings')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- Bootstrap reference data. Currency validation remains ISO-code based so new codes
-- can be accepted before this cache is refreshed from the official ISO data feed.
INSERT INTO "currencies" ("code", "numeric_code", "name", "minor_unit") VALUES
  ('AED', '784', 'UAE Dirham', 2),
  ('AUD', '036', 'Australian Dollar', 2),
  ('BHD', '048', 'Bahraini Dinar', 3),
  ('CAD', '124', 'Canadian Dollar', 2),
  ('CHF', '756', 'Swiss Franc', 2),
  ('CNY', '156', 'Yuan Renminbi', 2),
  ('EUR', '978', 'Euro', 2),
  ('GBP', '826', 'Pound Sterling', 2),
  ('INR', '356', 'Indian Rupee', 2),
  ('JPY', '392', 'Yen', 0),
  ('KWD', '414', 'Kuwaiti Dinar', 3),
  ('OMR', '512', 'Rial Omani', 3),
  ('QAR', '634', 'Qatari Rial', 2),
  ('SAR', '682', 'Saudi Riyal', 2),
  ('SGD', '702', 'Singapore Dollar', 2),
  ('USD', '840', 'US Dollar', 2)
ON CONFLICT ("code") DO UPDATE SET
  "numeric_code" = EXCLUDED."numeric_code",
  "name" = EXCLUDED."name",
  "minor_unit" = EXCLUDED."minor_unit",
  "active" = true,
  "updated_at" = now();
