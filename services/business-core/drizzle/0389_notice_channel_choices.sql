-- Each person chooses how they are told: for each notice group (sales, planning, projects, operations, finance,
-- ledger, people, workspace) and each channel (in the app, email, WhatsApp, push), on or off.
--
-- 1. notification_channel_choices (keep): one row per member, group and channel they saved. No row = on, so nothing
--    changes for anyone who never opens the settings. Alerts (critical notices) ignore these switches. The person's
--    quiet hours, digest and time zone stay in notification_person_settings, whose version guards both tables.
-- 2. The group switches the settings page stored as event prefixes ('crm.*', 'site.*', ...) in
--    notification_preferences become group choices: a group is off on a channel when every one of its prefixes was
--    off there (what the page showed). The prefix rows stay (a project email opt-in reads them); a group switch
--    outranks them. Mutes of one kind of notice ("Mute notices like this") and the phone's own push switch ('*') stay.
-- 3. notifications.silent: an in-app notice that landed during the person's quiet hours (no sound, no pop-up).
-- Workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS notification_channel_choices (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  membership_id uuid NOT NULL,
  notice_group varchar(20) NOT NULL CHECK (notice_group IN ('sales', 'planning', 'projects', 'operations', 'finance', 'ledger', 'people', 'workspace')),
  channel varchar(20) NOT NULL CHECK (channel IN ('in_app', 'email', 'whatsapp', 'push')),
  enabled boolean NOT NULL,
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, membership_id, notice_group, channel),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES workspace_memberships (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['notification_channel_choices'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = table_name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wodana_app', table_name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('notification_channel_choices', 'keep', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition, clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
--> statement-breakpoint
-- 2. The group prefixes (apps/web/lib/workspace/notification-modules.ts, src/notifications/notice-choices.ts).
WITH groups (notice_group, prefix) AS (VALUES
  ('sales', 'crm'),
  ('planning', 'design'), ('planning', 'quotation'), ('planning', 'request'), ('planning', 'portal'), ('planning', 'client_portal'), ('planning', 'pre_project'),
  ('projects', 'project'), ('projects', 'work'), ('projects', 'site'), ('projects', 'handover'), ('projects', 'warranty'), ('projects', 'gallery'),
  ('operations', 'purchasing'), ('operations', 'stock'), ('operations', 'supplier'), ('operations', 'factory'),
  ('finance', 'payables'), ('finance', 'petty_cash'), ('finance', 'receivables'), ('finance', 'accounting'),
  ('ledger', 'books'),
  ('people', 'hrms'),
  ('workspace', 'account'), ('workspace', 'workspace'), ('workspace', 'delivery')
), sizes AS (
  SELECT notice_group, count(*) AS prefixes FROM groups GROUP BY notice_group
), muted AS (
  SELECT preference.workspace_id, membership.id AS membership_id, groups.notice_group, preference.channel::text AS channel, count(DISTINCT groups.prefix) AS off
    FROM notification_preferences preference
    JOIN groups ON preference.event_type::text = groups.prefix || '.*'
    JOIN workspace_memberships membership ON membership.workspace_id = preference.workspace_id AND membership.user_id = preference.recipient_id
   WHERE preference.recipient_type = 'user' AND NOT preference.enabled AND preference.channel::text IN ('in_app', 'email', 'whatsapp', 'push')
   GROUP BY preference.workspace_id, membership.id, groups.notice_group, preference.channel::text
)
INSERT INTO notification_channel_choices (workspace_id, membership_id, notice_group, channel, enabled)
SELECT muted.workspace_id, muted.membership_id, muted.notice_group, muted.channel, false
  FROM muted JOIN sizes ON sizes.notice_group = muted.notice_group
 WHERE muted.off = sizes.prefixes
ON CONFLICT (workspace_id, membership_id, notice_group, channel) DO NOTHING;
--> statement-breakpoint
-- 3. In-app notices that landed during quiet hours.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS silent boolean NOT NULL DEFAULT false;
