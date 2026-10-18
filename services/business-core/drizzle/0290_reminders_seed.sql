-- Reminder engine (E4): each firm's current reminder values become its reminder rules (plan §6.24a), and every
-- workspace gets the reminders.* notification templates. Nothing reads the old columns after the cutover.
--   * decision days (Settings → Quotations) ∪ the quotation follow-up day (Settings → Inbox, unless that client
--     message is off) → client.quote_decision and client.design_decision (ascending, at most 4);
--   * the quote expiry warning days N → quote.expiring {−N, 0} ({0} when N is 0);
--   * the payments.reminder client message's offsets and switch → payment.due (ascending, at most 6);
--   * the Approval reminders rule's hours, switch and email channel → approval.waiting;
--   * each person's push quiet hours (and their time zone) → notification_person_settings.
-- Idempotent: a firm or person that already has a row keeps it.

-- 1. Client decisions.
INSERT INTO reminder_rules (workspace_id, kind, enabled, offsets, unit, working_days, escalate_after, chain, channels, digest)
SELECT days.workspace_id, kind.kind, true, days.offsets, 'day', false, 2, '{}', ARRAY['whatsapp', 'email'], false
  FROM (
    SELECT workspace.id AS workspace_id,
           (SELECT array_agg(day ORDER BY day) FROM (
              SELECT DISTINCT day FROM (
                SELECT unnest(coalesce(quotation.decision_reminder_days, '{2,5}'::smallint[]))::integer AS day
                UNION ALL
                SELECT coalesce(inbox.quote_followup_days, 3)::integer
                 WHERE NOT EXISTS (SELECT 1 FROM crm_client_message_rules rule
                                    WHERE rule.workspace_id = workspace.id AND rule.event = 'commercial.quote_follow_up' AND NOT rule.enabled)
              ) merged WHERE day BETWEEN 1 AND 90
              ORDER BY day LIMIT 4) capped) AS offsets
      FROM workspaces workspace
      LEFT JOIN workspace_quotation_settings quotation ON quotation.workspace_id = workspace.id
      LEFT JOIN crm_inbox_settings inbox ON inbox.workspace_id = workspace.id
     WHERE quotation.workspace_id IS NOT NULL OR inbox.workspace_id IS NOT NULL
  ) days
  CROSS JOIN (VALUES ('client.quote_decision'), ('client.design_decision')) AS kind (kind)
 WHERE cardinality(days.offsets) > 0
ON CONFLICT (workspace_id, kind) DO NOTHING;
--> statement-breakpoint
-- 2. Quote expiry warning.
INSERT INTO reminder_rules (workspace_id, kind, enabled, offsets, unit, working_days, escalate_after, chain, channels, digest)
SELECT quotation.workspace_id, 'quote.expiring', true,
       CASE WHEN quotation.expiry_warning_days > 0 THEN ARRAY[-quotation.expiry_warning_days::integer, 0] ELSE ARRAY[0] END,
       'day', false, NULL, '{}', ARRAY['in_app', 'push', 'email'], false
  FROM workspace_quotation_settings quotation
ON CONFLICT (workspace_id, kind) DO NOTHING;
--> statement-breakpoint
-- 3. Payment reminders to clients.
INSERT INTO reminder_rules (workspace_id, kind, enabled, offsets, unit, working_days, escalate_after, chain, channels, digest)
SELECT rule.workspace_id, 'payment.due', rule.enabled,
       (SELECT array_agg(day ORDER BY day) FROM (
          SELECT DISTINCT day FROM unnest(coalesce(rule.offsets, '{-3,0,3,7}'::integer[])) AS day WHERE day BETWEEN -90 AND 90
          ORDER BY day LIMIT 6) capped),
       'day', false, NULL, '{}', ARRAY['whatsapp', 'email'], false
  FROM crm_client_message_rules rule
 WHERE rule.event = 'payments.reminder'
