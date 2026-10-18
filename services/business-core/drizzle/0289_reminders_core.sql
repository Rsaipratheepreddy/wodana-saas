-- Reminder engine (E4) and My day (plan §6.24a): one subject per thing that is due, one step per reminder or
-- escalation, firm rules per kind, firm and personal settings, and the personal digest.
--   * reminder_rules (keep): one row per firm and kind; no row = the contract default
--     (REMINDER_KIND_DEFAULTS in packages/contracts/src/reminders.ts). Critical kinds can't be switched off;
--     the service enforces it from the contract.
--   * reminder_settings (keep): one per workspace (quiet hours, digest time, client window).
--   * notification_person_settings (keep): one per member (digest, quiet hours, time zone).
--   * reminder_subjects (clear): UNIQUE (workspace, kind, source key). Closed only by the source's done predicate.
--   * reminder_steps (clear): UNIQUE (workspace, subject, due revision, step key), the idempotency key.
--   * reminder_digests (clear): one per member and local date.
--   * notifications gains the step it belongs to, the critical flag (mutes ignored), the notice it falls back
--     from and when the provider accepted it; and FORCE ROW LEVEL SECURITY (it was enabled, not forced).
-- Every new table has workspace_id, forced RLS with tenant_isolation and composite foreign keys with
-- workspace_id. Never disables RLS.

-- 0. Helpers for array checks (no subqueries in CHECK constraints).
CREATE FUNCTION reminders_strictly_ascending(value integer[]) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(bool_and(item.current < item.next), true)
    FROM (SELECT value[i] AS current, value[i + 1] AS next FROM generate_subscripts(value, 1) AS i WHERE i < array_upper(value, 1)) item
