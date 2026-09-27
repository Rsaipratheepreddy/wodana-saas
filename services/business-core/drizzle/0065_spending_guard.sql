-- The spending guard. A project's new order is checked against the money in hand for it (what the client
-- paid, less what's spent and still committed). Per workspace: off, warn (the order goes through and the
-- managers hear) or strict (it stops unless someone who may override approves it with why). An override
-- belongs to the order as it was; changing its lines clears it.
ALTER TABLE workspace_purchasing_settings ADD COLUMN spending_guard varchar(8) NOT NULL DEFAULT 'off' CHECK (spending_guard IN ('off', 'warn', 'strict'));
--> statement-breakpoint
ALTER TABLE purchase_orders
  ADD COLUMN funds_override_by uuid REFERENCES users (id),
  ADD COLUMN funds_override_at timestamptz,
  ADD COLUMN funds_override_reason varchar(500),
  ADD CONSTRAINT purchase_orders_funds_override_check CHECK ((funds_override_by IS NULL) = (funds_override_reason IS NULL) AND (funds_override_by IS NULL) = (funds_override_at IS NULL));
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('projects.funds_override', 'Let an order go ahead when its project has too little money in hand')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code = 'owner' AND permission.code = 'projects.funds_override'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, '{{note}}', '["order", "supplier", "amount", "actor", "note"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('purchasing.over_funds', 'Ordered beyond the money in hand: {{order}}'),
  ('purchasing.funds_blocked', 'Order waiting for money: {{order}}')
) AS template (code, subject)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
