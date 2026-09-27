-- Client portal on the current records. What clients see is the tenant's choice (sections, what progress
-- shows, whether invoice amounts show), per project it can be narrowed or paused, and staff share each status
-- update and site photo on purpose. Clients sign in with their mobile number (code by WhatsApp, or by email
-- as the fallback), stay signed in for 30 days of use, and decide on the exact revision they were sent:
-- quotations and variations, designs, the material list and handover packs. Warranty claims come in from the
-- portal with the client contact as their author. Every portal command is idempotent and audited.

-- What clients see, as columns (the welcome text and support contacts move out of the old brand JSON; the
-- brand itself always comes from the tenant branding record).
ALTER TABLE client_portal_settings
  ADD COLUMN show_progress boolean NOT NULL DEFAULT true,
  ADD COLUMN show_decisions boolean NOT NULL DEFAULT true,
  ADD COLUMN show_payments boolean NOT NULL DEFAULT true,
  ADD COLUMN show_documents boolean NOT NULL DEFAULT true,
  ADD COLUMN show_warranty boolean NOT NULL DEFAULT true,
  ADD COLUMN show_messages boolean NOT NULL DEFAULT true,
  ADD COLUMN progress_stage_names boolean NOT NULL DEFAULT true,
  ADD COLUMN progress_dates boolean NOT NULL DEFAULT true,
  ADD COLUMN progress_updates boolean NOT NULL DEFAULT true,
  ADD COLUMN progress_photos boolean NOT NULL DEFAULT true,
  ADD COLUMN show_invoice_amounts boolean NOT NULL DEFAULT true,
  ADD COLUMN welcome_title varchar(120) NOT NULL DEFAULT '',
  ADD COLUMN welcome_text varchar(500) NOT NULL DEFAULT '',
  ADD COLUMN support_phone varchar(20) NOT NULL DEFAULT '',
  ADD COLUMN support_email varchar(254) NOT NULL DEFAULT '',
  ADD COLUMN support_whatsapp varchar(20) NOT NULL DEFAULT '',
  ADD COLUMN updated_by uuid REFERENCES users (id);
--> statement-breakpoint
UPDATE client_portal_settings
   SET welcome_title = left(coalesce(brand->>'welcomeTitle', ''), 120),
       welcome_text = left(coalesce(brand->>'welcomeText', ''), 500),
       support_phone = left(coalesce(brand->>'supportPhone', ''), 20);
--> statement-breakpoint
ALTER TABLE client_portal_settings DROP COLUMN brand;
--> statement-breakpoint
ALTER TABLE client_portal_settings
  ADD CONSTRAINT client_portal_settings_support_email_check CHECK (support_email = '' OR support_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  ADD CONSTRAINT client_portal_settings_support_phone_check CHECK (support_phone = '' OR support_phone ~ '^\+[1-9][0-9]{6,14}$'),
  ADD CONSTRAINT client_portal_settings_support_whatsapp_check CHECK (support_whatsapp = '' OR support_whatsapp ~ '^\+[1-9][0-9]{6,14}$');
--> statement-breakpoint
-- A client contact: their email is where codes and notices go when WhatsApp can't; they confirm their name
-- the first time they sign in.
ALTER TABLE client_portal_grants
  ADD COLUMN email varchar(254),
  ADD COLUMN confirmed_name varchar(160),
  ADD COLUMN name_confirmed_at timestamptz,
  ADD COLUMN last_signed_in_at timestamptz,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT client_portal_grants_email_check CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  ADD CONSTRAINT client_portal_grants_confirmed_check CHECK ((confirmed_name IS NULL) = (name_confirmed_at IS NULL)),
  ADD CONSTRAINT client_portal_grants_version_check CHECK (version > 0);
--> statement-breakpoint
-- A code goes by WhatsApp or by email; requests are counted per number and per requester (hashed address).
ALTER TABLE client_portal_challenges
  ADD COLUMN channel varchar(10) NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'email')),
  ADD COLUMN requester char(64);