$$;
--> statement-breakpoint
CREATE FUNCTION reminders_distinct_text(value text[]) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT cardinality(value) = (SELECT count(DISTINCT item) FROM unnest(value) item)
$$;
--> statement-breakpoint
-- Composite foreign keys need (workspace_id, id) keys on the parents that don't have one yet.
CREATE UNIQUE INDEX IF NOT EXISTS crm_parties_workspace_id_id_uidx ON crm_parties (workspace_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS notifications_workspace_id_id_uidx ON notifications (workspace_id, id);
--> statement-breakpoint
-- 1. Firm rules, one row per kind the engine sends.
CREATE TABLE reminder_rules (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind varchar(60) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  offsets integer[] NOT NULL,
  unit varchar(10) NOT NULL DEFAULT 'day',
  working_days boolean NOT NULL DEFAULT false,
  escalate_after smallint,
  chain text[] NOT NULL DEFAULT '{}',
  channels text[] NOT NULL,
  digest boolean NOT NULL DEFAULT false,
  quiet_hours jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, kind),
  CONSTRAINT reminder_rules_kind_check CHECK (kind IN ('work.due', 'crm.follow_up', 'approval.waiting', 'client.quote_decision',
    'client.design_decision', 'quote.expiring', 'payment.due', 'invoice.overdue', 'payables.due', 'purchase.order_late',
    'design.stage_due', 'permit.expiry', 'finance_request.waiting')),
  CONSTRAINT reminder_rules_unit_check CHECK (unit IN ('day', 'hour')),
  CONSTRAINT reminder_rules_offsets_check CHECK (cardinality(offsets) BETWEEN 1 AND 6 AND array_position(offsets, NULL) IS NULL
    AND reminders_strictly_ascending(offsets)
    AND ((unit = 'day' AND -90 <= ALL (offsets) AND 90 >= ALL (offsets)) OR (unit = 'hour' AND -720 <= ALL (offsets) AND 720 >= ALL (offsets)))),
  CONSTRAINT reminder_rules_escalate_after_check CHECK (escalate_after IS NULL OR escalate_after BETWEEN 1 AND 6),
  CONSTRAINT reminder_rules_chain_check CHECK (cardinality(chain) <= 3 AND chain <@ ARRAY['manager', 'project_manager', 'finance', 'purchasing', 'owner']::text[]
    AND reminders_distinct_text(chain)),
  CONSTRAINT reminder_rules_channels_check CHECK (cardinality(channels) BETWEEN 1 AND 4 AND channels <@ ARRAY['in_app', 'push', 'email', 'whatsapp']::text[]
    AND reminders_distinct_text(channels)),
  CONSTRAINT reminder_rules_quiet_hours_check CHECK (quiet_hours IS NULL OR (jsonb_typeof(quiet_hours) = 'object'
    AND quiet_hours->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND quiet_hours->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
);
--> statement-breakpoint
-- 2. Firm settings, one row per workspace (no row = 20:00 to 08:00 quiet, digest at 08:00, work-calendar hours).
CREATE TABLE reminder_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  quiet_start time NOT NULL DEFAULT '20:00',
  quiet_end time NOT NULL DEFAULT '08:00',
  digest_time time NOT NULL DEFAULT '08:00',
  client_window_start time,
  client_window_end time,
  critical_breaks_quiet boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_settings_client_window_check CHECK ((client_window_start IS NULL) = (client_window_end IS NULL)
    AND (client_window_start IS NULL OR client_window_start < client_window_end))
);
--> statement-breakpoint
-- 3. Personal settings, one row per member (null = the firm's value).
CREATE TABLE notification_person_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  membership_id uuid NOT NULL,
  digest_enabled boolean NOT NULL DEFAULT true,
  digest_time time,
  quiet_start time,
  quiet_end time,
  time_zone varchar(64),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, membership_id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES workspace_memberships (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT notification_person_settings_quiet_check CHECK ((quiet_start IS NULL) = (quiet_end IS NULL)),
  CONSTRAINT notification_person_settings_time_zone_check CHECK (time_zone IS NULL OR time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,63}$')
);
--> statement-breakpoint
-- 4. One subject per thing that is due. The source key is the source's own identity for it (e.g. a work item
--    and its assignee); the subject closes only when the source's done predicate says so.
CREATE TABLE reminder_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind varchar(60) NOT NULL,
  source_key varchar(200) NOT NULL CHECK (length(btrim(source_key)) > 0),
  source_type varchar(60) NOT NULL CHECK (source_type ~ '^[a-z][a-z0-9_]{0,59}$'),
  source_id varchar(200) NOT NULL CHECK (length(btrim(source_id)) > 0),
  job_id uuid,
  project_id uuid,
  case_id uuid,
  party_id uuid,
  audience varchar(10) NOT NULL,
  critical boolean NOT NULL DEFAULT false,
  owner_membership_id uuid,
  cc_membership_ids uuid[] NOT NULL DEFAULT '{}',
  title varchar(300) NOT NULL CHECK (length(btrim(title)) > 0),
  context varchar(500) NOT NULL DEFAULT '',
  href varchar(500) NOT NULL CHECK (href ~ '^/(workspace|portal)(/|\?|$)'),
  variables jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(variables) = 'object'),
  due_at timestamptz,
  due_revision integer NOT NULL DEFAULT 1 CHECK (due_revision > 0),
  status varchar(20) NOT NULL DEFAULT 'open',
  snoozed_until timestamptz,
  snooze_reason varchar(300),
  snoozed_by uuid REFERENCES users (id),
  reminders_sent integer NOT NULL DEFAULT 0 CHECK (reminders_sent >= 0),
  escalation_level smallint NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 6),
  last_step_at timestamptz,
  checked_at timestamptz,
  done_at timestamptz,
  done_reason varchar(20),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CONSTRAINT reminder_subjects_source_key UNIQUE (workspace_id, kind, source_key),
  FOREIGN KEY (workspace_id, job_id) REFERENCES job_identities (workspace_id, id) ON DELETE SET NULL (job_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE SET NULL (project_id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE SET NULL (case_id),
  FOREIGN KEY (workspace_id, party_id) REFERENCES crm_parties (workspace_id, id) ON DELETE SET NULL (party_id),
  FOREIGN KEY (workspace_id, owner_membership_id) REFERENCES workspace_memberships (workspace_id, id),
  CONSTRAINT reminder_subjects_kind_check CHECK (kind IN ('work.due', 'crm.follow_up', 'approval.waiting', 'client.quote_decision',
    'client.design_decision', 'quote.expiring', 'payment.due', 'invoice.overdue', 'payables.due', 'purchase.order_late',
    'design.stage_due', 'permit.expiry', 'finance_request.waiting', 'crm.first_response', 'crm.unowned', 'crm.confirm_client',
    'crm.reply_waiting', 'site.daily_report', 'factory.production_due', 'books.posting_issue')),
  CONSTRAINT reminder_subjects_audience_check CHECK (audience IN ('staff', 'client')),
  CONSTRAINT reminder_subjects_status_check CHECK (status IN ('open', 'snoozed', 'done', 'cancelled')),
  CONSTRAINT reminder_subjects_done_reason_check CHECK (done_reason IN ('record', 'source_gone', 'cancelled')),
  CONSTRAINT reminder_subjects_snooze_check CHECK ((status = 'snoozed') = (snoozed_until IS NOT NULL)
    AND (snoozed_until IS NULL OR length(btrim(coalesce(snooze_reason, ''))) > 0)),
  CONSTRAINT reminder_subjects_done_check CHECK ((status IN ('done', 'cancelled')) = (done_at IS NOT NULL)
    AND (done_at IS NULL) = (done_reason IS NULL))
);
--> statement-breakpoint
CREATE INDEX reminder_subjects_open_owner_idx ON reminder_subjects (workspace_id, owner_membership_id, due_at)
  WHERE status IN ('open', 'snoozed');
--> statement-breakpoint
CREATE INDEX reminder_subjects_job_idx ON reminder_subjects (workspace_id, job_id) WHERE job_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX reminder_subjects_open_kind_idx ON reminder_subjects (workspace_id, kind) WHERE status IN ('open', 'snoozed');
--> statement-breakpoint
-- 5. The personal digest: one per member and local date.
CREATE TABLE reminder_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  membership_id uuid NOT NULL,
  digest_date date NOT NULL,
  overdue_count integer NOT NULL DEFAULT 0 CHECK (overdue_count >= 0),
  today_count integer NOT NULL DEFAULT 0 CHECK (today_count >= 0),
  upcoming_count integer NOT NULL DEFAULT 0 CHECK (upcoming_count >= 0),
  waiting_count integer NOT NULL DEFAULT 0 CHECK (waiting_count >= 0),
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  notification_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CONSTRAINT reminder_digests_person_day UNIQUE (workspace_id, membership_id, digest_date),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES workspace_memberships (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
-- 6. Steps: the planned reminders and escalations of a subject's due revision. The timeline on the record.
CREATE TABLE reminder_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  subject_id uuid NOT NULL,
  due_revision integer NOT NULL CHECK (due_revision > 0),
  step_key varchar(20) NOT NULL,
  kind varchar(10) NOT NULL,
  level smallint NOT NULL DEFAULT 0,
  fire_at timestamptz NOT NULL,
  state varchar(20) NOT NULL DEFAULT 'planned',
  skip_reason varchar(30),
  hold_reason varchar(20),
  held_until timestamptz,
  recipient_membership_ids uuid[] NOT NULL DEFAULT '{}',
  fired_at timestamptz,
  digest_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CONSTRAINT reminder_steps_idempotency UNIQUE (workspace_id, subject_id, due_revision, step_key),
  FOREIGN KEY (workspace_id, subject_id) REFERENCES reminder_subjects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, digest_id) REFERENCES reminder_digests (workspace_id, id) ON DELETE SET NULL (digest_id),
  CONSTRAINT reminder_steps_key_check CHECK (step_key ~ '^(r:-?[0-9]{1,3}|e:[1-6])$'),
  CONSTRAINT reminder_steps_kind_check CHECK (kind IN ('remind', 'escalate')),
  CONSTRAINT reminder_steps_level_check CHECK ((kind = 'remind' AND level = 0 AND step_key LIKE 'r:%')
    OR (kind = 'escalate' AND level BETWEEN 1 AND 6 AND step_key = 'e:' || level)),
  CONSTRAINT reminder_steps_state_check CHECK (state IN ('planned', 'held', 'sent', 'digested', 'skipped', 'cancelled')),
  CONSTRAINT reminder_steps_skip_reason_check CHECK (skip_reason IN ('done', 'snoozed', 'consent_missing', 'cap_reached', 'no_recipient', 'muted', 'unreachable', 'disabled')),
  CONSTRAINT reminder_steps_hold_reason_check CHECK (hold_reason IN ('quiet_hours', 'client_cap', 'client_window')),
  CONSTRAINT reminder_steps_skipped_check CHECK ((state = 'skipped') = (skip_reason IS NOT NULL)),
  CONSTRAINT reminder_steps_held_check CHECK ((state = 'held') = (held_until IS NOT NULL AND hold_reason IS NOT NULL)),
  CONSTRAINT reminder_steps_fired_check CHECK ((state IN ('sent', 'digested')) = (fired_at IS NOT NULL)),
  CONSTRAINT reminder_steps_digest_check CHECK (digest_id IS NULL OR state = 'digested')
);
--> statement-breakpoint
-- The fire step's queue: what is planned or held, by when it is due.
CREATE INDEX reminder_steps_due_idx ON reminder_steps (workspace_id, fire_at) WHERE state IN ('planned', 'held');
--> statement-breakpoint
CREATE INDEX reminder_steps_digest_idx ON reminder_steps (workspace_id, digest_id) WHERE digest_id IS NOT NULL;
--> statement-breakpoint
-- 7. Notifications: the step a notice belongs to, the critical flag, the notice it falls back from and when
--    the provider accepted it; the health list reads by status and last change.
ALTER TABLE notifications
  ADD COLUMN reminder_step_id uuid,
  ADD COLUMN critical boolean NOT NULL DEFAULT false,
  ADD COLUMN fallback_of uuid,
  ADD COLUMN accepted_at timestamptz,
  ADD CONSTRAINT notifications_reminder_step_fk FOREIGN KEY (workspace_id, reminder_step_id)
    REFERENCES reminder_steps (workspace_id, id) ON DELETE SET NULL (reminder_step_id),
  ADD CONSTRAINT notifications_fallback_of_fk FOREIGN KEY (workspace_id, fallback_of)
    REFERENCES notifications (workspace_id, id) ON DELETE SET NULL (fallback_of),
  ADD CONSTRAINT notifications_fallback_of_check CHECK (fallback_of IS NULL OR fallback_of <> id);
