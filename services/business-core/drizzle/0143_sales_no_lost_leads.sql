-- Sales: no enquiry is lost, and people are told in time (S-1, S-2, S-3, S-7, S-26, S-27).
-- One row per workspace holds the few Sales rules the timers need: how often the response takeover may
-- rotate an enquiry before a manager is told, how long an enquiry may sit without an owner or with an
-- unconfirmed client, the window in which a repeat enquiry counts as a duplicate, and who the Sales admin is.
-- A missing row means the defaults below.
CREATE TABLE IF NOT EXISTS workspace_sales_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  takeover_cap integer NOT NULL DEFAULT 2,
  unowned_escalation_minutes integer NOT NULL DEFAULT 15,
  client_review_minutes integer NOT NULL DEFAULT 30,
  duplicate_window_days integer NOT NULL DEFAULT 90,
  sales_admin_membership_id uuid REFERENCES workspace_memberships (id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_sales_settings_takeover_cap_check CHECK (takeover_cap BETWEEN 0 AND 10),
  CONSTRAINT workspace_sales_settings_unowned_check CHECK (unowned_escalation_minutes BETWEEN 1 AND 1440),
  CONSTRAINT workspace_sales_settings_review_check CHECK (client_review_minutes BETWEEN 1 AND 1440),
  CONSTRAINT workspace_sales_settings_duplicate_window_check CHECK (duplicate_window_days BETWEEN 1 AND 730)
);
--> statement-breakpoint
ALTER TABLE workspace_sales_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspace_sales_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON workspace_sales_settings;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON workspace_sales_settings
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
-- The daily Sales digest is sent once per workspace-local day; the row is the proof it went (or why not).
CREATE TABLE IF NOT EXISTS crm_sales_digests (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  digest_date date NOT NULL,
  outcome varchar(20) NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, digest_date),
  CONSTRAINT crm_sales_digests_outcome_check CHECK (outcome IN ('sent', 'nothing_due', 'not_working_day'))
);
--> statement-breakpoint
ALTER TABLE crm_sales_digests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_sales_digests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON crm_sales_digests;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_sales_digests
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON workspace_sales_settings TO wodana_app;
    GRANT SELECT, INSERT ON crm_sales_digests TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- When an enquiry without an owner is escalated (S-2), and when its unconfirmed client is (S-3).
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS escalation_due_at timestamptz;
--> statement-breakpoint
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
--> statement-breakpoint
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS client_review_due_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_leads_escalation_due_idx ON crm_leads (workspace_id, escalation_due_at) WHERE escalation_due_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_leads_client_review_due_idx ON crm_leads (workspace_id, client_review_due_at) WHERE client_review_due_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_leads_paused_wake_idx ON crm_leads (workspace_id, next_action_at) WHERE status = 'paused';
--> statement-breakpoint
-- The worker visits a workspace when any Sales timer is due, including the new ones.
CREATE OR REPLACE FUNCTION public.list_crm_workspaces_with_due_work()
 RETURNS TABLE(workspace_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    SELECT lead.workspace_id FROM crm_leads lead
      WHERE lead.escalation_due_at <= now() OR lead.client_review_due_at <= now()
         OR (lead.status = 'paused' AND lead.next_action_at <= now())
    UNION ALL
    SELECT workspace.id FROM workspaces workspace
      CROSS JOIN LATERAL (SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names zone WHERE zone.name = workspace.default_timezone)
        THEN workspace.default_timezone ELSE 'UTC' END AS name) zone
      WHERE workspace.status = 'active'
        AND (now() AT TIME ZONE zone.name)::time >= time '09:00'
        AND NOT EXISTS (SELECT 1 FROM crm_sales_digests digest WHERE digest.workspace_id = workspace.id
          AND digest.digest_date = (now() AT TIME ZONE zone.name)::date)
        AND EXISTS (SELECT 1 FROM crm_leads lead WHERE lead.workspace_id = workspace.id
          AND lead.status IN ('new','attempting_contact','connected','nurturing'))
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
$function$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace
CROSS JOIN (VALUES
  ('crm.sla_warning', 'in_app', '{{reference}} · respond by {{deadline}}', '{{minutes}} min left to contact {{clientName}}.', '["reference","clientName","deadline","minutes"]'),
  ('crm.sla_warning', 'push', '{{reference}} · respond by {{deadline}}', '{{minutes}} min left to contact {{clientName}}.', '["reference","clientName","deadline","minutes"]'),
  ('crm.sla_breached', 'in_app', '{{reference}} missed its response time', '{{clientName}} was due a first contact by {{deadline}}. Owner: {{ownerName}}.', '["reference","clientName","deadline","ownerName"]'),
  ('crm.sla_breached', 'push', '{{reference}} missed its response time', '{{clientName}} was due a first contact by {{deadline}}. Owner: {{ownerName}}.', '["reference","clientName","deadline","ownerName"]'),
  ('crm.lead_kept', 'in_app', '{{reference}} is still yours', 'No one else is available, so {{clientName}} stays with you. Contact the client now.', '["reference","clientName"]'),
  ('crm.lead_kept', 'push', '{{reference}} is still yours', 'No one else is available, so {{clientName}} stays with you. Contact the client now.', '["reference","clientName"]'),
  ('crm.lead_kept_admin', 'in_app', '{{reference}} has no one to take over', '{{ownerName}} has not contacted {{clientName}} and no one else is available. It stays with {{ownerName}}.', '["reference","clientName","ownerName"]'),
  ('crm.lead_escalated', 'in_app', '{{reference}} needs a manager', '{{clientName}} went {{attempts}} response windows without a first contact. Owner now: {{ownerName}}.', '["reference","clientName","attempts","ownerName"]'),
  ('crm.lead_escalated', 'email', '{{reference}} needs a manager', E'{{clientName}} went {{attempts}} response windows without a first contact.\n\nOwner now: {{ownerName}}\n\nOpen the enquiry to assign it or call the client.', '["reference","clientName","attempts","ownerName"]'),
  ('crm.lead_unowned', 'in_app', '{{reference}} has no owner', '{{clientName}} has waited {{minutes}} min without an owner. Assign it now.', '["reference","clientName","minutes"]'),
  ('crm.lead_unowned', 'push', '{{reference}} has no owner', '{{clientName}} has waited {{minutes}} min without an owner. Assign it now.', '["reference","clientName","minutes"]'),
  ('crm.lead_unowned', 'email', '{{reference}} has no owner', E'{{clientName}} has waited {{minutes}} min without an owner.\n\nOpen the enquiry and assign it now.', '["reference","clientName","minutes"]'),
  ('crm.client_review_waiting', 'in_app', 'Confirm the client for {{reference}}', '{{clientName}} may be an existing client. Confirm or keep them as new.', '["reference","clientName"]'),
  ('crm.sales_digest', 'in_app', 'Sales today: {{breached}} overdue, {{unowned}} without an owner', '{{waiting}} enquiries are waiting for a first contact.', '["breached","unowned","waiting"]'),
  ('crm.sales_digest', 'email', 'Sales today: {{breached}} overdue, {{unowned}} without an owner', E'Overdue first contact: {{breached}}\nWithout an owner: {{unowned}}\nWaiting for a first contact: {{waiting}}\n\nOpen Enquiries to act on them.', '["breached","unowned","waiting"]'),
  ('crm.enquiries_waiting', 'in_app', '{{count}} enquiries waiting for you', 'The first is due {{deadline}}.', '["count","deadline"]'),
  ('crm.enquiries_waiting', 'push', '{{count}} enquiries waiting for you', 'The first is due {{deadline}}.', '["count","deadline"]'),
  ('crm.lead_woken', 'in_app', 'Come back to {{clientName}} today', '{{reference}} was paused until {{deadline}}. It is back in your list.', '["reference","clientName","deadline"]'),
  ('crm.lead_woken', 'push', 'Come back to {{clientName}} today', '{{reference}} was paused until {{deadline}}. It is back in your list.', '["reference","clientName","deadline"]'),
  ('crm.lead_reassigned_from', 'in_app', '{{reference}} moved to {{newOwner}}', '{{clientName}} is now with {{newOwner}}.', '["reference","clientName","newOwner"]')
) AS template(code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
--> statement-breakpoint
-- A new owner hears when the enquiry is due; the weekend notice says by when (S-26).
UPDATE notification_templates SET body_template = 'New enquiry from {{source}}. Respond by {{deadline}}.',
       variables = '["reference","clientName","source","deadline"]'::jsonb
 WHERE code = 'crm.lead_assigned' AND channel = 'in_app' AND version_number = 1
   AND body_template = 'New enquiry from {{source}}. Log your first contact within the response time.';
--> statement-breakpoint
UPDATE notification_templates SET body_template = E'You have a new enquiry.\n\nReference: {{reference}}\nClient: {{clientName}}\nSource: {{source}}\nRespond by: {{deadline}}\n\nOpen it and log your first contact.',
       variables = '["reference","clientName","source","deadline"]'::jsonb
 WHERE code = 'crm.lead_assigned' AND channel = 'email' AND version_number = 1
   AND body_template = E'You have a new enquiry.\n\nReference: {{reference}}\nClient: {{clientName}}\nSource: {{source}}\n\nOpen it and log your first contact within the response time.';
