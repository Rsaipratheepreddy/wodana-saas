-- A phone that allowed notifications and registered for pushes gets them, unless the person chose otherwise.
-- Phones registered before device registration did this themselves had no push setting, so nothing was sent.
-- Only people with no push setting at all are switched on; an explicit choice stays. Idempotent.
INSERT INTO notification_preferences (workspace_id, recipient_type, recipient_id, event_type, channel, enabled, quiet_hours)
SELECT DISTINCT endpoint.workspace_id, 'user', endpoint.user_id, '*', 'push', true, '{}'::jsonb
  FROM device_endpoints endpoint
  JOIN notification_device_consents consent ON consent.id = endpoint.consent_id AND consent.workspace_id = endpoint.workspace_id
 WHERE endpoint.status = 'active' AND consent.permission_status IN ('granted', 'provisional', 'ephemeral')
ON CONFLICT (workspace_id, recipient_type, recipient_id, event_type, channel) DO NOTHING;
