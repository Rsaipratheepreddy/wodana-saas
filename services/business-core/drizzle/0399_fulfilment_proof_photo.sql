-- Guide J: a delivery (or installation) recorded on a deal carries its photo as proof of delivery.
ALTER TABLE crm_deal_fulfilment_events ADD COLUMN IF NOT EXISTS proof_storage_key varchar(500);
--> statement-breakpoint
ALTER TABLE crm_deal_fulfilment_events ADD COLUMN IF NOT EXISTS proof_file_name varchar(255);
--> statement-breakpoint
ALTER TABLE crm_deal_fulfilment_events ADD COLUMN IF NOT EXISTS proof_mime_type varchar(100);
--> statement-breakpoint
ALTER TABLE crm_deal_fulfilment_events ADD COLUMN IF NOT EXISTS proof_has_preview boolean NOT NULL DEFAULT false;
