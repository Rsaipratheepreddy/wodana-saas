-- Wodana's own "Contact sales" form (the public website, not a tenant). Platform-level records: no
-- workspace_id. Like the other control-plane tables they are read and changed by Wodana operators only
-- (forced RLS with the platform_operator_access policy), and the public form gets exactly what it needs:
-- it reads the current form version, inserts a new enquiry, and records the notices for the enquiry it
-- just created (identified by app.current_sales_enquiry_id in its own transaction).

-- The form configuration is versioned: every save is a new immutable version, the highest is current.
CREATE TABLE sales_contact_form_versions (
  version integer PRIMARY KEY CHECK (version > 0),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
  idempotency_key varchar(160),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (version = 1 OR created_by IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_contact_form_versions_key_uidx
  ON sales_contact_form_versions (idempotency_key) WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint

-- One row per enquiry. The answers are columns; the consent text and the team-size label are the
-- words the person saw when they sent it.
CREATE TABLE sales_enquiries (
  id uuid PRIMARY KEY,
  number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  request_key varchar(80) NOT NULL UNIQUE,
  form_version integer NOT NULL REFERENCES sales_contact_form_versions(version),
  name varchar(160) NOT NULL CHECK (length(btrim(name)) > 0),
  email citext NOT NULL CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  company varchar(200),
  country_code char(2) CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  phone varchar(20) CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,15}$'),
  team_size varchar(40),
  team_size_label varchar(120),
  message varchar(4000),
  consent_text varchar(500) NOT NULL,
  consented_at timestamptz NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost')),
  assignee_user_id uuid REFERENCES users(id),
  source varchar(40) NOT NULL DEFAULT 'website' CHECK (source ~ '^[a-z0-9_-]{1,40}$'),
  page_path varchar(300),
  referrer varchar(500),
  utm_source varchar(150),
  utm_medium varchar(150),
  utm_campaign varchar(150),
  utm_term varchar(150),
  utm_content varchar(150),
  locale varchar(35),
  requester_hash char(64),
  contacted_at timestamptz,
  qualified_at timestamptz,
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('won', 'lost') OR closed_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX sales_enquiries_status_created_idx ON sales_enquiries (status, created_at DESC);
--> statement-breakpoint
CREATE INDEX sales_enquiries_created_idx ON sales_enquiries (created_at DESC);
--> statement-breakpoint
CREATE INDEX sales_enquiries_requester_idx ON sales_enquiries (requester_hash, created_at DESC) WHERE requester_hash IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER sales_enquiries_set_updated_at BEFORE UPDATE ON sales_enquiries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- Operator notes: one row each, never edited.
CREATE TABLE sales_enquiry_notes (
  id uuid PRIMARY KEY,
  enquiry_id uuid NOT NULL REFERENCES sales_enquiries(id) ON DELETE CASCADE,
  body varchar(2000) NOT NULL CHECK (length(btrim(body)) > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX sales_enquiry_notes_enquiry_idx ON sales_enquiry_notes (enquiry_id, created_at);
--> statement-breakpoint

-- Who was told about a new enquiry, one row per recipient and channel, with its own delivery status
-- ("sent" only with a provider receipt).
CREATE TABLE sales_enquiry_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id uuid NOT NULL REFERENCES sales_enquiries(id) ON DELETE CASCADE,
  channel varchar(20) NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  recipient_email citext NOT NULL,
  subject varchar(200) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'not_configured')),
  suppressed_reason varchar(40),
  provider varchar(40),
  provider_message_id varchar(255),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enquiry_id, channel, recipient_email)
);
--> statement-breakpoint
CREATE TRIGGER sales_enquiry_notices_set_updated_at BEFORE UPDATE ON sales_enquiry_notices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- Row security: operators read and change everything; the public form reads the configuration,
-- inserts a new enquiry and handles its own enquiry's notices.
ALTER TABLE sales_contact_form_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_contact_form_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_enquiries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_enquiries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_enquiry_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_enquiry_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_enquiry_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales_enquiry_notices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_operator_access ON sales_contact_form_versions
  USING (EXISTS (SELECT 1 FROM platform_administrators operator
    WHERE operator.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid AND operator.status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM platform_administrators operator
    WHERE operator.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid AND operator.status = 'active'));
