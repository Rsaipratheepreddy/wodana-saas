-- Client decisions (Q-8). Every quote or design waiting on the client is reminded on the firm's days (2 and 5
-- by default, Settings → Quotations), to the client and the case owner. The ad-hoc decision reminders pointed at a
-- page that doesn't exist; they (and those already sent) now open the case's Change requests. The settings table
-- already has forced RLS and a tenant_isolation policy; wodana_app keeps its grants.
ALTER TABLE workspace_quotation_settings
  ADD COLUMN decision_reminder_days smallint[] NOT NULL DEFAULT '{2,5}',
  ADD CONSTRAINT workspace_quotation_settings_decision_reminder_days_check
    CHECK (cardinality(decision_reminder_days) <= 5 AND 1 <= ALL (decision_reminder_days) AND 60 >= ALL (decision_reminder_days));
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'commercial.decision_waiting', 'in_app', 'en', 1, 'approved', 'Waiting on the client · {{title}}', '{{note}}', '["title", "clientName", "note"]'::jsonb, now()
FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
--> statement-breakpoint
UPDATE notifications
   SET deep_link = regexp_replace(deep_link, '^/workspace/pre-projects/([^/]+)/commercial\?request=', '/workspace/pre-projects/cases/\1/variations?request=')
 WHERE event_type = 'commercial.decision.reminder' AND deep_link ~ '^/workspace/pre-projects/[^/]+/commercial\?request=';
