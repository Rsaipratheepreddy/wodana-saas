CREATE TYPE "brand_asset_status" AS ENUM ('pending', 'active', 'replaced', 'failed');
--> statement-breakpoint
CREATE TABLE "workspace_brand_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "object_key" text NOT NULL,
  "original_filename" varchar(255) NOT NULL,
  "mime_type" varchar(64) NOT NULL,
  "expected_byte_size" integer NOT NULL,
  "byte_size" integer,
  "width" integer,
  "height" integer,
  "variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" "brand_asset_status" DEFAULT 'pending' NOT NULL,
  "created_by" uuid NOT NULL,
  "upload_expires_at" timestamp with time zone NOT NULL,
  "activated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_brand_assets_expected_size_check"
    CHECK ("expected_byte_size" > 0 AND "expected_byte_size" <= 5242880),
  CONSTRAINT "workspace_brand_assets_dimensions_check"
    CHECK (("width" IS NULL AND "height" IS NULL) OR ("width" > 0 AND "height" > 0))
);
--> statement-breakpoint
ALTER TABLE "workspace_brand_assets"
  ADD CONSTRAINT "workspace_brand_assets_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workspace_brand_assets"
  ADD CONSTRAINT "workspace_brand_assets_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
  ON DELETE restrict ON UPDATE no action;
CREATE UNIQUE INDEX "workspace_brand_assets_object_key_uidx"
  ON "workspace_brand_assets" ("object_key");
CREATE INDEX "workspace_brand_assets_workspace_status_idx"
  ON "workspace_brand_assets" ("workspace_id", "status");
--> statement-breakpoint
ALTER TABLE "tenant_login_branding" ADD COLUMN "logo_asset_id" uuid;
ALTER TABLE "tenant_login_branding"
  ADD CONSTRAINT "tenant_login_branding_logo_asset_id_workspace_brand_assets_id_fk"
  FOREIGN KEY ("logo_asset_id") REFERENCES "public"."workspace_brand_assets"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_brand_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_brand_assets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "workspace_brand_assets"
USING (
  "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
)
WITH CHECK (
  "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "workspace_brand_assets"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
