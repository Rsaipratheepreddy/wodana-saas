-- The "ready to start" notice reads the same whichever event raised it: the deal approved, or the upfront payment
-- verified with no project manager named. The sentence now comes from the event ({{note}}), so the payment case no
-- longer reads " approved the deal" with a blank name. Only the unedited default body changes; RLS untouched. Idempotent.
UPDATE notification_templates
   SET body_template = '{{note}}'
 WHERE code = 'project.ready_to_start' AND channel = 'in_app' AND locale = 'en' AND version_number = 1
   AND body_template IN (
     '{{actor}} approved the deal. Name the project manager and start the project.',
     'The upfront payment for {{clientName}} is verified. Start the project: {{note}}'
   );