ON CONFLICT (workspace_id, kind) DO NOTHING;
--> statement-breakpoint
-- 4. Approvals that wait: remind after the reminder hours, escalate to the owners after the escalation hours.
INSERT INTO reminder_rules (workspace_id, kind, enabled, offsets, unit, working_days, escalate_after, chain, channels, digest)
SELECT hours.workspace_id, 'approval.waiting', hours.enabled,
       CASE WHEN hours.escalate > hours.remind THEN ARRAY[hours.remind, hours.escalate] ELSE ARRAY[hours.remind] END,
       'hour', false, CASE WHEN hours.escalate > hours.remind THEN 2 ELSE 1 END, ARRAY['owner'],
       CASE WHEN hours.email THEN ARRAY['in_app', 'push', 'email'] ELSE ARRAY['in_app', 'push'] END, false
  FROM (
    SELECT policy.workspace_id, policy.status = 'active' AS enabled, policy.channels ? 'email' AS email,
           remind.hours AS remind, greatest(remind.hours, escalate.hours) AS escalate
      FROM (SELECT DISTINCT ON (workspace_id) workspace_id, status, channels, conditions FROM notification_policies
             WHERE event_type = 'approvals.reminder' ORDER BY workspace_id, updated_at DESC) policy
      CROSS JOIN LATERAL (SELECT CASE WHEN policy.conditions->>'remindAfterHours' ~ '^[0-9]{1,3}$'
                                       AND (policy.conditions->>'remindAfterHours')::integer BETWEEN 1 AND 720
                                      THEN (policy.conditions->>'remindAfterHours')::integer ELSE 24 END AS hours) remind
      CROSS JOIN LATERAL (SELECT CASE WHEN policy.conditions->>'escalateAfterHours' ~ '^[0-9]{1,3}$'
                                       AND (policy.conditions->>'escalateAfterHours')::integer BETWEEN 1 AND 720
                                      THEN (policy.conditions->>'escalateAfterHours')::integer ELSE 48 END AS hours) escalate
  ) hours
ON CONFLICT (workspace_id, kind) DO NOTHING;
--> statement-breakpoint
-- 5. Push quiet hours become the person's quiet hours (all channels), with the zone they were set in.
INSERT INTO notification_person_settings (workspace_id, membership_id, quiet_start, quiet_end, time_zone)
SELECT DISTINCT ON (membership.workspace_id, membership.id) membership.workspace_id, membership.id,
       (preference.quiet_hours->>'start')::time, (preference.quiet_hours->>'end')::time,
       CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names zone WHERE zone.name = preference.quiet_hours->>'timezone')
            THEN preference.quiet_hours->>'timezone' END
  FROM notification_preferences preference
  JOIN workspace_memberships membership ON membership.workspace_id = preference.workspace_id AND membership.user_id = preference.recipient_id
 WHERE preference.recipient_type = 'user' AND preference.channel = 'push' AND preference.event_type = '*'
   AND preference.quiet_hours->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   AND preference.quiet_hours->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   AND preference.quiet_hours->>'start' <> preference.quiet_hours->>'end'
 ORDER BY membership.workspace_id, membership.id, preference.updated_at DESC