--> statement-breakpoint
CREATE POLICY public_form_read ON sales_contact_form_versions FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY platform_operator_access ON sales_enquiries
  USING (EXISTS (SELECT 1 FROM platform_administrators operator
    WHERE operator.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid AND operator.status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM platform_administrators operator
    WHERE operator.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid AND operator.status = 'active'));
--> statement-breakpoint
CREATE POLICY public_submission_insert ON sales_enquiries FOR INSERT
  WITH CHECK (id = NULLIF(current_setting('app.current_sales_enquiry_id', true), '')::uuid
    AND status = 'new' AND version = 1 AND assignee_user_id IS NULL AND updated_by IS NULL
    AND contacted_at IS NULL AND qualified_at IS NULL AND closed_at IS NULL);
--> statement-breakpoint
CREATE POLICY public_submission_read ON sales_enquiries FOR SELECT
  USING (id = NULLIF(current_setting('app.current_sales_enquiry_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY platform_operator_access ON sales_enquiry_notes
  USING (EXISTS (SELECT 1 FROM platform_administrators operator
    WHERE operator.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid AND operator.status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM platform_administrators operator
    WHERE operator.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid AND operator.status = 'active'));
--> statement-breakpoint
CREATE POLICY platform_operator_access ON sales_enquiry_notices
  USING (EXISTS (SELECT 1 FROM platform_administrators operator
    WHERE operator.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid AND operator.status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM platform_administrators operator
    WHERE operator.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid AND operator.status = 'active'));
--> statement-breakpoint
CREATE POLICY submission_notices ON sales_enquiry_notices
  USING (enquiry_id = NULLIF(current_setting('app.current_sales_enquiry_id', true), '')::uuid)
  WITH CHECK (enquiry_id = NULLIF(current_setting('app.current_sales_enquiry_id', true), '')::uuid);
--> statement-breakpoint

-- The public rate limit counts recent enquiries without reading any of them.
CREATE FUNCTION sales_enquiry_recent_submissions(requester char(64), window_minutes integer)
RETURNS TABLE (from_requester integer, total integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*) FILTER (WHERE enquiry.requester_hash = requester)::integer, count(*)::integer
    FROM sales_enquiries enquiry
   WHERE enquiry.created_at > now() - make_interval(mins => GREATEST(1, LEAST(window_minutes, 1440)))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sales_enquiry_recent_submissions(char, integer) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT ON sales_contact_form_versions TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON sales_enquiries TO wodana_app;
    GRANT SELECT, INSERT ON sales_enquiry_notes TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON sales_enquiry_notices TO wodana_app;
    GRANT EXECUTE ON FUNCTION sales_enquiry_recent_submissions(char, integer) TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint

-- Version 1: every field on, the essentials required, labels from the product's own (translated) copy,
-- and no recipients until an operator adds them.
INSERT INTO sales_contact_form_versions (version, configuration) VALUES (1, '{
  "fields": {
    "name": { "enabled": true, "required": true, "label": null },
    "email": { "enabled": true, "required": true, "label": null },
    "company": { "enabled": true, "required": true, "label": null },
    "country": { "enabled": true, "required": true, "label": null },
    "phone": { "enabled": true, "required": false, "label": null },
    "teamSize": { "enabled": true, "required": false, "label": null },
    "message": { "enabled": true, "required": false, "label": null }
  },
  "teamSizes": [
    { "id": "1-10", "label": "1–10" },
    { "id": "11-50", "label": "11–50" },
    { "id": "51-200", "label": "51–200" },
    { "id": "201-plus", "label": "201+" }
  ],
  "consentLabel": null,
  "thankYouTitle": null,
  "thankYouMessage": null,
  "recipients": []
}'::jsonb);
