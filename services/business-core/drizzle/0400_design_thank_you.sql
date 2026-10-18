-- Guide J: the thank-you when a design-only job completes, in the guide's words (the client's name, the package, the firm).
-- Only where the firm still has the product's first wording.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT template.workspace_id, template.code, template.channel, template.locale, template.version_number + 1, 'approved', template.subject_template,
       E'Dear {{name}}, thank you for choosing {{company}}. Your {{title}} design is complete, and you''ll find all your final files in your client portal. Whenever you''re ready to bring the design to life with furniture or fit-out, our team will be happy to help.\n\n– {{company}}',
       '["company", "project", "title", "due", "note", "name"]'::jsonb, now()
  FROM notification_templates template
 WHERE template.code = 'portal.design_completed' AND template.channel = 'email' AND template.status = 'approved'
   AND template.body_template LIKE 'Thank you for choosing {{company}}. Your design for {{project}} is approved and complete.%'
   AND NOT EXISTS (SELECT 1 FROM notification_templates newer WHERE newer.workspace_id = template.workspace_id AND newer.code = template.code
                    AND newer.channel = template.channel AND newer.locale = template.locale AND newer.version_number > template.version_number)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
