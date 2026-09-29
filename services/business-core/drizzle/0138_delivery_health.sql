-- Delivery health (Settings → Connections → Delivery) reads each workspace's recent email, WhatsApp and
-- push notices by channel, and their latest failed delivery attempts. In-app notices are the bulk of the
-- table and are left out of the index. Both tables keep forced RLS and their tenant_isolation policies.
CREATE INDEX IF NOT EXISTS notifications_channel_recent_idx
  ON notifications (workspace_id, channel, created_at)
  WHERE channel <> 'in_app';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notification_attempts_failure_idx
  ON notification_delivery_attempts (workspace_id, started_at)
  WHERE status IN ('retry', 'permanent_failure');
