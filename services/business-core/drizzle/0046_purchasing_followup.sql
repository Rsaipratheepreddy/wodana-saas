-- Following an order through: the supplier confirms each line (how much, by when), a line that won't
-- come is cancelled with the reason (and can be ordered from another supplier, linked to the line it
-- replaces), and late deliveries are chased.
ALTER TABLE purchase_order_lines
  ADD COLUMN promised_date date,
  ADD COLUMN confirmed_quantity numeric(18, 4) CHECK (confirmed_quantity IS NULL OR confirmed_quantity >= 0),
  ADD COLUMN cancelled_quantity numeric(18, 4) NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
  ADD COLUMN cancel_reason varchar(500),
  ADD COLUMN replaces_line_id uuid;
--> statement-breakpoint
ALTER TABLE purchase_order_lines
  ADD CONSTRAINT purchase_order_lines_cancelled_check CHECK (cancelled_quantity <= quantity),
  ADD CONSTRAINT purchase_order_lines_cancel_reason_check CHECK (cancelled_quantity = 0 OR length(btrim(cancel_reason)) > 0),
  ADD CONSTRAINT purchase_order_lines_replaces_fk FOREIGN KEY (workspace_id, replaces_line_id) REFERENCES purchase_order_lines (workspace_id, id);
--> statement-breakpoint
CREATE INDEX purchase_order_lines_replaces_idx ON purchase_order_lines (workspace_id, replaces_line_id) WHERE replaces_line_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('purchasing.late', 'in_app', '{{order}} is late', '{{supplier}}: {{note}}', '["order", "supplier", "amount", "actor", "note"]'),
  ('purchasing.late', 'email', '{{order}} from {{supplier}} is late', '{{note}}' || chr(10) || chr(10) || 'Chase the supplier and record their new date on the order.', '["order", "supplier", "amount", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