--> statement-breakpoint
CREATE INDEX client_portal_challenge_requester_idx ON client_portal_challenges (workspace_id, requester, created_at DESC) WHERE requester IS NOT NULL;
--> statement-breakpoint
-- Sessions last while they're used (30 days without use ends one) up to a hard limit, and staff can end them.
ALTER TABLE client_portal_sessions
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN revoked_reason varchar(40);
--> statement-breakpoint
CREATE INDEX client_portal_sessions_phone_idx ON client_portal_sessions (workspace_id, phone) WHERE revoked_at IS NULL;
--> statement-breakpoint
-- Per project: the sections this client sees (a subset of the workspace's; none set follows the workspace),
-- and a pause that hides the project from the portal and stops its notices.
CREATE TABLE client_portal_project_access (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  sections text[],
  paused_at timestamptz,
  paused_by uuid REFERENCES users (id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  CHECK (sections IS NULL OR sections <@ ARRAY['progress', 'decisions', 'payments', 'documents', 'warranty', 'messages']::text[]),
  CHECK ((paused_at IS NULL) = (paused_by IS NULL))
);
--> statement-breakpoint
-- Every portal command once: a replay with the same body returns what the first one did.
CREATE TABLE client_portal_commands (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  grant_id uuid REFERENCES client_portal_grants (id),
  action varchar(40) NOT NULL,
  request_hash char(64) NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
--> statement-breakpoint
-- Staff share status updates and site photos with the client on purpose.
ALTER TABLE project_status_updates
  ADD COLUMN shared_at timestamptz,
  ADD COLUMN shared_by uuid REFERENCES users (id),
  ADD CONSTRAINT project_status_updates_shared_check CHECK ((shared_at IS NULL) = (shared_by IS NULL));
--> statement-breakpoint
ALTER TABLE site_report_photos
  ADD COLUMN shared_at timestamptz,
  ADD COLUMN shared_by uuid REFERENCES users (id),
  ADD CONSTRAINT site_report_photos_shared_check CHECK ((shared_at IS NULL) = (shared_by IS NULL));
--> statement-breakpoint
-- The client decides a handover pack in the portal: their contact is the record of who decided.
ALTER TABLE handover_packs
  ADD COLUMN decided_by_grant_id uuid REFERENCES client_portal_grants (id);
--> statement-breakpoint
ALTER TABLE handover_packs DROP CONSTRAINT handover_packs_check2;
--> statement-breakpoint
ALTER TABLE handover_packs ADD CONSTRAINT handover_packs_decision_check CHECK (
  (status IN ('accepted', 'refused')) = (decided_on IS NOT NULL AND decided_by_name IS NOT NULL AND decision_method IS NOT NULL
    AND (recorded_by IS NOT NULL OR (decision_method = 'portal' AND decided_by_grant_id IS NOT NULL))));
--> statement-breakpoint
-- A material list revision signed in the portal.
ALTER TABLE project_material_revisions
  ADD COLUMN decided_by_grant_id uuid REFERENCES client_portal_grants (id);
--> statement-breakpoint
-- A warranty claim raised by the client in the portal has their contact as its author, not a staff user.
ALTER TABLE warranty_claims
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN client_grant_id uuid REFERENCES client_portal_grants (id),
  ADD CONSTRAINT warranty_claims_author_check CHECK (created_by IS NOT NULL OR (channel = 'portal' AND client_grant_id IS NOT NULL));
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_portal_settings', 'client_portal_project_access', 'client_portal_commands'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON client_portal_project_access TO wodana_app;
    GRANT SELECT, INSERT ON client_portal_commands TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- The portal is found by its link, the tenant's own domain or the tenant's sign-in subdomain before any
-- tenant is known: these return only an enabled portal's workspace and link.
CREATE FUNCTION client_portal_site(candidate varchar)
RETURNS TABLE ("workspaceId" uuid, slug varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT settings.workspace_id, settings.slug
    FROM public.client_portal_settings settings
    JOIN public.workspaces workspace ON workspace.id = settings.workspace_id
   WHERE settings.slug = candidate AND settings.enabled AND workspace.status = 'active';
$$;
--> statement-breakpoint
CREATE FUNCTION client_portal_site_for_host(candidate varchar)
RETURNS TABLE ("workspaceId" uuid, slug varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT settings.workspace_id, settings.slug
    FROM public.workspace_domains domain
    JOIN public.workspaces workspace ON workspace.id = domain.workspace_id
    JOIN public.client_portal_settings settings ON settings.workspace_id = workspace.id
   WHERE domain.hostname = lower(candidate) AND domain.removed_at IS NULL
     AND domain.dns_status = 'verified' AND domain.dns_verified_at > now() - interval '7 days'
     AND domain.certificate_status = 'issued' AND domain.certificate_expires_at > now()
     AND domain.routing_status = 'active' AND domain.rollback_status = 'none'
     AND workspace.status = 'active' AND settings.enabled;
$$;
--> statement-breakpoint
CREATE FUNCTION client_portal_site_for_login(candidate varchar)
RETURNS TABLE ("workspaceId" uuid, slug varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT settings.workspace_id, settings.slug
    FROM public.tenant_login_branding branding
    JOIN public.workspaces workspace ON workspace.id = branding.workspace_id
    JOIN public.client_portal_settings settings ON settings.workspace_id = workspace.id
   WHERE branding.login_slug = lower(candidate) AND workspace.status = 'active' AND settings.enabled;
$$;
--> statement-breakpoint
-- The tenant's own address for links in client emails, when it has an active custom domain.
CREATE FUNCTION client_portal_custom_host(target uuid)
RETURNS varchar
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT domain.hostname FROM public.workspace_domains domain
   WHERE domain.workspace_id = target AND domain.removed_at IS NULL AND domain.routing_status = 'active'
     AND domain.rollback_status = 'none' AND domain.certificate_status = 'issued' AND domain.certificate_expires_at > now()
   ORDER BY domain.routing_activated_at DESC NULLS LAST LIMIT 1;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION client_portal_site(varchar), client_portal_site_for_host(varchar), client_portal_site_for_login(varchar), client_portal_custom_host(uuid) TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- Client notices (email now; WhatsApp once templates are approved). Tenants edit their copies.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'email', 'en', 1, 'approved', template.subject, template.body,
       '["company", "project", "title", "due", "note"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('portal.quote_issued', '{{title}} is ready for you', E'{{company}} sent you {{title}} for {{project}}.\n\nOpen your project page to read it and give your decision.'),
  ('portal.invoice_issued', 'Invoice {{title}} from {{company}}', E'{{company}} issued invoice {{title}} for {{project}}. {{due}}\n\nOpen your project page to see it and what''s left to pay.'),
  ('portal.decision_waiting', '{{title}} is waiting for your decision', E'{{company}} needs your decision on {{title}} for {{project}}. {{due}}\n\nOpen your project page to review it.'),
  ('portal.update_published', 'New update on {{project}}', E'{{note}}\n\nOpen your project page to see the progress.')
) AS template (code, subject, body)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