ON CONFLICT (workspace_id, membership_id) DO NOTHING;
--> statement-breakpoint
-- 6. The reminders.* templates (notifications/default-templates.ts; new workspaces get them when created).
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('reminders.work.due', 'in_app', '{{title}} · {{due}}', '{{context}}. Update its progress or move the date.', '["title","context","due"]'),
  ('reminders.work.due', 'push', '{{title}} · {{due}}', '{{context}}. Update its progress or move the date.', '["title","context","due"]'),
  ('reminders.work.due', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. Update its progress or move the date.', '["title","context","due"]'),
  ('reminders.crm.follow_up', 'in_app', '{{title}} · {{due}}', '{{context}}. Call or message the client, then log it.', '["title","context","due"]'),
  ('reminders.crm.follow_up', 'push', '{{title}} · {{due}}', '{{context}}. Call or message the client, then log it.', '["title","context","due"]'),
  ('reminders.crm.follow_up', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. Call or message the client, then log it.', '["title","context","due"]'),
  ('reminders.approval.waiting', 'in_app', '{{title}} · {{due}}', '{{context}}. It is waiting for your decision.', '["title","context","due"]'),
  ('reminders.approval.waiting', 'push', '{{title}} · {{due}}', '{{context}}. It is waiting for your decision.', '["title","context","due"]'),
  ('reminders.approval.waiting', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. It is waiting for your decision.', '["title","context","due"]'),
  ('reminders.quote.expiring', 'in_app', '{{title}} · {{due}}', '{{context}}. Follow up with the client, or extend its validity.', '["title","context","due"]'),
  ('reminders.quote.expiring', 'push', '{{title}} · {{due}}', '{{context}}. Follow up with the client, or extend its validity.', '["title","context","due"]'),
  ('reminders.quote.expiring', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. Follow up with the client, or extend its validity.', '["title","context","due"]'),
  ('reminders.invoice.overdue', 'in_app', '{{title}} · {{due}}', '{{context}}. Chase the payment, or record it if it came in.', '["title","context","due"]'),
  ('reminders.invoice.overdue', 'push', '{{title}} · {{due}}', '{{context}}. Chase the payment, or record it if it came in.', '["title","context","due"]'),
  ('reminders.invoice.overdue', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. Chase the payment, or record it if it came in.', '["title","context","due"]'),
  ('reminders.payables.due', 'in_app', '{{title}} · {{due}}', '{{context}}. Pay it, or put it on hold.', '["title","context","due"]'),
  ('reminders.payables.due', 'push', '{{title}} · {{due}}', '{{context}}. Pay it, or put it on hold.', '["title","context","due"]'),
  ('reminders.payables.due', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. Pay it, or put it on hold.', '["title","context","due"]'),
  ('reminders.purchase.order_late', 'in_app', '{{title}} · {{due}}', '{{context}}. Chase the supplier, or move the expected date.', '["title","context","due"]'),
  ('reminders.purchase.order_late', 'push', '{{title}} · {{due}}', '{{context}}. Chase the supplier, or move the expected date.', '["title","context","due"]'),
  ('reminders.purchase.order_late', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. Chase the supplier, or move the expected date.', '["title","context","due"]'),
  ('reminders.design.stage_due', 'in_app', '{{title}} · {{due}}', '{{context}}. Finish the stage, or move its date.', '["title","context","due"]'),
  ('reminders.design.stage_due', 'push', '{{title}} · {{due}}', '{{context}}. Finish the stage, or move its date.', '["title","context","due"]'),
  ('reminders.design.stage_due', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. Finish the stage, or move its date.', '["title","context","due"]'),
  ('reminders.permit.expiry', 'in_app', '{{title}} · {{due}}', '{{context}}. Renew the permit, or move the booking.', '["title","context","due"]'),
  ('reminders.permit.expiry', 'push', '{{title}} · {{due}}', '{{context}}. Renew the permit, or move the booking.', '["title","context","due"]'),
  ('reminders.permit.expiry', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. Renew the permit, or move the booking.', '["title","context","due"]'),
  ('reminders.finance_request.waiting', 'in_app', '{{title}} · {{due}}', '{{context}}. It is waiting for Finance.', '["title","context","due"]'),
  ('reminders.finance_request.waiting', 'push', '{{title}} · {{due}}', '{{context}}. It is waiting for Finance.', '["title","context","due"]'),
  ('reminders.finance_request.waiting', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. It is waiting for Finance.', '["title","context","due"]'),
  ('reminders.client.quote_decision', 'email', 'Your quotation {{title}} is waiting for you', E'{{title}} is waiting for your decision.\n\n{{context}}\n\nOpen it to accept it or ask for changes.', '["title","context","due"]'),
  ('reminders.client.design_decision', 'email', 'Your design {{title}} is waiting for you', E'{{title}} is waiting for your approval.\n\n{{context}}\n\nOpen it to approve it or ask for changes.', '["title","context","due"]'),
  ('reminders.payment.due', 'email', 'Payment {{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}\n\nOpen it to see how to pay. If you have paid already, thank you, and please ignore this message.', '["title","context","due"]'),
  ('reminders.client.quote_decision.staff', 'in_app', 'Waiting on the client · {{title}}', '{{context}} has had {{reminders}} reminders about this quotation and hasn''t decided. Call them.', '["title","context","due","reminders"]'),
  ('reminders.client.quote_decision.staff', 'push', 'Waiting on the client · {{title}}', '{{context}} has had {{reminders}} reminders about this quotation and hasn''t decided. Call them.', '["title","context","due","reminders"]'),
  ('reminders.client.quote_decision.staff', 'email', 'Waiting on the client · {{title}}', E'{{context}} has had {{reminders}} reminders about this quotation and hasn''t decided. Call them.\n\nOpen it to see what they still have to decide.', '["title","context","due","reminders"]'),
  ('reminders.client.design_decision.staff', 'in_app', 'Waiting on the client · {{title}}', '{{context}} has had {{reminders}} reminders about this design and hasn''t decided. Call them.', '["title","context","due","reminders"]'),
  ('reminders.client.design_decision.staff', 'push', 'Waiting on the client · {{title}}', '{{context}} has had {{reminders}} reminders about this design and hasn''t decided. Call them.', '["title","context","due","reminders"]'),
  ('reminders.client.design_decision.staff', 'email', 'Waiting on the client · {{title}}', E'{{context}} has had {{reminders}} reminders about this design and hasn''t decided. Call them.\n\nOpen it to see what they still have to decide.', '["title","context","due","reminders"]'),
  ('reminders.escalated', 'in_app', 'Escalated · {{title}} · {{due}}', '{{owner}} has had {{reminders}} reminders. {{context}}.', '["title","context","due","owner","reminders"]'),
  ('reminders.escalated', 'push', 'Escalated · {{title}} · {{due}}', '{{owner}} has had {{reminders}} reminders. {{context}}.', '["title","context","due","owner","reminders"]'),
  ('reminders.escalated', 'email', 'Escalated · {{title}} · {{due}}', E'{{title}} is {{due}}. {{owner}} has had {{reminders}} reminders and it is still open.\n\n{{context}}.\n\nOpen it to help move it on, or reassign it.', '["title","context","due","owner","reminders"]'),
  ('reminders.digest', 'in_app', 'Your day · {{count}} to do', '{{overdue}} overdue, {{today}} due today, {{waiting}} waiting.', '["count","overdue","today","waiting","items"]'),
  ('reminders.digest', 'email', 'Your day · {{count}} to do', E'{{overdue}} overdue, {{today}} due today, {{waiting}} waiting.\n\n{{items}}\n\nOpen My day to work through them.', '["count","overdue","today","waiting","items"]'),
  ('reminders.unreachable', 'in_app', 'Couldn''t reach {{client}} · {{title}}', 'No WhatsApp or email reached them. Add a contact detail, or tell them yourself.', '["client","title","context"]'),
  ('reminders.unreachable', 'email', 'Couldn''t reach {{client}} · {{title}}', E'The reminder about {{title}} reached {{client}} on no channel: WhatsApp and email both failed or aren''t set up.\n\n{{context}}\n\nAdd a contact detail on the client, or tell them yourself.', '["client","title","context"]'),
  ('reminders.delivery_failed', 'in_app', '{{channel}} messages are failing', '{{count}} failed today: {{error}}. Check Delivery health.', '["channel","count","error"]'),
  ('reminders.delivery_failed', 'email', '{{channel}} messages are failing', E'{{count}} {{channel}} messages to clients or about critical items failed today with: {{error}}.\n\nOpen Settings → Delivery health to see which ones and fix the connection.', '["channel","count","error"]')
) AS template(code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
