-- Palm's second-round answers (6 Oct): production, delivery, design and the catalogue. Configuration, never tenant code.
--
-- 1. Permit expiry reminders (PLM-136). building_permits.collected_on is the day the permit was obtained; each permit
--    reminds once, N days before it ends: reminder_days on the permit (an override; null follows the firm),
--    workspace_logistics_settings.permit_expiry_reminder_days (7 by default), and expiry_reminded_at when it went.
-- 2. Technical drawings per item (PLM-057/059): catalog_items.technical_drawing_url (the item's own drawing, a link);
--    project_boq_lines.drawing_needed overrides whether a line needs drawings (null follows the rule: bespoke and
--    joinery always, a standard item only without a catalogue drawing), with the reason, who and when.
-- 3. A catalogue import fills an item's size: catalog_item_dimensions.source may be 'import'.
-- 4. Balance reminders ahead of the ready date (PLM-067): workspace_factory_settings.balance_reminder_days (7 by
--    default) before the latest planned ready date of a payment stage's work orders; factory_ready_reminders records
--    why it went (all_ready or before_ready) and the planned date it followed (ready_on stays the day it was ready).
-- 5. Client updates by call or in the portal (PLM-046): client_update_calls.mode ('call' or 'portal').
-- 6. The 3D render stage's own deadlines (internal and client-facing); null keeps the design stages' days.
-- 7. The notice templates for every workspace.
-- No new tables. Nothing is backfilled. Idempotent; never disables RLS.
ALTER TABLE building_permits
  ADD COLUMN IF NOT EXISTS reminder_days smallint CHECK (reminder_days IS NULL OR reminder_days BETWEEN 0 AND 365),
  ADD COLUMN IF NOT EXISTS expiry_reminded_at timestamptz;
--> statement-breakpoint
ALTER TABLE workspace_logistics_settings
  ADD COLUMN IF NOT EXISTS permit_expiry_reminder_days smallint NOT NULL DEFAULT 7 CHECK (permit_expiry_reminder_days BETWEEN 0 AND 365);
--> statement-breakpoint
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS technical_drawing_url varchar(2000) CHECK (technical_drawing_url IS NULL OR technical_drawing_url ~ '^https?://');
--> statement-breakpoint
ALTER TABLE project_boq_lines
  ADD COLUMN IF NOT EXISTS drawing_needed boolean,
  ADD COLUMN IF NOT EXISTS drawing_reason varchar(500) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS drawing_set_by uuid REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS drawing_set_at timestamptz;
--> statement-breakpoint
ALTER TABLE catalog_item_dimensions DROP CONSTRAINT IF EXISTS catalog_item_dimensions_source_check;
--> statement-breakpoint
ALTER TABLE catalog_item_dimensions ADD CONSTRAINT catalog_item_dimensions_source_check CHECK (source IN ('person', 'clipper', 'import'));
--> statement-breakpoint
ALTER TABLE workspace_factory_settings
  ADD COLUMN IF NOT EXISTS balance_reminder_days smallint NOT NULL DEFAULT 7 CHECK (balance_reminder_days BETWEEN 0 AND 90);
--> statement-breakpoint
ALTER TABLE factory_ready_reminders
  ADD COLUMN IF NOT EXISTS reason varchar(20) NOT NULL DEFAULT 'all_ready' CHECK (reason IN ('all_ready', 'before_ready')),
  ADD COLUMN IF NOT EXISTS planned_ready_on date,
  ALTER COLUMN ready_on DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE client_update_calls ADD COLUMN IF NOT EXISTS mode varchar(8) NOT NULL DEFAULT 'call' CHECK (mode IN ('call', 'portal'));
--> statement-breakpoint
ALTER TABLE workspace_design_settings
  ADD COLUMN IF NOT EXISTS render_internal_days integer CHECK (render_internal_days IS NULL OR render_internal_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS render_client_days integer CHECK (render_client_days IS NULL OR render_client_days BETWEEN 1 AND 365);
--> statement-breakpoint
ALTER TABLE design_journeys
  ADD COLUMN IF NOT EXISTS render_internal_days integer CHECK (render_internal_days IS NULL OR render_internal_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS render_client_days integer CHECK (render_client_days IS NULL OR render_client_days BETWEEN 1 AND 365);
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('logistics.permit_renewal', 'in_app', 'The building permit ends on {{until}} · {{project}}', 'Permit {{number}}. Renew it if the work still needs it.', '["project","number","until","type"]'),
  ('logistics.permit_renewal', 'email', 'The building permit ends on {{until}}: {{project}}', E'Building permit {{number}} for {{project}} ends on {{until}}.\n\nRenew it if the work still needs it, and record the new permit.', '["project","number","until","type"]'),
  ('client_calls.portal_update_due', 'in_app', 'Post a progress update · {{clientName}}', 'They follow the work in the portal ({{frequency}}). Share an update today.', '["clientName","frequency","when"]'),
  ('client_calls.portal_update_due', 'email', 'Post a progress update: {{clientName}}', E'{{clientName}} follows the work in the client portal instead of calls ({{frequency}}).\n\nShare a progress update with them today.', '["clientName","frequency","when"]'),
  ('client_calls.client_changed', 'in_app', '{{clientName}} changed their updates', '{{choice}}', '["clientName","choice"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
