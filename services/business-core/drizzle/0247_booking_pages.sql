-- Booking pages (plan §6.5b): a client picks a free slot from a public page; each booking is an intake channel.
--   * booking_types: what can be booked (duration, location, buffers, notice, window, daily cap, questions as
--     configuration, hosts mode, confirmation), versioned.
--   * booking_type_hosts: who hosts a type (optionally per enquiry type for the "by enquiry type" mode).
--   * availability_overrides: per person, a date or range with extra or blocked hours.
--   * bookings: the booked slot (UTC), its host, status, links to the contact, enquiry and meeting, answers and
--     consent snapshots, attribution, the manage-link hash and the request key; versioned.
--   * booking_external_busy: busy blocks read from a member's connected calendar (Google free/busy).
-- An exclusion constraint on (workspace, host, time range) for live bookings means a host is never double-booked.
-- A SECURITY DEFINER function resolves a public page's workspace (its sign-in slug) before the tenant transaction.
-- Every table has workspace_id, forced RLS and the tenant_isolation policy. Idempotent.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS booking_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name varchar(120) NOT NULL CHECK (length(trim(name)) > 0),
  slug varchar(60) NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  color varchar(16) NOT NULL DEFAULT 'viz-1' CHECK (color ~ '^viz-[1-6]$'),
  location_kind varchar(20) NOT NULL DEFAULT 'our_location' CHECK (location_kind IN ('our_location', 'client_address', 'video', 'phone')),
  location_detail varchar(500),
  buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_before_minutes BETWEEN 0 AND 240),
  buffer_after_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_after_minutes BETWEEN 0 AND 240),
  minimum_notice_minutes integer NOT NULL DEFAULT 240 CHECK (minimum_notice_minutes BETWEEN 0 AND 43200),
  window_days integer NOT NULL DEFAULT 30 CHECK (window_days BETWEEN 1 AND 365),
  max_per_day integer CHECK (max_per_day IS NULL OR max_per_day BETWEEN 1 AND 100),
  slot_step_minutes integer NOT NULL DEFAULT 30 CHECK (slot_step_minutes IN (10, 15, 20, 30, 60)),
  cancel_notice_minutes integer NOT NULL DEFAULT 240 CHECK (cancel_notice_minutes BETWEEN 0 AND 43200),
  questions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(questions) = 'array'),
  enquiry_type varchar(100),
  source varchar(100) NOT NULL DEFAULT 'company',
  channel varchar(60) NOT NULL DEFAULT 'website',
  hosts_mode varchar(20) NOT NULL DEFAULT 'one' CHECK (hosts_mode IN ('one', 'round_robin', 'enquiry_type')),
  confirmation varchar(20) NOT NULL DEFAULT 'automatic' CHECK (confirmation IN ('automatic', 'approval')),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug),
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS booking_type_hosts (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  booking_type_id uuid NOT NULL,
  membership_id uuid NOT NULL REFERENCES workspace_memberships (id) ON DELETE CASCADE,
  enquiry_type varchar(100),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, booking_type_id, membership_id),
  FOREIGN KEY (workspace_id, booking_type_id) REFERENCES booking_types (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS availability_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES workspace_memberships (id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  kind varchar(10) NOT NULL CHECK (kind IN ('extra', 'blocked')),
  start_time time,
  end_time time,
  reason varchar(240),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK ((start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)),
  CHECK (kind = 'blocked' OR start_time IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS availability_overrides_member_idx ON availability_overrides (workspace_id, membership_id, starts_on, ends_on);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  booking_type_id uuid NOT NULL,
  host_membership_id uuid NOT NULL REFERENCES workspace_memberships (id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  visitor_time_zone varchar(64) NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  party_id uuid REFERENCES crm_parties (id) ON DELETE SET NULL,
  lead_id uuid REFERENCES crm_leads (id) ON DELETE SET NULL,
  enquiry_id uuid REFERENCES crm_enquiries (id) ON DELETE SET NULL,
  activity_id uuid REFERENCES crm_activities (id) ON DELETE SET NULL,
  visitor_name varchar(240) NOT NULL,
  visitor_email varchar(320),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  consents jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(consents) = 'object'),
  source varchar(100) NOT NULL,
  channel varchar(60) NOT NULL,
  placement varchar(60),
  utm jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(utm) = 'object'),
  manage_nonce char(32) NOT NULL,
  manage_token_hash char(64) NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  request_hash char(64) NOT NULL,
  cancel_reason varchar(500),
  cancelled_by varchar(10) CHECK (cancelled_by IS NULL OR cancelled_by IN ('visitor', 'staff')),
  cancelled_at timestamptz,
  decided_by uuid REFERENCES users (id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (workspace_id, idempotency_key),
  UNIQUE (workspace_id, manage_token_hash),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, booking_type_id) REFERENCES booking_types (workspace_id, id),
  -- One host, one live booking at a time: two visitors racing for the same slot cannot both win.
  CONSTRAINT bookings_host_no_overlap EXCLUDE USING gist (
    workspace_id WITH =, host_membership_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('pending', 'confirmed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bookings_time_idx ON bookings (workspace_id, starts_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bookings_type_idx ON bookings (workspace_id, booking_type_id, starts_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS booking_external_busy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES workspace_memberships (id) ON DELETE CASCADE,
  source varchar(20) NOT NULL DEFAULT 'google' CHECK (source IN ('google')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS booking_external_busy_member_idx ON booking_external_busy (workspace_id, membership_id, starts_at);
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON booking_types;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON booking_types FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON bookings;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- A public booking page names its workspace by the sign-in slug (else the workspace slug). Only an active
-- workspace resolves; everything after this runs inside that workspace's tenant transaction.
CREATE OR REPLACE FUNCTION booking_public_workspace(candidate varchar) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
  AS $$
  SELECT workspace.id FROM public.workspaces workspace
   LEFT JOIN public.tenant_login_branding branding ON branding.workspace_id = workspace.id
   WHERE workspace.status = 'active' AND (branding.login_slug = lower(candidate) OR workspace.slug = lower(candidate))
   ORDER BY (branding.login_slug = lower(candidate)) DESC NULLS LAST LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION booking_public_workspace(varchar) FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['booking_types', 'booking_type_hosts', 'availability_overrides', 'bookings', 'booking_external_busy'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = target AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, target);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON booking_types TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON booking_type_hosts TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON availability_overrides TO wodana_app;
    -- Bookings are never deleted: they are cancelled, completed or marked no-show.
    GRANT SELECT, INSERT, UPDATE ON bookings TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON booking_external_busy TO wodana_app;
    GRANT EXECUTE ON FUNCTION booking_public_workspace(varchar) TO wodana_app;
  END IF;
END $$;