--> statement-breakpoint
CREATE INDEX notifications_status_updated_idx ON notifications (workspace_id, status, updated_at);
--> statement-breakpoint
CREATE INDEX notifications_reminder_step_idx ON notifications (workspace_id, reminder_step_id) WHERE reminder_step_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX notifications_fallback_of_idx ON notifications (workspace_id, fallback_of) WHERE fallback_of IS NOT NULL;
--> statement-breakpoint
-- Rule 3: the notifications table was enabled but not forced. Every path reaches it as wodana_app inside a
-- tenant transaction or through a SECURITY DEFINER function, so forcing it changes no behaviour.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- 8. Row security and grants.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reminder_rules', 'reminder_settings', 'notification_person_settings', 'reminder_subjects', 'reminder_steps', 'reminder_digests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- A rule or a person's settings back to the default is a removed row.
    GRANT SELECT, INSERT, UPDATE, DELETE ON reminder_rules, reminder_settings, notification_person_settings TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON reminder_subjects, reminder_steps, reminder_digests TO wodana_app;
    GRANT EXECUTE ON FUNCTION reminders_strictly_ascending(integer[]), reminders_distinct_text(text[]) TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- The sweep works across workspaces: it lists the active ones, then runs each in its own tenant transaction.
CREATE FUNCTION list_reminder_engine_workspaces() RETURNS TABLE (workspace_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT workspace.id FROM workspaces workspace WHERE workspace.status = 'active' AND workspace.archived_at IS NULL ORDER BY workspace.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION list_reminder_engine_workspaces() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION list_reminder_engine_workspaces() TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- 9. Permissions. Owners and administrators hold both; team scope also goes to every role that runs projects or
--    assigns enquiries.
INSERT INTO permissions (code, description) VALUES
  ('reminders.manage', 'Set the firm''s reminder rules, quiet hours, digest time and client window'),
  ('reminders.team', 'See and work the team''s My day: snooze, complete and reassign others'' items')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code IN ('reminders.manage', 'reminders.team')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE permission.code = 'reminders.team'
   AND EXISTS (SELECT 1 FROM role_permissions held JOIN permissions lead ON lead.id = held.permission_id
                WHERE held.role_id = role.id AND lead.code IN ('projects.manage', 'crm.leads.assign'))
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
-- 10. Go-live reset: rules and settings stay; subjects, steps and digests are cleared.
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('reminder_rules', 'keep', NULL, '{}'),
  ('reminder_settings', 'keep', NULL, '{}'),
  ('notification_person_settings', 'keep', NULL, '{}'),
  ('reminder_subjects', 'clear', NULL, '{}'),
  ('reminder_steps', 'clear', NULL, '{}'),
  ('reminder_digests', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
