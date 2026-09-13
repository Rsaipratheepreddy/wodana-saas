ALTER TABLE "business_units" ADD COLUMN "color" varchar(7) DEFAULT '#64748B' NOT NULL;
--> statement-breakpoint
ALTER TABLE "business_units" ADD CONSTRAINT "business_units_color_hex_check"
CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$');
