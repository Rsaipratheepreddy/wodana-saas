-- Wodana v2 baseline. Squashes v1 migrations 0000–0120 (archived in drizzle/archive-v1)
-- into one schema so a fresh database builds from a single, reviewable file.
-- The application role is created by infra/postgres/001-create-app-role.sh before
-- migrations run; the guard below only covers environments that skipped it.
-- Function bodies reference tables created later in this file.
SET check_function_bodies = false;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    CREATE ROLE wodana_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;


--
-- Name: automation_definition_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.automation_definition_status AS ENUM (
    'draft',
    'active',
    'paused',
    'archived'
);


--
-- Name: automation_run_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.automation_run_status AS ENUM (
    'queued',
    'running',
    'waiting',
    'approval_required',
    'completed',
    'failed',
    'cancelled'
);


--
-- Name: brand_asset_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.brand_asset_status AS ENUM (
    'pending',
    'active',
    'replaced',
    'failed'
);


--
-- Name: crm_activity_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.crm_activity_status AS ENUM (
    'pending',
    'completed',
    'cancelled'
);


--
-- Name: crm_activity_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.crm_activity_type AS ENUM (
    'task',
    'note',
    'call',
    'meeting',
    'email',
    'whatsapp',
    'sms',
    'portal',
    'other'
);


--
-- Name: crm_consent_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.crm_consent_status AS ENUM (
    'unknown',
    'granted',
    'denied',
    'withdrawn'
);


--
-- Name: crm_contact_point_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.crm_contact_point_type AS ENUM (
    'email',
    'phone',
    'social',
    'other'
);


--
-- Name: crm_intake_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.crm_intake_status AS ENUM (
    'received',
    'processing',
    'ready',
    'needs_review',
    'failed',
    'duplicate_candidate',
    'superseded'
);


--
-- Name: crm_lead_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.crm_lead_status AS ENUM (
    'new',
    'attempting_contact',
    'connected',
    'nurturing',
    'qualified',
    'disqualified',
    'paused'
);


--
-- Name: crm_message_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.crm_message_direction AS ENUM (
    'inbound',
    'outbound',
    'internal'
);


--
-- Name: crm_message_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.crm_message_status AS ENUM (
    'draft',
    'queued',
    'sent',
    'delivered',
    'read',
    'failed'
);


--
-- Name: crm_opportunity_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.crm_opportunity_status AS ENUM (
    'open',
    'won',
    'lost',
    'abandoned'
);


--
-- Name: crm_party_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.crm_party_type AS ENUM (
    'person',
    'organization',
    'household'
);


--
-- Name: crm_record_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.crm_record_status AS ENUM (
    'active',
    'merged',
    'archived'
);


--
-- Name: entity_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.entity_status AS ENUM (
    'active',
    'archived'
);


--
-- Name: integration_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.integration_status AS ENUM (
    'draft',
    'pending',
    'connected',
    'degraded',
    'revoked'
);


--
-- Name: invitation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invitation_status AS ENUM (
    'pending',
    'accepted',
    'cancelled',
    'expired'
);


--
-- Name: membership_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.membership_status AS ENUM (
    'invited',
    'active',
    'suspended'
);


--
-- Name: notification_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_status AS ENUM (
    'pending',
    'scheduled',
    'processing',
    'delivered',
    'failed',
    'cancelled',
    'suppressed'
);


--
-- Name: onboarding_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.onboarding_status AS ENUM (
    'not_started',
    'in_progress',
    'completed'
);


--
-- Name: outbox_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.outbox_status AS ENUM (
    'pending',
    'published',
    'failed'
);


--
-- Name: processing_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.processing_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'failed',
    'dead_letter'
);


--
-- Name: sync_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sync_direction AS ENUM (
    'inbound',
    'outbound',
    'bidirectional'
);


--
-- Name: unit_system; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.unit_system AS ENUM (
    'metric',
    'imperial',
    'mixed'
);


--
-- Name: user_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_status AS ENUM (
    'active',
    'suspended'
);


--
-- Name: workspace_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.workspace_status AS ENUM (
    'active',
    'suspended',
    'archived'
);


--
-- Name: claim_outbox_events(integer, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_outbox_events(batch_size integer, lease_token uuid, lease_seconds integer DEFAULT 60) RETURNS TABLE(id uuid, workspace_id uuid, aggregate_type character varying, aggregate_id uuid, event_type character varying, payload jsonb, attempts integer)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH candidates AS (
    SELECT event.id
    FROM outbox_events event
    WHERE event.status IN ('pending', 'failed')
      AND event.available_at <= now()
      AND event.attempts < 20
      AND (event.claimed_at IS NULL OR event.claimed_at < now() - make_interval(secs => greatest(lease_seconds, 10)))
    ORDER BY event.available_at, event.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT least(greatest(batch_size, 1), 100)
  )
  UPDATE outbox_events event
     SET claimed_at = now(), claim_token = lease_token, attempts = event.attempts + 1
    FROM candidates
   WHERE event.id = candidates.id
  RETURNING event.id, event.workspace_id, event.aggregate_type, event.aggregate_id,
            event.event_type, event.payload, event.attempts;
$$;


--
-- Name: complete_outbox_event(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_outbox_event(event_id uuid, lease_token uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH updated AS (
    UPDATE outbox_events
       SET status = 'published', published_at = now(), claimed_at = NULL,
           claim_token = NULL, last_error = NULL
     WHERE id = event_id AND claim_token = lease_token AND status <> 'published'
    RETURNING 1
  ) SELECT EXISTS(SELECT 1 FROM updated);
$$;


--
-- Name: crm_allocate_enquiry_reference(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_allocate_enquiry_reference() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE allocated bigint;
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF NEW.reference IS DISTINCT FROM OLD.reference OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
   RAISE EXCEPTION 'Enquiry reference and workspace cannot be changed';
  END IF;
 ELSE
  INSERT INTO crm_enquiry_counters (workspace_id, last_value) VALUES (NEW.workspace_id, 1)
  ON CONFLICT (workspace_id) DO UPDATE SET last_value = crm_enquiry_counters.last_value + 1
  RETURNING last_value INTO allocated;
  NEW.reference := 'E-' || lpad(allocated::text, greatest(4, length(allocated::text)), '0');
 END IF;
 IF NEW.title IS NULL OR btrim(NEW.title) = '' THEN NEW.title := NEW.reference; END IF;
 RETURN NEW;
END $$;


--
-- Name: crm_allocate_opportunity_reference(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_allocate_opportunity_reference() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE allocated bigint;
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF NEW.reference IS DISTINCT FROM OLD.reference OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
   RAISE EXCEPTION 'Deal reference and workspace cannot be changed';
  END IF;
 ELSE
  INSERT INTO crm_opportunity_counters (workspace_id, last_value) VALUES (NEW.workspace_id, 1)
  ON CONFLICT (workspace_id) DO UPDATE SET last_value = crm_opportunity_counters.last_value + 1
  RETURNING last_value INTO allocated;
  NEW.reference := 'D-' || lpad(allocated::text, greatest(4, length(allocated::text)), '0');
 END IF;
 RETURN NEW;
END $$;


--
-- Name: crm_sla_history_append_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_sla_history_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'crm_sla_history is append-only' USING ERRCODE='55000';
END;
$$;


--
-- Name: enforce_business_unit_parent_entity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_business_unit_parent_entity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  parent_entity_id uuid;
  parent_status text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
     AND EXISTS (
       SELECT 1 FROM business_units child
       WHERE child.parent_business_unit_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'A business unit with children cannot change legal entity'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status = 'archived'
     AND OLD.status <> 'archived'
     AND EXISTS (
       SELECT 1 FROM business_units child
       WHERE child.parent_business_unit_id = NEW.id AND child.status = 'active'
     ) THEN
    RAISE EXCEPTION 'A business unit with active children cannot be archived'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.parent_business_unit_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_business_unit_id = NEW.id THEN
    RAISE EXCEPTION 'A business unit cannot be its own parent' USING ERRCODE = '23514';
  END IF;

  SELECT legal_entity_id, status::text INTO parent_entity_id, parent_status
  FROM business_units
  WHERE id = NEW.parent_business_unit_id;

  IF parent_entity_id IS NULL
     OR parent_entity_id <> NEW.legal_entity_id
     OR parent_status <> 'active' THEN
    RAISE EXCEPTION 'Parent business unit must be active and use the same legal entity'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND EXISTS (
    WITH RECURSIVE descendants AS (
      SELECT id FROM business_units WHERE parent_business_unit_id = NEW.id
      UNION ALL
      SELECT child.id
      FROM business_units child
      JOIN descendants parent ON child.parent_business_unit_id = parent.id
    )
    SELECT 1 FROM descendants WHERE id = NEW.parent_business_unit_id
  ) THEN
    RAISE EXCEPTION 'Business unit hierarchy cannot contain a cycle'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_customer_account_organization_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_customer_account_organization_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  approved_limit integer;
  current_count integer;
BEGIN
  SELECT organization_limit INTO approved_limit
  FROM customer_accounts
  WHERE id = NEW.account_id
  FOR UPDATE;

  SELECT count(*)::integer INTO current_count
  FROM customer_account_organizations
  WHERE account_id = NEW.account_id;

  IF approved_limit IS NULL OR current_count >= approved_limit THEN
    RAISE EXCEPTION 'Customer account organization limit reached'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_organization_request_account_links(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_organization_request_account_links() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM customer_account_organizations linked
    WHERE linked.account_id = NEW.account_id
      AND linked.workspace_id = NEW.source_workspace_id
  ) THEN
    RAISE EXCEPTION 'Organization request source does not belong to customer account'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.approved_workspace_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM customer_account_organizations linked
    WHERE linked.account_id = NEW.account_id
      AND linked.workspace_id = NEW.approved_workspace_id
  ) THEN
    RAISE EXCEPTION 'Approved organization does not belong to customer account'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_same_workspace_reference(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_same_workspace_reference() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
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
$_$;


--
-- Name: ensure_customer_account_membership_for_workspace_member(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_customer_account_membership_for_workspace_member() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'active' THEN
    INSERT INTO customer_account_memberships (account_id, user_id, role, status)
    SELECT linked.account_id, NEW.user_id, 'member', 'active'
    FROM customer_account_organizations linked
    WHERE linked.workspace_id = NEW.workspace_id
    ON CONFLICT (account_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fail_outbox_event(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_outbox_event(event_id uuid, lease_token uuid, failure text) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH updated AS (
    UPDATE outbox_events
       SET status = 'failed', available_at = now() + least(interval '1 hour', interval '2 seconds' * power(2, least(attempts, 10))),
           claimed_at = NULL, claim_token = NULL, last_error = left(failure, 2000)
     WHERE id = event_id AND claim_token = lease_token AND status <> 'published'
    RETURNING 1
  ) SELECT EXISTS(SELECT 1 FROM updated);
$$;


--
-- Name: guard_hrms_session_overlap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_hrms_session_overlap() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text || ':' || NEW.membership_id::text,0));
 IF EXISTS(SELECT 1 FROM hrms_sessions s WHERE s.workspace_id=NEW.workspace_id AND s.membership_id=NEW.membership_id AND s.id<>NEW.id
  AND tstzrange(s.started_at,s.ended_at,'[)') && tstzrange(NEW.started_at,NEW.ended_at,'[)')) THEN
  RAISE EXCEPTION 'Attendance sessions cannot overlap' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;


--
-- Name: guard_pre_project_source(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_pre_project_source() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM crm_opportunities WHERE id = NEW.opportunity_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'Pre-project opportunity must belong to the same workspace';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: immutable_hrms_record(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.immutable_hrms_record() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'Original attendance evidence and calendars are immutable'; END $$;


--
-- Name: list_crm_workspaces_with_due_work(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_crm_workspaces_with_due_work() RETURNS TABLE(workspace_id uuid)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT DISTINCT due.workspace_id
  FROM (
    SELECT notification.workspace_id FROM notifications notification
      WHERE (notification.status IN ('pending','scheduled') AND notification.scheduled_for <= now())
         OR (notification.status = 'processing' AND notification.processing_started_at < now() - interval '5 minutes')
    UNION ALL
    SELECT wait.workspace_id FROM automation_waits wait
      WHERE (wait.status = 'waiting' AND wait.due_at <= now())
         OR (wait.status = 'claimed' AND wait.claimed_at < now() - interval '5 minutes')
    UNION ALL
    SELECT sla.workspace_id FROM crm_sla_instances sla
      WHERE (sla.status = 'active' AND (sla.warning_at <= now() OR sla.due_at <= now()))
         OR (sla.status = 'warning' AND sla.due_at <= now())
    UNION ALL
    SELECT lead.workspace_id FROM crm_leads lead
      WHERE lead.ownership_due_at <= now() AND lead.owner_membership_id IS NOT NULL
        AND lead.status IN ('new','attempting_contact','connected','nurturing')
    UNION ALL
    SELECT enrollment.workspace_id
      FROM crm_sequence_enrollments enrollment
      JOIN crm_sequences sequence
        ON sequence.workspace_id = enrollment.workspace_id
       AND sequence.id = enrollment.sequence_id
      WHERE enrollment.status = 'active'
        AND enrollment.next_run_at <= now()
        AND sequence.status = 'active'
  ) due;
$$;


--
-- Name: list_reminder_workspaces(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_reminder_workspaces() RETURNS TABLE(workspace_id uuid)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT project.workspace_id FROM delivery_projects project
  UNION
  SELECT commercial.workspace_id FROM commercial_cases commercial;
$$;


--
-- Name: prevent_audit_event_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_audit_event_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '55000';
END;
$$;


--
-- Name: prevent_tenant_lifecycle_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_tenant_lifecycle_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'tenant_lifecycle_versions is append-only' USING ERRCODE='55000';
END;
$$;


--
-- Name: project_booking_history_append_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.project_booking_history_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'project_booking_history is append-only' USING ERRCODE='55000';
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: wodana_internal_slug_taken(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wodana_internal_slug_taken(candidate character varying) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspaces WHERE slug = candidate)
      OR EXISTS (SELECT 1 FROM public.tenant_login_branding WHERE login_slug = candidate);
$$;


--
-- Name: wodana_public_tenant_host(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wodana_public_tenant_host(candidate character varying) RETURNS TABLE("displayName" character varying, "loginSlug" character varying, "logoUrl" text, "primaryColor" character varying, "secondaryColor" character varying, "headingFont" character varying, "bodyFont" character varying)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  SELECT branding.display_name, branding.login_slug,
         CASE WHEN branding.logo_asset_id IS NOT NULL
              THEN '/api/auth/tenant-logo/' || branding.login_slug || '?v=' || branding.logo_asset_id::text
              ELSE branding.logo_url END,
         branding.primary_color, branding.secondary_color,
         branding.heading_font, branding.body_font
  FROM public.workspace_domains domain
  JOIN public.workspaces workspace ON workspace.id = domain.workspace_id
  JOIN public.tenant_login_branding branding ON branding.workspace_id = workspace.id
  WHERE domain.hostname = candidate AND domain.removed_at IS NULL
    AND domain.dns_status = 'verified' AND domain.dns_verified_at > now() - interval '7 days'
    AND domain.certificate_status = 'issued' AND domain.certificate_expires_at > now()
    AND domain.routing_status = 'active' AND domain.rollback_status = 'none'
    AND workspace.status = 'active';
$$;


--
-- Name: workspace_seat_capacity(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_seat_capacity(target_workspace_id uuid, excluded_invitation_id uuid DEFAULT NULL::uuid) RETURNS TABLE(seat_limit integer, active_members integer, invited_members integer, pending_invitations integer, reserved_seats integer, available_seats integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
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




--
-- Name: account_billing_document_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_billing_document_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    document_id uuid NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    request_hash character(64) NOT NULL,
    event_type character varying(40) NOT NULL,
    previous_status character varying(24),
    status character varying(24) NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    recorded_by uuid NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_billing_document_events_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT account_billing_document_events_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'issued'::character varying, 'past_due'::character varying, 'paid'::character varying, 'applied'::character varying, 'verified'::character varying, 'failed'::character varying, 'void'::character varying, 'refunded'::character varying])::text[]))),
    CONSTRAINT account_billing_document_events_type_check CHECK (((event_type)::text = ANY ((ARRAY['created'::character varying, 'provider_notification'::character varying, 'finance_verified'::character varying, 'corrected'::character varying])::text[])))
);

ALTER TABLE ONLY public.account_billing_document_events FORCE ROW LEVEL SECURITY;


--
-- Name: account_billing_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_billing_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    document_type character varying(20) NOT NULL,
    provider character varying(50) NOT NULL,
    external_reference character varying(255) NOT NULL,
    document_number character varying(120),
    status character varying(24) NOT NULL,
    currency character(3) NOT NULL,
    total_amount numeric(14,2) NOT NULL,
    balance_amount numeric(14,2) NOT NULL,
    issued_at timestamp with time zone,
    due_at timestamp with time zone,
    settled_at timestamp with time zone,
    legal_entity_reference character varying(160),
    tax_validation_state character varying(24) DEFAULT 'unverified'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_billing_documents_amount_check CHECK (((total_amount >= (0)::numeric) AND (balance_amount >= (0)::numeric) AND (balance_amount <= total_amount))),
    CONSTRAINT account_billing_documents_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT account_billing_documents_dates_check CHECK (((due_at IS NULL) OR (issued_at IS NULL) OR (due_at >= issued_at))),
    CONSTRAINT account_billing_documents_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT account_billing_documents_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'issued'::character varying, 'past_due'::character varying, 'paid'::character varying, 'applied'::character varying, 'verified'::character varying, 'failed'::character varying, 'void'::character varying, 'refunded'::character varying])::text[]))),
    CONSTRAINT account_billing_documents_tax_check CHECK (((tax_validation_state)::text = 'unverified'::text)),
    CONSTRAINT account_billing_documents_type_check CHECK (((document_type)::text = ANY ((ARRAY['invoice'::character varying, 'credit_note'::character varying, 'receipt'::character varying])::text[]))),
    CONSTRAINT account_billing_documents_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.account_billing_documents FORCE ROW LEVEL SECURITY;


--
-- Name: account_collection_state_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_collection_state_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    version integer NOT NULL,
    status character varying(24) NOT NULL,
    overdue_amount numeric(14,2) DEFAULT 0 NOT NULL,
    currency character(3) NOT NULL,
    effective_at timestamp with time zone DEFAULT now() NOT NULL,
    next_review_at timestamp with time zone,
    reason character varying(500) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_collection_state_versions_amount_check CHECK ((overdue_amount >= (0)::numeric)),
    CONSTRAINT account_collection_state_versions_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT account_collection_state_versions_reason_check CHECK (((length(btrim((reason)::text)) >= 10) AND (length(btrim((reason)::text)) <= 500))),
    CONSTRAINT account_collection_state_versions_review_check CHECK (((next_review_at IS NULL) OR (next_review_at > effective_at))),
    CONSTRAINT account_collection_state_versions_status_check CHECK (((status)::text = ANY ((ARRAY['current'::character varying, 'grace'::character varying, 'past_due'::character varying, 'collections'::character varying, 'suspended'::character varying, 'closed'::character varying])::text[])))
);

ALTER TABLE ONLY public.account_collection_state_versions FORCE ROW LEVEL SECURITY;


--
-- Name: account_contract_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_contract_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    version integer NOT NULL,
    status character varying(30) NOT NULL,
    plan_code character varying(40) NOT NULL,
    plan_version integer NOT NULL,
    currency character(3) NOT NULL,
    billing_cycle character varying(20) NOT NULL,
    recurring_amount numeric(14,2) DEFAULT 0 NOT NULL,
    seat_limit integer NOT NULL,
    project_limit integer NOT NULL,
    contract_reference character varying(160),
    signed_at timestamp with time zone,
    trial_ends_at timestamp with time zone,
    term_starts_at timestamp with time zone NOT NULL,
    renews_at timestamp with time zone,
    ends_at timestamp with time zone,
    terms jsonb DEFAULT '{}'::jsonb NOT NULL,
    legal_entity_reference character varying(160),
    tax_validation_state character varying(24) DEFAULT 'unverified'::character varying NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_until timestamp with time zone,
    reason character varying(500) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_contract_versions_amount_check CHECK ((recurring_amount >= (0)::numeric)),
    CONSTRAINT account_contract_versions_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT account_contract_versions_cycle_check CHECK (((billing_cycle)::text = ANY ((ARRAY['monthly'::character varying, 'yearly'::character varying, 'custom'::character varying])::text[]))),
    CONSTRAINT account_contract_versions_effective_check CHECK (((effective_until IS NULL) OR (effective_until > effective_from))),
    CONSTRAINT account_contract_versions_limits_check CHECK (((seat_limit > 0) AND (project_limit > 0))),
    CONSTRAINT account_contract_versions_reason_check CHECK (((length(btrim((reason)::text)) >= 10) AND (length(btrim((reason)::text)) <= 500))),
    CONSTRAINT account_contract_versions_signed_check CHECK ((((status)::text = 'contracted'::text) = (signed_at IS NOT NULL))),
    CONSTRAINT account_contract_versions_status_check CHECK (((status)::text = ANY ((ARRAY['trial_uncontracted'::character varying, 'contracted'::character varying, 'expired'::character varying])::text[]))),
    CONSTRAINT account_contract_versions_tax_check CHECK (((tax_validation_state)::text = 'unverified'::text)),
    CONSTRAINT account_contract_versions_term_check CHECK (((ends_at IS NULL) OR (ends_at > term_starts_at))),
    CONSTRAINT account_contract_versions_terms_check CHECK ((jsonb_typeof(terms) = 'object'::text)),
    CONSTRAINT account_contract_versions_version_check CHECK (((version > 0) AND (plan_version > 0)))
);

ALTER TABLE ONLY public.account_contract_versions FORCE ROW LEVEL SECURITY;


--
-- Name: account_entitlement_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_entitlement_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    version integer NOT NULL,
    plan_kind character varying(20) DEFAULT 'plan'::character varying NOT NULL,
    plan_code character varying(40) NOT NULL,
    plan_version integer NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    sold_modules jsonb DEFAULT '["workspace"]'::jsonb NOT NULL,
    limits jsonb DEFAULT '{}'::jsonb NOT NULL,
    custom_override boolean DEFAULT false NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_until timestamp with time zone,
    reason character varying(500) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_entitlement_versions_limits_check CHECK ((jsonb_typeof(limits) = 'object'::text)),
    CONSTRAINT account_entitlement_versions_modules_check CHECK (((jsonb_typeof(sold_modules) = 'array'::text) AND (sold_modules ? 'workspace'::text))),
    CONSTRAINT account_entitlement_versions_plan_kind_check CHECK (((plan_kind)::text = 'plan'::text)),
    CONSTRAINT account_entitlement_versions_reason_check CHECK (((length(btrim((reason)::text)) >= 10) AND (length(btrim((reason)::text)) <= 500))),
    CONSTRAINT account_entitlement_versions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'expired'::character varying])::text[]))),
    CONSTRAINT account_entitlement_versions_time_check CHECK (((effective_until IS NULL) OR (effective_until > effective_from))),
    CONSTRAINT account_entitlement_versions_version_check CHECK (((version > 0) AND (plan_version > 0)))
);

ALTER TABLE ONLY public.account_entitlement_versions FORCE ROW LEVEL SECURITY;


--
-- Name: account_usage_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_usage_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    source character varying(30) DEFAULT 'computed'::character varying NOT NULL,
    totals jsonb NOT NULL,
    organization_usage jsonb NOT NULL,
    created_by uuid NOT NULL,
    CONSTRAINT account_usage_snapshots_organizations_check CHECK ((jsonb_typeof(organization_usage) = 'array'::text)),
    CONSTRAINT account_usage_snapshots_period_check CHECK ((period_end > period_start)),
    CONSTRAINT account_usage_snapshots_source_check CHECK (((source)::text = ANY ((ARRAY['computed'::character varying, 'provider_import'::character varying])::text[]))),
    CONSTRAINT account_usage_snapshots_totals_check CHECK ((jsonb_typeof(totals) = 'object'::text))
);

ALTER TABLE ONLY public.account_usage_snapshots FORCE ROW LEVEL SECURITY;


--
-- Name: ai_suggestion_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_suggestion_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    suggestion_id uuid NOT NULL,
    request_id uuid NOT NULL,
    request_hash character(64) NOT NULL,
    action character varying(16) NOT NULL,
    edited_text text,
    reason character varying(1000),
    actor_user_id uuid NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_suggestion_decisions_action_check CHECK (((action)::text = ANY ((ARRAY['accepted'::character varying, 'edited'::character varying, 'rejected'::character varying])::text[]))),
    CONSTRAINT ai_suggestion_decisions_check CHECK (((((action)::text = 'edited'::text) AND (length(TRIM(BOTH FROM edited_text)) > 0)) OR (((action)::text <> 'edited'::text) AND (edited_text IS NULL)))),
    CONSTRAINT ai_suggestion_decisions_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY public.ai_suggestion_decisions FORCE ROW LEVEL SECURITY;


--
-- Name: ai_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_suggestions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    request_id uuid NOT NULL,
    request_hash character(64) NOT NULL,
    entity_type character varying(32) NOT NULL,
    entity_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    suggestion_text text NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    proposed_diff jsonb DEFAULT '[]'::jsonb NOT NULL,
    uncertainty jsonb DEFAULT '[]'::jsonb NOT NULL,
    provenance jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    edited_text text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ai_suggestions_check CHECK (((((status)::text = 'pending'::text) AND (decided_by IS NULL) AND (decided_at IS NULL)) OR (((status)::text <> 'pending'::text) AND (decided_by IS NOT NULL) AND (decided_at IS NOT NULL)))),
    CONSTRAINT ai_suggestions_entity_type_check CHECK (((entity_type)::text = ANY ((ARRAY['lead'::character varying, 'opportunity'::character varying, 'commercial_case'::character varying, 'project'::character varying])::text[]))),
    CONSTRAINT ai_suggestions_evidence_check CHECK (((jsonb_typeof(evidence) = 'array'::text) AND (jsonb_array_length(evidence) <= 40))),
    CONSTRAINT ai_suggestions_proposed_diff_check CHECK (((jsonb_typeof(proposed_diff) = 'array'::text) AND (jsonb_array_length(proposed_diff) <= 30))),
    CONSTRAINT ai_suggestions_provenance_check CHECK ((jsonb_typeof(provenance) = 'object'::text)),
    CONSTRAINT ai_suggestions_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT ai_suggestions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'edited'::character varying, 'rejected'::character varying])::text[]))),
    CONSTRAINT ai_suggestions_suggestion_text_check CHECK ((length(TRIM(BOTH FROM suggestion_text)) > 0)),
    CONSTRAINT ai_suggestions_title_check CHECK ((length(TRIM(BOTH FROM title)) > 0)),
    CONSTRAINT ai_suggestions_uncertainty_check CHECK (((jsonb_typeof(uncertainty) = 'array'::text) AND (jsonb_array_length(uncertainty) <= 30))),
    CONSTRAINT ai_suggestions_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.ai_suggestions FORCE ROW LEVEL SECURITY;


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    actor_user_id uuid,
    source character varying(30) NOT NULL,
    action character varying(120) NOT NULL,
    entity_type character varying(80) NOT NULL,
    entity_id uuid,
    before jsonb,
    after jsonb,
    correlation_id uuid NOT NULL,
    ip_address character varying(64),
    user_agent text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.audit_events FORCE ROW LEVEL SECURITY;


--
-- Name: auth_mfa_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_mfa_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash character(64) NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    purpose character varying(20) DEFAULT 'login'::character varying NOT NULL,
    credential_changed_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    failed_attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    ip_address character varying(64),
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auth_mfa_challenges_attempts_check CHECK (((failed_attempts >= 0) AND ((max_attempts >= 1) AND (max_attempts <= 20)))),
    CONSTRAINT auth_mfa_challenges_purpose_check CHECK (((purpose)::text = 'login'::text))
);


--
-- Name: auth_refresh_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_refresh_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    family_id uuid NOT NULL,
    token_hash character(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    replaced_by_session_id uuid,
    user_agent text,
    ip_address character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    authentication_methods jsonb DEFAULT '["pwd"]'::jsonb NOT NULL,
    mfa_verified_at timestamp with time zone,
    mfa_session_version integer DEFAULT 0 NOT NULL,
    mfa_enrollment_deadline timestamp with time zone,
    CONSTRAINT auth_refresh_sessions_authentication_methods_check CHECK ((jsonb_typeof(authentication_methods) = 'array'::text)),
    CONSTRAINT auth_refresh_sessions_mfa_session_version_check CHECK ((mfa_session_version >= 0))
);


--
-- Name: automation_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    run_id uuid NOT NULL,
    step_key character varying(100) NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    proposed_action jsonb NOT NULL,
    requested_from_membership_id uuid,
    decided_by uuid,
    decision_reason text,
    decided_at timestamp with time zone,
    expires_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.automation_approvals FORCE ROW LEVEL SECURITY;


--
-- Name: automation_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    code character varying(100) NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    status public.automation_definition_status DEFAULT 'draft'::public.automation_definition_status NOT NULL,
    active_version_id uuid,
    run_once_per_aggregate boolean DEFAULT false NOT NULL,
    created_by uuid,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.automation_definitions FORCE ROW LEVEL SECURITY;


--
-- Name: automation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    definition_id uuid NOT NULL,
    version_id uuid NOT NULL,
    trigger_event_id uuid NOT NULL,
    aggregate_type character varying(80) NOT NULL,
    aggregate_id uuid NOT NULL,
    status public.automation_run_status DEFAULT 'queued'::public.automation_run_status NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    current_step_key character varying(100),
    correlation_id uuid NOT NULL,
    causation_id uuid,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    failure_code character varying(120),
    failure_message text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.automation_runs FORCE ROW LEVEL SECURITY;


--
-- Name: automation_step_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_step_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    run_id uuid NOT NULL,
    step_key character varying(100) NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    status character varying(30) NOT NULL,
    input jsonb DEFAULT '{}'::jsonb NOT NULL,
    output jsonb,
    error jsonb,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);

ALTER TABLE ONLY public.automation_step_runs FORCE ROW LEVEL SECURITY;


--
-- Name: automation_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    definition_id uuid NOT NULL,
    version_number integer NOT NULL,
    definition jsonb NOT NULL,
    checksum character varying(64) NOT NULL,
    published_at timestamp with time zone,
    published_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.automation_versions FORCE ROW LEVEL SECURITY;


--
-- Name: automation_waits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_waits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    run_id uuid NOT NULL,
    step_key character varying(100) NOT NULL,
    due_at timestamp with time zone NOT NULL,
    status character varying(30) DEFAULT 'waiting'::character varying NOT NULL,
    claimed_at timestamp with time zone,
    claim_token uuid,
    completed_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: business_units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_units (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    parent_business_unit_id uuid,
    code character varying(32) NOT NULL,
    name character varying(160) NOT NULL,
    type character varying(40) DEFAULT 'studio'::character varying NOT NULL,
    timezone character varying(64) NOT NULL,
    status public.entity_status DEFAULT 'active'::public.entity_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    color character varying(7) DEFAULT '#64748B'::character varying NOT NULL,
    CONSTRAINT business_units_color_hex_check CHECK (((color)::text ~ '^#[0-9A-Fa-f]{6}$'::text))
);

ALTER TABLE ONLY public.business_units FORCE ROW LEVEL SECURITY;


--
-- Name: client_portal_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_portal_challenges (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    phone character varying(16) NOT NULL,
    purpose character varying(200) NOT NULL,
    code_hash character varying(64) NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.client_portal_challenges FORCE ROW LEVEL SECURITY;


--
-- Name: client_portal_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_portal_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    phone character varying(16) NOT NULL,
    role character varying(16) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    test_contact boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_portal_grants_role_check CHECK (((role)::text = ANY ((ARRAY['viewer'::character varying, 'approver'::character varying])::text[])))
);

ALTER TABLE ONLY public.client_portal_grants FORCE ROW LEVEL SECURITY;


--
-- Name: client_portal_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_portal_sessions (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    phone character varying(16) NOT NULL,
    token_hash character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.client_portal_sessions FORCE ROW LEVEL SECURITY;


--
-- Name: client_portal_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_portal_settings (
    workspace_id uuid NOT NULL,
    slug character varying(80) NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    brand jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: commercial_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commercial_cases (
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    content jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.commercial_cases FORCE ROW LEVEL SECURITY;


--
-- Name: commercial_payment_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commercial_payment_templates (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    milestones jsonb NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commercial_payment_templates_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'archived'::character varying])::text[])))
);

ALTER TABLE ONLY public.commercial_payment_templates FORCE ROW LEVEL SECURITY;


--
-- Name: commercial_quotation_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commercial_quotation_templates (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    content jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    CONSTRAINT commercial_quotation_templates_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'archived'::character varying])::text[])))
);

ALTER TABLE ONLY public.commercial_quotation_templates FORCE ROW LEVEL SECURITY;


--
-- Name: commercial_reconciliation_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commercial_reconciliation_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    payment_id character varying(80) NOT NULL,
    connection_id uuid NOT NULL,
    invoice_id character varying(100) NOT NULL,
    provider character varying(30) NOT NULL,
    next_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid,
    lease_until timestamp with time zone,
    last_error character varying(300),
    attempts integer DEFAULT 0 NOT NULL
);


--
-- Name: crm_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    party_id uuid,
    lead_id uuid,
    opportunity_id uuid,
    type public.crm_activity_type NOT NULL,
    status public.crm_activity_status DEFAULT 'pending'::public.crm_activity_status NOT NULL,
    title character varying(240) NOT NULL,
    description text,
    owner_membership_id uuid,
    priority character varying(20) DEFAULT 'normal'::character varying NOT NULL,
    due_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    completion_outcome character varying(120),
    is_next_action boolean DEFAULT false NOT NULL,
    customer_visible boolean DEFAULT false NOT NULL,
    created_by uuid,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sla_instance_id uuid,
    interaction_direction character varying(20),
    CONSTRAINT crm_activities_interaction_direction_check CHECK (((interaction_direction IS NULL) OR ((interaction_direction)::text = ANY ((ARRAY['inbound'::character varying, 'outbound'::character varying, 'internal'::character varying])::text[])))),
    CONSTRAINT crm_activities_target_check CHECK ((num_nonnulls(party_id, lead_id, opportunity_id) >= 1))
);

ALTER TABLE ONLY public.crm_activities FORCE ROW LEVEL SECURITY;


--
-- Name: crm_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    party_id uuid NOT NULL,
    label character varying(80),
    line1 character varying(240),
    line2 character varying(240),
    locality character varying(160),
    region character varying(160),
    postal_code character varying(40),
    country_code character varying(2) NOT NULL,
    latitude numeric(10,7),
    longitude numeric(10,7),
    is_primary boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_addresses FORCE ROW LEVEL SECURITY;


--
-- Name: crm_appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    activity_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    timezone character varying(64) NOT NULL,
    location jsonb DEFAULT '{}'::jsonb NOT NULL,
    attendee_party_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    attendee_membership_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    external_calendar_references jsonb DEFAULT '[]'::jsonb NOT NULL,
    attendance_status character varying(30) DEFAULT 'scheduled'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_appointments_time_check CHECK ((ends_at > starts_at))
);

ALTER TABLE ONLY public.crm_appointments FORCE ROW LEVEL SECURITY;


--
-- Name: crm_assignment_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_assignment_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    previous_owner_membership_id uuid,
    owner_membership_id uuid,
    queue_id uuid,
    assignment_method character varying(40) NOT NULL,
    rule_id uuid,
    explanation jsonb DEFAULT '{}'::jsonb NOT NULL,
    reason text,
    assigned_by uuid,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_assignment_history FORCE ROW LEVEL SECURITY;


--
-- Name: crm_assignment_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_assignment_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    fallback_queue_id uuid,
    preserve_relationship_owner boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_assignment_policies FORCE ROW LEVEL SECURITY;


--
-- Name: crm_assignment_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_assignment_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    queue_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_assignment_rules FORCE ROW LEVEL SECURITY;


--
-- Name: crm_attribution_touches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_attribution_touches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    enquiry_id uuid NOT NULL,
    source character varying(100) NOT NULL,
    medium character varying(100),
    campaign character varying(160),
    content character varying(160),
    term character varying(160),
    referrer text,
    external_click_id character varying(255),
    touched_at timestamp with time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_attribution_touches FORCE ROW LEVEL SECURITY;


--
-- Name: crm_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    party_id uuid NOT NULL,
    legal_entity_id uuid,
    purpose character varying(80) NOT NULL,
    channel character varying(40) NOT NULL,
    status public.crm_consent_status DEFAULT 'unknown'::public.crm_consent_status NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    jurisdiction character varying(20),
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    withdrawn_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_consents FORCE ROW LEVEL SECURITY;


--
-- Name: crm_contact_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_contact_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    party_id uuid NOT NULL,
    type public.crm_contact_point_type NOT NULL,
    label character varying(80),
    raw_value character varying(500) NOT NULL,
    normalized_value public.citext,
    country_code character varying(2),
    is_primary boolean DEFAULT false NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    invalid_reason character varying(120),
    status public.crm_record_status DEFAULT 'active'::public.crm_record_status NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_contact_points_verified_check CHECK (((NOT is_verified) OR ((normalized_value IS NOT NULL) AND (verified_at IS NOT NULL))))
);

ALTER TABLE ONLY public.crm_contact_points FORCE ROW LEVEL SECURITY;


--
-- Name: crm_conversation_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_conversation_participants (
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    participant_type character varying(30) NOT NULL,
    participant_id uuid NOT NULL,
    role character varying(30) DEFAULT 'participant'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_conversation_participants_type_check CHECK (((participant_type)::text = ANY ((ARRAY['party'::character varying, 'membership'::character varying])::text[])))
);

ALTER TABLE ONLY public.crm_conversation_participants FORCE ROW LEVEL SECURITY;


--
-- Name: crm_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    party_id uuid,
    lead_id uuid,
    channel character varying(40) NOT NULL,
    provider_thread_id character varying(500),
    subject character varying(500),
    status character varying(30) DEFAULT 'open'::character varying NOT NULL,
    owner_membership_id uuid,
    last_message_at timestamp with time zone,
    last_inbound_at timestamp with time zone,
    unread_count integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_conversations FORCE ROW LEVEL SECURITY;


--
-- Name: crm_custom_field_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_custom_field_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    entity_type character varying(60) NOT NULL,
    key character varying(80) NOT NULL,
    label character varying(160) NOT NULL,
    data_type character varying(30) NOT NULL,
    required boolean DEFAULT false NOT NULL,
    searchable boolean DEFAULT false NOT NULL,
    configuration jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_custom_field_definitions FORCE ROW LEVEL SECURITY;


--
-- Name: crm_custom_field_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_custom_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    definition_id uuid NOT NULL,
    entity_type character varying(60) NOT NULL,
    entity_id uuid NOT NULL,
    value_text text,
    value_number numeric(30,10),
    value_boolean boolean,
    value_timestamp timestamp with time zone,
    value_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_custom_field_values_one_value_check CHECK ((num_nonnulls(value_text, value_number, value_boolean, value_timestamp, value_json) = 1))
);

ALTER TABLE ONLY public.crm_custom_field_values FORCE ROW LEVEL SECURITY;


--
-- Name: crm_queue_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_queue_members (
    workspace_id uuid NOT NULL,
    queue_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    capacity integer DEFAULT 20 NOT NULL,
    weight integer DEFAULT 1 NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    languages jsonb DEFAULT '[]'::jsonb NOT NULL,
    territories jsonb DEFAULT '[]'::jsonb NOT NULL,
    unavailable_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_queue_members_capacity_check CHECK (((capacity > 0) AND (weight > 0)))
);

ALTER TABLE ONLY public.crm_queue_members FORCE ROW LEVEL SECURITY;


--
-- Name: crm_queues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_queues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    business_unit_id uuid,
    code character varying(64) NOT NULL,
    name character varying(160) NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    is_fallback boolean DEFAULT false NOT NULL,
    round_robin_cursor integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    takeover_after_minutes integer,
    CONSTRAINT crm_queues_takeover_after_minutes_check CHECK (((takeover_after_minutes IS NULL) OR ((takeover_after_minutes >= 1) AND (takeover_after_minutes <= 10080))))
);

ALTER TABLE ONLY public.crm_queues FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_team_members (
    workspace_id uuid NOT NULL,
    team_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    is_lead boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workspace_team_members FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_team_queue_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_team_queue_settings (
    workspace_id uuid NOT NULL,
    team_id uuid NOT NULL,
    queue_id uuid NOT NULL,
    capacity integer DEFAULT 25 NOT NULL,
    weight integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_team_queue_settings_capacity_check CHECK (((capacity >= 1) AND (capacity <= 10000))),
    CONSTRAINT workspace_team_queue_settings_weight_check CHECK (((weight >= 1) AND (weight <= 100)))
);

ALTER TABLE ONLY public.workspace_team_queue_settings FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    business_unit_id uuid NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(160) NOT NULL,
    description character varying(500),
    status public.entity_status DEFAULT 'active'::public.entity_status NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workspace_teams FORCE ROW LEVEL SECURITY;


--
-- Name: crm_effective_queue_members; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.crm_effective_queue_members WITH (security_invoker='true') AS
 SELECT DISTINCT ON (workspace_id, queue_id, membership_id) workspace_id,
    queue_id,
    membership_id,
    capacity,
    weight,
    is_available,
    skills,
    languages,
    territories,
    unavailable_until,
    team_id
   FROM ( SELECT direct.workspace_id,
            direct.queue_id,
            direct.membership_id,
            direct.capacity,
            direct.weight,
            direct.is_available,
            direct.skills,
            direct.languages,
            direct.territories,
            direct.unavailable_until,
            NULL::uuid AS team_id,
            0 AS precedence
           FROM public.crm_queue_members direct
        UNION ALL
         SELECT settings.workspace_id,
            settings.queue_id,
            members.membership_id,
            settings.capacity,
            settings.weight,
            true,
            '[]'::jsonb AS jsonb,
            '[]'::jsonb AS jsonb,
            '[]'::jsonb AS jsonb,
            NULL::timestamp with time zone AS timestamptz,
            settings.team_id,
            1
           FROM (((public.workspace_team_queue_settings settings
             JOIN public.workspace_teams team ON (((team.id = settings.team_id) AND (team.workspace_id = settings.workspace_id) AND (team.status = 'active'::public.entity_status))))
             JOIN public.workspace_team_members members ON (((members.team_id = team.id) AND (members.workspace_id = team.workspace_id))))
             JOIN public.crm_queues queue ON (((queue.id = settings.queue_id) AND (queue.workspace_id = settings.workspace_id) AND ((queue.status)::text = 'active'::text))))) candidate
  ORDER BY workspace_id, queue_id, membership_id, precedence, team_id;


--
-- Name: crm_enquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_enquiries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    intake_event_id uuid NOT NULL,
    party_id uuid NOT NULL,
    title character varying(240) NOT NULL,
    summary text,
    service_type character varying(100),
    source character varying(100) NOT NULL,
    channel character varying(60) NOT NULL,
    status character varying(40) DEFAULT 'open'::character varying NOT NULL,
    received_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reference character varying(40) NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT crm_enquiries_details_object CHECK ((jsonb_typeof(details) = 'object'::text))
);

ALTER TABLE ONLY public.crm_enquiries FORCE ROW LEVEL SECURITY;


--
-- Name: crm_enquiry_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_enquiry_counters (
    workspace_id uuid NOT NULL,
    last_value bigint DEFAULT 0 NOT NULL,
    CONSTRAINT crm_enquiry_counters_last_value_check CHECK ((last_value >= 0))
);

ALTER TABLE ONLY public.crm_enquiry_counters FORCE ROW LEVEL SECURITY;


--
-- Name: crm_forecast_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_forecast_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    owner_membership_id uuid,
    stage_id uuid,
    status public.crm_opportunity_status NOT NULL,
    amount numeric(20,4),
    currency_code character varying(3),
    reporting_amount numeric(20,4),
    reporting_currency_code character varying(3),
    probability numeric(5,2),
    snapshot_reason character varying(80) NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_forecast_snapshots FORCE ROW LEVEL SECURITY;


--
-- Name: crm_identity_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_identity_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    intake_event_id uuid NOT NULL,
    candidate_party_id uuid NOT NULL,
    strength character varying(20) NOT NULL,
    score numeric(5,4) NOT NULL,
    reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    decision_reason text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    decision character varying(30),
    resolved_party_id uuid,
    CONSTRAINT crm_identity_candidate_score_check CHECK (((score >= (0)::numeric) AND (score <= (1)::numeric))),
    CONSTRAINT crm_identity_candidates_decision_check CHECK (((decision IS NULL) OR ((decision)::text = ANY ((ARRAY['attach'::character varying, 'create_new'::character varying, 'reject'::character varying, 'resolved_elsewhere'::character varying])::text[])))),
    CONSTRAINT crm_identity_candidates_reasons_check CHECK ((jsonb_typeof(reasons) = 'array'::text)),
    CONSTRAINT crm_identity_candidates_review_state_check CHECK (((((status)::text = 'pending'::text) AND (decision IS NULL) AND (reviewed_at IS NULL) AND (resolved_party_id IS NULL)) OR (((status)::text = 'accepted'::text) AND ((decision)::text = 'attach'::text) AND (reviewed_at IS NOT NULL) AND (resolved_party_id IS NOT NULL)) OR (((status)::text = 'rejected'::text) AND ((decision)::text = 'reject'::text) AND (reviewed_at IS NOT NULL) AND (resolved_party_id IS NULL)) OR (((status)::text = 'rejected'::text) AND ((decision)::text = ANY ((ARRAY['create_new'::character varying, 'resolved_elsewhere'::character varying])::text[])) AND (reviewed_at IS NOT NULL) AND (resolved_party_id IS NOT NULL)))),
    CONSTRAINT crm_identity_candidates_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'rejected'::character varying])::text[]))),
    CONSTRAINT crm_identity_candidates_strength_check CHECK (((strength)::text = ANY ((ARRAY['exact'::character varying, 'fuzzy'::character varying])::text[])))
);

ALTER TABLE ONLY public.crm_identity_candidates FORCE ROW LEVEL SECURITY;


--
-- Name: crm_intake_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_intake_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    legal_entity_id uuid,
    business_unit_id uuid,
    source character varying(100) NOT NULL,
    channel character varying(60) NOT NULL,
    intake_method character varying(40) NOT NULL,
    external_event_id character varying(255),
    idempotency_key character varying(160) NOT NULL,
    payload_hash character varying(64) NOT NULL,
    original_payload jsonb NOT NULL,
    payload_reference character varying(500),
    status public.crm_intake_status DEFAULT 'received'::public.crm_intake_status NOT NULL,
    failure_code character varying(120),
    failure_message text,
    correlation_id uuid NOT NULL,
    received_at timestamp with time zone NOT NULL,
    processed_at timestamp with time zone,
    created_by uuid,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payload_hash_version smallint DEFAULT 2 NOT NULL,
    resolution_type character varying(40),
    resolved_party_id uuid,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    resolution_evidence jsonb,
    CONSTRAINT crm_intake_events_payload_hash_version_check CHECK ((payload_hash_version = ANY (ARRAY[1, 2]))),
    CONSTRAINT crm_intake_events_ready_resolution_check CHECK (((status <> 'ready'::public.crm_intake_status) OR ((resolution_type IS NOT NULL) AND (resolved_party_id IS NOT NULL) AND (resolved_at IS NOT NULL)))),
    CONSTRAINT crm_intake_events_resolution_evidence_check CHECK (((resolution_evidence IS NULL) OR (jsonb_typeof(resolution_evidence) = 'object'::text))),
    CONSTRAINT crm_intake_events_resolution_fields_check CHECK ((((resolution_type IS NULL) AND (resolved_party_id IS NULL) AND (resolved_at IS NULL) AND (resolution_evidence IS NULL)) OR ((resolution_type IS NOT NULL) AND (resolved_party_id IS NOT NULL) AND (resolved_at IS NOT NULL) AND (resolution_evidence IS NOT NULL)))),
    CONSTRAINT crm_intake_events_resolution_type_check CHECK (((resolution_type IS NULL) OR ((resolution_type)::text = ANY ((ARRAY['legacy_ready'::character varying, 'verified_contact'::character varying, 'new_identity'::character varying, 'review_attach'::character varying, 'review_create_new'::character varying])::text[]))))
);

ALTER TABLE ONLY public.crm_intake_events FORCE ROW LEVEL SECURITY;


--
-- Name: crm_lead_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_lead_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    token character varying(64) NOT NULL,
    draft jsonb NOT NULL,
    published jsonb,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_lead_forms_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'published'::character varying, 'paused'::character varying])::text[])))
);

ALTER TABLE ONLY public.crm_lead_forms FORCE ROW LEVEL SECURITY;


--
-- Name: crm_lead_qualification_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_lead_qualification_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    question_key character varying(100) NOT NULL,
    value jsonb NOT NULL,
    captured_by uuid,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_lead_qualification_values FORCE ROW LEVEL SECURITY;


--
-- Name: crm_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    enquiry_id uuid NOT NULL,
    party_id uuid NOT NULL,
    owner_membership_id uuid,
    queue_id uuid,
    status public.crm_lead_status DEFAULT 'new'::public.crm_lead_status NOT NULL,
    priority character varying(20) DEFAULT 'normal'::character varying NOT NULL,
    fit_score numeric(5,2),
    engagement_score numeric(5,2),
    disqualification_reason character varying(160),
    paused_reason character varying(160),
    next_action_at timestamp with time zone,
    qualified_at timestamp with time zone,
    closed_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    qualification_evidence jsonb,
    qualification_evidence_hash character varying(64),
    qualified_by uuid,
    ownership_due_at timestamp with time zone,
    CONSTRAINT crm_leads_qualification_evidence_check CHECK (((qualification_evidence IS NULL) OR (jsonb_typeof(qualification_evidence) = 'object'::text))),
    CONSTRAINT crm_leads_qualification_hash_check CHECK (((qualification_evidence_hash IS NULL) OR ((qualification_evidence_hash)::text ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT crm_leads_qualification_state_check CHECK ((((status = 'qualified'::public.crm_lead_status) AND (qualified_at IS NOT NULL) AND (qualification_evidence IS NOT NULL) AND (qualification_evidence_hash IS NOT NULL)) OR ((status <> 'qualified'::public.crm_lead_status) AND (qualified_at IS NULL) AND (qualification_evidence IS NULL) AND (qualification_evidence_hash IS NULL) AND (qualified_by IS NULL))))
);

ALTER TABLE ONLY public.crm_leads FORCE ROW LEVEL SECURITY;


--
-- Name: crm_merge_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_merge_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    survivor_party_id uuid NOT NULL,
    merged_party_id uuid NOT NULL,
    field_decisions jsonb DEFAULT '{}'::jsonb NOT NULL,
    snapshot jsonb NOT NULL,
    performed_by uuid,
    reversed_at timestamp with time zone,
    reversed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_merge_operations_distinct_check CHECK ((survivor_party_id <> merged_party_id))
);

ALTER TABLE ONLY public.crm_merge_operations FORCE ROW LEVEL SECURITY;


--
-- Name: crm_message_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_message_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    message_id uuid NOT NULL,
    object_key character varying(500) NOT NULL,
    file_name character varying(255) NOT NULL,
    content_type character varying(120) NOT NULL,
    byte_size integer NOT NULL,
    checksum character varying(128) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_message_attachments FORCE ROW LEVEL SECURITY;


--
-- Name: crm_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    direction public.crm_message_direction NOT NULL,
    status public.crm_message_status DEFAULT 'draft'::public.crm_message_status NOT NULL,
    sender_type character varying(30) NOT NULL,
    sender_id uuid,
    provider_message_id character varying(500),
    body_text text,
    body_html text,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    failure_code character varying(120),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    authorship character varying(20) DEFAULT 'automation'::character varying NOT NULL,
    CONSTRAINT crm_messages_authorship_check CHECK (((authorship)::text = ANY ((ARRAY['human'::character varying, 'automation'::character varying, 'provider'::character varying])::text[]))),
    CONSTRAINT crm_messages_human_author_check CHECK ((((authorship)::text <> 'human'::text) OR (((sender_type)::text = 'user'::text) AND (sender_id IS NOT NULL))))
);

ALTER TABLE ONLY public.crm_messages FORCE ROW LEVEL SECURITY;


--
-- Name: crm_opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    legal_entity_id uuid,
    business_unit_id uuid,
    party_id uuid NOT NULL,
    lead_id uuid,
    pipeline_id uuid NOT NULL,
    stage_id uuid NOT NULL,
    owner_membership_id uuid,
    title character varying(240) NOT NULL,
    description text,
    status public.crm_opportunity_status DEFAULT 'open'::public.crm_opportunity_status NOT NULL,
    amount numeric(20,4),
    currency_code character varying(3),
    probability numeric(5,2),
    forecast_category character varying(40) DEFAULT 'pipeline'::character varying NOT NULL,
    expected_close_at timestamp with time zone,
    next_action_at timestamp with time zone,
    paused_reason character varying(160),
    outcome_reason character varying(160),
    competitor character varying(160),
    closed_at timestamp with time zone,
    reporting_currency_code character varying(3),
    reporting_amount numeric(20,4),
    exchange_rate numeric(24,12),
    exchange_rate_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    conversion_origin character varying(30),
    conversion_request_hash character varying(64),
    qualification_evidence jsonb,
    qualification_evidence_hash character varying(64),
    converted_by uuid,
    converted_at timestamp with time zone,
    reference character varying(40) NOT NULL,
    CONSTRAINT crm_opportunities_amount_currency_check CHECK ((((amount IS NULL) AND (currency_code IS NULL)) OR ((amount IS NOT NULL) AND (currency_code IS NOT NULL)))),
    CONSTRAINT crm_opportunities_conversion_origin_check CHECK (((conversion_origin IS NULL) OR ((conversion_origin)::text = ANY ((ARRAY['legacy'::character varying, 'lead_qualification'::character varying, 'pre_project_start'::character varying])::text[])))),
    CONSTRAINT crm_opportunities_conversion_request_hash_check CHECK (((conversion_request_hash IS NULL) OR ((conversion_request_hash)::text ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT crm_opportunities_lead_conversion_check CHECK (((lead_id IS NULL) OR ((conversion_origin IS NOT NULL) AND (conversion_request_hash IS NOT NULL) AND (qualification_evidence IS NOT NULL) AND (qualification_evidence_hash IS NOT NULL) AND (converted_at IS NOT NULL)))),
    CONSTRAINT crm_opportunities_probability_check CHECK (((probability IS NULL) OR ((probability >= (0)::numeric) AND (probability <= (100)::numeric)))),
    CONSTRAINT crm_opportunities_qualification_evidence_check CHECK (((qualification_evidence IS NULL) OR (jsonb_typeof(qualification_evidence) = 'object'::text))),
    CONSTRAINT crm_opportunities_qualification_hash_check CHECK (((qualification_evidence_hash IS NULL) OR ((qualification_evidence_hash)::text ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT crm_opportunities_reporting_money_check CHECK ((((reporting_amount IS NULL) AND (reporting_currency_code IS NULL) AND (exchange_rate IS NULL) AND (exchange_rate_at IS NULL)) OR ((reporting_amount IS NOT NULL) AND (reporting_currency_code IS NOT NULL) AND (exchange_rate IS NOT NULL) AND (exchange_rate_at IS NOT NULL))))
);

ALTER TABLE ONLY public.crm_opportunities FORCE ROW LEVEL SECURITY;


--
-- Name: crm_opportunity_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_opportunity_counters (
    workspace_id uuid NOT NULL,
    last_value bigint DEFAULT 0 NOT NULL,
    CONSTRAINT crm_opportunity_counters_last_value_check CHECK ((last_value >= 0))
);

ALTER TABLE ONLY public.crm_opportunity_counters FORCE ROW LEVEL SECURITY;


--
-- Name: crm_opportunity_stakeholders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_opportunity_stakeholders (
    workspace_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    party_id uuid NOT NULL,
    role character varying(80) NOT NULL,
    influence character varying(30),
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_opportunity_stakeholders FORCE ROW LEVEL SECURITY;


--
-- Name: crm_opportunity_team; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_opportunity_team (
    workspace_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    role character varying(80) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_opportunity_team FORCE ROW LEVEL SECURITY;


--
-- Name: crm_organization_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_organization_profiles (
    party_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    legal_name character varying(240),
    website_domain character varying(255),
    registration_number character varying(120),
    industry character varying(120),
    employee_band character varying(40),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_organization_profiles FORCE ROW LEVEL SECURITY;


--
-- Name: crm_parties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_parties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    legal_entity_id uuid,
    business_unit_id uuid,
    type public.crm_party_type NOT NULL,
    display_name character varying(240) NOT NULL,
    normalized_name character varying(240) NOT NULL,
    lifecycle character varying(40) DEFAULT 'prospect'::character varying NOT NULL,
    status public.crm_record_status DEFAULT 'active'::public.crm_record_status NOT NULL,
    owner_membership_id uuid,
    preferred_locale character varying(35),
    preferred_timezone character varying(64),
    merged_into_party_id uuid,
    archived_at timestamp with time zone,
    created_by uuid,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_parties_merge_target_check CHECK (((status <> 'merged'::public.crm_record_status) OR (merged_into_party_id IS NOT NULL)))
);

ALTER TABLE ONLY public.crm_parties FORCE ROW LEVEL SECURITY;


--
-- Name: crm_person_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_person_profiles (
    party_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    given_name character varying(120),
    family_name character varying(120),
    honorific character varying(40),
    job_title character varying(160),
    birthday_month smallint,
    birthday_day smallint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_person_profiles FORCE ROW LEVEL SECURITY;


--
-- Name: crm_pipeline_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_pipeline_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    pipeline_id uuid NOT NULL,
    code character varying(64) NOT NULL,
    name character varying(160) NOT NULL,
    "position" integer NOT NULL,
    probability numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    forecast_category character varying(40) DEFAULT 'pipeline'::character varying NOT NULL,
    entry_requirements jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_pipeline_stage_probability_check CHECK (((probability >= (0)::numeric) AND (probability <= (100)::numeric)))
);

ALTER TABLE ONLY public.crm_pipeline_stages FORCE ROW LEVEL SECURITY;


--
-- Name: crm_pipelines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_pipelines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    code character varying(64) NOT NULL,
    name character varying(160) NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_pipelines FORCE ROW LEVEL SECURITY;


--
-- Name: crm_project_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_project_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    project_id uuid NOT NULL,
    mode character varying(30) DEFAULT 'pre_sales'::character varying NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    promoted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_project_links FORCE ROW LEVEL SECURITY;


--
-- Name: crm_qualification_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_qualification_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    code character varying(80) NOT NULL,
    name character varying(160) NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    service_type character varying(100),
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_qualification_forms_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'archived'::character varying])::text[])))
);

ALTER TABLE ONLY public.crm_qualification_forms FORCE ROW LEVEL SECURITY;


--
-- Name: crm_qualification_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_qualification_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    form_id uuid NOT NULL,
    key character varying(100) NOT NULL,
    label character varying(240) NOT NULL,
    data_type character varying(30) NOT NULL,
    required boolean DEFAULT false NOT NULL,
    "position" integer NOT NULL,
    scoring jsonb DEFAULT '{}'::jsonb NOT NULL,
    configuration jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_qualification_questions_configuration_check CHECK ((jsonb_typeof(configuration) = 'object'::text)),
    CONSTRAINT crm_qualification_questions_data_type_check CHECK (((data_type)::text = ANY ((ARRAY['text'::character varying, 'number'::character varying, 'boolean'::character varying, 'date'::character varying, 'select'::character varying, 'multi_select'::character varying])::text[]))),
    CONSTRAINT crm_qualification_questions_scoring_check CHECK ((jsonb_typeof(scoring) = 'object'::text))
);

ALTER TABLE ONLY public.crm_qualification_questions FORCE ROW LEVEL SECURITY;


--
-- Name: crm_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    from_party_id uuid NOT NULL,
    to_party_id uuid NOT NULL,
    type character varying(80) NOT NULL,
    label character varying(120),
    is_primary boolean DEFAULT false NOT NULL,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_relationships_not_self_check CHECK ((from_party_id <> to_party_id))
);

ALTER TABLE ONLY public.crm_relationships FORCE ROW LEVEL SECURITY;


--
-- Name: crm_saved_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_saved_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    entity_type character varying(60) NOT NULL,
    name character varying(160) NOT NULL,
    owner_membership_id uuid,
    is_shared boolean DEFAULT false NOT NULL,
    definition jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_saved_views FORCE ROW LEVEL SECURITY;


--
-- Name: crm_sequence_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_sequence_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    sequence_id uuid NOT NULL,
    party_id uuid NOT NULL,
    lead_id uuid,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    current_step integer DEFAULT 0 NOT NULL,
    next_run_at timestamp with time zone,
    exit_reason character varying(80),
    enrolled_by uuid,
    exited_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_sequence_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_sequence_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    sequence_id uuid NOT NULL,
    "position" integer NOT NULL,
    type character varying(40) NOT NULL,
    delay_minutes integer DEFAULT 0 NOT NULL,
    configuration jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_sequence_steps FORCE ROW LEVEL SECURITY;


--
-- Name: crm_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_sequences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    exit_conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_sla_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_sla_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    instance_id uuid NOT NULL,
    transition character varying(40) NOT NULL,
    from_status character varying(30),
    to_status character varying(30) NOT NULL,
    reason character varying(1000) DEFAULT ''::character varying NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    actor_user_id uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_sla_history_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text)),
    CONSTRAINT crm_sla_history_from_status_check CHECK (((from_status IS NULL) OR ((from_status)::text = ANY ((ARRAY['active'::character varying, 'warning'::character varying, 'breached'::character varying, 'paused'::character varying, 'stopped'::character varying])::text[])))),
    CONSTRAINT crm_sla_history_to_status_check CHECK (((to_status)::text = ANY ((ARRAY['active'::character varying, 'warning'::character varying, 'breached'::character varying, 'paused'::character varying, 'stopped'::character varying])::text[]))),
    CONSTRAINT crm_sla_history_transition_check CHECK (((transition)::text = ANY ((ARRAY['migrated'::character varying, 'started'::character varying, 'warning'::character varying, 'breached'::character varying, 'paused'::character varying, 'resumed'::character varying, 'stopped'::character varying, 'response_recorded'::character varying, 'ownership_changed'::character varying])::text[])))
);

ALTER TABLE ONLY public.crm_sla_history FORCE ROW LEVEL SECURITY;


--
-- Name: crm_sla_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_sla_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    lead_id uuid,
    target_type character varying(60) NOT NULL,
    target_id uuid NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    started_at timestamp with time zone NOT NULL,
    warning_at timestamp with time zone NOT NULL,
    due_at timestamp with time zone NOT NULL,
    warned_at timestamp with time zone,
    breached_at timestamp with time zone,
    stopped_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    event_type character varying(80) DEFAULT 'first_response'::character varying NOT NULL,
    cycle integer DEFAULT 1 NOT NULL,
    calculation_mode character varying(20) DEFAULT 'elapsed'::character varying NOT NULL,
    policy_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    paused_at timestamp with time zone,
    total_paused_minutes integer DEFAULT 0 NOT NULL,
    stop_reason character varying(120),
    response_evidence jsonb,
    paused_from_status character varying(30),
    remaining_warning_minutes integer,
    remaining_breach_minutes integer,
    responded_at timestamp with time zone,
    response_source_type character varying(30),
    response_source_id uuid,
    response_actor_user_id uuid,
    owner_membership_id uuid,
    queue_id uuid,
    response_elapsed_minutes integer,
    CONSTRAINT crm_sla_instances_calculation_mode_check CHECK (((calculation_mode)::text = ANY ((ARRAY['elapsed'::character varying, 'business'::character varying])::text[]))),
    CONSTRAINT crm_sla_instances_cycle_check CHECK ((cycle > 0)),
    CONSTRAINT crm_sla_instances_pause_state_check CHECK (((((status)::text = 'paused'::text) AND (paused_at IS NOT NULL) AND (paused_from_status IS NOT NULL) AND (remaining_warning_minutes IS NOT NULL) AND (remaining_breach_minutes IS NOT NULL)) OR (((status)::text <> 'paused'::text) AND (paused_at IS NULL) AND (paused_from_status IS NULL) AND (remaining_warning_minutes IS NULL) AND (remaining_breach_minutes IS NULL)))),
    CONSTRAINT crm_sla_instances_paused_from_status_check CHECK (((paused_from_status IS NULL) OR ((paused_from_status)::text = ANY ((ARRAY['active'::character varying, 'warning'::character varying])::text[])))),
    CONSTRAINT crm_sla_instances_paused_minutes_check CHECK ((total_paused_minutes >= 0)),
    CONSTRAINT crm_sla_instances_policy_snapshot_check CHECK ((jsonb_typeof(policy_snapshot) = 'object'::text)),
    CONSTRAINT crm_sla_instances_remaining_breach_check CHECK (((remaining_breach_minutes IS NULL) OR (remaining_breach_minutes >= 0))),
    CONSTRAINT crm_sla_instances_remaining_warning_check CHECK (((remaining_warning_minutes IS NULL) OR (remaining_warning_minutes >= 0))),
    CONSTRAINT crm_sla_instances_response_elapsed_minutes_check CHECK (((response_elapsed_minutes IS NULL) OR (response_elapsed_minutes >= 0))),
    CONSTRAINT crm_sla_instances_response_evidence_check CHECK (((response_evidence IS NULL) OR (jsonb_typeof(response_evidence) = 'object'::text))),
    CONSTRAINT crm_sla_instances_response_fields_check CHECK ((((responded_at IS NULL) AND (response_source_type IS NULL) AND (response_source_id IS NULL) AND (response_actor_user_id IS NULL)) OR ((responded_at IS NOT NULL) AND (response_source_type IS NOT NULL) AND (response_source_id IS NOT NULL)))),
    CONSTRAINT crm_sla_instances_response_source_type_check CHECK (((response_source_type IS NULL) OR ((response_source_type)::text = ANY ((ARRAY['message'::character varying, 'activity'::character varying, 'lead_status'::character varying])::text[]))))
);


--
-- Name: crm_sla_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_sla_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    event_type character varying(80) NOT NULL,
    warning_after_minutes integer NOT NULL,
    breach_after_minutes integer NOT NULL,
    schedule jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    calculation_mode character varying(20) DEFAULT 'elapsed'::character varying NOT NULL,
    schedule_version smallint DEFAULT 1 NOT NULL,
    CONSTRAINT crm_sla_policy_calculation_mode_check CHECK (((calculation_mode)::text = ANY ((ARRAY['elapsed'::character varying, 'business'::character varying])::text[]))),
    CONSTRAINT crm_sla_policy_minutes_check CHECK (((warning_after_minutes >= 0) AND (breach_after_minutes > warning_after_minutes))),
    CONSTRAINT crm_sla_policy_schedule_object_check CHECK ((jsonb_typeof(schedule) = 'object'::text)),
    CONSTRAINT crm_sla_policy_schedule_version_check CHECK ((schedule_version = 1))
);

ALTER TABLE ONLY public.crm_sla_policies FORCE ROW LEVEL SECURITY;


--
-- Name: crm_stage_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_stage_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    from_stage_id uuid,
    to_stage_id uuid,
    from_status public.crm_opportunity_status,
    to_status public.crm_opportunity_status NOT NULL,
    reason text,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_stage_history FORCE ROW LEVEL SECURITY;


--
-- Name: crm_taxonomies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_taxonomies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    code character varying(80) NOT NULL,
    name character varying(160) NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_taxonomies FORCE ROW LEVEL SECURITY;


--
-- Name: crm_taxonomy_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_taxonomy_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    taxonomy_id uuid NOT NULL,
    code character varying(80) NOT NULL,
    label character varying(160) NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_taxonomy_options FORCE ROW LEVEL SECURITY;


--
-- Name: currencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currencies (
    code character(3) NOT NULL,
    numeric_code character(3),
    name character varying(120) NOT NULL,
    minor_unit smallint NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_account_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_account_contracts (
    account_id uuid NOT NULL,
    status character varying(30) DEFAULT 'trial_uncontracted'::character varying NOT NULL,
    plan_code character varying(40) NOT NULL,
    plan_version integer NOT NULL,
    currency character(3) NOT NULL,
    billing_cycle character varying(20) NOT NULL,
    seat_limit integer NOT NULL,
    project_limit integer NOT NULL,
    contract_reference character varying(160),
    signed_at timestamp with time zone,
    trial_ends_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_account_contracts_cycle_check CHECK (((billing_cycle)::text = ANY ((ARRAY['monthly'::character varying, 'yearly'::character varying, 'custom'::character varying])::text[]))),
    CONSTRAINT customer_account_contracts_limits_check CHECK (((seat_limit > 0) AND (project_limit > 0))),
    CONSTRAINT customer_account_contracts_signed_check CHECK ((((status)::text = 'contracted'::text) = (signed_at IS NOT NULL))),
    CONSTRAINT customer_account_contracts_status_check CHECK (((status)::text = ANY ((ARRAY['trial_uncontracted'::character varying, 'contracted'::character varying, 'expired'::character varying])::text[]))),
    CONSTRAINT customer_account_contracts_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.customer_account_contracts FORCE ROW LEVEL SECURITY;


--
-- Name: customer_account_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_account_memberships (
    account_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(30) DEFAULT 'member'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_account_memberships_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'administrator'::character varying, 'member'::character varying])::text[]))),
    CONSTRAINT customer_account_memberships_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying])::text[])))
);


--
-- Name: customer_account_organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_account_organizations (
    account_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    external_customer_id character varying(160),
    display_name character varying(160) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    organization_limit integer DEFAULT 1 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    security_policy jsonb DEFAULT '{"recoveryCodeCount": 10, "enrollmentGraceDays": 7, "requireMfaForAdmins": true, "requireMfaForAllUsers": false}'::jsonb NOT NULL,
    contract_contact_name character varying(160),
    contract_contact_email public.citext,
    CONSTRAINT customer_accounts_organization_limit_check CHECK ((organization_limit > 0)),
    CONSTRAINT customer_accounts_security_policy_check CHECK (((jsonb_typeof(security_policy) = 'object'::text) AND (jsonb_typeof((security_policy -> 'requireMfaForAdmins'::text)) = 'boolean'::text) AND (jsonb_typeof((security_policy -> 'requireMfaForAllUsers'::text)) = 'boolean'::text) AND ((((security_policy ->> 'recoveryCodeCount'::text))::integer >= 5) AND (((security_policy ->> 'recoveryCodeCount'::text))::integer <= 20)) AND ((((security_policy ->> 'enrollmentGraceDays'::text))::integer >= 0) AND (((security_policy ->> 'enrollmentGraceDays'::text))::integer <= 30)))),
    CONSTRAINT customer_accounts_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT customer_accounts_version_check CHECK ((version > 0))
);


--
-- Name: delivery_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    name character varying(240) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT delivery_projects_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT delivery_projects_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'completed'::character varying, 'archived'::character varying])::text[])))
);

ALTER TABLE ONLY public.delivery_projects FORCE ROW LEVEL SECURITY;


--
-- Name: device_endpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_endpoints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    platform character varying(30) NOT NULL,
    token_hash character varying(128) NOT NULL,
    encrypted_token_reference character varying(500) NOT NULL,
    locale character varying(35) NOT NULL,
    timezone character varying(64) NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    installation_id uuid NOT NULL,
    token_type character varying(20) DEFAULT 'expo'::character varying NOT NULL,
    consent_id uuid,
    last_request_id uuid NOT NULL,
    CONSTRAINT device_endpoints_platform_check CHECK (((platform)::text = ANY ((ARRAY['ios'::character varying, 'android'::character varying])::text[]))),
    CONSTRAINT device_endpoints_token_type_check CHECK (((token_type)::text = 'expo'::text))
);

ALTER TABLE ONLY public.device_endpoints FORCE ROW LEVEL SECURITY;


--
-- Name: document_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_sequences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    document_type character varying(64) NOT NULL,
    prefix character varying(40) NOT NULL,
    next_number integer DEFAULT 1 NOT NULL,
    padding smallint DEFAULT 5 NOT NULL,
    reset_policy character varying(20) DEFAULT 'annual'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.document_sequences FORCE ROW LEVEL SECURITY;


--
-- Name: effective_account_contracts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.effective_account_contracts WITH (security_invoker='true') AS
 WITH ranked AS (
         SELECT contract.id,
            contract.account_id,
            contract.version,
            contract.status,
            contract.plan_code,
            contract.plan_version,
            contract.currency,
            contract.billing_cycle,
            contract.recurring_amount,
            contract.seat_limit,
            contract.project_limit,
            contract.contract_reference,
            contract.signed_at,
            contract.trial_ends_at,
            contract.term_starts_at,
            contract.renews_at,
            contract.ends_at,
            contract.terms,
            contract.legal_entity_reference,
            contract.tax_validation_state,
            contract.effective_from,
            contract.effective_until,
            contract.reason,
            contract.created_by,
            contract.created_at,
            row_number() OVER (PARTITION BY contract.account_id ORDER BY
                CASE
                    WHEN ((now() >= contract.effective_from) AND ((contract.effective_until IS NULL) OR (now() < contract.effective_until))) THEN 0
                    WHEN (now() < contract.effective_from) THEN 1
                    ELSE 2
                END,
                CASE
                    WHEN (now() < contract.effective_from) THEN contract.effective_from
                    ELSE NULL::timestamp with time zone
                END,
                CASE
                    WHEN (now() >= contract.effective_from) THEN contract.effective_from
                    ELSE NULL::timestamp with time zone
                END DESC, contract.version DESC) AS rank
           FROM public.account_contract_versions contract
        )
 SELECT id,
    account_id,
    version,
    status,
    plan_code,
    plan_version,
    currency,
    billing_cycle,
    recurring_amount,
    seat_limit,
    project_limit,
    contract_reference,
    signed_at,
    trial_ends_at,
    term_starts_at,
    renews_at,
    ends_at,
    terms,
    legal_entity_reference,
    tax_validation_state,
    effective_from,
    effective_until,
    reason,
    created_by,
    created_at
   FROM ranked
  WHERE (rank = 1);


--
-- Name: member_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_roles (
    workspace_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    role_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.member_roles FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_team_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_team_roles (
    workspace_id uuid NOT NULL,
    team_id uuid NOT NULL,
    role_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workspace_team_roles FORCE ROW LEVEL SECURITY;


--
-- Name: effective_member_roles; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.effective_member_roles WITH (security_invoker='true') AS
 SELECT member_roles.workspace_id,
    member_roles.membership_id,
    member_roles.role_id,
    member_roles.created_at,
    NULL::uuid AS team_id
   FROM public.member_roles
UNION ALL
 SELECT grants.workspace_id,
    members.membership_id,
    grants.role_id,
    grants.created_at,
    grants.team_id
   FROM ((public.workspace_team_roles grants
     JOIN public.workspace_teams team ON (((team.id = grants.team_id) AND (team.workspace_id = grants.workspace_id) AND (team.status = 'active'::public.entity_status))))
     JOIN public.workspace_team_members members ON (((members.team_id = team.id) AND (members.workspace_id = team.workspace_id))));


--
-- Name: organization_billing_allocation_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_billing_allocation_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    account_contract_version_id uuid NOT NULL,
    version integer NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    allocated_amount numeric(14,2) DEFAULT 0 NOT NULL,
    seat_limit integer NOT NULL,
    project_limit integer NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_until timestamp with time zone,
    reason character varying(500) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_billing_allocation_versions_amount_check CHECK ((allocated_amount >= (0)::numeric)),
    CONSTRAINT organization_billing_allocation_versions_limits_check CHECK (((seat_limit > 0) AND (project_limit > 0))),
    CONSTRAINT organization_billing_allocation_versions_reason_check CHECK (((length(btrim((reason)::text)) >= 10) AND (length(btrim((reason)::text)) <= 500))),
    CONSTRAINT organization_billing_allocation_versions_status_check CHECK (((status)::text = ANY ((ARRAY['scheduled'::character varying, 'active'::character varying, 'suspended'::character varying, 'ended'::character varying])::text[]))),
    CONSTRAINT organization_billing_allocation_versions_time_check CHECK (((effective_until IS NULL) OR (effective_until > effective_from))),
    CONSTRAINT organization_billing_allocation_versions_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.organization_billing_allocation_versions FORCE ROW LEVEL SECURITY;


--
-- Name: effective_organization_billing_allocations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.effective_organization_billing_allocations WITH (security_invoker='true') AS
 WITH ranked AS (
         SELECT allocation.id,
            allocation.workspace_id,
            allocation.account_contract_version_id,
            allocation.version,
            allocation.status,
            allocation.allocated_amount,
            allocation.seat_limit,
            allocation.project_limit,
            allocation.effective_from,
            allocation.effective_until,
            allocation.reason,
            allocation.created_by,
            allocation.created_at,
            row_number() OVER (PARTITION BY allocation.workspace_id ORDER BY
                CASE
                    WHEN ((now() >= allocation.effective_from) AND ((allocation.effective_until IS NULL) OR (now() < allocation.effective_until))) THEN 0
                    WHEN (now() < allocation.effective_from) THEN 1
                    ELSE 2
                END,
                CASE
                    WHEN (now() < allocation.effective_from) THEN allocation.effective_from
                    ELSE NULL::timestamp with time zone
                END,
                CASE
                    WHEN (now() >= allocation.effective_from) THEN allocation.effective_from
                    ELSE NULL::timestamp with time zone
                END DESC, allocation.version DESC) AS rank
           FROM public.organization_billing_allocation_versions allocation
        )
 SELECT id,
    workspace_id,
    account_contract_version_id,
    version,
    status,
    allocated_amount,
    seat_limit,
    project_limit,
    effective_from,
    effective_until,
    reason,
    created_by,
    created_at
   FROM ranked
  WHERE (rank = 1);


--
-- Name: organization_entitlement_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_entitlement_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    account_entitlement_id uuid NOT NULL,
    version integer NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    modules jsonb DEFAULT '["workspace"]'::jsonb NOT NULL,
    limits jsonb DEFAULT '{}'::jsonb NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_until timestamp with time zone,
    reason character varying(500) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_entitlement_allocations_limits_check CHECK ((jsonb_typeof(limits) = 'object'::text)),
    CONSTRAINT organization_entitlement_allocations_modules_check CHECK (((jsonb_typeof(modules) = 'array'::text) AND (modules ? 'workspace'::text))),
    CONSTRAINT organization_entitlement_allocations_reason_check CHECK (((length(btrim((reason)::text)) >= 10) AND (length(btrim((reason)::text)) <= 500))),
    CONSTRAINT organization_entitlement_allocations_status_check CHECK (((status)::text = ANY ((ARRAY['scheduled'::character varying, 'active'::character varying, 'suspended'::character varying, 'expired'::character varying])::text[]))),
    CONSTRAINT organization_entitlement_allocations_time_check CHECK (((effective_until IS NULL) OR (effective_until > effective_from))),
    CONSTRAINT organization_entitlement_allocations_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.organization_entitlement_allocations FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_entitlement_sets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_entitlement_sets (
    workspace_id uuid NOT NULL,
    plan_code character varying(40) NOT NULL,
    plan_version integer NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    modules jsonb DEFAULT '[]'::jsonb NOT NULL,
    limits jsonb DEFAULT '{}'::jsonb NOT NULL,
    effective_at timestamp with time zone DEFAULT now() NOT NULL,
    reason character varying(500) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_until timestamp with time zone,
    CONSTRAINT workspace_entitlement_sets_limits_check CHECK ((jsonb_typeof(limits) = 'object'::text)),
    CONSTRAINT workspace_entitlement_sets_modules_check CHECK ((jsonb_typeof(modules) = 'array'::text)),
    CONSTRAINT workspace_entitlement_sets_reason_check CHECK (((length(btrim((reason)::text)) >= 3) AND (length(btrim((reason)::text)) <= 500))),
    CONSTRAINT workspace_entitlement_sets_status_check CHECK (((status)::text = ANY ((ARRAY['scheduled'::character varying, 'active'::character varying, 'suspended'::character varying])::text[]))),
    CONSTRAINT workspace_entitlement_sets_time_check CHECK (((effective_until IS NULL) OR (effective_until > effective_at))),
    CONSTRAINT workspace_entitlement_sets_version_check CHECK (((plan_version > 0) AND (version > 0)))
);

ALTER TABLE ONLY public.workspace_entitlement_sets FORCE ROW LEVEL SECURITY;


--
-- Name: effective_workspace_entitlements; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.effective_workspace_entitlements WITH (security_invoker='true') AS
 WITH candidate AS (
         SELECT allocation.workspace_id,
            account.plan_code,
            account.plan_version,
                CASE
                    WHEN (now() < GREATEST(account.effective_from, allocation.effective_from)) THEN 'scheduled'::character varying
                    WHEN ((account.status)::text <> 'active'::text) THEN account.status
                    WHEN ((allocation.status)::text <> 'active'::text) THEN allocation.status
                    WHEN ((LEAST(account.effective_until, allocation.effective_until) IS NOT NULL) AND (now() >= LEAST(account.effective_until, allocation.effective_until))) THEN 'expired'::character varying
                    ELSE 'active'::character varying
                END AS status,
            allocation.modules,
            (account.limits || allocation.limits) AS limits,
            account.sold_modules,
            account.limits AS sold_limits,
            account.custom_override,
            GREATEST(account.effective_from, allocation.effective_from) AS effective_at,
            LEAST(account.effective_until, allocation.effective_until) AS effective_until,
            allocation.reason,
            allocation.version,
            allocation.created_at AS updated_at,
            'allocation'::text AS source,
            row_number() OVER (PARTITION BY allocation.workspace_id ORDER BY
                CASE
                    WHEN ((now() >= GREATEST(account.effective_from, allocation.effective_from)) AND ((LEAST(account.effective_until, allocation.effective_until) IS NULL) OR (now() < LEAST(account.effective_until, allocation.effective_until)))) THEN 0
                    WHEN (now() < GREATEST(account.effective_from, allocation.effective_from)) THEN 1
                    ELSE 2
                END,
                CASE
                    WHEN (now() < GREATEST(account.effective_from, allocation.effective_from)) THEN GREATEST(account.effective_from, allocation.effective_from)
                    ELSE NULL::timestamp with time zone
                END,
                CASE
                    WHEN (now() >= GREATEST(account.effective_from, allocation.effective_from)) THEN GREATEST(account.effective_from, allocation.effective_from)
                    ELSE NULL::timestamp with time zone
                END DESC, allocation.version DESC) AS rank
           FROM (public.organization_entitlement_allocations allocation
             JOIN public.account_entitlement_versions account ON ((account.id = allocation.account_entitlement_id)))
        ), chosen AS (
         SELECT candidate.workspace_id,
            candidate.plan_code,
            candidate.plan_version,
            candidate.status,
            candidate.modules,
            candidate.limits,
            candidate.sold_modules,
            candidate.sold_limits,
            candidate.custom_override,
            candidate.effective_at,
            candidate.effective_until,
            candidate.reason,
            candidate.version,
            candidate.updated_at,
            candidate.source
           FROM candidate
          WHERE (candidate.rank = 1)
        ), legacy AS (
         SELECT legacy.workspace_id,
            legacy.plan_code,
            legacy.plan_version,
            legacy.status,
            legacy.modules,
            legacy.limits,
            legacy.modules AS sold_modules,
            legacy.limits AS sold_limits,
            true AS custom_override,
            legacy.effective_at,
            legacy.effective_until,
            legacy.reason,
            legacy.version,
            legacy.updated_at,
            'legacy'::text AS source
           FROM public.workspace_entitlement_sets legacy
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM public.organization_entitlement_allocations allocation
                  WHERE (allocation.workspace_id = legacy.workspace_id))))
        )
 SELECT chosen.workspace_id,
    chosen.plan_code,
    chosen.plan_version,
    chosen.status,
    chosen.modules,
    chosen.limits,
    chosen.sold_modules,
    chosen.sold_limits,
    chosen.custom_override,
    chosen.effective_at,
    chosen.effective_until,
    chosen.reason,
    chosen.version,
    chosen.updated_at,
    chosen.source
   FROM chosen
UNION ALL
 SELECT legacy.workspace_id,
    legacy.plan_code,
    legacy.plan_version,
    legacy.status,
    legacy.modules,
    legacy.limits,
    legacy.sold_modules,
    legacy.sold_limits,
    legacy.custom_override,
    legacy.effective_at,
    legacy.effective_until,
    legacy.reason,
    legacy.version,
    legacy.updated_at,
    legacy.source
   FROM legacy;


--
-- Name: exchange_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchange_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    base_currency character(3) NOT NULL,
    quote_currency character(3) NOT NULL,
    rate numeric(24,12) NOT NULL,
    effective_at timestamp with time zone NOT NULL,
    source character varying(80) NOT NULL,
    is_manual boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.exchange_rates FORCE ROW LEVEL SECURITY;


--
-- Name: hrms_attendance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hrms_attendance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    session_id uuid NOT NULL,
    action_id uuid NOT NULL,
    request_hash character varying(64) NOT NULL,
    capture_id uuid,
    kind character varying(20) NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    device_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    evidence jsonb NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    recorded_by uuid NOT NULL,
    CONSTRAINT hrms_attendance_events_kind_check CHECK (((kind)::text = ANY ((ARRAY['check_in'::character varying, 'check_out'::character varying, 'switch'::character varying])::text[])))
);

ALTER TABLE ONLY public.hrms_attendance_events FORCE ROW LEVEL SECURITY;


--
-- Name: hrms_calendars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hrms_calendars (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    timezone character varying(80) NOT NULL,
    working_days integer[] DEFAULT ARRAY[1, 2, 3, 4, 5] NOT NULL,
    holidays date[] DEFAULT '{}'::date[] NOT NULL,
    day_start time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
    half_day time without time zone DEFAULT '13:00:00'::time without time zone NOT NULL,
    day_end time without time zone DEFAULT '18:00:00'::time without time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hrms_calendars_check CHECK (((day_start < half_day) AND (half_day < day_end))),
    CONSTRAINT hrms_calendars_working_days_check CHECK ((((cardinality(working_days) >= 1) AND (cardinality(working_days) <= 7)) AND (working_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6])))
);

ALTER TABLE ONLY public.hrms_calendars FORCE ROW LEVEL SECURITY;


--
-- Name: hrms_captures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hrms_captures (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    object_key text,
    sha256 character varying(64),
    byte_size integer,
    photo_uploaded_at timestamp with time zone
);

ALTER TABLE ONLY public.hrms_captures FORCE ROW LEVEL SECURITY;


--
-- Name: hrms_employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hrms_employees (
    workspace_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    employee_code character varying(40) DEFAULT ''::character varying NOT NULL,
    designation character varying(120) DEFAULT ''::character varying NOT NULL,
    department character varying(120) DEFAULT ''::character varying NOT NULL,
    manager_id uuid,
    calendar_id uuid NOT NULL,
    remote_allowed boolean DEFAULT false NOT NULL,
    active_from date DEFAULT CURRENT_DATE NOT NULL,
    active_to date,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT hrms_employees_check CHECK ((manager_id IS DISTINCT FROM membership_id)),
    CONSTRAINT hrms_employees_check1 CHECK (((active_to IS NULL) OR (active_to >= active_from)))
);

ALTER TABLE ONLY public.hrms_employees FORCE ROW LEVEL SECURITY;


--
-- Name: hrms_leave_allowances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hrms_leave_allowances (
    workspace_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    leave_type_id uuid NOT NULL,
    year integer NOT NULL,
    days numeric(6,1) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT hrms_leave_allowances_days_check CHECK (((days >= (0)::numeric) AND (days <= (366)::numeric))),
    CONSTRAINT hrms_leave_allowances_year_check CHECK (((year >= 2000) AND (year <= 2200)))
);

ALTER TABLE ONLY public.hrms_leave_allowances FORCE ROW LEVEL SECURITY;


--
-- Name: hrms_leave_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hrms_leave_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    leave_type_id uuid NOT NULL,
    action_id uuid NOT NULL,
    request_hash character varying(64) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    day_part character varying(16) NOT NULL,
    units jsonb NOT NULL,
    calendar_snapshot jsonb NOT NULL,
    reason text NOT NULL,
    status character varying(24) DEFAULT 'pending'::character varying NOT NULL,
    decided_by uuid,
    decision_reason text,
    decided_at timestamp with time zone,
    cancellation_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT hrms_leave_requests_check CHECK ((end_date >= start_date)),
    CONSTRAINT hrms_leave_requests_day_part_check CHECK (((day_part)::text = ANY ((ARRAY['full'::character varying, 'first_half'::character varying, 'second_half'::character varying])::text[]))),
    CONSTRAINT hrms_leave_requests_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying, 'withdrawn'::character varying, 'cancellation_pending'::character varying, 'cancelled'::character varying])::text[])))
);

ALTER TABLE ONLY public.hrms_leave_requests FORCE ROW LEVEL SECURITY;


--
-- Name: hrms_leave_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hrms_leave_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    annual_days numeric(6,1) NOT NULL,
    allow_half_day boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT hrms_leave_types_annual_days_check CHECK (((annual_days >= (0)::numeric) AND (annual_days <= (366)::numeric)))
);

ALTER TABLE ONLY public.hrms_leave_types FORCE ROW LEVEL SECURITY;


--
-- Name: hrms_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hrms_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    session_id uuid NOT NULL,
    action_id uuid NOT NULL,
    kind character varying(20) NOT NULL,
    event_id uuid,
    requested_at timestamp with time zone,
    original_at timestamp with time zone,
    reason text NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    decision_reason text,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT hrms_reviews_kind_check CHECK (((kind)::text = ANY ((ARRAY['exception'::character varying, 'correction'::character varying, 'missing_checkout'::character varying])::text[]))),
    CONSTRAINT hrms_reviews_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying, 'withdrawn'::character varying])::text[])))
);

ALTER TABLE ONLY public.hrms_reviews FORCE ROW LEVEL SECURITY;


--
-- Name: hrms_segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hrms_segments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    session_id uuid NOT NULL,
    mode character varying(20) NOT NULL,
    location_id uuid,
    project_id uuid,
    case_id uuid,
    context_snapshot jsonb NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    start_event_id uuid NOT NULL,
    end_event_id uuid,
    CONSTRAINT hrms_segments_check CHECK (((ended_at IS NULL) OR (ended_at > started_at))),
    CONSTRAINT hrms_segments_check1 CHECK ((num_nonnulls(project_id, case_id) <= 1)),
    CONSTRAINT hrms_segments_check2 CHECK ((((mode)::text <> 'site'::text) OR ((location_id IS NOT NULL) AND (num_nonnulls(project_id, case_id) = 1)))),
    CONSTRAINT hrms_segments_mode_check CHECK (((mode)::text = ANY ((ARRAY['office'::character varying, 'site'::character varying, 'field'::character varying, 'remote'::character varying])::text[])))
);

ALTER TABLE ONLY public.hrms_segments FORCE ROW LEVEL SECURITY;


--
-- Name: hrms_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hrms_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    calendar_snapshot jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT hrms_sessions_check CHECK (((ended_at IS NULL) OR (ended_at > started_at)))
);

ALTER TABLE ONLY public.hrms_sessions FORCE ROW LEVEL SECURITY;


--
-- Name: hrms_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hrms_settings (
    workspace_id uuid NOT NULL,
    default_calendar_id uuid NOT NULL,
    fallback_approver_id uuid,
    max_gps_accuracy_m integer DEFAULT 100 NOT NULL,
    max_capture_age_seconds integer DEFAULT 120 NOT NULL,
    media_retention_days integer DEFAULT 365 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT hrms_settings_max_capture_age_seconds_check CHECK (((max_capture_age_seconds >= 30) AND (max_capture_age_seconds <= 600))),
    CONSTRAINT hrms_settings_max_gps_accuracy_m_check CHECK (((max_gps_accuracy_m >= 5) AND (max_gps_accuracy_m <= 500))),
    CONSTRAINT hrms_settings_media_retention_days_check CHECK (((media_retention_days >= 30) AND (media_retention_days <= 3650)))
);

ALTER TABLE ONLY public.hrms_settings FORCE ROW LEVEL SECURITY;


--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    actor_user_id uuid,
    key character varying(160) NOT NULL,
    request_hash character(64) NOT NULL,
    response_status integer,
    response_body jsonb,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.idempotency_keys FORCE ROW LEVEL SECURITY;


--
-- Name: integration_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    legal_entity_id uuid,
    provider character varying(50) NOT NULL,
    display_name character varying(160) NOT NULL,
    external_account_id character varying(255),
    external_domain character varying(255),
    status public.integration_status DEFAULT 'draft'::public.integration_status NOT NULL,
    granted_scopes jsonb DEFAULT '[]'::jsonb NOT NULL,
    secret_reference character varying(500),
    configuration jsonb DEFAULT '{}'::jsonb NOT NULL,
    connected_by uuid,
    token_expires_at timestamp with time zone,
    last_synced_at timestamp with time zone,
    last_error_code character varying(100),
    last_error_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.integration_connections FORCE ROW LEVEL SECURITY;


--
-- Name: integration_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    resource_type character varying(50) NOT NULL,
    external_id character varying(500) NOT NULL,
    display_name character varying(200) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    direction public.sync_direction DEFAULT 'inbound'::public.sync_direction NOT NULL,
    configuration jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.integration_resources FORCE ROW LEVEL SECURITY;


--
-- Name: invitation_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitation_roles (
    workspace_id uuid NOT NULL,
    invitation_id uuid NOT NULL,
    role_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.invitation_roles FORCE ROW LEVEL SECURITY;


--
-- Name: invitation_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitation_teams (
    workspace_id uuid NOT NULL,
    invitation_id uuid NOT NULL,
    team_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.invitation_teams FORCE ROW LEVEL SECURITY;


--
-- Name: job_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    reference character varying(32) NOT NULL,
    root_type character varying(20) NOT NULL,
    root_id uuid NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_identities_reference_check CHECK (((reference)::text ~ '^J-[0-9]{6,}$'::text)),
    CONSTRAINT job_identities_root_type_check CHECK (((root_type)::text = ANY ((ARRAY['enquiry'::character varying, 'opportunity'::character varying])::text[])))
);

ALTER TABLE ONLY public.job_identities FORCE ROW LEVEL SECURITY;


--
-- Name: job_identity_link_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_identity_link_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    link_id uuid NOT NULL,
    job_id uuid NOT NULL,
    event_type character varying(16) NOT NULL,
    link_version integer NOT NULL,
    actor_user_id uuid,
    reason character varying(80) NOT NULL,
    request_key character varying(160),
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_identity_link_events_event_type_check CHECK (((event_type)::text = ANY ((ARRAY['attached'::character varying, 'detached'::character varying, 'reattached'::character varying])::text[]))),
    CONSTRAINT job_identity_link_events_link_version_check CHECK ((link_version > 0))
);

ALTER TABLE ONLY public.job_identity_link_events FORCE ROW LEVEL SECURITY;


--
-- Name: job_identity_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_identity_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    job_id uuid NOT NULL,
    record_type character varying(20) NOT NULL,
    record_id character varying(160) NOT NULL,
    case_id uuid,
    source_key text GENERATED ALWAYS AS (((((record_type)::text || ':'::text) ||
CASE
    WHEN ((record_type)::text = 'quote'::text) THEN ((case_id)::text || ':'::text)
    ELSE ''::text
END) || (record_id)::text)) STORED,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    attached_at timestamp with time zone DEFAULT now() NOT NULL,
    detached_at timestamp with time zone,
    CONSTRAINT job_identity_links_check CHECK (((((record_type)::text = 'quote'::text) AND (case_id IS NOT NULL)) OR (((record_type)::text <> 'quote'::text) AND (case_id IS NULL)))),
    CONSTRAINT job_identity_links_check1 CHECK (((((status)::text = 'active'::text) AND (detached_at IS NULL)) OR (((status)::text = 'detached'::text) AND (detached_at IS NOT NULL)))),
    CONSTRAINT job_identity_links_record_id_check CHECK ((length((record_id)::text) > 0)),
    CONSTRAINT job_identity_links_record_type_check CHECK (((record_type)::text = ANY ((ARRAY['enquiry'::character varying, 'lead'::character varying, 'opportunity'::character varying, 'case'::character varying, 'quote'::character varying, 'project'::character varying])::text[]))),
    CONSTRAINT job_identity_links_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'detached'::character varying])::text[]))),
    CONSTRAINT job_identity_links_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.job_identity_links FORCE ROW LEVEL SECURITY;


--
-- Name: job_manual_stage_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_manual_stage_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    job_id uuid NOT NULL,
    request_id uuid NOT NULL,
    request_hash character(64) NOT NULL,
    stage_version integer NOT NULL,
    phase character varying(32) NOT NULL,
    stage character varying(120) NOT NULL,
    reason character varying(500) NOT NULL,
    actor_user_id uuid NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_manual_stage_events_phase_check CHECK (((phase)::text = ANY ((ARRAY['intake'::character varying, 'qualify'::character varying, 'discover'::character varying, 'design_scope'::character varying, 'price'::character varying, 'agree'::character varying, 'release'::character varying, 'deliver'::character varying, 'handover'::character varying, 'aftercare'::character varying])::text[]))),
    CONSTRAINT job_manual_stage_events_reason_check CHECK ((length(TRIM(BOTH FROM reason)) >= 8)),
    CONSTRAINT job_manual_stage_events_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT job_manual_stage_events_stage_check CHECK ((length(TRIM(BOTH FROM stage)) > 0)),
    CONSTRAINT job_manual_stage_events_stage_version_check CHECK ((stage_version > 0))
);

ALTER TABLE ONLY public.job_manual_stage_events FORCE ROW LEVEL SECURITY;


--
-- Name: job_manual_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_manual_stages (
    workspace_id uuid NOT NULL,
    job_id uuid NOT NULL,
    phase character varying(32) NOT NULL,
    stage character varying(120) NOT NULL,
    reason character varying(500) NOT NULL,
    set_by uuid NOT NULL,
    set_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT job_manual_stages_phase_check CHECK (((phase)::text = ANY ((ARRAY['intake'::character varying, 'qualify'::character varying, 'discover'::character varying, 'design_scope'::character varying, 'price'::character varying, 'agree'::character varying, 'release'::character varying, 'deliver'::character varying, 'handover'::character varying, 'aftercare'::character varying])::text[]))),
    CONSTRAINT job_manual_stages_reason_check CHECK ((length(TRIM(BOTH FROM reason)) >= 8)),
    CONSTRAINT job_manual_stages_stage_check CHECK ((length(TRIM(BOTH FROM stage)) > 0)),
    CONSTRAINT job_manual_stages_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.job_manual_stages FORCE ROW LEVEL SECURITY;


--
-- Name: job_reference_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_reference_counters (
    workspace_id uuid NOT NULL,
    last_number bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_reference_counters_last_number_check CHECK ((last_number >= 0))
);

ALTER TABLE ONLY public.job_reference_counters FORCE ROW LEVEL SECURITY;


--
-- Name: legal_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_entities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    code character varying(24) NOT NULL,
    display_name character varying(160) NOT NULL,
    registered_name character varying(200) NOT NULL,
    country_code character(2) NOT NULL,
    base_currency character(3) NOT NULL,
    locale character varying(35) NOT NULL,
    timezone character varying(64) NOT NULL,
    tax_registration_number character varying(100),
    registration_number character varying(100),
    address jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.entity_status DEFAULT 'active'::public.entity_status NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.legal_entities FORCE ROW LEVEL SECURITY;


--
-- Name: local_auth_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_auth_credentials (
    user_id uuid NOT NULL,
    password_hash character varying(128) NOT NULL,
    password_salt character varying(64) NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    password_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mfa_enrollment_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mfa_enrollment_requirements (
    user_id uuid NOT NULL,
    account_id uuid NOT NULL,
    required_since timestamp with time zone DEFAULT now() NOT NULL,
    grace_expires_at timestamp with time zone NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mfa_enrollment_requirements_grace_check CHECK ((grace_expires_at >= required_since))
);


--
-- Name: mfa_security_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mfa_security_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    workspace_id uuid,
    event_type character varying(80) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mfa_security_events_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text))
);


--
-- Name: notification_delivery_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_delivery_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    notification_id uuid NOT NULL,
    attempt integer NOT NULL,
    provider character varying(60) NOT NULL,
    status character varying(30) NOT NULL,
    provider_message_id character varying(500),
    error_code character varying(120),
    error_message text,
    retry_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    destination_reference character varying(500)
);

ALTER TABLE ONLY public.notification_delivery_attempts FORCE ROW LEVEL SECURITY;


--
-- Name: notification_device_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_device_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    installation_id uuid NOT NULL,
    last_request_id uuid NOT NULL,
    platform character varying(30) NOT NULL,
    permission_status character varying(30) NOT NULL,
    locale character varying(35) NOT NULL,
    timezone character varying(64) NOT NULL,
    permission_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT notification_device_consents_locale_check CHECK ((length(TRIM(BOTH FROM locale)) > 0)),
    CONSTRAINT notification_device_consents_permission_status_check CHECK (((permission_status)::text = ANY ((ARRAY['undetermined'::character varying, 'denied'::character varying, 'granted'::character varying, 'provisional'::character varying, 'ephemeral'::character varying])::text[]))),
    CONSTRAINT notification_device_consents_platform_check CHECK (((platform)::text = ANY ((ARRAY['ios'::character varying, 'android'::character varying])::text[]))),
    CONSTRAINT notification_device_consents_timezone_check CHECK ((length(TRIM(BOTH FROM timezone)) > 0)),
    CONSTRAINT notification_device_consents_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.notification_device_consents FORCE ROW LEVEL SECURITY;


--
-- Name: notification_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    event_type character varying(120) NOT NULL,
    name character varying(160) NOT NULL,
    channels jsonb NOT NULL,
    conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
    quiet_hours jsonb DEFAULT '{}'::jsonb NOT NULL,
    frequency_limit jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.notification_policies FORCE ROW LEVEL SECURITY;


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    recipient_type character varying(30) NOT NULL,
    recipient_id uuid NOT NULL,
    event_type character varying(120) NOT NULL,
    channel character varying(40) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    quiet_hours jsonb DEFAULT '{}'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.notification_preferences FORCE ROW LEVEL SECURITY;


--
-- Name: notification_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    code character varying(100) NOT NULL,
    channel character varying(40) NOT NULL,
    locale character varying(35) NOT NULL,
    version_number integer DEFAULT 1 NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    subject_template text,
    body_template text NOT NULL,
    variables jsonb DEFAULT '[]'::jsonb NOT NULL,
    provider_template_id character varying(255),
    approved_at timestamp with time zone,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.notification_templates FORCE ROW LEVEL SECURITY;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    policy_id uuid,
    template_id uuid,
    recipient_type character varying(30) NOT NULL,
    recipient_id uuid NOT NULL,
    channel character varying(40) NOT NULL,
    status public.notification_status DEFAULT 'pending'::public.notification_status NOT NULL,
    scheduled_for timestamp with time zone DEFAULT now() NOT NULL,
    subject text,
    body text NOT NULL,
    deep_link text,
    idempotency_key character varying(160) NOT NULL,
    correlation_id uuid NOT NULL,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    suppressed_reason character varying(120),
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    event_type character varying(120) DEFAULT 'service'::character varying NOT NULL,
    processing_started_at timestamp with time zone
);


--
-- Name: one_tree_node_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.one_tree_node_revisions (
    workspace_id uuid NOT NULL,
    node_id uuid NOT NULL,
    revision integer NOT NULL,
    source_version integer NOT NULL,
    source_hash character varying(64) NOT NULL,
    label character varying(240) NOT NULL,
    snapshot jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_tree_node_revisions_label_check CHECK ((length(TRIM(BOTH FROM label)) > 0)),
    CONSTRAINT one_tree_node_revisions_revision_check CHECK ((revision > 0)),
    CONSTRAINT one_tree_node_revisions_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object'::text)),
    CONSTRAINT one_tree_node_revisions_source_hash_check CHECK (((source_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT one_tree_node_revisions_source_version_check CHECK ((source_version >= 0))
);

ALTER TABLE ONLY public.one_tree_node_revisions FORCE ROW LEVEL SECURITY;


--
-- Name: one_tree_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.one_tree_nodes (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    job_id uuid NOT NULL,
    case_id uuid NOT NULL,
    parent_id uuid,
    kind character varying(12) NOT NULL,
    source_type character varying(20) NOT NULL,
    source_id uuid NOT NULL,
    status character varying(12) DEFAULT 'active'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    replaces_node_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT one_tree_nodes_check CHECK (((((kind)::text = 'site'::text) AND (parent_id IS NULL)) OR (((kind)::text <> 'site'::text) AND (parent_id IS NOT NULL)))),
    CONSTRAINT one_tree_nodes_check1 CHECK (((((kind)::text = 'site'::text) AND ((source_type)::text = ANY ((ARRAY['case'::character varying, 'manual'::character varying])::text[]))) OR (((kind)::text = 'room'::text) AND ((source_type)::text = 'room'::text)) OR (((kind)::text = 'zone'::text) AND ((source_type)::text = 'manual'::text)) OR (((kind)::text = 'item'::text) AND ((source_type)::text = 'brief_entry'::text)))),
    CONSTRAINT one_tree_nodes_check2 CHECK (((((status)::text = 'active'::text) AND (archived_at IS NULL)) OR (((status)::text = 'archived'::text) AND (archived_at IS NOT NULL)))),
    CONSTRAINT one_tree_nodes_check3 CHECK (((replaces_node_id IS NULL) OR (replaces_node_id <> id))),
    CONSTRAINT one_tree_nodes_kind_check CHECK (((kind)::text = ANY ((ARRAY['site'::character varying, 'room'::character varying, 'zone'::character varying, 'item'::character varying])::text[]))),
    CONSTRAINT one_tree_nodes_source_type_check CHECK (((source_type)::text = ANY ((ARRAY['case'::character varying, 'room'::character varying, 'brief_entry'::character varying, 'manual'::character varying])::text[]))),
    CONSTRAINT one_tree_nodes_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT one_tree_nodes_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.one_tree_nodes FORCE ROW LEVEL SECURITY;


--
-- Name: organization_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    source_workspace_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    request_hash character(64) NOT NULL,
    name character varying(160) NOT NULL,
    slug character varying(80) NOT NULL,
    configuration jsonb NOT NULL,
    reason character varying(500),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    decision_reason character varying(500),
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    approved_workspace_id uuid,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_requests_configuration_check CHECK ((jsonb_typeof(configuration) = 'object'::text)),
    CONSTRAINT organization_requests_decision_check CHECK (((((status)::text = 'pending'::text) AND (reviewed_at IS NULL) AND (approved_workspace_id IS NULL)) OR (((status)::text = 'cancelled'::text) AND (approved_workspace_id IS NULL)) OR (((status)::text = 'rejected'::text) AND (reviewed_at IS NOT NULL) AND (approved_workspace_id IS NULL)) OR (((status)::text = 'approved'::text) AND (reviewed_at IS NOT NULL) AND (approved_workspace_id IS NOT NULL)))),
    CONSTRAINT organization_requests_slug_check CHECK (((slug)::text ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text)),
    CONSTRAINT organization_requests_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT organization_requests_version_check CHECK ((version > 0))
);


--
-- Name: outbox_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    aggregate_type character varying(80) NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type character varying(120) NOT NULL,
    payload jsonb NOT NULL,
    status public.outbox_status DEFAULT 'pending'::public.outbox_status NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    claim_token uuid
);


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash character(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(120) NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_administrators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_administrators (
    user_id uuid NOT NULL,
    role character varying(40) DEFAULT 'administrator'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_administrators_role_check CHECK (((role)::text = ANY ((ARRAY['administrator'::character varying, 'platform_security_owner'::character varying, 'provisioning_operator'::character varying, 'account_billing_operator'::character varying, 'domain_operator'::character varying, 'support_observer'::character varying])::text[]))),
    CONSTRAINT platform_administrators_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying])::text[])))
);


--
-- Name: platform_capability_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_capability_flags (
    code character varying(120) NOT NULL,
    module character varying(20) NOT NULL,
    release_state character varying(24) DEFAULT 'unavailable'::character varying NOT NULL,
    reason character varying(500) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_capability_flags_code_check CHECK (((code)::text ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'::text)),
    CONSTRAINT platform_capability_flags_module_check CHECK (((module)::text = ANY ((ARRAY['workspace'::character varying, 'crm'::character varying, 'pre-project'::character varying, 'projects'::character varying, 'hrms'::character varying])::text[]))),
    CONSTRAINT platform_capability_flags_reason_check CHECK (((length(btrim((reason)::text)) >= 10) AND (length(btrim((reason)::text)) <= 500))),
    CONSTRAINT platform_capability_flags_state_check CHECK (((release_state)::text = ANY ((ARRAY['unavailable'::character varying, 'internal_preview'::character varying, 'available'::character varying])::text[]))),
    CONSTRAINT platform_capability_flags_version_check CHECK ((version > 0))
);


--
-- Name: platform_operator_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_operator_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_user_id uuid,
    action character varying(100) NOT NULL,
    target_type character varying(60),
    target_id character varying(120),
    correlation_id character varying(120),
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_operator_audit_details_check CHECK ((jsonb_typeof(details) = 'object'::text))
);


--
-- Name: platform_operator_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_operator_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash character(64) NOT NULL,
    user_id uuid NOT NULL,
    purpose character varying(20) NOT NULL,
    credential_changed_at timestamp with time zone NOT NULL,
    mfa_session_version integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    failed_attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    ip_address character varying(64),
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_operator_challenges_attempts_check CHECK (((failed_attempts >= 0) AND ((max_attempts >= 1) AND (max_attempts <= 20)))),
    CONSTRAINT platform_operator_challenges_mfa_version_check CHECK ((mfa_session_version >= 0)),
    CONSTRAINT platform_operator_challenges_purpose_check CHECK (((purpose)::text = ANY ((ARRAY['login'::character varying, 'enroll'::character varying])::text[])))
);


--
-- Name: platform_operator_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_operator_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash character(64) NOT NULL,
    user_id uuid NOT NULL,
    credential_changed_at timestamp with time zone NOT NULL,
    mfa_session_version integer NOT NULL,
    mfa_verified_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    ip_address character varying(64),
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_operator_sessions_mfa_version_check CHECK ((mfa_session_version >= 0))
);


--
-- Name: pre_project_asset_markups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_asset_markups (
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    source_asset_id uuid NOT NULL,
    strokes jsonb NOT NULL,
    input_hash character varying(64) NOT NULL,
    CONSTRAINT asset_markup_distinct CHECK ((asset_id <> source_asset_id)),
    CONSTRAINT asset_markup_strokes CHECK (((jsonb_typeof(strokes) = 'array'::text) AND ((jsonb_array_length(strokes) >= 1) AND (jsonb_array_length(strokes) <= 100))))
);

ALTER TABLE ONLY public.pre_project_asset_markups FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_brief_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_brief_assets (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    original_name character varying(240) NOT NULL,
    mime_type character varying(100) NOT NULL,
    byte_size integer NOT NULL,
    object_key text NOT NULL,
    preview_key text,
    sha256 character varying(64) NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pre_project_brief_assets_byte_size_check CHECK (((byte_size > 0) AND (byte_size <= 20971520)))
);

ALTER TABLE ONLY public.pre_project_brief_assets FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_brief_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_brief_entries (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    room_id uuid,
    kind character varying(20) NOT NULL,
    title character varying(240) NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    category character varying(60) DEFAULT 'General'::character varying NOT NULL,
    priority character varying(20) DEFAULT 'preferred'::character varying NOT NULL,
    scope_status character varying(20) DEFAULT 'undecided'::character varying NOT NULL,
    review_status character varying(20) DEFAULT 'captured'::character varying NOT NULL,
    quantity numeric(16,4),
    unit character varying(20) DEFAULT 'nos'::character varying NOT NULL,
    reference_url character varying(2000) DEFAULT ''::character varying NOT NULL,
    avoid text DEFAULT ''::text NOT NULL,
    source character varying(20) DEFAULT 'team'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    note_document jsonb,
    pinned boolean DEFAULT false NOT NULL,
    CONSTRAINT pre_project_brief_entries_kind_check CHECK (((kind)::text = ANY ((ARRAY['requirement'::character varying, 'note'::character varying, 'inspiration'::character varying, 'file'::character varying])::text[]))),
    CONSTRAINT pre_project_brief_entries_priority_check CHECK (((priority)::text = ANY ((ARRAY['must_have'::character varying, 'preferred'::character varying, 'optional'::character varying])::text[]))),
    CONSTRAINT pre_project_brief_entries_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT pre_project_brief_entries_review_status_check CHECK (((review_status)::text = ANY ((ARRAY['captured'::character varying, 'reviewed'::character varying, 'clarification'::character varying])::text[]))),
    CONSTRAINT pre_project_brief_entries_scope_status_check CHECK (((scope_status)::text = ANY ((ARRAY['included'::character varying, 'excluded'::character varying, 'undecided'::character varying])::text[]))),
    CONSTRAINT pre_project_brief_entries_source_check CHECK (((source)::text = ANY ((ARRAY['team'::character varying, 'client'::character varying])::text[]))),
    CONSTRAINT pre_project_brief_entries_title_check CHECK ((length(TRIM(BOTH FROM title)) > 0)),
    CONSTRAINT pre_project_brief_entries_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.pre_project_brief_entries FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_briefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_briefs (
    case_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    content jsonb DEFAULT '{}'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pre_project_briefs_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.pre_project_briefs FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    status character varying(24) DEFAULT 'active'::character varying NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    phase character varying(20) DEFAULT 'discover'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    owner_membership_id uuid,
    target_date date,
    priority character varying(16) DEFAULT 'normal'::character varying NOT NULL,
    risk_level character varying(16) DEFAULT 'none'::character varying NOT NULL,
    activated_at timestamp with time zone,
    hold_reason character varying(500),
    held_at timestamp with time zone,
    held_by uuid,
    cancellation_reason character varying(500),
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    released_at timestamp with time zone,
    released_by uuid,
    CONSTRAINT pre_project_cases_cancel_state_check CHECK (((((status)::text = 'cancelled'::text) AND (cancelled_at IS NOT NULL) AND (cancellation_reason IS NOT NULL) AND (length(TRIM(BOTH FROM cancellation_reason)) > 0)) OR (((status)::text <> 'cancelled'::text) AND (cancelled_at IS NULL) AND (cancelled_by IS NULL) AND (cancellation_reason IS NULL)))),
    CONSTRAINT pre_project_cases_hold_state_check CHECK (((((status)::text = 'on_hold'::text) AND (held_at IS NOT NULL) AND (held_by IS NOT NULL) AND (hold_reason IS NOT NULL) AND (length(TRIM(BOTH FROM hold_reason)) > 0)) OR (((status)::text <> 'on_hold'::text) AND (held_at IS NULL) AND (held_by IS NULL) AND (hold_reason IS NULL)))),
    CONSTRAINT pre_project_cases_phase_check CHECK (((phase)::text = ANY ((ARRAY['discover'::character varying, 'define'::character varying, 'design'::character varying, 'price'::character varying, 'agree'::character varying, 'release'::character varying])::text[]))),
    CONSTRAINT pre_project_cases_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'normal'::character varying, 'high'::character varying, 'urgent'::character varying])::text[]))),
    CONSTRAINT pre_project_cases_release_state_check CHECK (((((status)::text = 'released'::text) AND ((phase)::text = 'release'::text) AND (released_at IS NOT NULL)) OR (((status)::text <> 'released'::text) AND (released_at IS NULL) AND (released_by IS NULL)))),
    CONSTRAINT pre_project_cases_risk_check CHECK (((risk_level)::text = ANY ((ARRAY['none'::character varying, 'low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::text[]))),
    CONSTRAINT pre_project_cases_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'on_hold'::character varying, 'released'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT pre_project_cases_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.pre_project_cases FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_definition_baselines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_definition_baselines (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    number integer NOT NULL,
    request_id uuid NOT NULL,
    request_hash character(64) NOT NULL,
    source_hash character(64) NOT NULL,
    snapshot_hash character(64) NOT NULL,
    snapshot jsonb NOT NULL,
    message character varying(1000) DEFAULT ''::character varying NOT NULL,
    supersedes_id uuid,
    published_by uuid NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pre_project_definition_baselines_number_check CHECK ((number > 0)),
    CONSTRAINT pre_project_definition_baselines_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT pre_project_definition_baselines_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object'::text)),
    CONSTRAINT pre_project_definition_baselines_snapshot_hash_check CHECK ((snapshot_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT pre_project_definition_baselines_source_hash_check CHECK ((source_hash ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY public.pre_project_definition_baselines FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_definition_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_definition_commands (
    workspace_id uuid NOT NULL,
    request_id uuid NOT NULL,
    case_id uuid NOT NULL,
    action character varying(40) NOT NULL,
    request_hash character(64) NOT NULL,
    response_body jsonb NOT NULL,
    actor_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pre_project_definition_commands_action_check CHECK ((length(btrim((action)::text)) > 0)),
    CONSTRAINT pre_project_definition_commands_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT pre_project_definition_commands_response_body_check CHECK ((jsonb_typeof(response_body) = 'object'::text))
);

ALTER TABLE ONLY public.pre_project_definition_commands FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_definition_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_definition_decisions (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    baseline_id uuid NOT NULL,
    request_id uuid,
    request_hash character(64) NOT NULL,
    decision character varying(24) NOT NULL,
    decision_by character varying(240) NOT NULL,
    channel character varying(24) NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    evidence text NOT NULL,
    decided_at timestamp with time zone NOT NULL,
    recorded_by uuid,
    client_grant_id uuid,
    challenge_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pre_project_definition_decisions_actor CHECK (((((channel)::text = 'client_portal'::text) AND (request_id IS NULL) AND (recorded_by IS NULL) AND (client_grant_id IS NOT NULL) AND (challenge_id IS NOT NULL)) OR (((channel)::text <> 'client_portal'::text) AND (request_id IS NOT NULL) AND (recorded_by IS NOT NULL) AND (client_grant_id IS NULL) AND (challenge_id IS NULL)))),
    CONSTRAINT pre_project_definition_decisions_change_note CHECK ((((decision)::text = 'confirmed'::text) OR (length(btrim(note)) > 0))),
    CONSTRAINT pre_project_definition_decisions_channel_check CHECK (((channel)::text = ANY ((ARRAY['client_portal'::character varying, 'meeting'::character varying, 'email'::character varying, 'phone'::character varying, 'whatsapp'::character varying, 'signed_document'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT pre_project_definition_decisions_decision_by_check CHECK ((length(btrim((decision_by)::text)) > 0)),
    CONSTRAINT pre_project_definition_decisions_decision_check CHECK (((decision)::text = ANY ((ARRAY['confirmed'::character varying, 'changes_requested'::character varying])::text[]))),
    CONSTRAINT pre_project_definition_decisions_evidence_check CHECK ((length(btrim(evidence)) > 0)),
    CONSTRAINT pre_project_definition_decisions_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY public.pre_project_definition_decisions FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_design_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_design_activity (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    design_id uuid NOT NULL,
    version_id uuid NOT NULL,
    action character varying(30) NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    decision_by character varying(240) DEFAULT ''::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewer_id uuid,
    decision_source character varying(30),
    decision_at timestamp with time zone,
    client_grant_id uuid,
    CONSTRAINT design_activity_actor_required CHECK ((((created_by IS NOT NULL) AND (client_grant_id IS NULL)) OR ((created_by IS NULL) AND (client_grant_id IS NOT NULL) AND ((decision_source)::text = 'client_portal'::text)))),
    CONSTRAINT pre_project_design_activity_action_check CHECK (((action)::text = ANY ((ARRAY['comment'::character varying, 'internal_review'::character varying, 'internal_approved'::character varying, 'client_review'::character varying, 'approved'::character varying, 'changes_requested'::character varying])::text[])))
);

ALTER TABLE ONLY public.pre_project_design_activity FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_design_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_design_folders (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    room_id uuid,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    scope_entry_id uuid,
    reviewer_id uuid,
    approved_versions jsonb,
    approved_at timestamp with time zone,
    CONSTRAINT pre_project_design_folders_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT pre_project_design_folders_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.pre_project_design_folders FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_design_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_design_messages (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    design_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    body text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pre_project_design_messages_body_check CHECK (((length(TRIM(BOTH FROM body)) > 0) AND (length(body) <= 5000)))
);

ALTER TABLE ONLY public.pre_project_design_messages FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_design_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_design_threads (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    design_id uuid NOT NULL,
    version_id uuid NOT NULL,
    title character varying(240) NOT NULL,
    blocking boolean DEFAULT false NOT NULL,
    status character varying(12) DEFAULT 'open'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    anchor jsonb,
    mentions jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT design_comment_anchor_valid CHECK (((anchor IS NULL) OR ((jsonb_typeof(anchor) = 'object'::text) AND (anchor ? 'x'::text) AND (anchor ? 'y'::text) AND ((((anchor ->> 'x'::text))::numeric >= (0)::numeric) AND (((anchor ->> 'x'::text))::numeric <= (1)::numeric)) AND ((((anchor ->> 'y'::text))::numeric >= (0)::numeric) AND (((anchor ->> 'y'::text))::numeric <= (1)::numeric))))),
    CONSTRAINT pre_project_design_threads_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'resolved'::character varying])::text[]))),
    CONSTRAINT pre_project_design_threads_title_check CHECK ((length(TRIM(BOTH FROM title)) > 0)),
    CONSTRAINT pre_project_design_threads_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.pre_project_design_threads FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_design_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_design_versions (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    design_id uuid NOT NULL,
    number integer NOT NULL,
    asset_id uuid NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewer_id uuid,
    included_client_rounds smallint,
    client_review_expires_at timestamp with time zone,
    CONSTRAINT pre_project_design_versions_client_rounds_check CHECK (((included_client_rounds IS NULL) OR ((included_client_rounds >= 0) AND (included_client_rounds <= 99)))),
    CONSTRAINT pre_project_design_versions_number_check CHECK ((number > 0)),
    CONSTRAINT pre_project_design_versions_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'internal_review'::character varying, 'internal_approved'::character varying, 'client_review'::character varying, 'approved'::character varying, 'changes_requested'::character varying, 'rejected'::character varying])::text[])))
);

ALTER TABLE ONLY public.pre_project_design_versions FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_designs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_designs (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    room_id uuid,
    scope_entry_id uuid,
    title character varying(240) NOT NULL,
    document_type character varying(60) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    archived_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    folder_id uuid,
    CONSTRAINT pre_project_designs_title_check CHECK ((length(TRIM(BOTH FROM title)) > 0)),
    CONSTRAINT pre_project_designs_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.pre_project_designs FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_entry_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_entry_assets (
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    asset_id uuid NOT NULL
);

ALTER TABLE ONLY public.pre_project_entry_assets FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_item_design_refs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_item_design_refs (
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    version integer NOT NULL,
    design_version_id uuid NOT NULL,
    usage character varying(10) NOT NULL,
    sheet character varying(120) DEFAULT ''::character varying NOT NULL,
    CONSTRAINT pre_project_item_design_refs_usage_check CHECK (((usage)::text = ANY ((ARRAY['2d'::character varying, '3d'::character varying, 'reference'::character varying])::text[])))
);

ALTER TABLE ONLY public.pre_project_item_design_refs FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_item_specifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_item_specifications (
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    version integer NOT NULL,
    content jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pre_project_item_specifications_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.pre_project_item_specifications FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_lifecycle_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_lifecycle_commands (
    workspace_id uuid NOT NULL,
    request_id uuid NOT NULL,
    case_id uuid NOT NULL,
    action character varying(40) NOT NULL,
    request_hash character(64) NOT NULL,
    response_body jsonb,
    actor_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pre_project_lifecycle_commands_action_check CHECK ((length(TRIM(BOTH FROM action)) > 0)),
    CONSTRAINT pre_project_lifecycle_commands_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT pre_project_lifecycle_commands_response_body_check CHECK (((response_body IS NULL) OR (jsonb_typeof(response_body) = 'object'::text)))
);

ALTER TABLE ONLY public.pre_project_lifecycle_commands FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_rooms (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    catalog_record_id uuid,
    catalog_snapshot jsonb,
    CONSTRAINT pre_project_rooms_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT pre_project_rooms_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.pre_project_rooms FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_scope_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_scope_links (
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    record_id uuid NOT NULL,
    snapshot jsonb NOT NULL,
    CONSTRAINT pre_project_scope_links_role_check CHECK (((role)::text = ANY ((ARRAY['work'::character varying, 'variant'::character varying, 'material'::character varying, 'brand'::character varying, 'finish'::character varying, 'unit'::character varying, 'execution'::character varying])::text[])))
);

ALTER TABLE ONLY public.pre_project_scope_links FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_site_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_site_assets (
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    record_id uuid NOT NULL,
    version integer NOT NULL,
    asset_id uuid NOT NULL
);

ALTER TABLE ONLY public.pre_project_site_assets FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_site_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_site_records (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    kind character varying(20) NOT NULL,
    room_id uuid,
    entry_id uuid,
    visit_id uuid,
    title character varying(240) NOT NULL,
    status character varying(24) NOT NULL,
    version integer NOT NULL,
    content jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    site_id uuid,
    CONSTRAINT pre_project_site_records_check CHECK (((((kind)::text = 'visit'::text) AND ((status)::text = ANY ((ARRAY['planned'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])) AND (room_id IS NULL) AND (entry_id IS NULL) AND (visit_id IS NULL)) OR (((kind)::text = 'measurement'::text) AND ((status)::text = ANY ((ARRAY['incomplete'::character varying, 'measured'::character varying, 'verified'::character varying, 'recheck'::character varying])::text[])) AND ((room_id IS NOT NULL) OR (entry_id IS NOT NULL))) OR (((kind)::text = 'observation'::text) AND ((status)::text = ANY ((ARRAY['open'::character varying, 'resolved'::character varying])::text[]))))),
    CONSTRAINT pre_project_site_records_kind_check CHECK (((kind)::text = ANY ((ARRAY['visit'::character varying, 'measurement'::character varying, 'observation'::character varying])::text[]))),
    CONSTRAINT pre_project_site_records_title_check CHECK ((length(TRIM(BOTH FROM title)) > 0)),
    CONSTRAINT pre_project_site_records_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.pre_project_site_records FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_site_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_site_revisions (
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    record_id uuid NOT NULL,
    version integer NOT NULL,
    content jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pre_project_site_revisions_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.pre_project_site_revisions FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_site_specification_refs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_site_specification_refs (
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    record_id uuid NOT NULL,
    version integer NOT NULL,
    entry_id uuid NOT NULL,
    specification_version integer NOT NULL
);

ALTER TABLE ONLY public.pre_project_site_specification_refs FORCE ROW LEVEL SECURITY;


--
-- Name: pre_project_specification_catalog_refs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_project_specification_catalog_refs (
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    version integer NOT NULL,
    record_id uuid NOT NULL
);

ALTER TABLE ONLY public.pre_project_specification_catalog_refs FORCE ROW LEVEL SECURITY;


--
-- Name: project_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid,
    case_id uuid,
    membership_id uuid NOT NULL,
    is_manager boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT project_assignments_check CHECK ((num_nonnulls(project_id, case_id) = 1))
);

ALTER TABLE ONLY public.project_assignments FORCE ROW LEVEL SECURITY;


--
-- Name: project_booking_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_booking_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    booking_id uuid NOT NULL,
    action character varying(32) NOT NULL,
    from_status character varying(16),
    to_status character varying(16) NOT NULL,
    reason character varying(1000) DEFAULT ''::character varying NOT NULL,
    snapshot jsonb NOT NULL,
    actor_user_id uuid,
    request_id character varying(80),
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_booking_history_action_check CHECK (((action)::text = ANY ((ARRAY['migrated'::character varying, 'created'::character varying, 'status_changed'::character varying, 'rescheduled'::character varying, 'cancelled'::character varying, 'completed'::character varying])::text[]))),
    CONSTRAINT project_booking_history_from_status_check CHECK (((from_status IS NULL) OR ((from_status)::text = ANY ((ARRAY['draft'::character varying, 'tentative'::character varying, 'confirmed'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))),
    CONSTRAINT project_booking_history_request_id_check CHECK (((request_id IS NULL) OR ((request_id)::text ~ '^[A-Za-z0-9_-]{16,80}$'::text))),
    CONSTRAINT project_booking_history_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object'::text)),
    CONSTRAINT project_booking_history_to_status_check CHECK (((to_status)::text = ANY ((ARRAY['draft'::character varying, 'tentative'::character varying, 'confirmed'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))
);

ALTER TABLE ONLY public.project_booking_history FORCE ROW LEVEL SECURITY;


--
-- Name: project_booking_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_booking_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    booking_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id character varying(80) NOT NULL,
    resource_id uuid NOT NULL,
    local_date date NOT NULL,
    end_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    timezone character varying(64) NOT NULL,
    units numeric(10,3) DEFAULT 1 NOT NULL,
    member_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    calendar_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_booking_slots_calendar_snapshot_check CHECK ((jsonb_typeof(calendar_snapshot) = 'object'::text)),
    CONSTRAINT project_booking_slots_dates_check CHECK ((end_date >= local_date)),
    CONSTRAINT project_booking_slots_instants_check CHECK ((ends_at > starts_at)),
    CONSTRAINT project_booking_slots_units_check CHECK (((units > (0)::numeric) AND (units <= (100000)::numeric)))
);

ALTER TABLE ONLY public.project_booking_slots FORCE ROW LEVEL SECURITY;


--
-- Name: project_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id character varying(80) NOT NULL,
    resource_id uuid NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    status character varying(16) NOT NULL,
    acknowledgement text DEFAULT ''::text NOT NULL,
    member_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    slots jsonb DEFAULT '[]'::jsonb NOT NULL,
    units numeric(10,3) DEFAULT 1 NOT NULL,
    timezone character varying(64) NOT NULL,
    calendar_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    request_id character varying(80),
    created_by uuid,
    updated_by uuid,
    cancellation_reason character varying(1000),
    confirmed_at timestamp with time zone,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_bookings_calendar_snapshot_check CHECK ((jsonb_typeof(calendar_snapshot) = 'object'::text)),
    CONSTRAINT project_bookings_check CHECK ((ends_on >= starts_on)),
    CONSTRAINT project_bookings_request_id_check CHECK (((request_id IS NULL) OR ((request_id)::text ~ '^[A-Za-z0-9_-]{16,80}$'::text))),
    CONSTRAINT project_bookings_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'tentative'::character varying, 'confirmed'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT project_bookings_units_check CHECK (((units > (0)::numeric) AND (units <= (100000)::numeric))),
    CONSTRAINT project_bookings_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.project_bookings FORCE ROW LEVEL SECURITY;


--
-- Name: project_execution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_execution (
    project_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    content jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.project_execution FORCE ROW LEVEL SECURITY;


--
-- Name: project_factory_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_factory_allocations (
    workspace_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id character varying(80) NOT NULL,
    snapshot jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.project_factory_allocations FORCE ROW LEVEL SECURITY;


--
-- Name: project_factory_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_factory_batches (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    content jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.project_factory_batches FORCE ROW LEVEL SECURITY;


--
-- Name: project_factory_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_factory_commands (
    workspace_id uuid NOT NULL,
    request_id uuid NOT NULL,
    payload_hash character varying(64) NOT NULL,
    batch_id uuid NOT NULL
);

ALTER TABLE ONLY public.project_factory_commands FORCE ROW LEVEL SECURITY;


--
-- Name: project_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    kind character varying(16) NOT NULL,
    members uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    calendar jsonb,
    business_unit_id uuid,
    workspace_team_id uuid,
    capacity_mode character varying(16) DEFAULT 'exclusive'::character varying NOT NULL,
    capacity numeric(10,3) DEFAULT 1 NOT NULL,
    timezone character varying(64),
    version integer DEFAULT 1 NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_resources_capacity_check CHECK (((capacity > (0)::numeric) AND (capacity <= (100000)::numeric))),
    CONSTRAINT project_resources_capacity_mode_check CHECK (((capacity_mode)::text = ANY ((ARRAY['exclusive'::character varying, 'pooled'::character varying])::text[]))),
    CONSTRAINT project_resources_kind_capacity_check CHECK ((((kind)::text = ANY ((ARRAY['factory'::character varying, 'vendor'::character varying])::text[])) OR (((capacity_mode)::text = 'exclusive'::text) AND (capacity = (1)::numeric)))),
    CONSTRAINT project_resources_kind_check CHECK (((kind)::text = ANY ((ARRAY['crew'::character varying, 'person'::character varying, 'factory'::character varying, 'vendor'::character varying])::text[]))),
    CONSTRAINT project_resources_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.project_resources FORCE ROW LEVEL SECURITY;


--
-- Name: project_stock_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_stock_commands (
    workspace_id uuid NOT NULL,
    request_id uuid NOT NULL,
    payload_hash character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.project_stock_commands FORCE ROW LEVEL SECURITY;


--
-- Name: project_stock_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_stock_transfers (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    content jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.project_stock_transfers FORCE ROW LEVEL SECURITY;


--
-- Name: project_vendor_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_vendor_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    order_id character varying(80) NOT NULL,
    token_hash character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    window_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_warehouse_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_warehouse_stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    location character varying(160) NOT NULL,
    catalog_id uuid NOT NULL,
    catalog_version integer NOT NULL,
    title character varying(240) NOT NULL,
    unit character varying(40) NOT NULL,
    quantity numeric(18,4) NOT NULL,
    reserved numeric(18,4) DEFAULT 0 NOT NULL,
    opening_reference text NOT NULL,
    CONSTRAINT project_warehouse_stock_check CHECK (((reserved >= (0)::numeric) AND (reserved <= quantity))),
    CONSTRAINT project_warehouse_stock_quantity_check CHECK ((quantity >= (0)::numeric))
);

ALTER TABLE ONLY public.project_warehouse_stock FORCE ROW LEVEL SECURITY;


--
-- Name: project_workflow_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_workflow_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    code character varying(64) NOT NULL,
    name character varying(120) NOT NULL,
    description character varying(1000) DEFAULT ''::character varying NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    stages jsonb NOT NULL,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_workflow_templates_code_check CHECK (((code)::text ~ '^[a-z][a-z0-9_]{0,63}$'::text)),
    CONSTRAINT project_workflow_templates_default_check CHECK ((((status)::text = 'active'::text) OR (is_default = false))),
    CONSTRAINT project_workflow_templates_name_check CHECK (((length(btrim((name)::text)) >= 1) AND (length(btrim((name)::text)) <= 120))),
    CONSTRAINT project_workflow_templates_stages_check CHECK (((jsonb_typeof(stages) = 'array'::text) AND ((jsonb_array_length(stages) >= 2) AND (jsonb_array_length(stages) <= 18)))),
    CONSTRAINT project_workflow_templates_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT project_workflow_templates_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.project_workflow_templates FORCE ROW LEVEL SECURITY;


--
-- Name: quotation_proposal_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotation_proposal_commands (
    workspace_id uuid NOT NULL,
    request_id uuid NOT NULL,
    case_id uuid NOT NULL,
    run_id uuid,
    action character varying(20) NOT NULL,
    request_hash character(64) NOT NULL,
    response_body jsonb NOT NULL,
    actor_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quotation_proposal_commands_action_check CHECK (((action)::text = ANY ((ARRAY['create'::character varying, 'apply'::character varying, 'dismiss'::character varying])::text[]))),
    CONSTRAINT quotation_proposal_commands_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT quotation_proposal_commands_response_body_check CHECK ((jsonb_typeof(response_body) = 'object'::text))
);

ALTER TABLE ONLY public.quotation_proposal_commands FORCE ROW LEVEL SECURITY;


--
-- Name: quotation_proposal_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotation_proposal_runs (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    case_id uuid NOT NULL,
    quote_id uuid NOT NULL,
    mode character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'proposed'::character varying NOT NULL,
    commercial_revision integer NOT NULL,
    quote_draft_hash character(64) NOT NULL,
    definition_baseline_id uuid NOT NULL,
    definition_snapshot_hash character(64) NOT NULL,
    definition_source_hash character(64) NOT NULL,
    proposal_hash character(64) NOT NULL,
    proposal jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_by uuid,
    applied_at timestamp with time zone,
    applied_revision integer,
    dismissed_by uuid,
    dismissed_at timestamp with time zone,
    CONSTRAINT quotation_proposal_runs_applied_revision_check CHECK ((applied_revision >= 0)),
    CONSTRAINT quotation_proposal_runs_commercial_revision_check CHECK ((commercial_revision >= 0)),
    CONSTRAINT quotation_proposal_runs_definition_snapshot_hash_check CHECK ((definition_snapshot_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT quotation_proposal_runs_definition_source_hash_check CHECK ((definition_source_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT quotation_proposal_runs_mode_check CHECK (((mode)::text = ANY ((ARRAY['scope'::character varying, 'assistant'::character varying])::text[]))),
    CONSTRAINT quotation_proposal_runs_proposal_check CHECK ((jsonb_typeof(proposal) = 'object'::text)),
    CONSTRAINT quotation_proposal_runs_proposal_hash_check CHECK ((proposal_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT quotation_proposal_runs_quote_draft_hash_check CHECK ((quote_draft_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT quotation_proposal_runs_status_check CHECK (((status)::text = ANY ((ARRAY['proposed'::character varying, 'applied'::character varying, 'dismissed'::character varying])::text[]))),
    CONSTRAINT quotation_proposal_runs_terminal_state CHECK (((((status)::text = 'proposed'::text) AND (applied_by IS NULL) AND (applied_at IS NULL) AND (applied_revision IS NULL) AND (dismissed_by IS NULL) AND (dismissed_at IS NULL)) OR (((status)::text = 'applied'::text) AND (applied_by IS NOT NULL) AND (applied_at IS NOT NULL) AND (applied_revision IS NOT NULL) AND (dismissed_by IS NULL) AND (dismissed_at IS NULL)) OR (((status)::text = 'dismissed'::text) AND (dismissed_by IS NOT NULL) AND (dismissed_at IS NOT NULL) AND (applied_by IS NULL) AND (applied_at IS NULL) AND (applied_revision IS NULL))))
);

ALTER TABLE ONLY public.quotation_proposal_runs FORCE ROW LEVEL SECURITY;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    workspace_id uuid NOT NULL,
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.role_permissions FORCE ROW LEVEL SECURITY;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    code character varying(64) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.roles FORCE ROW LEVEL SECURITY;


--
-- Name: sync_cursors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_cursors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    resource_id uuid,
    cursor_type character varying(50) NOT NULL,
    cursor_value text NOT NULL,
    channel_id character varying(255),
    channel_expires_at timestamp with time zone,
    last_successful_sync_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.sync_cursors FORCE ROW LEVEL SECURITY;


--
-- Name: tax_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    jurisdiction_code character varying(32) NOT NULL,
    scheme character varying(40) NOT NULL,
    registration_number character varying(100),
    prices_include_tax boolean DEFAULT false NOT NULL,
    rounding_mode character varying(40) DEFAULT 'half_up'::character varying NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    effective_to timestamp with time zone,
    status public.entity_status DEFAULT 'active'::public.entity_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.tax_profiles FORCE ROW LEVEL SECURITY;


--
-- Name: tenant_data_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_data_exports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    object_key text NOT NULL,
    sha256 character(64) NOT NULL,
    byte_size bigint NOT NULL,
    table_count integer NOT NULL,
    record_count integer NOT NULL,
    file_count integer NOT NULL,
    file_bytes bigint NOT NULL,
    status character varying(20) DEFAULT 'verified'::character varying NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    downloaded_at timestamp with time zone,
    CONSTRAINT tenant_data_exports_hash_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT tenant_data_exports_size_check CHECK (((byte_size >= 0) AND (table_count >= 0) AND (record_count >= 0) AND (file_count >= 0) AND (file_bytes >= 0))),
    CONSTRAINT tenant_data_exports_status_check CHECK (((status)::text = ANY ((ARRAY['verified'::character varying, 'expired'::character varying, 'removed'::character varying])::text[])))
);

ALTER TABLE ONLY public.tenant_data_exports FORCE ROW LEVEL SECURITY;


--
-- Name: tenant_lifecycle_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_lifecycle_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    version integer NOT NULL,
    state character varying(20) NOT NULL,
    previous_state character varying(20) NOT NULL,
    grace_ends_at timestamp with time zone,
    reason character varying(500) NOT NULL,
    notice_required boolean NOT NULL,
    notice_delivery_state character varying(24) DEFAULT 'not_configured'::character varying NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    request_hash character(64) NOT NULL,
    correlation_id uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_lifecycle_distinct_state_check CHECK (((state)::text <> (previous_state)::text)),
    CONSTRAINT tenant_lifecycle_grace_check CHECK ((((state)::text = 'grace'::text) = (grace_ends_at IS NOT NULL))),
    CONSTRAINT tenant_lifecycle_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT tenant_lifecycle_notice_check CHECK (((notice_delivery_state)::text = ANY ((ARRAY['not_required'::character varying, 'not_configured'::character varying])::text[]))),
    CONSTRAINT tenant_lifecycle_previous_state_check CHECK (((previous_state)::text = ANY ((ARRAY['draft'::character varying, 'trial'::character varying, 'active'::character varying, 'grace'::character varying, 'suspended'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT tenant_lifecycle_reason_check CHECK (((length(btrim((reason)::text)) >= 10) AND (length(btrim((reason)::text)) <= 500))),
    CONSTRAINT tenant_lifecycle_state_check CHECK (((state)::text = ANY ((ARRAY['draft'::character varying, 'trial'::character varying, 'active'::character varying, 'grace'::character varying, 'suspended'::character varying, 'archived'::character varying])::text[])))
);

ALTER TABLE ONLY public.tenant_lifecycle_versions FORCE ROW LEVEL SECURITY;


--
-- Name: tenant_login_branding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_login_branding (
    workspace_id uuid NOT NULL,
    login_slug character varying(80) NOT NULL,
    display_name character varying(160) NOT NULL,
    logo_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    logo_asset_id uuid,
    primary_color character varying(7),
    secondary_color character varying(7),
    heading_font character varying(40),
    body_font character varying(40),
    CONSTRAINT tenant_login_branding_body_font_check CHECK (((body_font IS NULL) OR ((body_font)::text = 'montserrat'::text))),
    CONSTRAINT tenant_login_branding_heading_font_check CHECK (((heading_font IS NULL) OR ((heading_font)::text = 'alta'::text))),
    CONSTRAINT tenant_login_branding_primary_color_check CHECK (((primary_color IS NULL) OR ((primary_color)::text ~ '^#[0-9A-F]{6}$'::text))),
    CONSTRAINT tenant_login_branding_secondary_color_check CHECK (((secondary_color IS NULL) OR ((secondary_color)::text ~ '^#[0-9A-F]{6}$'::text)))
);


--
-- Name: tenant_operation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_operation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    target_workspace_id uuid,
    operation_type character varying(20) NOT NULL,
    phase character varying(20) DEFAULT 'dry_run'::character varying NOT NULL,
    status character varying(20) DEFAULT 'planned'::character varying NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    request_hash character(64) NOT NULL,
    reason character varying(500) NOT NULL,
    plan jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb,
    rollback_of uuid,
    requested_by uuid NOT NULL,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT tenant_operation_runs_approval_check CHECK (((approved_by IS NULL) OR (approved_by <> requested_by))),
    CONSTRAINT tenant_operation_runs_phase_check CHECK (((phase)::text = ANY ((ARRAY['dry_run'::character varying, 'apply'::character varying, 'rollback'::character varying])::text[]))),
    CONSTRAINT tenant_operation_runs_plan_check CHECK (((jsonb_typeof(plan) = 'object'::text) AND ((result IS NULL) OR (jsonb_typeof(result) = 'object'::text)))),
    CONSTRAINT tenant_operation_runs_reason_check CHECK (((length(btrim((reason)::text)) >= 10) AND (length(btrim((reason)::text)) <= 500))),
    CONSTRAINT tenant_operation_runs_request_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT tenant_operation_runs_status_check CHECK (((status)::text = ANY ((ARRAY['planned'::character varying, 'blocked'::character varying, 'queued'::character varying, 'running'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT tenant_operation_runs_target_check CHECK (((((operation_type)::text = 'clone'::text) AND (target_workspace_id IS NOT NULL) AND (target_workspace_id <> workspace_id)) OR ((operation_type)::text <> 'clone'::text))),
    CONSTRAINT tenant_operation_runs_type_check CHECK (((operation_type)::text = ANY ((ARRAY['clone'::character varying, 'export'::character varying, 'erasure'::character varying])::text[]))),
    CONSTRAINT tenant_operation_runs_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.tenant_operation_runs FORCE ROW LEVEL SECURITY;


--
-- Name: tenant_provisioning_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_provisioning_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    external_tenant_id character varying(160) NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    provision_idempotency_key character varying(160),
    request_hash character(64) NOT NULL,
    account jsonb NOT NULL,
    organization jsonb NOT NULL,
    owner jsonb NOT NULL,
    defaults jsonb NOT NULL,
    slug character varying(80) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    reservation_expires_at timestamp with time zone NOT NULL,
    workspace_id uuid,
    last_error_code character varying(80),
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_provisioning_drafts_json_check CHECK (((jsonb_typeof(account) = 'object'::text) AND (jsonb_typeof(organization) = 'object'::text) AND (jsonb_typeof(owner) = 'object'::text) AND (jsonb_typeof(defaults) = 'object'::text))),
    CONSTRAINT tenant_provisioning_drafts_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'provisioning'::character varying, 'provisioned'::character varying, 'failed'::character varying, 'expired'::character varying])::text[]))),
    CONSTRAINT tenant_provisioning_drafts_version_check CHECK ((version > 0))
);


--
-- Name: tenant_provisioning_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_provisioning_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    external_tenant_id character varying(160) NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    request_hash character(64) NOT NULL,
    workspace_id uuid NOT NULL,
    response_body jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tenant_setup_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_setup_profiles (
    kind character varying(20) NOT NULL,
    code character varying(40) NOT NULL,
    version integer NOT NULL,
    configuration jsonb NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    selectable boolean DEFAULT true NOT NULL,
    CONSTRAINT tenant_setup_profiles_configuration_check CHECK ((jsonb_typeof(configuration) = 'object'::text)),
    CONSTRAINT tenant_setup_profiles_kind_check CHECK (((kind)::text = ANY ((ARRAY['region'::character varying, 'firm_kit'::character varying, 'plan'::character varying])::text[]))),
    CONSTRAINT tenant_setup_profiles_version_check CHECK ((version > 0))
);


--
-- Name: tenant_support_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_support_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    approved_by uuid,
    access_level character varying(24) DEFAULT 'read_only'::character varying NOT NULL,
    status character varying(20) DEFAULT 'requested'::character varying NOT NULL,
    reason character varying(500) NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_at timestamp with time zone,
    starts_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    correlation_id uuid NOT NULL,
    CONSTRAINT tenant_support_sessions_access_check CHECK (((access_level)::text = ANY ((ARRAY['read_only'::character varying, 'limited_write'::character varying])::text[]))),
    CONSTRAINT tenant_support_sessions_approval_check CHECK (((approved_by IS NULL) OR (approved_by <> requested_by))),
    CONSTRAINT tenant_support_sessions_reason_check CHECK (((length(btrim((reason)::text)) >= 10) AND (length(btrim((reason)::text)) <= 500))),
    CONSTRAINT tenant_support_sessions_status_check CHECK (((status)::text = ANY ((ARRAY['requested'::character varying, 'active'::character varying, 'rejected'::character varying, 'revoked'::character varying, 'expired'::character varying])::text[]))),
    CONSTRAINT tenant_support_sessions_time_check CHECK (((expires_at > requested_at) AND (expires_at <= (requested_at + '08:00:00'::interval)))),
    CONSTRAINT tenant_support_sessions_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.tenant_support_sessions FORCE ROW LEVEL SECURITY;


--
-- Name: user_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(40) NOT NULL,
    provider_subject character varying(255) NOT NULL,
    email_at_provider public.citext NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_mfa_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_mfa_credentials (
    user_id uuid NOT NULL,
    encrypted_totp_secret text NOT NULL,
    encryption_nonce character varying(32) NOT NULL,
    encryption_auth_tag character varying(32) NOT NULL,
    encryption_key_version integer DEFAULT 1 NOT NULL,
    setup_expires_at timestamp with time zone NOT NULL,
    confirmed_at timestamp with time zone,
    disabled_at timestamp with time zone,
    last_used_step bigint,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_mfa_credentials_failed_attempts_check CHECK ((failed_attempts >= 0)),
    CONSTRAINT user_mfa_credentials_key_version_check CHECK ((encryption_key_version > 0)),
    CONSTRAINT user_mfa_credentials_state_check CHECK ((NOT ((confirmed_at IS NOT NULL) AND (disabled_at IS NOT NULL))))
);


--
-- Name: user_mfa_recovery_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_mfa_recovery_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    code_hash character(64) NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    primary_email public.citext NOT NULL,
    display_name character varying(160) NOT NULL,
    preferred_locale character varying(35) DEFAULT 'en'::character varying NOT NULL,
    preferred_timezone character varying(64) DEFAULT 'UTC'::character varying NOT NULL,
    status public.user_status DEFAULT 'active'::public.user_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    mfa_session_version integer DEFAULT 0 NOT NULL,
    CONSTRAINT users_mfa_session_version_check CHECK ((mfa_session_version >= 0))
);


--
-- Name: webhook_inbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_inbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    connection_id uuid,
    provider character varying(50) NOT NULL,
    external_event_id character varying(255) NOT NULL,
    payload_hash character(64) NOT NULL,
    signature_verified boolean DEFAULT false NOT NULL,
    payload jsonb NOT NULL,
    status public.processing_status DEFAULT 'pending'::public.processing_status NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    processed_at timestamp with time zone,
    last_error text,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.webhook_inbox FORCE ROW LEVEL SECURITY;


--
-- Name: work_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    kind character varying(16) NOT NULL,
    project_id uuid,
    case_id uuid,
    address character varying(500) DEFAULT ''::character varying NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    radius_m integer DEFAULT 150 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT work_locations_check CHECK (((((kind)::text = 'office'::text) AND (num_nonnulls(project_id, case_id) = 0)) OR (((kind)::text = 'site'::text) AND (num_nonnulls(project_id, case_id) = 1)))),
    CONSTRAINT work_locations_kind_check CHECK (((kind)::text = ANY ((ARRAY['office'::character varying, 'site'::character varying])::text[]))),
    CONSTRAINT work_locations_latitude_check CHECK (((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision))),
    CONSTRAINT work_locations_longitude_check CHECK (((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision))),
    CONSTRAINT work_locations_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT work_locations_radius_m_check CHECK (((radius_m >= 25) AND (radius_m <= 2000)))
);

ALTER TABLE ONLY public.work_locations FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_brand_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_brand_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    object_key text NOT NULL,
    original_filename character varying(255) NOT NULL,
    mime_type character varying(64) NOT NULL,
    expected_byte_size integer NOT NULL,
    byte_size integer,
    width integer,
    height integer,
    variants jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.brand_asset_status DEFAULT 'pending'::public.brand_asset_status NOT NULL,
    created_by uuid NOT NULL,
    upload_expires_at timestamp with time zone NOT NULL,
    activated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_brand_assets_dimensions_check CHECK ((((width IS NULL) AND (height IS NULL)) OR ((width > 0) AND (height > 0)))),
    CONSTRAINT workspace_brand_assets_expected_size_check CHECK (((expected_byte_size > 0) AND (expected_byte_size <= 5242880)))
);

ALTER TABLE ONLY public.workspace_brand_assets FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_catalog_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_catalog_assets (
    workspace_id uuid NOT NULL,
    id uuid NOT NULL,
    catalog_record_id uuid NOT NULL,
    role character varying(24) NOT NULL,
    original_name character varying(240) NOT NULL,
    mime_type character varying(100) NOT NULL,
    byte_size integer NOT NULL,
    object_key text NOT NULL,
    preview_key text,
    sha256 character(64) NOT NULL,
    alt_text character varying(300),
    sort_order integer DEFAULT 0 NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    archived_reason character varying(500),
    archived_at timestamp with time zone,
    archived_by uuid,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_catalog_assets_archive_check CHECK (((((status)::text = 'archived'::text) AND (archived_reason IS NOT NULL) AND (length(btrim((archived_reason)::text)) > 0) AND (archived_at IS NOT NULL) AND (archived_by IS NOT NULL)) OR (((status)::text = 'active'::text) AND (archived_reason IS NULL) AND (archived_at IS NULL) AND (archived_by IS NULL)))),
    CONSTRAINT workspace_catalog_assets_mime_check CHECK ((((mime_type)::text = ANY ((ARRAY['image/jpeg'::character varying, 'image/png'::character varying, 'image/webp'::character varying, 'image/gif'::character varying, 'image/avif'::character varying, 'image/heic'::character varying, 'application/pdf'::character varying])::text[])) AND (((role)::text = 'technical_drawing'::text) OR ((mime_type)::text <> 'application/pdf'::text)))),
    CONSTRAINT workspace_catalog_assets_name_check CHECK (((length(btrim((original_name)::text)) >= 1) AND (length(btrim((original_name)::text)) <= 240))),
    CONSTRAINT workspace_catalog_assets_role_check CHECK (((role)::text = ANY ((ARRAY['primary_image'::character varying, 'gallery_image'::character varying, 'technical_drawing'::character varying])::text[]))),
    CONSTRAINT workspace_catalog_assets_sha_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT workspace_catalog_assets_size_check CHECK (((byte_size >= 1) AND (byte_size <= 20971520))),
    CONSTRAINT workspace_catalog_assets_sort_check CHECK (((sort_order >= 0) AND (sort_order <= 1000000))),
    CONSTRAINT workspace_catalog_assets_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT workspace_catalog_assets_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.workspace_catalog_assets FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_catalog_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_catalog_links (
    workspace_id uuid NOT NULL,
    record_id uuid NOT NULL,
    target_id uuid NOT NULL,
    relation character varying(24) NOT NULL,
    CONSTRAINT workspace_catalog_links_check CHECK ((record_id <> target_id)),
    CONSTRAINT workspace_catalog_links_relation_check CHECK (((relation)::text = ANY ((ARRAY['room'::character varying, 'work'::character varying, 'category'::character varying, 'material'::character varying, 'finish'::character varying, 'brand'::character varying, 'unit'::character varying, 'service'::character varying, 'sku'::character varying, 'hardware'::character varying, 'consumable'::character varying, 'execution'::character varying, 'factory_process'::character varying, 'site_process'::character varying, 'resource'::character varying, 'measurement'::character varying, 'construction'::character varying, 'variant_rule'::character varying, 'execution_rule'::character varying, 'wastage_rule'::character varying, 'logistics_rule'::character varying, 'installation_rule'::character varying, 'commercial_rule'::character varying, 'tax'::character varying, 'rate_zone'::character varying, 'rate_card'::character varying, 'catalog_group'::character varying, 'record_group'::character varying, 'custom'::character varying, 'variant'::character varying, 'parent'::character varying, 'related'::character varying])::text[])))
);

ALTER TABLE ONLY public.workspace_catalog_links FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_catalog_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_catalog_records (
    workspace_id uuid NOT NULL,
    id uuid NOT NULL,
    kind character varying(24) NOT NULL,
    code character varying(80) NOT NULL,
    name character varying(180) NOT NULL,
    content jsonb NOT NULL,
    starter_version character varying(40),
    version integer DEFAULT 1 NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    catalog_id uuid,
    CONSTRAINT workspace_catalog_commerce_check CHECK (((NOT (content ? 'commerce'::text)) OR ((jsonb_typeof((content -> 'commerce'::text)) = 'object'::text) AND (((content -> 'commerce'::text) ->> 'pricingMode'::text) = ANY (ARRAY['unpriced'::text, 'fixed'::text, 'on_request'::text]))))),
    CONSTRAINT workspace_catalog_owner_check CHECK (((((kind)::text = 'catalog_group'::text) AND (catalog_id IS NULL)) OR (((kind)::text <> 'catalog_group'::text) AND (catalog_id IS NOT NULL)))),
    CONSTRAINT workspace_catalog_provenance_check CHECK (((NOT (content ? 'provenance'::text)) OR ((jsonb_typeof((content -> 'provenance'::text)) = 'object'::text) AND (((content -> 'provenance'::text) ->> 'namespace'::text) ~ '^[a-z0-9][a-z0-9._:-]{0,119}$'::text) AND ((length(btrim(((content -> 'provenance'::text) ->> 'sourceKey'::text))) >= 1) AND (length(btrim(((content -> 'provenance'::text) ->> 'sourceKey'::text))) <= 300)) AND (((content -> 'provenance'::text) ->> 'sourceFingerprint'::text) ~ '^[0-9a-f]{64}$'::text) AND (((content -> 'provenance'::text) ->> 'reviewStatus'::text) = ANY (ARRAY['needs_review'::text, 'approved'::text, 'rejected'::text]))))),
    CONSTRAINT workspace_catalog_records_content_check CHECK ((jsonb_typeof(content) = 'object'::text)),
    CONSTRAINT workspace_catalog_records_kind_check CHECK (((kind)::text = ANY ((ARRAY['room'::character varying, 'work'::character varying, 'category'::character varying, 'material'::character varying, 'finish'::character varying, 'brand'::character varying, 'unit'::character varying, 'service'::character varying, 'sku'::character varying, 'hardware'::character varying, 'consumable'::character varying, 'execution'::character varying, 'factory_process'::character varying, 'site_process'::character varying, 'resource'::character varying, 'measurement'::character varying, 'construction'::character varying, 'variant_rule'::character varying, 'execution_rule'::character varying, 'wastage_rule'::character varying, 'logistics_rule'::character varying, 'installation_rule'::character varying, 'commercial_rule'::character varying, 'tax'::character varying, 'rate_zone'::character varying, 'rate_card'::character varying, 'catalog_group'::character varying, 'record_group'::character varying, 'custom'::character varying, 'variant'::character varying])::text[]))),
    CONSTRAINT workspace_catalog_records_name_check CHECK ((length(btrim((name)::text)) > 0)),
    CONSTRAINT workspace_catalog_records_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.workspace_catalog_records FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_configuration_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_configuration_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    resource_type character varying(64) NOT NULL,
    resource_id character varying(160) NOT NULL,
    revision_number integer NOT NULL,
    source_version integer NOT NULL,
    action character varying(32) NOT NULL,
    snapshot jsonb NOT NULL,
    source_revision_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_configuration_revisions_action_check CHECK (((action)::text = ANY ((ARRAY['baseline'::character varying, 'created'::character varying, 'saved'::character varying, 'archived'::character varying, 'restored_default'::character varying, 'rolled_back'::character varying])::text[]))),
    CONSTRAINT workspace_configuration_revisions_numbers_check CHECK (((revision_number > 0) AND (source_version >= 0))),
    CONSTRAINT workspace_configuration_revisions_resource_type_check CHECK (((resource_type)::text = ANY ((ARRAY['workspace_terminology'::character varying, 'project_workflow_template'::character varying, 'crm_taxonomy'::character varying, 'crm_custom_field'::character varying, 'crm_qualification_form'::character varying, 'quotation_template'::character varying, 'payment_template'::character varying, 'workspace_team'::character varying])::text[]))),
    CONSTRAINT workspace_configuration_revisions_snapshot_check CHECK ((jsonb_typeof(snapshot) = 'object'::text))
);

ALTER TABLE ONLY public.workspace_configuration_revisions FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_data_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_data_policies (
    workspace_id uuid NOT NULL,
    storage_quota_bytes bigint NOT NULL,
    retention_days integer NOT NULL,
    legal_hold boolean DEFAULT false NOT NULL,
    scan_requirement character varying(20) DEFAULT 'required'::character varying NOT NULL,
    scanner_status character varying(20) DEFAULT 'baseline'::character varying NOT NULL,
    export_before_erasure boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_data_policies_quota_check CHECK (((storage_quota_bytes >= 1048576) AND (storage_quota_bytes <= '10995116277760'::bigint))),
    CONSTRAINT workspace_data_policies_retention_check CHECK (((retention_days >= 1) AND (retention_days <= 3650))),
    CONSTRAINT workspace_data_policies_scan_check CHECK ((((scan_requirement)::text = ANY ((ARRAY['required'::character varying, 'optional'::character varying])::text[])) AND ((scanner_status)::text = ANY ((ARRAY['not_configured'::character varying, 'baseline'::character varying, 'healthy'::character varying, 'degraded'::character varying])::text[])))),
    CONSTRAINT workspace_data_policies_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.workspace_data_policies FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_domains (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    hostname character varying(253) NOT NULL,
    request_key character varying(160) NOT NULL,
    challenge_value character varying(96) NOT NULL,
    challenge_expires_at timestamp with time zone NOT NULL,
    dns_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    dns_verified_at timestamp with time zone,
    certificate_status character varying(24) DEFAULT 'not_requested'::character varying NOT NULL,
    certificate_expires_at timestamp with time zone,
    routing_status character varying(20) DEFAULT 'not_requested'::character varying NOT NULL,
    routing_activated_at timestamp with time zone,
    rollback_status character varying(20) DEFAULT 'none'::character varying NOT NULL,
    last_error_code character varying(80),
    version integer DEFAULT 1 NOT NULL,
    requested_by uuid NOT NULL,
    removed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_domains_activation_check CHECK ((((routing_status)::text <> 'active'::text) OR (((dns_status)::text = 'verified'::text) AND ((certificate_status)::text = 'issued'::text) AND (routing_activated_at IS NOT NULL) AND (removed_at IS NULL)))),
    CONSTRAINT workspace_domains_certificate_check CHECK ((((certificate_status)::text <> ALL ((ARRAY['pending'::character varying, 'issued'::character varying])::text[])) OR (dns_verified_at IS NOT NULL))),
    CONSTRAINT workspace_domains_certificate_status_check CHECK (((certificate_status)::text = ANY ((ARRAY['not_requested'::character varying, 'manual_setup_required'::character varying, 'pending'::character varying, 'issued'::character varying, 'expired'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT workspace_domains_dns_status_check CHECK (((dns_status)::text = ANY ((ARRAY['pending'::character varying, 'verified'::character varying, 'expired'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT workspace_domains_rollback_status_check CHECK (((rollback_status)::text = ANY ((ARRAY['none'::character varying, 'pending'::character varying, 'completed'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT workspace_domains_routing_status_check CHECK (((routing_status)::text = ANY ((ARRAY['not_requested'::character varying, 'pending'::character varying, 'active'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT workspace_domains_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.workspace_domains FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_invitation_delivery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_invitation_delivery (
    invitation_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    status character varying(20) DEFAULT 'not_requested'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    provider character varying(40),
    provider_message_id character varying(255),
    last_attempted_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_invitation_delivery_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT workspace_invitation_delivery_status_check CHECK (((status)::text = ANY ((ARRAY['not_requested'::character varying, 'pending'::character varying, 'sent'::character varying, 'not_configured'::character varying, 'failed'::character varying])::text[])))
);

ALTER TABLE ONLY public.workspace_invitation_delivery FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_invitation_delivery_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_invitation_delivery_commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    invitation_id uuid NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    provider_message_id character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_invitation_delivery_commands_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'not_configured'::character varying, 'failed'::character varying, 'superseded'::character varying])::text[])))
);

ALTER TABLE ONLY public.workspace_invitation_delivery_commands FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    email public.citext NOT NULL,
    token_hash character varying(128) NOT NULL,
    status public.invitation_status DEFAULT 'pending'::public.invitation_status NOT NULL,
    invited_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workspace_invitations FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status public.membership_status DEFAULT 'active'::public.membership_status NOT NULL,
    joined_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    home_layout jsonb,
    home_layout_version integer DEFAULT 0 NOT NULL,
    CONSTRAINT workspace_memberships_home_layout_array CHECK (((home_layout IS NULL) OR (jsonb_typeof(home_layout) = 'array'::text))),
    CONSTRAINT workspace_memberships_home_layout_version_nonnegative CHECK ((home_layout_version >= 0))
);

ALTER TABLE ONLY public.workspace_memberships FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_onboarding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_onboarding (
    workspace_id uuid NOT NULL,
    status public.onboarding_status DEFAULT 'not_started'::public.onboarding_status NOT NULL,
    current_step character varying(64) DEFAULT 'workspace_profile'::character varying NOT NULL,
    completed_steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_onboarding_completed_steps_array_check CHECK ((jsonb_typeof(completed_steps) = 'array'::text)),
    CONSTRAINT workspace_onboarding_step_check CHECK (((current_step)::text = ANY ((ARRAY['workspace_profile'::character varying, 'organization'::character varying, 'team'::character varying, 'integrations'::character varying, 'complete'::character varying])::text[])))
);

ALTER TABLE ONLY public.workspace_onboarding FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_setup_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_setup_versions (
    workspace_id uuid NOT NULL,
    region_code character varying(40) NOT NULL,
    region_version integer NOT NULL,
    firm_kit_code character varying(40) NOT NULL,
    firm_kit_version integer NOT NULL,
    plan_code character varying(40) NOT NULL,
    plan_version integer NOT NULL,
    configuration_snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_setup_versions_snapshot_check CHECK ((jsonb_typeof(configuration_snapshot) = 'object'::text))
);

ALTER TABLE ONLY public.workspace_setup_versions FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_stored_objects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_stored_objects (
    workspace_id uuid NOT NULL,
    object_key text NOT NULL,
    byte_size bigint NOT NULL,
    content_type character varying(160) NOT NULL,
    sha256 character(64),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    scanner_status character varying(24) DEFAULT 'pending'::character varying NOT NULL,
    reservation_expires_at timestamp with time zone,
    retention_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    removed_at timestamp with time zone,
    CONSTRAINT workspace_stored_objects_hash_check CHECK (((sha256 IS NULL) OR (sha256 ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT workspace_stored_objects_scan_check CHECK (((scanner_status)::text = ANY ((ARRAY['pending'::character varying, 'baseline_passed'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT workspace_stored_objects_size_check CHECK ((byte_size >= 0)),
    CONSTRAINT workspace_stored_objects_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'failed'::character varying, 'removed'::character varying])::text[])))
);

ALTER TABLE ONLY public.workspace_stored_objects FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_subscriptions (
    workspace_id uuid NOT NULL,
    plan_code character varying(30) DEFAULT 'starter'::character varying NOT NULL,
    status character varying(30) DEFAULT 'trial'::character varying NOT NULL,
    billing_cycle character varying(20) DEFAULT 'monthly'::character varying NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    currency character(3) NOT NULL,
    seat_limit integer DEFAULT 5 NOT NULL,
    project_limit integer DEFAULT 25 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    renews_at timestamp with time zone,
    note text,
    version integer DEFAULT 1 NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_subscriptions_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT workspace_subscriptions_cycle_check CHECK (((billing_cycle)::text = ANY ((ARRAY['monthly'::character varying, 'yearly'::character varying, 'custom'::character varying])::text[]))),
    CONSTRAINT workspace_subscriptions_limits_check CHECK (((seat_limit > 0) AND (project_limit > 0))),
    CONSTRAINT workspace_subscriptions_plan_check CHECK (((plan_code)::text = ANY ((ARRAY['starter'::character varying, 'pro'::character varying, 'enterprise'::character varying])::text[]))),
    CONSTRAINT workspace_subscriptions_status_check CHECK (((status)::text = ANY ((ARRAY['trial'::character varying, 'active'::character varying, 'past_due'::character varying, 'cancelled'::character varying])::text[])))
);

ALTER TABLE ONLY public.workspace_subscriptions FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_supplier_offer_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_supplier_offer_commands (
    workspace_id uuid NOT NULL,
    request_id uuid NOT NULL,
    offer_id uuid NOT NULL,
    action character varying(20) NOT NULL,
    request_hash character(64) NOT NULL,
    response jsonb NOT NULL,
    actor_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_supplier_offer_commands_action_check CHECK (((action)::text = ANY ((ARRAY['activate'::character varying, 'archive'::character varying, 'restore'::character varying])::text[]))),
    CONSTRAINT workspace_supplier_offer_commands_hash_check CHECK ((request_hash ~ '^[0-9a-f]{64}$'::text))
);

ALTER TABLE ONLY public.workspace_supplier_offer_commands FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_supplier_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_supplier_offers (
    workspace_id uuid NOT NULL,
    id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    vendor_site_id uuid,
    catalog_record_id uuid NOT NULL,
    unit_record_id uuid,
    supplier_sku character varying(120),
    amount numeric(20,6),
    currency character(3),
    quantity_from numeric(20,6),
    minimum_order_quantity numeric(20,6),
    order_multiple numeric(20,6),
    lead_time_days integer,
    effective_from date,
    effective_to date,
    source_type character varying(24),
    source_reference character varying(240),
    tax_treatment character varying(20) DEFAULT 'unconfirmed'::character varying NOT NULL,
    inclusions character varying(24)[] DEFAULT '{}'::character varying[] NOT NULL,
    terms text DEFAULT ''::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    archived_reason character varying(500),
    archived_at timestamp with time zone,
    archived_by uuid,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    legal_entity_id uuid,
    replaces_offer_id uuid,
    CONSTRAINT workspace_supplier_offers_amount_check CHECK (((amount IS NULL) OR (amount >= (0)::numeric))),
    CONSTRAINT workspace_supplier_offers_archive_check CHECK (((((status)::text = 'archived'::text) AND (archived_reason IS NOT NULL) AND (length(btrim((archived_reason)::text)) > 0) AND (archived_at IS NOT NULL) AND (archived_by IS NOT NULL)) OR (((status)::text <> 'archived'::text) AND (archived_reason IS NULL) AND (archived_at IS NULL) AND (archived_by IS NULL)))),
    CONSTRAINT workspace_supplier_offers_currency_check CHECK (((currency IS NULL) OR (currency ~ '^[A-Z]{3}$'::text))),
    CONSTRAINT workspace_supplier_offers_dates_check CHECK (((effective_from IS NULL) OR (effective_to IS NULL) OR (effective_to >= effective_from))),
    CONSTRAINT workspace_supplier_offers_inclusions_check CHECK ((inclusions <@ ARRAY['delivery'::character varying, 'unloading'::character varying, 'installation'::character varying, 'packaging'::character varying, 'warranty'::character varying, 'other'::character varying])),
    CONSTRAINT workspace_supplier_offers_lead_time_check CHECK (((lead_time_days IS NULL) OR ((lead_time_days >= 0) AND (lead_time_days <= 3650)))),
    CONSTRAINT workspace_supplier_offers_minimum_order_check CHECK (((minimum_order_quantity IS NULL) OR (minimum_order_quantity > (0)::numeric))),
    CONSTRAINT workspace_supplier_offers_multiple_check CHECK (((order_multiple IS NULL) OR (order_multiple > (0)::numeric))),
    CONSTRAINT workspace_supplier_offers_quantity_from_check CHECK (((quantity_from IS NULL) OR (quantity_from > (0)::numeric))),
    CONSTRAINT workspace_supplier_offers_replacement_check CHECK (((replaces_offer_id IS NULL) OR (replaces_offer_id <> id))),
    CONSTRAINT workspace_supplier_offers_source_check CHECK (((source_type IS NULL) OR ((source_type)::text = ANY ((ARRAY['vendor_quote'::character varying, 'price_list'::character varying, 'contract'::character varying, 'verbal_confirmation'::character varying, 'estimate'::character varying, 'included'::character varying])::text[])))),
    CONSTRAINT workspace_supplier_offers_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT workspace_supplier_offers_tax_check CHECK (((tax_treatment)::text = ANY ((ARRAY['unconfirmed'::character varying, 'exclusive'::character varying, 'inclusive'::character varying, 'not_applicable'::character varying])::text[]))),
    CONSTRAINT workspace_supplier_offers_version_check CHECK ((version > 0)),
    CONSTRAINT workspace_supplier_offers_zero_check CHECK (((amount IS NULL) OR ((amount = (0)::numeric) AND (NOT ((source_type)::text IS DISTINCT FROM 'included'::text))) OR ((amount > (0)::numeric) AND ((source_type)::text IS DISTINCT FROM 'included'::text))))
);

ALTER TABLE ONLY public.workspace_supplier_offers FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_terminology; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_terminology (
    workspace_id uuid NOT NULL,
    key character varying(64) NOT NULL,
    visible_name character varying(60) NOT NULL,
    visible_name_plural character varying(60) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_terminology_key_check CHECK (((key)::text ~ '^[a-z][a-z0-9_]{0,63}$'::text)),
    CONSTRAINT workspace_terminology_version_check CHECK ((version > 0)),
    CONSTRAINT workspace_terminology_visible_name_check CHECK ((((length(btrim((visible_name)::text)) >= 1) AND (length(btrim((visible_name)::text)) <= 60)) AND ((length(btrim((visible_name_plural)::text)) >= 1) AND (length(btrim((visible_name_plural)::text)) <= 60))))
);

ALTER TABLE ONLY public.workspace_terminology FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_vendor_sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_vendor_sites (
    workspace_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    id uuid NOT NULL,
    name character varying(180) NOT NULL,
    site_type character varying(20) NOT NULL,
    contact_name character varying(180),
    email character varying(320),
    phone character varying(80),
    address_line1 character varying(240),
    address_line2 character varying(240),
    locality character varying(160),
    region character varying(160),
    postal_code character varying(40),
    country_code character(2),
    is_primary boolean DEFAULT false NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    archived_reason character varying(500),
    archived_at timestamp with time zone,
    archived_by uuid,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_vendor_sites_archive_check CHECK (((((status)::text = 'archived'::text) AND (NOT is_primary) AND (archived_reason IS NOT NULL) AND (archived_at IS NOT NULL) AND (archived_by IS NOT NULL)) OR (((status)::text = 'active'::text) AND (archived_reason IS NULL) AND (archived_at IS NULL) AND (archived_by IS NULL)))),
    CONSTRAINT workspace_vendor_sites_country_check CHECK (((country_code IS NULL) OR (country_code ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT workspace_vendor_sites_name_check CHECK (((length(btrim((name)::text)) >= 1) AND (length(btrim((name)::text)) <= 180))),
    CONSTRAINT workspace_vendor_sites_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT workspace_vendor_sites_type_check CHECK (((site_type)::text = ANY ((ARRAY['branch'::character varying, 'store'::character varying, 'office'::character varying, 'warehouse'::character varying, 'factory'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT workspace_vendor_sites_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.workspace_vendor_sites FORCE ROW LEVEL SECURITY;


--
-- Name: workspace_vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_vendors (
    workspace_id uuid NOT NULL,
    id uuid NOT NULL,
    code character varying(80) NOT NULL,
    display_name character varying(240) NOT NULL,
    legal_name character varying(240),
    capabilities character varying(24)[] DEFAULT '{}'::character varying[] NOT NULL,
    registration_number character varying(120),
    tax_registration_number character varying(120),
    default_currency character(3),
    website character varying(500),
    notes text DEFAULT ''::text NOT NULL,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    archived_reason character varying(500),
    archived_at timestamp with time zone,
    archived_by uuid,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_vendors_active_capability_check CHECK ((((status)::text <> 'active'::text) OR (cardinality(capabilities) > 0))),
    CONSTRAINT workspace_vendors_archive_check CHECK (((((status)::text = 'archived'::text) AND (archived_reason IS NOT NULL) AND (archived_at IS NOT NULL) AND (archived_by IS NOT NULL)) OR (((status)::text <> 'archived'::text) AND (archived_reason IS NULL) AND (archived_at IS NULL) AND (archived_by IS NULL)))),
    CONSTRAINT workspace_vendors_capabilities_check CHECK ((capabilities <@ ARRAY['materials'::character varying, 'services'::character varying, 'subcontracting'::character varying, 'manufacturing'::character varying, 'logistics'::character varying, 'other'::character varying])),
    CONSTRAINT workspace_vendors_code_check CHECK (((code)::text ~ '^[A-Z0-9][A-Z0-9_-]{0,79}$'::text)),
    CONSTRAINT workspace_vendors_currency_check CHECK (((default_currency IS NULL) OR (default_currency ~ '^[A-Z]{3}$'::text))),
    CONSTRAINT workspace_vendors_name_check CHECK (((length(btrim((display_name)::text)) >= 1) AND (length(btrim((display_name)::text)) <= 240))),
    CONSTRAINT workspace_vendors_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'archived'::character varying])::text[]))),
    CONSTRAINT workspace_vendors_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.workspace_vendors FORCE ROW LEVEL SECURITY;


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(160) NOT NULL,
    slug character varying(80) NOT NULL,
    status public.workspace_status DEFAULT 'active'::public.workspace_status NOT NULL,
    default_currency character(3) NOT NULL,
    default_locale character varying(35) DEFAULT 'en'::character varying NOT NULL,
    default_timezone character varying(64) DEFAULT 'UTC'::character varying NOT NULL,
    unit_system public.unit_system DEFAULT 'metric'::public.unit_system NOT NULL,
    week_starts_on smallint DEFAULT 1 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by uuid NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.workspaces FORCE ROW LEVEL SECURITY;


--
-- Name: account_billing_document_events account_billing_document_events_idempotency_uidx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_billing_document_events
    ADD CONSTRAINT account_billing_document_events_idempotency_uidx UNIQUE (account_id, idempotency_key);


--
-- Name: account_billing_document_events account_billing_document_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_billing_document_events
    ADD CONSTRAINT account_billing_document_events_pkey PRIMARY KEY (id);


--
-- Name: account_billing_documents account_billing_documents_external_uidx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_billing_documents
    ADD CONSTRAINT account_billing_documents_external_uidx UNIQUE (account_id, document_type, provider, external_reference);


--
-- Name: account_billing_documents account_billing_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_billing_documents
    ADD CONSTRAINT account_billing_documents_pkey PRIMARY KEY (id);


--
-- Name: account_collection_state_versions account_collection_state_versions_account_version_uidx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_collection_state_versions
    ADD CONSTRAINT account_collection_state_versions_account_version_uidx UNIQUE (account_id, version);


--
-- Name: account_collection_state_versions account_collection_state_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_collection_state_versions
    ADD CONSTRAINT account_collection_state_versions_pkey PRIMARY KEY (id);


--
-- Name: account_contract_versions account_contract_versions_account_version_uidx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_contract_versions
    ADD CONSTRAINT account_contract_versions_account_version_uidx UNIQUE (account_id, version);


--
-- Name: account_contract_versions account_contract_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_contract_versions
    ADD CONSTRAINT account_contract_versions_pkey PRIMARY KEY (id);


--
-- Name: account_entitlement_versions account_entitlement_versions_account_version_uidx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_entitlement_versions
    ADD CONSTRAINT account_entitlement_versions_account_version_uidx UNIQUE (account_id, version);


--
-- Name: account_entitlement_versions account_entitlement_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_entitlement_versions
    ADD CONSTRAINT account_entitlement_versions_pkey PRIMARY KEY (id);


--
-- Name: account_usage_snapshots account_usage_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_usage_snapshots
    ADD CONSTRAINT account_usage_snapshots_pkey PRIMARY KEY (id);


--
-- Name: ai_suggestion_decisions ai_suggestion_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_suggestion_decisions
    ADD CONSTRAINT ai_suggestion_decisions_pkey PRIMARY KEY (id);


--
-- Name: ai_suggestion_decisions ai_suggestion_decisions_workspace_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_suggestion_decisions
    ADD CONSTRAINT ai_suggestion_decisions_workspace_id_request_id_key UNIQUE (workspace_id, request_id);


--
-- Name: ai_suggestions ai_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_suggestions
    ADD CONSTRAINT ai_suggestions_pkey PRIMARY KEY (id);


--
-- Name: ai_suggestions ai_suggestions_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_suggestions
    ADD CONSTRAINT ai_suggestions_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: ai_suggestions ai_suggestions_workspace_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_suggestions
    ADD CONSTRAINT ai_suggestions_workspace_id_request_id_key UNIQUE (workspace_id, request_id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: auth_mfa_challenges auth_mfa_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_challenges
    ADD CONSTRAINT auth_mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: auth_refresh_sessions auth_refresh_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_refresh_sessions
    ADD CONSTRAINT auth_refresh_sessions_pkey PRIMARY KEY (id);


--
-- Name: automation_approvals automation_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_approvals
    ADD CONSTRAINT automation_approvals_pkey PRIMARY KEY (id);


--
-- Name: automation_definitions automation_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_definitions
    ADD CONSTRAINT automation_definitions_pkey PRIMARY KEY (id);


--
-- Name: automation_runs automation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_pkey PRIMARY KEY (id);


--
-- Name: automation_step_runs automation_step_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_step_runs
    ADD CONSTRAINT automation_step_runs_pkey PRIMARY KEY (id);


--
-- Name: automation_versions automation_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_versions
    ADD CONSTRAINT automation_versions_pkey PRIMARY KEY (id);


--
-- Name: automation_waits automation_waits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_waits
    ADD CONSTRAINT automation_waits_pkey PRIMARY KEY (id);


--
-- Name: business_units business_units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_units
    ADD CONSTRAINT business_units_pkey PRIMARY KEY (id);


--
-- Name: client_portal_challenges client_portal_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_challenges
    ADD CONSTRAINT client_portal_challenges_pkey PRIMARY KEY (id);


--
-- Name: client_portal_grants client_portal_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_grants
    ADD CONSTRAINT client_portal_grants_pkey PRIMARY KEY (id);


--
-- Name: client_portal_grants client_portal_grants_workspace_case_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_grants
    ADD CONSTRAINT client_portal_grants_workspace_case_id_key UNIQUE (workspace_id, case_id, id);


--
-- Name: client_portal_grants client_portal_grants_workspace_id_case_id_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_grants
    ADD CONSTRAINT client_portal_grants_workspace_id_case_id_phone_key UNIQUE (workspace_id, case_id, phone);


--
-- Name: client_portal_sessions client_portal_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_sessions
    ADD CONSTRAINT client_portal_sessions_pkey PRIMARY KEY (id);


--
-- Name: client_portal_sessions client_portal_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_sessions
    ADD CONSTRAINT client_portal_sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: client_portal_settings client_portal_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_settings
    ADD CONSTRAINT client_portal_settings_pkey PRIMARY KEY (workspace_id);


--
-- Name: client_portal_settings client_portal_settings_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_settings
    ADD CONSTRAINT client_portal_settings_slug_key UNIQUE (slug);


--
-- Name: commercial_cases commercial_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_cases
    ADD CONSTRAINT commercial_cases_pkey PRIMARY KEY (case_id);


--
-- Name: commercial_payment_templates commercial_payment_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_payment_templates
    ADD CONSTRAINT commercial_payment_templates_pkey PRIMARY KEY (id);


--
-- Name: commercial_payment_templates commercial_payment_templates_workspace_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_payment_templates
    ADD CONSTRAINT commercial_payment_templates_workspace_id_name_key UNIQUE (workspace_id, name);


--
-- Name: commercial_quotation_templates commercial_quotation_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_quotation_templates
    ADD CONSTRAINT commercial_quotation_templates_pkey PRIMARY KEY (id);


--
-- Name: commercial_quotation_templates commercial_quotation_templates_workspace_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_quotation_templates
    ADD CONSTRAINT commercial_quotation_templates_workspace_id_name_key UNIQUE (workspace_id, name);


--
-- Name: commercial_reconciliation_jobs commercial_reconciliation_job_workspace_id_case_id_payment__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_reconciliation_jobs
    ADD CONSTRAINT commercial_reconciliation_job_workspace_id_case_id_payment__key UNIQUE (workspace_id, case_id, payment_id);


--
-- Name: commercial_reconciliation_jobs commercial_reconciliation_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_reconciliation_jobs
    ADD CONSTRAINT commercial_reconciliation_jobs_pkey PRIMARY KEY (id);


--
-- Name: crm_activities crm_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_pkey PRIMARY KEY (id);


--
-- Name: crm_addresses crm_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_addresses
    ADD CONSTRAINT crm_addresses_pkey PRIMARY KEY (id);


--
-- Name: crm_appointments crm_appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_appointments
    ADD CONSTRAINT crm_appointments_pkey PRIMARY KEY (id);


--
-- Name: crm_assignment_history crm_assignment_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_history
    ADD CONSTRAINT crm_assignment_history_pkey PRIMARY KEY (id);


--
-- Name: crm_assignment_policies crm_assignment_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_policies
    ADD CONSTRAINT crm_assignment_policies_pkey PRIMARY KEY (id);


--
-- Name: crm_assignment_rules crm_assignment_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_rules
    ADD CONSTRAINT crm_assignment_rules_pkey PRIMARY KEY (id);


--
-- Name: crm_attribution_touches crm_attribution_touches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_attribution_touches
    ADD CONSTRAINT crm_attribution_touches_pkey PRIMARY KEY (id);


--
-- Name: crm_consents crm_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consents
    ADD CONSTRAINT crm_consents_pkey PRIMARY KEY (id);


--
-- Name: crm_contact_points crm_contact_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contact_points
    ADD CONSTRAINT crm_contact_points_pkey PRIMARY KEY (id);


--
-- Name: crm_conversation_participants crm_conversation_participants_conversation_id_participant_type_; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_conversation_participants
    ADD CONSTRAINT crm_conversation_participants_conversation_id_participant_type_ PRIMARY KEY (conversation_id, participant_type, participant_id);


--
-- Name: crm_conversations crm_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_conversations
    ADD CONSTRAINT crm_conversations_pkey PRIMARY KEY (id);


--
-- Name: crm_custom_field_definitions crm_custom_field_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_custom_field_definitions
    ADD CONSTRAINT crm_custom_field_definitions_pkey PRIMARY KEY (id);


--
-- Name: crm_custom_field_values crm_custom_field_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_custom_field_values
    ADD CONSTRAINT crm_custom_field_values_pkey PRIMARY KEY (id);


--
-- Name: crm_enquiries crm_enquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_enquiries
    ADD CONSTRAINT crm_enquiries_pkey PRIMARY KEY (id);


--
-- Name: crm_enquiry_counters crm_enquiry_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_enquiry_counters
    ADD CONSTRAINT crm_enquiry_counters_pkey PRIMARY KEY (workspace_id);


--
-- Name: crm_forecast_snapshots crm_forecast_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_forecast_snapshots
    ADD CONSTRAINT crm_forecast_snapshots_pkey PRIMARY KEY (id);


--
-- Name: crm_identity_candidates crm_identity_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_identity_candidates
    ADD CONSTRAINT crm_identity_candidates_pkey PRIMARY KEY (id);


--
-- Name: crm_intake_events crm_intake_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_intake_events
    ADD CONSTRAINT crm_intake_events_pkey PRIMARY KEY (id);


--
-- Name: crm_lead_forms crm_lead_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_lead_forms
    ADD CONSTRAINT crm_lead_forms_pkey PRIMARY KEY (id);


--
-- Name: crm_lead_forms crm_lead_forms_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_lead_forms
    ADD CONSTRAINT crm_lead_forms_token_key UNIQUE (token);


--
-- Name: crm_lead_qualification_values crm_lead_qualification_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_lead_qualification_values
    ADD CONSTRAINT crm_lead_qualification_values_pkey PRIMARY KEY (id);


--
-- Name: crm_leads crm_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_leads
    ADD CONSTRAINT crm_leads_pkey PRIMARY KEY (id);


--
-- Name: crm_merge_operations crm_merge_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_merge_operations
    ADD CONSTRAINT crm_merge_operations_pkey PRIMARY KEY (id);


--
-- Name: crm_message_attachments crm_message_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_message_attachments
    ADD CONSTRAINT crm_message_attachments_pkey PRIMARY KEY (id);


--
-- Name: crm_messages crm_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_messages
    ADD CONSTRAINT crm_messages_pkey PRIMARY KEY (id);


--
-- Name: crm_opportunities crm_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_pkey PRIMARY KEY (id);


--
-- Name: crm_opportunity_counters crm_opportunity_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunity_counters
    ADD CONSTRAINT crm_opportunity_counters_pkey PRIMARY KEY (workspace_id);


--
-- Name: crm_opportunity_stakeholders crm_opportunity_stakeholders_opportunity_id_party_id_role_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunity_stakeholders
    ADD CONSTRAINT crm_opportunity_stakeholders_opportunity_id_party_id_role_pk PRIMARY KEY (opportunity_id, party_id, role);


--
-- Name: crm_opportunity_team crm_opportunity_team_opportunity_id_membership_id_role_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunity_team
    ADD CONSTRAINT crm_opportunity_team_opportunity_id_membership_id_role_pk PRIMARY KEY (opportunity_id, membership_id, role);


--
-- Name: crm_organization_profiles crm_organization_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_organization_profiles
    ADD CONSTRAINT crm_organization_profiles_pkey PRIMARY KEY (party_id);


--
-- Name: crm_parties crm_parties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_parties
    ADD CONSTRAINT crm_parties_pkey PRIMARY KEY (id);


--
-- Name: crm_person_profiles crm_person_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_person_profiles
    ADD CONSTRAINT crm_person_profiles_pkey PRIMARY KEY (party_id);


--
-- Name: crm_pipeline_stages crm_pipeline_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pipeline_stages
    ADD CONSTRAINT crm_pipeline_stages_pkey PRIMARY KEY (id);


--
-- Name: crm_pipelines crm_pipelines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pipelines
    ADD CONSTRAINT crm_pipelines_pkey PRIMARY KEY (id);


--
-- Name: crm_project_links crm_project_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_project_links
    ADD CONSTRAINT crm_project_links_pkey PRIMARY KEY (id);


--
-- Name: crm_qualification_forms crm_qualification_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_qualification_forms
    ADD CONSTRAINT crm_qualification_forms_pkey PRIMARY KEY (id);


--
-- Name: crm_qualification_questions crm_qualification_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_qualification_questions
    ADD CONSTRAINT crm_qualification_questions_pkey PRIMARY KEY (id);


--
-- Name: crm_queue_members crm_queue_members_queue_id_membership_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_queue_members
    ADD CONSTRAINT crm_queue_members_queue_id_membership_id_pk PRIMARY KEY (queue_id, membership_id);


--
-- Name: crm_queues crm_queues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_queues
    ADD CONSTRAINT crm_queues_pkey PRIMARY KEY (id);


--
-- Name: crm_relationships crm_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_relationships
    ADD CONSTRAINT crm_relationships_pkey PRIMARY KEY (id);


--
-- Name: crm_saved_views crm_saved_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_saved_views
    ADD CONSTRAINT crm_saved_views_pkey PRIMARY KEY (id);


--
-- Name: crm_sequence_enrollments crm_sequence_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sequence_enrollments
    ADD CONSTRAINT crm_sequence_enrollments_pkey PRIMARY KEY (id);


--
-- Name: crm_sequence_steps crm_sequence_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sequence_steps
    ADD CONSTRAINT crm_sequence_steps_pkey PRIMARY KEY (id);


--
-- Name: crm_sequences crm_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sequences
    ADD CONSTRAINT crm_sequences_pkey PRIMARY KEY (id);


--
-- Name: crm_sla_history crm_sla_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_history
    ADD CONSTRAINT crm_sla_history_pkey PRIMARY KEY (id);


--
-- Name: crm_sla_instances crm_sla_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_instances
    ADD CONSTRAINT crm_sla_instances_pkey PRIMARY KEY (id);


--
-- Name: crm_sla_instances crm_sla_instances_workspace_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_instances
    ADD CONSTRAINT crm_sla_instances_workspace_id_id UNIQUE (workspace_id, id);


--
-- Name: crm_sla_policies crm_sla_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_policies
    ADD CONSTRAINT crm_sla_policies_pkey PRIMARY KEY (id);


--
-- Name: crm_stage_history crm_stage_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_stage_history
    ADD CONSTRAINT crm_stage_history_pkey PRIMARY KEY (id);


--
-- Name: crm_taxonomies crm_taxonomies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_taxonomies
    ADD CONSTRAINT crm_taxonomies_pkey PRIMARY KEY (id);


--
-- Name: crm_taxonomy_options crm_taxonomy_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_taxonomy_options
    ADD CONSTRAINT crm_taxonomy_options_pkey PRIMARY KEY (id);


--
-- Name: currencies currencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currencies
    ADD CONSTRAINT currencies_pkey PRIMARY KEY (code);


--
-- Name: customer_account_contracts customer_account_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_account_contracts
    ADD CONSTRAINT customer_account_contracts_pkey PRIMARY KEY (account_id);


--
-- Name: customer_account_memberships customer_account_memberships_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_account_memberships
    ADD CONSTRAINT customer_account_memberships_pk PRIMARY KEY (account_id, user_id);


--
-- Name: customer_account_organizations customer_account_organizations_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_account_organizations
    ADD CONSTRAINT customer_account_organizations_pk PRIMARY KEY (account_id, workspace_id);


--
-- Name: customer_accounts customer_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_accounts
    ADD CONSTRAINT customer_accounts_pkey PRIMARY KEY (id);


--
-- Name: delivery_projects delivery_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_projects
    ADD CONSTRAINT delivery_projects_pkey PRIMARY KEY (id);


--
-- Name: delivery_projects delivery_projects_workspace_id_case_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_projects
    ADD CONSTRAINT delivery_projects_workspace_id_case_id_key UNIQUE (workspace_id, case_id);


--
-- Name: delivery_projects delivery_projects_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_projects
    ADD CONSTRAINT delivery_projects_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: device_endpoints device_endpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_endpoints
    ADD CONSTRAINT device_endpoints_pkey PRIMARY KEY (id);


--
-- Name: document_sequences document_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_sequences
    ADD CONSTRAINT document_sequences_pkey PRIMARY KEY (id);


--
-- Name: exchange_rates exchange_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT exchange_rates_pkey PRIMARY KEY (id);


--
-- Name: hrms_attendance_events hrms_attendance_events_capture_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_attendance_events
    ADD CONSTRAINT hrms_attendance_events_capture_id_key UNIQUE (capture_id);


--
-- Name: hrms_attendance_events hrms_attendance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_attendance_events
    ADD CONSTRAINT hrms_attendance_events_pkey PRIMARY KEY (id);


--
-- Name: hrms_attendance_events hrms_attendance_events_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_attendance_events
    ADD CONSTRAINT hrms_attendance_events_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: hrms_attendance_events hrms_attendance_events_workspace_id_membership_id_action_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_attendance_events
    ADD CONSTRAINT hrms_attendance_events_workspace_id_membership_id_action_id_key UNIQUE (workspace_id, membership_id, action_id);


--
-- Name: hrms_calendars hrms_calendars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_calendars
    ADD CONSTRAINT hrms_calendars_pkey PRIMARY KEY (id);


--
-- Name: hrms_calendars hrms_calendars_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_calendars
    ADD CONSTRAINT hrms_calendars_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: hrms_captures hrms_captures_object_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_captures
    ADD CONSTRAINT hrms_captures_object_key_key UNIQUE (object_key);


--
-- Name: hrms_captures hrms_captures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_captures
    ADD CONSTRAINT hrms_captures_pkey PRIMARY KEY (id);


--
-- Name: hrms_captures hrms_captures_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_captures
    ADD CONSTRAINT hrms_captures_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: hrms_captures hrms_captures_workspace_id_membership_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_captures
    ADD CONSTRAINT hrms_captures_workspace_id_membership_id_id_key UNIQUE (workspace_id, membership_id, id);


--
-- Name: hrms_employees hrms_employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_employees
    ADD CONSTRAINT hrms_employees_pkey PRIMARY KEY (workspace_id, membership_id);


--
-- Name: hrms_leave_allowances hrms_leave_allowances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_leave_allowances
    ADD CONSTRAINT hrms_leave_allowances_pkey PRIMARY KEY (workspace_id, membership_id, leave_type_id, year);


--
-- Name: hrms_leave_requests hrms_leave_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_leave_requests
    ADD CONSTRAINT hrms_leave_requests_pkey PRIMARY KEY (id);


--
-- Name: hrms_leave_requests hrms_leave_requests_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_leave_requests
    ADD CONSTRAINT hrms_leave_requests_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: hrms_leave_requests hrms_leave_requests_workspace_id_membership_id_action_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_leave_requests
    ADD CONSTRAINT hrms_leave_requests_workspace_id_membership_id_action_id_key UNIQUE (workspace_id, membership_id, action_id);


--
-- Name: hrms_leave_types hrms_leave_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_leave_types
    ADD CONSTRAINT hrms_leave_types_pkey PRIMARY KEY (id);


--
-- Name: hrms_leave_types hrms_leave_types_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_leave_types
    ADD CONSTRAINT hrms_leave_types_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: hrms_leave_types hrms_leave_types_workspace_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_leave_types
    ADD CONSTRAINT hrms_leave_types_workspace_id_name_key UNIQUE (workspace_id, name);


--
-- Name: hrms_reviews hrms_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_reviews
    ADD CONSTRAINT hrms_reviews_pkey PRIMARY KEY (id);


--
-- Name: hrms_reviews hrms_reviews_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_reviews
    ADD CONSTRAINT hrms_reviews_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: hrms_reviews hrms_reviews_workspace_id_membership_id_action_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_reviews
    ADD CONSTRAINT hrms_reviews_workspace_id_membership_id_action_id_key UNIQUE (workspace_id, membership_id, action_id);


--
-- Name: hrms_segments hrms_segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_segments
    ADD CONSTRAINT hrms_segments_pkey PRIMARY KEY (id);


--
-- Name: hrms_segments hrms_segments_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_segments
    ADD CONSTRAINT hrms_segments_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: hrms_sessions hrms_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_sessions
    ADD CONSTRAINT hrms_sessions_pkey PRIMARY KEY (id);


--
-- Name: hrms_sessions hrms_sessions_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_sessions
    ADD CONSTRAINT hrms_sessions_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: hrms_sessions hrms_sessions_workspace_id_membership_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_sessions
    ADD CONSTRAINT hrms_sessions_workspace_id_membership_id_id_key UNIQUE (workspace_id, membership_id, id);


--
-- Name: hrms_settings hrms_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_settings
    ADD CONSTRAINT hrms_settings_pkey PRIMARY KEY (workspace_id);


--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (id);


--
-- Name: integration_connections integration_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_connections
    ADD CONSTRAINT integration_connections_pkey PRIMARY KEY (id);


--
-- Name: integration_resources integration_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_resources
    ADD CONSTRAINT integration_resources_pkey PRIMARY KEY (id);


--
-- Name: invitation_roles invitation_roles_invitation_id_role_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_roles
    ADD CONSTRAINT invitation_roles_invitation_id_role_id_pk PRIMARY KEY (invitation_id, role_id);


--
-- Name: invitation_teams invitation_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_teams
    ADD CONSTRAINT invitation_teams_pkey PRIMARY KEY (invitation_id, team_id);


--
-- Name: job_identities job_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identities
    ADD CONSTRAINT job_identities_pkey PRIMARY KEY (id);


--
-- Name: job_identities job_identities_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identities
    ADD CONSTRAINT job_identities_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: job_identities job_identities_workspace_id_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identities
    ADD CONSTRAINT job_identities_workspace_id_reference_key UNIQUE (workspace_id, reference);


--
-- Name: job_identities job_identities_workspace_id_root_type_root_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identities
    ADD CONSTRAINT job_identities_workspace_id_root_type_root_id_key UNIQUE (workspace_id, root_type, root_id);


--
-- Name: job_identity_link_events job_identity_link_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identity_link_events
    ADD CONSTRAINT job_identity_link_events_pkey PRIMARY KEY (id);


--
-- Name: job_identity_link_events job_identity_link_events_workspace_id_link_id_link_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identity_link_events
    ADD CONSTRAINT job_identity_link_events_workspace_id_link_id_link_version_key UNIQUE (workspace_id, link_id, link_version);


--
-- Name: job_identity_links job_identity_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identity_links
    ADD CONSTRAINT job_identity_links_pkey PRIMARY KEY (id);


--
-- Name: job_identity_links job_identity_links_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identity_links
    ADD CONSTRAINT job_identity_links_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: job_identity_links job_identity_links_workspace_id_source_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identity_links
    ADD CONSTRAINT job_identity_links_workspace_id_source_key_key UNIQUE (workspace_id, source_key);


--
-- Name: job_manual_stage_events job_manual_stage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_manual_stage_events
    ADD CONSTRAINT job_manual_stage_events_pkey PRIMARY KEY (id);


--
-- Name: job_manual_stage_events job_manual_stage_events_workspace_id_job_id_stage_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_manual_stage_events
    ADD CONSTRAINT job_manual_stage_events_workspace_id_job_id_stage_version_key UNIQUE (workspace_id, job_id, stage_version);


--
-- Name: job_manual_stage_events job_manual_stage_events_workspace_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_manual_stage_events
    ADD CONSTRAINT job_manual_stage_events_workspace_id_request_id_key UNIQUE (workspace_id, request_id);


--
-- Name: job_manual_stages job_manual_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_manual_stages
    ADD CONSTRAINT job_manual_stages_pkey PRIMARY KEY (workspace_id, job_id);


--
-- Name: job_reference_counters job_reference_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_reference_counters
    ADD CONSTRAINT job_reference_counters_pkey PRIMARY KEY (workspace_id);


--
-- Name: legal_entities legal_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_pkey PRIMARY KEY (id);


--
-- Name: legal_entities legal_entities_workspace_identity_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_workspace_identity_uq UNIQUE (workspace_id, id);


--
-- Name: local_auth_credentials local_auth_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_auth_credentials
    ADD CONSTRAINT local_auth_credentials_pkey PRIMARY KEY (user_id);


--
-- Name: member_roles member_roles_membership_id_role_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT member_roles_membership_id_role_id_pk PRIMARY KEY (membership_id, role_id);


--
-- Name: mfa_enrollment_requirements mfa_enrollment_requirements_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_enrollment_requirements
    ADD CONSTRAINT mfa_enrollment_requirements_pk PRIMARY KEY (user_id, account_id);


--
-- Name: mfa_security_events mfa_security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_security_events
    ADD CONSTRAINT mfa_security_events_pkey PRIMARY KEY (id);


--
-- Name: notification_delivery_attempts notification_delivery_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery_attempts
    ADD CONSTRAINT notification_delivery_attempts_pkey PRIMARY KEY (id);


--
-- Name: notification_device_consents notification_device_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_device_consents
    ADD CONSTRAINT notification_device_consents_pkey PRIMARY KEY (id);


--
-- Name: notification_device_consents notification_device_consents_workspace_id_user_id_installat_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_device_consents
    ADD CONSTRAINT notification_device_consents_workspace_id_user_id_installat_key UNIQUE (workspace_id, user_id, installation_id);


--
-- Name: notification_policies notification_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_policies
    ADD CONSTRAINT notification_policies_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: notification_templates notification_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: one_tree_node_revisions one_tree_node_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tree_node_revisions
    ADD CONSTRAINT one_tree_node_revisions_pkey PRIMARY KEY (workspace_id, node_id, revision);


--
-- Name: one_tree_node_revisions one_tree_node_revisions_workspace_id_node_id_source_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tree_node_revisions
    ADD CONSTRAINT one_tree_node_revisions_workspace_id_node_id_source_hash_key UNIQUE (workspace_id, node_id, source_hash);


--
-- Name: one_tree_nodes one_tree_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tree_nodes
    ADD CONSTRAINT one_tree_nodes_pkey PRIMARY KEY (id);


--
-- Name: one_tree_nodes one_tree_nodes_workspace_id_case_id_source_type_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tree_nodes
    ADD CONSTRAINT one_tree_nodes_workspace_id_case_id_source_type_source_id_key UNIQUE (workspace_id, case_id, source_type, source_id);


--
-- Name: one_tree_nodes one_tree_nodes_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tree_nodes
    ADD CONSTRAINT one_tree_nodes_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: organization_billing_allocation_versions organization_billing_allocation_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_billing_allocation_versions
    ADD CONSTRAINT organization_billing_allocation_versions_pkey PRIMARY KEY (id);


--
-- Name: organization_billing_allocation_versions organization_billing_allocation_versions_workspace_version_uidx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_billing_allocation_versions
    ADD CONSTRAINT organization_billing_allocation_versions_workspace_version_uidx UNIQUE (workspace_id, version);


--
-- Name: organization_entitlement_allocations organization_entitlement_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_entitlement_allocations
    ADD CONSTRAINT organization_entitlement_allocations_pkey PRIMARY KEY (id);


--
-- Name: organization_entitlement_allocations organization_entitlement_allocations_workspace_version_uidx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_entitlement_allocations
    ADD CONSTRAINT organization_entitlement_allocations_workspace_version_uidx UNIQUE (workspace_id, version);


--
-- Name: organization_requests organization_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_requests
    ADD CONSTRAINT organization_requests_pkey PRIMARY KEY (id);


--
-- Name: outbox_events outbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: platform_administrators platform_administrators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_administrators
    ADD CONSTRAINT platform_administrators_pkey PRIMARY KEY (user_id);


--
-- Name: platform_capability_flags platform_capability_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_capability_flags
    ADD CONSTRAINT platform_capability_flags_pkey PRIMARY KEY (code);


--
-- Name: platform_operator_audit platform_operator_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_operator_audit
    ADD CONSTRAINT platform_operator_audit_pkey PRIMARY KEY (id);


--
-- Name: platform_operator_challenges platform_operator_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_operator_challenges
    ADD CONSTRAINT platform_operator_challenges_pkey PRIMARY KEY (id);


--
-- Name: platform_operator_sessions platform_operator_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_operator_sessions
    ADD CONSTRAINT platform_operator_sessions_pkey PRIMARY KEY (id);


--
-- Name: pre_project_asset_markups pre_project_asset_markups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_asset_markups
    ADD CONSTRAINT pre_project_asset_markups_pkey PRIMARY KEY (asset_id);


--
-- Name: pre_project_brief_assets pre_project_brief_assets_object_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_brief_assets
    ADD CONSTRAINT pre_project_brief_assets_object_key_key UNIQUE (object_key);


--
-- Name: pre_project_brief_assets pre_project_brief_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_brief_assets
    ADD CONSTRAINT pre_project_brief_assets_pkey PRIMARY KEY (id);


--
-- Name: pre_project_brief_assets pre_project_brief_assets_workspace_id_case_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_brief_assets
    ADD CONSTRAINT pre_project_brief_assets_workspace_id_case_id_id_key UNIQUE (workspace_id, case_id, id);


--
-- Name: pre_project_brief_entries pre_project_brief_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_brief_entries
    ADD CONSTRAINT pre_project_brief_entries_pkey PRIMARY KEY (id);


--
-- Name: pre_project_brief_entries pre_project_brief_entries_workspace_id_case_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_brief_entries
    ADD CONSTRAINT pre_project_brief_entries_workspace_id_case_id_id_key UNIQUE (workspace_id, case_id, id);


--
-- Name: pre_project_briefs pre_project_briefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_briefs
    ADD CONSTRAINT pre_project_briefs_pkey PRIMARY KEY (case_id);


--
-- Name: pre_project_cases pre_project_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_cases
    ADD CONSTRAINT pre_project_cases_pkey PRIMARY KEY (id);


--
-- Name: pre_project_cases pre_project_cases_workspace_id_opportunity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_cases
    ADD CONSTRAINT pre_project_cases_workspace_id_opportunity_id_key UNIQUE (workspace_id, opportunity_id);


--
-- Name: pre_project_definition_baselines pre_project_definition_baselines_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_baselines
    ADD CONSTRAINT pre_project_definition_baselines_identity UNIQUE (workspace_id, case_id, id);


--
-- Name: pre_project_definition_baselines pre_project_definition_baselines_number; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_baselines
    ADD CONSTRAINT pre_project_definition_baselines_number UNIQUE (workspace_id, case_id, number);


--
-- Name: pre_project_definition_baselines pre_project_definition_baselines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_baselines
    ADD CONSTRAINT pre_project_definition_baselines_pkey PRIMARY KEY (id);


--
-- Name: pre_project_definition_baselines pre_project_definition_baselines_request; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_baselines
    ADD CONSTRAINT pre_project_definition_baselines_request UNIQUE (workspace_id, request_id);


--
-- Name: pre_project_definition_commands pre_project_definition_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_commands
    ADD CONSTRAINT pre_project_definition_commands_pkey PRIMARY KEY (workspace_id, request_id);


--
-- Name: pre_project_definition_decisions pre_project_definition_decisions_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_decisions
    ADD CONSTRAINT pre_project_definition_decisions_identity UNIQUE (workspace_id, case_id, id);


--
-- Name: pre_project_definition_decisions pre_project_definition_decisions_one_per_baseline; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_decisions
    ADD CONSTRAINT pre_project_definition_decisions_one_per_baseline UNIQUE (workspace_id, case_id, baseline_id);


--
-- Name: pre_project_definition_decisions pre_project_definition_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_decisions
    ADD CONSTRAINT pre_project_definition_decisions_pkey PRIMARY KEY (id);


--
-- Name: pre_project_design_activity pre_project_design_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_activity
    ADD CONSTRAINT pre_project_design_activity_pkey PRIMARY KEY (id);


--
-- Name: pre_project_design_folders pre_project_design_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_folders
    ADD CONSTRAINT pre_project_design_folders_pkey PRIMARY KEY (id);


--
-- Name: pre_project_design_folders pre_project_design_folders_workspace_id_case_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_folders
    ADD CONSTRAINT pre_project_design_folders_workspace_id_case_id_id_key UNIQUE (workspace_id, case_id, id);


--
-- Name: pre_project_design_messages pre_project_design_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_messages
    ADD CONSTRAINT pre_project_design_messages_pkey PRIMARY KEY (id);


--
-- Name: pre_project_design_threads pre_project_design_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_threads
    ADD CONSTRAINT pre_project_design_threads_pkey PRIMARY KEY (id);


--
-- Name: pre_project_design_threads pre_project_design_threads_workspace_id_case_id_design_id_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_threads
    ADD CONSTRAINT pre_project_design_threads_workspace_id_case_id_design_id_i_key UNIQUE (workspace_id, case_id, design_id, id);


--
-- Name: pre_project_design_versions pre_project_design_versions_design_id_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_versions
    ADD CONSTRAINT pre_project_design_versions_design_id_number_key UNIQUE (design_id, number);


--
-- Name: pre_project_design_versions pre_project_design_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_versions
    ADD CONSTRAINT pre_project_design_versions_pkey PRIMARY KEY (id);


--
-- Name: pre_project_design_versions pre_project_design_versions_workspace_id_case_id_design_id__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_versions
    ADD CONSTRAINT pre_project_design_versions_workspace_id_case_id_design_id__key UNIQUE (workspace_id, case_id, design_id, id);


--
-- Name: pre_project_designs pre_project_designs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_designs
    ADD CONSTRAINT pre_project_designs_pkey PRIMARY KEY (id);


--
-- Name: pre_project_designs pre_project_designs_workspace_id_case_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_designs
    ADD CONSTRAINT pre_project_designs_workspace_id_case_id_id_key UNIQUE (workspace_id, case_id, id);


--
-- Name: pre_project_entry_assets pre_project_entry_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_entry_assets
    ADD CONSTRAINT pre_project_entry_assets_pkey PRIMARY KEY (entry_id, asset_id);


--
-- Name: pre_project_item_design_refs pre_project_item_design_refs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_item_design_refs
    ADD CONSTRAINT pre_project_item_design_refs_pkey PRIMARY KEY (workspace_id, case_id, entry_id, version, design_version_id);


--
-- Name: pre_project_item_specifications pre_project_item_specifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_item_specifications
    ADD CONSTRAINT pre_project_item_specifications_pkey PRIMARY KEY (workspace_id, case_id, entry_id, version);


--
-- Name: pre_project_lifecycle_commands pre_project_lifecycle_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_lifecycle_commands
    ADD CONSTRAINT pre_project_lifecycle_commands_pkey PRIMARY KEY (workspace_id, request_id);


--
-- Name: pre_project_rooms pre_project_rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_rooms
    ADD CONSTRAINT pre_project_rooms_pkey PRIMARY KEY (id);


--
-- Name: pre_project_rooms pre_project_rooms_workspace_id_case_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_rooms
    ADD CONSTRAINT pre_project_rooms_workspace_id_case_id_id_key UNIQUE (workspace_id, case_id, id);


--
-- Name: pre_project_scope_links pre_project_scope_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_scope_links
    ADD CONSTRAINT pre_project_scope_links_pkey PRIMARY KEY (workspace_id, entry_id, role);


--
-- Name: pre_project_site_assets pre_project_site_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_assets
    ADD CONSTRAINT pre_project_site_assets_pkey PRIMARY KEY (workspace_id, case_id, record_id, version, asset_id);


--
-- Name: pre_project_site_records pre_project_site_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_records
    ADD CONSTRAINT pre_project_site_records_pkey PRIMARY KEY (id);


--
-- Name: pre_project_site_records pre_project_site_records_workspace_id_case_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_records
    ADD CONSTRAINT pre_project_site_records_workspace_id_case_id_id_key UNIQUE (workspace_id, case_id, id);


--
-- Name: pre_project_site_revisions pre_project_site_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_revisions
    ADD CONSTRAINT pre_project_site_revisions_pkey PRIMARY KEY (workspace_id, case_id, record_id, version);


--
-- Name: pre_project_site_specification_refs pre_project_site_specification_refs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_specification_refs
    ADD CONSTRAINT pre_project_site_specification_refs_pkey PRIMARY KEY (workspace_id, case_id, record_id, version);


--
-- Name: pre_project_specification_catalog_refs pre_project_specification_catalog_refs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_specification_catalog_refs
    ADD CONSTRAINT pre_project_specification_catalog_refs_pkey PRIMARY KEY (workspace_id, case_id, entry_id, version, record_id);


--
-- Name: project_assignments project_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_assignments
    ADD CONSTRAINT project_assignments_pkey PRIMARY KEY (id);


--
-- Name: project_assignments project_assignments_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_assignments
    ADD CONSTRAINT project_assignments_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: project_booking_history project_booking_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_booking_history
    ADD CONSTRAINT project_booking_history_pkey PRIMARY KEY (id);


--
-- Name: project_booking_slots project_booking_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_booking_slots
    ADD CONSTRAINT project_booking_slots_pkey PRIMARY KEY (id);


--
-- Name: project_booking_slots project_booking_slots_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_booking_slots
    ADD CONSTRAINT project_booking_slots_unique UNIQUE (workspace_id, booking_id, local_date, start_time, end_date, end_time);


--
-- Name: project_booking_slots project_booking_slots_workspace_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_booking_slots
    ADD CONSTRAINT project_booking_slots_workspace_id UNIQUE (workspace_id, id);


--
-- Name: project_bookings project_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_bookings
    ADD CONSTRAINT project_bookings_pkey PRIMARY KEY (id);


--
-- Name: project_bookings project_bookings_workspace_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_bookings
    ADD CONSTRAINT project_bookings_workspace_id UNIQUE (workspace_id, id);


--
-- Name: project_execution project_execution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_execution
    ADD CONSTRAINT project_execution_pkey PRIMARY KEY (project_id);


--
-- Name: project_factory_allocations project_factory_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_factory_allocations
    ADD CONSTRAINT project_factory_allocations_pkey PRIMARY KEY (workspace_id, batch_id, project_id, task_id);


--
-- Name: project_factory_batches project_factory_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_factory_batches
    ADD CONSTRAINT project_factory_batches_pkey PRIMARY KEY (id);


--
-- Name: project_factory_batches project_factory_batches_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_factory_batches
    ADD CONSTRAINT project_factory_batches_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: project_factory_commands project_factory_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_factory_commands
    ADD CONSTRAINT project_factory_commands_pkey PRIMARY KEY (workspace_id, request_id);


--
-- Name: project_resources project_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_resources
    ADD CONSTRAINT project_resources_pkey PRIMARY KEY (id);


--
-- Name: project_resources project_resources_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_resources
    ADD CONSTRAINT project_resources_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: project_stock_commands project_stock_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_stock_commands
    ADD CONSTRAINT project_stock_commands_pkey PRIMARY KEY (workspace_id, request_id);


--
-- Name: project_stock_transfers project_stock_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_stock_transfers
    ADD CONSTRAINT project_stock_transfers_pkey PRIMARY KEY (id);


--
-- Name: project_stock_transfers project_stock_transfers_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_stock_transfers
    ADD CONSTRAINT project_stock_transfers_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: project_vendor_access project_vendor_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_vendor_access
    ADD CONSTRAINT project_vendor_access_pkey PRIMARY KEY (id);


--
-- Name: project_vendor_access project_vendor_access_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_vendor_access
    ADD CONSTRAINT project_vendor_access_token_hash_key UNIQUE (token_hash);


--
-- Name: project_warehouse_stock project_warehouse_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_warehouse_stock
    ADD CONSTRAINT project_warehouse_stock_pkey PRIMARY KEY (id);


--
-- Name: project_warehouse_stock project_warehouse_stock_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_warehouse_stock
    ADD CONSTRAINT project_warehouse_stock_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: project_workflow_templates project_workflow_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_workflow_templates
    ADD CONSTRAINT project_workflow_templates_pkey PRIMARY KEY (id);


--
-- Name: project_workflow_templates project_workflow_templates_workspace_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_workflow_templates
    ADD CONSTRAINT project_workflow_templates_workspace_id UNIQUE (workspace_id, id);


--
-- Name: quotation_proposal_commands quotation_proposal_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_proposal_commands
    ADD CONSTRAINT quotation_proposal_commands_pkey PRIMARY KEY (workspace_id, request_id);


--
-- Name: quotation_proposal_runs quotation_proposal_runs_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_proposal_runs
    ADD CONSTRAINT quotation_proposal_runs_identity UNIQUE (workspace_id, case_id, id);


--
-- Name: quotation_proposal_runs quotation_proposal_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_proposal_runs
    ADD CONSTRAINT quotation_proposal_runs_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_role_id_permission_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_permission_id_pk PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sync_cursors sync_cursors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_cursors
    ADD CONSTRAINT sync_cursors_pkey PRIMARY KEY (id);


--
-- Name: tax_profiles tax_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_profiles
    ADD CONSTRAINT tax_profiles_pkey PRIMARY KEY (id);


--
-- Name: tenant_data_exports tenant_data_exports_operation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_data_exports
    ADD CONSTRAINT tenant_data_exports_operation_id_key UNIQUE (operation_id);


--
-- Name: tenant_data_exports tenant_data_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_data_exports
    ADD CONSTRAINT tenant_data_exports_pkey PRIMARY KEY (id);


--
-- Name: tenant_lifecycle_versions tenant_lifecycle_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_lifecycle_versions
    ADD CONSTRAINT tenant_lifecycle_versions_pkey PRIMARY KEY (id);


--
-- Name: tenant_lifecycle_versions tenant_lifecycle_workspace_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_lifecycle_versions
    ADD CONSTRAINT tenant_lifecycle_workspace_key_unique UNIQUE (workspace_id, idempotency_key);


--
-- Name: tenant_lifecycle_versions tenant_lifecycle_workspace_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_lifecycle_versions
    ADD CONSTRAINT tenant_lifecycle_workspace_version_unique UNIQUE (workspace_id, version);


--
-- Name: tenant_login_branding tenant_login_branding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_login_branding
    ADD CONSTRAINT tenant_login_branding_pkey PRIMARY KEY (workspace_id);


--
-- Name: tenant_operation_runs tenant_operation_runs_idempotency_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_operation_runs
    ADD CONSTRAINT tenant_operation_runs_idempotency_unique UNIQUE (workspace_id, idempotency_key);


--
-- Name: tenant_operation_runs tenant_operation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_operation_runs
    ADD CONSTRAINT tenant_operation_runs_pkey PRIMARY KEY (id);


--
-- Name: tenant_provisioning_drafts tenant_provisioning_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_provisioning_drafts
    ADD CONSTRAINT tenant_provisioning_drafts_pkey PRIMARY KEY (id);


--
-- Name: tenant_provisioning_requests tenant_provisioning_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_provisioning_requests
    ADD CONSTRAINT tenant_provisioning_requests_pkey PRIMARY KEY (id);


--
-- Name: tenant_setup_profiles tenant_setup_profiles_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_setup_profiles
    ADD CONSTRAINT tenant_setup_profiles_pk PRIMARY KEY (kind, code, version);


--
-- Name: tenant_support_sessions tenant_support_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_support_sessions
    ADD CONSTRAINT tenant_support_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_identities user_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (id);


--
-- Name: user_mfa_credentials user_mfa_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mfa_credentials
    ADD CONSTRAINT user_mfa_credentials_pkey PRIMARY KEY (user_id);


--
-- Name: user_mfa_recovery_codes user_mfa_recovery_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mfa_recovery_codes
    ADD CONSTRAINT user_mfa_recovery_codes_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webhook_inbox webhook_inbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_inbox
    ADD CONSTRAINT webhook_inbox_pkey PRIMARY KEY (id);


--
-- Name: work_locations work_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_locations
    ADD CONSTRAINT work_locations_pkey PRIMARY KEY (id);


--
-- Name: work_locations work_locations_workspace_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_locations
    ADD CONSTRAINT work_locations_workspace_id_id_key UNIQUE (workspace_id, id);


--
-- Name: workspace_brand_assets workspace_brand_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_brand_assets
    ADD CONSTRAINT workspace_brand_assets_pkey PRIMARY KEY (id);


--
-- Name: workspace_catalog_assets workspace_catalog_assets_object_uidx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_assets
    ADD CONSTRAINT workspace_catalog_assets_object_uidx UNIQUE (workspace_id, object_key);


--
-- Name: workspace_catalog_assets workspace_catalog_assets_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_assets
    ADD CONSTRAINT workspace_catalog_assets_pk PRIMARY KEY (workspace_id, id);


--
-- Name: workspace_catalog_assets workspace_catalog_assets_preview_uidx; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_assets
    ADD CONSTRAINT workspace_catalog_assets_preview_uidx UNIQUE (workspace_id, preview_key);


--
-- Name: workspace_catalog_links workspace_catalog_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_links
    ADD CONSTRAINT workspace_catalog_links_pkey PRIMARY KEY (workspace_id, record_id, relation, target_id);


--
-- Name: workspace_catalog_records workspace_catalog_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_records
    ADD CONSTRAINT workspace_catalog_records_pkey PRIMARY KEY (workspace_id, id);


--
-- Name: workspace_configuration_revisions workspace_configuration_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_configuration_revisions
    ADD CONSTRAINT workspace_configuration_revisions_pkey PRIMARY KEY (id);


--
-- Name: workspace_configuration_revisions workspace_configuration_revisions_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_configuration_revisions
    ADD CONSTRAINT workspace_configuration_revisions_unique UNIQUE (workspace_id, resource_type, resource_id, revision_number);


--
-- Name: workspace_data_policies workspace_data_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_data_policies
    ADD CONSTRAINT workspace_data_policies_pkey PRIMARY KEY (workspace_id);


--
-- Name: workspace_domains workspace_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_domains
    ADD CONSTRAINT workspace_domains_pkey PRIMARY KEY (id);


--
-- Name: workspace_entitlement_sets workspace_entitlement_sets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_entitlement_sets
    ADD CONSTRAINT workspace_entitlement_sets_pkey PRIMARY KEY (workspace_id);


--
-- Name: workspace_invitation_delivery_commands workspace_invitation_delivery_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invitation_delivery_commands
    ADD CONSTRAINT workspace_invitation_delivery_commands_pkey PRIMARY KEY (id);


--
-- Name: workspace_invitation_delivery workspace_invitation_delivery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invitation_delivery
    ADD CONSTRAINT workspace_invitation_delivery_pkey PRIMARY KEY (invitation_id);


--
-- Name: workspace_invitations workspace_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_pkey PRIMARY KEY (id);


--
-- Name: workspace_memberships workspace_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_pkey PRIMARY KEY (id);


--
-- Name: workspace_onboarding workspace_onboarding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_onboarding
    ADD CONSTRAINT workspace_onboarding_pkey PRIMARY KEY (workspace_id);


--
-- Name: workspace_setup_versions workspace_setup_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_setup_versions
    ADD CONSTRAINT workspace_setup_versions_pkey PRIMARY KEY (workspace_id);


--
-- Name: workspace_stored_objects workspace_stored_objects_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_stored_objects
    ADD CONSTRAINT workspace_stored_objects_pk PRIMARY KEY (workspace_id, object_key);


--
-- Name: workspace_subscriptions workspace_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_subscriptions
    ADD CONSTRAINT workspace_subscriptions_pkey PRIMARY KEY (workspace_id);


--
-- Name: workspace_supplier_offer_commands workspace_supplier_offer_commands_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_supplier_offer_commands
    ADD CONSTRAINT workspace_supplier_offer_commands_pk PRIMARY KEY (workspace_id, request_id);


--
-- Name: workspace_supplier_offers workspace_supplier_offers_active_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.workspace_supplier_offers
    ADD CONSTRAINT workspace_supplier_offers_active_check CHECK ((((status)::text <> 'active'::text) OR ((legal_entity_id IS NOT NULL) AND (unit_record_id IS NOT NULL) AND (amount IS NOT NULL) AND (currency IS NOT NULL) AND (effective_from IS NOT NULL) AND (source_type IS NOT NULL) AND (source_reference IS NOT NULL) AND (length(btrim((source_reference)::text)) > 0) AND ((tax_treatment)::text <> 'unconfirmed'::text)))) NOT VALID;


--
-- Name: workspace_supplier_offers workspace_supplier_offers_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_supplier_offers
    ADD CONSTRAINT workspace_supplier_offers_pk PRIMARY KEY (workspace_id, id);


--
-- Name: workspace_team_members workspace_team_members_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_team_members
    ADD CONSTRAINT workspace_team_members_pk PRIMARY KEY (team_id, membership_id);


--
-- Name: workspace_team_queue_settings workspace_team_queue_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_team_queue_settings
    ADD CONSTRAINT workspace_team_queue_settings_pkey PRIMARY KEY (team_id, queue_id);


--
-- Name: workspace_team_roles workspace_team_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_team_roles
    ADD CONSTRAINT workspace_team_roles_pkey PRIMARY KEY (team_id, role_id);


--
-- Name: workspace_teams workspace_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_teams
    ADD CONSTRAINT workspace_teams_pkey PRIMARY KEY (id);


--
-- Name: workspace_teams workspace_teams_workspace_id_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_teams
    ADD CONSTRAINT workspace_teams_workspace_id_id UNIQUE (workspace_id, id);


--
-- Name: workspace_terminology workspace_terminology_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_terminology
    ADD CONSTRAINT workspace_terminology_pk PRIMARY KEY (workspace_id, key);


--
-- Name: workspace_vendor_sites workspace_vendor_sites_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_vendor_sites
    ADD CONSTRAINT workspace_vendor_sites_pk PRIMARY KEY (workspace_id, id);


--
-- Name: workspace_vendor_sites workspace_vendor_sites_vendor_identity_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_vendor_sites
    ADD CONSTRAINT workspace_vendor_sites_vendor_identity_uq UNIQUE (workspace_id, vendor_id, id);


--
-- Name: workspace_vendors workspace_vendors_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_vendors
    ADD CONSTRAINT workspace_vendors_pk PRIMARY KEY (workspace_id, id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: account_billing_document_events_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_billing_document_events_document_idx ON public.account_billing_document_events USING btree (document_id, occurred_at DESC, recorded_at DESC);


--
-- Name: account_billing_documents_account_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_billing_documents_account_status_idx ON public.account_billing_documents USING btree (account_id, status, COALESCE(due_at, issued_at, created_at) DESC);


--
-- Name: account_collection_state_versions_effective_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_collection_state_versions_effective_idx ON public.account_collection_state_versions USING btree (account_id, effective_at DESC, version DESC);


--
-- Name: account_contract_versions_effective_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_contract_versions_effective_idx ON public.account_contract_versions USING btree (account_id, effective_from DESC, version DESC);


--
-- Name: account_entitlement_versions_effective_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_entitlement_versions_effective_idx ON public.account_entitlement_versions USING btree (account_id, effective_from DESC, version DESC);


--
-- Name: account_usage_snapshots_account_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_usage_snapshots_account_period_idx ON public.account_usage_snapshots USING btree (account_id, period_end DESC, captured_at DESC);


--
-- Name: ai_suggestions_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_suggestions_entity_idx ON public.ai_suggestions USING btree (workspace_id, entity_type, entity_id, created_at DESC);


--
-- Name: asset_markup_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX asset_markup_source_idx ON public.pre_project_asset_markups USING btree (workspace_id, case_id, source_asset_id);


--
-- Name: audit_events_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_entity_idx ON public.audit_events USING btree (workspace_id, entity_type, entity_id);


--
-- Name: audit_events_workspace_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_workspace_occurred_idx ON public.audit_events USING btree (workspace_id, occurred_at);


--
-- Name: auth_mfa_challenges_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_mfa_challenges_active_idx ON public.auth_mfa_challenges USING btree (user_id, consumed_at, expires_at);


--
-- Name: auth_mfa_challenges_token_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX auth_mfa_challenges_token_uidx ON public.auth_mfa_challenges USING btree (token_hash);


--
-- Name: auth_refresh_sessions_family_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_refresh_sessions_family_idx ON public.auth_refresh_sessions USING btree (family_id);


--
-- Name: auth_refresh_sessions_token_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX auth_refresh_sessions_token_uidx ON public.auth_refresh_sessions USING btree (token_hash);


--
-- Name: auth_refresh_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_refresh_sessions_user_idx ON public.auth_refresh_sessions USING btree (user_id);


--
-- Name: automation_approvals_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_approvals_pending_idx ON public.automation_approvals USING btree (workspace_id, status, created_at);


--
-- Name: automation_definitions_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_definitions_code_uidx ON public.automation_definitions USING btree (workspace_id, code);


--
-- Name: automation_runs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_runs_status_idx ON public.automation_runs USING btree (workspace_id, status, created_at);


--
-- Name: automation_runs_trigger_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_runs_trigger_uidx ON public.automation_runs USING btree (workspace_id, definition_id, trigger_event_id, aggregate_id);


--
-- Name: automation_step_runs_attempt_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_step_runs_attempt_uidx ON public.automation_step_runs USING btree (workspace_id, run_id, step_key, attempt);


--
-- Name: automation_versions_number_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_versions_number_uidx ON public.automation_versions USING btree (workspace_id, definition_id, version_number);


--
-- Name: automation_waits_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_waits_due_idx ON public.automation_waits USING btree (status, due_at);


--
-- Name: business_units_legal_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX business_units_legal_entity_idx ON public.business_units USING btree (legal_entity_id);


--
-- Name: business_units_workspace_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX business_units_workspace_code_uidx ON public.business_units USING btree (workspace_id, code);


--
-- Name: client_portal_challenge_rate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_portal_challenge_rate_idx ON public.client_portal_challenges USING btree (workspace_id, phone, created_at DESC);


--
-- Name: commercial_reconciliation_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commercial_reconciliation_due ON public.commercial_reconciliation_jobs USING btree (next_at);


--
-- Name: crm_activities_active_lead_next_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_activities_active_lead_next_uidx ON public.crm_activities USING btree (workspace_id, lead_id) WHERE ((lead_id IS NOT NULL) AND is_next_action AND (status = 'pending'::public.crm_activity_status));


--
-- Name: crm_activities_active_opportunity_next_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_activities_active_opportunity_next_uidx ON public.crm_activities USING btree (workspace_id, opportunity_id) WHERE ((opportunity_id IS NOT NULL) AND is_next_action AND (status = 'pending'::public.crm_activity_status));


--
-- Name: crm_activities_lead_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_activities_lead_idx ON public.crm_activities USING btree (workspace_id, lead_id, created_at);


--
-- Name: crm_activities_owner_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_activities_owner_due_idx ON public.crm_activities USING btree (workspace_id, owner_membership_id, status, due_at);


--
-- Name: crm_activities_party_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_activities_party_idx ON public.crm_activities USING btree (workspace_id, party_id, created_at);


--
-- Name: crm_activities_response_evidence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_activities_response_evidence_idx ON public.crm_activities USING btree (workspace_id, lead_id, interaction_direction, completed_at) WHERE (status = 'completed'::public.crm_activity_status);


--
-- Name: crm_activities_sla_instance_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_activities_sla_instance_uidx ON public.crm_activities USING btree (workspace_id, sla_instance_id) WHERE (sla_instance_id IS NOT NULL);


--
-- Name: crm_addresses_party_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_addresses_party_idx ON public.crm_addresses USING btree (workspace_id, party_id);


--
-- Name: crm_appointments_activity_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_appointments_activity_uidx ON public.crm_appointments USING btree (workspace_id, activity_id);


--
-- Name: crm_assignment_history_lead_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_assignment_history_lead_idx ON public.crm_assignment_history USING btree (workspace_id, lead_id, assigned_at);


--
-- Name: crm_assignment_policies_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_assignment_policies_priority_idx ON public.crm_assignment_policies USING btree (workspace_id, status, priority);


--
-- Name: crm_assignment_rules_policy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_assignment_rules_policy_idx ON public.crm_assignment_rules USING btree (workspace_id, policy_id, priority);


--
-- Name: crm_attribution_enquiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_attribution_enquiry_idx ON public.crm_attribution_touches USING btree (workspace_id, enquiry_id, touched_at);


--
-- Name: crm_consents_party_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_consents_party_idx ON public.crm_consents USING btree (workspace_id, party_id);


--
-- Name: crm_consents_scope_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_consents_scope_uidx ON public.crm_consents USING btree (workspace_id, party_id, legal_entity_id, purpose, channel) NULLS NOT DISTINCT;


--
-- Name: crm_contact_points_normalized_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contact_points_normalized_idx ON public.crm_contact_points USING btree (workspace_id, type, normalized_value);


--
-- Name: crm_contact_points_party_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_contact_points_party_idx ON public.crm_contact_points USING btree (workspace_id, party_id);


--
-- Name: crm_conversations_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_conversations_owner_idx ON public.crm_conversations USING btree (workspace_id, owner_membership_id, last_message_at);


--
-- Name: crm_conversations_provider_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_conversations_provider_uidx ON public.crm_conversations USING btree (workspace_id, channel, provider_thread_id);


--
-- Name: crm_custom_field_definitions_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_custom_field_definitions_key_uidx ON public.crm_custom_field_definitions USING btree (workspace_id, entity_type, key);


--
-- Name: crm_custom_field_values_entity_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_custom_field_values_entity_uidx ON public.crm_custom_field_values USING btree (workspace_id, definition_id, entity_type, entity_id);


--
-- Name: crm_custom_field_values_text_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_custom_field_values_text_idx ON public.crm_custom_field_values USING btree (workspace_id, definition_id, value_text);


--
-- Name: crm_enquiries_intake_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_enquiries_intake_uidx ON public.crm_enquiries USING btree (workspace_id, intake_event_id);


--
-- Name: crm_enquiries_party_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_enquiries_party_idx ON public.crm_enquiries USING btree (workspace_id, party_id, received_at);


--
-- Name: crm_enquiries_reference_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_enquiries_reference_uidx ON public.crm_enquiries USING btree (workspace_id, reference);


--
-- Name: crm_enquiries_reporting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_enquiries_reporting_idx ON public.crm_enquiries USING btree (workspace_id, service_type, received_at);


--
-- Name: crm_forecast_snapshots_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_forecast_snapshots_time_idx ON public.crm_forecast_snapshots USING btree (workspace_id, captured_at);


--
-- Name: crm_identity_candidate_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_identity_candidate_review_idx ON public.crm_identity_candidates USING btree (workspace_id, status, created_at);


--
-- Name: crm_identity_candidate_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_identity_candidate_uidx ON public.crm_identity_candidates USING btree (workspace_id, intake_event_id, candidate_party_id);


--
-- Name: crm_identity_candidates_resolved_party_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_identity_candidates_resolved_party_idx ON public.crm_identity_candidates USING btree (workspace_id, resolved_party_id, reviewed_at) WHERE (resolved_party_id IS NOT NULL);


--
-- Name: crm_intake_events_external_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_intake_events_external_uidx ON public.crm_intake_events USING btree (workspace_id, source, external_event_id);


--
-- Name: crm_intake_events_idempotency_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_intake_events_idempotency_uidx ON public.crm_intake_events USING btree (workspace_id, idempotency_key);


--
-- Name: crm_intake_events_inbox_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_intake_events_inbox_idx ON public.crm_intake_events USING btree (workspace_id, status, received_at);


--
-- Name: crm_intake_events_resolution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_intake_events_resolution_idx ON public.crm_intake_events USING btree (workspace_id, resolved_party_id, resolved_at) WHERE (resolved_party_id IS NOT NULL);


--
-- Name: crm_lead_forms_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_lead_forms_workspace_idx ON public.crm_lead_forms USING btree (workspace_id, updated_at);


--
-- Name: crm_lead_qualification_value_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_lead_qualification_value_uidx ON public.crm_lead_qualification_values USING btree (workspace_id, lead_id, question_key);


--
-- Name: crm_leads_enquiry_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_leads_enquiry_uidx ON public.crm_leads USING btree (workspace_id, enquiry_id);


--
-- Name: crm_leads_next_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_leads_next_action_idx ON public.crm_leads USING btree (workspace_id, next_action_at);


--
-- Name: crm_leads_owner_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_leads_owner_status_idx ON public.crm_leads USING btree (workspace_id, owner_membership_id, status);


--
-- Name: crm_leads_ownership_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_leads_ownership_due_idx ON public.crm_leads USING btree (workspace_id, ownership_due_at) WHERE (ownership_due_at IS NOT NULL);


--
-- Name: crm_leads_queue_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_leads_queue_status_idx ON public.crm_leads USING btree (workspace_id, queue_id, status);


--
-- Name: crm_merge_operations_party_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_merge_operations_party_idx ON public.crm_merge_operations USING btree (workspace_id, survivor_party_id, merged_party_id);


--
-- Name: crm_message_attachments_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_message_attachments_message_idx ON public.crm_message_attachments USING btree (workspace_id, message_id);


--
-- Name: crm_messages_body_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_messages_body_search_idx ON public.crm_messages USING gin (to_tsvector('simple'::regconfig, COALESCE(body_text, ''::text)));


--
-- Name: crm_messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_messages_conversation_idx ON public.crm_messages USING btree (workspace_id, conversation_id, created_at);


--
-- Name: crm_messages_provider_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_messages_provider_uidx ON public.crm_messages USING btree (workspace_id, provider_message_id);


--
-- Name: crm_messages_response_evidence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_messages_response_evidence_idx ON public.crm_messages USING btree (workspace_id, conversation_id, direction, authorship, sent_at) WHERE (direction = 'outbound'::public.crm_message_direction);


--
-- Name: crm_opportunities_lead_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_opportunities_lead_uidx ON public.crm_opportunities USING btree (workspace_id, lead_id) WHERE (lead_id IS NOT NULL);


--
-- Name: crm_opportunities_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_opportunities_owner_idx ON public.crm_opportunities USING btree (workspace_id, owner_membership_id, status);


--
-- Name: crm_opportunities_party_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_opportunities_party_idx ON public.crm_opportunities USING btree (workspace_id, party_id, created_at);


--
-- Name: crm_opportunities_reference_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_opportunities_reference_uidx ON public.crm_opportunities USING btree (workspace_id, reference);


--
-- Name: crm_opportunities_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_opportunities_stage_idx ON public.crm_opportunities USING btree (workspace_id, pipeline_id, stage_id, status);


--
-- Name: crm_organization_domain_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_organization_domain_trgm_idx ON public.crm_organization_profiles USING gin (website_domain public.gin_trgm_ops);


--
-- Name: crm_parties_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_parties_name_trgm_idx ON public.crm_parties USING gin (normalized_name public.gin_trgm_ops);


--
-- Name: crm_parties_workspace_lifecycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_parties_workspace_lifecycle_idx ON public.crm_parties USING btree (workspace_id, lifecycle);


--
-- Name: crm_parties_workspace_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_parties_workspace_name_idx ON public.crm_parties USING btree (workspace_id, normalized_name);


--
-- Name: crm_parties_workspace_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_parties_workspace_owner_idx ON public.crm_parties USING btree (workspace_id, owner_membership_id);


--
-- Name: crm_pipeline_stages_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_pipeline_stages_code_uidx ON public.crm_pipeline_stages USING btree (workspace_id, pipeline_id, code);


--
-- Name: crm_pipeline_stages_position_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_pipeline_stages_position_uidx ON public.crm_pipeline_stages USING btree (workspace_id, pipeline_id, "position");


--
-- Name: crm_pipelines_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_pipelines_code_uidx ON public.crm_pipelines USING btree (workspace_id, code);


--
-- Name: crm_project_links_opportunity_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_project_links_opportunity_uidx ON public.crm_project_links USING btree (workspace_id, opportunity_id);


--
-- Name: crm_project_links_project_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_project_links_project_uidx ON public.crm_project_links USING btree (workspace_id, project_id);


--
-- Name: crm_qualification_forms_active_scope_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_qualification_forms_active_scope_uidx ON public.crm_qualification_forms USING btree (workspace_id, COALESCE(service_type, ''::character varying)) WHERE ((status)::text = 'active'::text);


--
-- Name: crm_qualification_forms_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_qualification_forms_code_uidx ON public.crm_qualification_forms USING btree (workspace_id, code);


--
-- Name: crm_qualification_questions_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_qualification_questions_key_uidx ON public.crm_qualification_questions USING btree (workspace_id, form_id, key);


--
-- Name: crm_qualification_questions_position_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_qualification_questions_position_uidx ON public.crm_qualification_questions USING btree (workspace_id, form_id, "position");


--
-- Name: crm_queue_members_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_queue_members_member_idx ON public.crm_queue_members USING btree (workspace_id, membership_id);


--
-- Name: crm_queues_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_queues_code_uidx ON public.crm_queues USING btree (workspace_id, code);


--
-- Name: crm_queues_fallback_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_queues_fallback_idx ON public.crm_queues USING btree (workspace_id, is_fallback);


--
-- Name: crm_relationships_from_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_relationships_from_idx ON public.crm_relationships USING btree (workspace_id, from_party_id);


--
-- Name: crm_relationships_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_relationships_to_idx ON public.crm_relationships USING btree (workspace_id, to_party_id);


--
-- Name: crm_relationships_unique_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_relationships_unique_uidx ON public.crm_relationships USING btree (workspace_id, from_party_id, to_party_id, type);


--
-- Name: crm_saved_views_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_saved_views_owner_idx ON public.crm_saved_views USING btree (workspace_id, entity_type, owner_membership_id);


--
-- Name: crm_sequence_enrollments_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_sequence_enrollments_due_idx ON public.crm_sequence_enrollments USING btree (workspace_id, status, next_run_at);


--
-- Name: crm_sequence_steps_position_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_sequence_steps_position_uidx ON public.crm_sequence_steps USING btree (workspace_id, sequence_id, "position");


--
-- Name: crm_sequences_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_sequences_status_idx ON public.crm_sequences USING btree (workspace_id, status);


--
-- Name: crm_sla_history_instance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_sla_history_instance_idx ON public.crm_sla_history USING btree (workspace_id, instance_id, occurred_at);


--
-- Name: crm_sla_instances_accountability_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_sla_instances_accountability_idx ON public.crm_sla_instances USING btree (workspace_id, owner_membership_id, queue_id, started_at);


--
-- Name: crm_sla_instances_cycle_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_sla_instances_cycle_uidx ON public.crm_sla_instances USING btree (workspace_id, target_type, target_id, event_type, cycle);


--
-- Name: crm_sla_instances_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_sla_instances_due_idx ON public.crm_sla_instances USING btree (workspace_id, status, due_at);


--
-- Name: crm_sla_instances_response_reporting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_sla_instances_response_reporting_idx ON public.crm_sla_instances USING btree (workspace_id, event_type, responded_at) WHERE (responded_at IS NOT NULL);


--
-- Name: crm_sla_policies_active_event_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_sla_policies_active_event_uidx ON public.crm_sla_policies USING btree (workspace_id, event_type) WHERE ((status)::text = 'active'::text);


--
-- Name: crm_stage_history_opportunity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_stage_history_opportunity_idx ON public.crm_stage_history USING btree (workspace_id, opportunity_id, changed_at);


--
-- Name: crm_taxonomies_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_taxonomies_code_uidx ON public.crm_taxonomies USING btree (workspace_id, code);


--
-- Name: crm_taxonomy_options_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX crm_taxonomy_options_code_uidx ON public.crm_taxonomy_options USING btree (workspace_id, taxonomy_id, code);


--
-- Name: customer_account_default_organization_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_account_default_organization_uidx ON public.customer_account_organizations USING btree (account_id) WHERE (is_default = true);


--
-- Name: customer_account_memberships_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_account_memberships_user_idx ON public.customer_account_memberships USING btree (user_id, status);


--
-- Name: customer_account_organizations_workspace_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_account_organizations_workspace_uidx ON public.customer_account_organizations USING btree (workspace_id);


--
-- Name: customer_accounts_external_customer_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_accounts_external_customer_uidx ON public.customer_accounts USING btree (external_customer_id) WHERE (external_customer_id IS NOT NULL);


--
-- Name: device_endpoints_installation_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX device_endpoints_installation_uidx ON public.device_endpoints USING btree (workspace_id, user_id, installation_id);


--
-- Name: device_endpoints_token_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX device_endpoints_token_uidx ON public.device_endpoints USING btree (workspace_id, token_hash);


--
-- Name: document_sequences_entity_type_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_sequences_entity_type_uidx ON public.document_sequences USING btree (legal_entity_id, document_type);


--
-- Name: exchange_rates_natural_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX exchange_rates_natural_uidx ON public.exchange_rates USING btree (workspace_id, base_currency, quote_currency, effective_at, source);


--
-- Name: hrms_employee_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX hrms_employee_code_key ON public.hrms_employees USING btree (workspace_id, lower((employee_code)::text)) WHERE ((employee_code)::text <> ''::text);


--
-- Name: hrms_leave_dates_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hrms_leave_dates_idx ON public.hrms_leave_requests USING btree (workspace_id, membership_id, start_date, end_date);


--
-- Name: hrms_one_open_segment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX hrms_one_open_segment ON public.hrms_segments USING btree (session_id) WHERE (ended_at IS NULL);


--
-- Name: hrms_one_open_session; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX hrms_one_open_session ON public.hrms_sessions USING btree (workspace_id, membership_id) WHERE (ended_at IS NULL);


--
-- Name: hrms_sessions_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hrms_sessions_history_idx ON public.hrms_sessions USING btree (workspace_id, membership_id, started_at);


--
-- Name: idempotency_keys_workspace_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idempotency_keys_workspace_key_uidx ON public.idempotency_keys USING btree (workspace_id, key);


--
-- Name: integration_connections_active_domain_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX integration_connections_active_domain_uidx ON public.integration_connections USING btree (workspace_id, provider, legal_entity_id, external_domain) WHERE ((external_domain IS NOT NULL) AND (status <> 'revoked'::public.integration_status));


--
-- Name: integration_connections_workspace_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX integration_connections_workspace_provider_idx ON public.integration_connections USING btree (workspace_id, provider);


--
-- Name: integration_resources_connection_external_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX integration_resources_connection_external_uidx ON public.integration_resources USING btree (connection_id, resource_type, external_id);


--
-- Name: job_identity_link_events_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_identity_link_events_job_idx ON public.job_identity_link_events USING btree (workspace_id, job_id, occurred_at, id);


--
-- Name: job_identity_links_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_identity_links_job_idx ON public.job_identity_links USING btree (workspace_id, job_id, attached_at, id) WHERE ((status)::text = 'active'::text);


--
-- Name: job_manual_stage_events_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_manual_stage_events_job_idx ON public.job_manual_stage_events USING btree (workspace_id, job_id, occurred_at, id);


--
-- Name: legal_entities_workspace_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX legal_entities_workspace_code_uidx ON public.legal_entities USING btree (workspace_id, code);


--
-- Name: legal_entities_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legal_entities_workspace_idx ON public.legal_entities USING btree (workspace_id);


--
-- Name: mfa_enrollment_requirements_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mfa_enrollment_requirements_account_idx ON public.mfa_enrollment_requirements USING btree (account_id, resolved_at);


--
-- Name: mfa_security_events_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mfa_security_events_user_created_idx ON public.mfa_security_events USING btree (user_id, created_at);


--
-- Name: mfa_security_events_workspace_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mfa_security_events_workspace_created_idx ON public.mfa_security_events USING btree (workspace_id, created_at);


--
-- Name: notification_delivery_attempt_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_delivery_attempt_uidx ON public.notification_delivery_attempts USING btree (workspace_id, notification_id, attempt);


--
-- Name: notification_policies_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_policies_event_idx ON public.notification_policies USING btree (workspace_id, event_type, status);


--
-- Name: notification_preferences_scope_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_preferences_scope_uidx ON public.notification_preferences USING btree (workspace_id, recipient_type, recipient_id, event_type, channel);


--
-- Name: notification_templates_version_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_templates_version_uidx ON public.notification_templates USING btree (workspace_id, code, channel, locale, version_number);


--
-- Name: notifications_delivery_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_delivery_idx ON public.notifications USING btree (status, scheduled_for);


--
-- Name: notifications_frequency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_frequency_idx ON public.notifications USING btree (workspace_id, policy_id, recipient_type, recipient_id, channel, created_at);


--
-- Name: notifications_idempotency_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notifications_idempotency_uidx ON public.notifications USING btree (workspace_id, idempotency_key);


--
-- Name: notifications_recipient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_recipient_idx ON public.notifications USING btree (workspace_id, recipient_type, recipient_id, created_at);


--
-- Name: notifications_recovery_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_recovery_idx ON public.notifications USING btree (workspace_id, status, processing_started_at);


--
-- Name: one_tree_node_revisions_latest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX one_tree_node_revisions_latest_idx ON public.one_tree_node_revisions USING btree (workspace_id, node_id, revision DESC);


--
-- Name: one_tree_nodes_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX one_tree_nodes_case_idx ON public.one_tree_nodes USING btree (workspace_id, case_id, parent_id, kind, status);


--
-- Name: one_tree_nodes_job_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX one_tree_nodes_job_idx ON public.one_tree_nodes USING btree (workspace_id, job_id, kind, status, created_at, id);


--
-- Name: organization_billing_allocation_versions_effective_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_billing_allocation_versions_effective_idx ON public.organization_billing_allocation_versions USING btree (workspace_id, effective_from DESC, version DESC);


--
-- Name: organization_entitlement_allocations_effective_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_entitlement_allocations_effective_idx ON public.organization_entitlement_allocations USING btree (workspace_id, effective_from DESC, version DESC);


--
-- Name: organization_requests_account_idempotency_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organization_requests_account_idempotency_uidx ON public.organization_requests USING btree (account_id, idempotency_key);


--
-- Name: organization_requests_approved_workspace_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organization_requests_approved_workspace_uidx ON public.organization_requests USING btree (approved_workspace_id) WHERE (approved_workspace_id IS NOT NULL);


--
-- Name: organization_requests_pending_slug_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organization_requests_pending_slug_uidx ON public.organization_requests USING btree (account_id, lower((slug)::text)) WHERE ((status)::text = 'pending'::text);


--
-- Name: organization_requests_review_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_requests_review_queue_idx ON public.organization_requests USING btree (status, created_at);


--
-- Name: outbox_events_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_events_claim_idx ON public.outbox_events USING btree (status, available_at, claimed_at);


--
-- Name: outbox_events_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_events_pending_idx ON public.outbox_events USING btree (status, available_at);


--
-- Name: password_reset_tokens_token_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX password_reset_tokens_token_uidx ON public.password_reset_tokens USING btree (token_hash);


--
-- Name: password_reset_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX password_reset_tokens_user_idx ON public.password_reset_tokens USING btree (user_id);


--
-- Name: permissions_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX permissions_code_uidx ON public.permissions USING btree (code);


--
-- Name: platform_operator_audit_actor_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_operator_audit_actor_created_idx ON public.platform_operator_audit USING btree (actor_user_id, created_at);


--
-- Name: platform_operator_challenges_token_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX platform_operator_challenges_token_uidx ON public.platform_operator_challenges USING btree (token_hash);


--
-- Name: platform_operator_challenges_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_operator_challenges_user_idx ON public.platform_operator_challenges USING btree (user_id, consumed_at, expires_at);


--
-- Name: platform_operator_sessions_token_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX platform_operator_sessions_token_uidx ON public.platform_operator_sessions USING btree (token_hash);


--
-- Name: platform_operator_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX platform_operator_sessions_user_idx ON public.platform_operator_sessions USING btree (user_id, revoked_at, expires_at);


--
-- Name: pre_project_brief_entries_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_brief_entries_case_idx ON public.pre_project_brief_entries USING btree (workspace_id, case_id, updated_at DESC);


--
-- Name: pre_project_cases_owner_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_cases_owner_status_idx ON public.pre_project_cases USING btree (workspace_id, owner_membership_id, status, updated_at DESC);


--
-- Name: pre_project_cases_target_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_cases_target_date_idx ON public.pre_project_cases USING btree (workspace_id, status, target_date) WHERE (target_date IS NOT NULL);


--
-- Name: pre_project_cases_workspace_id_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pre_project_cases_workspace_id_id_key ON public.pre_project_cases USING btree (workspace_id, id);


--
-- Name: pre_project_cases_workspace_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_cases_workspace_updated_idx ON public.pre_project_cases USING btree (workspace_id, updated_at DESC, id DESC);


--
-- Name: pre_project_definition_baselines_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_definition_baselines_case_idx ON public.pre_project_definition_baselines USING btree (workspace_id, case_id, number DESC);


--
-- Name: pre_project_definition_commands_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_definition_commands_case_idx ON public.pre_project_definition_commands USING btree (workspace_id, case_id, created_at DESC);


--
-- Name: pre_project_definition_decisions_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_definition_decisions_case_idx ON public.pre_project_definition_decisions USING btree (workspace_id, case_id, decided_at DESC, id);


--
-- Name: pre_project_definition_decisions_challenge_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pre_project_definition_decisions_challenge_idx ON public.pre_project_definition_decisions USING btree (workspace_id, challenge_id) WHERE (challenge_id IS NOT NULL);


--
-- Name: pre_project_definition_decisions_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pre_project_definition_decisions_request_idx ON public.pre_project_definition_decisions USING btree (workspace_id, request_id) WHERE (request_id IS NOT NULL);


--
-- Name: pre_project_design_activity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_design_activity_idx ON public.pre_project_design_activity USING btree (workspace_id, case_id, design_id, created_at);


--
-- Name: pre_project_design_folders_context_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_design_folders_context_idx ON public.pre_project_design_folders USING btree (workspace_id, case_id, room_id, scope_entry_id);


--
-- Name: pre_project_design_folders_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pre_project_design_folders_name_key ON public.pre_project_design_folders USING btree (workspace_id, case_id, lower((name)::text));


--
-- Name: pre_project_design_messages_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_design_messages_thread_idx ON public.pre_project_design_messages USING btree (workspace_id, thread_id, created_at);


--
-- Name: pre_project_design_threads_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_design_threads_revision_idx ON public.pre_project_design_threads USING btree (workspace_id, case_id, design_id, version_id);


--
-- Name: pre_project_design_versions_case_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pre_project_design_versions_case_id_key ON public.pre_project_design_versions USING btree (workspace_id, case_id, id);


--
-- Name: pre_project_design_versions_review_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_design_versions_review_expiry_idx ON public.pre_project_design_versions USING btree (workspace_id, status, client_review_expires_at) WHERE ((status)::text = 'client_review'::text);


--
-- Name: pre_project_designs_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_designs_case_idx ON public.pre_project_designs USING btree (workspace_id, case_id, updated_at DESC);


--
-- Name: pre_project_lifecycle_commands_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_lifecycle_commands_case_idx ON public.pre_project_lifecycle_commands USING btree (workspace_id, case_id, created_at DESC);


--
-- Name: pre_project_rooms_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pre_project_rooms_name_key ON public.pre_project_rooms USING btree (workspace_id, case_id, lower((name)::text));


--
-- Name: pre_project_site_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_site_case_idx ON public.pre_project_site_records USING btree (workspace_id, case_id, kind, updated_at DESC);


--
-- Name: pre_project_site_item_measurement_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pre_project_site_item_measurement_key ON public.pre_project_site_records USING btree (workspace_id, case_id, entry_id) WHERE (((kind)::text = 'measurement'::text) AND (entry_id IS NOT NULL));


--
-- Name: pre_project_site_records_tree_site_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pre_project_site_records_tree_site_idx ON public.pre_project_site_records USING btree (workspace_id, case_id, site_id, kind, updated_at DESC);


--
-- Name: project_assignment_case_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_assignment_case_key ON public.project_assignments USING btree (workspace_id, case_id, membership_id) WHERE (case_id IS NOT NULL);


--
-- Name: project_assignment_project_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_assignment_project_key ON public.project_assignments USING btree (workspace_id, project_id, membership_id) WHERE (project_id IS NOT NULL);


--
-- Name: project_booking_history_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_booking_history_booking_idx ON public.project_booking_history USING btree (workspace_id, booking_id, occurred_at);


--
-- Name: project_booking_history_request_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_booking_history_request_uidx ON public.project_booking_history USING btree (workspace_id, request_id) WHERE (request_id IS NOT NULL);


--
-- Name: project_booking_slots_members_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_booking_slots_members_idx ON public.project_booking_slots USING gin (member_ids);


--
-- Name: project_booking_slots_project_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_booking_slots_project_time_idx ON public.project_booking_slots USING btree (workspace_id, project_id, starts_at, ends_at);


--
-- Name: project_booking_slots_resource_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_booking_slots_resource_time_idx ON public.project_booking_slots USING btree (workspace_id, resource_id, starts_at, ends_at);


--
-- Name: project_bookings_active_task_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_bookings_active_task_uidx ON public.project_bookings USING btree (workspace_id, project_id, task_id) WHERE ((status)::text = ANY ((ARRAY['draft'::character varying, 'tentative'::character varying, 'confirmed'::character varying])::text[]));


--
-- Name: project_bookings_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_bookings_dates ON public.project_bookings USING btree (workspace_id, starts_on, ends_on) WHERE ((status)::text = 'confirmed'::text);


--
-- Name: project_bookings_members_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_bookings_members_idx ON public.project_bookings USING gin (member_ids);


--
-- Name: project_bookings_request_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_bookings_request_uidx ON public.project_bookings USING btree (workspace_id, request_id) WHERE (request_id IS NOT NULL);


--
-- Name: project_bookings_resource_status_dates_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_bookings_resource_status_dates_idx ON public.project_bookings USING btree (workspace_id, resource_id, status, starts_on, ends_on);


--
-- Name: project_factory_task_allocation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_factory_task_allocation ON public.project_factory_allocations USING btree (workspace_id, project_id, task_id) WHERE active;


--
-- Name: project_resources_business_unit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_resources_business_unit_idx ON public.project_resources USING btree (workspace_id, business_unit_id) WHERE active;


--
-- Name: project_resources_capacity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_resources_capacity_idx ON public.project_resources USING btree (workspace_id, business_unit_id, kind, active);


--
-- Name: project_resources_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_resources_team_idx ON public.project_resources USING btree (workspace_id, workspace_team_id) WHERE active;


--
-- Name: project_workflow_templates_active_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_workflow_templates_active_code_uidx ON public.project_workflow_templates USING btree (workspace_id, code) WHERE ((status)::text = 'active'::text);


--
-- Name: project_workflow_templates_default_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX project_workflow_templates_default_uidx ON public.project_workflow_templates USING btree (workspace_id) WHERE (((status)::text = 'active'::text) AND is_default);


--
-- Name: project_workflow_templates_list_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_workflow_templates_list_idx ON public.project_workflow_templates USING btree (workspace_id, status, is_default DESC, name);


--
-- Name: quotation_proposal_commands_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotation_proposal_commands_case_idx ON public.quotation_proposal_commands USING btree (workspace_id, case_id, created_at DESC);


--
-- Name: quotation_proposal_runs_quote_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotation_proposal_runs_quote_idx ON public.quotation_proposal_runs USING btree (workspace_id, case_id, quote_id, created_at DESC, id);


--
-- Name: roles_workspace_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX roles_workspace_code_uidx ON public.roles USING btree (workspace_id, code);


--
-- Name: sync_cursors_connection_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_cursors_connection_idx ON public.sync_cursors USING btree (connection_id);


--
-- Name: tax_profiles_legal_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_profiles_legal_entity_idx ON public.tax_profiles USING btree (legal_entity_id);


--
-- Name: tenant_data_exports_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_data_exports_history_idx ON public.tenant_data_exports USING btree (workspace_id, created_at DESC, id DESC);


--
-- Name: tenant_lifecycle_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_lifecycle_history_idx ON public.tenant_lifecycle_versions USING btree (workspace_id, version DESC);


--
-- Name: tenant_login_branding_slug_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenant_login_branding_slug_uidx ON public.tenant_login_branding USING btree (login_slug);


--
-- Name: tenant_operation_runs_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_operation_runs_history_idx ON public.tenant_operation_runs USING btree (workspace_id, created_at DESC, id DESC);


--
-- Name: tenant_provisioning_drafts_external_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenant_provisioning_drafts_external_uidx ON public.tenant_provisioning_drafts USING btree (external_tenant_id);


--
-- Name: tenant_provisioning_drafts_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenant_provisioning_drafts_key_uidx ON public.tenant_provisioning_drafts USING btree (idempotency_key);


--
-- Name: tenant_provisioning_drafts_live_slug_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenant_provisioning_drafts_live_slug_uidx ON public.tenant_provisioning_drafts USING btree (slug) WHERE ((status)::text = ANY ((ARRAY['draft'::character varying, 'provisioning'::character varying, 'failed'::character varying, 'provisioned'::character varying])::text[]));


--
-- Name: tenant_provisioning_drafts_provision_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenant_provisioning_drafts_provision_key_uidx ON public.tenant_provisioning_drafts USING btree (provision_idempotency_key) WHERE (provision_idempotency_key IS NOT NULL);


--
-- Name: tenant_provisioning_drafts_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_provisioning_drafts_status_idx ON public.tenant_provisioning_drafts USING btree (status, created_at);


--
-- Name: tenant_provisioning_external_tenant_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenant_provisioning_external_tenant_uidx ON public.tenant_provisioning_requests USING btree (external_tenant_id);


--
-- Name: tenant_provisioning_idempotency_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenant_provisioning_idempotency_key_uidx ON public.tenant_provisioning_requests USING btree (idempotency_key);


--
-- Name: tenant_provisioning_workspace_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenant_provisioning_workspace_uidx ON public.tenant_provisioning_requests USING btree (workspace_id);


--
-- Name: tenant_support_sessions_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_support_sessions_state_idx ON public.tenant_support_sessions USING btree (workspace_id, status, expires_at DESC);


--
-- Name: user_identities_provider_subject_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_identities_provider_subject_uidx ON public.user_identities USING btree (provider, provider_subject);


--
-- Name: user_identities_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_identities_user_idx ON public.user_identities USING btree (user_id);


--
-- Name: user_mfa_recovery_codes_available_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_mfa_recovery_codes_available_idx ON public.user_mfa_recovery_codes USING btree (user_id, used_at);


--
-- Name: user_mfa_recovery_codes_user_hash_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_mfa_recovery_codes_user_hash_uidx ON public.user_mfa_recovery_codes USING btree (user_id, code_hash);


--
-- Name: users_primary_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_primary_email_uidx ON public.users USING btree (primary_email);


--
-- Name: webhook_inbox_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webhook_inbox_pending_idx ON public.webhook_inbox USING btree (status, received_at);


--
-- Name: webhook_inbox_provider_event_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX webhook_inbox_provider_event_uidx ON public.webhook_inbox USING btree (workspace_id, provider, external_event_id);


--
-- Name: workspace_brand_assets_object_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_brand_assets_object_key_uidx ON public.workspace_brand_assets USING btree (object_key);


--
-- Name: workspace_brand_assets_workspace_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_brand_assets_workspace_status_idx ON public.workspace_brand_assets USING btree (workspace_id, status);


--
-- Name: workspace_catalog_assets_primary_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_catalog_assets_primary_uidx ON public.workspace_catalog_assets USING btree (workspace_id, catalog_record_id) WHERE (((role)::text = 'primary_image'::text) AND ((status)::text = 'active'::text));


--
-- Name: workspace_catalog_assets_record_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_catalog_assets_record_idx ON public.workspace_catalog_assets USING btree (workspace_id, catalog_record_id, status, sort_order, created_at, id);


--
-- Name: workspace_catalog_container_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_catalog_container_code_idx ON public.workspace_catalog_records USING btree (workspace_id, code) WHERE ((kind)::text = 'catalog_group'::text);


--
-- Name: workspace_catalog_container_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_catalog_container_name_idx ON public.workspace_catalog_records USING btree (workspace_id, lower((name)::text)) WHERE ((kind)::text = 'catalog_group'::text);


--
-- Name: workspace_catalog_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_catalog_kind_idx ON public.workspace_catalog_records USING btree (workspace_id, kind, archived);


--
-- Name: workspace_catalog_links_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_catalog_links_target_idx ON public.workspace_catalog_links USING btree (workspace_id, target_id);


--
-- Name: workspace_catalog_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_catalog_name_idx ON public.workspace_catalog_records USING btree (workspace_id, catalog_id, kind, lower((name)::text)) WHERE (catalog_id IS NOT NULL);


--
-- Name: workspace_catalog_provenance_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_catalog_provenance_uidx ON public.workspace_catalog_records USING btree (workspace_id, catalog_id, (((content -> 'provenance'::text) ->> 'namespace'::text)), (((content -> 'provenance'::text) ->> 'sourceKey'::text))) WHERE ((catalog_id IS NOT NULL) AND (content ? 'provenance'::text));


--
-- Name: workspace_catalog_record_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_catalog_record_code_idx ON public.workspace_catalog_records USING btree (workspace_id, catalog_id, kind, code) WHERE (catalog_id IS NOT NULL);


--
-- Name: workspace_catalog_single_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_catalog_single_group_idx ON public.workspace_catalog_links USING btree (workspace_id, record_id) WHERE ((relation)::text = 'record_group'::text);


--
-- Name: workspace_configuration_revisions_history_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_configuration_revisions_history_idx ON public.workspace_configuration_revisions USING btree (workspace_id, resource_type, resource_id, revision_number DESC);


--
-- Name: workspace_domains_live_hostname_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_domains_live_hostname_uidx ON public.workspace_domains USING btree (hostname) WHERE (removed_at IS NULL);


--
-- Name: workspace_domains_request_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_domains_request_key_uidx ON public.workspace_domains USING btree (workspace_id, request_key);


--
-- Name: workspace_domains_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_domains_workspace_idx ON public.workspace_domains USING btree (workspace_id, created_at DESC);


--
-- Name: workspace_invitation_delivery_commands_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_invitation_delivery_commands_key_uidx ON public.workspace_invitation_delivery_commands USING btree (invitation_id, idempotency_key);


--
-- Name: workspace_invitations_pending_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_invitations_pending_email_uidx ON public.workspace_invitations USING btree (workspace_id, email) WHERE (status = 'pending'::public.invitation_status);


--
-- Name: workspace_invitations_token_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_invitations_token_uidx ON public.workspace_invitations USING btree (token_hash);


--
-- Name: workspace_invitations_workspace_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_invitations_workspace_email_idx ON public.workspace_invitations USING btree (workspace_id, email);


--
-- Name: workspace_memberships_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_memberships_user_idx ON public.workspace_memberships USING btree (user_id);


--
-- Name: workspace_memberships_workspace_id_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_memberships_workspace_id_id_key ON public.workspace_memberships USING btree (workspace_id, id);


--
-- Name: workspace_memberships_workspace_user_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_memberships_workspace_user_uidx ON public.workspace_memberships USING btree (workspace_id, user_id);


--
-- Name: workspace_stored_objects_usage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_stored_objects_usage_idx ON public.workspace_stored_objects USING btree (workspace_id, status, reservation_expires_at) WHERE (removed_at IS NULL);


--
-- Name: workspace_supplier_offer_commands_offer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_supplier_offer_commands_offer_idx ON public.workspace_supplier_offer_commands USING btree (workspace_id, offer_id, created_at);


--
-- Name: workspace_supplier_offers_catalog_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_supplier_offers_catalog_idx ON public.workspace_supplier_offers USING btree (workspace_id, catalog_record_id, status, effective_from);


--
-- Name: workspace_supplier_offers_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_supplier_offers_entity_idx ON public.workspace_supplier_offers USING btree (workspace_id, legal_entity_id, status, effective_from);


--
-- Name: workspace_supplier_offers_exact_tier_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_supplier_offers_exact_tier_uidx ON public.workspace_supplier_offers USING btree (workspace_id, vendor_id, COALESCE(vendor_site_id, '00000000-0000-0000-0000-000000000000'::uuid), catalog_record_id, unit_record_id, currency, effective_from, COALESCE(quantity_from, (0)::numeric)) WHERE ((status)::text = 'active'::text);


--
-- Name: workspace_supplier_offers_replacement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_supplier_offers_replacement_idx ON public.workspace_supplier_offers USING btree (workspace_id, replaces_offer_id) WHERE (replaces_offer_id IS NOT NULL);


--
-- Name: workspace_supplier_offers_vendor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_supplier_offers_vendor_idx ON public.workspace_supplier_offers USING btree (workspace_id, vendor_id, status, updated_at DESC);


--
-- Name: workspace_team_members_membership_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_team_members_membership_idx ON public.workspace_team_members USING btree (membership_id);


--
-- Name: workspace_team_queue_settings_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_team_queue_settings_queue_idx ON public.workspace_team_queue_settings USING btree (workspace_id, queue_id);


--
-- Name: workspace_team_roles_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_team_roles_role_idx ON public.workspace_team_roles USING btree (workspace_id, role_id);


--
-- Name: workspace_team_single_lead_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_team_single_lead_uidx ON public.workspace_team_members USING btree (team_id) WHERE (is_lead = true);


--
-- Name: workspace_teams_business_unit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_teams_business_unit_idx ON public.workspace_teams USING btree (business_unit_id);


--
-- Name: workspace_teams_workspace_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_teams_workspace_code_uidx ON public.workspace_teams USING btree (workspace_id, code);


--
-- Name: workspace_terminology_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_terminology_updated_idx ON public.workspace_terminology USING btree (workspace_id, updated_at DESC);


--
-- Name: workspace_vendor_sites_primary_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_vendor_sites_primary_uidx ON public.workspace_vendor_sites USING btree (workspace_id, vendor_id) WHERE (((status)::text = 'active'::text) AND is_primary);


--
-- Name: workspace_vendor_sites_vendor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_vendor_sites_vendor_idx ON public.workspace_vendor_sites USING btree (workspace_id, vendor_id, status, name);


--
-- Name: workspace_vendors_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_vendors_code_uidx ON public.workspace_vendors USING btree (workspace_id, lower((code)::text));


--
-- Name: workspace_vendors_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_vendors_name_idx ON public.workspace_vendors USING btree (workspace_id, lower((display_name)::text), id);


--
-- Name: workspace_vendors_registration_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_vendors_registration_uidx ON public.workspace_vendors USING btree (workspace_id, lower(btrim((registration_number)::text))) WHERE (registration_number IS NOT NULL);


--
-- Name: workspace_vendors_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_vendors_status_idx ON public.workspace_vendors USING btree (workspace_id, status, updated_at DESC);


--
-- Name: workspace_vendors_tax_registration_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspace_vendors_tax_registration_uidx ON public.workspace_vendors USING btree (workspace_id, lower(btrim((tax_registration_number)::text))) WHERE (tax_registration_number IS NOT NULL);


--
-- Name: workspaces_slug_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspaces_slug_uidx ON public.workspaces USING btree (slug);


--
-- Name: account_billing_documents account_billing_documents_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER account_billing_documents_set_updated_at BEFORE UPDATE ON public.account_billing_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: audit_events audit_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_append_only BEFORE DELETE OR UPDATE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_event_mutation();


--
-- Name: automation_approvals automation_approvals_requested_from_membership_id_workspace_gua; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER automation_approvals_requested_from_membership_id_workspace_gua BEFORE INSERT OR UPDATE ON public.automation_approvals FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'requested_from_membership_id');


--
-- Name: automation_approvals automation_approvals_run_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER automation_approvals_run_id_workspace_guard BEFORE INSERT OR UPDATE ON public.automation_approvals FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('automation_runs', 'run_id');


--
-- Name: automation_runs automation_runs_definition_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER automation_runs_definition_id_workspace_guard BEFORE INSERT OR UPDATE ON public.automation_runs FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('automation_definitions', 'definition_id');


--
-- Name: automation_runs automation_runs_version_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER automation_runs_version_id_workspace_guard BEFORE INSERT OR UPDATE ON public.automation_runs FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('automation_versions', 'version_id');


--
-- Name: automation_step_runs automation_step_runs_run_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER automation_step_runs_run_id_workspace_guard BEFORE INSERT OR UPDATE ON public.automation_step_runs FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('automation_runs', 'run_id');


--
-- Name: automation_versions automation_versions_definition_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER automation_versions_definition_id_workspace_guard BEFORE INSERT OR UPDATE ON public.automation_versions FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('automation_definitions', 'definition_id');


--
-- Name: automation_waits automation_waits_run_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER automation_waits_run_id_workspace_guard BEFORE INSERT OR UPDATE ON public.automation_waits FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('automation_runs', 'run_id');


--
-- Name: business_units business_units_legal_entity_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER business_units_legal_entity_workspace_guard BEFORE INSERT OR UPDATE ON public.business_units FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('legal_entities', 'legal_entity_id');


--
-- Name: business_units business_units_parent_entity_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER business_units_parent_entity_guard BEFORE INSERT OR UPDATE ON public.business_units FOR EACH ROW EXECUTE FUNCTION public.enforce_business_unit_parent_entity();


--
-- Name: business_units business_units_parent_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER business_units_parent_workspace_guard BEFORE INSERT OR UPDATE ON public.business_units FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('business_units', 'parent_business_unit_id');


--
-- Name: crm_activities crm_activities_lead_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_activities_lead_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_activities FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_leads', 'lead_id');


--
-- Name: crm_activities crm_activities_owner_membership_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_activities_owner_membership_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_activities FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'owner_membership_id');


--
-- Name: crm_activities crm_activities_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_activities_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_activities FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'party_id');


--
-- Name: crm_addresses crm_addresses_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_addresses_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_addresses FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'party_id');


--
-- Name: crm_appointments crm_appointments_activity_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_appointments_activity_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_appointments FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_activities', 'activity_id');


--
-- Name: crm_assignment_history crm_assignment_history_lead_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_assignment_history_lead_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_assignment_history FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_leads', 'lead_id');


--
-- Name: crm_assignment_history crm_assignment_history_owner_membership_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_assignment_history_owner_membership_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_assignment_history FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'owner_membership_id');


--
-- Name: crm_assignment_history crm_assignment_history_previous_owner_membership_id_workspace_g; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_assignment_history_previous_owner_membership_id_workspace_g BEFORE INSERT OR UPDATE ON public.crm_assignment_history FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'previous_owner_membership_id');


--
-- Name: crm_assignment_history crm_assignment_history_queue_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_assignment_history_queue_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_assignment_history FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_queues', 'queue_id');


--
-- Name: crm_assignment_history crm_assignment_history_rule_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_assignment_history_rule_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_assignment_history FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_assignment_rules', 'rule_id');


--
-- Name: crm_assignment_policies crm_assignment_policies_fallback_queue_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_assignment_policies_fallback_queue_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_assignment_policies FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_queues', 'fallback_queue_id');


--
-- Name: crm_assignment_rules crm_assignment_rules_policy_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_assignment_rules_policy_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_assignment_rules FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_assignment_policies', 'policy_id');


--
-- Name: crm_assignment_rules crm_assignment_rules_queue_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_assignment_rules_queue_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_assignment_rules FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_queues', 'queue_id');


--
-- Name: crm_attribution_touches crm_attribution_touches_enquiry_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_attribution_touches_enquiry_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_attribution_touches FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_enquiries', 'enquiry_id');


--
-- Name: crm_consents crm_consents_legal_entity_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_consents_legal_entity_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_consents FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('legal_entities', 'legal_entity_id');


--
-- Name: crm_consents crm_consents_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_consents_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_consents FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'party_id');


--
-- Name: crm_contact_points crm_contact_points_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_contact_points_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_contact_points FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'party_id');


--
-- Name: crm_conversation_participants crm_conversation_participants_conversation_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_conversation_participants_conversation_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_conversation_participants FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_conversations', 'conversation_id');


--
-- Name: crm_conversations crm_conversations_lead_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_conversations_lead_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_conversations FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_leads', 'lead_id');


--
-- Name: crm_conversations crm_conversations_owner_membership_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_conversations_owner_membership_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_conversations FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'owner_membership_id');


--
-- Name: crm_conversations crm_conversations_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_conversations_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_conversations FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'party_id');


--
-- Name: crm_custom_field_values crm_custom_field_values_definition_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_custom_field_values_definition_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_custom_field_values FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_custom_field_definitions', 'definition_id');


--
-- Name: crm_enquiries crm_enquiries_intake_event_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_enquiries_intake_event_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_enquiries FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_intake_events', 'intake_event_id');


--
-- Name: crm_enquiries crm_enquiries_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_enquiries_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_enquiries FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'party_id');


--
-- Name: crm_enquiries crm_enquiry_reference; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_enquiry_reference BEFORE INSERT OR UPDATE ON public.crm_enquiries FOR EACH ROW EXECUTE FUNCTION public.crm_allocate_enquiry_reference();


--
-- Name: crm_forecast_snapshots crm_forecast_snapshots_opportunity_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_forecast_snapshots_opportunity_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_forecast_snapshots FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_opportunities', 'opportunity_id');


--
-- Name: crm_forecast_snapshots crm_forecast_snapshots_owner_membership_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_forecast_snapshots_owner_membership_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_forecast_snapshots FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'owner_membership_id');


--
-- Name: crm_forecast_snapshots crm_forecast_snapshots_stage_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_forecast_snapshots_stage_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_forecast_snapshots FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_pipeline_stages', 'stage_id');


--
-- Name: crm_identity_candidates crm_identity_candidates_candidate_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_identity_candidates_candidate_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_identity_candidates FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'candidate_party_id');


--
-- Name: crm_identity_candidates crm_identity_candidates_intake_event_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_identity_candidates_intake_event_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_identity_candidates FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_intake_events', 'intake_event_id');


--
-- Name: crm_identity_candidates crm_identity_candidates_resolved_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_identity_candidates_resolved_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_identity_candidates FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'resolved_party_id');


--
-- Name: crm_intake_events crm_intake_events_business_unit_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_intake_events_business_unit_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_intake_events FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('business_units', 'business_unit_id');


--
-- Name: crm_intake_events crm_intake_events_legal_entity_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_intake_events_legal_entity_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_intake_events FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('legal_entities', 'legal_entity_id');


--
-- Name: crm_intake_events crm_intake_events_resolved_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_intake_events_resolved_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_intake_events FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'resolved_party_id');


--
-- Name: crm_lead_qualification_values crm_lead_qualification_values_lead_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_lead_qualification_values_lead_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_lead_qualification_values FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_leads', 'lead_id');


--
-- Name: crm_leads crm_leads_enquiry_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_leads_enquiry_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_enquiries', 'enquiry_id');


--
-- Name: crm_leads crm_leads_owner_membership_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_leads_owner_membership_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'owner_membership_id');


--
-- Name: crm_leads crm_leads_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_leads_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'party_id');


--
-- Name: crm_leads crm_leads_queue_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_leads_queue_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_queues', 'queue_id');


--
-- Name: crm_merge_operations crm_merge_operations_merged_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_merge_operations_merged_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_merge_operations FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'merged_party_id');


--
-- Name: crm_merge_operations crm_merge_operations_survivor_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_merge_operations_survivor_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_merge_operations FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'survivor_party_id');


--
-- Name: crm_message_attachments crm_message_attachments_message_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_message_attachments_message_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_message_attachments FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_messages', 'message_id');


--
-- Name: crm_messages crm_messages_conversation_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_messages_conversation_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_messages FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_conversations', 'conversation_id');


--
-- Name: crm_opportunities crm_opportunities_business_unit_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunities_business_unit_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('business_units', 'business_unit_id');


--
-- Name: crm_opportunities crm_opportunities_lead_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunities_lead_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_leads', 'lead_id');


--
-- Name: crm_opportunities crm_opportunities_legal_entity_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunities_legal_entity_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('legal_entities', 'legal_entity_id');


--
-- Name: crm_opportunities crm_opportunities_owner_membership_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunities_owner_membership_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'owner_membership_id');


--
-- Name: crm_opportunities crm_opportunities_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunities_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'party_id');


--
-- Name: crm_opportunities crm_opportunities_pipeline_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunities_pipeline_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_pipelines', 'pipeline_id');


--
-- Name: crm_opportunities crm_opportunities_stage_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunities_stage_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_pipeline_stages', 'stage_id');


--
-- Name: crm_opportunities crm_opportunity_reference; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunity_reference BEFORE INSERT OR UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION public.crm_allocate_opportunity_reference();


--
-- Name: crm_opportunity_stakeholders crm_opportunity_stakeholders_opportunity_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunity_stakeholders_opportunity_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_opportunity_stakeholders FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_opportunities', 'opportunity_id');


--
-- Name: crm_opportunity_stakeholders crm_opportunity_stakeholders_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunity_stakeholders_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_opportunity_stakeholders FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'party_id');


--
-- Name: crm_opportunity_team crm_opportunity_team_membership_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunity_team_membership_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_opportunity_team FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'membership_id');


--
-- Name: crm_opportunity_team crm_opportunity_team_opportunity_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunity_team_opportunity_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_opportunity_team FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_opportunities', 'opportunity_id');


--
-- Name: crm_organization_profiles crm_organization_profiles_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_organization_profiles_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_organization_profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'party_id');


--
-- Name: crm_parties crm_parties_business_unit_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_parties_business_unit_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_parties FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('business_units', 'business_unit_id');


--
-- Name: crm_parties crm_parties_legal_entity_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_parties_legal_entity_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_parties FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('legal_entities', 'legal_entity_id');


--
-- Name: crm_parties crm_parties_merged_into_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_parties_merged_into_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_parties FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'merged_into_party_id');


--
-- Name: crm_parties crm_parties_owner_membership_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_parties_owner_membership_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_parties FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'owner_membership_id');


--
-- Name: crm_person_profiles crm_person_profiles_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_person_profiles_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_person_profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'party_id');


--
-- Name: crm_pipeline_stages crm_pipeline_stages_pipeline_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_pipeline_stages_pipeline_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_pipeline_stages FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_pipelines', 'pipeline_id');


--
-- Name: crm_project_links crm_project_links_opportunity_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_project_links_opportunity_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_project_links FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_opportunities', 'opportunity_id');


--
-- Name: crm_qualification_questions crm_qualification_questions_form_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_qualification_questions_form_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_qualification_questions FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_qualification_forms', 'form_id');


--
-- Name: crm_queue_members crm_queue_members_membership_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_queue_members_membership_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_queue_members FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'membership_id');


--
-- Name: crm_queue_members crm_queue_members_queue_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_queue_members_queue_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_queue_members FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_queues', 'queue_id');


--
-- Name: crm_queues crm_queues_business_unit_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_queues_business_unit_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_queues FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('business_units', 'business_unit_id');


--
-- Name: crm_relationships crm_relationships_from_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_relationships_from_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_relationships FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'from_party_id');


--
-- Name: crm_relationships crm_relationships_to_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_relationships_to_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_relationships FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'to_party_id');


--
-- Name: crm_saved_views crm_saved_views_owner_membership_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_saved_views_owner_membership_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_saved_views FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'owner_membership_id');


--
-- Name: crm_sequence_enrollments crm_sequence_enrollments_lead_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_sequence_enrollments_lead_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_sequence_enrollments FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_leads', 'lead_id');


--
-- Name: crm_sequence_enrollments crm_sequence_enrollments_party_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_sequence_enrollments_party_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_sequence_enrollments FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_parties', 'party_id');


--
-- Name: crm_sequence_enrollments crm_sequence_enrollments_sequence_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_sequence_enrollments_sequence_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_sequence_enrollments FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_sequences', 'sequence_id');


--
-- Name: crm_sequence_steps crm_sequence_steps_sequence_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_sequence_steps_sequence_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_sequence_steps FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_sequences', 'sequence_id');


--
-- Name: crm_sla_history crm_sla_history_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_sla_history_append_only BEFORE DELETE OR UPDATE ON public.crm_sla_history FOR EACH ROW EXECUTE FUNCTION public.crm_sla_history_append_only();


--
-- Name: crm_sla_instances crm_sla_instances_lead_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_sla_instances_lead_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_sla_instances FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_leads', 'lead_id');


--
-- Name: crm_sla_instances crm_sla_instances_owner_membership_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_sla_instances_owner_membership_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_sla_instances FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'owner_membership_id');


--
-- Name: crm_sla_instances crm_sla_instances_policy_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_sla_instances_policy_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_sla_instances FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_sla_policies', 'policy_id');


--
-- Name: crm_sla_instances crm_sla_instances_queue_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_sla_instances_queue_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_sla_instances FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_queues', 'queue_id');


--
-- Name: crm_stage_history crm_stage_history_from_stage_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_stage_history_from_stage_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_stage_history FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_pipeline_stages', 'from_stage_id');


--
-- Name: crm_stage_history crm_stage_history_opportunity_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_stage_history_opportunity_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_stage_history FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_opportunities', 'opportunity_id');


--
-- Name: crm_stage_history crm_stage_history_to_stage_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_stage_history_to_stage_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_stage_history FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_pipeline_stages', 'to_stage_id');


--
-- Name: crm_taxonomy_options crm_taxonomy_options_taxonomy_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_taxonomy_options_taxonomy_id_workspace_guard BEFORE INSERT OR UPDATE ON public.crm_taxonomy_options FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_taxonomies', 'taxonomy_id');


--
-- Name: customer_account_organizations customer_account_organization_limit_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customer_account_organization_limit_guard BEFORE INSERT ON public.customer_account_organizations FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_account_organization_limit();


--
-- Name: document_sequences document_sequences_legal_entity_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER document_sequences_legal_entity_workspace_guard BEFORE INSERT OR UPDATE ON public.document_sequences FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('legal_entities', 'legal_entity_id');


--
-- Name: hrms_calendars hrms_calendar_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hrms_calendar_immutable BEFORE DELETE OR UPDATE ON public.hrms_calendars FOR EACH ROW EXECUTE FUNCTION public.immutable_hrms_record();


--
-- Name: hrms_attendance_events hrms_evidence_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hrms_evidence_immutable BEFORE DELETE OR UPDATE ON public.hrms_attendance_events FOR EACH ROW EXECUTE FUNCTION public.immutable_hrms_record();


--
-- Name: hrms_sessions hrms_session_overlap; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER hrms_session_overlap BEFORE INSERT OR UPDATE ON public.hrms_sessions FOR EACH ROW EXECUTE FUNCTION public.guard_hrms_session_overlap();


--
-- Name: integration_connections integration_connections_legal_entity_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER integration_connections_legal_entity_workspace_guard BEFORE INSERT OR UPDATE ON public.integration_connections FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('legal_entities', 'legal_entity_id');


--
-- Name: integration_resources integration_resources_connection_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER integration_resources_connection_workspace_guard BEFORE INSERT OR UPDATE ON public.integration_resources FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('integration_connections', 'connection_id');


--
-- Name: invitation_roles invitation_roles_invitation_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invitation_roles_invitation_workspace_guard BEFORE INSERT OR UPDATE ON public.invitation_roles FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_invitations', 'invitation_id');


--
-- Name: invitation_roles invitation_roles_role_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invitation_roles_role_workspace_guard BEFORE INSERT OR UPDATE ON public.invitation_roles FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('roles', 'role_id');


--
-- Name: invitation_teams invitation_teams_invitation_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invitation_teams_invitation_workspace_guard BEFORE INSERT OR UPDATE ON public.invitation_teams FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_invitations', 'invitation_id');


--
-- Name: invitation_teams invitation_teams_team_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invitation_teams_team_workspace_guard BEFORE INSERT OR UPDATE ON public.invitation_teams FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_teams', 'team_id');


--
-- Name: member_roles member_roles_membership_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER member_roles_membership_workspace_guard BEFORE INSERT OR UPDATE ON public.member_roles FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'membership_id');


--
-- Name: member_roles member_roles_role_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER member_roles_role_workspace_guard BEFORE INSERT OR UPDATE ON public.member_roles FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('roles', 'role_id');


--
-- Name: notification_delivery_attempts notification_delivery_attempts_notification_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notification_delivery_attempts_notification_id_workspace_guard BEFORE INSERT OR UPDATE ON public.notification_delivery_attempts FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('notifications', 'notification_id');


--
-- Name: notifications notifications_policy_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notifications_policy_id_workspace_guard BEFORE INSERT OR UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('notification_policies', 'policy_id');


--
-- Name: notifications notifications_template_id_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notifications_template_id_workspace_guard BEFORE INSERT OR UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('notification_templates', 'template_id');


--
-- Name: organization_requests organization_request_account_link_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organization_request_account_link_guard BEFORE INSERT OR UPDATE ON public.organization_requests FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_request_account_links();


--
-- Name: platform_capability_flags platform_capability_flags_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER platform_capability_flags_set_updated_at BEFORE UPDATE ON public.platform_capability_flags FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: pre_project_cases pre_project_source_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pre_project_source_guard BEFORE INSERT OR UPDATE ON public.pre_project_cases FOR EACH ROW EXECUTE FUNCTION public.guard_pre_project_source();


--
-- Name: project_booking_history project_booking_history_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER project_booking_history_append_only BEFORE DELETE OR UPDATE ON public.project_booking_history FOR EACH ROW EXECUTE FUNCTION public.project_booking_history_append_only();


--
-- Name: project_bookings project_bookings_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER project_bookings_set_updated_at BEFORE UPDATE ON public.project_bookings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: project_resources project_resources_business_unit_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER project_resources_business_unit_workspace_guard BEFORE INSERT OR UPDATE ON public.project_resources FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('business_units', 'business_unit_id');


--
-- Name: project_resources project_resources_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER project_resources_set_updated_at BEFORE UPDATE ON public.project_resources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: project_resources project_resources_workspace_team_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER project_resources_workspace_team_guard BEFORE INSERT OR UPDATE ON public.project_resources FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_teams', 'workspace_team_id');


--
-- Name: role_permissions role_permissions_role_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER role_permissions_role_workspace_guard BEFORE INSERT OR UPDATE ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('roles', 'role_id');


--
-- Name: auth_mfa_challenges set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.auth_mfa_challenges FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: automation_approvals set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.automation_approvals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: automation_definitions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.automation_definitions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: automation_runs set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.automation_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: automation_waits set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.automation_waits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: business_units set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.business_units FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_activities set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_activities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_addresses set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_addresses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_appointments set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_appointments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_assignment_policies set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_assignment_policies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_assignment_rules set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_assignment_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_consents set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_consents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_contact_points set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_contact_points FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_conversations set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_custom_field_definitions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_custom_field_definitions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_custom_field_values set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_custom_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_enquiries set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_enquiries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_identity_candidates set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_identity_candidates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_intake_events set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_intake_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_leads set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_messages set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_messages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_opportunities set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_organization_profiles set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_organization_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_parties set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_parties FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_person_profiles set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_person_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_pipeline_stages set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_pipeline_stages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_pipelines set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_pipelines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_project_links set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_project_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_qualification_forms set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_qualification_forms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_qualification_questions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_qualification_questions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_queue_members set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_queue_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_queues set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_queues FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_relationships set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_relationships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_saved_views set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_saved_views FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_sequence_enrollments set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_sequence_enrollments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_sequence_steps set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_sequence_steps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_sequences set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_sequences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_sla_instances set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_sla_instances FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_sla_policies set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_sla_policies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_taxonomies set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_taxonomies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_taxonomy_options set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.crm_taxonomy_options FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customer_account_memberships set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.customer_account_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customer_accounts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.customer_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: device_endpoints set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.device_endpoints FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: document_sequences set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.document_sequences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: integration_connections set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.integration_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: integration_resources set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.integration_resources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: legal_entities set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.legal_entities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: local_auth_credentials set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.local_auth_credentials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mfa_enrollment_requirements set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.mfa_enrollment_requirements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: notification_policies set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.notification_policies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: notification_preferences set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: notification_templates set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.notification_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: notifications set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organization_requests set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.organization_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: platform_administrators set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.platform_administrators FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: project_workflow_templates set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.project_workflow_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: roles set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sync_cursors set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sync_cursors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tax_profiles set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tax_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tenant_login_branding set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tenant_login_branding FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tenant_operation_runs set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tenant_operation_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_identities set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.user_identities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_mfa_credentials set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.user_mfa_credentials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspace_brand_assets set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspace_brand_assets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspace_data_policies set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspace_data_policies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspace_entitlement_sets set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspace_entitlement_sets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspace_invitations set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspace_invitations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspace_memberships set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspace_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspace_onboarding set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspace_onboarding FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspace_stored_objects set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspace_stored_objects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspace_subscriptions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspace_subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: workspaces set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sync_cursors sync_cursors_connection_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_cursors_connection_workspace_guard BEFORE INSERT OR UPDATE ON public.sync_cursors FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('integration_connections', 'connection_id');


--
-- Name: sync_cursors sync_cursors_resource_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_cursors_resource_workspace_guard BEFORE INSERT OR UPDATE ON public.sync_cursors FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('integration_resources', 'resource_id');


--
-- Name: tax_profiles tax_profiles_legal_entity_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tax_profiles_legal_entity_workspace_guard BEFORE INSERT OR UPDATE ON public.tax_profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('legal_entities', 'legal_entity_id');


--
-- Name: tenant_lifecycle_versions tenant_lifecycle_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tenant_lifecycle_append_only BEFORE DELETE OR UPDATE ON public.tenant_lifecycle_versions FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_lifecycle_mutation();


--
-- Name: webhook_inbox webhook_inbox_connection_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER webhook_inbox_connection_workspace_guard BEFORE INSERT OR UPDATE ON public.webhook_inbox FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('integration_connections', 'connection_id');


--
-- Name: workspace_memberships workspace_member_customer_account_membership; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_member_customer_account_membership AFTER INSERT OR UPDATE OF status, user_id, workspace_id ON public.workspace_memberships FOR EACH ROW EXECUTE FUNCTION public.ensure_customer_account_membership_for_workspace_member();


--
-- Name: workspace_team_members workspace_team_members_membership_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_team_members_membership_workspace_guard BEFORE INSERT OR UPDATE ON public.workspace_team_members FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_memberships', 'membership_id');


--
-- Name: workspace_team_members workspace_team_members_team_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_team_members_team_workspace_guard BEFORE INSERT OR UPDATE ON public.workspace_team_members FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_teams', 'team_id');


--
-- Name: workspace_team_queue_settings workspace_team_queue_settings_queue_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_team_queue_settings_queue_workspace_guard BEFORE INSERT OR UPDATE ON public.workspace_team_queue_settings FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('crm_queues', 'queue_id');


--
-- Name: workspace_team_queue_settings workspace_team_queue_settings_team_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_team_queue_settings_team_workspace_guard BEFORE INSERT OR UPDATE ON public.workspace_team_queue_settings FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_teams', 'team_id');


--
-- Name: workspace_team_roles workspace_team_roles_role_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_team_roles_role_workspace_guard BEFORE INSERT OR UPDATE ON public.workspace_team_roles FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('roles', 'role_id');


--
-- Name: workspace_team_roles workspace_team_roles_team_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_team_roles_team_workspace_guard BEFORE INSERT OR UPDATE ON public.workspace_team_roles FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('workspace_teams', 'team_id');


--
-- Name: workspace_teams workspace_teams_business_unit_workspace_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_teams_business_unit_workspace_guard BEFORE INSERT OR UPDATE ON public.workspace_teams FOR EACH ROW EXECUTE FUNCTION public.enforce_same_workspace_reference('business_units', 'business_unit_id');


--
-- Name: workspace_teams workspace_teams_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_teams_set_updated_at BEFORE UPDATE ON public.workspace_teams FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: account_billing_document_events account_billing_document_events_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_billing_document_events
    ADD CONSTRAINT account_billing_document_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.customer_accounts(id) ON DELETE CASCADE;


--
-- Name: account_billing_document_events account_billing_document_events_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_billing_document_events
    ADD CONSTRAINT account_billing_document_events_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.account_billing_documents(id) ON DELETE CASCADE;


--
-- Name: account_billing_document_events account_billing_document_events_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_billing_document_events
    ADD CONSTRAINT account_billing_document_events_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: account_billing_documents account_billing_documents_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_billing_documents
    ADD CONSTRAINT account_billing_documents_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.customer_accounts(id) ON DELETE CASCADE;


--
-- Name: account_collection_state_versions account_collection_state_versions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_collection_state_versions
    ADD CONSTRAINT account_collection_state_versions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.customer_accounts(id) ON DELETE CASCADE;


--
-- Name: account_collection_state_versions account_collection_state_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_collection_state_versions
    ADD CONSTRAINT account_collection_state_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: account_contract_versions account_contract_versions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_contract_versions
    ADD CONSTRAINT account_contract_versions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.customer_accounts(id) ON DELETE CASCADE;


--
-- Name: account_contract_versions account_contract_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_contract_versions
    ADD CONSTRAINT account_contract_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: account_entitlement_versions account_entitlement_versions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_entitlement_versions
    ADD CONSTRAINT account_entitlement_versions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.customer_accounts(id) ON DELETE CASCADE;


--
-- Name: account_entitlement_versions account_entitlement_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_entitlement_versions
    ADD CONSTRAINT account_entitlement_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: account_entitlement_versions account_entitlement_versions_plan_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_entitlement_versions
    ADD CONSTRAINT account_entitlement_versions_plan_fk FOREIGN KEY (plan_kind, plan_code, plan_version) REFERENCES public.tenant_setup_profiles(kind, code, version) ON DELETE RESTRICT;


--
-- Name: account_usage_snapshots account_usage_snapshots_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_usage_snapshots
    ADD CONSTRAINT account_usage_snapshots_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.customer_accounts(id) ON DELETE CASCADE;


--
-- Name: account_usage_snapshots account_usage_snapshots_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_usage_snapshots
    ADD CONSTRAINT account_usage_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: ai_suggestion_decisions ai_suggestion_decisions_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_suggestion_decisions
    ADD CONSTRAINT ai_suggestion_decisions_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: ai_suggestion_decisions ai_suggestion_decisions_workspace_id_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_suggestion_decisions
    ADD CONSTRAINT ai_suggestion_decisions_workspace_id_suggestion_id_fkey FOREIGN KEY (workspace_id, suggestion_id) REFERENCES public.ai_suggestions(workspace_id, id) ON DELETE CASCADE;


--
-- Name: ai_suggestions ai_suggestions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_suggestions
    ADD CONSTRAINT ai_suggestions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: ai_suggestions ai_suggestions_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_suggestions
    ADD CONSTRAINT ai_suggestions_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id);


--
-- Name: ai_suggestions ai_suggestions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_suggestions
    ADD CONSTRAINT ai_suggestions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: pre_project_asset_markups asset_markup_generated_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_asset_markups
    ADD CONSTRAINT asset_markup_generated_fk FOREIGN KEY (workspace_id, case_id, asset_id) REFERENCES public.pre_project_brief_assets(workspace_id, case_id, id);


--
-- Name: pre_project_asset_markups asset_markup_source_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_asset_markups
    ADD CONSTRAINT asset_markup_source_fk FOREIGN KEY (workspace_id, case_id, source_asset_id) REFERENCES public.pre_project_brief_assets(workspace_id, case_id, id);


--
-- Name: audit_events audit_events_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: audit_events audit_events_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: auth_mfa_challenges auth_mfa_challenges_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_challenges
    ADD CONSTRAINT auth_mfa_challenges_user_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: auth_mfa_challenges auth_mfa_challenges_workspace_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_mfa_challenges
    ADD CONSTRAINT auth_mfa_challenges_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: auth_refresh_sessions auth_refresh_sessions_replaced_by_session_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_refresh_sessions
    ADD CONSTRAINT auth_refresh_sessions_replaced_by_session_id_fk FOREIGN KEY (replaced_by_session_id) REFERENCES public.auth_refresh_sessions(id) ON DELETE SET NULL;


--
-- Name: auth_refresh_sessions auth_refresh_sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_refresh_sessions
    ADD CONSTRAINT auth_refresh_sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: automation_approvals automation_approvals_decided_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_approvals
    ADD CONSTRAINT automation_approvals_decided_by_users_id_fk FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: automation_approvals automation_approvals_requested_from_membership_id_workspace_mem; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_approvals
    ADD CONSTRAINT automation_approvals_requested_from_membership_id_workspace_mem FOREIGN KEY (requested_from_membership_id) REFERENCES public.workspace_memberships(id) ON DELETE SET NULL;


--
-- Name: automation_approvals automation_approvals_run_id_automation_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_approvals
    ADD CONSTRAINT automation_approvals_run_id_automation_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.automation_runs(id) ON DELETE CASCADE;


--
-- Name: automation_approvals automation_approvals_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_approvals
    ADD CONSTRAINT automation_approvals_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: automation_definitions automation_definitions_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_definitions
    ADD CONSTRAINT automation_definitions_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: automation_definitions automation_definitions_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_definitions
    ADD CONSTRAINT automation_definitions_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: automation_runs automation_runs_definition_id_automation_definitions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_definition_id_automation_definitions_id_fk FOREIGN KEY (definition_id) REFERENCES public.automation_definitions(id);


--
-- Name: automation_runs automation_runs_version_id_automation_versions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_version_id_automation_versions_id_fk FOREIGN KEY (version_id) REFERENCES public.automation_versions(id);


--
-- Name: automation_runs automation_runs_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: automation_step_runs automation_step_runs_run_id_automation_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_step_runs
    ADD CONSTRAINT automation_step_runs_run_id_automation_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.automation_runs(id) ON DELETE CASCADE;


--
-- Name: automation_step_runs automation_step_runs_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_step_runs
    ADD CONSTRAINT automation_step_runs_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: automation_versions automation_versions_definition_id_automation_definitions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_versions
    ADD CONSTRAINT automation_versions_definition_id_automation_definitions_id_fk FOREIGN KEY (definition_id) REFERENCES public.automation_definitions(id) ON DELETE CASCADE;


--
-- Name: automation_versions automation_versions_published_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_versions
    ADD CONSTRAINT automation_versions_published_by_users_id_fk FOREIGN KEY (published_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: automation_versions automation_versions_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_versions
    ADD CONSTRAINT automation_versions_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: automation_waits automation_waits_run_id_automation_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_waits
    ADD CONSTRAINT automation_waits_run_id_automation_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.automation_runs(id) ON DELETE CASCADE;


--
-- Name: automation_waits automation_waits_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_waits
    ADD CONSTRAINT automation_waits_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: business_units business_units_legal_entity_id_legal_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_units
    ADD CONSTRAINT business_units_legal_entity_id_legal_entities_id_fk FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE CASCADE;


--
-- Name: business_units business_units_parent_business_unit_id_business_units_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_units
    ADD CONSTRAINT business_units_parent_business_unit_id_business_units_id_fk FOREIGN KEY (parent_business_unit_id) REFERENCES public.business_units(id) ON DELETE SET NULL;


--
-- Name: business_units business_units_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_units
    ADD CONSTRAINT business_units_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: client_portal_challenges client_portal_challenges_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_challenges
    ADD CONSTRAINT client_portal_challenges_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: client_portal_grants client_portal_grants_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_grants
    ADD CONSTRAINT client_portal_grants_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: client_portal_grants client_portal_grants_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_grants
    ADD CONSTRAINT client_portal_grants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: client_portal_sessions client_portal_sessions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_sessions
    ADD CONSTRAINT client_portal_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: client_portal_settings client_portal_settings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_portal_settings
    ADD CONSTRAINT client_portal_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: commercial_cases commercial_cases_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_cases
    ADD CONSTRAINT commercial_cases_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: commercial_cases commercial_cases_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_cases
    ADD CONSTRAINT commercial_cases_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: commercial_payment_templates commercial_payment_templates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_payment_templates
    ADD CONSTRAINT commercial_payment_templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: commercial_quotation_templates commercial_quotation_templates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_quotation_templates
    ADD CONSTRAINT commercial_quotation_templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: commercial_reconciliation_jobs commercial_reconciliation_jobs_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_reconciliation_jobs
    ADD CONSTRAINT commercial_reconciliation_jobs_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id) ON DELETE CASCADE;


--
-- Name: commercial_reconciliation_jobs commercial_reconciliation_jobs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commercial_reconciliation_jobs
    ADD CONSTRAINT commercial_reconciliation_jobs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: crm_activities crm_activities_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_activities crm_activities_lead_id_crm_leads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_lead_id_crm_leads_id_fk FOREIGN KEY (lead_id) REFERENCES public.crm_leads(id) ON DELETE CASCADE;


--
-- Name: crm_activities crm_activities_opportunity_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_opportunity_fk FOREIGN KEY (opportunity_id) REFERENCES public.crm_opportunities(id) ON DELETE CASCADE;


--
-- Name: crm_activities crm_activities_owner_membership_id_workspace_memberships_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_owner_membership_id_workspace_memberships_id_fk FOREIGN KEY (owner_membership_id) REFERENCES public.workspace_memberships(id) ON DELETE SET NULL;


--
-- Name: crm_activities crm_activities_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_party_id_crm_parties_id_fk FOREIGN KEY (party_id) REFERENCES public.crm_parties(id) ON DELETE SET NULL;


--
-- Name: crm_activities crm_activities_sla_instance_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_sla_instance_fk FOREIGN KEY (workspace_id, sla_instance_id) REFERENCES public.crm_sla_instances(workspace_id, id) ON DELETE RESTRICT;


--
-- Name: crm_activities crm_activities_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_addresses crm_addresses_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_addresses
    ADD CONSTRAINT crm_addresses_party_id_crm_parties_id_fk FOREIGN KEY (party_id) REFERENCES public.crm_parties(id) ON DELETE CASCADE;


--
-- Name: crm_addresses crm_addresses_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_addresses
    ADD CONSTRAINT crm_addresses_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_appointments crm_appointments_activity_id_crm_activities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_appointments
    ADD CONSTRAINT crm_appointments_activity_id_crm_activities_id_fk FOREIGN KEY (activity_id) REFERENCES public.crm_activities(id) ON DELETE CASCADE;


--
-- Name: crm_appointments crm_appointments_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_appointments
    ADD CONSTRAINT crm_appointments_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_assignment_history crm_assignment_history_assigned_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_history
    ADD CONSTRAINT crm_assignment_history_assigned_by_users_id_fk FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_assignment_history crm_assignment_history_lead_id_crm_leads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_history
    ADD CONSTRAINT crm_assignment_history_lead_id_crm_leads_id_fk FOREIGN KEY (lead_id) REFERENCES public.crm_leads(id) ON DELETE CASCADE;


--
-- Name: crm_assignment_history crm_assignment_history_owner_membership_id_workspace_membership; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_history
    ADD CONSTRAINT crm_assignment_history_owner_membership_id_workspace_membership FOREIGN KEY (owner_membership_id) REFERENCES public.workspace_memberships(id) ON DELETE SET NULL;


--
-- Name: crm_assignment_history crm_assignment_history_previous_owner_membership_id_workspace_m; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_history
    ADD CONSTRAINT crm_assignment_history_previous_owner_membership_id_workspace_m FOREIGN KEY (previous_owner_membership_id) REFERENCES public.workspace_memberships(id) ON DELETE SET NULL;


--
-- Name: crm_assignment_history crm_assignment_history_queue_id_crm_queues_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_history
    ADD CONSTRAINT crm_assignment_history_queue_id_crm_queues_id_fk FOREIGN KEY (queue_id) REFERENCES public.crm_queues(id) ON DELETE SET NULL;


--
-- Name: crm_assignment_history crm_assignment_history_rule_id_crm_assignment_rules_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_history
    ADD CONSTRAINT crm_assignment_history_rule_id_crm_assignment_rules_id_fk FOREIGN KEY (rule_id) REFERENCES public.crm_assignment_rules(id) ON DELETE SET NULL;


--
-- Name: crm_assignment_history crm_assignment_history_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_history
    ADD CONSTRAINT crm_assignment_history_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_assignment_policies crm_assignment_policies_fallback_queue_id_crm_queues_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_policies
    ADD CONSTRAINT crm_assignment_policies_fallback_queue_id_crm_queues_id_fk FOREIGN KEY (fallback_queue_id) REFERENCES public.crm_queues(id) ON DELETE SET NULL;


--
-- Name: crm_assignment_policies crm_assignment_policies_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_policies
    ADD CONSTRAINT crm_assignment_policies_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_assignment_rules crm_assignment_rules_policy_id_crm_assignment_policies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_rules
    ADD CONSTRAINT crm_assignment_rules_policy_id_crm_assignment_policies_id_fk FOREIGN KEY (policy_id) REFERENCES public.crm_assignment_policies(id) ON DELETE CASCADE;


--
-- Name: crm_assignment_rules crm_assignment_rules_queue_id_crm_queues_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_rules
    ADD CONSTRAINT crm_assignment_rules_queue_id_crm_queues_id_fk FOREIGN KEY (queue_id) REFERENCES public.crm_queues(id);


--
-- Name: crm_assignment_rules crm_assignment_rules_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_assignment_rules
    ADD CONSTRAINT crm_assignment_rules_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_attribution_touches crm_attribution_touches_enquiry_id_crm_enquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_attribution_touches
    ADD CONSTRAINT crm_attribution_touches_enquiry_id_crm_enquiries_id_fk FOREIGN KEY (enquiry_id) REFERENCES public.crm_enquiries(id) ON DELETE CASCADE;


--
-- Name: crm_attribution_touches crm_attribution_touches_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_attribution_touches
    ADD CONSTRAINT crm_attribution_touches_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_consents crm_consents_legal_entity_id_legal_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consents
    ADD CONSTRAINT crm_consents_legal_entity_id_legal_entities_id_fk FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE SET NULL;


--
-- Name: crm_consents crm_consents_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consents
    ADD CONSTRAINT crm_consents_party_id_crm_parties_id_fk FOREIGN KEY (party_id) REFERENCES public.crm_parties(id) ON DELETE CASCADE;


--
-- Name: crm_consents crm_consents_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_consents
    ADD CONSTRAINT crm_consents_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_contact_points crm_contact_points_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contact_points
    ADD CONSTRAINT crm_contact_points_party_id_crm_parties_id_fk FOREIGN KEY (party_id) REFERENCES public.crm_parties(id) ON DELETE CASCADE;


--
-- Name: crm_contact_points crm_contact_points_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contact_points
    ADD CONSTRAINT crm_contact_points_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_conversation_participants crm_conversation_participants_conversation_id_crm_conversations; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_conversation_participants
    ADD CONSTRAINT crm_conversation_participants_conversation_id_crm_conversations FOREIGN KEY (conversation_id) REFERENCES public.crm_conversations(id) ON DELETE CASCADE;


--
-- Name: crm_conversation_participants crm_conversation_participants_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_conversation_participants
    ADD CONSTRAINT crm_conversation_participants_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_conversations crm_conversations_lead_id_crm_leads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_conversations
    ADD CONSTRAINT crm_conversations_lead_id_crm_leads_id_fk FOREIGN KEY (lead_id) REFERENCES public.crm_leads(id) ON DELETE SET NULL;


--
-- Name: crm_conversations crm_conversations_owner_membership_id_workspace_memberships_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_conversations
    ADD CONSTRAINT crm_conversations_owner_membership_id_workspace_memberships_id_ FOREIGN KEY (owner_membership_id) REFERENCES public.workspace_memberships(id) ON DELETE SET NULL;


--
-- Name: crm_conversations crm_conversations_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_conversations
    ADD CONSTRAINT crm_conversations_party_id_crm_parties_id_fk FOREIGN KEY (party_id) REFERENCES public.crm_parties(id) ON DELETE SET NULL;


--
-- Name: crm_conversations crm_conversations_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_conversations
    ADD CONSTRAINT crm_conversations_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_custom_field_definitions crm_custom_field_definitions_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_custom_field_definitions
    ADD CONSTRAINT crm_custom_field_definitions_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_custom_field_values crm_custom_field_values_definition_id_crm_custom_field_definiti; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_custom_field_values
    ADD CONSTRAINT crm_custom_field_values_definition_id_crm_custom_field_definiti FOREIGN KEY (definition_id) REFERENCES public.crm_custom_field_definitions(id) ON DELETE CASCADE;


--
-- Name: crm_custom_field_values crm_custom_field_values_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_custom_field_values
    ADD CONSTRAINT crm_custom_field_values_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_enquiries crm_enquiries_intake_event_id_crm_intake_events_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_enquiries
    ADD CONSTRAINT crm_enquiries_intake_event_id_crm_intake_events_id_fk FOREIGN KEY (intake_event_id) REFERENCES public.crm_intake_events(id);


--
-- Name: crm_enquiries crm_enquiries_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_enquiries
    ADD CONSTRAINT crm_enquiries_party_id_crm_parties_id_fk FOREIGN KEY (party_id) REFERENCES public.crm_parties(id);


--
-- Name: crm_enquiries crm_enquiries_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_enquiries
    ADD CONSTRAINT crm_enquiries_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_enquiry_counters crm_enquiry_counters_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_enquiry_counters
    ADD CONSTRAINT crm_enquiry_counters_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_forecast_snapshots crm_forecast_snapshots_opportunity_id_crm_opportunities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_forecast_snapshots
    ADD CONSTRAINT crm_forecast_snapshots_opportunity_id_crm_opportunities_id_fk FOREIGN KEY (opportunity_id) REFERENCES public.crm_opportunities(id) ON DELETE CASCADE;


--
-- Name: crm_forecast_snapshots crm_forecast_snapshots_owner_membership_id_workspace_membership; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_forecast_snapshots
    ADD CONSTRAINT crm_forecast_snapshots_owner_membership_id_workspace_membership FOREIGN KEY (owner_membership_id) REFERENCES public.workspace_memberships(id) ON DELETE SET NULL;


--
-- Name: crm_forecast_snapshots crm_forecast_snapshots_stage_id_crm_pipeline_stages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_forecast_snapshots
    ADD CONSTRAINT crm_forecast_snapshots_stage_id_crm_pipeline_stages_id_fk FOREIGN KEY (stage_id) REFERENCES public.crm_pipeline_stages(id) ON DELETE SET NULL;


--
-- Name: crm_forecast_snapshots crm_forecast_snapshots_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_forecast_snapshots
    ADD CONSTRAINT crm_forecast_snapshots_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_identity_candidates crm_identity_candidates_candidate_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_identity_candidates
    ADD CONSTRAINT crm_identity_candidates_candidate_party_id_crm_parties_id_fk FOREIGN KEY (candidate_party_id) REFERENCES public.crm_parties(id) ON DELETE CASCADE;


--
-- Name: crm_identity_candidates crm_identity_candidates_intake_event_id_crm_intake_events_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_identity_candidates
    ADD CONSTRAINT crm_identity_candidates_intake_event_id_crm_intake_events_id_fk FOREIGN KEY (intake_event_id) REFERENCES public.crm_intake_events(id) ON DELETE CASCADE;


--
-- Name: crm_identity_candidates crm_identity_candidates_resolved_party_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_identity_candidates
    ADD CONSTRAINT crm_identity_candidates_resolved_party_id_fkey FOREIGN KEY (resolved_party_id) REFERENCES public.crm_parties(id) ON DELETE RESTRICT;


--
-- Name: crm_identity_candidates crm_identity_candidates_reviewed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_identity_candidates
    ADD CONSTRAINT crm_identity_candidates_reviewed_by_users_id_fk FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_identity_candidates crm_identity_candidates_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_identity_candidates
    ADD CONSTRAINT crm_identity_candidates_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_intake_events crm_intake_events_business_unit_id_business_units_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_intake_events
    ADD CONSTRAINT crm_intake_events_business_unit_id_business_units_id_fk FOREIGN KEY (business_unit_id) REFERENCES public.business_units(id) ON DELETE SET NULL;


--
-- Name: crm_intake_events crm_intake_events_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_intake_events
    ADD CONSTRAINT crm_intake_events_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_intake_events crm_intake_events_legal_entity_id_legal_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_intake_events
    ADD CONSTRAINT crm_intake_events_legal_entity_id_legal_entities_id_fk FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE SET NULL;


--
-- Name: crm_intake_events crm_intake_events_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_intake_events
    ADD CONSTRAINT crm_intake_events_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_intake_events crm_intake_events_resolved_party_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_intake_events
    ADD CONSTRAINT crm_intake_events_resolved_party_id_fkey FOREIGN KEY (resolved_party_id) REFERENCES public.crm_parties(id) ON DELETE RESTRICT;


--
-- Name: crm_intake_events crm_intake_events_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_intake_events
    ADD CONSTRAINT crm_intake_events_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_lead_forms crm_lead_forms_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_lead_forms
    ADD CONSTRAINT crm_lead_forms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: crm_lead_forms crm_lead_forms_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_lead_forms
    ADD CONSTRAINT crm_lead_forms_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_lead_qualification_values crm_lead_qualification_values_captured_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_lead_qualification_values
    ADD CONSTRAINT crm_lead_qualification_values_captured_by_users_id_fk FOREIGN KEY (captured_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_lead_qualification_values crm_lead_qualification_values_lead_id_crm_leads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_lead_qualification_values
    ADD CONSTRAINT crm_lead_qualification_values_lead_id_crm_leads_id_fk FOREIGN KEY (lead_id) REFERENCES public.crm_leads(id) ON DELETE CASCADE;


--
-- Name: crm_lead_qualification_values crm_lead_qualification_values_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_lead_qualification_values
    ADD CONSTRAINT crm_lead_qualification_values_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_leads crm_leads_enquiry_id_crm_enquiries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_leads
    ADD CONSTRAINT crm_leads_enquiry_id_crm_enquiries_id_fk FOREIGN KEY (enquiry_id) REFERENCES public.crm_enquiries(id);


--
-- Name: crm_leads crm_leads_owner_membership_id_workspace_memberships_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_leads
    ADD CONSTRAINT crm_leads_owner_membership_id_workspace_memberships_id_fk FOREIGN KEY (owner_membership_id) REFERENCES public.workspace_memberships(id) ON DELETE SET NULL;


--
-- Name: crm_leads crm_leads_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_leads
    ADD CONSTRAINT crm_leads_party_id_crm_parties_id_fk FOREIGN KEY (party_id) REFERENCES public.crm_parties(id);


--
-- Name: crm_leads crm_leads_qualified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_leads
    ADD CONSTRAINT crm_leads_qualified_by_fkey FOREIGN KEY (qualified_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_leads crm_leads_queue_id_crm_queues_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_leads
    ADD CONSTRAINT crm_leads_queue_id_crm_queues_id_fk FOREIGN KEY (queue_id) REFERENCES public.crm_queues(id) ON DELETE SET NULL;


--
-- Name: crm_leads crm_leads_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_leads
    ADD CONSTRAINT crm_leads_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_merge_operations crm_merge_operations_merged_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_merge_operations
    ADD CONSTRAINT crm_merge_operations_merged_party_id_crm_parties_id_fk FOREIGN KEY (merged_party_id) REFERENCES public.crm_parties(id);


--
-- Name: crm_merge_operations crm_merge_operations_performed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_merge_operations
    ADD CONSTRAINT crm_merge_operations_performed_by_users_id_fk FOREIGN KEY (performed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_merge_operations crm_merge_operations_reversed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_merge_operations
    ADD CONSTRAINT crm_merge_operations_reversed_by_users_id_fk FOREIGN KEY (reversed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_merge_operations crm_merge_operations_survivor_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_merge_operations
    ADD CONSTRAINT crm_merge_operations_survivor_party_id_crm_parties_id_fk FOREIGN KEY (survivor_party_id) REFERENCES public.crm_parties(id);


--
-- Name: crm_merge_operations crm_merge_operations_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_merge_operations
    ADD CONSTRAINT crm_merge_operations_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_message_attachments crm_message_attachments_message_id_crm_messages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_message_attachments
    ADD CONSTRAINT crm_message_attachments_message_id_crm_messages_id_fk FOREIGN KEY (message_id) REFERENCES public.crm_messages(id) ON DELETE CASCADE;


--
-- Name: crm_message_attachments crm_message_attachments_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_message_attachments
    ADD CONSTRAINT crm_message_attachments_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_messages crm_messages_conversation_id_crm_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_messages
    ADD CONSTRAINT crm_messages_conversation_id_crm_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.crm_conversations(id) ON DELETE CASCADE;


--
-- Name: crm_messages crm_messages_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_messages
    ADD CONSTRAINT crm_messages_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_opportunities crm_opportunities_business_unit_id_business_units_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_business_unit_id_business_units_id_fk FOREIGN KEY (business_unit_id) REFERENCES public.business_units(id) ON DELETE SET NULL;


--
-- Name: crm_opportunities crm_opportunities_converted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_converted_by_fkey FOREIGN KEY (converted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_opportunities crm_opportunities_currency_code_currencies_code_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_currency_code_currencies_code_fk FOREIGN KEY (currency_code) REFERENCES public.currencies(code);


--
-- Name: crm_opportunities crm_opportunities_lead_id_crm_leads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_lead_id_crm_leads_id_fk FOREIGN KEY (lead_id) REFERENCES public.crm_leads(id) ON DELETE SET NULL;


--
-- Name: crm_opportunities crm_opportunities_legal_entity_id_legal_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_legal_entity_id_legal_entities_id_fk FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE SET NULL;


--
-- Name: crm_opportunities crm_opportunities_owner_membership_id_workspace_memberships_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_owner_membership_id_workspace_memberships_id_ FOREIGN KEY (owner_membership_id) REFERENCES public.workspace_memberships(id) ON DELETE SET NULL;


--
-- Name: crm_opportunities crm_opportunities_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_party_id_crm_parties_id_fk FOREIGN KEY (party_id) REFERENCES public.crm_parties(id);


--
-- Name: crm_opportunities crm_opportunities_pipeline_id_crm_pipelines_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_pipeline_id_crm_pipelines_id_fk FOREIGN KEY (pipeline_id) REFERENCES public.crm_pipelines(id);


--
-- Name: crm_opportunities crm_opportunities_reporting_currency_code_currencies_code_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_reporting_currency_code_currencies_code_fk FOREIGN KEY (reporting_currency_code) REFERENCES public.currencies(code);


--
-- Name: crm_opportunities crm_opportunities_stage_id_crm_pipeline_stages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_stage_id_crm_pipeline_stages_id_fk FOREIGN KEY (stage_id) REFERENCES public.crm_pipeline_stages(id);


--
-- Name: crm_opportunities crm_opportunities_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_opportunity_counters crm_opportunity_counters_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunity_counters
    ADD CONSTRAINT crm_opportunity_counters_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_opportunity_stakeholders crm_opportunity_stakeholders_opportunity_id_crm_opportunities_i; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunity_stakeholders
    ADD CONSTRAINT crm_opportunity_stakeholders_opportunity_id_crm_opportunities_i FOREIGN KEY (opportunity_id) REFERENCES public.crm_opportunities(id) ON DELETE CASCADE;


--
-- Name: crm_opportunity_stakeholders crm_opportunity_stakeholders_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunity_stakeholders
    ADD CONSTRAINT crm_opportunity_stakeholders_party_id_crm_parties_id_fk FOREIGN KEY (party_id) REFERENCES public.crm_parties(id);


--
-- Name: crm_opportunity_stakeholders crm_opportunity_stakeholders_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunity_stakeholders
    ADD CONSTRAINT crm_opportunity_stakeholders_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_opportunity_team crm_opportunity_team_membership_id_workspace_memberships_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunity_team
    ADD CONSTRAINT crm_opportunity_team_membership_id_workspace_memberships_id_fk FOREIGN KEY (membership_id) REFERENCES public.workspace_memberships(id) ON DELETE CASCADE;


--
-- Name: crm_opportunity_team crm_opportunity_team_opportunity_id_crm_opportunities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunity_team
    ADD CONSTRAINT crm_opportunity_team_opportunity_id_crm_opportunities_id_fk FOREIGN KEY (opportunity_id) REFERENCES public.crm_opportunities(id) ON DELETE CASCADE;


--
-- Name: crm_opportunity_team crm_opportunity_team_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunity_team
    ADD CONSTRAINT crm_opportunity_team_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_organization_profiles crm_organization_profiles_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_organization_profiles
    ADD CONSTRAINT crm_organization_profiles_party_id_crm_parties_id_fk FOREIGN KEY (party_id) REFERENCES public.crm_parties(id) ON DELETE CASCADE;


--
-- Name: crm_organization_profiles crm_organization_profiles_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_organization_profiles
    ADD CONSTRAINT crm_organization_profiles_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_parties crm_parties_business_unit_id_business_units_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_parties
    ADD CONSTRAINT crm_parties_business_unit_id_business_units_id_fk FOREIGN KEY (business_unit_id) REFERENCES public.business_units(id) ON DELETE SET NULL;


--
-- Name: crm_parties crm_parties_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_parties
    ADD CONSTRAINT crm_parties_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_parties crm_parties_legal_entity_id_legal_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_parties
    ADD CONSTRAINT crm_parties_legal_entity_id_legal_entities_id_fk FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE SET NULL;


--
-- Name: crm_parties crm_parties_merged_into_party_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_parties
    ADD CONSTRAINT crm_parties_merged_into_party_fk FOREIGN KEY (merged_into_party_id) REFERENCES public.crm_parties(id) ON DELETE RESTRICT;


--
-- Name: crm_parties crm_parties_owner_membership_id_workspace_memberships_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_parties
    ADD CONSTRAINT crm_parties_owner_membership_id_workspace_memberships_id_fk FOREIGN KEY (owner_membership_id) REFERENCES public.workspace_memberships(id) ON DELETE SET NULL;


--
-- Name: crm_parties crm_parties_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_parties
    ADD CONSTRAINT crm_parties_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_person_profiles crm_person_profiles_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_person_profiles
    ADD CONSTRAINT crm_person_profiles_party_id_crm_parties_id_fk FOREIGN KEY (party_id) REFERENCES public.crm_parties(id) ON DELETE CASCADE;


--
-- Name: crm_person_profiles crm_person_profiles_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_person_profiles
    ADD CONSTRAINT crm_person_profiles_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_pipeline_stages crm_pipeline_stages_pipeline_id_crm_pipelines_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pipeline_stages
    ADD CONSTRAINT crm_pipeline_stages_pipeline_id_crm_pipelines_id_fk FOREIGN KEY (pipeline_id) REFERENCES public.crm_pipelines(id) ON DELETE CASCADE;


--
-- Name: crm_pipeline_stages crm_pipeline_stages_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pipeline_stages
    ADD CONSTRAINT crm_pipeline_stages_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_pipelines crm_pipelines_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pipelines
    ADD CONSTRAINT crm_pipelines_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_project_links crm_project_links_opportunity_id_crm_opportunities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_project_links
    ADD CONSTRAINT crm_project_links_opportunity_id_crm_opportunities_id_fk FOREIGN KEY (opportunity_id) REFERENCES public.crm_opportunities(id) ON DELETE CASCADE;


--
-- Name: crm_project_links crm_project_links_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_project_links
    ADD CONSTRAINT crm_project_links_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_qualification_forms crm_qualification_forms_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_qualification_forms
    ADD CONSTRAINT crm_qualification_forms_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_qualification_questions crm_qualification_questions_form_id_crm_qualification_forms_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_qualification_questions
    ADD CONSTRAINT crm_qualification_questions_form_id_crm_qualification_forms_id_ FOREIGN KEY (form_id) REFERENCES public.crm_qualification_forms(id) ON DELETE CASCADE;


--
-- Name: crm_qualification_questions crm_qualification_questions_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_qualification_questions
    ADD CONSTRAINT crm_qualification_questions_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_queue_members crm_queue_members_membership_id_workspace_memberships_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_queue_members
    ADD CONSTRAINT crm_queue_members_membership_id_workspace_memberships_id_fk FOREIGN KEY (membership_id) REFERENCES public.workspace_memberships(id) ON DELETE CASCADE;


--
-- Name: crm_queue_members crm_queue_members_queue_id_crm_queues_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_queue_members
    ADD CONSTRAINT crm_queue_members_queue_id_crm_queues_id_fk FOREIGN KEY (queue_id) REFERENCES public.crm_queues(id) ON DELETE CASCADE;


--
-- Name: crm_queue_members crm_queue_members_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_queue_members
    ADD CONSTRAINT crm_queue_members_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_queues crm_queues_business_unit_id_business_units_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_queues
    ADD CONSTRAINT crm_queues_business_unit_id_business_units_id_fk FOREIGN KEY (business_unit_id) REFERENCES public.business_units(id) ON DELETE SET NULL;


--
-- Name: crm_queues crm_queues_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_queues
    ADD CONSTRAINT crm_queues_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_relationships crm_relationships_from_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_relationships
    ADD CONSTRAINT crm_relationships_from_party_id_crm_parties_id_fk FOREIGN KEY (from_party_id) REFERENCES public.crm_parties(id) ON DELETE CASCADE;


--
-- Name: crm_relationships crm_relationships_to_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_relationships
    ADD CONSTRAINT crm_relationships_to_party_id_crm_parties_id_fk FOREIGN KEY (to_party_id) REFERENCES public.crm_parties(id) ON DELETE CASCADE;


--
-- Name: crm_relationships crm_relationships_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_relationships
    ADD CONSTRAINT crm_relationships_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_saved_views crm_saved_views_owner_membership_id_workspace_memberships_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_saved_views
    ADD CONSTRAINT crm_saved_views_owner_membership_id_workspace_memberships_id_fk FOREIGN KEY (owner_membership_id) REFERENCES public.workspace_memberships(id) ON DELETE CASCADE;


--
-- Name: crm_saved_views crm_saved_views_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_saved_views
    ADD CONSTRAINT crm_saved_views_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_sequence_enrollments crm_sequence_enrollments_enrolled_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sequence_enrollments
    ADD CONSTRAINT crm_sequence_enrollments_enrolled_by_users_id_fk FOREIGN KEY (enrolled_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_sequence_enrollments crm_sequence_enrollments_lead_id_crm_leads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sequence_enrollments
    ADD CONSTRAINT crm_sequence_enrollments_lead_id_crm_leads_id_fk FOREIGN KEY (lead_id) REFERENCES public.crm_leads(id) ON DELETE SET NULL;


--
-- Name: crm_sequence_enrollments crm_sequence_enrollments_party_id_crm_parties_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sequence_enrollments
    ADD CONSTRAINT crm_sequence_enrollments_party_id_crm_parties_id_fk FOREIGN KEY (party_id) REFERENCES public.crm_parties(id);


--
-- Name: crm_sequence_enrollments crm_sequence_enrollments_sequence_id_crm_sequences_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sequence_enrollments
    ADD CONSTRAINT crm_sequence_enrollments_sequence_id_crm_sequences_id_fk FOREIGN KEY (sequence_id) REFERENCES public.crm_sequences(id);


--
-- Name: crm_sequence_enrollments crm_sequence_enrollments_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sequence_enrollments
    ADD CONSTRAINT crm_sequence_enrollments_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_sequence_steps crm_sequence_steps_sequence_id_crm_sequences_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sequence_steps
    ADD CONSTRAINT crm_sequence_steps_sequence_id_crm_sequences_id_fk FOREIGN KEY (sequence_id) REFERENCES public.crm_sequences(id) ON DELETE CASCADE;


--
-- Name: crm_sequence_steps crm_sequence_steps_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sequence_steps
    ADD CONSTRAINT crm_sequence_steps_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_sequences crm_sequences_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sequences
    ADD CONSTRAINT crm_sequences_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_sequences crm_sequences_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sequences
    ADD CONSTRAINT crm_sequences_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_sla_history crm_sla_history_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_history
    ADD CONSTRAINT crm_sla_history_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_sla_history crm_sla_history_instance_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_history
    ADD CONSTRAINT crm_sla_history_instance_fk FOREIGN KEY (workspace_id, instance_id) REFERENCES public.crm_sla_instances(workspace_id, id) ON DELETE RESTRICT;


--
-- Name: crm_sla_history crm_sla_history_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_history
    ADD CONSTRAINT crm_sla_history_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_sla_instances crm_sla_instances_lead_id_crm_leads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_instances
    ADD CONSTRAINT crm_sla_instances_lead_id_crm_leads_id_fk FOREIGN KEY (lead_id) REFERENCES public.crm_leads(id) ON DELETE CASCADE;


--
-- Name: crm_sla_instances crm_sla_instances_owner_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_instances
    ADD CONSTRAINT crm_sla_instances_owner_membership_id_fkey FOREIGN KEY (owner_membership_id) REFERENCES public.workspace_memberships(id) ON DELETE SET NULL;


--
-- Name: crm_sla_instances crm_sla_instances_policy_id_crm_sla_policies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_instances
    ADD CONSTRAINT crm_sla_instances_policy_id_crm_sla_policies_id_fk FOREIGN KEY (policy_id) REFERENCES public.crm_sla_policies(id);


--
-- Name: crm_sla_instances crm_sla_instances_queue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_instances
    ADD CONSTRAINT crm_sla_instances_queue_id_fkey FOREIGN KEY (queue_id) REFERENCES public.crm_queues(id) ON DELETE SET NULL;


--
-- Name: crm_sla_instances crm_sla_instances_response_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_instances
    ADD CONSTRAINT crm_sla_instances_response_actor_user_id_fkey FOREIGN KEY (response_actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_sla_instances crm_sla_instances_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_instances
    ADD CONSTRAINT crm_sla_instances_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_sla_policies crm_sla_policies_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sla_policies
    ADD CONSTRAINT crm_sla_policies_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_stage_history crm_stage_history_changed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_stage_history
    ADD CONSTRAINT crm_stage_history_changed_by_users_id_fk FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: crm_stage_history crm_stage_history_from_stage_id_crm_pipeline_stages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_stage_history
    ADD CONSTRAINT crm_stage_history_from_stage_id_crm_pipeline_stages_id_fk FOREIGN KEY (from_stage_id) REFERENCES public.crm_pipeline_stages(id) ON DELETE SET NULL;


--
-- Name: crm_stage_history crm_stage_history_opportunity_id_crm_opportunities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_stage_history
    ADD CONSTRAINT crm_stage_history_opportunity_id_crm_opportunities_id_fk FOREIGN KEY (opportunity_id) REFERENCES public.crm_opportunities(id) ON DELETE CASCADE;


--
-- Name: crm_stage_history crm_stage_history_to_stage_id_crm_pipeline_stages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_stage_history
    ADD CONSTRAINT crm_stage_history_to_stage_id_crm_pipeline_stages_id_fk FOREIGN KEY (to_stage_id) REFERENCES public.crm_pipeline_stages(id) ON DELETE SET NULL;


--
-- Name: crm_stage_history crm_stage_history_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_stage_history
    ADD CONSTRAINT crm_stage_history_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_taxonomies crm_taxonomies_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_taxonomies
    ADD CONSTRAINT crm_taxonomies_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_taxonomy_options crm_taxonomy_options_taxonomy_id_crm_taxonomies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_taxonomy_options
    ADD CONSTRAINT crm_taxonomy_options_taxonomy_id_crm_taxonomies_id_fk FOREIGN KEY (taxonomy_id) REFERENCES public.crm_taxonomies(id) ON DELETE CASCADE;


--
-- Name: crm_taxonomy_options crm_taxonomy_options_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_taxonomy_options
    ADD CONSTRAINT crm_taxonomy_options_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: customer_account_contracts customer_account_contracts_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_account_contracts
    ADD CONSTRAINT customer_account_contracts_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.customer_accounts(id) ON DELETE CASCADE;


--
-- Name: customer_account_memberships customer_account_memberships_account_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_account_memberships
    ADD CONSTRAINT customer_account_memberships_account_id_fk FOREIGN KEY (account_id) REFERENCES public.customer_accounts(id) ON DELETE CASCADE;


--
-- Name: customer_account_memberships customer_account_memberships_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_account_memberships
    ADD CONSTRAINT customer_account_memberships_user_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: customer_account_organizations customer_account_organizations_account_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_account_organizations
    ADD CONSTRAINT customer_account_organizations_account_id_fk FOREIGN KEY (account_id) REFERENCES public.customer_accounts(id) ON DELETE CASCADE;


--
-- Name: customer_account_organizations customer_account_organizations_workspace_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_account_organizations
    ADD CONSTRAINT customer_account_organizations_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: customer_accounts customer_accounts_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_accounts
    ADD CONSTRAINT customer_accounts_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: delivery_projects delivery_projects_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_projects
    ADD CONSTRAINT delivery_projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: delivery_projects delivery_projects_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_projects
    ADD CONSTRAINT delivery_projects_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: delivery_projects delivery_projects_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_projects
    ADD CONSTRAINT delivery_projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: device_endpoints device_endpoints_consent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_endpoints
    ADD CONSTRAINT device_endpoints_consent_id_fkey FOREIGN KEY (consent_id) REFERENCES public.notification_device_consents(id) ON DELETE SET NULL;


--
-- Name: device_endpoints device_endpoints_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_endpoints
    ADD CONSTRAINT device_endpoints_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: device_endpoints device_endpoints_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_endpoints
    ADD CONSTRAINT device_endpoints_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: document_sequences document_sequences_legal_entity_id_legal_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_sequences
    ADD CONSTRAINT document_sequences_legal_entity_id_legal_entities_id_fk FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE CASCADE;


--
-- Name: document_sequences document_sequences_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_sequences
    ADD CONSTRAINT document_sequences_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: exchange_rates exchange_rates_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT exchange_rates_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: exchange_rates exchange_rates_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT exchange_rates_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: hrms_attendance_events hrms_attendance_events_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_attendance_events
    ADD CONSTRAINT hrms_attendance_events_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: hrms_attendance_events hrms_attendance_events_workspace_id_membership_id_capture__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_attendance_events
    ADD CONSTRAINT hrms_attendance_events_workspace_id_membership_id_capture__fkey FOREIGN KEY (workspace_id, membership_id, capture_id) REFERENCES public.hrms_captures(workspace_id, membership_id, id);


--
-- Name: hrms_attendance_events hrms_attendance_events_workspace_id_membership_id_session__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_attendance_events
    ADD CONSTRAINT hrms_attendance_events_workspace_id_membership_id_session__fkey FOREIGN KEY (workspace_id, membership_id, session_id) REFERENCES public.hrms_sessions(workspace_id, membership_id, id);


--
-- Name: hrms_calendars hrms_calendars_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_calendars
    ADD CONSTRAINT hrms_calendars_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: hrms_captures hrms_captures_workspace_id_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_captures
    ADD CONSTRAINT hrms_captures_workspace_id_membership_id_fkey FOREIGN KEY (workspace_id, membership_id) REFERENCES public.hrms_employees(workspace_id, membership_id);


--
-- Name: hrms_employees hrms_employees_workspace_id_calendar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_employees
    ADD CONSTRAINT hrms_employees_workspace_id_calendar_id_fkey FOREIGN KEY (workspace_id, calendar_id) REFERENCES public.hrms_calendars(workspace_id, id);


--
-- Name: hrms_employees hrms_employees_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_employees
    ADD CONSTRAINT hrms_employees_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: hrms_employees hrms_employees_workspace_id_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_employees
    ADD CONSTRAINT hrms_employees_workspace_id_manager_id_fkey FOREIGN KEY (workspace_id, manager_id) REFERENCES public.workspace_memberships(workspace_id, id);


--
-- Name: hrms_employees hrms_employees_workspace_id_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_employees
    ADD CONSTRAINT hrms_employees_workspace_id_membership_id_fkey FOREIGN KEY (workspace_id, membership_id) REFERENCES public.workspace_memberships(workspace_id, id);


--
-- Name: hrms_leave_allowances hrms_leave_allowances_workspace_id_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_leave_allowances
    ADD CONSTRAINT hrms_leave_allowances_workspace_id_leave_type_id_fkey FOREIGN KEY (workspace_id, leave_type_id) REFERENCES public.hrms_leave_types(workspace_id, id);


--
-- Name: hrms_leave_allowances hrms_leave_allowances_workspace_id_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_leave_allowances
    ADD CONSTRAINT hrms_leave_allowances_workspace_id_membership_id_fkey FOREIGN KEY (workspace_id, membership_id) REFERENCES public.hrms_employees(workspace_id, membership_id);


--
-- Name: hrms_leave_requests hrms_leave_requests_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_leave_requests
    ADD CONSTRAINT hrms_leave_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id);


--
-- Name: hrms_leave_requests hrms_leave_requests_workspace_id_leave_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_leave_requests
    ADD CONSTRAINT hrms_leave_requests_workspace_id_leave_type_id_fkey FOREIGN KEY (workspace_id, leave_type_id) REFERENCES public.hrms_leave_types(workspace_id, id);


--
-- Name: hrms_leave_requests hrms_leave_requests_workspace_id_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_leave_requests
    ADD CONSTRAINT hrms_leave_requests_workspace_id_membership_id_fkey FOREIGN KEY (workspace_id, membership_id) REFERENCES public.hrms_employees(workspace_id, membership_id);


--
-- Name: hrms_leave_types hrms_leave_types_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_leave_types
    ADD CONSTRAINT hrms_leave_types_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: hrms_reviews hrms_reviews_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_reviews
    ADD CONSTRAINT hrms_reviews_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id);


--
-- Name: hrms_reviews hrms_reviews_workspace_id_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_reviews
    ADD CONSTRAINT hrms_reviews_workspace_id_event_id_fkey FOREIGN KEY (workspace_id, event_id) REFERENCES public.hrms_attendance_events(workspace_id, id);


--
-- Name: hrms_reviews hrms_reviews_workspace_id_membership_id_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_reviews
    ADD CONSTRAINT hrms_reviews_workspace_id_membership_id_session_id_fkey FOREIGN KEY (workspace_id, membership_id, session_id) REFERENCES public.hrms_sessions(workspace_id, membership_id, id);


--
-- Name: hrms_segments hrms_segments_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_segments
    ADD CONSTRAINT hrms_segments_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: hrms_segments hrms_segments_workspace_id_end_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_segments
    ADD CONSTRAINT hrms_segments_workspace_id_end_event_id_fkey FOREIGN KEY (workspace_id, end_event_id) REFERENCES public.hrms_attendance_events(workspace_id, id);


--
-- Name: hrms_segments hrms_segments_workspace_id_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_segments
    ADD CONSTRAINT hrms_segments_workspace_id_location_id_fkey FOREIGN KEY (workspace_id, location_id) REFERENCES public.work_locations(workspace_id, id);


--
-- Name: hrms_segments hrms_segments_workspace_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_segments
    ADD CONSTRAINT hrms_segments_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.delivery_projects(workspace_id, id);


--
-- Name: hrms_segments hrms_segments_workspace_id_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_segments
    ADD CONSTRAINT hrms_segments_workspace_id_session_id_fkey FOREIGN KEY (workspace_id, session_id) REFERENCES public.hrms_sessions(workspace_id, id);


--
-- Name: hrms_segments hrms_segments_workspace_id_start_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_segments
    ADD CONSTRAINT hrms_segments_workspace_id_start_event_id_fkey FOREIGN KEY (workspace_id, start_event_id) REFERENCES public.hrms_attendance_events(workspace_id, id);


--
-- Name: hrms_sessions hrms_sessions_workspace_id_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_sessions
    ADD CONSTRAINT hrms_sessions_workspace_id_membership_id_fkey FOREIGN KEY (workspace_id, membership_id) REFERENCES public.hrms_employees(workspace_id, membership_id);


--
-- Name: hrms_settings hrms_settings_workspace_id_default_calendar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_settings
    ADD CONSTRAINT hrms_settings_workspace_id_default_calendar_id_fkey FOREIGN KEY (workspace_id, default_calendar_id) REFERENCES public.hrms_calendars(workspace_id, id);


--
-- Name: hrms_settings hrms_settings_workspace_id_fallback_approver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_settings
    ADD CONSTRAINT hrms_settings_workspace_id_fallback_approver_id_fkey FOREIGN KEY (workspace_id, fallback_approver_id) REFERENCES public.workspace_memberships(workspace_id, id);


--
-- Name: hrms_settings hrms_settings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hrms_settings
    ADD CONSTRAINT hrms_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: idempotency_keys idempotency_keys_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: idempotency_keys idempotency_keys_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: integration_connections integration_connections_connected_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_connections
    ADD CONSTRAINT integration_connections_connected_by_users_id_fk FOREIGN KEY (connected_by) REFERENCES public.users(id);


--
-- Name: integration_connections integration_connections_legal_entity_id_legal_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_connections
    ADD CONSTRAINT integration_connections_legal_entity_id_legal_entities_id_fk FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE SET NULL;


--
-- Name: integration_connections integration_connections_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_connections
    ADD CONSTRAINT integration_connections_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: integration_resources integration_resources_connection_id_integration_connections_id_; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_resources
    ADD CONSTRAINT integration_resources_connection_id_integration_connections_id_ FOREIGN KEY (connection_id) REFERENCES public.integration_connections(id) ON DELETE CASCADE;


--
-- Name: integration_resources integration_resources_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_resources
    ADD CONSTRAINT integration_resources_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: invitation_roles invitation_roles_invitation_id_workspace_invitations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_roles
    ADD CONSTRAINT invitation_roles_invitation_id_workspace_invitations_id_fk FOREIGN KEY (invitation_id) REFERENCES public.workspace_invitations(id) ON DELETE CASCADE;


--
-- Name: invitation_roles invitation_roles_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_roles
    ADD CONSTRAINT invitation_roles_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: invitation_roles invitation_roles_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_roles
    ADD CONSTRAINT invitation_roles_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: invitation_teams invitation_teams_invitation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_teams
    ADD CONSTRAINT invitation_teams_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES public.workspace_invitations(id) ON DELETE CASCADE;


--
-- Name: invitation_teams invitation_teams_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_teams
    ADD CONSTRAINT invitation_teams_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.workspace_teams(id) ON DELETE CASCADE;


--
-- Name: invitation_teams invitation_teams_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitation_teams
    ADD CONSTRAINT invitation_teams_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: job_identities job_identities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identities
    ADD CONSTRAINT job_identities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_identities job_identities_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identities
    ADD CONSTRAINT job_identities_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: job_identity_link_events job_identity_link_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identity_link_events
    ADD CONSTRAINT job_identity_link_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: job_identity_link_events job_identity_link_events_workspace_id_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identity_link_events
    ADD CONSTRAINT job_identity_link_events_workspace_id_job_id_fkey FOREIGN KEY (workspace_id, job_id) REFERENCES public.job_identities(workspace_id, id) ON DELETE CASCADE;


--
-- Name: job_identity_link_events job_identity_link_events_workspace_id_link_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identity_link_events
    ADD CONSTRAINT job_identity_link_events_workspace_id_link_id_fkey FOREIGN KEY (workspace_id, link_id) REFERENCES public.job_identity_links(workspace_id, id) ON DELETE CASCADE;


--
-- Name: job_identity_links job_identity_links_workspace_id_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_identity_links
    ADD CONSTRAINT job_identity_links_workspace_id_job_id_fkey FOREIGN KEY (workspace_id, job_id) REFERENCES public.job_identities(workspace_id, id) ON DELETE CASCADE;


--
-- Name: job_manual_stage_events job_manual_stage_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_manual_stage_events
    ADD CONSTRAINT job_manual_stage_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: job_manual_stage_events job_manual_stage_events_workspace_id_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_manual_stage_events
    ADD CONSTRAINT job_manual_stage_events_workspace_id_job_id_fkey FOREIGN KEY (workspace_id, job_id) REFERENCES public.job_identities(workspace_id, id) ON DELETE CASCADE;


--
-- Name: job_manual_stages job_manual_stages_set_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_manual_stages
    ADD CONSTRAINT job_manual_stages_set_by_fkey FOREIGN KEY (set_by) REFERENCES public.users(id);


--
-- Name: job_manual_stages job_manual_stages_workspace_id_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_manual_stages
    ADD CONSTRAINT job_manual_stages_workspace_id_job_id_fkey FOREIGN KEY (workspace_id, job_id) REFERENCES public.job_identities(workspace_id, id) ON DELETE CASCADE;


--
-- Name: job_reference_counters job_reference_counters_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_reference_counters
    ADD CONSTRAINT job_reference_counters_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: legal_entities legal_entities_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_entities
    ADD CONSTRAINT legal_entities_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: local_auth_credentials local_auth_credentials_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_auth_credentials
    ADD CONSTRAINT local_auth_credentials_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: member_roles member_roles_membership_id_workspace_memberships_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT member_roles_membership_id_workspace_memberships_id_fk FOREIGN KEY (membership_id) REFERENCES public.workspace_memberships(id) ON DELETE CASCADE;


--
-- Name: member_roles member_roles_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT member_roles_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: member_roles member_roles_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT member_roles_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: mfa_enrollment_requirements mfa_enrollment_requirements_account_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_enrollment_requirements
    ADD CONSTRAINT mfa_enrollment_requirements_account_id_fk FOREIGN KEY (account_id) REFERENCES public.customer_accounts(id) ON DELETE CASCADE;


--
-- Name: mfa_enrollment_requirements mfa_enrollment_requirements_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_enrollment_requirements
    ADD CONSTRAINT mfa_enrollment_requirements_user_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mfa_security_events mfa_security_events_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_security_events
    ADD CONSTRAINT mfa_security_events_user_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mfa_security_events mfa_security_events_workspace_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_security_events
    ADD CONSTRAINT mfa_security_events_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: notification_delivery_attempts notification_delivery_attempts_notification_id_notifications_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery_attempts
    ADD CONSTRAINT notification_delivery_attempts_notification_id_notifications_id FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;


--
-- Name: notification_delivery_attempts notification_delivery_attempts_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_delivery_attempts
    ADD CONSTRAINT notification_delivery_attempts_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notification_device_consents notification_device_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_device_consents
    ADD CONSTRAINT notification_device_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notification_device_consents notification_device_consents_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_device_consents
    ADD CONSTRAINT notification_device_consents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notification_policies notification_policies_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_policies
    ADD CONSTRAINT notification_policies_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notification_templates notification_templates_approved_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_approved_by_users_id_fk FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notification_templates notification_templates_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_policy_id_notification_policies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_policy_id_notification_policies_id_fk FOREIGN KEY (policy_id) REFERENCES public.notification_policies(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_template_id_notification_templates_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_template_id_notification_templates_id_fk FOREIGN KEY (template_id) REFERENCES public.notification_templates(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: one_tree_node_revisions one_tree_node_revisions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tree_node_revisions
    ADD CONSTRAINT one_tree_node_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: one_tree_node_revisions one_tree_node_revisions_workspace_id_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tree_node_revisions
    ADD CONSTRAINT one_tree_node_revisions_workspace_id_node_id_fkey FOREIGN KEY (workspace_id, node_id) REFERENCES public.one_tree_nodes(workspace_id, id) ON DELETE CASCADE;


--
-- Name: one_tree_nodes one_tree_nodes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tree_nodes
    ADD CONSTRAINT one_tree_nodes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: one_tree_nodes one_tree_nodes_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tree_nodes
    ADD CONSTRAINT one_tree_nodes_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id) ON DELETE CASCADE;


--
-- Name: one_tree_nodes one_tree_nodes_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tree_nodes
    ADD CONSTRAINT one_tree_nodes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: one_tree_nodes one_tree_nodes_workspace_id_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tree_nodes
    ADD CONSTRAINT one_tree_nodes_workspace_id_job_id_fkey FOREIGN KEY (workspace_id, job_id) REFERENCES public.job_identities(workspace_id, id) ON DELETE CASCADE;


--
-- Name: one_tree_nodes one_tree_nodes_workspace_id_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tree_nodes
    ADD CONSTRAINT one_tree_nodes_workspace_id_parent_id_fkey FOREIGN KEY (workspace_id, parent_id) REFERENCES public.one_tree_nodes(workspace_id, id);


--
-- Name: one_tree_nodes one_tree_nodes_workspace_id_replaces_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.one_tree_nodes
    ADD CONSTRAINT one_tree_nodes_workspace_id_replaces_node_id_fkey FOREIGN KEY (workspace_id, replaces_node_id) REFERENCES public.one_tree_nodes(workspace_id, id);


--
-- Name: organization_billing_allocation_versions organization_billing_allocatio_account_contract_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_billing_allocation_versions
    ADD CONSTRAINT organization_billing_allocatio_account_contract_version_id_fkey FOREIGN KEY (account_contract_version_id) REFERENCES public.account_contract_versions(id) ON DELETE RESTRICT;


--
-- Name: organization_billing_allocation_versions organization_billing_allocation_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_billing_allocation_versions
    ADD CONSTRAINT organization_billing_allocation_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: organization_billing_allocation_versions organization_billing_allocation_versions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_billing_allocation_versions
    ADD CONSTRAINT organization_billing_allocation_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: organization_entitlement_allocations organization_entitlement_allocation_account_entitlement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_entitlement_allocations
    ADD CONSTRAINT organization_entitlement_allocation_account_entitlement_id_fkey FOREIGN KEY (account_entitlement_id) REFERENCES public.account_entitlement_versions(id) ON DELETE RESTRICT;


--
-- Name: organization_entitlement_allocations organization_entitlement_allocations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_entitlement_allocations
    ADD CONSTRAINT organization_entitlement_allocations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: organization_entitlement_allocations organization_entitlement_allocations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_entitlement_allocations
    ADD CONSTRAINT organization_entitlement_allocations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: organization_requests organization_requests_account_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_requests
    ADD CONSTRAINT organization_requests_account_id_fk FOREIGN KEY (account_id) REFERENCES public.customer_accounts(id) ON DELETE CASCADE;


--
-- Name: organization_requests organization_requests_approved_workspace_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_requests
    ADD CONSTRAINT organization_requests_approved_workspace_id_fk FOREIGN KEY (approved_workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: organization_requests organization_requests_requested_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_requests
    ADD CONSTRAINT organization_requests_requested_by_fk FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: organization_requests organization_requests_reviewed_by_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_requests
    ADD CONSTRAINT organization_requests_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: organization_requests organization_requests_source_workspace_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_requests
    ADD CONSTRAINT organization_requests_source_workspace_id_fk FOREIGN KEY (source_workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: outbox_events outbox_events_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: platform_administrators platform_administrators_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_administrators
    ADD CONSTRAINT platform_administrators_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: platform_capability_flags platform_capability_flags_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_capability_flags
    ADD CONSTRAINT platform_capability_flags_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: platform_operator_audit platform_operator_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_operator_audit
    ADD CONSTRAINT platform_operator_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: platform_operator_challenges platform_operator_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_operator_challenges
    ADD CONSTRAINT platform_operator_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: platform_operator_sessions platform_operator_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_operator_sessions
    ADD CONSTRAINT platform_operator_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pre_project_brief_assets pre_project_brief_assets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_brief_assets
    ADD CONSTRAINT pre_project_brief_assets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pre_project_brief_assets pre_project_brief_assets_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_brief_assets
    ADD CONSTRAINT pre_project_brief_assets_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: pre_project_brief_assets pre_project_brief_assets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_brief_assets
    ADD CONSTRAINT pre_project_brief_assets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: pre_project_brief_entries pre_project_brief_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_brief_entries
    ADD CONSTRAINT pre_project_brief_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pre_project_brief_entries pre_project_brief_entries_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_brief_entries
    ADD CONSTRAINT pre_project_brief_entries_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: pre_project_brief_entries pre_project_brief_entries_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_brief_entries
    ADD CONSTRAINT pre_project_brief_entries_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: pre_project_brief_entries pre_project_brief_entries_workspace_id_case_id_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_brief_entries
    ADD CONSTRAINT pre_project_brief_entries_workspace_id_case_id_room_id_fkey FOREIGN KEY (workspace_id, case_id, room_id) REFERENCES public.pre_project_rooms(workspace_id, case_id, id);


--
-- Name: pre_project_brief_entries pre_project_brief_entries_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_brief_entries
    ADD CONSTRAINT pre_project_brief_entries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: pre_project_briefs pre_project_briefs_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_briefs
    ADD CONSTRAINT pre_project_briefs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: pre_project_briefs pre_project_briefs_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_briefs
    ADD CONSTRAINT pre_project_briefs_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: pre_project_briefs pre_project_briefs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_briefs
    ADD CONSTRAINT pre_project_briefs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: pre_project_cases pre_project_cases_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_cases
    ADD CONSTRAINT pre_project_cases_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(id);


--
-- Name: pre_project_cases pre_project_cases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_cases
    ADD CONSTRAINT pre_project_cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pre_project_cases pre_project_cases_held_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_cases
    ADD CONSTRAINT pre_project_cases_held_by_fkey FOREIGN KEY (held_by) REFERENCES public.users(id);


--
-- Name: pre_project_cases pre_project_cases_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_cases
    ADD CONSTRAINT pre_project_cases_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.crm_opportunities(id);


--
-- Name: pre_project_cases pre_project_cases_owner_membership_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_cases
    ADD CONSTRAINT pre_project_cases_owner_membership_fk FOREIGN KEY (workspace_id, owner_membership_id) REFERENCES public.workspace_memberships(workspace_id, id);


--
-- Name: pre_project_cases pre_project_cases_released_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_cases
    ADD CONSTRAINT pre_project_cases_released_by_fkey FOREIGN KEY (released_by) REFERENCES public.users(id);


--
-- Name: pre_project_cases pre_project_cases_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_cases
    ADD CONSTRAINT pre_project_cases_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: pre_project_definition_baselines pre_project_definition_baselines_case_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_baselines
    ADD CONSTRAINT pre_project_definition_baselines_case_fk FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: pre_project_definition_baselines pre_project_definition_baselines_published_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_baselines
    ADD CONSTRAINT pre_project_definition_baselines_published_by_fkey FOREIGN KEY (published_by) REFERENCES public.users(id);


--
-- Name: pre_project_definition_baselines pre_project_definition_baselines_supersedes_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_baselines
    ADD CONSTRAINT pre_project_definition_baselines_supersedes_fk FOREIGN KEY (workspace_id, case_id, supersedes_id) REFERENCES public.pre_project_definition_baselines(workspace_id, case_id, id);


--
-- Name: pre_project_definition_baselines pre_project_definition_baselines_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_baselines
    ADD CONSTRAINT pre_project_definition_baselines_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: pre_project_definition_commands pre_project_definition_commands_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_commands
    ADD CONSTRAINT pre_project_definition_commands_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: pre_project_definition_commands pre_project_definition_commands_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_commands
    ADD CONSTRAINT pre_project_definition_commands_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: pre_project_definition_commands pre_project_definition_commands_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_commands
    ADD CONSTRAINT pre_project_definition_commands_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: pre_project_definition_decisions pre_project_definition_decisions_baseline_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_decisions
    ADD CONSTRAINT pre_project_definition_decisions_baseline_fk FOREIGN KEY (workspace_id, case_id, baseline_id) REFERENCES public.pre_project_definition_baselines(workspace_id, case_id, id);


--
-- Name: pre_project_definition_decisions pre_project_definition_decisions_grant_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_decisions
    ADD CONSTRAINT pre_project_definition_decisions_grant_fk FOREIGN KEY (workspace_id, case_id, client_grant_id) REFERENCES public.client_portal_grants(workspace_id, case_id, id);


--
-- Name: pre_project_definition_decisions pre_project_definition_decisions_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_decisions
    ADD CONSTRAINT pre_project_definition_decisions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: pre_project_definition_decisions pre_project_definition_decisions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_definition_decisions
    ADD CONSTRAINT pre_project_definition_decisions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: pre_project_design_activity pre_project_design_activity_client_grant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_activity
    ADD CONSTRAINT pre_project_design_activity_client_grant_id_fkey FOREIGN KEY (client_grant_id) REFERENCES public.client_portal_grants(id);


--
-- Name: pre_project_design_activity pre_project_design_activity_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_activity
    ADD CONSTRAINT pre_project_design_activity_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pre_project_design_activity pre_project_design_activity_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_activity
    ADD CONSTRAINT pre_project_design_activity_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id);


--
-- Name: pre_project_design_activity pre_project_design_activity_workspace_id_case_id_design_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_activity
    ADD CONSTRAINT pre_project_design_activity_workspace_id_case_id_design_id_fkey FOREIGN KEY (workspace_id, case_id, design_id, version_id) REFERENCES public.pre_project_design_versions(workspace_id, case_id, design_id, id);


--
-- Name: pre_project_designs pre_project_design_folder_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_designs
    ADD CONSTRAINT pre_project_design_folder_fk FOREIGN KEY (workspace_id, case_id, folder_id) REFERENCES public.pre_project_design_folders(workspace_id, case_id, id);


--
-- Name: pre_project_design_folders pre_project_design_folder_scope_entry_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_folders
    ADD CONSTRAINT pre_project_design_folder_scope_entry_fk FOREIGN KEY (workspace_id, case_id, scope_entry_id) REFERENCES public.pre_project_brief_entries(workspace_id, case_id, id);


--
-- Name: pre_project_design_folders pre_project_design_folders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_folders
    ADD CONSTRAINT pre_project_design_folders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pre_project_design_folders pre_project_design_folders_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_folders
    ADD CONSTRAINT pre_project_design_folders_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id);


--
-- Name: pre_project_design_folders pre_project_design_folders_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_folders
    ADD CONSTRAINT pre_project_design_folders_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: pre_project_design_folders pre_project_design_folders_workspace_id_case_id_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_folders
    ADD CONSTRAINT pre_project_design_folders_workspace_id_case_id_room_id_fkey FOREIGN KEY (workspace_id, case_id, room_id) REFERENCES public.pre_project_rooms(workspace_id, case_id, id);


--
-- Name: pre_project_design_messages pre_project_design_messages_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_messages
    ADD CONSTRAINT pre_project_design_messages_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pre_project_design_messages pre_project_design_messages_workspace_id_case_id_design_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_messages
    ADD CONSTRAINT pre_project_design_messages_workspace_id_case_id_design_id_fkey FOREIGN KEY (workspace_id, case_id, design_id, thread_id) REFERENCES public.pre_project_design_threads(workspace_id, case_id, design_id, id);


--
-- Name: pre_project_design_threads pre_project_design_threads_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_threads
    ADD CONSTRAINT pre_project_design_threads_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pre_project_design_threads pre_project_design_threads_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_threads
    ADD CONSTRAINT pre_project_design_threads_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: pre_project_design_threads pre_project_design_threads_workspace_id_case_id_design_id__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_threads
    ADD CONSTRAINT pre_project_design_threads_workspace_id_case_id_design_id__fkey FOREIGN KEY (workspace_id, case_id, design_id, version_id) REFERENCES public.pre_project_design_versions(workspace_id, case_id, design_id, id);


--
-- Name: pre_project_design_versions pre_project_design_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_versions
    ADD CONSTRAINT pre_project_design_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pre_project_design_versions pre_project_design_versions_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_versions
    ADD CONSTRAINT pre_project_design_versions_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id);


--
-- Name: pre_project_design_versions pre_project_design_versions_workspace_id_case_id_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_versions
    ADD CONSTRAINT pre_project_design_versions_workspace_id_case_id_asset_id_fkey FOREIGN KEY (workspace_id, case_id, asset_id) REFERENCES public.pre_project_brief_assets(workspace_id, case_id, id);


--
-- Name: pre_project_design_versions pre_project_design_versions_workspace_id_case_id_design_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_design_versions
    ADD CONSTRAINT pre_project_design_versions_workspace_id_case_id_design_id_fkey FOREIGN KEY (workspace_id, case_id, design_id) REFERENCES public.pre_project_designs(workspace_id, case_id, id);


--
-- Name: pre_project_designs pre_project_designs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_designs
    ADD CONSTRAINT pre_project_designs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pre_project_designs pre_project_designs_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_designs
    ADD CONSTRAINT pre_project_designs_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: pre_project_designs pre_project_designs_workspace_id_case_id_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_designs
    ADD CONSTRAINT pre_project_designs_workspace_id_case_id_room_id_fkey FOREIGN KEY (workspace_id, case_id, room_id) REFERENCES public.pre_project_rooms(workspace_id, case_id, id);


--
-- Name: pre_project_designs pre_project_designs_workspace_id_case_id_scope_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_designs
    ADD CONSTRAINT pre_project_designs_workspace_id_case_id_scope_entry_id_fkey FOREIGN KEY (workspace_id, case_id, scope_entry_id) REFERENCES public.pre_project_brief_entries(workspace_id, case_id, id);


--
-- Name: pre_project_entry_assets pre_project_entry_assets_workspace_id_case_id_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_entry_assets
    ADD CONSTRAINT pre_project_entry_assets_workspace_id_case_id_asset_id_fkey FOREIGN KEY (workspace_id, case_id, asset_id) REFERENCES public.pre_project_brief_assets(workspace_id, case_id, id);


--
-- Name: pre_project_entry_assets pre_project_entry_assets_workspace_id_case_id_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_entry_assets
    ADD CONSTRAINT pre_project_entry_assets_workspace_id_case_id_entry_id_fkey FOREIGN KEY (workspace_id, case_id, entry_id) REFERENCES public.pre_project_brief_entries(workspace_id, case_id, id);


--
-- Name: pre_project_item_design_refs pre_project_item_design_refs_workspace_id_case_id_design_v_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_item_design_refs
    ADD CONSTRAINT pre_project_item_design_refs_workspace_id_case_id_design_v_fkey FOREIGN KEY (workspace_id, case_id, design_version_id) REFERENCES public.pre_project_design_versions(workspace_id, case_id, id);


--
-- Name: pre_project_item_design_refs pre_project_item_design_refs_workspace_id_case_id_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_item_design_refs
    ADD CONSTRAINT pre_project_item_design_refs_workspace_id_case_id_entry_id_fkey FOREIGN KEY (workspace_id, case_id, entry_id, version) REFERENCES public.pre_project_item_specifications(workspace_id, case_id, entry_id, version);


--
-- Name: pre_project_item_specifications pre_project_item_specificatio_workspace_id_case_id_entry_i_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_item_specifications
    ADD CONSTRAINT pre_project_item_specificatio_workspace_id_case_id_entry_i_fkey FOREIGN KEY (workspace_id, case_id, entry_id) REFERENCES public.pre_project_brief_entries(workspace_id, case_id, id);


--
-- Name: pre_project_item_specifications pre_project_item_specifications_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_item_specifications
    ADD CONSTRAINT pre_project_item_specifications_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pre_project_lifecycle_commands pre_project_lifecycle_commands_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_lifecycle_commands
    ADD CONSTRAINT pre_project_lifecycle_commands_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: pre_project_lifecycle_commands pre_project_lifecycle_commands_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_lifecycle_commands
    ADD CONSTRAINT pre_project_lifecycle_commands_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id) ON DELETE CASCADE;


--
-- Name: pre_project_lifecycle_commands pre_project_lifecycle_commands_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_lifecycle_commands
    ADD CONSTRAINT pre_project_lifecycle_commands_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: pre_project_rooms pre_project_room_catalog_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_rooms
    ADD CONSTRAINT pre_project_room_catalog_fk FOREIGN KEY (workspace_id, catalog_record_id) REFERENCES public.workspace_catalog_records(workspace_id, id);


--
-- Name: pre_project_rooms pre_project_rooms_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_rooms
    ADD CONSTRAINT pre_project_rooms_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: pre_project_rooms pre_project_rooms_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_rooms
    ADD CONSTRAINT pre_project_rooms_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: pre_project_scope_links pre_project_scope_links_workspace_id_case_id_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_scope_links
    ADD CONSTRAINT pre_project_scope_links_workspace_id_case_id_entry_id_fkey FOREIGN KEY (workspace_id, case_id, entry_id) REFERENCES public.pre_project_brief_entries(workspace_id, case_id, id);


--
-- Name: pre_project_scope_links pre_project_scope_links_workspace_id_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_scope_links
    ADD CONSTRAINT pre_project_scope_links_workspace_id_record_id_fkey FOREIGN KEY (workspace_id, record_id) REFERENCES public.workspace_catalog_records(workspace_id, id);


--
-- Name: pre_project_site_assets pre_project_site_assets_workspace_id_case_id_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_assets
    ADD CONSTRAINT pre_project_site_assets_workspace_id_case_id_asset_id_fkey FOREIGN KEY (workspace_id, case_id, asset_id) REFERENCES public.pre_project_brief_assets(workspace_id, case_id, id);


--
-- Name: pre_project_site_assets pre_project_site_assets_workspace_id_case_id_record_id_ver_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_assets
    ADD CONSTRAINT pre_project_site_assets_workspace_id_case_id_record_id_ver_fkey FOREIGN KEY (workspace_id, case_id, record_id, version) REFERENCES public.pre_project_site_revisions(workspace_id, case_id, record_id, version);


--
-- Name: pre_project_site_records pre_project_site_records_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_records
    ADD CONSTRAINT pre_project_site_records_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pre_project_site_records pre_project_site_records_tree_site_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_records
    ADD CONSTRAINT pre_project_site_records_tree_site_fk FOREIGN KEY (workspace_id, site_id) REFERENCES public.one_tree_nodes(workspace_id, id);


--
-- Name: pre_project_site_records pre_project_site_records_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_records
    ADD CONSTRAINT pre_project_site_records_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: pre_project_site_records pre_project_site_records_workspace_id_case_id_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_records
    ADD CONSTRAINT pre_project_site_records_workspace_id_case_id_entry_id_fkey FOREIGN KEY (workspace_id, case_id, entry_id) REFERENCES public.pre_project_brief_entries(workspace_id, case_id, id);


--
-- Name: pre_project_site_records pre_project_site_records_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_records
    ADD CONSTRAINT pre_project_site_records_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: pre_project_site_records pre_project_site_records_workspace_id_case_id_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_records
    ADD CONSTRAINT pre_project_site_records_workspace_id_case_id_room_id_fkey FOREIGN KEY (workspace_id, case_id, room_id) REFERENCES public.pre_project_rooms(workspace_id, case_id, id);


--
-- Name: pre_project_site_records pre_project_site_records_workspace_id_case_id_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_records
    ADD CONSTRAINT pre_project_site_records_workspace_id_case_id_visit_id_fkey FOREIGN KEY (workspace_id, case_id, visit_id) REFERENCES public.pre_project_site_records(workspace_id, case_id, id);


--
-- Name: pre_project_site_revisions pre_project_site_revisions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_revisions
    ADD CONSTRAINT pre_project_site_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pre_project_site_revisions pre_project_site_revisions_workspace_id_case_id_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_revisions
    ADD CONSTRAINT pre_project_site_revisions_workspace_id_case_id_record_id_fkey FOREIGN KEY (workspace_id, case_id, record_id) REFERENCES public.pre_project_site_records(workspace_id, case_id, id);


--
-- Name: pre_project_site_specification_refs pre_project_site_specificatio_workspace_id_case_id_entry_i_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_specification_refs
    ADD CONSTRAINT pre_project_site_specificatio_workspace_id_case_id_entry_i_fkey FOREIGN KEY (workspace_id, case_id, entry_id, specification_version) REFERENCES public.pre_project_item_specifications(workspace_id, case_id, entry_id, version);


--
-- Name: pre_project_site_specification_refs pre_project_site_specificatio_workspace_id_case_id_record__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_site_specification_refs
    ADD CONSTRAINT pre_project_site_specificatio_workspace_id_case_id_record__fkey FOREIGN KEY (workspace_id, case_id, record_id, version) REFERENCES public.pre_project_site_revisions(workspace_id, case_id, record_id, version);


--
-- Name: pre_project_specification_catalog_refs pre_project_specification_cat_workspace_id_case_id_entry_i_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_specification_catalog_refs
    ADD CONSTRAINT pre_project_specification_cat_workspace_id_case_id_entry_i_fkey FOREIGN KEY (workspace_id, case_id, entry_id, version) REFERENCES public.pre_project_item_specifications(workspace_id, case_id, entry_id, version);


--
-- Name: pre_project_specification_catalog_refs pre_project_specification_catalog_r_workspace_id_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_project_specification_catalog_refs
    ADD CONSTRAINT pre_project_specification_catalog_r_workspace_id_record_id_fkey FOREIGN KEY (workspace_id, record_id) REFERENCES public.workspace_catalog_records(workspace_id, id);


--
-- Name: project_assignments project_assignments_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_assignments
    ADD CONSTRAINT project_assignments_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: project_assignments project_assignments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_assignments
    ADD CONSTRAINT project_assignments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: project_assignments project_assignments_workspace_id_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_assignments
    ADD CONSTRAINT project_assignments_workspace_id_membership_id_fkey FOREIGN KEY (workspace_id, membership_id) REFERENCES public.workspace_memberships(workspace_id, id);


--
-- Name: project_assignments project_assignments_workspace_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_assignments
    ADD CONSTRAINT project_assignments_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.delivery_projects(workspace_id, id);


--
-- Name: project_booking_history project_booking_history_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_booking_history
    ADD CONSTRAINT project_booking_history_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: project_booking_history project_booking_history_booking_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_booking_history
    ADD CONSTRAINT project_booking_history_booking_fk FOREIGN KEY (workspace_id, booking_id) REFERENCES public.project_bookings(workspace_id, id) ON DELETE RESTRICT;


--
-- Name: project_booking_history project_booking_history_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_booking_history
    ADD CONSTRAINT project_booking_history_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: project_booking_slots project_booking_slots_booking_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_booking_slots
    ADD CONSTRAINT project_booking_slots_booking_fk FOREIGN KEY (workspace_id, booking_id) REFERENCES public.project_bookings(workspace_id, id) ON DELETE CASCADE;


--
-- Name: project_booking_slots project_booking_slots_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_booking_slots
    ADD CONSTRAINT project_booking_slots_project_fk FOREIGN KEY (workspace_id, project_id) REFERENCES public.delivery_projects(workspace_id, id) ON DELETE CASCADE;


--
-- Name: project_booking_slots project_booking_slots_resource_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_booking_slots
    ADD CONSTRAINT project_booking_slots_resource_fk FOREIGN KEY (workspace_id, resource_id) REFERENCES public.project_resources(workspace_id, id);


--
-- Name: project_booking_slots project_booking_slots_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_booking_slots
    ADD CONSTRAINT project_booking_slots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: project_bookings project_bookings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_bookings
    ADD CONSTRAINT project_bookings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: project_bookings project_bookings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_bookings
    ADD CONSTRAINT project_bookings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: project_bookings project_bookings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_bookings
    ADD CONSTRAINT project_bookings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: project_bookings project_bookings_workspace_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_bookings
    ADD CONSTRAINT project_bookings_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.delivery_projects(workspace_id, id);


--
-- Name: project_bookings project_bookings_workspace_id_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_bookings
    ADD CONSTRAINT project_bookings_workspace_id_resource_id_fkey FOREIGN KEY (workspace_id, resource_id) REFERENCES public.project_resources(workspace_id, id);


--
-- Name: project_execution project_execution_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_execution
    ADD CONSTRAINT project_execution_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: project_execution project_execution_workspace_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_execution
    ADD CONSTRAINT project_execution_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.delivery_projects(workspace_id, id);


--
-- Name: project_factory_allocations project_factory_allocations_workspace_id_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_factory_allocations
    ADD CONSTRAINT project_factory_allocations_workspace_id_batch_id_fkey FOREIGN KEY (workspace_id, batch_id) REFERENCES public.project_factory_batches(workspace_id, id);


--
-- Name: project_factory_allocations project_factory_allocations_workspace_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_factory_allocations
    ADD CONSTRAINT project_factory_allocations_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.delivery_projects(workspace_id, id);


--
-- Name: project_factory_batches project_factory_batches_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_factory_batches
    ADD CONSTRAINT project_factory_batches_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: project_factory_batches project_factory_batches_workspace_id_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_factory_batches
    ADD CONSTRAINT project_factory_batches_workspace_id_owner_id_fkey FOREIGN KEY (workspace_id, owner_id) REFERENCES public.workspace_memberships(workspace_id, id);


--
-- Name: project_factory_batches project_factory_batches_workspace_id_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_factory_batches
    ADD CONSTRAINT project_factory_batches_workspace_id_resource_id_fkey FOREIGN KEY (workspace_id, resource_id) REFERENCES public.project_resources(workspace_id, id);


--
-- Name: project_factory_commands project_factory_commands_workspace_id_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_factory_commands
    ADD CONSTRAINT project_factory_commands_workspace_id_batch_id_fkey FOREIGN KEY (workspace_id, batch_id) REFERENCES public.project_factory_batches(workspace_id, id);


--
-- Name: project_factory_commands project_factory_commands_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_factory_commands
    ADD CONSTRAINT project_factory_commands_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: project_resources project_resources_business_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_resources
    ADD CONSTRAINT project_resources_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES public.business_units(id) ON DELETE SET NULL;


--
-- Name: project_resources project_resources_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_resources
    ADD CONSTRAINT project_resources_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: project_resources project_resources_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_resources
    ADD CONSTRAINT project_resources_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: project_resources project_resources_workspace_team_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_resources
    ADD CONSTRAINT project_resources_workspace_team_fk FOREIGN KEY (workspace_id, workspace_team_id) REFERENCES public.workspace_teams(workspace_id, id) ON DELETE SET NULL;


--
-- Name: project_stock_commands project_stock_commands_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_stock_commands
    ADD CONSTRAINT project_stock_commands_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: project_stock_transfers project_stock_transfers_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_stock_transfers
    ADD CONSTRAINT project_stock_transfers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: project_stock_transfers project_stock_transfers_workspace_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_stock_transfers
    ADD CONSTRAINT project_stock_transfers_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.delivery_projects(workspace_id, id);


--
-- Name: project_vendor_access project_vendor_access_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_vendor_access
    ADD CONSTRAINT project_vendor_access_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: project_vendor_access project_vendor_access_workspace_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_vendor_access
    ADD CONSTRAINT project_vendor_access_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.delivery_projects(workspace_id, id);


--
-- Name: project_warehouse_stock project_warehouse_stock_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_warehouse_stock
    ADD CONSTRAINT project_warehouse_stock_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: project_workflow_templates project_workflow_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_workflow_templates
    ADD CONSTRAINT project_workflow_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: project_workflow_templates project_workflow_templates_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_workflow_templates
    ADD CONSTRAINT project_workflow_templates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: project_workflow_templates project_workflow_templates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_workflow_templates
    ADD CONSTRAINT project_workflow_templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: quotation_proposal_commands quotation_proposal_commands_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_proposal_commands
    ADD CONSTRAINT quotation_proposal_commands_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: quotation_proposal_commands quotation_proposal_commands_case_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_proposal_commands
    ADD CONSTRAINT quotation_proposal_commands_case_fk FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: quotation_proposal_commands quotation_proposal_commands_run_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_proposal_commands
    ADD CONSTRAINT quotation_proposal_commands_run_fk FOREIGN KEY (workspace_id, case_id, run_id) REFERENCES public.quotation_proposal_runs(workspace_id, case_id, id);


--
-- Name: quotation_proposal_commands quotation_proposal_commands_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_proposal_commands
    ADD CONSTRAINT quotation_proposal_commands_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: quotation_proposal_runs quotation_proposal_runs_applied_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_proposal_runs
    ADD CONSTRAINT quotation_proposal_runs_applied_by_fkey FOREIGN KEY (applied_by) REFERENCES public.users(id);


--
-- Name: quotation_proposal_runs quotation_proposal_runs_case_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_proposal_runs
    ADD CONSTRAINT quotation_proposal_runs_case_fk FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: quotation_proposal_runs quotation_proposal_runs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_proposal_runs
    ADD CONSTRAINT quotation_proposal_runs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: quotation_proposal_runs quotation_proposal_runs_definition_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_proposal_runs
    ADD CONSTRAINT quotation_proposal_runs_definition_fk FOREIGN KEY (workspace_id, case_id, definition_baseline_id) REFERENCES public.pre_project_definition_baselines(workspace_id, case_id, id);


--
-- Name: quotation_proposal_runs quotation_proposal_runs_dismissed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_proposal_runs
    ADD CONSTRAINT quotation_proposal_runs_dismissed_by_fkey FOREIGN KEY (dismissed_by) REFERENCES public.users(id);


--
-- Name: quotation_proposal_runs quotation_proposal_runs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_proposal_runs
    ADD CONSTRAINT quotation_proposal_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: role_permissions role_permissions_permission_id_permissions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_permissions_id_fk FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: roles roles_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: sync_cursors sync_cursors_connection_id_integration_connections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_cursors
    ADD CONSTRAINT sync_cursors_connection_id_integration_connections_id_fk FOREIGN KEY (connection_id) REFERENCES public.integration_connections(id) ON DELETE CASCADE;


--
-- Name: sync_cursors sync_cursors_resource_id_integration_resources_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_cursors
    ADD CONSTRAINT sync_cursors_resource_id_integration_resources_id_fk FOREIGN KEY (resource_id) REFERENCES public.integration_resources(id) ON DELETE CASCADE;


--
-- Name: sync_cursors sync_cursors_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_cursors
    ADD CONSTRAINT sync_cursors_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: tax_profiles tax_profiles_legal_entity_id_legal_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_profiles
    ADD CONSTRAINT tax_profiles_legal_entity_id_legal_entities_id_fk FOREIGN KEY (legal_entity_id) REFERENCES public.legal_entities(id) ON DELETE CASCADE;


--
-- Name: tax_profiles tax_profiles_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_profiles
    ADD CONSTRAINT tax_profiles_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: tenant_data_exports tenant_data_exports_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_data_exports
    ADD CONSTRAINT tenant_data_exports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: tenant_data_exports tenant_data_exports_operation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_data_exports
    ADD CONSTRAINT tenant_data_exports_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.tenant_operation_runs(id) ON DELETE CASCADE;


--
-- Name: tenant_data_exports tenant_data_exports_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_data_exports
    ADD CONSTRAINT tenant_data_exports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: tenant_lifecycle_versions tenant_lifecycle_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_lifecycle_versions
    ADD CONSTRAINT tenant_lifecycle_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: tenant_lifecycle_versions tenant_lifecycle_versions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_lifecycle_versions
    ADD CONSTRAINT tenant_lifecycle_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: tenant_login_branding tenant_login_branding_logo_asset_id_workspace_brand_assets_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_login_branding
    ADD CONSTRAINT tenant_login_branding_logo_asset_id_workspace_brand_assets_id_f FOREIGN KEY (logo_asset_id) REFERENCES public.workspace_brand_assets(id) ON DELETE SET NULL;


--
-- Name: tenant_login_branding tenant_login_branding_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_login_branding
    ADD CONSTRAINT tenant_login_branding_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: tenant_operation_runs tenant_operation_runs_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_operation_runs
    ADD CONSTRAINT tenant_operation_runs_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: tenant_operation_runs tenant_operation_runs_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_operation_runs
    ADD CONSTRAINT tenant_operation_runs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: tenant_operation_runs tenant_operation_runs_rollback_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_operation_runs
    ADD CONSTRAINT tenant_operation_runs_rollback_of_fkey FOREIGN KEY (rollback_of) REFERENCES public.tenant_operation_runs(id) ON DELETE RESTRICT;


--
-- Name: tenant_operation_runs tenant_operation_runs_target_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_operation_runs
    ADD CONSTRAINT tenant_operation_runs_target_workspace_id_fkey FOREIGN KEY (target_workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;


--
-- Name: tenant_operation_runs tenant_operation_runs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_operation_runs
    ADD CONSTRAINT tenant_operation_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: tenant_provisioning_drafts tenant_provisioning_drafts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_provisioning_drafts
    ADD CONSTRAINT tenant_provisioning_drafts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: tenant_provisioning_drafts tenant_provisioning_drafts_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_provisioning_drafts
    ADD CONSTRAINT tenant_provisioning_drafts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: tenant_provisioning_drafts tenant_provisioning_drafts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_provisioning_drafts
    ADD CONSTRAINT tenant_provisioning_drafts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: tenant_provisioning_requests tenant_provisioning_requests_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_provisioning_requests
    ADD CONSTRAINT tenant_provisioning_requests_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: tenant_support_sessions tenant_support_sessions_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_support_sessions
    ADD CONSTRAINT tenant_support_sessions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: tenant_support_sessions tenant_support_sessions_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_support_sessions
    ADD CONSTRAINT tenant_support_sessions_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: tenant_support_sessions tenant_support_sessions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_support_sessions
    ADD CONSTRAINT tenant_support_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: user_identities user_identities_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_mfa_credentials user_mfa_credentials_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mfa_credentials
    ADD CONSTRAINT user_mfa_credentials_user_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_mfa_recovery_codes user_mfa_recovery_codes_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_mfa_recovery_codes
    ADD CONSTRAINT user_mfa_recovery_codes_user_id_fk FOREIGN KEY (user_id) REFERENCES public.user_mfa_credentials(user_id) ON DELETE CASCADE;


--
-- Name: webhook_inbox webhook_inbox_connection_id_integration_connections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_inbox
    ADD CONSTRAINT webhook_inbox_connection_id_integration_connections_id_fk FOREIGN KEY (connection_id) REFERENCES public.integration_connections(id) ON DELETE SET NULL;


--
-- Name: webhook_inbox webhook_inbox_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_inbox
    ADD CONSTRAINT webhook_inbox_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: work_locations work_locations_workspace_id_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_locations
    ADD CONSTRAINT work_locations_workspace_id_case_id_fkey FOREIGN KEY (workspace_id, case_id) REFERENCES public.pre_project_cases(workspace_id, id);


--
-- Name: work_locations work_locations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_locations
    ADD CONSTRAINT work_locations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: work_locations work_locations_workspace_id_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_locations
    ADD CONSTRAINT work_locations_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.delivery_projects(workspace_id, id);


--
-- Name: workspace_brand_assets workspace_brand_assets_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_brand_assets
    ADD CONSTRAINT workspace_brand_assets_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: workspace_brand_assets workspace_brand_assets_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_brand_assets
    ADD CONSTRAINT workspace_brand_assets_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_catalog_assets workspace_catalog_assets_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_assets
    ADD CONSTRAINT workspace_catalog_assets_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id);


--
-- Name: workspace_catalog_assets workspace_catalog_assets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_assets
    ADD CONSTRAINT workspace_catalog_assets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: workspace_catalog_assets workspace_catalog_assets_record_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_assets
    ADD CONSTRAINT workspace_catalog_assets_record_fk FOREIGN KEY (workspace_id, catalog_record_id) REFERENCES public.workspace_catalog_records(workspace_id, id);


--
-- Name: workspace_catalog_assets workspace_catalog_assets_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_assets
    ADD CONSTRAINT workspace_catalog_assets_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: workspace_catalog_links workspace_catalog_links_workspace_id_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_links
    ADD CONSTRAINT workspace_catalog_links_workspace_id_record_id_fkey FOREIGN KEY (workspace_id, record_id) REFERENCES public.workspace_catalog_records(workspace_id, id);


--
-- Name: workspace_catalog_links workspace_catalog_links_workspace_id_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_links
    ADD CONSTRAINT workspace_catalog_links_workspace_id_target_id_fkey FOREIGN KEY (workspace_id, target_id) REFERENCES public.workspace_catalog_records(workspace_id, id);


--
-- Name: workspace_catalog_records workspace_catalog_owner_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_records
    ADD CONSTRAINT workspace_catalog_owner_fk FOREIGN KEY (workspace_id, catalog_id) REFERENCES public.workspace_catalog_records(workspace_id, id);


--
-- Name: workspace_catalog_records workspace_catalog_records_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_records
    ADD CONSTRAINT workspace_catalog_records_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: workspace_catalog_records workspace_catalog_records_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_records
    ADD CONSTRAINT workspace_catalog_records_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: workspace_catalog_records workspace_catalog_records_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_catalog_records
    ADD CONSTRAINT workspace_catalog_records_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: workspace_configuration_revisions workspace_configuration_revisions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_configuration_revisions
    ADD CONSTRAINT workspace_configuration_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: workspace_configuration_revisions workspace_configuration_revisions_source_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_configuration_revisions
    ADD CONSTRAINT workspace_configuration_revisions_source_revision_id_fkey FOREIGN KEY (source_revision_id) REFERENCES public.workspace_configuration_revisions(id) ON DELETE SET NULL;


--
-- Name: workspace_configuration_revisions workspace_configuration_revisions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_configuration_revisions
    ADD CONSTRAINT workspace_configuration_revisions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_data_policies workspace_data_policies_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_data_policies
    ADD CONSTRAINT workspace_data_policies_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: workspace_data_policies workspace_data_policies_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_data_policies
    ADD CONSTRAINT workspace_data_policies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_domains workspace_domains_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_domains
    ADD CONSTRAINT workspace_domains_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: workspace_domains workspace_domains_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_domains
    ADD CONSTRAINT workspace_domains_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_entitlement_sets workspace_entitlement_sets_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_entitlement_sets
    ADD CONSTRAINT workspace_entitlement_sets_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: workspace_entitlement_sets workspace_entitlement_sets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_entitlement_sets
    ADD CONSTRAINT workspace_entitlement_sets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_invitation_delivery_commands workspace_invitation_delivery_commands_invitation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invitation_delivery_commands
    ADD CONSTRAINT workspace_invitation_delivery_commands_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES public.workspace_invitations(id) ON DELETE CASCADE;


--
-- Name: workspace_invitation_delivery_commands workspace_invitation_delivery_commands_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invitation_delivery_commands
    ADD CONSTRAINT workspace_invitation_delivery_commands_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_invitation_delivery workspace_invitation_delivery_invitation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invitation_delivery
    ADD CONSTRAINT workspace_invitation_delivery_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES public.workspace_invitations(id) ON DELETE CASCADE;


--
-- Name: workspace_invitation_delivery workspace_invitation_delivery_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invitation_delivery
    ADD CONSTRAINT workspace_invitation_delivery_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_invitations workspace_invitations_invited_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_invited_by_users_id_fk FOREIGN KEY (invited_by) REFERENCES public.users(id);


--
-- Name: workspace_invitations workspace_invitations_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_memberships workspace_memberships_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: workspace_memberships workspace_memberships_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_onboarding workspace_onboarding_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_onboarding
    ADD CONSTRAINT workspace_onboarding_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_setup_versions workspace_setup_versions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_setup_versions
    ADD CONSTRAINT workspace_setup_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_stored_objects workspace_stored_objects_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_stored_objects
    ADD CONSTRAINT workspace_stored_objects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_subscriptions workspace_subscriptions_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_subscriptions
    ADD CONSTRAINT workspace_subscriptions_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: workspace_subscriptions workspace_subscriptions_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_subscriptions
    ADD CONSTRAINT workspace_subscriptions_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_supplier_offer_commands workspace_supplier_offer_commands_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_supplier_offer_commands
    ADD CONSTRAINT workspace_supplier_offer_commands_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: workspace_supplier_offer_commands workspace_supplier_offer_commands_offer_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_supplier_offer_commands
    ADD CONSTRAINT workspace_supplier_offer_commands_offer_fk FOREIGN KEY (workspace_id, offer_id) REFERENCES public.workspace_supplier_offers(workspace_id, id);


--
-- Name: workspace_supplier_offers workspace_supplier_offers_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_supplier_offers
    ADD CONSTRAINT workspace_supplier_offers_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id);


--
-- Name: workspace_supplier_offers workspace_supplier_offers_catalog_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_supplier_offers
    ADD CONSTRAINT workspace_supplier_offers_catalog_fk FOREIGN KEY (workspace_id, catalog_record_id) REFERENCES public.workspace_catalog_records(workspace_id, id);


--
-- Name: workspace_supplier_offers workspace_supplier_offers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_supplier_offers
    ADD CONSTRAINT workspace_supplier_offers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: workspace_supplier_offers workspace_supplier_offers_legal_entity_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_supplier_offers
    ADD CONSTRAINT workspace_supplier_offers_legal_entity_fk FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES public.legal_entities(workspace_id, id);


--
-- Name: workspace_supplier_offers workspace_supplier_offers_replacement_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_supplier_offers
    ADD CONSTRAINT workspace_supplier_offers_replacement_fk FOREIGN KEY (workspace_id, replaces_offer_id) REFERENCES public.workspace_supplier_offers(workspace_id, id);


--
-- Name: workspace_supplier_offers workspace_supplier_offers_site_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_supplier_offers
    ADD CONSTRAINT workspace_supplier_offers_site_fk FOREIGN KEY (workspace_id, vendor_id, vendor_site_id) REFERENCES public.workspace_vendor_sites(workspace_id, vendor_id, id);


--
-- Name: workspace_supplier_offers workspace_supplier_offers_unit_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_supplier_offers
    ADD CONSTRAINT workspace_supplier_offers_unit_fk FOREIGN KEY (workspace_id, unit_record_id) REFERENCES public.workspace_catalog_records(workspace_id, id);


--
-- Name: workspace_supplier_offers workspace_supplier_offers_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_supplier_offers
    ADD CONSTRAINT workspace_supplier_offers_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: workspace_supplier_offers workspace_supplier_offers_vendor_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_supplier_offers
    ADD CONSTRAINT workspace_supplier_offers_vendor_fk FOREIGN KEY (workspace_id, vendor_id) REFERENCES public.workspace_vendors(workspace_id, id);


--
-- Name: workspace_team_members workspace_team_members_membership_id_workspace_memberships_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_team_members
    ADD CONSTRAINT workspace_team_members_membership_id_workspace_memberships_id_f FOREIGN KEY (membership_id) REFERENCES public.workspace_memberships(id) ON DELETE CASCADE;


--
-- Name: workspace_team_members workspace_team_members_team_id_workspace_teams_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_team_members
    ADD CONSTRAINT workspace_team_members_team_id_workspace_teams_id_fk FOREIGN KEY (team_id) REFERENCES public.workspace_teams(id) ON DELETE CASCADE;


--
-- Name: workspace_team_members workspace_team_members_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_team_members
    ADD CONSTRAINT workspace_team_members_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_team_queue_settings workspace_team_queue_settings_queue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_team_queue_settings
    ADD CONSTRAINT workspace_team_queue_settings_queue_id_fkey FOREIGN KEY (queue_id) REFERENCES public.crm_queues(id) ON DELETE CASCADE;


--
-- Name: workspace_team_queue_settings workspace_team_queue_settings_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_team_queue_settings
    ADD CONSTRAINT workspace_team_queue_settings_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.workspace_teams(id) ON DELETE CASCADE;


--
-- Name: workspace_team_queue_settings workspace_team_queue_settings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_team_queue_settings
    ADD CONSTRAINT workspace_team_queue_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_team_roles workspace_team_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_team_roles
    ADD CONSTRAINT workspace_team_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: workspace_team_roles workspace_team_roles_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_team_roles
    ADD CONSTRAINT workspace_team_roles_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.workspace_teams(id) ON DELETE CASCADE;


--
-- Name: workspace_team_roles workspace_team_roles_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_team_roles
    ADD CONSTRAINT workspace_team_roles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_teams workspace_teams_business_unit_id_business_units_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_teams
    ADD CONSTRAINT workspace_teams_business_unit_id_business_units_id_fk FOREIGN KEY (business_unit_id) REFERENCES public.business_units(id) ON DELETE RESTRICT;


--
-- Name: workspace_teams workspace_teams_workspace_id_workspaces_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_teams
    ADD CONSTRAINT workspace_teams_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_terminology workspace_terminology_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_terminology
    ADD CONSTRAINT workspace_terminology_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: workspace_terminology workspace_terminology_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_terminology
    ADD CONSTRAINT workspace_terminology_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_vendor_sites workspace_vendor_sites_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_vendor_sites
    ADD CONSTRAINT workspace_vendor_sites_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id);


--
-- Name: workspace_vendor_sites workspace_vendor_sites_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_vendor_sites
    ADD CONSTRAINT workspace_vendor_sites_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: workspace_vendor_sites workspace_vendor_sites_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_vendor_sites
    ADD CONSTRAINT workspace_vendor_sites_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: workspace_vendor_sites workspace_vendor_sites_vendor_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_vendor_sites
    ADD CONSTRAINT workspace_vendor_sites_vendor_fk FOREIGN KEY (workspace_id, vendor_id) REFERENCES public.workspace_vendors(workspace_id, id) ON DELETE CASCADE;


--
-- Name: workspace_vendors workspace_vendors_archived_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_vendors
    ADD CONSTRAINT workspace_vendors_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id);


--
-- Name: workspace_vendors workspace_vendors_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_vendors
    ADD CONSTRAINT workspace_vendors_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: workspace_vendors workspace_vendors_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_vendors
    ADD CONSTRAINT workspace_vendors_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: workspace_vendors workspace_vendors_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_vendors
    ADD CONSTRAINT workspace_vendors_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspaces workspaces_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: account_billing_document_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_billing_document_events ENABLE ROW LEVEL SECURITY;

--
-- Name: account_billing_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_billing_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: account_collection_state_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_collection_state_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: account_contract_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_contract_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: account_entitlement_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_entitlement_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: account_usage_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_usage_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_suggestion_decisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_suggestion_decisions ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_suggestions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_suggestions ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_step_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_step_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_waits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_waits ENABLE ROW LEVEL SECURITY;

--
-- Name: business_units; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_units ENABLE ROW LEVEL SECURITY;

--
-- Name: client_portal_challenges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_portal_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: client_portal_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_portal_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: client_portal_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_portal_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: commercial_cases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commercial_cases ENABLE ROW LEVEL SECURITY;

--
-- Name: commercial_payment_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commercial_payment_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: commercial_quotation_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.commercial_quotation_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_addresses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_addresses ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_assignment_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_assignment_history ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_assignment_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_assignment_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_assignment_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_assignment_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_attribution_touches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_attribution_touches ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_consents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_consents ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_contact_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_contact_points ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_conversation_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_conversation_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_custom_field_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_custom_field_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_custom_field_values; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_custom_field_values ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_enquiries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_enquiries ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_enquiry_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_enquiry_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_forecast_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_forecast_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_identity_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_identity_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_intake_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_intake_events ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_lead_forms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_lead_forms ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_lead_qualification_values; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_lead_qualification_values ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_merge_operations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_merge_operations ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_message_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_message_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_opportunities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_opportunities ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_opportunity_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_opportunity_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_opportunity_stakeholders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_opportunity_stakeholders ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_opportunity_team; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_opportunity_team ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_organization_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_organization_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_parties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_parties ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_person_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_person_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_pipeline_stages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_pipeline_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_pipelines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_pipelines ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_project_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_project_links ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_qualification_forms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_qualification_forms ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_qualification_questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_qualification_questions ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_queue_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_queue_members ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_queues; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_queues ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_saved_views; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_saved_views ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_sequence_enrollments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_sequence_enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_sequence_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_sequence_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_sequences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_sequences ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_sla_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_sla_history ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_sla_instances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_sla_instances ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_sla_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_sla_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_stage_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_stage_history ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_taxonomies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_taxonomies ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_taxonomy_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_taxonomy_options ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_account_contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_account_contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_projects ENABLE ROW LEVEL SECURITY;

--
-- Name: device_endpoints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.device_endpoints ENABLE ROW LEVEL SECURITY;

--
-- Name: document_sequences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;

--
-- Name: exchange_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: hrms_attendance_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hrms_attendance_events ENABLE ROW LEVEL SECURITY;

--
-- Name: hrms_calendars; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hrms_calendars ENABLE ROW LEVEL SECURITY;

--
-- Name: hrms_captures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hrms_captures ENABLE ROW LEVEL SECURITY;

--
-- Name: hrms_employees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hrms_employees ENABLE ROW LEVEL SECURITY;

--
-- Name: hrms_leave_allowances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hrms_leave_allowances ENABLE ROW LEVEL SECURITY;

--
-- Name: hrms_leave_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hrms_leave_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: hrms_leave_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hrms_leave_types ENABLE ROW LEVEL SECURITY;

--
-- Name: hrms_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hrms_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: hrms_segments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hrms_segments ENABLE ROW LEVEL SECURITY;

--
-- Name: hrms_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hrms_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: hrms_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hrms_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: idempotency_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_resources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_resources ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_invitations invitation_email_self_discovery; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invitation_email_self_discovery ON public.workspace_invitations FOR SELECT USING ((email OPERATOR(public.=) ( SELECT app_user.primary_email
   FROM public.users app_user
  WHERE (app_user.id = (NULLIF(current_setting('app.current_actor_id'::text, true), ''::text))::uuid))));


--
-- Name: invitation_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invitation_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: invitation_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invitation_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_invitations invitation_token_discovery; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invitation_token_discovery ON public.workspace_invitations FOR SELECT USING (((token_hash)::text = NULLIF(current_setting('app.current_invitation_token_hash'::text, true), ''::text)));


--
-- Name: job_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: job_identity_link_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_identity_link_events ENABLE ROW LEVEL SECURITY;

--
-- Name: job_identity_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_identity_links ENABLE ROW LEVEL SECURITY;

--
-- Name: job_manual_stage_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_manual_stage_events ENABLE ROW LEVEL SECURITY;

--
-- Name: job_manual_stages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_manual_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: job_reference_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_reference_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_entities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legal_entities ENABLE ROW LEVEL SECURITY;

--
-- Name: account_billing_document_events linked_organization_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY linked_organization_access ON public.account_billing_document_events USING ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = account_billing_document_events.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = account_billing_document_events.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)))));


--
-- Name: account_billing_documents linked_organization_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY linked_organization_access ON public.account_billing_documents USING ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = account_billing_documents.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = account_billing_documents.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)))));


--
-- Name: account_collection_state_versions linked_organization_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY linked_organization_access ON public.account_collection_state_versions USING ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = account_collection_state_versions.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = account_collection_state_versions.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)))));


--
-- Name: account_contract_versions linked_organization_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY linked_organization_access ON public.account_contract_versions USING ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = account_contract_versions.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = account_contract_versions.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)))));


--
-- Name: account_entitlement_versions linked_organization_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY linked_organization_access ON public.account_entitlement_versions USING ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = account_entitlement_versions.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = account_entitlement_versions.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)))));


--
-- Name: account_usage_snapshots linked_organization_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY linked_organization_access ON public.account_usage_snapshots USING ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = account_usage_snapshots.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = account_usage_snapshots.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)))));


--
-- Name: customer_account_contracts linked_organization_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY linked_organization_access ON public.customer_account_contracts USING ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = customer_account_contracts.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.customer_account_organizations linked
  WHERE ((linked.account_id = customer_account_contracts.account_id) AND (linked.workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)))));


--
-- Name: member_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_memberships membership_self_discovery; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY membership_self_discovery ON public.workspace_memberships FOR SELECT USING ((user_id = (NULLIF(current_setting('app.current_actor_id'::text, true), ''::text))::uuid));


--
-- Name: notification_delivery_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_delivery_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_device_consents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_device_consents ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: one_tree_node_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.one_tree_node_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: one_tree_nodes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.one_tree_nodes ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_billing_allocation_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_billing_allocation_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_entitlement_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_entitlement_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: outbox_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_billing_allocation_versions platform_operator_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_operator_access ON public.organization_billing_allocation_versions USING ((EXISTS ( SELECT 1
   FROM public.platform_administrators operator
  WHERE ((operator.user_id = (NULLIF(current_setting('app.current_actor_id'::text, true), ''::text))::uuid) AND ((operator.status)::text = 'active'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.platform_administrators operator
  WHERE ((operator.user_id = (NULLIF(current_setting('app.current_actor_id'::text, true), ''::text))::uuid) AND ((operator.status)::text = 'active'::text)))));


--
-- Name: pre_project_asset_markups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_asset_markups ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_brief_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_brief_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_brief_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_brief_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_briefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_briefs ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_cases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_cases ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_definition_baselines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_definition_baselines ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_definition_commands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_definition_commands ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_definition_decisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_definition_decisions ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_design_activity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_design_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_design_folders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_design_folders ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_design_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_design_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_design_threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_design_threads ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_design_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_design_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_designs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_designs ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_entry_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_entry_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_item_design_refs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_item_design_refs ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_item_specifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_item_specifications ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_lifecycle_commands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_lifecycle_commands ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_scope_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_scope_links ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_site_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_site_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_site_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_site_records ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_site_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_site_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_site_specification_refs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_site_specification_refs ENABLE ROW LEVEL SECURITY;

--
-- Name: pre_project_specification_catalog_refs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pre_project_specification_catalog_refs ENABLE ROW LEVEL SECURITY;

--
-- Name: project_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: project_booking_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_booking_history ENABLE ROW LEVEL SECURITY;

--
-- Name: project_booking_slots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_booking_slots ENABLE ROW LEVEL SECURITY;

--
-- Name: project_bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: project_execution; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_execution ENABLE ROW LEVEL SECURITY;

--
-- Name: project_factory_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_factory_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: project_factory_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_factory_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: project_factory_commands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_factory_commands ENABLE ROW LEVEL SECURITY;

--
-- Name: project_resources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_resources ENABLE ROW LEVEL SECURITY;

--
-- Name: project_stock_commands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_stock_commands ENABLE ROW LEVEL SECURITY;

--
-- Name: project_stock_transfers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_stock_transfers ENABLE ROW LEVEL SECURITY;

--
-- Name: project_warehouse_stock; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_warehouse_stock ENABLE ROW LEVEL SECURITY;

--
-- Name: project_workflow_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_workflow_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_lead_forms published_form_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY published_form_read ON public.crm_lead_forms FOR SELECT USING ((((status)::text = 'published'::text) AND (published IS NOT NULL) AND ((token)::text = NULLIF(current_setting('app.current_lead_form_token'::text, true), ''::text))));


--
-- Name: quotation_proposal_commands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quotation_proposal_commands ENABLE ROW LEVEL SECURITY;

--
-- Name: quotation_proposal_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quotation_proposal_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: role_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_cursors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_cursors ENABLE ROW LEVEL SECURITY;

--
-- Name: tax_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tax_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_data_exports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_data_exports ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_suggestion_decisions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ai_suggestion_decisions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: ai_suggestions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ai_suggestions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: audit_events tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.audit_events USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: automation_approvals tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.automation_approvals USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: automation_definitions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.automation_definitions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: automation_runs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.automation_runs USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: automation_step_runs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.automation_step_runs USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: automation_versions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.automation_versions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: automation_waits tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.automation_waits USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: business_units tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.business_units USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: client_portal_challenges tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.client_portal_challenges USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: client_portal_grants tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.client_portal_grants USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: client_portal_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.client_portal_sessions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: commercial_cases tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.commercial_cases USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: commercial_payment_templates tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.commercial_payment_templates USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: commercial_quotation_templates tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.commercial_quotation_templates USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_activities tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_activities USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_addresses tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_addresses USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_appointments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_appointments USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_assignment_history tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_assignment_history USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_assignment_policies tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_assignment_policies USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_assignment_rules tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_assignment_rules USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_attribution_touches tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_attribution_touches USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_consents tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_consents USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_contact_points tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_contact_points USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_conversation_participants tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_conversation_participants USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_conversations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_conversations USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_custom_field_definitions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_custom_field_definitions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_custom_field_values tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_custom_field_values USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_enquiries tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_enquiries USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_enquiry_counters tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_enquiry_counters USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_forecast_snapshots tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_forecast_snapshots USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_identity_candidates tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_identity_candidates USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_intake_events tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_intake_events USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_lead_forms tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_lead_forms USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_lead_qualification_values tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_lead_qualification_values USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_leads tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_leads USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_merge_operations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_merge_operations USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_message_attachments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_message_attachments USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_messages tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_messages USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_opportunities tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_opportunities USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_opportunity_counters tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_opportunity_counters USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_opportunity_stakeholders tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_opportunity_stakeholders USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_opportunity_team tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_opportunity_team USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_organization_profiles tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_organization_profiles USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_parties tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_parties USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_person_profiles tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_person_profiles USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_pipeline_stages tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_pipeline_stages USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_pipelines tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_pipelines USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_project_links tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_project_links USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_qualification_forms tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_qualification_forms USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_qualification_questions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_qualification_questions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_queue_members tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_queue_members USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_queues tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_queues USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_relationships tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_relationships USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_saved_views tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_saved_views USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_sequence_enrollments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_sequence_enrollments USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_sequence_steps tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_sequence_steps USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_sequences tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_sequences USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_sla_history tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_sla_history USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_sla_instances tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_sla_instances USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_sla_policies tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_sla_policies USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_stage_history tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_stage_history USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_taxonomies tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_taxonomies USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: crm_taxonomy_options tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_taxonomy_options USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: delivery_projects tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.delivery_projects USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: device_endpoints tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.device_endpoints USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: document_sequences tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.document_sequences USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: exchange_rates tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.exchange_rates USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: hrms_attendance_events tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.hrms_attendance_events USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: hrms_calendars tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.hrms_calendars USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: hrms_captures tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.hrms_captures USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: hrms_employees tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.hrms_employees USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: hrms_leave_allowances tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.hrms_leave_allowances USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: hrms_leave_requests tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.hrms_leave_requests USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: hrms_leave_types tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.hrms_leave_types USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: hrms_reviews tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.hrms_reviews USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: hrms_segments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.hrms_segments USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: hrms_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.hrms_sessions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: hrms_settings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.hrms_settings USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: idempotency_keys tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.idempotency_keys USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: integration_connections tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.integration_connections USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: integration_resources tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.integration_resources USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: invitation_roles tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.invitation_roles USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: invitation_teams tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.invitation_teams USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: job_identities tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.job_identities USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: job_identity_link_events tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.job_identity_link_events USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: job_identity_links tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.job_identity_links USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: job_manual_stage_events tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.job_manual_stage_events USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: job_manual_stages tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.job_manual_stages USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: job_reference_counters tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.job_reference_counters USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: legal_entities tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.legal_entities USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: member_roles tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.member_roles USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: notification_delivery_attempts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.notification_delivery_attempts USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: notification_device_consents tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.notification_device_consents USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: notification_policies tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.notification_policies USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: notification_preferences tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.notification_preferences USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: notification_templates tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.notification_templates USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: notifications tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.notifications USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: one_tree_node_revisions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.one_tree_node_revisions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: one_tree_nodes tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.one_tree_nodes USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: organization_billing_allocation_versions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.organization_billing_allocation_versions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: organization_entitlement_allocations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.organization_entitlement_allocations USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: outbox_events tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.outbox_events USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_asset_markups tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_asset_markups USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_brief_assets tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_brief_assets USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_brief_entries tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_brief_entries USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_briefs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_briefs USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_cases tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_cases USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_definition_baselines tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_definition_baselines USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_definition_commands tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_definition_commands USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_definition_decisions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_definition_decisions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_design_activity tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_design_activity USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_design_folders tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_design_folders USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_design_messages tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_design_messages USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_design_threads tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_design_threads USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_design_versions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_design_versions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_designs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_designs USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_entry_assets tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_entry_assets USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_item_design_refs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_item_design_refs USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_item_specifications tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_item_specifications USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_lifecycle_commands tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_lifecycle_commands USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_rooms tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_rooms USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_scope_links tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_scope_links USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_site_assets tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_site_assets USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_site_records tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_site_records USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_site_revisions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_site_revisions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_site_specification_refs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_site_specification_refs USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: pre_project_specification_catalog_refs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.pre_project_specification_catalog_refs USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: project_assignments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.project_assignments USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: project_booking_history tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.project_booking_history USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: project_booking_slots tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.project_booking_slots USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: project_bookings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.project_bookings USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: project_execution tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.project_execution USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: project_factory_allocations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.project_factory_allocations USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: project_factory_batches tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.project_factory_batches USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: project_factory_commands tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.project_factory_commands USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: project_resources tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.project_resources USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: project_stock_commands tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.project_stock_commands USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: project_stock_transfers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.project_stock_transfers USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: project_warehouse_stock tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.project_warehouse_stock USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: project_workflow_templates tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.project_workflow_templates USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: quotation_proposal_commands tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.quotation_proposal_commands USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: quotation_proposal_runs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.quotation_proposal_runs USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: role_permissions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.role_permissions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: roles tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.roles USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: sync_cursors tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.sync_cursors USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: tax_profiles tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.tax_profiles USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: tenant_data_exports tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.tenant_data_exports USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: tenant_operation_runs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.tenant_operation_runs USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: tenant_support_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.tenant_support_sessions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: webhook_inbox tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.webhook_inbox USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: work_locations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.work_locations USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_brand_assets tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_brand_assets USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_catalog_assets tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_catalog_assets USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_catalog_links tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_catalog_links USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_catalog_records tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_catalog_records USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_configuration_revisions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_configuration_revisions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_data_policies tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_data_policies USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_domains tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_domains USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_entitlement_sets tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_entitlement_sets USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_invitation_delivery tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_invitation_delivery USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_invitation_delivery_commands tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_invitation_delivery_commands USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_invitations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_invitations USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_memberships tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_memberships USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_onboarding tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_onboarding USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_setup_versions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_setup_versions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_stored_objects tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_stored_objects USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_subscriptions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_subscriptions USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_supplier_offer_commands tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_supplier_offer_commands USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_supplier_offers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_supplier_offers USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_team_members tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_team_members USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_team_queue_settings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_team_queue_settings USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_team_roles tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_team_roles USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_teams tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_teams USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_terminology tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_terminology USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_vendor_sites tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_vendor_sites USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_vendors tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.workspace_vendors USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: tenant_lifecycle_versions tenant_lifecycle_operator_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_lifecycle_operator_insert ON public.tenant_lifecycle_versions FOR INSERT WITH CHECK (((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid) AND (created_by = (NULLIF(current_setting('app.current_actor_id'::text, true), ''::text))::uuid) AND (EXISTS ( SELECT 1
   FROM public.platform_administrators operator
  WHERE ((operator.user_id = tenant_lifecycle_versions.created_by) AND ((operator.status)::text = 'active'::text) AND ((operator.role)::text = ANY ((ARRAY['administrator'::character varying, 'platform_security_owner'::character varying])::text[])))))));


--
-- Name: tenant_lifecycle_versions tenant_lifecycle_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_lifecycle_read ON public.tenant_lifecycle_versions FOR SELECT USING ((workspace_id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: tenant_lifecycle_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_lifecycle_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_operation_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_operation_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_support_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_support_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_inbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_inbox ENABLE ROW LEVEL SECURITY;

--
-- Name: work_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_brand_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_brand_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_catalog_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_catalog_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_catalog_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_catalog_links ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_catalog_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_catalog_records ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_configuration_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_configuration_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_data_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_data_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_domains; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_entitlement_sets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_entitlement_sets ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_invitation_delivery; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_invitation_delivery ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_invitation_delivery_commands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_invitation_delivery_commands ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces workspace_invitation_self_discovery; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_invitation_self_discovery ON public.workspaces FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.workspace_invitations invitation
     JOIN public.users app_user ON ((app_user.primary_email OPERATOR(public.=) invitation.email)))
  WHERE ((invitation.workspace_id = workspaces.id) AND (app_user.id = (NULLIF(current_setting('app.current_actor_id'::text, true), ''::text))::uuid) AND (invitation.status = 'pending'::public.invitation_status) AND (invitation.expires_at > now())))));


--
-- Name: workspace_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_onboarding; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_onboarding ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces workspace_self_discovery; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_self_discovery ON public.workspaces FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships membership
  WHERE ((membership.workspace_id = workspaces.id) AND (membership.user_id = (NULLIF(current_setting('app.current_actor_id'::text, true), ''::text))::uuid) AND (membership.status = 'active'::public.membership_status)))));


--
-- Name: workspace_setup_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_setup_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_stored_objects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_stored_objects ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_supplier_offer_commands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_supplier_offer_commands ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_supplier_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_supplier_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_team_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_team_queue_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_team_queue_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_team_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_team_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_teams ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces workspace_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_tenant_isolation ON public.workspaces USING ((id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid)) WITH CHECK ((id = (NULLIF(current_setting('app.current_workspace_id'::text, true), ''::text))::uuid));


--
-- Name: workspace_terminology; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_terminology ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_vendor_sites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_vendor_sites ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_vendors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_vendors ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO wodana_app;


--
-- Name: FUNCTION claim_outbox_events(batch_size integer, lease_token uuid, lease_seconds integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_outbox_events(batch_size integer, lease_token uuid, lease_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_outbox_events(batch_size integer, lease_token uuid, lease_seconds integer) TO wodana_app;


--
-- Name: FUNCTION complete_outbox_event(event_id uuid, lease_token uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_outbox_event(event_id uuid, lease_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_outbox_event(event_id uuid, lease_token uuid) TO wodana_app;


--
-- Name: FUNCTION crm_allocate_enquiry_reference(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.crm_allocate_enquiry_reference() TO wodana_app;


--
-- Name: FUNCTION crm_allocate_opportunity_reference(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.crm_allocate_opportunity_reference() TO wodana_app;


--
-- Name: FUNCTION crm_sla_history_append_only(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.crm_sla_history_append_only() TO wodana_app;


--
-- Name: FUNCTION enforce_business_unit_parent_entity(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_business_unit_parent_entity() TO wodana_app;


--
-- Name: FUNCTION enforce_customer_account_organization_limit(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_customer_account_organization_limit() TO wodana_app;


--
-- Name: FUNCTION enforce_organization_request_account_links(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_organization_request_account_links() TO wodana_app;


--
-- Name: FUNCTION enforce_same_workspace_reference(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_same_workspace_reference() TO wodana_app;


--
-- Name: FUNCTION ensure_customer_account_membership_for_workspace_member(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.ensure_customer_account_membership_for_workspace_member() TO wodana_app;


--
-- Name: FUNCTION fail_outbox_event(event_id uuid, lease_token uuid, failure text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fail_outbox_event(event_id uuid, lease_token uuid, failure text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_outbox_event(event_id uuid, lease_token uuid, failure text) TO wodana_app;


--
-- Name: FUNCTION guard_hrms_session_overlap(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_hrms_session_overlap() TO wodana_app;


--
-- Name: FUNCTION guard_pre_project_source(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_pre_project_source() TO wodana_app;


--
-- Name: FUNCTION immutable_hrms_record(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.immutable_hrms_record() TO wodana_app;


--
-- Name: FUNCTION list_crm_workspaces_with_due_work(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_crm_workspaces_with_due_work() FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_crm_workspaces_with_due_work() TO wodana_app;


--
-- Name: FUNCTION list_reminder_workspaces(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.list_reminder_workspaces() FROM PUBLIC;
GRANT ALL ON FUNCTION public.list_reminder_workspaces() TO wodana_app;


--
-- Name: FUNCTION prevent_audit_event_mutation(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_audit_event_mutation() TO wodana_app;


--
-- Name: FUNCTION prevent_tenant_lifecycle_mutation(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.prevent_tenant_lifecycle_mutation() TO wodana_app;


--
-- Name: FUNCTION project_booking_history_append_only(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.project_booking_history_append_only() TO wodana_app;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO wodana_app;


--
-- Name: FUNCTION wodana_internal_slug_taken(candidate character varying); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.wodana_internal_slug_taken(candidate character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION public.wodana_internal_slug_taken(candidate character varying) TO wodana_app;


--
-- Name: FUNCTION wodana_public_tenant_host(candidate character varying); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.wodana_public_tenant_host(candidate character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION public.wodana_public_tenant_host(candidate character varying) TO wodana_app;


--
-- Name: FUNCTION workspace_seat_capacity(target_workspace_id uuid, excluded_invitation_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workspace_seat_capacity(target_workspace_id uuid, excluded_invitation_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workspace_seat_capacity(target_workspace_id uuid, excluded_invitation_id uuid) TO wodana_app;


--
-- Name: TABLE account_billing_document_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_billing_document_events TO wodana_app;


--
-- Name: TABLE account_billing_documents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_billing_documents TO wodana_app;


--
-- Name: TABLE account_collection_state_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_collection_state_versions TO wodana_app;


--
-- Name: TABLE account_contract_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_contract_versions TO wodana_app;


--
-- Name: TABLE account_entitlement_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_entitlement_versions TO wodana_app;


--
-- Name: TABLE account_usage_snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.account_usage_snapshots TO wodana_app;


--
-- Name: TABLE ai_suggestion_decisions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_suggestion_decisions TO wodana_app;


--
-- Name: TABLE ai_suggestions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.ai_suggestions TO wodana_app;


--
-- Name: TABLE audit_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.audit_events TO wodana_app;


--
-- Name: TABLE auth_mfa_challenges; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.auth_mfa_challenges TO wodana_app;


--
-- Name: TABLE auth_refresh_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.auth_refresh_sessions TO wodana_app;


--
-- Name: TABLE automation_approvals; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.automation_approvals TO wodana_app;


--
-- Name: TABLE automation_definitions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.automation_definitions TO wodana_app;


--
-- Name: TABLE automation_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.automation_runs TO wodana_app;


--
-- Name: TABLE automation_step_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.automation_step_runs TO wodana_app;


--
-- Name: TABLE automation_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.automation_versions TO wodana_app;


--
-- Name: TABLE automation_waits; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.automation_waits TO wodana_app;


--
-- Name: TABLE business_units; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.business_units TO wodana_app;


--
-- Name: TABLE client_portal_challenges; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_portal_challenges TO wodana_app;


--
-- Name: TABLE client_portal_grants; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_portal_grants TO wodana_app;


--
-- Name: TABLE client_portal_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_portal_sessions TO wodana_app;


--
-- Name: TABLE client_portal_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.client_portal_settings TO wodana_app;


--
-- Name: TABLE commercial_cases; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.commercial_cases TO wodana_app;


--
-- Name: TABLE commercial_payment_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.commercial_payment_templates TO wodana_app;


--
-- Name: TABLE commercial_quotation_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.commercial_quotation_templates TO wodana_app;


--
-- Name: TABLE commercial_reconciliation_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.commercial_reconciliation_jobs TO wodana_app;


--
-- Name: TABLE crm_activities; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_activities TO wodana_app;


--
-- Name: TABLE crm_addresses; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_addresses TO wodana_app;


--
-- Name: TABLE crm_appointments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_appointments TO wodana_app;


--
-- Name: TABLE crm_assignment_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_assignment_history TO wodana_app;


--
-- Name: TABLE crm_assignment_policies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_assignment_policies TO wodana_app;


--
-- Name: TABLE crm_assignment_rules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_assignment_rules TO wodana_app;


--
-- Name: TABLE crm_attribution_touches; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_attribution_touches TO wodana_app;


--
-- Name: TABLE crm_consents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_consents TO wodana_app;


--
-- Name: TABLE crm_contact_points; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_contact_points TO wodana_app;


--
-- Name: TABLE crm_conversation_participants; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_conversation_participants TO wodana_app;


--
-- Name: TABLE crm_conversations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_conversations TO wodana_app;


--
-- Name: TABLE crm_custom_field_definitions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_custom_field_definitions TO wodana_app;


--
-- Name: TABLE crm_custom_field_values; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_custom_field_values TO wodana_app;


--
-- Name: TABLE crm_queue_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_queue_members TO wodana_app;


--
-- Name: TABLE crm_queues; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_queues TO wodana_app;


--
-- Name: TABLE workspace_team_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_team_members TO wodana_app;


--
-- Name: TABLE workspace_team_queue_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_team_queue_settings TO wodana_app;


--
-- Name: TABLE workspace_teams; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_teams TO wodana_app;


--
-- Name: TABLE crm_effective_queue_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_effective_queue_members TO wodana_app;


--
-- Name: TABLE crm_enquiries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_enquiries TO wodana_app;


--
-- Name: TABLE crm_enquiry_counters; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_enquiry_counters TO wodana_app;


--
-- Name: TABLE crm_forecast_snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_forecast_snapshots TO wodana_app;


--
-- Name: TABLE crm_identity_candidates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_identity_candidates TO wodana_app;


--
-- Name: TABLE crm_intake_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_intake_events TO wodana_app;


--
-- Name: TABLE crm_lead_forms; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_lead_forms TO wodana_app;


--
-- Name: TABLE crm_lead_qualification_values; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_lead_qualification_values TO wodana_app;


--
-- Name: TABLE crm_leads; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_leads TO wodana_app;


--
-- Name: TABLE crm_merge_operations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_merge_operations TO wodana_app;


--
-- Name: TABLE crm_message_attachments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_message_attachments TO wodana_app;


--
-- Name: TABLE crm_messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_messages TO wodana_app;


--
-- Name: TABLE crm_opportunities; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_opportunities TO wodana_app;


--
-- Name: TABLE crm_opportunity_counters; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_opportunity_counters TO wodana_app;


--
-- Name: TABLE crm_opportunity_stakeholders; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_opportunity_stakeholders TO wodana_app;


--
-- Name: TABLE crm_opportunity_team; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_opportunity_team TO wodana_app;


--
-- Name: TABLE crm_organization_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_organization_profiles TO wodana_app;


--
-- Name: TABLE crm_parties; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_parties TO wodana_app;


--
-- Name: TABLE crm_person_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_person_profiles TO wodana_app;


--
-- Name: TABLE crm_pipeline_stages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_pipeline_stages TO wodana_app;


--
-- Name: TABLE crm_pipelines; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_pipelines TO wodana_app;


--
-- Name: TABLE crm_project_links; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_project_links TO wodana_app;


--
-- Name: TABLE crm_qualification_forms; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_qualification_forms TO wodana_app;


--
-- Name: TABLE crm_qualification_questions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_qualification_questions TO wodana_app;


--
-- Name: TABLE crm_relationships; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_relationships TO wodana_app;


--
-- Name: TABLE crm_saved_views; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_saved_views TO wodana_app;


--
-- Name: TABLE crm_sequence_enrollments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_sequence_enrollments TO wodana_app;


--
-- Name: TABLE crm_sequence_steps; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_sequence_steps TO wodana_app;


--
-- Name: TABLE crm_sequences; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_sequences TO wodana_app;


--
-- Name: TABLE crm_sla_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_sla_history TO wodana_app;


--
-- Name: TABLE crm_sla_instances; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_sla_instances TO wodana_app;


--
-- Name: TABLE crm_sla_policies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_sla_policies TO wodana_app;


--
-- Name: TABLE crm_stage_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_stage_history TO wodana_app;


--
-- Name: TABLE crm_taxonomies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_taxonomies TO wodana_app;


--
-- Name: TABLE crm_taxonomy_options; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.crm_taxonomy_options TO wodana_app;


--
-- Name: TABLE currencies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.currencies TO wodana_app;


--
-- Name: TABLE customer_account_contracts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.customer_account_contracts TO wodana_app;


--
-- Name: TABLE customer_account_memberships; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.customer_account_memberships TO wodana_app;


--
-- Name: TABLE customer_account_organizations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.customer_account_organizations TO wodana_app;


--
-- Name: TABLE customer_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.customer_accounts TO wodana_app;


--
-- Name: TABLE delivery_projects; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.delivery_projects TO wodana_app;


--
-- Name: TABLE device_endpoints; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.device_endpoints TO wodana_app;


--
-- Name: TABLE document_sequences; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.document_sequences TO wodana_app;


--
-- Name: TABLE effective_account_contracts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.effective_account_contracts TO wodana_app;


--
-- Name: TABLE member_roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.member_roles TO wodana_app;


--
-- Name: TABLE workspace_team_roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_team_roles TO wodana_app;


--
-- Name: TABLE effective_member_roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.effective_member_roles TO wodana_app;


--
-- Name: TABLE organization_billing_allocation_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organization_billing_allocation_versions TO wodana_app;


--
-- Name: TABLE effective_organization_billing_allocations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.effective_organization_billing_allocations TO wodana_app;


--
-- Name: TABLE organization_entitlement_allocations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organization_entitlement_allocations TO wodana_app;


--
-- Name: TABLE workspace_entitlement_sets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_entitlement_sets TO wodana_app;


--
-- Name: TABLE effective_workspace_entitlements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.effective_workspace_entitlements TO wodana_app;


--
-- Name: TABLE exchange_rates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.exchange_rates TO wodana_app;


--
-- Name: TABLE hrms_attendance_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hrms_attendance_events TO wodana_app;


--
-- Name: TABLE hrms_calendars; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hrms_calendars TO wodana_app;


--
-- Name: TABLE hrms_captures; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hrms_captures TO wodana_app;


--
-- Name: TABLE hrms_employees; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hrms_employees TO wodana_app;


--
-- Name: TABLE hrms_leave_allowances; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hrms_leave_allowances TO wodana_app;


--
-- Name: TABLE hrms_leave_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hrms_leave_requests TO wodana_app;


--
-- Name: TABLE hrms_leave_types; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hrms_leave_types TO wodana_app;


--
-- Name: TABLE hrms_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hrms_reviews TO wodana_app;


--
-- Name: TABLE hrms_segments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hrms_segments TO wodana_app;


--
-- Name: TABLE hrms_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hrms_sessions TO wodana_app;


--
-- Name: TABLE hrms_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.hrms_settings TO wodana_app;


--
-- Name: TABLE idempotency_keys; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.idempotency_keys TO wodana_app;


--
-- Name: TABLE integration_connections; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.integration_connections TO wodana_app;


--
-- Name: TABLE integration_resources; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.integration_resources TO wodana_app;


--
-- Name: TABLE invitation_roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invitation_roles TO wodana_app;


--
-- Name: TABLE invitation_teams; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.invitation_teams TO wodana_app;


--
-- Name: TABLE job_identities; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.job_identities TO wodana_app;


--
-- Name: TABLE job_identity_link_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.job_identity_link_events TO wodana_app;


--
-- Name: TABLE job_identity_links; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.job_identity_links TO wodana_app;


--
-- Name: TABLE job_manual_stage_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.job_manual_stage_events TO wodana_app;


--
-- Name: TABLE job_manual_stages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.job_manual_stages TO wodana_app;


--
-- Name: TABLE job_reference_counters; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.job_reference_counters TO wodana_app;


--
-- Name: TABLE legal_entities; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.legal_entities TO wodana_app;


--
-- Name: TABLE local_auth_credentials; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.local_auth_credentials TO wodana_app;


--
-- Name: TABLE mfa_enrollment_requirements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mfa_enrollment_requirements TO wodana_app;


--
-- Name: TABLE mfa_security_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.mfa_security_events TO wodana_app;


--
-- Name: TABLE notification_delivery_attempts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_delivery_attempts TO wodana_app;


--
-- Name: TABLE notification_device_consents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_device_consents TO wodana_app;


--
-- Name: TABLE notification_policies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_policies TO wodana_app;


--
-- Name: TABLE notification_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_preferences TO wodana_app;


--
-- Name: TABLE notification_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notification_templates TO wodana_app;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.notifications TO wodana_app;


--
-- Name: TABLE one_tree_node_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.one_tree_node_revisions TO wodana_app;


--
-- Name: TABLE one_tree_nodes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.one_tree_nodes TO wodana_app;


--
-- Name: TABLE organization_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.organization_requests TO wodana_app;


--
-- Name: TABLE outbox_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.outbox_events TO wodana_app;


--
-- Name: TABLE password_reset_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.password_reset_tokens TO wodana_app;


--
-- Name: TABLE permissions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.permissions TO wodana_app;


--
-- Name: TABLE platform_administrators; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_administrators TO wodana_app;


--
-- Name: TABLE platform_capability_flags; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_capability_flags TO wodana_app;


--
-- Name: TABLE platform_operator_audit; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_operator_audit TO wodana_app;


--
-- Name: TABLE platform_operator_challenges; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_operator_challenges TO wodana_app;


--
-- Name: TABLE platform_operator_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.platform_operator_sessions TO wodana_app;


--
-- Name: TABLE pre_project_asset_markups; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_asset_markups TO wodana_app;


--
-- Name: TABLE pre_project_brief_assets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_brief_assets TO wodana_app;


--
-- Name: TABLE pre_project_brief_entries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_brief_entries TO wodana_app;


--
-- Name: TABLE pre_project_briefs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_briefs TO wodana_app;


--
-- Name: TABLE pre_project_cases; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_cases TO wodana_app;


--
-- Name: TABLE pre_project_definition_baselines; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_definition_baselines TO wodana_app;


--
-- Name: TABLE pre_project_definition_commands; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_definition_commands TO wodana_app;


--
-- Name: TABLE pre_project_definition_decisions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_definition_decisions TO wodana_app;


--
-- Name: TABLE pre_project_design_activity; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_design_activity TO wodana_app;


--
-- Name: TABLE pre_project_design_folders; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_design_folders TO wodana_app;


--
-- Name: TABLE pre_project_design_messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_design_messages TO wodana_app;


--
-- Name: TABLE pre_project_design_threads; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_design_threads TO wodana_app;


--
-- Name: TABLE pre_project_design_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_design_versions TO wodana_app;


--
-- Name: TABLE pre_project_designs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_designs TO wodana_app;


--
-- Name: TABLE pre_project_entry_assets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_entry_assets TO wodana_app;


--
-- Name: TABLE pre_project_item_design_refs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_item_design_refs TO wodana_app;


--
-- Name: TABLE pre_project_item_specifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_item_specifications TO wodana_app;


--
-- Name: TABLE pre_project_lifecycle_commands; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_lifecycle_commands TO wodana_app;


--
-- Name: TABLE pre_project_rooms; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_rooms TO wodana_app;


--
-- Name: TABLE pre_project_scope_links; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_scope_links TO wodana_app;


--
-- Name: TABLE pre_project_site_assets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_site_assets TO wodana_app;


--
-- Name: TABLE pre_project_site_records; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_site_records TO wodana_app;


--
-- Name: TABLE pre_project_site_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_site_revisions TO wodana_app;


--
-- Name: TABLE pre_project_site_specification_refs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_site_specification_refs TO wodana_app;


--
-- Name: TABLE pre_project_specification_catalog_refs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.pre_project_specification_catalog_refs TO wodana_app;


--
-- Name: TABLE project_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_assignments TO wodana_app;


--
-- Name: TABLE project_booking_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_booking_history TO wodana_app;


--
-- Name: TABLE project_booking_slots; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_booking_slots TO wodana_app;


--
-- Name: TABLE project_bookings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_bookings TO wodana_app;


--
-- Name: TABLE project_execution; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_execution TO wodana_app;


--
-- Name: TABLE project_factory_allocations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_factory_allocations TO wodana_app;


--
-- Name: TABLE project_factory_batches; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_factory_batches TO wodana_app;


--
-- Name: TABLE project_factory_commands; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_factory_commands TO wodana_app;


--
-- Name: TABLE project_resources; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_resources TO wodana_app;


--
-- Name: TABLE project_stock_commands; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_stock_commands TO wodana_app;


--
-- Name: TABLE project_stock_transfers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_stock_transfers TO wodana_app;


--
-- Name: TABLE project_vendor_access; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_vendor_access TO wodana_app;


--
-- Name: TABLE project_warehouse_stock; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_warehouse_stock TO wodana_app;


--
-- Name: TABLE project_workflow_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.project_workflow_templates TO wodana_app;


--
-- Name: TABLE quotation_proposal_commands; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.quotation_proposal_commands TO wodana_app;


--
-- Name: TABLE quotation_proposal_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.quotation_proposal_runs TO wodana_app;


--
-- Name: COLUMN quotation_proposal_runs.status; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(status) ON TABLE public.quotation_proposal_runs TO wodana_app;


--
-- Name: COLUMN quotation_proposal_runs.applied_by; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(applied_by) ON TABLE public.quotation_proposal_runs TO wodana_app;


--
-- Name: COLUMN quotation_proposal_runs.applied_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(applied_at) ON TABLE public.quotation_proposal_runs TO wodana_app;


--
-- Name: COLUMN quotation_proposal_runs.applied_revision; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(applied_revision) ON TABLE public.quotation_proposal_runs TO wodana_app;


--
-- Name: COLUMN quotation_proposal_runs.dismissed_by; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(dismissed_by) ON TABLE public.quotation_proposal_runs TO wodana_app;


--
-- Name: COLUMN quotation_proposal_runs.dismissed_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(dismissed_at) ON TABLE public.quotation_proposal_runs TO wodana_app;


--
-- Name: TABLE role_permissions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.role_permissions TO wodana_app;


--
-- Name: TABLE roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.roles TO wodana_app;


--
-- Name: TABLE sync_cursors; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sync_cursors TO wodana_app;


--
-- Name: TABLE tax_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tax_profiles TO wodana_app;


--
-- Name: TABLE tenant_data_exports; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_data_exports TO wodana_app;


--
-- Name: TABLE tenant_lifecycle_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_lifecycle_versions TO wodana_app;


--
-- Name: TABLE tenant_login_branding; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_login_branding TO wodana_app;


--
-- Name: TABLE tenant_operation_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_operation_runs TO wodana_app;


--
-- Name: TABLE tenant_provisioning_drafts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_provisioning_drafts TO wodana_app;


--
-- Name: TABLE tenant_provisioning_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_provisioning_requests TO wodana_app;


--
-- Name: TABLE tenant_setup_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_setup_profiles TO wodana_app;


--
-- Name: TABLE tenant_support_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tenant_support_sessions TO wodana_app;


--
-- Name: TABLE user_identities; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_identities TO wodana_app;


--
-- Name: TABLE user_mfa_credentials; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_mfa_credentials TO wodana_app;


--
-- Name: TABLE user_mfa_recovery_codes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_mfa_recovery_codes TO wodana_app;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.users TO wodana_app;


--
-- Name: TABLE webhook_inbox; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.webhook_inbox TO wodana_app;


--
-- Name: TABLE work_locations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.work_locations TO wodana_app;


--
-- Name: TABLE workspace_brand_assets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_brand_assets TO wodana_app;


--
-- Name: TABLE workspace_catalog_assets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_catalog_assets TO wodana_app;


--
-- Name: TABLE workspace_catalog_links; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_catalog_links TO wodana_app;


--
-- Name: TABLE workspace_catalog_records; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_catalog_records TO wodana_app;


--
-- Name: TABLE workspace_configuration_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_configuration_revisions TO wodana_app;


--
-- Name: TABLE workspace_data_policies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_data_policies TO wodana_app;


--
-- Name: TABLE workspace_domains; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_domains TO wodana_app;


--
-- Name: TABLE workspace_invitation_delivery; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_invitation_delivery TO wodana_app;


--
-- Name: TABLE workspace_invitation_delivery_commands; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_invitation_delivery_commands TO wodana_app;


--
-- Name: TABLE workspace_invitations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_invitations TO wodana_app;


--
-- Name: TABLE workspace_memberships; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_memberships TO wodana_app;


--
-- Name: TABLE workspace_onboarding; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_onboarding TO wodana_app;


--
-- Name: TABLE workspace_setup_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_setup_versions TO wodana_app;


--
-- Name: TABLE workspace_stored_objects; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_stored_objects TO wodana_app;


--
-- Name: TABLE workspace_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_subscriptions TO wodana_app;


--
-- Name: TABLE workspace_supplier_offer_commands; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_supplier_offer_commands TO wodana_app;


--
-- Name: TABLE workspace_supplier_offers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_supplier_offers TO wodana_app;


--
-- Name: TABLE workspace_terminology; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_terminology TO wodana_app;


--
-- Name: TABLE workspace_vendor_sites; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_vendor_sites TO wodana_app;


--
-- Name: TABLE workspace_vendors; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_vendors TO wodana_app;


--
-- Name: TABLE workspaces; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspaces TO wodana_app;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--

-- Global reference data (currencies, permission catalog, setup profiles).

--
-- Data for Name: currencies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.currencies VALUES ('AED', '784', 'UAE Dirham', 2, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('AUD', '036', 'Australian Dollar', 2, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('BHD', '048', 'Bahraini Dinar', 3, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('CAD', '124', 'Canadian Dollar', 2, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('CHF', '756', 'Swiss Franc', 2, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('CNY', '156', 'Yuan Renminbi', 2, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('EUR', '978', 'Euro', 2, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('GBP', '826', 'Pound Sterling', 2, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('INR', '356', 'Indian Rupee', 2, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('JPY', '392', 'Yen', 0, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('KWD', '414', 'Kuwaiti Dinar', 3, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('OMR', '512', 'Rial Omani', 3, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('QAR', '634', 'Qatari Rial', 2, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('SAR', '682', 'Saudi Riyal', 2, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('SGD', '702', 'Singapore Dollar', 2, true, '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.currencies VALUES ('USD', '840', 'US Dollar', 2, true, '2026-09-16 10:46:31.209228+05:30');


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.permissions VALUES ('d6ddf70d-8587-4205-ad5c-29c6cd671b4b', 'workspace.settings.manage', 'Manage workspace regional and operating settings', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('85cff45a-1b2c-4e9e-890c-482d3227dc49', 'workspace.members.manage', 'Invite, suspend, and assign roles to members', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('5933966b-2771-4659-a221-6fff15e223c6', 'workspace.roles.manage', 'Create roles and assign permissions', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('17a6eb78-22a7-449a-a347-7836ef85a616', 'legal_entities.view', 'View legal entities and business units', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('b365c6f8-f185-44ed-b07e-96844fbe0e28', 'legal_entities.manage', 'Create and update legal entities and business units', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('3500b864-492e-4fd6-b23d-c4691ef5464d', 'integrations.view', 'View integration connections and sync state', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('1b696a3f-52e1-42c5-94d7-31d43c7c3a4b', 'integrations.manage', 'Create, reconnect, configure, and revoke integrations', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('131f3251-ce61-400f-abbe-20522415304e', 'audit.view', 'View workspace audit history', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('368a6812-618f-4449-b3c5-7c030b48e9c3', 'finance.settings.manage', 'Manage tax, currency, and document sequence settings', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('ad0dd73e-d6db-4122-93de-d71ccf46d3c8', 'crm.parties.view', 'View CRM people, organizations, households, and relationships', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('197d6753-b09f-4472-bede-635f7095b11b', 'crm.parties.manage', 'Create and update CRM parties and relationship data', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('65bc4c14-9bfe-4412-bc3f-117dcef7ec58', 'crm.parties.export', 'Export CRM party data', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('b2891781-b5b7-42d7-8510-2c0eba30699d', 'crm.parties.merge', 'Review duplicates and merge CRM parties', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('aa1eb47a-9051-4d26-af4b-38891c73cf71', 'crm.consent.manage', 'Manage communication consent and privacy preferences', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('7f47796a-cc78-4461-bc30-458b746e4762', 'crm.leads.view', 'View CRM enquiries, leads, assignment, and SLA state', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('40a3244c-99a1-48e7-8579-99c7b390b61e', 'crm.leads.manage', 'Create and update enquiries, leads, and qualification', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('d3c9796f-5a72-4672-83e7-6a31201619f1', 'crm.leads.assign', 'Assign and reassign CRM leads', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('bb57a80a-fd0e-4314-a3c2-da8498dc9114', 'crm.opportunities.view', 'View sales pipelines, opportunities, and forecast values', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('575f9eac-99ea-4c34-9421-a8ef8f374c79', 'crm.opportunities.manage', 'Create and update CRM opportunities and stakeholders', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('23588382-18d9-4cb0-bdb7-69b867a88484', 'crm.opportunities.transition', 'Move opportunities between pipeline stages and outcomes', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('6d7e3bd4-e883-470c-8130-b396efd357d8', 'crm.opportunities.sensitive_values', 'View and update sensitive opportunity values', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('db893568-3766-4250-997f-9f508240aef4', 'crm.activities.view', 'View CRM activities, appointments, and next actions', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('48494703-cfe3-4b4f-a18a-f78b916101e9', 'crm.activities.manage', 'Create and update CRM activities and appointments', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('552be8fc-8463-43c5-b1da-b7b84e94a33d', 'crm.communications.view', 'View CRM conversations and messages', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('335ca6e0-9fa6-43f0-acc3-6fed25f55ccb', 'crm.communications.send', 'Send approved customer communications', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('56d2c4e3-8fc9-45d7-a52a-9cd1755ab1fd', 'crm.settings.manage', 'Manage CRM pipelines, taxonomies, forms, fields, queues, and SLA policies', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('1701b813-203f-473a-bccc-60c825f6afd1', 'crm.automations.view', 'View CRM automation definitions and execution history', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('f95d3403-72e6-4016-85e6-2a34dfdb90d2', 'crm.automations.manage', 'Create, publish, pause, and replay CRM automations', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('8e2c381b-07ca-429d-96d0-19a8fdfb17d9', 'crm.automations.publish', 'Publish, pause, and approve CRM automations', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('17bd7fdb-264b-44cb-9364-10860b496b40', 'crm.notifications.view', 'View CRM notifications and delivery state', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('d6202dd4-ae39-49bc-a449-a758bf8e3a26', 'crm.notifications.manage', 'Manage CRM notification policies and templates', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('5bac6c06-d01a-4015-af64-1d15987ffa05', 'crm.reports.view', 'View CRM funnel, SLA, attribution, assignment, and forecast reports', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('8e4c70a2-2582-4542-afb6-316fb137570d', 'crm.privacy.erase', 'Authorize regulated CRM data pseudonymization', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('330853fe-5854-4f16-a3e8-518d265b0dd3', 'module.organization.read', 'Read all organization profile features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('2a0fbe0e-00a1-415c-8d66-eda140aef03d', 'module.organization.write', 'Create across all organization profile features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('34c5a7ff-4979-4705-b08f-064c57bdd436', 'module.organization.edit', 'Edit across all organization profile features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('bba99052-d3f8-473e-9d72-00d30ae437b6', 'module.organization.delete', 'Delete across all organization profile features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('7a3852e4-1b43-4ef0-ad72-232088c5045a', 'module.members.read', 'Read all member features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('fe8de567-5fba-4ea9-a57c-878ba815e19a', 'module.members.write', 'Create across all member features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('0f1b2ad0-9102-48bd-bb11-04c4b52e1479', 'module.members.edit', 'Edit across all member features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('cbbfc940-5b2b-492b-b012-1a389ed1042b', 'module.members.delete', 'Delete across all member features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('f54482c7-0cb8-4b29-a25b-ee979a1a33c7', 'module.teams.read', 'Read all team and business unit features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('136136a2-d25c-47e6-911f-0cd61284ba2f', 'module.teams.write', 'Create across all team and business unit features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('2aa05d0b-ddc1-4489-b515-13e0cced39e0', 'module.teams.edit', 'Edit across all team and business unit features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('faac6fef-c8de-433c-9d2e-743e7b87a716', 'module.teams.delete', 'Delete across all team and business unit features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('e4e3fddb-2dcf-4e97-b786-934322657843', 'module.roles.read', 'Read all role and permission features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('bd6a40b5-dd21-40a1-8740-1b56814222b7', 'module.roles.write', 'Create across all role and permission features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('b96deaf3-dc80-4625-85a5-8037ff4f48a3', 'module.roles.edit', 'Edit across all role and permission features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('eec92cc7-6f81-43e3-9a59-db124c55f50c', 'module.roles.delete', 'Delete across all role and permission features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('905b7130-6b1b-4eac-9ff2-42962de45551', 'module.integrations.read', 'Read all integration features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('e8e72d0d-fa90-4945-9537-591e5a177a48', 'module.integrations.write', 'Create across all integration features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('eff41fdc-8615-481c-b8c5-6050fe93f278', 'module.integrations.edit', 'Edit across all integration features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('08cef40d-ab44-42c3-920f-ffc109b8d6dc', 'module.integrations.delete', 'Delete across all integration features', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('41ff7314-14fd-4e1b-a2ae-2e12cc7735b0', 'pre_projects.view', 'View pre-project cases and their linked CRM context', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('0ca8b77c-009b-49a6-8002-ab1d55b51c39', 'pre_projects.create', 'Start a pre-project from an existing CRM opportunity', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('818a9311-8b7d-4a34-aca9-5a508a6f4d2a', 'catalog.view', 'View workspace catalog and use master data in operations', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('bd09b130-0aa2-4dc7-b15e-ba58ee581d8e', 'catalog.manage', 'Manage workspace catalog, starter data and specifications', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('be5c5b90-86ee-4ec8-b5a0-5634a5612e4d', 'hrms.self', 'Use own employee attendance, leave and history when enrolled', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('033a5ff6-9fd6-41b9-b3ac-fdee5da7ff65', 'hrms.team', 'Review attendance and leave for direct reports', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('d0dcd4b7-62a3-4336-bfb9-692d3c5d81b6', 'hrms.manage', 'Manage employee HRMS settings and organization attendance', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('19f57ff1-ed62-4967-b6b6-c5fd402824fe', 'hrms.evidence', 'Read private attendance photos for authorized employee scope', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('a719db0c-337c-4c0f-bf9a-9f52e45fe099', 'projects.view', 'View assigned delivery projects and site attendance', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('0a128338-ddf5-4313-8631-c07b52e207de', 'projects.manage', 'Release delivery project identities and manage sites and assignments', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('4340b50f-42b0-44e5-a3c3-ace3a13630d6', 'pre_projects.edit', 'Edit pre-project briefs, rooms, requirements and reference files', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('b48a6a8b-e413-49f3-8ea1-072bf98ef4b3', 'pre_projects.verify_measurements', 'Verify site measurements and request a recheck', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('04d62a2e-1e9f-4948-8761-b43083236df7', 'commercial.approve', 'Approve quotation pricing and verify agreement/payment evidence', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('aa21ea58-dc37-4e4d-a5b5-5057915a1024', 'commercial.release', 'Authorize commercial execution readiness', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('3bbf2c8e-757c-4e66-b7bc-ad5d25279f8f', 'portal.manage', 'Manage client portal branding and client access', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('aa8179fb-7c29-4bed-96a9-02f876bd3e26', 'pre_projects.review_designs', 'Review assigned internal design revisions', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('4b23f3f5-320a-42a8-bcc7-5d97d67d4c68', 'pre_projects.record_client_design_decisions', 'Record attributed client design decisions received outside the portal', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('1cdfec88-610f-4ab5-9345-c063d890a46c', 'projects.report', 'Submit progress on assigned project work', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('f0ecb82b-6734-4f0a-a1a0-003ffd1a54b1', 'projects.review', 'Review project reports, inspections and handovers', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('f9971f24-528c-4e88-a8cb-1d04d8ed3278', 'projects.buy', 'Manage project procurement', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('ca5ff721-f4ff-468f-a9ac-6898c2a754be', 'projects.schedule.view', 'View permitted project schedules and availability', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('66cda5cd-3483-425f-a181-4b97436f23fa', 'projects.schedule.manage', 'Manage permitted project resources and bookings', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('8ef53d0a-aa9e-49f7-8b08-4ed7af9cc5f8', 'projects.schedule.override', 'Approve documented working-calendar exceptions', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('3e2ad22c-9789-4aa6-8f16-408af1a6bd30', 'pre_projects.manage_lifecycle', 'Manage pre-execution ownership, priority, risk, phase, hold and cancellation lifecycle', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('11fcc34f-bf36-4fcc-990e-7f6fe26e5a7c', 'vendors.view', 'View the workspace vendor directory and vendor locations', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('43b880df-f3d7-4850-aac4-a3e7478cdb04', 'vendors.manage', 'Create and maintain workspace vendors and vendor locations', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('c7570ba8-4438-4b05-99a3-cad5962b76cc', 'supplier_offers.view', 'View supplier costs and commercial sourcing terms', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('10f9689a-42fc-41a3-af7c-500ac7ed6787', 'supplier_offers.manage', 'Create and maintain supplier offers', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('b9d0cb36-c862-4102-a287-22b66bd40424', 'commercial.override_price', 'Override catalog selling prices with a recorded reason', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('382773a4-c7ad-430c-96df-c0c49f2b73fb', 'pre_projects.publish_definition', 'Publish an immutable requirements and design definition for client confirmation', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('4ef6cb03-7fa4-4cad-843a-569cdb9d120c', 'pre_projects.record_client_definition_decisions', 'Record attributed client definition decisions received outside the portal', '2026-09-16 10:46:31.209228+05:30');
INSERT INTO public.permissions VALUES ('4a0741b2-2e80-4f46-9e91-dc71a669b1a1', 'jobs.repair', 'Review and restore a missing or detached Job source link', '2026-09-18 09:57:34.824601+05:30');
INSERT INTO public.permissions VALUES ('d0b38cad-8523-4ae4-9367-2a91636a9079', 'commercial.costs.view', 'View internal quotation costs and gross margin', '2026-09-18 09:57:34.824601+05:30');
INSERT INTO public.permissions VALUES ('c414d169-1bab-4f02-859b-cdd1ebad5674', 'commercial.costs.manage', 'Edit internal quotation costs', '2026-09-18 09:57:34.824601+05:30');
INSERT INTO public.permissions VALUES ('3639815c-5d89-4cd2-837d-8bd2045b6050', 'commercial.finance.verify', 'Verify commercial receipts, allocations and client credit records', '2026-09-18 09:57:34.824601+05:30');
INSERT INTO public.permissions VALUES ('c57d7db3-fb7f-47de-b12f-a83d8eb4532b', 'jobs.stage.manage', 'Set an audited operating stage within the Job derived phase', '2026-09-18 09:57:34.824601+05:30');
INSERT INTO public.permissions VALUES ('224c408f-0032-413f-a156-db662bc5e1ca', 'ai.suggestions.use', 'Create and review evidence-backed AI suggestions without applying source-record changes', '2026-09-18 10:59:59.212767+05:30');
INSERT INTO public.permissions VALUES ('f0980ebd-8df0-48bf-a571-3ce02f59791c', 'commercial.deal.approve', 'Approve a Finance-verified Deal File without quotation approval access', '2026-09-24 04:31:41.912908+05:30');
INSERT INTO public.permissions VALUES ('ff6d5d10-0947-4fa6-8cae-90ceb7290eb7', 'commercial.estimate', 'Review and approve the cost estimate for a quotation before client issue', '2026-09-24 23:46:22.540607+05:30');


--
-- Data for Name: tenant_setup_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tenant_setup_profiles VALUES ('plan', 'starter', 1, '{"status": "trial_default", "seatLimit": 5, "billingCycle": "monthly", "projectLimit": 25}', '2026-09-17 20:28:44.550843+05:30', true);
INSERT INTO public.tenant_setup_profiles VALUES ('firm_kit', 'blank', 1, '{"label": "Blank"}', '2026-09-17 20:28:44.550843+05:30', false);
INSERT INTO public.tenant_setup_profiles VALUES ('firm_kit', 'design_build', 1, '{"label": "Design & build"}', '2026-09-17 20:28:44.550843+05:30', false);
INSERT INTO public.tenant_setup_profiles VALUES ('firm_kit', 'fitout_contractor', 1, '{"label": "Fit-out contractor"}', '2026-09-17 20:28:44.550843+05:30', false);
INSERT INTO public.tenant_setup_profiles VALUES ('firm_kit', 'interior_studio', 1, '{"label": "Interior design studio"}', '2026-09-17 20:28:44.550843+05:30', false);
INSERT INTO public.tenant_setup_profiles VALUES ('firm_kit', 'joinery_furniture', 1, '{"label": "Joinery / furniture"}', '2026-09-17 20:28:44.550843+05:30', false);
INSERT INTO public.tenant_setup_profiles VALUES ('region', 'AE', 1, '{"locale": "en-AE", "currency": "AED", "timezone": "Asia/Dubai", "unitSystem": "metric", "countryCode": "AE", "weekStartsOn": 1}', '2026-09-17 20:28:44.550843+05:30', false);
INSERT INTO public.tenant_setup_profiles VALUES ('region', 'IN', 1, '{"locale": "en-IN", "currency": "INR", "timezone": "Asia/Kolkata", "unitSystem": "metric", "countryCode": "IN", "weekStartsOn": 1}', '2026-09-17 20:28:44.550843+05:30', false);
INSERT INTO public.tenant_setup_profiles VALUES ('region', 'AE', 2, '{"locale": "en-AE", "currency": "AED", "timezone": "Asia/Dubai", "taxPolicy": {"rates": [], "status": "requires_validation", "version": 1}, "unitSystem": "metric", "countryCode": "AE", "weekStartsOn": 1, "privacyPolicy": {"status": "requires_validation", "version": 1, "noticeTemplate": null}, "calendarPolicy": {"version": 1, "workingDays": [1, 2, 3, 4, 5], "holidayCalendar": "tenant_configured"}, "providerPolicy": {"version": 1, "defaults": {}, "connectionsRequired": true}, "regulatoryStatus": "requires_validation"}', '2026-09-18 12:45:24.263128+05:30', true);
INSERT INTO public.tenant_setup_profiles VALUES ('region', 'IN', 2, '{"locale": "en-IN", "currency": "INR", "timezone": "Asia/Kolkata", "taxPolicy": {"rates": [], "status": "requires_validation", "version": 1}, "unitSystem": "metric", "countryCode": "IN", "weekStartsOn": 1, "privacyPolicy": {"status": "requires_validation", "version": 1, "noticeTemplate": null}, "calendarPolicy": {"version": 1, "workingDays": [1, 2, 3, 4, 5], "holidayCalendar": "tenant_configured"}, "providerPolicy": {"version": 1, "defaults": {}, "connectionsRequired": true}, "regulatoryStatus": "requires_validation"}', '2026-09-18 12:45:24.263128+05:30', true);
INSERT INTO public.tenant_setup_profiles VALUES ('firm_kit', 'design_build', 2, '{"label": "Design & build", "projectWorkflow": {"code": "standard_delivery", "name": "Standard project delivery", "stages": [{"key": "planning", "phase": "planning", "exitGates": ["project_manager_assigned", "tasks_planned"], "ownerRole": "project_manager", "description": "Confirm ownership and turn the released scope into executable work.", "visibleName": "Planning"}, {"key": "delivery", "phase": "active", "exitGates": ["all_tasks_closed", "all_snags_closed"], "ownerRole": "project_manager", "description": "Coordinate design, sourcing, production and site work as overlapping work packages.", "visibleName": "Delivery"}, {"key": "handover", "phase": "handover", "exitGates": ["all_handovers_accepted", "finance_closed"], "ownerRole": "project_manager", "description": "Complete client acceptance and financial reconciliation.", "visibleName": "Handover"}, {"key": "completed", "phase": "completed", "exitGates": [], "ownerRole": null, "description": "Keep the closed project available as an auditable record.", "visibleName": "Completed"}], "version": 1, "isDefault": true, "description": "A neutral project lifecycle. Detailed work packages can overlap inside Delivery."}}', '2026-09-17 20:58:49.633629+05:30', false);
INSERT INTO public.tenant_setup_profiles VALUES ('firm_kit', 'design_build', 3, '{"label": "Design & build", "projectWorkflow": {"code": "standard_delivery", "name": "Standard project delivery", "stages": [{"key": "planning", "phase": "planning", "exitGates": ["project_manager_assigned", "tasks_planned"], "ownerRole": "project_manager", "description": "Confirm ownership and turn the released scope into executable work.", "visibleName": "Planning"}, {"key": "delivery", "phase": "active", "exitGates": ["all_tasks_closed", "all_snags_closed"], "ownerRole": "project_manager", "description": "Coordinate design, sourcing, production and site work as overlapping work packages.", "visibleName": "Delivery"}, {"key": "handover", "phase": "handover", "exitGates": ["all_handovers_accepted", "finance_closed"], "ownerRole": "project_manager", "description": "Complete client acceptance and financial reconciliation.", "visibleName": "Handover"}, {"key": "completed", "phase": "completed", "exitGates": [], "ownerRole": null, "description": "Keep the closed project available as an auditable record.", "visibleName": "Completed"}], "version": 1, "isDefault": true, "description": "A neutral project lifecycle. Detailed work packages can overlap inside Delivery."}, "applicableJobSections": ["overview", "discovery", "design", "scope", "quote", "agreement", "delivery", "handover", "money", "files", "timeline"]}', '2026-09-18 12:45:24.263128+05:30', true);
INSERT INTO public.tenant_setup_profiles VALUES ('firm_kit', 'interior_studio', 2, '{"label": "Interior design studio", "projectWorkflow": {"code": "studio_delivery", "name": "Studio delivery", "stages": [{"key": "planning", "phase": "planning", "exitGates": ["project_manager_assigned", "tasks_planned"], "ownerRole": "project_manager", "description": "Confirm the design engagement, owner and work plan.", "visibleName": "Plan"}, {"key": "design_delivery", "phase": "active", "exitGates": ["all_tasks_closed", "all_snags_closed"], "ownerRole": "senior_designer", "description": "Coordinate the agreed design deliverables and review work.", "visibleName": "Design delivery"}, {"key": "handover", "phase": "handover", "exitGates": ["all_handovers_accepted", "finance_closed"], "ownerRole": "project_manager", "description": "Issue the accepted design pack and reconcile the engagement.", "visibleName": "Design handover"}, {"key": "completed", "phase": "completed", "exitGates": [], "ownerRole": null, "description": "Keep the engagement as an auditable record.", "visibleName": "Completed"}], "version": 1, "isDefault": true, "description": "Design-led work without invented procurement, manufacturing or site-delivery stages."}, "applicableJobSections": ["overview", "discovery", "design", "scope", "quote", "agreement", "handover", "money", "files", "timeline"]}', '2026-09-18 12:45:24.263128+05:30', true);
INSERT INTO public.tenant_setup_profiles VALUES ('firm_kit', 'fitout_contractor', 2, '{"label": "Fit-out contractor", "projectWorkflow": {"code": "fitout_delivery", "name": "Fit-out delivery", "stages": [{"key": "planning", "phase": "planning", "exitGates": ["project_manager_assigned", "tasks_planned"], "ownerRole": "project_manager", "description": "Confirm ownership, released scope and executable work.", "visibleName": "Pre-start"}, {"key": "mobilisation", "phase": "active", "exitGates": [], "ownerRole": "project_manager", "description": "Coordinate access, team and site readiness.", "visibleName": "Mobilisation"}, {"key": "site_delivery", "phase": "active", "exitGates": ["all_tasks_closed", "all_snags_closed"], "ownerRole": "project_manager", "description": "Deliver and inspect the released work packages.", "visibleName": "Site delivery"}, {"key": "handover", "phase": "handover", "exitGates": ["all_handovers_accepted", "finance_closed"], "ownerRole": "project_manager", "description": "Complete acceptance and final reconciliation.", "visibleName": "Handover"}, {"key": "completed", "phase": "completed", "exitGates": [], "ownerRole": null, "description": "Keep the closed project as an auditable record.", "visibleName": "Completed"}], "version": 1, "isDefault": true, "description": "Mobilisation, coordinated site delivery and controlled handover."}, "applicableJobSections": ["overview", "discovery", "design", "scope", "quote", "agreement", "delivery", "handover", "money", "files", "timeline"]}', '2026-09-18 12:45:24.263128+05:30', true);
INSERT INTO public.tenant_setup_profiles VALUES ('firm_kit', 'joinery_furniture', 2, '{"label": "Joinery / furniture", "projectWorkflow": {"code": "joinery_delivery", "name": "Joinery delivery", "stages": [{"key": "planning", "phase": "planning", "exitGates": ["project_manager_assigned", "tasks_planned"], "ownerRole": "project_manager", "description": "Confirm ownership, approved details and production work.", "visibleName": "Technical release"}, {"key": "production", "phase": "active", "exitGates": [], "ownerRole": "procurement_production", "description": "Coordinate materials, factory output and quality evidence.", "visibleName": "Production"}, {"key": "delivery", "phase": "active", "exitGates": ["all_tasks_closed", "all_snags_closed"], "ownerRole": "project_manager", "description": "Receive, install, inspect and close defects.", "visibleName": "Delivery & installation"}, {"key": "handover", "phase": "handover", "exitGates": ["all_handovers_accepted", "finance_closed"], "ownerRole": "project_manager", "description": "Complete acceptance, care information and final reconciliation.", "visibleName": "Handover"}, {"key": "completed", "phase": "completed", "exitGates": [], "ownerRole": null, "description": "Keep the closed order as an auditable record.", "visibleName": "Completed"}], "version": 1, "isDefault": true, "description": "Technical release, production, delivery and installation without forcing unrelated fit-out work."}, "applicableJobSections": ["overview", "discovery", "design", "scope", "quote", "agreement", "delivery", "handover", "money", "files", "timeline"]}', '2026-09-18 12:45:24.263128+05:30', true);
INSERT INTO public.tenant_setup_profiles VALUES ('firm_kit', 'blank', 2, '{"label": "Blank", "projectWorkflow": {"code": "blank_delivery", "name": "Blank delivery", "stages": [{"key": "planning", "phase": "planning", "exitGates": ["project_manager_assigned", "tasks_planned"], "ownerRole": "project_manager", "description": "Confirm ownership and plan only the work that applies.", "visibleName": "Planning"}, {"key": "work", "phase": "active", "exitGates": ["all_tasks_closed", "all_snags_closed"], "ownerRole": "project_manager", "description": "Coordinate the configured work and its quality records.", "visibleName": "Work"}, {"key": "closeout", "phase": "handover", "exitGates": ["all_handovers_accepted", "finance_closed"], "ownerRole": "project_manager", "description": "Complete configured acceptance and financial reconciliation.", "visibleName": "Closeout"}, {"key": "completed", "phase": "completed", "exitGates": [], "ownerRole": null, "description": "Keep the closed work as an auditable record.", "visibleName": "Completed"}], "version": 1, "isDefault": true, "description": "A neutral starting point that adds no design, factory or site-specific stages."}, "applicableJobSections": ["overview", "scope", "quote", "agreement", "delivery", "handover", "money", "files", "timeline"]}', '2026-09-18 12:45:24.263128+05:30', true);


--
-- PostgreSQL database dump complete
--

