-- A supplier offers an alternative for an order line (another make, finish or size). Someone other than
-- the buyer decides; the line keeps what was ordered first, and nothing is received until it's decided.
ALTER TABLE purchase_order_lines
  ADD COLUMN alternate_status varchar(10) CHECK (alternate_status IN ('offered', 'accepted', 'rejected')),
  ADD COLUMN alternate_description varchar(500),
  ADD COLUMN alternate_specification varchar(1000) NOT NULL DEFAULT '',
  ADD COLUMN alternate_unit_price numeric(18, 4) CHECK (alternate_unit_price IS NULL OR alternate_unit_price >= 0),
  ADD COLUMN alternate_note varchar(500) NOT NULL DEFAULT '',
  ADD COLUMN alternate_offered_by uuid REFERENCES users (id),
  ADD COLUMN alternate_decided_by uuid REFERENCES users (id),
  ADD COLUMN original_description varchar(500),
  ADD COLUMN original_specification varchar(1000);
--> statement-breakpoint
ALTER TABLE purchase_order_lines
  ADD CONSTRAINT purchase_order_lines_alternate_check CHECK (alternate_status IS NULL OR (length(btrim(alternate_description)) > 0 AND alternate_offered_by IS NOT NULL)),
  ADD CONSTRAINT purchase_order_lines_alternate_decided_check CHECK (alternate_status IS NULL OR alternate_status = 'offered' OR alternate_decided_by IS NOT NULL);
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('purchasing.alternate_offered', '{{supplier}} offers an alternative on {{order}}', '{{actor}}: {{note}}', '["order", "supplier", "amount", "actor", "note"]'),
  ('purchasing.alternate_decided', 'Alternative on {{order}}: {{note}}', '{{actor}} decided on {{supplier}}''s alternative.', '["order", "supplier", "amount", "actor", "note"]')
) AS template (code, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
