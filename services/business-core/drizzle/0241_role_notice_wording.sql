-- Team notices name the role after the project ("You're on PRJ-0004 as Procurement"): "You're the Procurement on …"
-- didn't fit role nouns. Only the unedited system defaults (version 1, original text) change; a workspace's own
-- wording stays. New workspaces get the new text from DEFAULT_NOTIFICATION_TEMPLATES. Idempotent.
UPDATE notification_templates SET body_template = E'{{actor}} started {{title}} for {{clientName}}. You''re on it as {{role}}.'
 WHERE code = 'project.started' AND channel = 'email' AND version_number = 1
   AND body_template = E'{{actor}} started {{title}} for {{clientName}}. You''re the {{role}}.';
--> statement-breakpoint
UPDATE notification_templates SET subject_template = 'You''re on {{title}} as {{role}}'
 WHERE code = 'project.team_added' AND channel IN ('in_app', 'email') AND version_number = 1
   AND subject_template = 'You''re the {{role}} on {{title}}';
--> statement-breakpoint
UPDATE notification_templates SET body_template = E'{{actor}} added you to {{title}} for {{clientName}} as {{role}}.'
 WHERE code = 'project.team_added' AND channel = 'email' AND version_number = 1
   AND body_template = E'{{actor}} added you to {{title}} for {{clientName}} as the {{role}}.';
