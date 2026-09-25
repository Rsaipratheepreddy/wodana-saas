ALTER TABLE notifications ADD COLUMN event_type varchar(120) NOT NULL DEFAULT 'service';
--> statement-breakpoint
CREATE INDEX notifications_frequency_idx ON notifications USING btree (workspace_id,policy_id,recipient_type,recipient_id,channel,created_at);
