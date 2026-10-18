-- A new quote starts with the firm's default payment plan (Q-34) instead of no milestones. The default is one
-- of the workspace's payment templates, chosen in Settings → Quotations (or set up from the firm kit); a
-- workspace with exactly one active template starts with that one. The settings table already has forced RLS
-- and a tenant_isolation policy; wodana_app keeps its grants. Idempotent.
ALTER TABLE workspace_quotation_settings ADD COLUMN IF NOT EXISTS default_payment_template_id uuid;
--> statement-breakpoint
INSERT INTO workspace_quotation_settings (workspace_id, default_payment_template_id)
SELECT single.workspace_id, single.id
  FROM (SELECT workspace_id, (array_agg(id))[1] AS id FROM commercial_payment_templates WHERE status = 'active' GROUP BY workspace_id HAVING count(*) = 1) single
ON CONFLICT (workspace_id) DO UPDATE SET default_payment_template_id = excluded.default_payment_template_id
 WHERE workspace_quotation_settings.default_payment_template_id IS NULL;
